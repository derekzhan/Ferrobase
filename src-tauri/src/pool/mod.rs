use crate::error::AppError;
use crate::models::{ConnectionConfig, ConnectionStatus};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub enum DatabaseConnection {
    Mysql(sqlx::MySqlPool),
    Postgres(sqlx::PgPool),
    Sqlite(sqlx::SqlitePool),
    Mongodb(mongodb::Client),
    Redis(redis::aio::MultiplexedConnection),
}

pub struct ConnectionEntry {
    pub config: ConnectionConfig,
    pub connection: DatabaseConnection,
    pub status: ConnectionStatus,
}

#[derive(Clone)]
pub struct ConnectionRegistry {
    connections: Arc<RwLock<HashMap<String, ConnectionEntry>>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn add(&self, id: String, entry: ConnectionEntry) {
        let mut map = self.connections.write().await;
        map.insert(id, entry);
    }

    pub async fn remove(&self, id: &str) -> Option<ConnectionEntry> {
        let mut map = self.connections.write().await;
        map.remove(id)
    }

    #[allow(dead_code)]
    pub async fn get_config(&self, id: &str) -> Result<ConnectionConfig, AppError> {
        let map = self.connections.read().await;
        map.get(id)
            .map(|e| e.config.clone())
            .ok_or_else(|| AppError::NotConnected(id.to_string()))
    }

    pub async fn get_status(&self, id: &str) -> ConnectionStatus {
        let map = self.connections.read().await;
        map.get(id)
            .map(|e| e.status.clone())
            .unwrap_or(ConnectionStatus::Disconnected)
    }

    #[allow(dead_code)]
    pub async fn is_connected(&self, id: &str) -> bool {
        let map = self.connections.read().await;
        matches!(
            map.get(id).map(|e| &e.status),
            Some(ConnectionStatus::Connected)
        )
    }

    pub fn connections(&self) -> Arc<RwLock<HashMap<String, ConnectionEntry>>> {
        Arc::clone(&self.connections)
    }
}

impl Default for ConnectionRegistry {
    fn default() -> Self {
        Self::new()
    }
}
