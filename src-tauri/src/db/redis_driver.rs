use redis::{aio::MultiplexedConnection, AsyncCommands, Client};
use serde::{Deserialize, Serialize};
use crate::error::{AppError, Result};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyInfo {
    pub key: String,
    pub key_type: String,
    pub ttl: i64,
    pub encoding: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum RedisValue {
    String(String),
    List(Vec<String>),
    Set(Vec<String>),
    ZSet(Vec<(String, f64)>),
    Hash(Vec<(String, String)>),
    Stream(Vec<serde_json::Value>),
    None,
}

pub async fn connect(url: &str) -> Result<MultiplexedConnection> {
    let client = Client::open(url)
        .map_err(|e| AppError::Connection(e.to_string()))?;
    client
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| AppError::Connection(e.to_string()))
}

pub async fn test_connection(conn: &mut MultiplexedConnection) -> Result<()> {
    let _: String = redis::cmd("PING")
        .query_async(conn)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
    Ok(())
}

pub async fn list_keys(
    conn: &mut MultiplexedConnection,
    pattern: &str,
    count: usize,
) -> Result<Vec<RedisKeyInfo>> {
    let keys: Vec<String> = conn
        .keys(pattern)
        .await
        .map_err(|e| AppError::Query(e.to_string()))?;

    let keys: Vec<String> = keys.into_iter().take(count).collect();
    let mut result = Vec::new();

    for key in keys {
        let key_type: String = redis::cmd("TYPE")
            .arg(&key)
            .query_async(conn)
            .await
            .unwrap_or_else(|_| "none".to_string());

        let ttl: i64 = conn
            .ttl(&key)
            .await
            .unwrap_or(-1);

        result.push(RedisKeyInfo {
            key,
            key_type,
            ttl,
            encoding: None,
        });
    }

    Ok(result)
}

pub async fn get_key(conn: &mut MultiplexedConnection, key: &str) -> Result<RedisValue> {
    let key_type: String = redis::cmd("TYPE")
        .arg(key)
        .query_async(conn)
        .await
        .map_err(|e| AppError::Query(e.to_string()))?;

    match key_type.as_str() {
        "string" => {
            let val: String = conn
                .get(key)
                .await
                .map_err(|e| AppError::Query(e.to_string()))?;
            Ok(RedisValue::String(val))
        }
        "list" => {
            let vals: Vec<String> = conn
                .lrange(key, 0, -1)
                .await
                .map_err(|e| AppError::Query(e.to_string()))?;
            Ok(RedisValue::List(vals))
        }
        "set" => {
            let vals: Vec<String> = conn
                .smembers(key)
                .await
                .map_err(|e| AppError::Query(e.to_string()))?;
            Ok(RedisValue::Set(vals))
        }
        "zset" => {
            let vals: Vec<(String, f64)> = conn
                .zrange_withscores(key, 0, -1)
                .await
                .map_err(|e| AppError::Query(e.to_string()))?;
            Ok(RedisValue::ZSet(vals))
        }
        "hash" => {
            let vals: Vec<(String, String)> = conn
                .hgetall(key)
                .await
                .map_err(|e| AppError::Query(e.to_string()))?;
            Ok(RedisValue::Hash(vals))
        }
        "none" => Ok(RedisValue::None),
        _ => Ok(RedisValue::String(format!("[unsupported type: {}]", key_type))),
    }
}

pub async fn set_key(conn: &mut MultiplexedConnection, key: &str, value: &str) -> Result<()> {
    conn.set(key, value)
        .await
        .map_err(|e| AppError::Query(e.to_string()))
}

pub async fn delete_key(conn: &mut MultiplexedConnection, key: &str) -> Result<u64> {
    conn.del(key)
        .await
        .map_err(|e| AppError::Query(e.to_string()))
}

pub async fn get_server_info(conn: &mut MultiplexedConnection) -> Result<serde_json::Value> {
    let info: String = redis::cmd("INFO")
        .query_async(conn)
        .await
        .map_err(|e| AppError::Query(e.to_string()))?;

    let mut result = serde_json::Map::new();
    let mut section = String::new();

    for line in info.lines() {
        if line.starts_with('#') {
            section = line.trim_start_matches('#').trim().to_lowercase();
        } else if let Some((key, val)) = line.split_once(':') {
            result.insert(
                format!("{}/{}", section, key.trim()),
                serde_json::Value::String(val.trim().to_string()),
            );
        }
    }

    Ok(serde_json::Value::Object(result))
}

pub async fn execute_raw_command(
    conn: &mut MultiplexedConnection,
    args: Vec<String>,
) -> Result<serde_json::Value> {
    if args.is_empty() {
        return Err(AppError::Query("Empty command".to_string()));
    }

    let mut cmd = redis::cmd(&args[0]);
    for arg in args.iter().skip(1) {
        cmd.arg(arg);
    }

    let result: redis::Value = cmd
        .query_async(conn)
        .await
        .map_err(|e| AppError::Query(e.to_string()))?;

    Ok(redis_value_to_json(result))
}

fn redis_value_to_json(val: redis::Value) -> serde_json::Value {
    match val {
        redis::Value::Nil => serde_json::Value::Null,
        redis::Value::Int(i) => serde_json::Value::Number(i.into()),
        redis::Value::Data(bytes) => {
            serde_json::Value::String(String::from_utf8_lossy(&bytes).to_string())
        }
        redis::Value::Bulk(vals) => {
            serde_json::Value::Array(vals.into_iter().map(redis_value_to_json).collect())
        }
        redis::Value::Status(s) => serde_json::Value::String(s),
        redis::Value::Okay => serde_json::Value::String("OK".to_string()),
    }
}
