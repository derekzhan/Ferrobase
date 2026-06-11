//! Live Redis integration test. Runs only when a Redis server is reachable on
//! 127.0.0.1:6379 (skips gracefully otherwise). Exercises the real driver code
//! paths used by the frontend bridge: exec, string/hash/list/set/zset writes +
//! reads (base64 wire contract), scan, server info, and value decoding.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ferrobase_lib::redis_drv;

fn b64(s: &str) -> String {
    B64.encode(s.as_bytes())
}
fn unb64(s: &str) -> String {
    String::from_utf8(B64.decode(s).unwrap()).unwrap()
}

async fn client_or_skip() -> Option<redis::Client> {
    let client = redis::Client::open("redis://127.0.0.1:6379/").ok()?;
    // Quick reachability check.
    let res = redis_drv::exec_command(&client, 0, "PING").await;
    if res.ok {
        Some(client)
    } else {
        eprintln!("skipping: redis not reachable ({})", res.error);
        None
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn redis_string_roundtrip() {
    let Some(client) = client_or_skip().await else { return };
    let db = 15; // use a scratch db
    let key = "ferrobase:it:string";

    redis_drv::delete_key(&client, db, key).await.unwrap();
    redis_drv::set_string(&client, db, key, &b64("hello-世界"), 0).await.unwrap();

    let kv = redis_drv::get_key(&client, db, key).await.unwrap();
    assert_eq!(kv.meta.type_, "string");
    assert_eq!(unb64(kv.str.as_deref().unwrap()), "hello-世界");

    redis_drv::set_ttl(&client, db, key, 100).await.unwrap();
    let kv2 = redis_drv::get_key(&client, db, key).await.unwrap();
    assert!(kv2.meta.ttl > 0 && kv2.meta.ttl <= 100);

    redis_drv::delete_key(&client, db, key).await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn redis_hash_and_scan() {
    let Some(client) = client_or_skip().await else { return };
    let db = 15;
    let key = "ferrobase:it:hash";

    redis_drv::delete_key(&client, db, key).await.unwrap();
    redis_drv::hash_set(&client, db, key, &b64("f1"), &b64("v1")).await.unwrap();
    redis_drv::hash_set(&client, db, key, &b64("f2"), &b64("v2")).await.unwrap();

    let kv = redis_drv::get_key(&client, db, key).await.unwrap();
    assert_eq!(kv.meta.type_, "hash");
    let hash = kv.hash.unwrap();
    assert_eq!(hash.len(), 2);
    let decoded: Vec<(String, String)> = hash.iter().map(|h| (unb64(&h.field), unb64(&h.value))).collect();
    assert!(decoded.contains(&("f1".into(), "v1".into())));

    // SCAN should find the key.
    let scan = redis_drv::scan_keys(&client, db, "ferrobase:it:*", 0, 100).await.unwrap();
    assert!(scan.keys.iter().any(|k| k == key));

    redis_drv::hash_delete(&client, db, key, &b64("f1")).await.unwrap();
    let kv2 = redis_drv::get_key(&client, db, key).await.unwrap();
    assert_eq!(kv2.hash.unwrap().len(), 1);

    redis_drv::delete_key(&client, db, key).await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn redis_zset_and_exec() {
    let Some(client) = client_or_skip().await else { return };
    let db = 15;
    let key = "ferrobase:it:zset";

    redis_drv::delete_key(&client, db, key).await.unwrap();
    redis_drv::zadd(&client, db, key, &b64("alice"), 1.0).await.unwrap();
    redis_drv::zadd(&client, db, key, &b64("bob"), 2.5).await.unwrap();

    let kv = redis_drv::get_key(&client, db, key).await.unwrap();
    assert_eq!(kv.meta.type_, "zset");
    let zset = kv.zset.unwrap();
    assert_eq!(zset.len(), 2);
    assert_eq!(unb64(&zset[0].member), "alice");
    assert_eq!(zset[0].score, 1.0);

    // Raw command execution.
    let res = redis_drv::exec_command(&client, db, &format!("ZCARD {}", key)).await;
    assert!(res.ok, "{}", res.error);
    assert!(res.text.contains('2'));

    redis_drv::delete_key(&client, db, key).await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn redis_server_info_and_decode() {
    let Some(client) = client_or_skip().await else { return };

    let info = redis_drv::server_info(&client).await.unwrap();
    // At least the Server section with redis_version should exist.
    let has_version = info.values().any(|sec| sec.contains_key("redis_version"));
    assert!(has_version, "redis_version missing from INFO");

    // Value decoding: text + json + hex.
    let txt = redis_drv::decode_value(&b64("plain text"), "text");
    assert!(txt.ok && txt.text == "plain text");

    let js = redis_drv::decode_value(&b64("{\"a\":1}"), "json");
    assert!(js.ok && js.text.contains("\"a\""));

    let hex = redis_drv::decode_value(&b64("AB"), "hex");
    assert!(hex.ok && hex.text.replace(' ', "") == "4142");
}
