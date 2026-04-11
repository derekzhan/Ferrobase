use crate::error::{AppError, Result};
use crate::models::{
    ColumnDetail, ColumnInfo, DatabaseInfo, IndexInfo, QueryResult, SchemaInfo, TableInfo,
    TableType,
};
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::{Duration, Instant};

pub async fn connect(url: &str, max_connections: u32, timeout_secs: u32) -> Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(timeout_secs as u64))
        .connect(url)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))
}

pub async fn test_connection(url: &str) -> Result<()> {
    let pool = connect(url, 1, 10).await?;
    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
    pool.close().await;
    Ok(())
}

pub async fn execute_query(pool: &PgPool, sql: &str, _timeout_secs: u32) -> Result<QueryResult> {
    let start = Instant::now();
    let query = sql.trim();

    let is_select = {
        let upper = query.to_uppercase();
        upper.starts_with("SELECT")
            || upper.starts_with("WITH")
            || upper.starts_with("TABLE")
            || upper.starts_with("SHOW")
            || upper.starts_with("EXPLAIN")
            || upper.starts_with("\\")
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
                    .map(|(i, col)| pg_value_to_json(row, i, &col.data_type))
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

pub async fn execute_query_owned(
    pool: PgPool,
    sql: String,
    timeout_secs: u32,
) -> Result<QueryResult> {
    execute_query(&pool, &sql, timeout_secs).await
}

fn pg_value_to_json(row: &sqlx::postgres::PgRow, index: usize, type_name: &str) -> Value {
    use sqlx::Row;

    match type_name {
        "INT2" | "INT4" | "INT8" | "INT" | "INTEGER" | "BIGINT" | "SMALLINT" => {
            if let Ok(v) = row.try_get::<i64, _>(index) {
                return Value::Number(v.into());
            }
        }
        "FLOAT4" | "FLOAT8" | "NUMERIC" | "DECIMAL" | "REAL" | "DOUBLE PRECISION" => {
            // BigDecimal first (sqlx "bigdecimal" feature maps NUMERIC/DECIMAL to BigDecimal)
            if let Ok(v) = row.try_get::<bigdecimal::BigDecimal, _>(index) {
                use bigdecimal::ToPrimitive;
                if let Some(f) = v.to_f64() {
                    if let Some(n) = serde_json::Number::from_f64(f) {
                        return Value::Number(n);
                    }
                }
                return Value::String(v.to_string());
            }
            if let Ok(v) = row.try_get::<f64, _>(index) {
                if let Some(n) = serde_json::Number::from_f64(v) {
                    return Value::Number(n);
                }
            }
        }
        "BOOL" => {
            if let Ok(v) = row.try_get::<bool, _>(index) {
                return Value::Bool(v);
            }
        }
        "JSON" | "JSONB" => {
            if let Ok(v) = row.try_get::<serde_json::Value, _>(index) {
                return v;
            }
        }
        _ => {}
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

pub async fn get_databases(pool: &PgPool) -> Result<Vec<DatabaseInfo>> {
    use sqlx::Row;
    let rows =
        sqlx::query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|row| DatabaseInfo {
            name: row.try_get("datname").unwrap_or_default(),
            size_bytes: None,
            charset: None,
            collation: None,
        })
        .collect())
}

pub async fn get_schemas(pool: &PgPool) -> Result<Vec<SchemaInfo>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT schema_name, schema_owner FROM information_schema.schemata \
         WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') \
         AND schema_name NOT LIKE 'pg_temp_%' \
         AND schema_name NOT LIKE 'pg_toast_temp_%' \
         ORDER BY schema_name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|row| SchemaInfo {
            name: row.try_get("schema_name").unwrap_or_default(),
            owner: row.try_get("schema_owner").ok(),
        })
        .collect())
}

pub async fn get_tables(pool: &PgPool, schema: &str) -> Result<Vec<TableInfo>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT t.table_name, t.table_type, \
         obj_description((quote_ident(t.table_schema)||'.'||quote_ident(t.table_name))::regclass, 'pg_class') as comment \
         FROM information_schema.tables t \
         WHERE t.table_schema = $1 \
         ORDER BY t.table_type, t.table_name"
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|row| {
            let table_type_str: String = row.try_get("table_type").unwrap_or_default();
            let table_type = match table_type_str.as_str() {
                "VIEW" => TableType::View,
                _ => TableType::Table,
            };
            TableInfo {
                name: row.try_get("table_name").unwrap_or_default(),
                schema: Some(schema.to_string()),
                row_count: None,
                size_bytes: None,
                comment: row.try_get("comment").ok().flatten(),
                table_type,
            }
        })
        .collect())
}

pub async fn get_columns(pool: &PgPool, schema: &str, table: &str) -> Result<Vec<ColumnDetail>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default, \
         c.ordinal_position, c.character_maximum_length, c.numeric_precision, c.numeric_scale, \
         col_description(pgc.oid, c.ordinal_position) as comment, \
         CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key \
         FROM information_schema.columns c \
         JOIN pg_class pgc ON pgc.relname = c.table_name \
         JOIN pg_namespace pgn ON pgn.nspname = c.table_schema AND pgn.oid = pgc.relnamespace \
         LEFT JOIN ( \
           SELECT kcu.column_name FROM information_schema.table_constraints tc \
           JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name \
           WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 \
         ) pk ON pk.column_name = c.column_name \
         WHERE c.table_schema = $1 AND c.table_name = $2 \
         ORDER BY c.ordinal_position"
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|row| {
            let is_nullable: String = row.try_get("is_nullable").unwrap_or_default();
            let is_pk: bool = row.try_get("is_primary_key").unwrap_or(false);
            let col_default: Option<String> = row.try_get("column_default").ok().flatten();
            let is_auto_increment = col_default
                .as_deref()
                .map(|d| d.contains("nextval"))
                .unwrap_or(false);
            ColumnDetail {
                name: row.try_get("column_name").unwrap_or_default(),
                data_type: row.try_get("data_type").unwrap_or_default(),
                column_type: row.try_get("udt_name").unwrap_or_default(),
                nullable: is_nullable.to_uppercase() == "YES",
                default_value: col_default,
                comment: row.try_get("comment").ok().flatten(),
                is_primary_key: is_pk,
                is_auto_increment,
                ordinal_position: row.try_get::<i32, _>("ordinal_position").unwrap_or(0) as u32,
                key_type: if is_pk {
                    "PRI".to_string()
                } else {
                    String::new()
                },
                extra: String::new(),
                char_max_length: row
                    .try_get::<Option<i64>, _>("character_maximum_length")
                    .ok()
                    .flatten()
                    .map(|v| v as u64),
                numeric_precision: row
                    .try_get::<Option<i64>, _>("numeric_precision")
                    .ok()
                    .flatten()
                    .map(|v| v as u64),
                numeric_scale: row
                    .try_get::<Option<i64>, _>("numeric_scale")
                    .ok()
                    .flatten()
                    .map(|v| v as u64),
            }
        })
        .collect())
}

pub async fn get_indexes(pool: &PgPool, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT i.relname as index_name, \
         array_to_string(array_agg(a.attname ORDER BY x.n), ',') as columns, \
         ix.indisunique as is_unique, ix.indisprimary as is_primary, \
         am.amname as index_type \
         FROM pg_class t \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         JOIN pg_index ix ON t.oid = ix.indrelid \
         JOIN pg_class i ON i.oid = ix.indexrelid \
         JOIN pg_am am ON am.oid = i.relam \
         JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, n) ON true \
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum \
         WHERE t.relname = $2 AND n.nspname = $1 \
         GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname \
         ORDER BY i.relname",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|row| {
            let columns_str: String = row.try_get("columns").unwrap_or_default();
            IndexInfo {
                name: row.try_get("index_name").unwrap_or_default(),
                columns: columns_str.split(',').map(String::from).collect(),
                is_unique: row.try_get("is_unique").unwrap_or(false),
                is_primary: row.try_get("is_primary").unwrap_or(false),
                index_type: row.try_get("index_type").unwrap_or_default(),
            }
        })
        .collect())
}

pub async fn get_pk_columns(pool: &PgPool, schema: &str, table: &str) -> Vec<String> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT kcu.column_name FROM information_schema.table_constraints tc \
         JOIN information_schema.key_column_usage kcu \
           ON tc.constraint_name = kcu.constraint_name \
          AND tc.table_schema = kcu.table_schema \
          AND tc.table_name = kcu.table_name \
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.iter()
        .filter_map(|r| r.try_get::<String, _>("column_name").ok())
        .collect()
}

pub async fn get_pk_columns_owned(pool: PgPool, schema: String, table: String) -> Vec<String> {
    get_pk_columns(&pool, &schema, &table).await
}

pub async fn get_table_ddl(pool: &PgPool, schema: &str, table: &str) -> Result<String> {
    use sqlx::Row;
    // Use pg_dump approach via SQL
    let row = sqlx::query(
        "SELECT 'CREATE TABLE ' || quote_ident($1) || '.' || quote_ident($2) || ' (' || chr(10) || \
         string_agg('  ' || quote_ident(c.column_name) || ' ' || c.data_type || \
           CASE WHEN c.character_maximum_length IS NOT NULL THEN '(' || c.character_maximum_length || ')' ELSE '' END || \
           CASE WHEN c.is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END || \
           CASE WHEN c.column_default IS NOT NULL THEN ' DEFAULT ' || c.column_default ELSE '' END, \
           ',' || chr(10) ORDER BY c.ordinal_position) || chr(10) || ');' as ddl \
         FROM information_schema.columns c \
         WHERE c.table_schema = $1 AND c.table_name = $2 \
         GROUP BY c.table_schema, c.table_name"
    )
    .bind(schema)
    .bind(table)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(row.try_get("ddl").unwrap_or_default())
}
