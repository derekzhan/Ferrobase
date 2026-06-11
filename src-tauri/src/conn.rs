//! Backend connection establishment for MySQL, MongoDB, and Redis.

use std::time::Duration;

use mongodb::bson::doc;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::Row;

use crate::models::ConnectionConfig;
use crate::state::Backend;

pub fn normalized_kind(kind: &str) -> &str {
    match kind.to_ascii_lowercase().as_str() {
        "mysql" | "mariadb" => "mysql",
        "mongodb" | "mongo" => "mongodb",
        "redis" => "redis",
        _ => "mysql",
    }
}

/// Open a backend connection and return it alongside the detected server version.
pub async fn open_backend(cfg: &ConnectionConfig) -> Result<(Backend, String), String> {
    match normalized_kind(&cfg.kind) {
        "mysql" => open_mysql(cfg).await,
        "mongodb" => open_mongo(cfg).await,
        "redis" => open_redis(cfg).await,
        other => Err(format!("unsupported connection kind: {other}")),
    }
}

async fn open_mysql(cfg: &ConnectionConfig) -> Result<(Backend, String), String> {
    let port = if cfg.port > 0 { cfg.port as u16 } else { 3306 };
    let mut opts = MySqlConnectOptions::new()
        .host(&cfg.host)
        .port(port)
        .username(&cfg.username);
    if !cfg.password.is_empty() {
        opts = opts.password(&cfg.password);
    }
    if !cfg.database.is_empty() {
        opts = opts.database(&cfg.database);
    }
    opts = opts.ssl_mode(if cfg.tls { MySqlSslMode::Preferred } else { MySqlSslMode::Disabled });

    // Apply advanced params understood by the driver (e.g. charset).
    for p in &cfg.advanced_params {
        if !p.enabled {
            continue;
        }
        match p.key.to_ascii_lowercase().as_str() {
            "charset" => opts = opts.charset(&p.value),
            "timezone" | "time_zone" => opts = opts.timezone(Some(p.value.clone())),
            _ => {}
        }
    }

    let pool = MySqlPoolOptions::new()
        .max_connections(if cfg.max_open_conns > 0 { cfg.max_open_conns as u32 } else { 8 })
        .acquire_timeout(Duration::from_secs(15))
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())?;

    let version: String = sqlx::query("SELECT VERSION()")
        .fetch_one(&pool)
        .await
        .ok()
        .and_then(|r| r.try_get::<String, _>(0).ok())
        .unwrap_or_default();

    Ok((Backend::MySql(pool), version))
}

fn build_mongo_uri(cfg: &ConnectionConfig) -> String {
    // Allow the host field to already be a full connection string.
    let h = cfg.host.trim();
    if h.starts_with("mongodb://") || h.starts_with("mongodb+srv://") {
        return h.to_string();
    }
    let srv = h.contains("+srv") || cfg.port == 0 && h.contains('.') && !h.contains(':') && cfg.tls;
    let scheme = if srv { "mongodb+srv" } else { "mongodb" };

    let mut auth = String::new();
    if !cfg.username.is_empty() {
        let user = urlencode(&cfg.username);
        if cfg.password.is_empty() {
            auth = format!("{}@", user);
        } else {
            auth = format!("{}:{}@", user, urlencode(&cfg.password));
        }
    }

    let hostpart = if srv || cfg.port == 0 {
        cfg.host.clone()
    } else {
        format!("{}:{}", cfg.host, cfg.port)
    };

    let mut params: Vec<String> = Vec::new();
    if !cfg.database.is_empty() {
        // authSource defaults to the target db unless overridden.
    }
    if cfg.tls && !srv {
        params.push("tls=true".into());
    }
    for p in &cfg.advanced_params {
        if p.enabled && !p.key.is_empty() {
            params.push(format!("{}={}", p.key, p.value));
        }
    }
    let dbpart = if cfg.database.is_empty() { String::new() } else { format!("/{}", cfg.database) };
    let query = if params.is_empty() { String::new() } else { format!("?{}", params.join("&")) };
    format!("{}://{}{}{}{}", scheme, auth, hostpart, dbpart, query)
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

async fn open_mongo(cfg: &ConnectionConfig) -> Result<(Backend, String), String> {
    let uri = build_mongo_uri(cfg);
    let mut opts = mongodb::options::ClientOptions::parse(&uri)
        .await
        .map_err(|e| e.to_string())?;
    opts.server_selection_timeout = Some(Duration::from_secs(12));
    opts.connect_timeout = Some(Duration::from_secs(12));
    opts.app_name = Some("Ferrobase".to_string());
    let client = mongodb::Client::with_options(opts).map_err(|e| e.to_string())?;

    // Ping + server version via buildInfo.
    let admin = client.database("admin");
    let info = admin
        .run_command(doc! {"buildInfo": 1})
        .await
        .map_err(|e| e.to_string())?;
    let version = info.get_str("version").unwrap_or("").to_string();
    Ok((Backend::Mongo(client), version))
}

async fn open_redis(cfg: &ConnectionConfig) -> Result<(Backend, String), String> {
    let port = if cfg.port > 0 { cfg.port } else { 6379 };
    let addr = if cfg.tls {
        redis::ConnectionAddr::TcpTls {
            host: cfg.host.clone(),
            port: port as u16,
            insecure: true,
            tls_params: None,
        }
    } else {
        redis::ConnectionAddr::Tcp(cfg.host.clone(), port as u16)
    };
    let db_index: i64 = cfg.database.trim().parse().unwrap_or(0);
    let redis_info = redis::RedisConnectionInfo {
        db: db_index,
        username: if cfg.username.is_empty() { None } else { Some(cfg.username.clone()) },
        password: if cfg.password.is_empty() { None } else { Some(cfg.password.clone()) },
    };
    let info = redis::ConnectionInfo { addr, redis: redis_info };
    let client = redis::Client::open(info).map_err(|e| e.to_string())?;

    // Validate + grab server version from INFO server.
    let mut c = client
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| e.to_string())?;
    let info_text: String = redis::cmd("INFO")
        .arg("server")
        .query_async(&mut c)
        .await
        .map_err(|e| e.to_string())?;
    let version = info_text
        .lines()
        .find_map(|l| l.strip_prefix("redis_version:"))
        .unwrap_or("")
        .trim()
        .to_string();
    Ok((Backend::Redis(client), version))
}
