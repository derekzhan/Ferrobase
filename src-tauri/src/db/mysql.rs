use crate::error::{AppError, Result};
use crate::models::{
    ColumnDetail, ColumnInfo, DatabaseInfo, IndexInfo, QueryResult, TableInfo, TableType,
};
use serde_json::Value;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::MySqlPool;
use std::time::{Duration, Instant};

pub async fn connect(
    options: MySqlConnectOptions,
    max_connections: u32,
    timeout_secs: u32,
) -> Result<MySqlPool> {
    MySqlPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(timeout_secs as u64))
        .connect_with(options)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))
}

pub async fn test_connection(options: MySqlConnectOptions) -> Result<()> {
    let pool = connect(options, 1, 10).await?;
    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
    pool.close().await;
    Ok(())
}

#[allow(dead_code)]
pub async fn execute_query(pool: &MySqlPool, sql: &str, _timeout_secs: u32) -> Result<QueryResult> {
    execute_query_with_db(pool, sql, _timeout_secs, None).await
}

pub async fn execute_query_owned(
    pool: MySqlPool,
    sql: String,
    timeout_secs: u32,
) -> Result<QueryResult> {
    execute_query_with_db_owned(pool, sql, timeout_secs, None).await
}

#[allow(dead_code)]
pub async fn execute_query_with_db(
    pool: &MySqlPool,
    sql: &str,
    _timeout_secs: u32,
    database: Option<&str>,
) -> Result<QueryResult> {
    let start = Instant::now();
    let query = sql.trim();

    // Acquire a single connection so USE and the query share the same session
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| AppError::Query(e.to_string()))?;

    // Switch database on this connection if specified
    // USE cannot run as a prepared statement in MySQL, so use raw_sql
    if let Some(db_name) = database {
        if !db_name.is_empty() {
            let use_stmt = format!("USE `{}`", db_name);
            sqlx::raw_sql(&use_stmt)
                .execute(&mut *conn)
                .await
                .map_err(|e| AppError::Query(format!("Failed to switch database: {}", e)))?;
        }
    }

    // Determine if this is a SELECT-like query
    let is_select = query.to_uppercase().starts_with("SELECT")
        || query.to_uppercase().starts_with("SHOW")
        || query.to_uppercase().starts_with("DESCRIBE")
        || query.to_uppercase().starts_with("EXPLAIN")
        || query.to_uppercase().starts_with("WITH");

    if is_select {
        let rows = sqlx::query(query)
            .fetch_all(&mut *conn)
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
                    .map(|(i, col)| mysql_value_to_json(row, i, &col.data_type))
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
            .execute(&mut *conn)
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

pub async fn execute_query_with_db_owned(
    pool: MySqlPool,
    sql: String,
    _timeout_secs: u32,
    database: Option<String>,
) -> Result<QueryResult> {
    let start = Instant::now();
    let query = sql.trim().to_string();

    // Acquire a single connection so USE and the query share the same session.
    let mut conn = pool
        .acquire()
        .await
        .map_err(|e| AppError::Query(e.to_string()))?;

    if let Some(db_name) = database.filter(|name| !name.is_empty()) {
        let use_stmt = format!("USE `{}`", db_name);
        sqlx::raw_sql(&use_stmt)
            .execute(&mut *conn)
            .await
            .map_err(|e| AppError::Query(format!("Failed to switch database: {}", e)))?;
    }

    let is_select = query.to_uppercase().starts_with("SELECT")
        || query.to_uppercase().starts_with("SHOW")
        || query.to_uppercase().starts_with("DESCRIBE")
        || query.to_uppercase().starts_with("EXPLAIN")
        || query.to_uppercase().starts_with("WITH");

    if is_select {
        let rows = sqlx::query(&query)
            .fetch_all(&mut *conn)
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
                query,
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
                    .map(|(i, col)| mysql_value_to_json(row, i, &col.data_type))
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
            query,
        })
    } else {
        let result = sqlx::query(&query)
            .execute(&mut *conn)
            .await
            .map_err(|e| AppError::Query(e.to_string()))?;

        let execution_time_ms = start.elapsed().as_millis() as u64;

        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            row_count: 0,
            affected_rows: result.rows_affected(),
            execution_time_ms,
            query,
        })
    }
}

fn mysql_value_to_json(row: &sqlx::mysql::MySqlRow, index: usize, type_name: &str) -> Value {
    use sqlx::Row;

    let type_upper = type_name.to_uppercase();

    if type_upper.contains("INT") || type_upper == "YEAR" {
        if let Ok(v) = row.try_get::<i64, _>(index) {
            return Value::Number(v.into());
        }
        if let Ok(v) = row.try_get::<u64, _>(index) {
            return Value::Number(v.into());
        }
    }

    if type_upper.contains("FLOAT")
        || type_upper.contains("DOUBLE")
        || type_upper.contains("DECIMAL")
        || type_upper.contains("NUMERIC")
    {
        // With the "bigdecimal" sqlx feature, DECIMAL/NUMERIC columns decode as
        // BigDecimal — try that first, then fall back to f64 for FLOAT/DOUBLE.
        if let Ok(v) = row.try_get::<bigdecimal::BigDecimal, _>(index) {
            use bigdecimal::ToPrimitive;
            if let Some(f) = v.to_f64() {
                if let Some(n) = serde_json::Number::from_f64(f) {
                    return Value::Number(n);
                }
            }
            // If the value can't be losslessly represented as f64, return as string
            return Value::String(v.to_string());
        }
        if let Ok(v) = row.try_get::<f64, _>(index) {
            if let Some(n) = serde_json::Number::from_f64(v) {
                return Value::Number(n);
            }
        }
    }

    if type_upper.contains("BOOL") || type_upper.contains("BIT") {
        if let Ok(v) = row.try_get::<bool, _>(index) {
            return Value::Bool(v);
        }
    }

    if type_upper.contains("DATE")
        || type_upper.contains("TIME")
        || type_upper.contains("TIMESTAMP")
    {
        if let Ok(v) = row.try_get::<String, _>(index) {
            return Value::String(v);
        }
    }

    if type_upper.contains("JSON") {
        if let Ok(v) = row.try_get::<serde_json::Value, _>(index) {
            return v;
        }
    }

    if let Ok(v) = row.try_get::<String, _>(index) {
        return Value::String(v);
    }

    if let Ok(v) = row.try_get::<Vec<u8>, _>(index) {
        return Value::String(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &v,
        ));
    }

    Value::Null
}

pub async fn get_databases(pool: &MySqlPool) -> Result<Vec<DatabaseInfo>> {
    // Use SHOW DATABASES to match same permission model as SHOW TABLES.
    // information_schema.SCHEMATA can return empty when the user doesn't have
    // global SELECT privilege, even though they can access specific databases.
    use sqlx::Row;
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    let system_dbs = ["information_schema", "performance_schema", "mysql", "sys"];
    Ok(rows
        .iter()
        .filter_map(|row| {
            let name: String = row.try_get(0).unwrap_or_default();
            if system_dbs.contains(&name.as_str()) {
                None
            } else {
                Some(DatabaseInfo {
                    name,
                    size_bytes: None,
                    charset: None,
                    collation: None,
                })
            }
        })
        .collect())
}

pub async fn get_tables(pool: &MySqlPool, database: &str) -> Result<Vec<TableInfo>> {
    // Use SHOW FULL TABLES instead of information_schema.TABLES because
    // information_schema requires explicit table-level privileges to list entries,
    // while SHOW FULL TABLES only requires schema-level access (same as SHOW TABLES).
    use sqlx::Row;
    let rows = sqlx::query(&format!("SHOW FULL TABLES FROM `{}`", database))
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|row| {
            // Column 0: Tables_in_<db_name> (dynamic name, use index)
            let name: String = row.try_get(0).unwrap_or_default();
            // Column 1: Table_type — "BASE TABLE" or "VIEW"
            let table_type_str: String = row.try_get("Table_type").unwrap_or_default();
            let table_type = match table_type_str.as_str() {
                "VIEW" => TableType::View,
                _ => TableType::Table,
            };
            TableInfo {
                name,
                schema: Some(database.to_string()),
                row_count: None,
                size_bytes: None,
                comment: None,
                table_type,
            }
        })
        .collect())
}

pub async fn get_columns(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnDetail>> {
    // Use information_schema.COLUMNS instead of SHOW FULL COLUMNS.
    // SHOW commands use MySQL's binary protocol in ways that can cause sqlx to
    // fail decoding certain columns (Type, Comment) as String — they come back
    // as empty via unwrap_or_default(). information_schema is a standard SELECT
    // and always returns properly typed VARCHAR columns.
    use sqlx::Row;
    // CAST all longtext / text columns to CHAR so that MySQL's binary protocol
    // returns them as MYSQL_TYPE_VAR_STRING instead of MYSQL_TYPE_BLOB.
    // Without the casts, sqlx's try_get::<String>() silently fails on BLOB wire types.
    let rows = sqlx::query(
        "SELECT CAST(COLUMN_NAME AS CHAR)       AS col_name, \
                CAST(COLUMN_TYPE AS CHAR)       AS col_type, \
                CAST(DATA_TYPE AS CHAR)         AS data_type, \
                CAST(IS_NULLABLE AS CHAR)       AS is_nullable, \
                CAST(COLUMN_KEY AS CHAR)        AS col_key, \
                CAST(COLUMN_DEFAULT AS CHAR)    AS col_default, \
                CAST(EXTRA AS CHAR)             AS extra, \
                CAST(COLUMN_COMMENT AS CHAR)    AS col_comment, \
                ORDINAL_POSITION                AS ordinal_pos, \
                CHARACTER_MAXIMUM_LENGTH        AS char_max_len, \
                NUMERIC_PRECISION               AS num_prec, \
                NUMERIC_SCALE                   AS num_scale \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|row| {
            let name: String = row.try_get("col_name").unwrap_or_default();
            let column_type: String = row.try_get("col_type").unwrap_or_default();
            let base_data_type: String = row.try_get("data_type").unwrap_or_default();
            let null_str: String = row.try_get("is_nullable").unwrap_or_default();
            let key: String = row.try_get("col_key").unwrap_or_default();
            let default_value: Option<String> = row
                .try_get::<Option<String>, _>("col_default")
                .ok()
                .flatten();
            let extra: String = row.try_get("extra").unwrap_or_default();
            let comment: Option<String> = row
                .try_get::<Option<String>, _>("col_comment")
                .ok()
                .flatten()
                .filter(|s| !s.is_empty());
            let ordinal: u32 = row
                .try_get::<i64, _>("ordinal_pos")
                .map(|v| v as u32)
                .unwrap_or(0);
            let char_max_length: Option<u64> = row
                .try_get::<Option<i64>, _>("char_max_len")
                .ok()
                .flatten()
                .map(|v| v as u64);
            let numeric_precision: Option<u64> = row
                .try_get::<Option<i64>, _>("num_prec")
                .ok()
                .flatten()
                .map(|v| v as u64);
            let numeric_scale: Option<u64> = row
                .try_get::<Option<i64>, _>("num_scale")
                .ok()
                .flatten()
                .map(|v| v as u64);

            ColumnDetail {
                name,
                data_type: base_data_type,
                column_type,
                nullable: null_str.eq_ignore_ascii_case("YES"),
                default_value,
                comment,
                is_primary_key: key == "PRI",
                is_auto_increment: extra.to_lowercase().contains("auto_increment"),
                ordinal_position: ordinal,
                key_type: key,
                extra,
                char_max_length,
                numeric_precision,
                numeric_scale,
            }
        })
        .collect())
}

/// Fetch the primary key column names for a table.
/// Uses information_schema.KEY_COLUMN_USAGE with CAST to avoid the
/// BLOB wire-type issue that affects SHOW commands in sqlx.
pub async fn get_pk_columns(pool: &MySqlPool, database: &str, table: &str) -> Vec<String> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT CAST(COLUMN_NAME AS CHAR) AS col_name \
         FROM information_schema.KEY_COLUMN_USAGE \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    rows.iter()
        .filter_map(|r| r.try_get::<String, _>("col_name").ok())
        .collect()
}

pub async fn get_pk_columns_owned(pool: MySqlPool, database: String, table: String) -> Vec<String> {
    get_pk_columns(&pool, &database, &table).await
}

pub async fn get_indexes(pool: &MySqlPool, database: &str, table: &str) -> Result<Vec<IndexInfo>> {
    let rows = sqlx::query(
        "SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) as COLUMNS, \
         NOT NON_UNIQUE as IS_UNIQUE, INDEX_TYPE \
         FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE \
         ORDER BY INDEX_NAME",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    use sqlx::Row;
    Ok(rows
        .iter()
        .map(|row| {
            let index_name: String = row.try_get("INDEX_NAME").unwrap_or_default();
            let columns_str: String = row.try_get("COLUMNS").unwrap_or_default();
            let is_unique: i64 = row.try_get("IS_UNIQUE").unwrap_or(0);
            IndexInfo {
                name: index_name.clone(),
                columns: columns_str.split(',').map(String::from).collect(),
                is_unique: is_unique != 0,
                is_primary: index_name == "PRIMARY",
                index_type: row.try_get("INDEX_TYPE").unwrap_or_default(),
            }
        })
        .collect())
}

pub async fn get_table_ddl(pool: &MySqlPool, database: &str, table: &str) -> Result<String> {
    use sqlx::Row;
    let row = sqlx::query(&format!("SHOW CREATE TABLE `{}`.`{}`", database, table))
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(row.try_get(1).unwrap_or_default())
}
