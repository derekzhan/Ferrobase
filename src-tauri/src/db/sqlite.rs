use crate::error::{AppError, Result};
use crate::models::{ColumnDetail, ColumnInfo, IndexInfo, QueryResult, TableInfo, TableType};
use serde_json::Value;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::time::Instant;

pub async fn connect(path: &str, max_connections: u32) -> Result<SqlitePool> {
    let url = if path.starts_with("sqlite:") {
        path.to_string()
    } else {
        format!("sqlite:{}", path)
    };

    SqlitePoolOptions::new()
        .max_connections(max_connections)
        .connect(&url)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))
}

pub async fn execute_query(pool: &SqlitePool, sql: &str) -> Result<QueryResult> {
    let start = Instant::now();
    let query = sql.trim();

    let is_select = {
        let upper = query.to_uppercase();
        upper.starts_with("SELECT")
            || upper.starts_with("WITH")
            || upper.starts_with("PRAGMA")
            || upper.starts_with("EXPLAIN")
    };

    if is_select {
        let rows = sqlx::query(query)
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Query(e.to_string()))?;

        let execution_time_ms = start.elapsed().as_millis() as u64;

        if rows.is_empty() {
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                row_count: 0,
                affected_rows: 0,
                execution_time_ms,
                query: query.to_string(),
            });
        }

        use sqlx::Column;
        use sqlx::Row;
        use sqlx::TypeInfo;

        let columns: Vec<ColumnInfo> = rows[0]
            .columns()
            .iter()
            .map(|col| ColumnInfo {
                name: col.name().to_string(),
                data_type: col.type_info().name().to_string(),
                nullable: true,
                is_primary_key: false,
            })
            .collect();

        let result_rows: Vec<Vec<Value>> = rows
            .iter()
            .map(|row| {
                columns
                    .iter()
                    .enumerate()
                    .map(|(i, col)| sqlite_value_to_json(row, i, &col.data_type))
                    .collect()
            })
            .collect();

        let row_count = result_rows.len() as u64;

        Ok(QueryResult {
            columns,
            rows: result_rows,
            row_count,
            affected_rows: 0,
            execution_time_ms,
            query: query.to_string(),
        })
    } else {
        let result = sqlx::query(query)
            .execute(pool)
            .await
            .map_err(|e| AppError::Query(e.to_string()))?;

        let execution_time_ms = start.elapsed().as_millis() as u64;

        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            affected_rows: result.rows_affected(),
            execution_time_ms,
            query: query.to_string(),
        })
    }
}

pub async fn execute_query_owned(pool: SqlitePool, sql: String) -> Result<QueryResult> {
    execute_query(&pool, &sql).await
}

fn sqlite_value_to_json(row: &sqlx::sqlite::SqliteRow, index: usize, type_name: &str) -> Value {
    use sqlx::Row;

    match type_name.to_uppercase().as_str() {
        "INTEGER" | "INT" => {
            if let Ok(v) = row.try_get::<i64, _>(index) {
                return Value::Number(v.into());
            }
        }
        "REAL" | "FLOAT" | "NUMERIC" => {
            if let Ok(v) = row.try_get::<f64, _>(index) {
                if let Some(n) = serde_json::Number::from_f64(v) {
                    return Value::Number(n);
                }
            }
        }
        _ => {}
    }

    if let Ok(v) = row.try_get::<String, _>(index) {
        return Value::String(v);
    }
    if let Ok(v) = row.try_get::<i64, _>(index) {
        return Value::Number(v.into());
    }
    if let Ok(v) = row.try_get::<f64, _>(index) {
        if let Some(n) = serde_json::Number::from_f64(v) {
            return Value::Number(n);
        }
    }
    if let Ok(v) = row.try_get::<bool, _>(index) {
        return Value::Bool(v);
    }
    if let Ok(v) = row.try_get::<Vec<u8>, _>(index) {
        return Value::String(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &v,
        ));
    }

    Value::Null
}

pub async fn get_tables(pool: &SqlitePool) -> Result<Vec<TableInfo>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|row| {
            let type_str: String = row.try_get("type").unwrap_or_default();
            TableInfo {
                name: row.try_get("name").unwrap_or_default(),
                schema: None,
                row_count: None,
                size_bytes: None,
                comment: None,
                table_type: if type_str == "view" {
                    TableType::View
                } else {
                    TableType::Table
                },
            }
        })
        .collect())
}

pub async fn get_columns(pool: &SqlitePool, table: &str) -> Result<Vec<ColumnDetail>> {
    use sqlx::Row;
    let rows = sqlx::query(&format!("PRAGMA table_info(\"{}\")", table))
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let not_null: i64 = row.try_get("notnull").unwrap_or(0);
            let pk: i64 = row.try_get("pk").unwrap_or(0);
            ColumnDetail {
                name: row.try_get("name").unwrap_or_default(),
                data_type: row.try_get("type").unwrap_or_default(),
                column_type: row.try_get("type").unwrap_or_default(),
                nullable: not_null == 0,
                default_value: row.try_get("dflt_value").ok().flatten(),
                comment: None,
                is_primary_key: pk != 0,
                is_auto_increment: false,
                ordinal_position: i as u32,
                key_type: if pk != 0 {
                    "PRI".to_string()
                } else {
                    String::new()
                },
                extra: String::new(),
                char_max_length: None,
                numeric_precision: None,
                numeric_scale: None,
            }
        })
        .collect())
}

pub async fn get_indexes(pool: &SqlitePool, table: &str) -> Result<Vec<IndexInfo>> {
    use sqlx::Row;
    let index_list = sqlx::query(&format!("PRAGMA index_list(\"{}\")", table))
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    let mut indexes = Vec::new();
    for idx_row in &index_list {
        let name: String = idx_row.try_get("name").unwrap_or_default();
        let unique: i64 = idx_row.try_get("unique").unwrap_or(0);

        let cols = sqlx::query(&format!("PRAGMA index_info(\"{}\")", name))
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

        let columns: Vec<String> = cols
            .iter()
            .map(|c| c.try_get::<String, _>("name").unwrap_or_default())
            .collect();

        indexes.push(IndexInfo {
            is_primary: name.starts_with("sqlite_autoindex"),
            name,
            columns,
            is_unique: unique != 0,
            index_type: "BTREE".to_string(),
        });
    }
    Ok(indexes)
}

pub async fn get_pk_columns(pool: &SqlitePool, table: &str) -> Vec<String> {
    use sqlx::Row;
    let rows = sqlx::query(&format!("PRAGMA table_info(\"{}\")", table))
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    rows.iter()
        .filter_map(|row| {
            let pk: i64 = row.try_get("pk").unwrap_or(0);
            if pk != 0 {
                row.try_get::<String, _>("name").ok()
            } else {
                None
            }
        })
        .collect()
}

pub async fn get_pk_columns_owned(pool: SqlitePool, table: String) -> Vec<String> {
    get_pk_columns(&pool, &table).await
}

pub async fn get_table_ddl(pool: &SqlitePool, table: &str) -> Result<String> {
    use sqlx::Row;
    let row =
        sqlx::query("SELECT sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')")
            .bind(table)
            .fetch_one(pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(row.try_get("sql").unwrap_or_default())
}
