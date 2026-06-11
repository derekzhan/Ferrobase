//! Shared application state: live connections, local SQLite store, and the
//! bookkeeping maps for query cancellation, copy jobs, and Redis subscriptions.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};
use tokio::task::AbortHandle;

use crate::models::ConnectionConfig;

/// A live backend handle. All three underlying clients are cheaply cloneable
/// and `Send + Sync`, so callers clone the backend out from under the lock and
/// operate without holding it.
#[derive(Clone)]
pub enum Backend {
    MySql(sqlx::MySqlPool),
    Mongo(mongodb::Client),
    Redis(redis::Client),
}

#[derive(Clone)]
pub struct LiveConn {
    pub backend: Backend,
    pub config: ConnectionConfig,
    pub server_version: String,
}

pub struct AppState {
    /// Live, opened connections keyed by connection id.
    pub conns: RwLock<HashMap<String, LiveConn>>,
    /// Local SQLite store (saved connections, history, metadata cache).
    pub store: sqlx::SqlitePool,
    /// Absolute path of the local SQLite database.
    pub db_path: String,
    /// In-flight query cancellation handles keyed by query id.
    pub query_cancels: Mutex<HashMap<String, AbortHandle>>,
    /// Live Redis pub/sub subscriptions keyed by subscription id.
    pub redis_subs: Mutex<HashMap<String, AbortHandle>>,
    /// Cancellation flag for the currently running copy job.
    pub copy_cancel: Arc<std::sync::atomic::AtomicBool>,
    /// Background metadata sync state keyed by connection id.
    pub sync_states: RwLock<HashMap<String, crate::models::SyncStatus>>,
}

impl AppState {
    pub fn new(store: sqlx::SqlitePool, db_path: String) -> Self {
        Self {
            conns: RwLock::new(HashMap::new()),
            store,
            db_path,
            query_cancels: Mutex::new(HashMap::new()),
            redis_subs: Mutex::new(HashMap::new()),
            copy_cancel: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            sync_states: RwLock::new(HashMap::new()),
        }
    }

    /// Look up a live connection's backend by id (cloned out of the lock).
    pub async fn backend(&self, conn_id: &str) -> Option<Backend> {
        self.conns.read().await.get(conn_id).map(|c| c.backend.clone())
    }

    #[allow(dead_code)]
    pub async fn live(&self, conn_id: &str) -> Option<LiveConn> {
        self.conns.read().await.get(conn_id).cloned()
    }

    pub async fn mysql_pool(&self, conn_id: &str) -> Result<sqlx::MySqlPool, String> {
        match self.backend(conn_id).await {
            Some(Backend::MySql(p)) => Ok(p),
            Some(_) => Err(format!("connection {conn_id} is not a MySQL connection")),
            None => Err(format!("connection {conn_id} is not open")),
        }
    }

    pub async fn mongo_client(&self, conn_id: &str) -> Result<mongodb::Client, String> {
        match self.backend(conn_id).await {
            Some(Backend::Mongo(c)) => Ok(c),
            Some(_) => Err(format!("connection {conn_id} is not a MongoDB connection")),
            None => Err(format!("connection {conn_id} is not open")),
        }
    }

    pub async fn redis_client(&self, conn_id: &str) -> Result<redis::Client, String> {
        match self.backend(conn_id).await {
            Some(Backend::Redis(c)) => Ok(c),
            Some(_) => Err(format!("connection {conn_id} is not a Redis connection")),
            None => Err(format!("connection {conn_id} is not open")),
        }
    }
}
