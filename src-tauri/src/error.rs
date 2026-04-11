use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, Serialize, Deserialize, Clone)]
#[serde(tag = "type", content = "message")]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Query error: {0}")]
    Query(String),

    #[error("Connection not found: {0}")]
    ConnectionNotFound(String),

    #[error("Not connected: {0}")]
    NotConnected(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Keyring error: {0}")]
    Keyring(String),

    #[error("Unsupported operation: {0}")]
    UnsupportedOperation(String),

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Timeout: {0}")]
    Timeout(String),

    #[error("Export error: {0}")]
    Export(String),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<mongodb::error::Error> for AppError {
    fn from(e: mongodb::error::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<redis::RedisError> for AppError {
    fn from(e: redis::RedisError) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Serialization(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
