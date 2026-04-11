use crate::db;
use crate::error::AppError;
use crate::models::{ColumnDetail, DatabaseInfo, IndexInfo, SchemaInfo, TableInfo};
use crate::pool::{ConnectionRegistry, DatabaseConnection};
use tauri::State;

async fn load_connection(
    registry: ConnectionRegistry,
    connection_id: String,
) -> std::result::Result<DatabaseConnection, AppError> {
    let connections = registry.connections();
    let map = connections.read_owned().await;
    let entry = map
        .get(&connection_id)
        .ok_or_else(|| AppError::NotConnected(connection_id.clone()))?;
    Ok(entry.connection.clone())
}

#[tauri::command]
pub async fn get_databases(
    connection_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<DatabaseInfo>, AppError> {
    let (conn, config_db) = {
        let connections = registry.connections();
        let map = connections.read().await;
        let entry = map
            .get(&connection_id)
            .ok_or_else(|| AppError::NotConnected(connection_id.clone()))?;
        (entry.connection.clone(), entry.config.database.clone())
    };

    match &conn {
        DatabaseConnection::Mysql(pool) => db::mysql::get_databases(pool).await,
        DatabaseConnection::Postgres(pool) => db::postgres::get_databases(pool).await,
        DatabaseConnection::Sqlite(_) => Ok(vec![DatabaseInfo {
            name: config_db.unwrap_or_else(|| "main".to_string()),
            size_bytes: None,
            charset: None,
            collation: None,
        }]),
        DatabaseConnection::Mongodb(client) => {
            let names = db::mongodb_driver::list_databases(client).await?;
            Ok(names
                .into_iter()
                .map(|name| DatabaseInfo {
                    name,
                    size_bytes: None,
                    charset: None,
                    collation: None,
                })
                .collect())
        }
        DatabaseConnection::Redis(_) => Ok(vec![DatabaseInfo {
            name: config_db.unwrap_or_else(|| "0".to_string()),
            size_bytes: None,
            charset: None,
            collation: None,
        }]),
    }
}

#[tauri::command]
pub async fn get_schemas(
    connection_id: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<SchemaInfo>, AppError> {
    let conn = {
        let connections = registry.connections();
        let map = connections.read().await;
        let entry = map
            .get(&connection_id)
            .ok_or_else(|| AppError::NotConnected(connection_id.clone()))?;
        entry.connection.clone()
    };

    match &conn {
        DatabaseConnection::Postgres(pool) => db::postgres::get_schemas(pool).await,
        _ => Ok(vec![]),
    }
}

#[tauri::command]
pub async fn get_tables(
    connection_id: String,
    database: String,
    schema: Option<String>,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<TableInfo>, AppError> {
    let conn = {
        let connections = registry.connections();
        let map = connections.read().await;
        let entry = map
            .get(&connection_id)
            .ok_or_else(|| AppError::NotConnected(connection_id.clone()))?;
        entry.connection.clone()
    };

    match &conn {
        DatabaseConnection::Mysql(pool) => db::mysql::get_tables(pool, &database).await,
        DatabaseConnection::Postgres(pool) => {
            let schema_name = schema.as_deref().unwrap_or("public");
            db::postgres::get_tables(pool, schema_name).await
        }
        DatabaseConnection::Sqlite(pool) => db::sqlite::get_tables(pool).await,
        DatabaseConnection::Mongodb(client) => {
            let names = db::mongodb_driver::list_collections(client, &database).await?;
            Ok(names
                .into_iter()
                .map(|name| crate::models::TableInfo {
                    name,
                    schema: None,
                    row_count: None,
                    size_bytes: None,
                    comment: None,
                    table_type: crate::models::TableType::Table,
                })
                .collect())
        }
        DatabaseConnection::Redis(_) => Ok(vec![]),
    }
}

#[tauri::command]
pub async fn get_table_columns(
    connection_id: String,
    database: String,
    schema: Option<String>,
    table: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<ColumnDetail>, AppError> {
    let conn = {
        let connections = registry.connections();
        let map = connections.read().await;
        let entry = map
            .get(&connection_id)
            .ok_or_else(|| AppError::NotConnected(connection_id.clone()))?;
        entry.connection.clone()
    };

    match &conn {
        DatabaseConnection::Mysql(pool) => db::mysql::get_columns(pool, &database, &table).await,
        DatabaseConnection::Postgres(pool) => {
            let schema_name = schema.as_deref().unwrap_or("public");
            db::postgres::get_columns(pool, schema_name, &table).await
        }
        DatabaseConnection::Sqlite(pool) => db::sqlite::get_columns(pool, &table).await,
        _ => Err(AppError::UnsupportedOperation(
            "Column introspection not supported for this database type".to_string(),
        )),
    }
}

#[tauri::command]
pub async fn get_table_indexes(
    connection_id: String,
    database: String,
    schema: Option<String>,
    table: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<IndexInfo>, AppError> {
    let conn = {
        let connections = registry.connections();
        let map = connections.read().await;
        let entry = map
            .get(&connection_id)
            .ok_or_else(|| AppError::NotConnected(connection_id.clone()))?;
        entry.connection.clone()
    };

    match &conn {
        DatabaseConnection::Mysql(pool) => db::mysql::get_indexes(pool, &database, &table).await,
        DatabaseConnection::Postgres(pool) => {
            let schema_name = schema.as_deref().unwrap_or("public");
            db::postgres::get_indexes(pool, schema_name, &table).await
        }
        DatabaseConnection::Sqlite(pool) => db::sqlite::get_indexes(pool, &table).await,
        _ => Ok(vec![]),
    }
}

#[tauri::command]
pub async fn get_table_ddl(
    connection_id: String,
    database: String,
    schema: Option<String>,
    table: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<String, AppError> {
    let conn = {
        let connections = registry.connections();
        let map = connections.read().await;
        let entry = map
            .get(&connection_id)
            .ok_or_else(|| AppError::NotConnected(connection_id.clone()))?;
        entry.connection.clone()
    };

    match &conn {
        DatabaseConnection::Mysql(pool) => db::mysql::get_table_ddl(pool, &database, &table).await,
        DatabaseConnection::Postgres(pool) => {
            let schema_name = schema.as_deref().unwrap_or("public");
            db::postgres::get_table_ddl(pool, schema_name, &table).await
        }
        DatabaseConnection::Sqlite(pool) => db::sqlite::get_table_ddl(pool, &table).await,
        _ => Err(AppError::UnsupportedOperation(
            "DDL not available for this database type".to_string(),
        )),
    }
}

#[tauri::command]
pub fn get_table_data_preview(
    connection_id: String,
    database: String,
    schema: Option<String>,
    table: String,
    limit: Option<u32>,
    offset: Option<u64>,
    where_clause: Option<String>,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<crate::models::QueryResult, AppError> {
    let registry = registry.inner().clone();
    tauri::async_runtime::block_on(async move {
        get_table_data_preview_impl(
            connection_id,
            database,
            schema,
            table,
            limit,
            offset,
            where_clause,
            registry,
        )
        .await
    })
}

async fn get_table_data_preview_impl(
    connection_id: String,
    database: String,
    schema: Option<String>,
    table: String,
    limit: Option<u32>,
    offset: Option<u64>,
    where_clause: Option<String>,
    registry: ConnectionRegistry,
) -> std::result::Result<crate::models::QueryResult, AppError> {
    let limit = limit.unwrap_or(100);
    let offset = offset.unwrap_or(0);
    let where_sql = where_clause
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!(" WHERE {}", s))
        .unwrap_or_default();

    let conn = load_connection(registry.clone(), connection_id.clone()).await?;

    match conn {
        DatabaseConnection::Mysql(pool) => {
            let mysql_sql = format!(
                "SELECT * FROM `{}`.`{}`{} LIMIT {} OFFSET {}",
                database, table, where_sql, limit, offset
            );
            let mut result = db::mysql::execute_query_owned(pool.clone(), mysql_sql, 60).await?;
            let pk_cols = db::mysql::get_pk_columns_owned(pool, database, table).await;
            for col in &mut result.columns {
                col.is_primary_key = pk_cols.contains(&col.name);
            }
            Ok(result)
        }
        DatabaseConnection::Postgres(pool) => {
            let schema_name = schema.unwrap_or_else(|| "public".to_string());
            let pg_sql = format!(
                "SELECT * FROM \"{}\".\"{}\"{}  LIMIT {} OFFSET {}",
                schema_name, table, where_sql, limit, offset
            );
            let mut result = db::postgres::execute_query_owned(pool.clone(), pg_sql, 60).await?;
            let pk_cols = db::postgres::get_pk_columns_owned(pool, schema_name, table).await;
            for col in &mut result.columns {
                col.is_primary_key = pk_cols.contains(&col.name);
            }
            Ok(result)
        }
        DatabaseConnection::Sqlite(pool) => {
            let sqlite_sql = format!(
                "SELECT * FROM \"{}\"{}  LIMIT {} OFFSET {}",
                table, where_sql, limit, offset
            );
            let mut result = db::sqlite::execute_query_owned(pool.clone(), sqlite_sql).await?;
            let pk_cols = db::sqlite::get_pk_columns_owned(pool, table).await;
            for col in &mut result.columns {
                col.is_primary_key = pk_cols.contains(&col.name);
            }
            Ok(result)
        }
        DatabaseConnection::Mongodb(client) => {
            let docs = db::mongodb_driver::query_collection_owned(
                client,
                database.clone(),
                table.clone(),
                None,
                None,
                None,
                limit as i64,
                offset,
            )
            .await?;

            // Convert MongoDB documents to QueryResult format
            // Collect all unique keys across all documents for column headers
            let mut all_keys = Vec::new();
            let mut key_set = std::collections::HashSet::new();
            for doc in &docs {
                if let serde_json::Value::Object(map) = doc {
                    for k in map.keys() {
                        if key_set.insert(k.clone()) {
                            all_keys.push(k.clone());
                        }
                    }
                }
            }

            let columns: Vec<crate::models::ColumnInfo> = all_keys
                .iter()
                .map(|k| crate::models::ColumnInfo {
                    name: k.clone(),
                    data_type: "json".to_string(),
                    nullable: true,
                    is_primary_key: k == "_id",
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
            Ok(crate::models::QueryResult {
                columns,
                rows,
                row_count,
                affected_rows: 0,
                execution_time_ms: 0,
                query: format!("db.{}.find().limit({})", table, limit),
            })
        }
        DatabaseConnection::Redis(_) => Err(AppError::UnsupportedOperation(
            "Data preview not supported for Redis".to_string(),
        )),
    }
}

#[tauri::command]
pub async fn get_views(
    connection_id: String,
    database: String,
    schema: Option<String>,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<crate::models::TableInfo>, AppError> {
    // Views are included in get_tables with TableType::View
    get_tables(connection_id, database, schema, registry)
        .await
        .map(|tables| {
            tables
                .into_iter()
                .filter(|t| t.table_type == crate::models::TableType::View)
                .collect()
        })
}

#[tauri::command]
pub async fn get_procedures(
    connection_id: String,
    database: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<String>, AppError> {
    let conn = {
        let connections = registry.connections();
        let map = connections.read().await;
        let entry = map
            .get(&connection_id)
            .ok_or_else(|| AppError::NotConnected(connection_id.clone()))?;
        entry.connection.clone()
    };

    match &conn {
        DatabaseConnection::Mysql(pool) => {
            use sqlx::Row;
            let rows = sqlx::query(
                "SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME"
            )
            .bind(&database)
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
            Ok(rows
                .iter()
                .map(|r| r.try_get("ROUTINE_NAME").unwrap_or_default())
                .collect())
        }
        DatabaseConnection::Postgres(pool) => {
            use sqlx::Row;
            let rows = sqlx::query(
                "SELECT proname FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace WHERE nspname = 'public' ORDER BY proname"
            )
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
            Ok(rows
                .iter()
                .map(|r| r.try_get("proname").unwrap_or_default())
                .collect())
        }
        _ => Ok(vec![]),
    }
}
