pub mod mysql;
pub mod postgres;
pub mod sqlite;
pub mod mongodb_driver;
pub mod redis_driver;

use crate::models::ConnectionConfig;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};

/// Build MySQL connect options from config — avoids URL parsing issues with MySQL 8.4+
/// and ensures caching_sha2_password auth works correctly.
pub fn build_mysql_options(config: &ConnectionConfig, password: &str) -> MySqlConnectOptions {
    let user = config.username.as_deref().unwrap_or("root");
    let ssl_mode = if config.use_ssl {
        MySqlSslMode::Required
    } else {
        MySqlSslMode::Disabled
    };

    let mut opts = MySqlConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(user)
        .password(password)
        .ssl_mode(ssl_mode);

    if let Some(ref db) = config.database {
        if !db.is_empty() {
            opts = opts.database(db);
        }
    }

    opts
}


/// Build a PostgreSQL connection URL from config
pub fn build_postgres_url(config: &ConnectionConfig, password: &str) -> String {
    let user = config.username.as_deref().unwrap_or("postgres");
    let db = config.database.as_deref().unwrap_or("postgres");
    format!(
        "postgres://{}:{}@{}:{}/{}",
        urlencoding_encode(user),
        urlencoding_encode(password),
        config.host,
        config.port,
        db
    )
}

/// Build a MongoDB connection URL from config
pub fn build_mongodb_url(config: &ConnectionConfig, password: &str) -> String {
    if let Some(user) = &config.username {
        format!(
            "mongodb://{}:{}@{}:{}/{}?authSource=admin",
            urlencoding_encode(user),
            urlencoding_encode(password),
            config.host,
            config.port,
            config.database.as_deref().unwrap_or("admin")
        )
    } else {
        format!("mongodb://{}:{}", config.host, config.port)
    }
}

/// Build a Redis connection URL from config
pub fn build_redis_url(config: &ConnectionConfig, password: &str) -> String {
    let db_index = config.database.as_deref().unwrap_or("0");
    if password.is_empty() {
        format!("redis://{}:{}/{}", config.host, config.port, db_index)
    } else {
        format!(
            "redis://:{}@{}:{}/{}",
            urlencoding_encode(password),
            config.host,
            config.port,
            db_index
        )
    }
}

fn urlencoding_encode(s: &str) -> String {
    s.chars()
        .flat_map(|c| match c {
            '@' => "%40".chars().collect::<Vec<_>>(),
            ':' => "%3A".chars().collect::<Vec<_>>(),
            '/' => "%2F".chars().collect::<Vec<_>>(),
            '?' => "%3F".chars().collect::<Vec<_>>(),
            '#' => "%23".chars().collect::<Vec<_>>(),
            c => vec![c],
        })
        .collect()
}
