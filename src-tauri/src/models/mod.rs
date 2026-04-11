use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseType {
    Mysql,
    Postgres,
    Sqlite,
    Mongodb,
    Redis,
    SqlServer,
    Clickhouse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SslConfig {
    pub enabled: bool,
    pub ca_cert: Option<String>,
    pub client_cert: Option<String>,
    pub client_key: Option<String>,
    pub verify_server: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub database: Option<String>,
    pub username: Option<String>,
    // Password is stored in keychain, not here
    pub use_ssl: bool,
    pub ssl_config: Option<SslConfig>,
    pub use_ssh_tunnel: bool,
    pub ssh_config: Option<SshConfig>,
    pub connection_timeout_secs: u32,
    pub query_timeout_secs: u32,
    pub color: Option<String>,
    pub group: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl ConnectionConfig {
    pub fn default_port(db_type: &DatabaseType) -> u16 {
        match db_type {
            DatabaseType::Mysql => 3306,
            DatabaseType::Postgres => 5432,
            DatabaseType::Sqlite => 0,
            DatabaseType::Mongodb => 27017,
            DatabaseType::Redis => 6379,
            DatabaseType::SqlServer => 1433,
            DatabaseType::Clickhouse => 8123,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Connecting,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: u64,
    pub affected_rows: u64,
    pub execution_time_ms: u64,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub charset: Option<String>,
    pub collation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub name: String,
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub schema: Option<String>,
    pub row_count: Option<u64>,
    pub size_bytes: Option<u64>,
    pub comment: Option<String>,
    pub table_type: TableType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TableType {
    Table,
    View,
    MaterializedView,
    SystemTable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDetail {
    pub name: String,
    pub data_type: String,
    pub column_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
    pub is_primary_key: bool,
    pub is_auto_increment: bool,
    pub ordinal_position: u32,
    /// Raw MySQL key indicator: "PRI", "UNI", "MUL", or ""
    pub key_type: String,
    /// Extra info: "auto_increment", "on update CURRENT_TIMESTAMP", etc.
    pub extra: String,
    pub char_max_length: Option<u64>,
    pub numeric_precision: Option<u64>,
    pub numeric_scale: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryEntry {
    pub id: String,
    pub connection_id: String,
    pub database: Option<String>,
    pub query: String,
    pub executed_at: DateTime<Utc>,
    pub execution_time_ms: u64,
    pub row_count: u64,
    pub had_error: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Csv,
    Json,
    Xlsx,
    SqlInsert,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub file_path: String,
    pub include_headers: bool,
    pub table_name: Option<String>,
}
