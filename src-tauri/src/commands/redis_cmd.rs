use tauri::State;
use crate::pool::{ConnectionRegistry, DatabaseConnection};
use crate::error::AppError;
use crate::db::redis_driver::{self, RedisKeyInfo, RedisValue};

/// Extract a cloned Redis connection from the registry, dropping the lock before any `.await`.
/// `MultiplexedConnection` is internally multiplexed so cloning is cheap and safe.
async fn get_redis_conn(
    connection_id: &str,
    registry: &State<'_, ConnectionRegistry>,
) -> std::result::Result<redis::aio::MultiplexedConnection, AppError> {
    let connections = registry.connections();
    let map = connections.read().await;
    let entry = map
        .get(connection_id)
        .ok_or_else(|| AppError::NotConnected(connection_id.to_string()))?;
    match &entry.connection {
        DatabaseConnection::Redis(conn) => Ok(conn.clone()),
        _ => Err(AppError::UnsupportedOperation(
            "Not a Redis connection".to_string(),
        )),
    }
}

#[tauri::command]
pub async fn list_keys(
    connection_id: String,
    pattern: Option<String>,
    count: Option<usize>,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<RedisKeyInfo>, AppError> {
    let mut conn = get_redis_conn(&connection_id, &registry).await?;
    let pat = pattern.as_deref().unwrap_or("*");
    let cnt = count.unwrap_or(1000);
    redis_driver::list_keys(&mut conn, pat, cnt).await
}

#[tauri::command]
pub async fn get_key(
    connection_id: String,
    key: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<RedisValue, AppError> {
    let mut conn = get_redis_conn(&connection_id, &registry).await?;
    redis_driver::get_key(&mut conn, &key).await
}

#[tauri::command]
pub async fn set_key(
    connection_id: String,
    key: String,
    value: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<(), AppError> {
    let mut conn = get_redis_conn(&connection_id, &registry).await?;
    redis_driver::set_key(&mut conn, &key, &value).await
}

#[tauri::command]
pub async fn delete_key(
    connection_id: String,
    key: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<u64, AppError> {
    let mut conn = get_redis_conn(&connection_id, &registry).await?;
    redis_driver::delete_key(&mut conn, &key).await
}

#[tauri::command]
pub async fn get_key_ttl(
    connection_id: String,
    key: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<i64, AppError> {
    let mut conn = get_redis_conn(&connection_id, &registry).await?;
    use redis::AsyncCommands;
    conn.ttl(&key).await.map_err(|e| AppError::Query(e.to_string()))
}

#[tauri::command]
pub async fn set_key_ttl(
    connection_id: String,
    key: String,
    ttl_secs: i64,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<(), AppError> {
    let mut conn = get_redis_conn(&connection_id, &registry).await?;
    use redis::AsyncCommands;
    if ttl_secs < 0 {
        let _: () = conn.persist(&key).await.map_err(|e| AppError::Query(e.to_string()))?;
    } else {
        let _: () = conn.expire(&key, ttl_secs).await.map_err(|e| AppError::Query(e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_server_info(
    connection_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<serde_json::Value, AppError> {
    let mut conn = get_redis_conn(&connection_id, &registry).await?;
    redis_driver::get_server_info(&mut conn).await
}

#[tauri::command]
pub async fn execute_redis_command(
    connection_id: String,
    args: Vec<String>,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<serde_json::Value, AppError> {
    let mut conn = get_redis_conn(&connection_id, &registry).await?;
    redis_driver::execute_raw_command(&mut conn, args).await
}
