//! Redis backend: key browsing/editing, server info, slowlog, pub/sub, raw
//! command execution, and value decoding. Built on the `redis` crate.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use futures::StreamExt;
use redis::aio::MultiplexedConnection;
use std::collections::BTreeMap;
use tauri::{AppHandle, Emitter};

use crate::models::*;
use crate::state::AppState;

const MAX_ELEMS: isize = 1000;

fn b64(bytes: &[u8]) -> String {
    B64.encode(bytes)
}
fn unb64(s: &str) -> Vec<u8> {
    B64.decode(s).unwrap_or_else(|_| s.as_bytes().to_vec())
}

async fn conn(client: &redis::Client, db: i64) -> Result<MultiplexedConnection, String> {
    let mut c = client.get_multiplexed_async_connection().await.map_err(|e| e.to_string())?;
    if db != 0 {
        redis::cmd("SELECT")
            .arg(db)
            .query_async::<_, ()>(&mut c)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(c)
}

pub async fn databases(client: &redis::Client) -> Result<Vec<String>, String> {
    let mut c = conn(client, 0).await?;
    let count: i64 = match redis::cmd("CONFIG").arg("GET").arg("databases").query_async::<_, Vec<String>>(&mut c).await {
        Ok(v) if v.len() == 2 => v[1].parse().unwrap_or(16),
        _ => 16,
    };
    Ok((0..count).map(|i| i.to_string()).collect())
}

pub async fn dbsize(client: &redis::Client, db: i64) -> Result<i64, String> {
    let mut c = conn(client, db).await?;
    redis::cmd("DBSIZE").query_async(&mut c).await.map_err(|e| e.to_string())
}

pub async fn scan_keys(client: &redis::Client, db: i64, pattern: &str, cursor: u64, count: i64) -> Result<ScanResult, String> {
    let mut c = conn(client, db).await?;
    let pat = if pattern.is_empty() { "*" } else { pattern };
    let cnt = if count <= 0 { 200 } else { count };
    let (next, keys): (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(cursor)
        .arg("MATCH")
        .arg(pat)
        .arg("COUNT")
        .arg(cnt)
        .query_async(&mut c)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ScanResult { keys, next_cursor: next })
}

pub async fn get_key(client: &redis::Client, db: i64, key: &str) -> Result<KeyValue, String> {
    let mut c = conn(client, db).await?;
    let typ: String = redis::cmd("TYPE").arg(key).query_async(&mut c).await.map_err(|e| e.to_string())?;
    let ttl: i64 = redis::cmd("TTL").arg(key).query_async(&mut c).await.unwrap_or(-1);
    let encoding: String = redis::cmd("OBJECT").arg("ENCODING").arg(key).query_async(&mut c).await.unwrap_or_default();
    let size: i64 = redis::cmd("MEMORY").arg("USAGE").arg(key).query_async(&mut c).await.unwrap_or(0);

    let mut kv = KeyValue {
        meta: KeyMeta {
            key: key.to_string(),
            type_: typ.clone(),
            ttl,
            size_bytes: size,
            encoding,
        },
        ..Default::default()
    };

    match typ.as_str() {
        "string" => {
            let v: Option<Vec<u8>> = redis::cmd("GET").arg(key).query_async(&mut c).await.map_err(|e| e.to_string())?;
            kv.str = Some(v.map(|b| b64(&b)).unwrap_or_default());
        }
        "hash" => {
            let flat: Vec<Vec<u8>> = redis::cmd("HGETALL").arg(key).query_async(&mut c).await.map_err(|e| e.to_string())?;
            let mut hash = Vec::new();
            let mut it = flat.into_iter();
            let mut truncated = false;
            while let (Some(f), Some(v)) = (it.next(), it.next()) {
                if hash.len() as isize >= MAX_ELEMS {
                    truncated = true;
                    break;
                }
                hash.push(HashField { field: b64(&f), value: b64(&v) });
            }
            kv.hash = Some(hash);
            if truncated {
                kv.truncated = Some(true);
            }
        }
        "list" => {
            let items: Vec<Vec<u8>> = redis::cmd("LRANGE").arg(key).arg(0).arg(MAX_ELEMS - 1).query_async(&mut c).await.map_err(|e| e.to_string())?;
            let llen: i64 = redis::cmd("LLEN").arg(key).query_async(&mut c).await.unwrap_or(items.len() as i64);
            kv.list = Some(items.iter().map(|b| b64(b)).collect());
            if llen > MAX_ELEMS as i64 {
                kv.truncated = Some(true);
            }
        }
        "set" => {
            let members: Vec<Vec<u8>> = redis::cmd("SMEMBERS").arg(key).query_async(&mut c).await.map_err(|e| e.to_string())?;
            kv.set = Some(members.iter().take(MAX_ELEMS as usize).map(|b| b64(b)).collect());
            if members.len() as isize > MAX_ELEMS {
                kv.truncated = Some(true);
            }
        }
        "zset" => {
            let flat: Vec<Vec<u8>> = redis::cmd("ZRANGE").arg(key).arg(0).arg(MAX_ELEMS - 1).arg("WITHSCORES").query_async(&mut c).await.map_err(|e| e.to_string())?;
            let mut zset = Vec::new();
            let mut it = flat.into_iter();
            while let (Some(m), Some(s)) = (it.next(), it.next()) {
                let score = String::from_utf8_lossy(&s).parse::<f64>().unwrap_or(0.0);
                zset.push(ZMember { member: b64(&m), score });
            }
            kv.zset = Some(zset);
        }
        "stream" => {
            let entries = read_stream(&mut c, key).await.unwrap_or_default();
            kv.stream = Some(entries);
        }
        _ => {}
    }
    Ok(kv)
}

async fn read_stream(c: &mut MultiplexedConnection, key: &str) -> Result<Vec<StreamEntry>, String> {
    // XRANGE key - + COUNT MAX_ELEMS  →  [ [id, [f, v, f, v, ...]], ... ]
    let val: redis::Value = redis::cmd("XRANGE")
        .arg(key)
        .arg("-")
        .arg("+")
        .arg("COUNT")
        .arg(MAX_ELEMS as i64)
        .query_async(c)
        .await
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let redis::Value::Bulk(items) = val {
        for item in items {
            if let redis::Value::Bulk(pair) = item {
                if pair.len() == 2 {
                    let id = value_to_string(&pair[0]);
                    let mut fields = BTreeMap::new();
                    if let redis::Value::Bulk(fv) = &pair[1] {
                        let mut i = 0;
                        while i + 1 < fv.len() {
                            let f = value_to_string(&fv[i]);
                            let v = value_to_string(&fv[i + 1]);
                            fields.insert(f, v);
                            i += 2;
                        }
                    }
                    out.push(StreamEntry { id, fields });
                }
            }
        }
    }
    Ok(out)
}

// ── Writes ───────────────────────────────────────────────────────────────────

pub async fn set_string(client: &redis::Client, db: i64, key: &str, value_b64: &str, ttl: i64) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    let bytes = unb64(value_b64);
    if ttl > 0 {
        redis::cmd("SET").arg(key).arg(bytes).arg("EX").arg(ttl).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
    } else {
        redis::cmd("SET").arg(key).arg(bytes).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
    }
}

pub async fn hash_set(client: &redis::Client, db: i64, key: &str, field_b64: &str, value_b64: &str) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    redis::cmd("HSET").arg(key).arg(unb64(field_b64)).arg(unb64(value_b64)).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn hash_delete(client: &redis::Client, db: i64, key: &str, field_b64: &str) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    redis::cmd("HDEL").arg(key).arg(unb64(field_b64)).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn list_set(client: &redis::Client, db: i64, key: &str, index: i64, value_b64: &str) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    redis::cmd("LSET").arg(key).arg(index).arg(unb64(value_b64)).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn list_push(client: &redis::Client, db: i64, key: &str, value_b64: &str, left: bool) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    let cmd = if left { "LPUSH" } else { "RPUSH" };
    redis::cmd(cmd).arg(key).arg(unb64(value_b64)).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn list_remove(client: &redis::Client, db: i64, key: &str, count: i64, value_b64: &str) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    redis::cmd("LREM").arg(key).arg(count).arg(unb64(value_b64)).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn set_add(client: &redis::Client, db: i64, key: &str, member_b64: &str) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    redis::cmd("SADD").arg(key).arg(unb64(member_b64)).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn set_remove(client: &redis::Client, db: i64, key: &str, member_b64: &str) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    redis::cmd("SREM").arg(key).arg(unb64(member_b64)).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn zadd(client: &redis::Client, db: i64, key: &str, member_b64: &str, score: f64) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    redis::cmd("ZADD").arg(key).arg(score).arg(unb64(member_b64)).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn zremove(client: &redis::Client, db: i64, key: &str, member_b64: &str) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    redis::cmd("ZREM").arg(key).arg(unb64(member_b64)).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn stream_add(client: &redis::Client, db: i64, key: &str, id: &str, fields: &BTreeMap<String, String>) -> Result<String, String> {
    let mut c = conn(client, db).await?;
    let mut cmd = redis::cmd("XADD");
    cmd.arg(key).arg(if id.is_empty() { "*" } else { id });
    for (f, v) in fields {
        cmd.arg(f).arg(v);
    }
    cmd.query_async(&mut c).await.map_err(|e| e.to_string())
}

pub async fn stream_delete(client: &redis::Client, db: i64, key: &str, id: &str) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    redis::cmd("XDEL").arg(key).arg(id).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn rename_key(client: &redis::Client, db: i64, old: &str, new: &str) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    redis::cmd("RENAME").arg(old).arg(new).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
}

pub async fn delete_key(client: &redis::Client, db: i64, key: &str) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    let _: i64 = redis::cmd("DEL").arg(key).query_async(&mut c).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn set_ttl(client: &redis::Client, db: i64, key: &str, ttl: i64) -> Result<(), String> {
    let mut c = conn(client, db).await?;
    if ttl < 0 {
        redis::cmd("PERSIST").arg(key).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
    } else {
        redis::cmd("EXPIRE").arg(key).arg(ttl).query_async::<_, ()>(&mut c).await.map_err(|e| e.to_string())
    }
}

// ── Raw command execution ─────────────────────────────────────────────────────

fn tokenize(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_str: Option<char> = None;
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match in_str {
            Some(q) => {
                if c == '\\' {
                    if let Some(n) = chars.next() {
                        cur.push(n);
                    }
                } else if c == q {
                    in_str = None;
                } else {
                    cur.push(c);
                }
            }
            None => match c {
                '"' | '\'' => in_str = Some(c),
                c if c.is_whitespace() => {
                    if !cur.is_empty() {
                        out.push(std::mem::take(&mut cur));
                    }
                }
                _ => cur.push(c),
            },
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

pub async fn exec_command(client: &redis::Client, db: i64, raw: &str) -> CommandResult {
    let toks = tokenize(raw);
    if toks.is_empty() {
        return CommandResult { ok: false, text: String::new(), error: "empty command".into() };
    }
    let mut c = match conn(client, db).await {
        Ok(c) => c,
        Err(e) => return CommandResult { ok: false, text: String::new(), error: e },
    };
    let mut cmd = redis::cmd(&toks[0]);
    for t in &toks[1..] {
        cmd.arg(t);
    }
    match cmd.query_async::<_, redis::Value>(&mut c).await {
        Ok(v) => CommandResult { ok: true, text: render_value(&v, 0), error: String::new() },
        Err(e) => CommandResult { ok: false, text: String::new(), error: e.to_string() },
    }
}

fn value_to_string(v: &redis::Value) -> String {
    match v {
        redis::Value::Nil => String::new(),
        redis::Value::Int(i) => i.to_string(),
        redis::Value::Data(d) => String::from_utf8_lossy(d).to_string(),
        redis::Value::Status(s) => s.clone(),
        redis::Value::Okay => "OK".to_string(),
        redis::Value::Bulk(_) => render_value(v, 0),
    }
}

fn render_value(v: &redis::Value, depth: usize) -> String {
    match v {
        redis::Value::Nil => "(nil)".to_string(),
        redis::Value::Int(i) => format!("(integer) {}", i),
        redis::Value::Data(d) => String::from_utf8_lossy(d).to_string(),
        redis::Value::Status(s) => s.clone(),
        redis::Value::Okay => "OK".to_string(),
        redis::Value::Bulk(items) => {
            let mut out = String::new();
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push('\n');
                }
                out.push_str(&"  ".repeat(depth));
                out.push_str(&format!("{}) {}", i + 1, render_value(item, depth + 1)));
            }
            out
        }
    }
}

// ── Server info / slowlog / clients ───────────────────────────────────────────

pub async fn server_info(client: &redis::Client) -> Result<BTreeMap<String, BTreeMap<String, String>>, String> {
    let mut c = conn(client, 0).await?;
    let text: String = redis::cmd("INFO").query_async(&mut c).await.map_err(|e| e.to_string())?;
    let mut out: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let mut section = "default".to_string();
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(s) = line.strip_prefix('#') {
            section = s.trim().to_string();
            out.entry(section.clone()).or_default();
        } else if let Some((k, v)) = line.split_once(':') {
            out.entry(section.clone()).or_default().insert(k.to_string(), v.to_string());
        }
    }
    Ok(out)
}

pub async fn slowlog(client: &redis::Client, count: i64) -> Result<Vec<SlowLogEntry>, String> {
    let mut c = conn(client, 0).await?;
    let cnt = if count <= 0 { 50 } else { count };
    let val: redis::Value = redis::cmd("SLOWLOG").arg("GET").arg(cnt).query_async(&mut c).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let redis::Value::Bulk(items) = val {
        for item in items {
            if let redis::Value::Bulk(f) = item {
                let id = f.get(0).and_then(as_i64).unwrap_or(0);
                let time = f.get(1).and_then(as_i64).unwrap_or(0);
                let duration = f.get(2).and_then(as_i64).unwrap_or(0);
                let args = match f.get(3) {
                    Some(redis::Value::Bulk(a)) => a.iter().map(value_to_string).collect(),
                    _ => Vec::new(),
                };
                let client = f.get(4).map(value_to_string).unwrap_or_default();
                let name = f.get(5).map(value_to_string).unwrap_or_default();
                out.push(SlowLogEntry { id, time, duration, args, client, name });
            }
        }
    }
    Ok(out)
}

fn as_i64(v: &redis::Value) -> Option<i64> {
    match v {
        redis::Value::Int(i) => Some(*i),
        redis::Value::Data(d) => String::from_utf8_lossy(d).parse().ok(),
        _ => None,
    }
}

pub async fn client_list(client: &redis::Client) -> Result<Vec<String>, String> {
    let mut c = conn(client, 0).await?;
    let text: String = redis::cmd("CLIENT").arg("LIST").query_async(&mut c).await.map_err(|e| e.to_string())?;
    Ok(text.lines().map(|l| l.to_string()).filter(|l| !l.is_empty()).collect())
}

// ── Pub/sub ────────────────────────────────────────────────────────────────────

pub async fn subscribe(
    app: AppHandle,
    state: &AppState,
    _conn_id: &str,
    client: redis::Client,
    channels: Vec<String>,
    patterns: Vec<String>,
) -> Result<String, String> {
    let sub_id = uuid::Uuid::new_v4().to_string();
    let event = format!("redis:message:{}", sub_id);

    #[allow(deprecated)]
    let pubsub_conn = client.get_async_connection().await.map_err(|e| e.to_string())?;
    let mut pubsub = pubsub_conn.into_pubsub();
    for ch in &channels {
        pubsub.subscribe(ch).await.map_err(|e| e.to_string())?;
    }
    for p in &patterns {
        pubsub.psubscribe(p).await.map_err(|e| e.to_string())?;
    }

    let handle = tokio::spawn(async move {
        let mut stream = pubsub.on_message();
        while let Some(msg) = stream.next().await {
            let channel = msg.get_channel_name().to_string();
            let payload: Vec<u8> = msg.get_payload_bytes().to_vec();
            let _ = app.emit(
                &event,
                serde_json::json!({
                    "channel": channel,
                    "payload": b64(&payload),
                }),
            );
        }
    });

    state.redis_subs.lock().await.insert(sub_id.clone(), handle.abort_handle());
    Ok(sub_id)
}

// ── Value decoding ─────────────────────────────────────────────────────────────

pub fn decode_value(data_b64: &str, format: &str) -> DecodeResult {
    let bytes = match B64.decode(data_b64) {
        Ok(b) => b,
        Err(_) => data_b64.as_bytes().to_vec(),
    };
    let ok = |text: String| DecodeResult { ok: true, text, note: String::new(), error: String::new() };
    let note = |text: String, note: String| DecodeResult { ok: true, text, note, error: String::new() };
    let err = |e: String| DecodeResult { ok: false, text: String::new(), note: String::new(), error: e };

    match format {
        "text" | "" => ok(String::from_utf8_lossy(&bytes).to_string()),
        "json" => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(v) => ok(serde_json::to_string_pretty(&v).unwrap_or_default()),
            Err(e) => err(format!("invalid JSON: {e}")),
        },
        "hex" => ok(bytes.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ")),
        "binary" => ok(bytes.iter().map(|b| format!("{:08b}", b)).collect::<Vec<_>>().join(" ")),
        "gzip" => decode_gzip(&bytes).map(ok).unwrap_or_else(err),
        "deflate" => decode_deflate(&bytes).map(ok).unwrap_or_else(err),
        "msgpack" => match rmp_serde::from_slice::<serde_json::Value>(&bytes) {
            Ok(v) => ok(serde_json::to_string_pretty(&v).unwrap_or_default()),
            Err(e) => err(format!("msgpack: {e}")),
        },
        "pickle" => match serde_pickle::from_slice::<serde_json::Value>(&bytes, Default::default()) {
            Ok(v) => ok(serde_json::to_string_pretty(&v).unwrap_or_default()),
            Err(e) => err(format!("pickle: {e}")),
        },
        "php" => match decode_php(&bytes) {
            Ok(v) => ok(v),
            Err(e) => err(e),
        },
        "brotli" | "lz4" | "snappy" | "zstd" | "protobuf" => {
            note(String::from_utf8_lossy(&bytes).to_string(), format!("{format} decoding is not supported in this build"))
        }
        other => err(format!("unknown format: {other}")),
    }
}

fn decode_gzip(bytes: &[u8]) -> Result<String, String> {
    use flate2::read::GzDecoder;
    use std::io::Read;
    let mut d = GzDecoder::new(bytes);
    let mut s = String::new();
    d.read_to_string(&mut s).map_err(|e| e.to_string())?;
    Ok(s)
}

fn decode_deflate(bytes: &[u8]) -> Result<String, String> {
    use flate2::read::ZlibDecoder;
    use std::io::Read;
    let mut d = ZlibDecoder::new(bytes);
    let mut s = String::new();
    if d.read_to_string(&mut s).is_ok() {
        return Ok(s);
    }
    // try raw deflate
    use flate2::read::DeflateDecoder;
    let mut d2 = DeflateDecoder::new(bytes);
    let mut s2 = String::new();
    d2.read_to_string(&mut s2).map_err(|e| e.to_string())?;
    Ok(s2)
}

/// Minimal PHP `serialize()` decoder → readable text (handles s/i/d/b/N/a).
fn decode_php(bytes: &[u8]) -> Result<String, String> {
    let s = String::from_utf8_lossy(bytes);
    let mut pos = 0usize;
    let chars: Vec<char> = s.chars().collect();
    fn parse(chars: &[char], pos: &mut usize) -> Result<String, String> {
        if *pos >= chars.len() {
            return Err("unexpected end".into());
        }
        match chars[*pos] {
            'N' => {
                *pos += 2; // N;
                Ok("null".into())
            }
            'b' => {
                // b:0; or b:1;
                *pos += 2;
                let v = chars[*pos];
                *pos += 2;
                Ok(if v == '1' { "true".into() } else { "false".into() })
            }
            'i' => {
                *pos += 2; // i:
                let mut num = String::new();
                while *pos < chars.len() && chars[*pos] != ';' {
                    num.push(chars[*pos]);
                    *pos += 1;
                }
                *pos += 1;
                Ok(num)
            }
            'd' => {
                *pos += 2;
                let mut num = String::new();
                while *pos < chars.len() && chars[*pos] != ';' {
                    num.push(chars[*pos]);
                    *pos += 1;
                }
                *pos += 1;
                Ok(num)
            }
            's' => {
                *pos += 2; // s:
                let mut len = String::new();
                while *pos < chars.len() && chars[*pos] != ':' {
                    len.push(chars[*pos]);
                    *pos += 1;
                }
                *pos += 2; // :"
                let n: usize = len.parse().unwrap_or(0);
                let val: String = chars[*pos..(*pos + n).min(chars.len())].iter().collect();
                *pos += n + 2; // ";
                Ok(format!("\"{}\"", val))
            }
            'a' => {
                *pos += 2; // a:
                let mut len = String::new();
                while *pos < chars.len() && chars[*pos] != ':' {
                    len.push(chars[*pos]);
                    *pos += 1;
                }
                *pos += 2; // :{
                let n: usize = len.parse().unwrap_or(0);
                let mut parts = Vec::new();
                for _ in 0..n {
                    let k = parse(chars, pos)?;
                    let v = parse(chars, pos)?;
                    parts.push(format!("{}: {}", k, v));
                }
                *pos += 1; // }
                Ok(format!("{{ {} }}", parts.join(", ")))
            }
            other => Err(format!("unsupported PHP token: {other}")),
        }
    }
    parse(&chars, &mut pos)
}
