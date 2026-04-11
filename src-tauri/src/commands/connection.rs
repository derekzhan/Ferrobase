use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;

use crate::pool::{ConnectionRegistry, ConnectionEntry, DatabaseConnection};
use crate::models::{ConnectionConfig, ConnectionStatus, DatabaseType};
use crate::error::{AppError, Result};
use crate::db;

// Local config storage (in-memory, persisted to app data dir on disk)
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

static CONFIGS: Lazy<Arc<RwLock<HashMap<String, ConnectionConfig>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

const CONNECTIONS_FILE: &str = "connections.json";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConnectionInput {
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub use_ssl: bool,
    pub use_ssh_tunnel: bool,
    pub ssh_config: Option<crate::models::SshConfig>,
    pub connection_timeout_secs: Option<u32>,
    pub query_timeout_secs: Option<u32>,
    pub color: Option<String>,
    pub group: Option<String>,
}

fn store_password(connection_id: &str, password: &str) -> Result<()> {
    let entry = keyring::Entry::new("ferrobase", connection_id)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    entry.set_password(password)
        .map_err(|e| AppError::Keyring(e.to_string()))
}

fn get_password(connection_id: &str) -> Result<String> {
    let entry = keyring::Entry::new("ferrobase", connection_id)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    entry.get_password()
        .map_err(|e| AppError::Keyring(e.to_string()))
}

fn delete_password(connection_id: &str) -> Result<()> {
    let entry = keyring::Entry::new("ferrobase", connection_id)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    let _ = entry.delete_password();
    Ok(())
}

async fn save_connections_to_disk(app: &tauri::AppHandle) -> Result<()> {
    use tauri::Manager;
    let data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;

    std::fs::create_dir_all(&data_dir)?;

    let config_file = data_dir.join(CONNECTIONS_FILE);
    let configs = CONFIGS.read().await;
    let list: Vec<&ConnectionConfig> = configs.values().collect();
    let content = serde_json::to_string_pretty(&list)?;
    std::fs::write(&config_file, content)?;
    Ok(())
}

pub async fn load_connections_from_disk(app: &tauri::AppHandle) -> Result<()> {
    use tauri::Manager;
    let data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;

    let config_file = data_dir.join(CONNECTIONS_FILE);
    if !config_file.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&config_file)?;
    let saved: Vec<ConnectionConfig> = serde_json::from_str(&content)?;

    let mut configs = CONFIGS.write().await;
    for conn in saved {
        configs.insert(conn.id.clone(), conn);
    }
    Ok(())
}

#[tauri::command]
pub async fn create_connection(
    app: tauri::AppHandle,
    input: CreateConnectionInput,
) -> std::result::Result<ConnectionConfig, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now();

    let port = if input.port == 0 {
        ConnectionConfig::default_port(&input.db_type)
    } else {
        input.port
    };

    let config = ConnectionConfig {
        id: id.clone(),
        name: input.name,
        db_type: input.db_type,
        host: input.host,
        port,
        database: input.database,
        username: input.username,
        use_ssl: input.use_ssl,
        ssl_config: None,
        use_ssh_tunnel: input.use_ssh_tunnel,
        ssh_config: input.ssh_config,
        connection_timeout_secs: input.connection_timeout_secs.unwrap_or(30),
        query_timeout_secs: input.query_timeout_secs.unwrap_or(60),
        color: input.color,
        group: input.group,
        created_at: now,
        updated_at: now,
    };

    if let Some(ref password) = input.password {
        if !password.is_empty() {
            store_password(&id, password)?;
        }
    }

    {
        let mut configs = CONFIGS.write().await;
        configs.insert(id.clone(), config.clone());
    }

    let _ = save_connections_to_disk(&app).await;

    Ok(config)
}

#[tauri::command]
pub async fn update_connection(
    app: tauri::AppHandle,
    id: String,
    input: CreateConnectionInput,
) -> std::result::Result<ConnectionConfig, AppError> {
    let existing = {
        let configs = CONFIGS.read().await;
        configs
            .get(&id)
            .ok_or_else(|| AppError::ConnectionNotFound(id.clone()))?
            .clone()
    };

    let port = if input.port == 0 {
        ConnectionConfig::default_port(&input.db_type)
    } else {
        input.port
    };

    let updated = ConnectionConfig {
        id: id.clone(),
        name: input.name,
        db_type: input.db_type,
        host: input.host,
        port,
        database: input.database,
        username: input.username,
        use_ssl: input.use_ssl,
        ssl_config: None,
        use_ssh_tunnel: input.use_ssh_tunnel,
        ssh_config: input.ssh_config,
        connection_timeout_secs: input.connection_timeout_secs.unwrap_or(30),
        query_timeout_secs: input.query_timeout_secs.unwrap_or(60),
        color: input.color,
        group: input.group,
        created_at: existing.created_at,
        updated_at: Utc::now(),
    };

    // Only update password if a non-empty password was provided
    if let Some(ref password) = input.password {
        if !password.is_empty() {
            store_password(&id, password)?;
        }
    }

    {
        let mut configs = CONFIGS.write().await;
        configs.insert(id, updated.clone());
    }

    let _ = save_connections_to_disk(&app).await;

    Ok(updated)
}

#[tauri::command]
pub async fn delete_connection(
    app: tauri::AppHandle,
    id: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<(), AppError> {
    // Disconnect if connected
    registry.remove(&id).await;
    let _ = delete_password(&id);

    {
        let mut configs = CONFIGS.write().await;
        configs.remove(&id);
    }

    let _ = save_connections_to_disk(&app).await;

    Ok(())
}

#[tauri::command]
pub async fn list_connections() -> std::result::Result<Vec<ConnectionConfig>, AppError> {
    let configs = CONFIGS.read().await;
    let mut list: Vec<ConnectionConfig> = configs.values().cloned().collect();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(list)
}

#[tauri::command]
pub async fn test_connection(
    input: CreateConnectionInput,
) -> std::result::Result<(), AppError> {
    let password = input.password.unwrap_or_default();
    let config = ConnectionConfig {
        id: "test".to_string(),
        name: input.name,
        db_type: input.db_type.clone(),
        host: input.host.clone(),
        port: input.port,
        database: input.database.clone(),
        username: input.username.clone(),
        use_ssl: input.use_ssl,
        ssl_config: None,
        use_ssh_tunnel: input.use_ssh_tunnel,
        ssh_config: input.ssh_config,
        connection_timeout_secs: input.connection_timeout_secs.unwrap_or(10),
        query_timeout_secs: input.query_timeout_secs.unwrap_or(30),
        color: None,
        group: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    match config.db_type {
        DatabaseType::Mysql => {
            let opts = db::build_mysql_options(&config, &password);
            db::mysql::test_connection(opts).await
        }
        DatabaseType::Postgres => {
            let url = db::build_postgres_url(&config, &password);
            db::postgres::test_connection(&url).await
        }
        DatabaseType::Sqlite => {
            let path = config.host.clone();
            let pool = db::sqlite::connect(&path, 1).await?;
            pool.close().await;
            Ok(())
        }
        DatabaseType::Mongodb => {
            let url = db::build_mongodb_url(&config, &password);
            let client = db::mongodb_driver::connect(&url, config.connection_timeout_secs).await?;
            db::mongodb_driver::test_connection(&client).await
        }
        DatabaseType::Redis => {
            let url = db::build_redis_url(&config, &password);
            let mut conn = db::redis_driver::connect(&url).await?;
            db::redis_driver::test_connection(&mut conn).await
        }
        _ => Err(AppError::UnsupportedOperation(format!(
            "{:?} test connection not yet implemented",
            config.db_type
        ))),
    }
}

#[tauri::command]
pub async fn connect(
    id: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<(), AppError> {
    let config = {
        let configs = CONFIGS.read().await;
        configs
            .get(&id)
            .ok_or_else(|| AppError::ConnectionNotFound(id.clone()))?
            .clone()
    };

    let password = get_password(&id).unwrap_or_default();

    let connection = match &config.db_type {
        DatabaseType::Mysql => {
            let opts = db::build_mysql_options(&config, &password);
            let pool = db::mysql::connect(opts, 10, config.connection_timeout_secs).await?;
            DatabaseConnection::Mysql(pool)
        }
        DatabaseType::Postgres => {
            let url = db::build_postgres_url(&config, &password);
            let pool = db::postgres::connect(&url, 10, config.connection_timeout_secs).await?;
            DatabaseConnection::Postgres(pool)
        }
        DatabaseType::Sqlite => {
            let path = &config.host;
            let pool = db::sqlite::connect(path, 5).await?;
            DatabaseConnection::Sqlite(pool)
        }
        DatabaseType::Mongodb => {
            let url = db::build_mongodb_url(&config, &password);
            let client = db::mongodb_driver::connect(&url, config.connection_timeout_secs).await?;
            DatabaseConnection::Mongodb(client)
        }
        DatabaseType::Redis => {
            let url = db::build_redis_url(&config, &password);
            let conn = db::redis_driver::connect(&url).await?;
            DatabaseConnection::Redis(conn)
        }
        _ => {
            return Err(AppError::UnsupportedOperation(format!(
                "{:?} not yet implemented",
                config.db_type
            )))
        }
    };

    registry
        .add(
            id,
            ConnectionEntry {
                config,
                connection,
                status: ConnectionStatus::Connected,
            },
        )
        .await;

    Ok(())
}

#[tauri::command]
pub async fn disconnect(
    id: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<(), AppError> {
    registry.remove(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn get_connection_status(
    id: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<ConnectionStatus, AppError> {
    Ok(registry.get_status(&id).await)
}

#[tauri::command]
pub async fn clone_connection(
    app: tauri::AppHandle,
    connection_id: String,
) -> std::result::Result<ConnectionConfig, AppError> {
    let existing = {
        let configs = CONFIGS.read().await;
        configs
            .get(&connection_id)
            .ok_or_else(|| AppError::ConnectionNotFound(connection_id.clone()))?
            .clone()
    };

    let new_id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let new_config = ConnectionConfig {
        id: new_id.clone(),
        name: format!("{} (copy)", existing.name),
        created_at: now,
        updated_at: now,
        ..existing
    };

    // Copy password to new keyring entry
    if let Ok(pw) = get_password(&connection_id) {
        let _ = store_password(&new_id, &pw);
    }

    {
        let mut configs = CONFIGS.write().await;
        configs.insert(new_id, new_config.clone());
    }

    let _ = save_connections_to_disk(&app).await;
    Ok(new_config)
}
