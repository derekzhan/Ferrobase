//! Serde data models that mirror, field-for-field, the JSON shapes the GripLite
//! React frontend expects (see frontend/wailsjs/go/models.ts). Input structs are
//! permissive (`#[serde(default)]`) because a single connection payload may be
//! marshalled from several Go struct variants on the frontend.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─────────────────────────────────────────────────────────────────────────────
// Connection config (unified — accepts driver/database/store variants)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SshConfig {
    pub enabled: bool,
    pub host: String,
    pub port: i64,
    pub user: String,
    pub auth_type: String,
    pub password: String,
    pub private_key_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AdvancedParam {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

/// Unified connection config. Captures every field across the driver/database/
/// store ConnectionConfig variants so any frontend payload deserializes.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub comment: String,
    pub kind: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub password: String,
    pub database: String,
    #[serde(default)]
    pub connect_timeout: i64,
    #[serde(default)]
    pub max_open_conns: i64,
    pub tls: bool,
    /// store/database variants use `ssh`
    #[serde(default)]
    pub ssh: Option<SshConfig>,
    /// driver variant uses `sshTunnel`
    #[serde(default)]
    pub ssh_tunnel: Option<SshConfig>,
    #[serde(default)]
    pub advanced_params: Vec<AdvancedParam>,
    pub read_only: bool,
    #[serde(default)]
    pub color: String,
}

impl ConnectionConfig {
    #[allow(dead_code)]
    pub fn ssh_effective(&self) -> Option<&SshConfig> {
        if let Some(s) = &self.ssh {
            if s.enabled || !s.host.is_empty() {
                return Some(s);
            }
        }
        if let Some(s) = &self.ssh_tunnel {
            if !s.host.is_empty() {
                return Some(s);
            }
        }
        None
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved connection (store namespace)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub comment: String,
    pub kind: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub password: String,
    pub database: String,
    pub tls: bool,
    pub ssh: SshConfig,
    pub advanced_params: Vec<AdvancedParam>,
    pub read_only: bool,
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

impl SavedConnection {
    pub fn to_config(&self) -> ConnectionConfig {
        ConnectionConfig {
            id: self.id.clone(),
            name: self.name.clone(),
            comment: self.comment.clone(),
            kind: self.kind.clone(),
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            password: self.password.clone(),
            database: self.database.clone(),
            connect_timeout: 0,
            max_open_conns: 0,
            tls: self.tls,
            ssh: Some(self.ssh.clone()),
            ssh_tunnel: None,
            advanced_params: self.advanced_params.clone(),
            read_only: self.read_only,
            color: self.color.clone(),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query results
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<Value>>,
    pub row_count: i64,
    pub truncated: bool,
    pub rows_affected: i64,
    pub exec_ms: i64,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

/// ExecResult (database namespace) — used by ExecuteQuery / ExecDML.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub row_count: i64,
    pub truncated: bool,
    pub rows_affected: i64,
    pub time_ms: i64,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub host: String,
    pub port: i64,
    pub database: String,
    pub server_version: String,
    pub connected: bool,
    pub color: String,
    pub read_only: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub connection_id: String,
    pub server_version: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub name: String,
    pub version: String,
    pub build_date: String,
    pub platform: String,
    pub go_version: String,
    pub license: String,
    pub author: String,
    pub email: String,
    pub homepage: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryItem {
    pub id: i64,
    pub conn_id: String,
    pub db_name: String,
    pub sql: String,
    pub exec_ms: i64,
    pub error_msg: String,
    pub executed_at: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableUsageRow {
    pub conn_id: String,
    pub db_name: String,
    pub table_name: String,
    pub count: i64,
    pub last_used_at: i64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema / metadata
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub schema: String,
    pub kind: String,
    pub row_count: i64,
    pub size_bytes: i64,
    pub comment: String,
    pub engine: String,
    pub charset: String,
    pub collation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_increment: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedColumn {
    pub ordinal: i64,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedTableSchema {
    pub found: bool,
    pub conn_id: String,
    pub db_name: String,
    pub table_name: String,
    pub kind: String,
    pub row_count: i64,
    pub size_bytes: i64,
    pub synced_at: String,
    pub comment: String,
    pub engine: String,
    pub charset: String,
    pub collation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_increment: Option<i64>,
    pub columns: Vec<CachedColumn>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedTableEntry {
    pub table_name: String,
    pub engine: String,
    pub size_bytes: i64,
    pub comment: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<CachedColumn>>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub kind: String,
    pub label: String,
    pub detail: String,
    pub db_name: String,
    pub table_name: String,
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub conn_id: String,
    pub state: String,
    pub tables_count: i64,
    pub cols_count: i64,
    pub last_sync_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_msg: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Advanced table properties
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDetail {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub unique: bool,
    pub columns: Vec<String>,
    pub comment: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstraintDetail {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub columns: Vec<String>,
    pub expression: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionDetail {
    pub name: String,
    pub method: String,
    pub expression: String,
    pub description: String,
    pub rows: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyDetail {
    pub name: String,
    pub columns: Vec<String>,
    pub ref_schema: String,
    pub ref_table: String,
    pub ref_columns: Vec<String>,
    pub on_delete: String,
    pub on_update: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceDetail {
    pub name: String,
    pub from_schema: String,
    pub from_table: String,
    pub from_cols: Vec<String>,
    pub to_cols: Vec<String>,
    pub on_delete: String,
    pub on_update: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerDetail {
    pub name: String,
    pub event: String,
    pub timing: String,
    pub statement: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedTableProperties {
    pub schema: String,
    pub table: String,
    pub ddl: String,
    pub indexes: Vec<IndexDetail>,
    pub constraints: Vec<ConstraintDetail>,
    pub partitions: Vec<PartitionDetail>,
    pub foreign_keys: Vec<ForeignKeyDetail>,
    pub references: Vec<ReferenceDetail>,
    pub triggers: Vec<TriggerDetail>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub return_type: String,
    pub comment: String,
    pub created: String,
    pub modified: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInfo {
    pub name: String,
    pub status: String,
    pub schedule: String,
    pub comment: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema-change requests (table / index / constraint / partition alters)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ColumnDraft {
    pub original_name: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub not_null: bool,
    pub auto_increment: bool,
    pub default: String,
    pub has_default: bool,
    pub comment: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TableInfoDraft {
    pub name: String,
    pub engine: String,
    pub collation: String,
    pub charset: String,
    pub auto_increment: Option<i64>,
    pub comment: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SchemaChangeRequest {
    pub schema: String,
    pub table: String,
    pub original_info: TableInfoDraft,
    pub updated_info: TableInfoDraft,
    pub old_columns: Vec<ColumnDraft>,
    pub new_columns: Vec<ColumnDraft>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IndexDraft {
    pub original_name: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub unique: bool,
    pub columns: Vec<String>,
    pub comment: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IndexChangeRequest {
    pub schema: String,
    pub table: String,
    pub old_indexes: Vec<IndexDraft>,
    pub new_indexes: Vec<IndexDraft>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConstraintDraft {
    pub original_name: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub columns: Vec<String>,
    pub expression: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConstraintChangeRequest {
    pub schema: String,
    pub table: String,
    pub old_constraints: Vec<ConstraintDraft>,
    pub new_constraints: Vec<ConstraintDraft>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PartitionDraft {
    pub original_name: String,
    pub name: String,
    pub definition: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PartitionChangeRequest {
    pub schema: String,
    pub table: String,
    pub old_partitions: Vec<PartitionDraft>,
    pub new_partitions: Vec<PartitionDraft>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaChangeStatement {
    pub kind: String,
    pub summary: String,
    pub sql: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaChangePreview {
    pub statements: Vec<SchemaChangeStatement>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaChangeResult {
    pub success: bool,
    pub executed_count: i64,
    pub statements: Vec<SchemaChangeStatement>,
    pub failed_index: i64,
    pub failed_statement: String,
    pub error: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline edit / apply changes
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChangeSet {
    pub connection_id: String,
    pub database: String,
    pub table_name: String,
    pub primary_key: String,
    pub deleted_ids: Vec<Value>,
    pub added_rows: Vec<Value>,
    pub edited_rows: Vec<Value>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub deleted_count: i64,
    pub inserted_count: i64,
    pub updated_count: i64,
    pub time_ms: i64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub statements: Vec<String>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy table / database
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CopyTableConfig {
    pub source_conn_id: String,
    pub source_db: String,
    pub source_table: String,
    pub target_conn_id: String,
    pub target_db: String,
    pub target_table: String,
    pub copy_structure: bool,
    pub copy_data: bool,
    pub drop_target_if_exists: bool,
    pub batch_size: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CopyDatabaseConfig {
    pub source_conn_id: String,
    pub source_db: String,
    pub target_conn_id: String,
    pub target_db: String,
    pub copy_structure: bool,
    pub copy_data: bool,
    pub drop_target_if_exists: bool,
    pub batch_size: i64,
    pub scope: String,
    pub tables: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub success: bool,
    pub time_ms: i64,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyProgress {
    pub status: String,
    pub processed_rows: i64,
    pub total_rows: i64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyMeta {
    pub key: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub ttl: i64,
    pub size_bytes: i64,
    pub encoding: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct HashField {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ZMember {
    pub member: String,
    pub score: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct StreamEntry {
    pub id: String,
    pub fields: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct KeyValue {
    pub meta: KeyMeta,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub str: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<Vec<HashField>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub set: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zset: Option<Vec<ZMember>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<Vec<StreamEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub keys: Vec<String>,
    pub next_cursor: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CommandResult {
    pub ok: bool,
    pub text: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DecodeResult {
    pub ok: bool,
    pub text: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub note: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct SlowLogEntry {
    pub id: i64,
    pub time: i64,
    pub duration: i64,
    pub args: Vec<String>,
    pub client: String,
    pub name: String,
}
