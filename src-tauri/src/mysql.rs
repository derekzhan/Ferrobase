//! MySQL backend: dynamic query execution + metadata introspection + inline
//! edits + schema alters + copy + dump. Built on sqlx's MySQL driver.

use bigdecimal::BigDecimal;
use serde_json::{Map, Value};
use sqlx::{Column, MySqlPool, Row, TypeInfo};
use std::collections::BTreeMap;
use tauri::{AppHandle, Emitter};

use crate::models::*;
use crate::state::{AppState, Backend};
use crate::util::{escape_str, json_to_sql_literal, quote_ident};

const MAX_QUERY_ROWS: i64 = 1000;

/// Decode a column as UTF-8 text, tolerating servers (notably MariaDB) that
/// report `information_schema` string columns with the *binary* charset. sqlx
/// otherwise refuses to decode those as `String` and `Row::get` panics, which
/// would crash metadata introspection (listing tables, columns, indexes, …).
fn s(row: &sqlx::mysql::MySqlRow, idx: usize) -> String {
    if let Ok(v) = row.try_get::<String, _>(idx) {
        return v;
    }
    match row.try_get::<Vec<u8>, _>(idx) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(_) => String::new(),
    }
}

/// Decode a column as `i64`, tolerating the various numeric representations the
/// server may use for `information_schema` values (`BIGINT UNSIGNED`, `DECIMAL`,
/// or even text/binary). Returns 0 when the value is NULL or undecodable.
fn n(row: &sqlx::mysql::MySqlRow, idx: usize) -> i64 {
    no(row, idx).unwrap_or(0)
}

/// Like [`n`] but preserves NULL as `None`.
fn no(row: &sqlx::mysql::MySqlRow, idx: usize) -> Option<i64> {
    if let Ok(v) = row.try_get::<Option<i64>, _>(idx) {
        return v;
    }
    if let Ok(v) = row.try_get::<Option<u64>, _>(idx) {
        return v.map(|x| x as i64);
    }
    if let Ok(v) = row.try_get::<Option<i32>, _>(idx) {
        return v.map(|x| x as i64);
    }
    if let Ok(v) = row.try_get::<Option<u32>, _>(idx) {
        return v.map(|x| x as i64);
    }
    if let Ok(v) = row.try_get::<Option<f64>, _>(idx) {
        return v.map(|x| x as i64);
    }
    if let Ok(v) = row.try_get::<Option<BigDecimal>, _>(idx) {
        return v.map(|x| x.to_string().split('.').next().unwrap_or("0").parse().unwrap_or(0));
    }
    if let Ok(v) = row.try_get::<Option<String>, _>(idx) {
        return v.map(|x| x.trim().parse().unwrap_or(0));
    }
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(idx) {
        return v.map(|b| String::from_utf8_lossy(&b).trim().parse().unwrap_or(0));
    }
    None
}

// ── Statement kind detection ──────────────────────────────────────────────────

fn strip_leading_comments(s: &str) -> &str {
    let mut s = s.trim_start();
    loop {
        if let Some(rest) = s.strip_prefix("--").or_else(|| s.strip_prefix('#')) {
            match rest.find('\n') {
                Some(i) => s = rest[i + 1..].trim_start(),
                None => return "",
            }
        } else if let Some(rest) = s.strip_prefix("/*") {
            match rest.find("*/") {
                Some(i) => s = rest[i + 2..].trim_start(),
                None => return "",
            }
        } else {
            return s;
        }
    }
}

fn is_select_like(sql: &str) -> bool {
    let s = strip_leading_comments(sql).trim_start();
    let upper = s.to_uppercase();
    ["SELECT", "WITH", "SHOW", "DESCRIBE", "DESC ", "EXPLAIN", "CALL", "TABLE ", "VALUES", "PRAGMA", "ANALYZE", "CHECK "]
        .iter()
        .any(|k| upper.starts_with(k))
}

// ── Dynamic cell decoding ─────────────────────────────────────────────────────

fn decode_cell(row: &sqlx::mysql::MySqlRow, i: usize) -> Value {
    let name = row.column(i).type_info().name().to_uppercase();

    let is_int = name.contains("TINYINT")
        || name.contains("SMALLINT")
        || name.contains("MEDIUMINT")
        || name == "INT"
        || name.contains("INTEGER")
        || name.contains("BIGINT")
        || name == "YEAR";

    if is_int {
        if name.contains("UNSIGNED") {
            if let Ok(v) = row.try_get::<Option<u64>, _>(i) {
                return v.map(|n| Value::Number(n.into())).unwrap_or(Value::Null);
            }
        }
        if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
            return v.map(|n| Value::Number(n.into())).unwrap_or(Value::Null);
        }
    }

    if name.contains("DECIMAL") || name.contains("NUMERIC") {
        if let Ok(v) = row.try_get::<Option<BigDecimal>, _>(i) {
            return v.map(|d| Value::String(d.to_string())).unwrap_or(Value::Null);
        }
        if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            return v.map(Value::String).unwrap_or(Value::Null);
        }
    }

    if name.contains("FLOAT") || name.contains("DOUBLE") || name.contains("REAL") {
        if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
            return match v {
                Some(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
                None => Value::Null,
            };
        }
    }

    if name.contains("DATETIME") || name.contains("TIMESTAMP") {
        if let Ok(v) = row.try_get::<Option<chrono::NaiveDateTime>, _>(i) {
            return v
                .map(|d| Value::String(d.format("%Y-%m-%d %H:%M:%S").to_string()))
                .unwrap_or(Value::Null);
        }
        if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            return v.map(Value::String).unwrap_or(Value::Null);
        }
    }

    if name == "DATE" {
        if let Ok(v) = row.try_get::<Option<chrono::NaiveDate>, _>(i) {
            return v.map(|d| Value::String(d.format("%Y-%m-%d").to_string())).unwrap_or(Value::Null);
        }
    }

    if name == "TIME" {
        if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            return v.map(Value::String).unwrap_or(Value::Null);
        }
    }

    if name.contains("JSON") {
        if let Ok(v) = row.try_get::<Option<Value>, _>(i) {
            return v.map(|j| Value::String(j.to_string())).unwrap_or(Value::Null);
        }
        if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            return v.map(Value::String).unwrap_or(Value::Null);
        }
    }

    if name.contains("BIT") {
        if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
            return match v {
                Some(b) => {
                    let mut n: u64 = 0;
                    for byte in b.iter() {
                        n = (n << 8) | (*byte as u64);
                    }
                    Value::Number(n.into())
                }
                None => Value::Null,
            };
        }
    }

    // text / char / enum / set / generic
    if let Ok(v) = row.try_get::<Option<String>, _>(i) {
        return v.map(Value::String).unwrap_or(Value::Null);
    }
    // binary / blob
    if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
        return v
            .map(|b| Value::String(String::from_utf8_lossy(&b).to_string()))
            .unwrap_or(Value::Null);
    }
    Value::Null
}

async fn materialize(
    pool: &MySqlPool,
    sql: &str,
    cap: i64,
) -> Result<(Vec<ColumnMeta>, Vec<Vec<Value>>, bool), String> {
    // Run the user query via the unprepared *text* (simple-query) protocol.
    // The prepared/binary protocol rejects many statements a SQL console must
    // support with MySQL error 1295 ("not supported in the prepared statement
    // protocol yet"), so we mirror what a CLI client does and avoid preparing.
    // Executing on the pool (rather than a `&mut Connection`) keeps the future
    // `Send`, which `raw_sql` + `&mut conn` is not.
    let fetched = sqlx::raw_sql(sql).fetch_all(pool).await.map_err(|e| e.to_string())?;
    let mut cols: Vec<ColumnMeta> = Vec::new();
    if let Some(first) = fetched.first() {
        for c in first.columns() {
            cols.push(ColumnMeta {
                name: c.name().to_string(),
                type_: c.type_info().name().to_string(),
                nullable: true,
            });
        }
    }
    let truncated = fetched.len() as i64 > cap;
    let mut rows: Vec<Vec<Value>> = Vec::new();
    for row in fetched.iter().take(cap.max(0) as usize) {
        let mut out = Vec::with_capacity(cols.len());
        for i in 0..cols.len() {
            out.push(decode_cell(row, i));
        }
        rows.push(out);
    }
    Ok((cols, rows, truncated))
}

pub async fn run_query(pool: MySqlPool, db: String, sql: String) -> QueryResult {
    let start = std::time::Instant::now();
    let mut res = QueryResult::default();
    let sql_trim = sql.trim();
    // Prepend `USE` in the same unprepared batch so the active database applies
    // to the user statement on the single connection the pool runs it on.
    let full = if db.trim().is_empty() {
        sql_trim.to_string()
    } else {
        format!("USE {};\n{}", quote_ident(&db), sql_trim)
    };
    if is_select_like(sql_trim) {
        match materialize(&pool, &full, MAX_QUERY_ROWS).await {
            Ok((cols, rows, truncated)) => {
                res.columns = cols;
                res.row_count = rows.len() as i64;
                res.rows = rows;
                res.truncated = truncated;
            }
            Err(e) => res.error = e,
        }
    } else {
        match sqlx::raw_sql(&full).execute(&pool).await {
            Ok(r) => res.rows_affected = r.rows_affected() as i64,
            Err(e) => res.error = e.to_string(),
        }
    }
    res.exec_ms = start.elapsed().as_millis() as i64;
    res
}

pub async fn run_query_page(pool: &MySqlPool, db: &str, sql: &str, offset: i64, limit: i64) -> QueryResult {
    let inner = sql.trim().trim_end_matches(';').trim();
    let lim = if limit <= 0 { 200 } else { limit.min(MAX_QUERY_ROWS) };
    let off = offset.max(0);
    let paged = format!("SELECT * FROM ({}) _ferrobase_page LIMIT {} OFFSET {}", inner, lim, off);
    run_query(pool.clone(), db.to_string(), paged).await
}

pub async fn exec_query(pool: &MySqlPool, sql: &str, limit: i64) -> ExecResult {
    let start = std::time::Instant::now();
    let mut res = ExecResult::default();
    let cap = if limit <= 0 { MAX_QUERY_ROWS } else { limit };
    if is_select_like(sql) {
        match materialize(pool, sql.trim(), cap).await {
            Ok((cols, rows, truncated)) => {
                res.columns = cols.into_iter().map(|c| c.name).collect();
                res.row_count = rows.len() as i64;
                res.rows = rows;
                res.truncated = truncated;
            }
            Err(e) => res.error = e,
        }
    } else {
        match sqlx::raw_sql(sql.trim()).execute(pool).await {
            Ok(r) => res.rows_affected = r.rows_affected() as i64,
            Err(e) => res.error = e.to_string(),
        }
    }
    res.time_ms = start.elapsed().as_millis() as i64;
    res
}

pub async fn exec_dml(pool: &MySqlPool, sql: &str) -> ExecResult {
    exec_query(pool, sql, MAX_QUERY_ROWS).await
}

pub async fn kill_query(pool: &MySqlPool, process_id: i64) -> QueryResult {
    let mut res = QueryResult::default();
    match sqlx::raw_sql(&format!("KILL {}", process_id)).execute(pool).await {
        Ok(r) => res.rows_affected = r.rows_affected() as i64,
        Err(e) => res.error = e.to_string(),
    }
    res
}

// ── Metadata introspection ────────────────────────────────────────────────────

pub async fn fetch_databases(pool: &MySqlPool) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|r| s(r, 0)).collect())
}

fn charset_from_collation(coll: &str) -> String {
    coll.split('_').next().unwrap_or("").to_string()
}

pub async fn fetch_tables(pool: &MySqlPool, db: &str) -> Result<Vec<TableInfo>, String> {
    let rows = sqlx::query(
        "SELECT TABLE_NAME, TABLE_TYPE, IFNULL(ENGINE,''), IFNULL(TABLE_ROWS,0),
                IFNULL(DATA_LENGTH,0)+IFNULL(INDEX_LENGTH,0), IFNULL(TABLE_COMMENT,''),
                IFNULL(TABLE_COLLATION,''), AUTO_INCREMENT
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    )
    .bind(db)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        let table_type = s(&r, 1);
        let kind = if table_type.contains("VIEW") { "view" } else { "table" };
        let collation = s(&r, 6);
        out.push(TableInfo {
            name: s(&r, 0),
            schema: db.to_string(),
            kind: kind.to_string(),
            row_count: n(&r, 3),
            size_bytes: n(&r, 4),
            comment: s(&r, 5),
            engine: s(&r, 2),
            charset: charset_from_collation(&collation),
            collation,
            auto_increment: no(&r, 7),
        });
    }
    Ok(out)
}

pub async fn table_columns(pool: &MySqlPool, db: &str, table: &str) -> Result<Vec<CachedColumn>, String> {
    let rows = sqlx::query(
        "SELECT ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, IFNULL(EXTRA,''), IFNULL(COLUMN_COMMENT,'')
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",
    )
    .bind(db)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| {
            let nullable = s(r, 3);
            let key = s(r, 4);
            CachedColumn {
                ordinal: n(r, 0),
                name: s(r, 1),
                type_: s(r, 2),
                nullable: nullable.eq_ignore_ascii_case("YES"),
                is_primary_key: key == "PRI",
                extra: Some(s(r, 5)),
                comment: Some(s(r, 6)),
            }
        })
        .collect())
}

pub async fn get_table_schema(pool: &MySqlPool, conn_id: &str, db: &str, table: &str) -> Result<CachedTableSchema, String> {
    let info = sqlx::query(
        "SELECT TABLE_TYPE, IFNULL(ENGINE,''), IFNULL(TABLE_ROWS,0),
                IFNULL(DATA_LENGTH,0)+IFNULL(INDEX_LENGTH,0), IFNULL(TABLE_COMMENT,''),
                IFNULL(TABLE_COLLATION,''), AUTO_INCREMENT
         FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",
    )
    .bind(db)
    .bind(table)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let cols = table_columns(pool, db, table).await?;
    let mut schema = CachedTableSchema {
        found: info.is_some(),
        conn_id: conn_id.to_string(),
        db_name: db.to_string(),
        table_name: table.to_string(),
        synced_at: chrono::Utc::now().to_rfc3339(),
        columns: cols,
        ..Default::default()
    };
    if let Some(r) = info {
        let table_type = s(&r, 0);
        schema.kind = if table_type.contains("VIEW") { "view".into() } else { "table".into() };
        schema.engine = s(&r, 1);
        schema.row_count = n(&r, 2);
        schema.size_bytes = n(&r, 3);
        schema.comment = s(&r, 4);
        let coll = s(&r, 5);
        schema.charset = charset_from_collation(&coll);
        schema.collation = coll;
        schema.auto_increment = no(&r, 6);
    }
    Ok(schema)
}

pub async fn advanced_properties(pool: &MySqlPool, db: &str, table: &str) -> Result<AdvancedTableProperties, String> {
    let mut props = AdvancedTableProperties {
        schema: db.to_string(),
        table: table.to_string(),
        ..Default::default()
    };

    // DDL via SHOW CREATE TABLE
    if let Ok(row) = sqlx::raw_sql(&format!("SHOW CREATE TABLE {}.{}", quote_ident(db), quote_ident(table)))
        .fetch_one(pool)
        .await
    {
        // column 1 is "Create Table" (or "Create View")
        props.ddl = row.try_get::<String, _>(1).unwrap_or_default();
    }

    // Indexes
    if let Ok(rows) = sqlx::query(
        "SELECT INDEX_NAME, NON_UNIQUE, IFNULL(INDEX_TYPE,''), COLUMN_NAME, SEQ_IN_INDEX, IFNULL(INDEX_COMMENT,'')
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(db)
    .bind(table)
    .fetch_all(pool)
    .await
    {
        let mut map: BTreeMap<String, IndexDetail> = BTreeMap::new();
        let mut order: Vec<String> = Vec::new();
        for r in rows {
            let name = s(&r, 0);
            let non_unique: i64 = no(&r, 1).unwrap_or(1);
            let itype = s(&r, 2);
            let col = s(&r, 3);
            let comment = s(&r, 5);
            let entry = map.entry(name.clone()).or_insert_with(|| {
                order.push(name.clone());
                IndexDetail {
                    name: name.clone(),
                    type_: itype,
                    unique: non_unique == 0,
                    columns: Vec::new(),
                    comment,
                }
            });
            if !col.is_empty() {
                entry.columns.push(col);
            }
        }
        props.indexes = order.into_iter().filter_map(|k| map.remove(&k)).collect();
    }

    // Foreign keys (outgoing) + references (incoming)
    if let Ok(rows) = sqlx::query(
        "SELECT rc.CONSTRAINT_NAME, kcu.COLUMN_NAME, IFNULL(kcu.REFERENCED_TABLE_SCHEMA,''),
                IFNULL(kcu.REFERENCED_TABLE_NAME,''), IFNULL(kcu.REFERENCED_COLUMN_NAME,''),
                rc.DELETE_RULE, rc.UPDATE_RULE
         FROM information_schema.REFERENTIAL_CONSTRAINTS rc
         JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
         WHERE rc.CONSTRAINT_SCHEMA=? AND rc.TABLE_NAME=?
         ORDER BY rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
    )
    .bind(db)
    .bind(table)
    .fetch_all(pool)
    .await
    {
        let mut map: BTreeMap<String, ForeignKeyDetail> = BTreeMap::new();
        let mut order: Vec<String> = Vec::new();
        for r in rows {
            let name = s(&r, 0);
            let entry = map.entry(name.clone()).or_insert_with(|| {
                order.push(name.clone());
                ForeignKeyDetail {
                    name: name.clone(),
                    ref_schema: s(&r, 2),
                    ref_table: s(&r, 3),
                    on_delete: s(&r, 5),
                    on_update: s(&r, 6),
                    ..Default::default()
                }
            });
            entry.columns.push(s(&r, 1));
            entry.ref_columns.push(s(&r, 4));
        }
        props.foreign_keys = order.into_iter().filter_map(|k| map.remove(&k)).collect();
    }

    if let Ok(rows) = sqlx::query(
        "SELECT rc.CONSTRAINT_NAME, IFNULL(kcu.TABLE_SCHEMA,''), IFNULL(kcu.TABLE_NAME,''),
                kcu.COLUMN_NAME, IFNULL(kcu.REFERENCED_COLUMN_NAME,''), rc.DELETE_RULE, rc.UPDATE_RULE
         FROM information_schema.REFERENTIAL_CONSTRAINTS rc
         JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
         WHERE kcu.REFERENCED_TABLE_SCHEMA=? AND kcu.REFERENCED_TABLE_NAME=?
         ORDER BY rc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
    )
    .bind(db)
    .bind(table)
    .fetch_all(pool)
    .await
    {
        let mut map: BTreeMap<String, ReferenceDetail> = BTreeMap::new();
        let mut order: Vec<String> = Vec::new();
        for r in rows {
            let name = s(&r, 0);
            let entry = map.entry(name.clone()).or_insert_with(|| {
                order.push(name.clone());
                ReferenceDetail {
                    name: name.clone(),
                    from_schema: s(&r, 1),
                    from_table: s(&r, 2),
                    on_delete: s(&r, 5),
                    on_update: s(&r, 6),
                    ..Default::default()
                }
            });
            entry.from_cols.push(s(&r, 3));
            entry.to_cols.push(s(&r, 4));
        }
        props.references = order.into_iter().filter_map(|k| map.remove(&k)).collect();
    }

    // Constraints (PRIMARY / UNIQUE / CHECK)
    if let Ok(rows) = sqlx::query(
        "SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, IFNULL(kcu.COLUMN_NAME,'')
         FROM information_schema.TABLE_CONSTRAINTS tc
         LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_NAME = tc.TABLE_NAME
         WHERE tc.TABLE_SCHEMA=? AND tc.TABLE_NAME=?
         ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
    )
    .bind(db)
    .bind(table)
    .fetch_all(pool)
    .await
    {
        let mut map: BTreeMap<String, ConstraintDetail> = BTreeMap::new();
        let mut order: Vec<String> = Vec::new();
        for r in rows {
            let name = s(&r, 0);
            let ctype = s(&r, 1);
            let col = s(&r, 2);
            let entry = map.entry(name.clone()).or_insert_with(|| {
                order.push(name.clone());
                ConstraintDetail { name: name.clone(), type_: ctype, columns: Vec::new(), expression: String::new() }
            });
            if !col.is_empty() {
                entry.columns.push(col);
            }
        }
        props.constraints = order.into_iter().filter_map(|k| map.remove(&k)).collect();
    }

    // Partitions
    if let Ok(rows) = sqlx::query(
        "SELECT PARTITION_NAME, IFNULL(PARTITION_METHOD,''), IFNULL(PARTITION_EXPRESSION,''),
                IFNULL(PARTITION_DESCRIPTION,''), IFNULL(TABLE_ROWS,0)
         FROM information_schema.PARTITIONS
         WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND PARTITION_NAME IS NOT NULL
         ORDER BY PARTITION_ORDINAL_POSITION",
    )
    .bind(db)
    .bind(table)
    .fetch_all(pool)
    .await
    {
        for r in rows {
            props.partitions.push(PartitionDetail {
                name: s(&r, 0),
                method: s(&r, 1),
                expression: s(&r, 2),
                description: s(&r, 3),
                rows: n(&r, 4),
            });
        }
    }

    // Triggers
    props.triggers = fetch_triggers_for(pool, db, Some(table)).await.unwrap_or_default();

    Ok(props)
}

async fn fetch_triggers_for(pool: &MySqlPool, db: &str, table: Option<&str>) -> Result<Vec<TriggerDetail>, String> {
    let sql = if table.is_some() {
        "SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, IFNULL(ACTION_STATEMENT,'')
         FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA=? AND EVENT_OBJECT_TABLE=? ORDER BY TRIGGER_NAME"
    } else {
        "SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_TIMING, IFNULL(ACTION_STATEMENT,'')
         FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? ORDER BY TRIGGER_NAME"
    };
    let mut q = sqlx::query(sql).bind(db);
    if let Some(t) = table {
        q = q.bind(t);
    }
    let rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| TriggerDetail {
            name: s(r, 0),
            event: s(r, 1),
            timing: s(r, 2),
            statement: s(r, 3),
        })
        .collect())
}

pub async fn fetch_triggers(pool: &MySqlPool, db: &str) -> Result<Vec<TriggerDetail>, String> {
    fetch_triggers_for(pool, db, None).await
}

pub async fn fetch_routines(pool: &MySqlPool, db: &str) -> Result<Vec<RoutineInfo>, String> {
    let rows = sqlx::query(
        "SELECT ROUTINE_NAME, ROUTINE_TYPE, IFNULL(DTD_IDENTIFIER,''), IFNULL(ROUTINE_COMMENT,''),
                IFNULL(CREATED,''), IFNULL(LAST_ALTERED,'')
         FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=? ORDER BY ROUTINE_NAME",
    )
    .bind(db)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| RoutineInfo {
            name: s(r, 0),
            type_: s(r, 1),
            return_type: s(r, 2),
            comment: s(r, 3),
            created: s(r, 4),
            modified: s(r, 5),
        })
        .collect())
}

pub async fn fetch_events(pool: &MySqlPool, db: &str) -> Result<Vec<EventInfo>, String> {
    let rows = sqlx::query(
        "SELECT EVENT_NAME, IFNULL(STATUS,''), IFNULL(EVENT_TYPE,''), IFNULL(INTERVAL_VALUE,''),
                IFNULL(INTERVAL_FIELD,''), IFNULL(EXECUTE_AT,''), IFNULL(EVENT_COMMENT,'')
         FROM information_schema.EVENTS WHERE EVENT_SCHEMA=? ORDER BY EVENT_NAME",
    )
    .bind(db)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| {
            let etype = s(r, 2);
            let ival = s(r, 3);
            let ifield = s(r, 4);
            let exec_at = s(r, 5);
            let schedule = if etype.eq_ignore_ascii_case("ONE TIME") {
                format!("AT {}", exec_at)
            } else if !ival.is_empty() {
                format!("EVERY {} {}", ival, ifield)
            } else {
                etype.clone()
            };
            EventInfo {
                name: s(r, 0),
                status: s(r, 1),
                schedule,
                comment: s(r, 6),
            }
        })
        .collect())
}

pub async fn export_dump(pool: &MySqlPool, db: &str, table: &str) -> Result<String, String> {
    let mut out = String::new();
    out.push_str(&format!("-- Ferrobase dump of {}.{}\n", db, table));
    out.push_str(&format!("-- Generated: {}\n\n", chrono::Utc::now().to_rfc3339()));

    if let Ok(row) = sqlx::raw_sql(&format!("SHOW CREATE TABLE {}.{}", quote_ident(db), quote_ident(table)))
        .fetch_one(pool)
        .await
    {
        let ddl: String = row.try_get(1).unwrap_or_default();
        out.push_str(&format!("DROP TABLE IF EXISTS {};\n", quote_ident(table)));
        out.push_str(&ddl);
        out.push_str(";\n\n");
    }

    // Data
    let q = run_query(pool.clone(), db.to_string(), format!("SELECT * FROM {}", quote_ident(table))).await;
    if q.error.is_empty() && !q.rows.is_empty() {
        let cols: Vec<String> = q.columns.iter().map(|c| quote_ident(&c.name)).collect();
        for row in &q.rows {
            let vals: Vec<String> = row.iter().map(json_to_sql_literal).collect();
            out.push_str(&format!(
                "INSERT INTO {} ({}) VALUES ({});\n",
                quote_ident(table),
                cols.join(", "),
                vals.join(", ")
            ));
        }
    }
    Ok(out)
}

// ── Inline edits (ApplyChanges) ────────────────────────────────────────────────

pub async fn apply_changes(pool: &MySqlPool, cs: &ChangeSet) -> ApplyResult {
    let start = std::time::Instant::now();
    let mut result = ApplyResult::default();
    let table_ref = if cs.database.is_empty() {
        quote_ident(&cs.table_name)
    } else {
        format!("{}.{}", quote_ident(&cs.database), quote_ident(&cs.table_name))
    };
    let pk = &cs.primary_key;

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            result.error = e.to_string();
            return result;
        }
    };

    // Deletes
    for id in &cs.deleted_ids {
        if pk.is_empty() {
            continue;
        }
        let sql = format!("DELETE FROM {} WHERE {} = {}", table_ref, quote_ident(pk), json_to_sql_literal(id));
        result.statements.push(sql.clone());
        match sqlx::query(&sql).execute(&mut *tx).await {
            Ok(r) => result.deleted_count += r.rows_affected() as i64,
            Err(e) => {
                result.error = e.to_string();
                let _ = tx.rollback().await;
                return result;
            }
        }
    }

    // Inserts
    for row in &cs.added_rows {
        if let Value::Object(map) = row {
            if map.is_empty() {
                continue;
            }
            let cols: Vec<String> = map.keys().map(|k| quote_ident(k)).collect();
            let vals: Vec<String> = map.values().map(json_to_sql_literal).collect();
            let sql = format!("INSERT INTO {} ({}) VALUES ({})", table_ref, cols.join(", "), vals.join(", "));
            result.statements.push(sql.clone());
            match sqlx::query(&sql).execute(&mut *tx).await {
                Ok(r) => result.inserted_count += r.rows_affected() as i64,
                Err(e) => {
                    result.error = e.to_string();
                    let _ = tx.rollback().await;
                    return result;
                }
            }
        }
    }

    // Updates
    for row in &cs.edited_rows {
        if let Value::Object(map) = row {
            if pk.is_empty() || !map.contains_key(pk) {
                continue;
            }
            let pk_val = map.get(pk).cloned().unwrap_or(Value::Null);
            let sets: Vec<String> = map
                .iter()
                .filter(|(k, _)| k.as_str() != pk.as_str())
                .map(|(k, v)| format!("{} = {}", quote_ident(k), json_to_sql_literal(v)))
                .collect();
            if sets.is_empty() {
                continue;
            }
            let sql = format!(
                "UPDATE {} SET {} WHERE {} = {}",
                table_ref,
                sets.join(", "),
                quote_ident(pk),
                json_to_sql_literal(&pk_val)
            );
            result.statements.push(sql.clone());
            match sqlx::query(&sql).execute(&mut *tx).await {
                Ok(r) => result.updated_count += r.rows_affected() as i64,
                Err(e) => {
                    result.error = e.to_string();
                    let _ = tx.rollback().await;
                    return result;
                }
            }
        }
    }

    if let Err(e) = tx.commit().await {
        result.error = e.to_string();
    }
    result.time_ms = start.elapsed().as_millis() as i64;
    result
}

// ── Schema alters ──────────────────────────────────────────────────────────────

fn column_def(c: &ColumnDraft) -> String {
    let mut def = format!("{} {}", quote_ident(&c.name), c.type_);
    if c.not_null {
        def.push_str(" NOT NULL");
    } else {
        def.push_str(" NULL");
    }
    if c.auto_increment {
        def.push_str(" AUTO_INCREMENT");
    }
    if c.has_default {
        let d = c.default.trim();
        if d.eq_ignore_ascii_case("NULL") || d.eq_ignore_ascii_case("CURRENT_TIMESTAMP") {
            def.push_str(&format!(" DEFAULT {}", d));
        } else {
            def.push_str(&format!(" DEFAULT '{}'", escape_str(d)));
        }
    }
    if !c.comment.is_empty() {
        def.push_str(&format!(" COMMENT '{}'", escape_str(&c.comment)));
    }
    def
}

pub fn preview_table_alter(req: &SchemaChangeRequest) -> SchemaChangePreview {
    let mut preview = SchemaChangePreview::default();
    let table_ref = if req.schema.is_empty() {
        quote_ident(&req.table)
    } else {
        format!("{}.{}", quote_ident(&req.schema), quote_ident(&req.table))
    };

    // Column drops
    for oc in &req.old_columns {
        if !req.new_columns.iter().any(|nc| nc.original_name == oc.name || (nc.original_name.is_empty() && nc.name == oc.name)) {
            preview.statements.push(SchemaChangeStatement {
                kind: "drop_column".into(),
                summary: format!("Drop column {}", oc.name),
                sql: format!("ALTER TABLE {} DROP COLUMN {}", table_ref, quote_ident(&oc.name)),
            });
        }
    }
    // Column adds / modifies
    for nc in &req.new_columns {
        let original = if nc.original_name.is_empty() { None } else { req.old_columns.iter().find(|oc| oc.name == nc.original_name) };
        match original {
            None => {
                preview.statements.push(SchemaChangeStatement {
                    kind: "add_column".into(),
                    summary: format!("Add column {}", nc.name),
                    sql: format!("ALTER TABLE {} ADD COLUMN {}", table_ref, column_def(nc)),
                });
            }
            Some(oc) => {
                let changed = oc.name != nc.name
                    || oc.type_ != nc.type_
                    || oc.not_null != nc.not_null
                    || oc.auto_increment != nc.auto_increment
                    || oc.default != nc.default
                    || oc.has_default != nc.has_default
                    || oc.comment != nc.comment;
                if changed {
                    if oc.name != nc.name {
                        preview.statements.push(SchemaChangeStatement {
                            kind: "change_column".into(),
                            summary: format!("Rename/modify column {} → {}", oc.name, nc.name),
                            sql: format!("ALTER TABLE {} CHANGE COLUMN {} {}", table_ref, quote_ident(&oc.name), column_def(nc)),
                        });
                    } else {
                        preview.statements.push(SchemaChangeStatement {
                            kind: "modify_column".into(),
                            summary: format!("Modify column {}", nc.name),
                            sql: format!("ALTER TABLE {} MODIFY COLUMN {}", table_ref, column_def(nc)),
                        });
                    }
                }
            }
        }
    }

    // Table-level changes
    let oi = &req.original_info;
    let ui = &req.updated_info;
    if !ui.engine.is_empty() && oi.engine != ui.engine {
        preview.statements.push(SchemaChangeStatement {
            kind: "engine".into(),
            summary: format!("Set engine = {}", ui.engine),
            sql: format!("ALTER TABLE {} ENGINE = {}", table_ref, ui.engine),
        });
    }
    if oi.comment != ui.comment {
        preview.statements.push(SchemaChangeStatement {
            kind: "comment".into(),
            summary: "Set table comment".into(),
            sql: format!("ALTER TABLE {} COMMENT = '{}'", table_ref, escape_str(&ui.comment)),
        });
    }
    if !ui.charset.is_empty() && (oi.charset != ui.charset || oi.collation != ui.collation) {
        let mut sql = format!("ALTER TABLE {} CONVERT TO CHARACTER SET {}", table_ref, ui.charset);
        if !ui.collation.is_empty() {
            sql.push_str(&format!(" COLLATE {}", ui.collation));
        }
        preview.statements.push(SchemaChangeStatement { kind: "charset".into(), summary: "Convert charset".into(), sql });
    }
    if !ui.name.is_empty() && oi.name != ui.name {
        preview.statements.push(SchemaChangeStatement {
            kind: "rename".into(),
            summary: format!("Rename table to {}", ui.name),
            sql: format!("ALTER TABLE {} RENAME TO {}", table_ref, quote_ident(&ui.name)),
        });
    }
    preview
}

pub fn preview_index_alter(req: &IndexChangeRequest) -> SchemaChangePreview {
    let mut preview = SchemaChangePreview::default();
    let table_ref = if req.schema.is_empty() { quote_ident(&req.table) } else { format!("{}.{}", quote_ident(&req.schema), quote_ident(&req.table)) };

    fn drop_index_sql(table_ref: &str, name: &str) -> String {
        if name.eq_ignore_ascii_case("PRIMARY") {
            format!("ALTER TABLE {} DROP PRIMARY KEY", table_ref)
        } else {
            format!("ALTER TABLE {} DROP INDEX {}", table_ref, quote_ident(name))
        }
    }
    fn add_index_sql(table_ref: &str, idx: &IndexDraft) -> String {
        let cols: Vec<String> = idx.columns.iter().map(|c| quote_ident(c)).collect();
        if idx.name.eq_ignore_ascii_case("PRIMARY") {
            return format!("ALTER TABLE {} ADD PRIMARY KEY ({})", table_ref, cols.join(", "));
        }
        let kind = if idx.unique {
            "UNIQUE INDEX".to_string()
        } else if idx.type_.eq_ignore_ascii_case("FULLTEXT") {
            "FULLTEXT INDEX".to_string()
        } else if idx.type_.eq_ignore_ascii_case("SPATIAL") {
            "SPATIAL INDEX".to_string()
        } else {
            "INDEX".to_string()
        };
        let mut sql = format!("ALTER TABLE {} ADD {} {} ({})", table_ref, kind, quote_ident(&idx.name), cols.join(", "));
        if !idx.comment.is_empty() {
            sql.push_str(&format!(" COMMENT '{}'", escape_str(&idx.comment)));
        }
        sql
    }

    for oi in &req.old_indexes {
        if !req.new_indexes.iter().any(|ni| ni.original_name == oi.name) {
            preview.statements.push(SchemaChangeStatement {
                kind: "drop_index".into(),
                summary: format!("Drop index {}", oi.name),
                sql: drop_index_sql(&table_ref, &oi.name),
            });
        }
    }
    for ni in &req.new_indexes {
        let orig = if ni.original_name.is_empty() { None } else { req.old_indexes.iter().find(|oi| oi.name == ni.original_name) };
        match orig {
            None => preview.statements.push(SchemaChangeStatement {
                kind: "add_index".into(),
                summary: format!("Add index {}", ni.name),
                sql: add_index_sql(&table_ref, ni),
            }),
            Some(oi) => {
                let changed = oi.name != ni.name || oi.unique != ni.unique || oi.columns != ni.columns || oi.type_ != ni.type_;
                if changed {
                    preview.statements.push(SchemaChangeStatement {
                        kind: "drop_index".into(),
                        summary: format!("Drop index {}", oi.name),
                        sql: drop_index_sql(&table_ref, &oi.name),
                    });
                    preview.statements.push(SchemaChangeStatement {
                        kind: "add_index".into(),
                        summary: format!("Recreate index {}", ni.name),
                        sql: add_index_sql(&table_ref, ni),
                    });
                }
            }
        }
    }
    preview
}

pub fn preview_constraint_alter(req: &ConstraintChangeRequest) -> SchemaChangePreview {
    let mut preview = SchemaChangePreview::default();
    let table_ref = if req.schema.is_empty() { quote_ident(&req.table) } else { format!("{}.{}", quote_ident(&req.schema), quote_ident(&req.table)) };

    fn drop_sql(table_ref: &str, c: &ConstraintDraft) -> String {
        match c.type_.to_uppercase().as_str() {
            "PRIMARY KEY" | "PRIMARY" => format!("ALTER TABLE {} DROP PRIMARY KEY", table_ref),
            "FOREIGN KEY" => format!("ALTER TABLE {} DROP FOREIGN KEY {}", table_ref, quote_ident(&c.name)),
            "CHECK" => format!("ALTER TABLE {} DROP CHECK {}", table_ref, quote_ident(&c.name)),
            _ => format!("ALTER TABLE {} DROP INDEX {}", table_ref, quote_ident(&c.name)),
        }
    }
    fn add_sql(table_ref: &str, c: &ConstraintDraft) -> String {
        let cols: Vec<String> = c.columns.iter().map(|x| quote_ident(x)).collect();
        match c.type_.to_uppercase().as_str() {
            "PRIMARY KEY" | "PRIMARY" => format!("ALTER TABLE {} ADD PRIMARY KEY ({})", table_ref, cols.join(", ")),
            "UNIQUE" => format!("ALTER TABLE {} ADD CONSTRAINT {} UNIQUE ({})", table_ref, quote_ident(&c.name), cols.join(", ")),
            "CHECK" => format!("ALTER TABLE {} ADD CONSTRAINT {} CHECK ({})", table_ref, quote_ident(&c.name), c.expression),
            _ => format!("ALTER TABLE {} ADD CONSTRAINT {} {} ({})", table_ref, quote_ident(&c.name), c.type_, cols.join(", ")),
        }
    }

    for oc in &req.old_constraints {
        if !req.new_constraints.iter().any(|nc| nc.original_name == oc.name) {
            preview.statements.push(SchemaChangeStatement { kind: "drop_constraint".into(), summary: format!("Drop constraint {}", oc.name), sql: drop_sql(&table_ref, oc) });
        }
    }
    for nc in &req.new_constraints {
        let orig = if nc.original_name.is_empty() { None } else { req.old_constraints.iter().find(|oc| oc.name == nc.original_name) };
        match orig {
            None => preview.statements.push(SchemaChangeStatement { kind: "add_constraint".into(), summary: format!("Add constraint {}", nc.name), sql: add_sql(&table_ref, nc) }),
            Some(oc) => {
                let changed = oc.name != nc.name || oc.columns != nc.columns || oc.expression != nc.expression || oc.type_ != nc.type_;
                if changed {
                    preview.statements.push(SchemaChangeStatement { kind: "drop_constraint".into(), summary: format!("Drop constraint {}", oc.name), sql: drop_sql(&table_ref, oc) });
                    preview.statements.push(SchemaChangeStatement { kind: "add_constraint".into(), summary: format!("Recreate constraint {}", nc.name), sql: add_sql(&table_ref, nc) });
                }
            }
        }
    }
    preview
}

pub fn preview_partition_alter(req: &PartitionChangeRequest) -> SchemaChangePreview {
    let mut preview = SchemaChangePreview::default();
    let table_ref = if req.schema.is_empty() { quote_ident(&req.table) } else { format!("{}.{}", quote_ident(&req.schema), quote_ident(&req.table)) };

    if req.new_partitions.is_empty() && !req.old_partitions.is_empty() {
        preview.statements.push(SchemaChangeStatement {
            kind: "remove_partitioning".into(),
            summary: "Remove partitioning".into(),
            sql: format!("ALTER TABLE {} REMOVE PARTITIONING", table_ref),
        });
        return preview;
    }
    for op in &req.old_partitions {
        if !req.new_partitions.iter().any(|np| np.original_name == op.name) {
            preview.statements.push(SchemaChangeStatement {
                kind: "drop_partition".into(),
                summary: format!("Drop partition {}", op.name),
                sql: format!("ALTER TABLE {} DROP PARTITION {}", table_ref, quote_ident(&op.name)),
            });
        }
    }
    for np in &req.new_partitions {
        if np.original_name.is_empty() {
            preview.statements.push(SchemaChangeStatement {
                kind: "add_partition".into(),
                summary: format!("Add partition {}", np.name),
                sql: format!("ALTER TABLE {} ADD PARTITION (PARTITION {} {})", table_ref, quote_ident(&np.name), np.definition),
            });
        }
    }
    preview
}

async fn execute_preview(pool: &MySqlPool, preview: SchemaChangePreview) -> SchemaChangeResult {
    let mut result = SchemaChangeResult {
        success: true,
        statements: preview.statements.clone(),
        failed_index: -1,
        ..Default::default()
    };
    for (i, stmt) in preview.statements.iter().enumerate() {
        match sqlx::raw_sql(&stmt.sql).execute(pool).await {
            Ok(_) => result.executed_count += 1,
            Err(e) => {
                result.success = false;
                result.failed_index = i as i64;
                result.failed_statement = stmt.sql.clone();
                result.error = e.to_string();
                return result;
            }
        }
    }
    result
}

pub async fn execute_table_alter(pool: &MySqlPool, req: &SchemaChangeRequest) -> SchemaChangeResult {
    execute_preview(pool, preview_table_alter(req)).await
}
pub async fn execute_index_alter(pool: &MySqlPool, req: &IndexChangeRequest) -> SchemaChangeResult {
    execute_preview(pool, preview_index_alter(req)).await
}
pub async fn execute_constraint_alter(pool: &MySqlPool, req: &ConstraintChangeRequest) -> SchemaChangeResult {
    execute_preview(pool, preview_constraint_alter(req)).await
}
pub async fn execute_partition_alter(pool: &MySqlPool, req: &PartitionChangeRequest) -> SchemaChangeResult {
    execute_preview(pool, preview_partition_alter(req)).await
}

// ── Copy table / database ──────────────────────────────────────────────────────

fn emit_progress(app: &AppHandle, status: &str, processed: i64, total: i64) {
    let _ = app.emit(
        "copy_progress",
        CopyProgress { status: status.to_string(), processed_rows: processed, total_rows: total },
    );
}

async fn copy_one_table(
    app: &AppHandle,
    src: &MySqlPool,
    dst: &MySqlPool,
    src_db: &str,
    src_table: &str,
    dst_db: &str,
    dst_table: &str,
    copy_structure: bool,
    copy_data: bool,
    drop_if_exists: bool,
    batch_size: i64,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    let dst_ref = format!("{}.{}", quote_ident(dst_db), quote_ident(dst_table));

    if copy_structure {
        if drop_if_exists {
            let _ = sqlx::raw_sql(&format!("DROP TABLE IF EXISTS {}", dst_ref)).execute(dst).await;
        }
        let row = sqlx::raw_sql(&format!("SHOW CREATE TABLE {}.{}", quote_ident(src_db), quote_ident(src_table)))
            .fetch_one(src)
            .await
            .map_err(|e| e.to_string())?;
        let mut ddl: String = row.try_get(1).unwrap_or_default();
        // Rewrite the table name to the destination table.
        ddl = ddl.replacen(&format!("CREATE TABLE `{}`", src_table), &format!("CREATE TABLE `{}`", dst_table), 1);
        let _ = sqlx::raw_sql(&format!("USE {}", quote_ident(dst_db))).execute(dst).await;
        sqlx::raw_sql(&ddl).execute(dst).await.map_err(|e| e.to_string())?;
    }

    if copy_data {
        let batch = if batch_size <= 0 { 500 } else { batch_size };
        let total: i64 = match sqlx::raw_sql(&format!("SELECT COUNT(*) FROM {}.{}", quote_ident(src_db), quote_ident(src_table)))
            .fetch_all(src)
            .await
        {
            Ok(rows) => rows.first().map(|r| n(r, 0)).unwrap_or(0),
            _ => 0,
        };
        let mut offset: i64 = 0;
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err("copy cancelled".into());
            }
            let page = run_query(
                src.clone(),
                src_db.to_string(),
                format!("SELECT * FROM {} LIMIT {} OFFSET {}", quote_ident(src_table), batch, offset),
            )
            .await;
            if !page.error.is_empty() {
                return Err(page.error);
            }
            if page.rows.is_empty() {
                break;
            }
            let cols: Vec<String> = page.columns.iter().map(|c| quote_ident(&c.name)).collect();
            let mut values_parts: Vec<String> = Vec::new();
            for row in &page.rows {
                let vals: Vec<String> = row.iter().map(json_to_sql_literal).collect();
                values_parts.push(format!("({})", vals.join(", ")));
            }
            let insert = format!("INSERT INTO {} ({}) VALUES {}", dst_ref, cols.join(", "), values_parts.join(", "));
            sqlx::raw_sql(&insert).execute(dst).await.map_err(|e| e.to_string())?;
            offset += page.rows.len() as i64;
            emit_progress(app, &format!("Copying {}…", src_table), offset, total);
            if (page.rows.len() as i64) < batch {
                break;
            }
        }
    }
    Ok(())
}

pub async fn copy_table(app: AppHandle, state: &AppState, cfg: CopyTableConfig) -> CopyResult {
    state.copy_cancel.store(false, std::sync::atomic::Ordering::SeqCst);
    let start = std::time::Instant::now();
    let src = match get_pool(state, &cfg.source_conn_id).await {
        Ok(p) => p,
        Err(e) => return CopyResult { success: false, time_ms: 0, error: e },
    };
    let dst = match get_pool(state, &cfg.target_conn_id).await {
        Ok(p) => p,
        Err(e) => return CopyResult { success: false, time_ms: 0, error: e },
    };
    let r = copy_one_table(
        &app,
        &src,
        &dst,
        &cfg.source_db,
        &cfg.source_table,
        &cfg.target_db,
        &cfg.target_table,
        cfg.copy_structure,
        cfg.copy_data,
        cfg.drop_target_if_exists,
        cfg.batch_size,
        &state.copy_cancel,
    )
    .await;
    match r {
        Ok(_) => {
            emit_progress(&app, "Done", 0, 0);
            CopyResult { success: true, time_ms: start.elapsed().as_millis() as i64, error: String::new() }
        }
        Err(e) => CopyResult { success: false, time_ms: start.elapsed().as_millis() as i64, error: e },
    }
}

pub async fn copy_database(app: AppHandle, state: &AppState, cfg: CopyDatabaseConfig) -> CopyResult {
    state.copy_cancel.store(false, std::sync::atomic::Ordering::SeqCst);
    let start = std::time::Instant::now();
    let src = match get_pool(state, &cfg.source_conn_id).await {
        Ok(p) => p,
        Err(e) => return CopyResult { success: false, time_ms: 0, error: e },
    };
    let dst = match get_pool(state, &cfg.target_conn_id).await {
        Ok(p) => p,
        Err(e) => return CopyResult { success: false, time_ms: 0, error: e },
    };

    let _ = sqlx::raw_sql(&format!("CREATE DATABASE IF NOT EXISTS {}", quote_ident(&cfg.target_db)))
        .execute(&dst)
        .await;

    let tables: Vec<String> = if cfg.scope == "selected" && !cfg.tables.is_empty() {
        cfg.tables.clone()
    } else {
        match fetch_tables(&src, &cfg.source_db).await {
            Ok(ts) => ts.into_iter().filter(|t| t.kind == "table").map(|t| t.name).collect(),
            Err(e) => return CopyResult { success: false, time_ms: 0, error: e },
        }
    };

    for t in &tables {
        if state.copy_cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return CopyResult { success: false, time_ms: start.elapsed().as_millis() as i64, error: "copy cancelled".into() };
        }
        if let Err(e) = copy_one_table(
            &app,
            &src,
            &dst,
            &cfg.source_db,
            t,
            &cfg.target_db,
            t,
            cfg.copy_structure,
            cfg.copy_data,
            cfg.drop_target_if_exists,
            cfg.batch_size,
            &state.copy_cancel,
        )
        .await
        {
            return CopyResult { success: false, time_ms: start.elapsed().as_millis() as i64, error: e };
        }
    }
    emit_progress(&app, "Done", 0, 0);
    CopyResult { success: true, time_ms: start.elapsed().as_millis() as i64, error: String::new() }
}

async fn get_pool(state: &AppState, conn_id: &str) -> Result<MySqlPool, String> {
    match state.backend(conn_id).await {
        Some(Backend::MySql(p)) => Ok(p),
        Some(_) => Err(format!("connection {conn_id} is not MySQL")),
        None => Err(format!("connection {conn_id} is not open")),
    }
}

// Keep Map import used.
#[allow(dead_code)]
fn _touch(_m: Map<String, Value>) {}
