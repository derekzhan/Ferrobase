use chrono::Utc;
use mongodb::bson::Document;
use once_cell::sync::Lazy;
use std::collections::VecDeque;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::db;
use crate::error::AppError;
use crate::models::{ColumnInfo, QueryHistoryEntry, QueryResult};
use crate::pool::{ConnectionRegistry, DatabaseConnection};

const MAX_HISTORY: usize = 500;

static QUERY_HISTORY: Lazy<Arc<RwLock<VecDeque<QueryHistoryEntry>>>> =
    Lazy::new(|| Arc::new(RwLock::new(VecDeque::new())));

async fn add_to_history(entry: QueryHistoryEntry) {
    let mut history = QUERY_HISTORY.write().await;
    history.push_front(entry);
    if history.len() > MAX_HISTORY {
        history.pop_back();
    }
}

// ── MongoDB shell syntax parser ────────────────────────────────────────────

struct MongoFind {
    collection: String,
    filter: Option<Document>,
    projection: Option<Document>,
    sort: Option<Document>,
    limit: i64,
    skip: i64,
}

struct MongoAggregate {
    collection: String,
    pipeline: Vec<Document>,
    limit: Option<i64>,
    skip: Option<i64>,
}

enum MongoStatement {
    Find(MongoFind),
    Aggregate(MongoAggregate),
}

/// Try to parse shell-style MongoDB syntax like:
/// - `db.collection.find({ filter }).sort({ createdAt: -1 }).limit(100)`
/// - `db.collection.aggregate([{ $match: { status: 'open' } }]).limit(50)`
fn parse_mongo_statement(stmt: &str) -> Option<MongoStatement> {
    let s = stmt.trim();

    if !s.starts_with("db.") {
        return None;
    }

    let after_db = &s[3..];

    // Extract collection name (up to next '.')
    let dot = after_db.find('.')?;
    let collection = after_db[..dot].to_string();
    let after_collection = &after_db[dot + 1..];

    if let Some(after_find) = after_collection.strip_prefix("findOne(") {
        let filter_end = db::mongodb_driver::find_shell_close_paren(after_find)?;
        let filter_str = after_find[..filter_end].trim();
        let chain = after_find[filter_end + 1..].to_string();

        return Some(MongoStatement::Find(MongoFind {
            collection,
            filter: db::mongodb_driver::parse_shell_document(filter_str),
            projection: db::mongodb_driver::extract_shell_chain_arg(&chain, "project")
                .and_then(|arg| db::mongodb_driver::parse_shell_document(&arg)),
            sort: db::mongodb_driver::extract_shell_chain_arg(&chain, "sort")
                .and_then(|arg| db::mongodb_driver::parse_shell_document(&arg)),
            limit: 1,
            skip: db::mongodb_driver::extract_shell_chain_int(&chain, "skip").unwrap_or(0),
        }));
    }

    if let Some(after_find) = after_collection.strip_prefix("find(") {
        let filter_end = db::mongodb_driver::find_shell_close_paren(after_find)?;
        let filter_str = after_find[..filter_end].trim();
        let chain = after_find[filter_end + 1..].to_string();

        return Some(MongoStatement::Find(MongoFind {
            collection,
            filter: db::mongodb_driver::parse_shell_document(filter_str),
            projection: db::mongodb_driver::extract_shell_chain_arg(&chain, "project")
                .and_then(|arg| db::mongodb_driver::parse_shell_document(&arg)),
            sort: db::mongodb_driver::extract_shell_chain_arg(&chain, "sort")
                .and_then(|arg| db::mongodb_driver::parse_shell_document(&arg)),
            limit: db::mongodb_driver::extract_shell_chain_int(&chain, "limit").unwrap_or(100),
            skip: db::mongodb_driver::extract_shell_chain_int(&chain, "skip").unwrap_or(0),
        }));
    }

    if let Some(after_aggregate) = after_collection.strip_prefix("aggregate(") {
        let pipeline_end = db::mongodb_driver::find_shell_close_paren(after_aggregate)?;
        let pipeline_str = after_aggregate[..pipeline_end].trim();
        let chain = after_aggregate[pipeline_end + 1..].to_string();
        let pipeline = db::mongodb_driver::parse_shell_pipeline(pipeline_str)?;

        return Some(MongoStatement::Aggregate(MongoAggregate {
            collection,
            pipeline,
            limit: db::mongodb_driver::extract_shell_chain_int(&chain, "limit"),
            skip: db::mongodb_driver::extract_shell_chain_int(&chain, "skip"),
        }));
    }

    None
}

fn docs_to_query_result(docs: &[serde_json::Value], query_str: &str) -> QueryResult {
    let mut all_keys: Vec<String> = Vec::new();
    let mut key_set = std::collections::HashSet::new();
    for doc in docs {
        if let serde_json::Value::Object(map) = doc {
            for k in map.keys() {
                if key_set.insert(k.clone()) {
                    all_keys.push(k.clone());
                }
            }
        }
    }

    let columns: Vec<ColumnInfo> = all_keys
        .iter()
        .map(|k| {
            let inferred_type = docs
                .iter()
                .filter_map(|doc| match doc {
                    serde_json::Value::Object(map) => map.get(k),
                    _ => None,
                })
                .map(db::mongodb_driver::mongo_value_type_name)
                .fold(None::<String>, |current, next| {
                    let merged = match current {
                        None => next.to_string(),
                        Some(existing) if existing == next || next == "null" => existing,
                        Some(existing) if existing == "null" => next.to_string(),
                        Some(existing) if existing == "int" && next == "long" => "long".to_string(),
                        Some(existing) if existing == "long" && next == "int" => "long".to_string(),
                        Some(existing)
                            if (existing == "int" || existing == "long" || existing == "double")
                                && (next == "int" || next == "long" || next == "double") =>
                        {
                            if existing == "double" || next == "double" {
                                "double".to_string()
                            } else if existing == "long" || next == "long" {
                                "long".to_string()
                            } else {
                                "int".to_string()
                            }
                        }
                        Some(_) => "json".to_string(),
                    };
                    Some(merged)
                })
                .unwrap_or_else(|| "null".to_string());

            ColumnInfo {
                name: k.clone(),
                data_type: inferred_type,
                nullable: true,
                is_primary_key: k == "_id",
            }
        })
        .collect();

    let rows: Vec<Vec<serde_json::Value>> = docs
        .iter()
        .map(|doc| {
            all_keys
                .iter()
                .map(|k| {
                    if let serde_json::Value::Object(map) = doc {
                        map.get(k).cloned().unwrap_or(serde_json::Value::Null)
                    } else {
                        serde_json::Value::Null
                    }
                })
                .collect()
        })
        .collect();

    let row_count = rows.len() as u64;
    QueryResult {
        columns,
        rows,
        row_count,
        affected_rows: 0,
        execution_time_ms: 0,
        query: query_str.to_string(),
    }
}

// ── Main query command ────────────────────────────────────────────────────

#[tauri::command]
pub fn execute_query(
    connection_id: String,
    database: Option<String>,
    sql: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<QueryResult>, AppError> {
    let registry = registry.inner().clone();
    tauri::async_runtime::block_on(async move {
        execute_query_impl(connection_id, database, sql, registry).await
    })
}

async fn execute_query_impl(
    connection_id: String,
    database: Option<String>,
    sql: String,
    registry: ConnectionRegistry,
) -> std::result::Result<Vec<QueryResult>, AppError> {
    // Split multiple statements by semicolons
    let statements: Vec<String> = sql
        .split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();

    // Clone the connection to avoid holding the RwLock across await points
    let (conn, query_timeout) = {
        let connections = registry.connections();
        let map = connections.read_owned().await;
        let entry = map
            .get(&connection_id)
            .ok_or_else(|| AppError::NotConnected(connection_id.clone()))?;
        (entry.connection.clone(), entry.config.query_timeout_secs)
    };
    // Lock is now dropped

    let mut results = Vec::new();

    for stmt in statements {
        let result = match conn.clone() {
            DatabaseConnection::Mysql(pool) => {
                db::mysql::execute_query_with_db_owned(
                    pool,
                    stmt.clone(),
                    query_timeout,
                    database.clone(),
                )
                .await
            }
            DatabaseConnection::Postgres(pool) => {
                db::postgres::execute_query_owned(pool, stmt.clone(), query_timeout).await
            }
            DatabaseConnection::Sqlite(pool) => {
                db::sqlite::execute_query_owned(pool, stmt.clone()).await
            }
            DatabaseConnection::Mongodb(client) => {
                // Parse MongoDB shell syntax (e.g. db.collection.find({...}), db.collection.aggregate([...]))
                if let Some(op) = parse_mongo_statement(&stmt) {
                    let db_name = database
                        .as_deref()
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .ok_or_else(|| {
                            AppError::Query(
                                "MongoDB query requires a database name. Set the query tab's database field to the exact database shown in the tree."
                                    .to_string(),
                            )
                        })?
                        .to_string();
                    let docs = match op {
                        MongoStatement::Find(op) => {
                            db::mongodb_driver::query_collection_owned(
                                client,
                                db_name,
                                op.collection,
                                op.filter,
                                op.projection,
                                op.sort,
                                op.limit,
                                op.skip as u64,
                            )
                            .await?
                        }
                        MongoStatement::Aggregate(op) => {
                            let mut pipeline = op.pipeline;

                            if op.limit.is_none()
                                && !pipeline.iter().any(|stage| stage.contains_key("$limit"))
                            {
                                pipeline.push(mongodb::bson::doc! { "$limit": 100i64 });
                            }

                            db::mongodb_driver::aggregate_collection_owned(
                                client,
                                db_name,
                                op.collection,
                                pipeline,
                                op.limit,
                                op.skip.map(|value| value as u64),
                            )
                            .await?
                        }
                    };

                    Ok(docs_to_query_result(&docs, &stmt))
                } else {
                    Err(AppError::UnsupportedOperation(
                        "Unsupported MongoDB syntax. Supported: db.collection.find(...), findOne(...), aggregate([...]) with optional sort/project/limit/skip".to_string(),
                    ))
                }
            }
            DatabaseConnection::Redis(_) => Err(AppError::UnsupportedOperation(
                "Use Redis specific commands".to_string(),
            )),
        };

        let had_error = result.is_err();
        let error_msg = result.as_ref().err().map(|e| e.to_string());

        let qr = result.unwrap_or_else(|_e| QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            affected_rows: 0,
            execution_time_ms: 0,
            query: stmt.clone(),
        });

        // Add to history
        add_to_history(QueryHistoryEntry {
            id: Uuid::new_v4().to_string(),
            connection_id: connection_id.clone(),
            database: database.clone(),
            query: stmt.clone(),
            executed_at: Utc::now(),
            execution_time_ms: qr.execution_time_ms,
            row_count: qr.row_count,
            had_error,
            error_message: error_msg.clone(),
        })
        .await;

        if had_error {
            let detail = error_msg.unwrap_or_else(|| "Unknown error".to_string());
            return Err(AppError::Query(format!("{}", detail)));
        }

        results.push(qr);
    }

    Ok(results)
}

#[tauri::command]
pub async fn cancel_query(
    _connection_id: String,
    _registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<(), AppError> {
    Ok(())
}

#[tauri::command]
pub async fn get_query_history() -> std::result::Result<Vec<QueryHistoryEntry>, AppError> {
    let history = QUERY_HISTORY.read().await;
    Ok(history.iter().cloned().collect())
}

#[tauri::command]
pub async fn clear_query_history() -> std::result::Result<(), AppError> {
    let mut history = QUERY_HISTORY.write().await;
    history.clear();
    Ok(())
}
