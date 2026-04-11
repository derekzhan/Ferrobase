use crate::db;
use crate::error::{AppError, Result};
use crate::models::{ExportFormat, ExportOptions, QueryResult};
use crate::pool::{ConnectionRegistry, DatabaseConnection};
use tauri::State;

/// Clone of a database connection that is Send-safe across await boundaries
enum DbConn {
    Mysql(sqlx::MySqlPool),
    Postgres(sqlx::PgPool),
    Sqlite(sqlx::SqlitePool),
}

#[tauri::command]
pub fn export_query_result(
    connection_id: String,
    sql: String,
    options: ExportOptions,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<String, AppError> {
    let registry = registry.inner().clone();
    tauri::async_runtime::block_on(async move {
        export_query_result_impl(connection_id, sql, options, registry).await
    })
}

async fn export_query_result_impl(
    connection_id: String,
    sql: String,
    options: ExportOptions,
    registry: ConnectionRegistry,
) -> std::result::Result<String, AppError> {
    // Clone the pool so we can drop the lock before awaiting
    let db_conn = {
        let connections = registry.connections();
        let map = connections.read_owned().await;
        let entry = map
            .get(&connection_id)
            .ok_or_else(|| AppError::NotConnected(connection_id.clone()))?;

        match &entry.connection {
            DatabaseConnection::Mysql(pool) => DbConn::Mysql(pool.clone()),
            DatabaseConnection::Postgres(pool) => DbConn::Postgres(pool.clone()),
            DatabaseConnection::Sqlite(pool) => DbConn::Sqlite(pool.clone()),
            _ => {
                return Err(AppError::UnsupportedOperation(
                    "Export not supported for this database type".to_string(),
                ))
            }
        }
    };
    // Lock is now dropped

    let result = match db_conn {
        DbConn::Mysql(pool) => db::mysql::execute_query_owned(pool, sql, 300).await?,
        DbConn::Postgres(pool) => db::postgres::execute_query_owned(pool, sql, 300).await?,
        DbConn::Sqlite(pool) => db::sqlite::execute_query_owned(pool, sql).await?,
    };

    let file_path = options.file_path.clone();
    let include_headers = options.include_headers;
    let table_name = options
        .table_name
        .clone()
        .unwrap_or_else(|| "exported_table".to_string());

    // Write to file
    match options.format {
        ExportFormat::Csv => export_csv(result, file_path, include_headers).await,
        ExportFormat::Json => export_json(result, file_path).await,
        ExportFormat::SqlInsert => export_sql(result, file_path, table_name).await,
        ExportFormat::Xlsx => export_xlsx(result, file_path, include_headers).await,
    }
}

async fn export_csv(result: QueryResult, path: String, include_headers: bool) -> Result<String> {
    let mut content = String::new();

    if include_headers {
        let header: Vec<String> = result
            .columns
            .iter()
            .map(|c| {
                if c.name.contains(',') || c.name.contains('"') || c.name.contains('\n') {
                    format!("\"{}\"", c.name.replace('"', "\"\""))
                } else {
                    c.name.clone()
                }
            })
            .collect();
        content.push_str(&header.join(","));
        content.push('\n');
    }

    for row in &result.rows {
        let cells: Vec<String> = row
            .iter()
            .map(|v: &serde_json::Value| match v {
                serde_json::Value::Null => String::new(),
                serde_json::Value::Bool(b) => b.to_string(),
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::String(s) => {
                    if s.contains(',') || s.contains('"') || s.contains('\n') {
                        format!("\"{}\"", s.replace('"', "\"\""))
                    } else {
                        s.clone()
                    }
                }
                v => {
                    let s = v.to_string();
                    format!("\"{}\"", s.replace('"', "\"\""))
                }
            })
            .collect();
        content.push_str(&cells.join(","));
        content.push('\n');
    }

    tokio::fs::write(&path, content)
        .await
        .map_err(|e| AppError::Export(e.to_string()))?;

    Ok(path)
}

async fn export_json(result: QueryResult, path: String) -> Result<String> {
    let records: Vec<serde_json::Value> = result
        .rows
        .iter()
        .map(|row: &Vec<serde_json::Value>| {
            let mut obj = serde_json::Map::new();
            for (i, col) in result.columns.iter().enumerate() {
                obj.insert(
                    col.name.clone(),
                    row.get(i).cloned().unwrap_or(serde_json::Value::Null),
                );
            }
            serde_json::Value::Object(obj)
        })
        .collect();

    let json_str =
        serde_json::to_string_pretty(&records).map_err(|e| AppError::Export(e.to_string()))?;

    tokio::fs::write(&path, json_str)
        .await
        .map_err(|e| AppError::Export(e.to_string()))?;

    Ok(path)
}

async fn export_sql(result: QueryResult, path: String, table_name: String) -> Result<String> {
    let mut content = String::new();
    let col_names: Vec<String> = result
        .columns
        .iter()
        .map(|c| format!("`{}`", c.name))
        .collect();
    let col_list = col_names.join(", ");

    for row in &result.rows {
        let values: Vec<String> = row
            .iter()
            .map(|v: &serde_json::Value| match v {
                serde_json::Value::Null => "NULL".to_string(),
                serde_json::Value::Bool(b) => {
                    if *b {
                        "1".to_string()
                    } else {
                        "0".to_string()
                    }
                }
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::String(s) => format!("'{}'", s.replace('\'', "\\'")),
                v => format!("'{}'", v.to_string().replace('\'', "\\'")),
            })
            .collect();

        content.push_str(&format!(
            "INSERT INTO `{}` ({}) VALUES ({});\n",
            table_name,
            col_list,
            values.join(", ")
        ));
    }

    tokio::fs::write(&path, content)
        .await
        .map_err(|e| AppError::Export(e.to_string()))?;

    Ok(path)
}

async fn export_xlsx(result: QueryResult, path: String, include_headers: bool) -> Result<String> {
    let csv_path = path.replace(".xlsx", ".csv");
    export_csv(result, csv_path.clone(), include_headers).await?;
    tokio::fs::rename(&csv_path, &path)
        .await
        .map_err(|e| AppError::Export(e.to_string()))?;
    Ok(path)
}
