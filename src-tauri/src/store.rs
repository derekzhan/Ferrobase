//! Local SQLite persistence: saved connections, query history, WHERE-filter
//! history, table-usage stats, and the metadata cache that powers autocomplete.

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::path::PathBuf;
use std::str::FromStr;

use crate::models::*;

pub struct OpenedDb {
    pub pool: SqlitePool,
    pub path: String,
}

fn db_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| std::env::temp_dir());
    base.join("Ferrobase")
}

pub async fn open() -> anyhow::Result<OpenedDb> {
    let dir = db_path();
    std::fs::create_dir_all(&dir).ok();
    let file = dir.join("ferrobase.db");
    let path = file.to_string_lossy().to_string();

    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .busy_timeout(std::time::Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await?;

    migrate(&pool).await?;
    Ok(OpenedDb { pool, path })
}

async fn migrate(pool: &SqlitePool) -> anyhow::Result<()> {
    let stmts = [
        "CREATE TABLE IF NOT EXISTS saved_connections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            comment TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'mysql',
            host TEXT NOT NULL DEFAULT '',
            port INTEGER NOT NULL DEFAULT 0,
            username TEXT NOT NULL DEFAULT '',
            database TEXT NOT NULL DEFAULT '',
            tls INTEGER NOT NULL DEFAULT 0,
            ssh_json TEXT NOT NULL DEFAULT '{}',
            advanced_json TEXT NOT NULL DEFAULT '[]',
            read_only INTEGER NOT NULL DEFAULT 0,
            color TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        )",
        "CREATE TABLE IF NOT EXISTS query_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conn_id TEXT NOT NULL DEFAULT '',
            db_name TEXT NOT NULL DEFAULT '',
            sql TEXT NOT NULL DEFAULT '',
            exec_ms INTEGER NOT NULL DEFAULT 0,
            error_msg TEXT NOT NULL DEFAULT '',
            executed_at TEXT NOT NULL DEFAULT ''
        )",
        "CREATE TABLE IF NOT EXISTS data_filter_history (
            conn_id TEXT NOT NULL,
            db_name TEXT NOT NULL,
            table_name TEXT NOT NULL,
            entries_json TEXT NOT NULL DEFAULT '[]',
            PRIMARY KEY (conn_id, db_name, table_name)
        )",
        "CREATE TABLE IF NOT EXISTS table_usage (
            conn_id TEXT NOT NULL,
            db_name TEXT NOT NULL,
            table_name TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            last_used_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (conn_id, db_name, table_name)
        )",
        "CREATE TABLE IF NOT EXISTS meta_tables (
            conn_id TEXT NOT NULL,
            db_name TEXT NOT NULL,
            table_name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'table',
            engine TEXT NOT NULL DEFAULT '',
            charset TEXT NOT NULL DEFAULT '',
            collation TEXT NOT NULL DEFAULT '',
            comment TEXT NOT NULL DEFAULT '',
            row_count INTEGER NOT NULL DEFAULT 0,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            auto_increment INTEGER,
            synced_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (conn_id, db_name, table_name)
        )",
        "CREATE TABLE IF NOT EXISTS meta_columns (
            conn_id TEXT NOT NULL,
            db_name TEXT NOT NULL,
            table_name TEXT NOT NULL,
            ordinal INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL DEFAULT '',
            type TEXT NOT NULL DEFAULT '',
            nullable INTEGER NOT NULL DEFAULT 1,
            is_pk INTEGER NOT NULL DEFAULT 0,
            comment TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (conn_id, db_name, table_name, ordinal, name)
        )",
    ];
    for s in stmts {
        sqlx::query(s).execute(pool).await?;
    }
    Ok(())
}

// ── Saved connections ────────────────────────────────────────────────────────

fn row_to_saved(row: &sqlx::sqlite::SqliteRow) -> SavedConnection {
    let ssh: SshConfig = serde_json::from_str(row.get::<String, _>("ssh_json").as_str())
        .unwrap_or_default();
    let advanced: Vec<AdvancedParam> =
        serde_json::from_str(row.get::<String, _>("advanced_json").as_str()).unwrap_or_default();
    SavedConnection {
        id: row.get("id"),
        name: row.get("name"),
        comment: row.get("comment"),
        kind: row.get("kind"),
        host: row.get("host"),
        port: row.get("port"),
        username: row.get("username"),
        password: String::new(), // filled from keychain by caller
        database: row.get("database"),
        tls: row.get::<i64, _>("tls") != 0,
        ssh,
        advanced_params: advanced,
        read_only: row.get::<i64, _>("read_only") != 0,
        color: row.get("color"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

pub async fn list_saved(pool: &SqlitePool) -> anyhow::Result<Vec<SavedConnection>> {
    let rows = sqlx::query("SELECT * FROM saved_connections ORDER BY sort_order ASC, created_at ASC")
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(row_to_saved).collect())
}

pub async fn get_saved(pool: &SqlitePool, id: &str) -> anyhow::Result<Option<SavedConnection>> {
    let row = sqlx::query("SELECT * FROM saved_connections WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.as_ref().map(row_to_saved))
}

pub async fn save_connection(pool: &SqlitePool, sc: &SavedConnection) -> anyhow::Result<()> {
    let ssh_json = serde_json::to_string(&sc.ssh).unwrap_or_else(|_| "{}".into());
    let adv_json = serde_json::to_string(&sc.advanced_params).unwrap_or_else(|_| "[]".into());
    let now = chrono::Utc::now().to_rfc3339();
    let created = if sc.created_at.is_empty() { now.clone() } else { sc.created_at.clone() };
    let next_order: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order)+1, 0) FROM saved_connections")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    sqlx::query(
        "INSERT INTO saved_connections
            (id,name,comment,kind,host,port,username,database,tls,ssh_json,advanced_json,read_only,color,sort_order,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, comment=excluded.comment, kind=excluded.kind, host=excluded.host,
            port=excluded.port, username=excluded.username, database=excluded.database, tls=excluded.tls,
            ssh_json=excluded.ssh_json, advanced_json=excluded.advanced_json, read_only=excluded.read_only,
            color=excluded.color, updated_at=excluded.updated_at",
    )
    .bind(&sc.id)
    .bind(&sc.name)
    .bind(&sc.comment)
    .bind(&sc.kind)
    .bind(&sc.host)
    .bind(sc.port)
    .bind(&sc.username)
    .bind(&sc.database)
    .bind(sc.tls as i64)
    .bind(&ssh_json)
    .bind(&adv_json)
    .bind(sc.read_only as i64)
    .bind(&sc.color)
    .bind(next_order)
    .bind(&created)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_saved(pool: &SqlitePool, id: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM saved_connections WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Query history ─────────────────────────────────────────────────────────────

pub async fn record_query(pool: &SqlitePool, conn_id: &str, db_name: &str, sql: &str, exec_ms: i64, error_msg: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO query_history (conn_id,db_name,sql,exec_ms,error_msg,executed_at) VALUES (?,?,?,?,?,?)",
    )
    .bind(conn_id)
    .bind(db_name)
    .bind(sql)
    .bind(exec_ms)
    .bind(error_msg)
    .bind(&now)
    .execute(pool)
    .await;
}

pub async fn query_history(pool: &SqlitePool, conn_id: &str, limit: i64) -> anyhow::Result<Vec<QueryHistoryItem>> {
    let lim = if limit <= 0 { 100 } else { limit };
    let rows = sqlx::query(
        "SELECT id,conn_id,db_name,sql,exec_ms,error_msg,executed_at FROM query_history
         WHERE conn_id = ? ORDER BY id DESC LIMIT ?",
    )
    .bind(conn_id)
    .bind(lim)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|r| QueryHistoryItem {
            id: r.get("id"),
            conn_id: r.get("conn_id"),
            db_name: r.get("db_name"),
            sql: r.get("sql"),
            exec_ms: r.get("exec_ms"),
            error_msg: r.get("error_msg"),
            executed_at: r.get("executed_at"),
        })
        .collect())
}

pub async fn clear_query_history(pool: &SqlitePool, conn_id: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM query_history WHERE conn_id = ?")
        .bind(conn_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Data filter history ─────────────────────────────────────────────────────

pub async fn get_filter_history(pool: &SqlitePool, conn_id: &str, db: &str, table: &str) -> Vec<String> {
    let row = sqlx::query(
        "SELECT entries_json FROM data_filter_history WHERE conn_id=? AND db_name=? AND table_name=?",
    )
    .bind(conn_id)
    .bind(db)
    .bind(table)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match row {
        Some(r) => serde_json::from_str(r.get::<String, _>("entries_json").as_str()).unwrap_or_default(),
        None => Vec::new(),
    }
}

pub async fn set_filter_history(pool: &SqlitePool, conn_id: &str, db: &str, table: &str, entries: &[String]) {
    let mut trimmed: Vec<String> = entries.to_vec();
    trimmed.truncate(20);
    let json = serde_json::to_string(&trimmed).unwrap_or_else(|_| "[]".into());
    let _ = sqlx::query(
        "INSERT INTO data_filter_history (conn_id,db_name,table_name,entries_json) VALUES (?,?,?,?)
         ON CONFLICT(conn_id,db_name,table_name) DO UPDATE SET entries_json=excluded.entries_json",
    )
    .bind(conn_id)
    .bind(db)
    .bind(table)
    .bind(&json)
    .execute(pool)
    .await;
}

// ── Table usage ───────────────────────────────────────────────────────────────

pub async fn record_table_usage(pool: &SqlitePool, conn_id: &str, db: &str, table: &str) {
    let now = chrono::Utc::now().timestamp();
    let _ = sqlx::query(
        "INSERT INTO table_usage (conn_id,db_name,table_name,count,last_used_at) VALUES (?,?,?,1,?)
         ON CONFLICT(conn_id,db_name,table_name) DO UPDATE SET count=count+1, last_used_at=excluded.last_used_at",
    )
    .bind(conn_id)
    .bind(db)
    .bind(table)
    .bind(now)
    .execute(pool)
    .await;
}

pub async fn table_usage(pool: &SqlitePool) -> anyhow::Result<Vec<TableUsageRow>> {
    let rows = sqlx::query(
        "SELECT conn_id,db_name,table_name,count,last_used_at FROM table_usage ORDER BY last_used_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|r| TableUsageRow {
            conn_id: r.get("conn_id"),
            db_name: r.get("db_name"),
            table_name: r.get("table_name"),
            count: r.get("count"),
            last_used_at: r.get("last_used_at"),
        })
        .collect())
}

// ── Metadata cache (autocomplete) ─────────────────────────────────────────────

pub async fn upsert_table_meta(pool: &SqlitePool, conn_id: &str, db: &str, t: &TableInfo) {
    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO meta_tables (conn_id,db_name,table_name,kind,engine,charset,collation,comment,row_count,size_bytes,auto_increment,synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(conn_id,db_name,table_name) DO UPDATE SET
            kind=excluded.kind, engine=excluded.engine, charset=excluded.charset, collation=excluded.collation,
            comment=excluded.comment, row_count=excluded.row_count, size_bytes=excluded.size_bytes,
            auto_increment=excluded.auto_increment, synced_at=excluded.synced_at",
    )
    .bind(conn_id)
    .bind(db)
    .bind(&t.name)
    .bind(&t.kind)
    .bind(&t.engine)
    .bind(&t.charset)
    .bind(&t.collation)
    .bind(&t.comment)
    .bind(t.row_count)
    .bind(t.size_bytes)
    .bind(t.auto_increment)
    .bind(&now)
    .execute(pool)
    .await;
}

pub async fn replace_columns_meta(pool: &SqlitePool, conn_id: &str, db: &str, table: &str, cols: &[CachedColumn]) {
    let _ = sqlx::query("DELETE FROM meta_columns WHERE conn_id=? AND db_name=? AND table_name=?")
        .bind(conn_id)
        .bind(db)
        .bind(table)
        .execute(pool)
        .await;
    for c in cols {
        let _ = sqlx::query(
            "INSERT OR REPLACE INTO meta_columns (conn_id,db_name,table_name,ordinal,name,type,nullable,is_pk,comment)
             VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(conn_id)
        .bind(db)
        .bind(table)
        .bind(c.ordinal)
        .bind(&c.name)
        .bind(&c.type_)
        .bind(c.nullable as i64)
        .bind(c.is_primary_key as i64)
        .bind(c.comment.clone().unwrap_or_default())
        .execute(pool)
        .await;
    }
}

pub async fn meta_counts(pool: &SqlitePool, conn_id: &str) -> (i64, i64) {
    let t: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meta_tables WHERE conn_id=?")
        .bind(conn_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    let c: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meta_columns WHERE conn_id=?")
        .bind(conn_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0);
    (t, c)
}

pub async fn search_completions(pool: &SqlitePool, conn_id: &str, db: &str, keyword: &str) -> Vec<CompletionItem> {
    let kw = format!("{}%", keyword.replace('%', "\\%"));
    let mut out = Vec::new();
    // Tables
    if let Ok(rows) = sqlx::query(
        "SELECT DISTINCT table_name, kind, comment FROM meta_tables
         WHERE conn_id=? AND db_name=? AND table_name LIKE ? ESCAPE '\\' ORDER BY table_name LIMIT 50",
    )
    .bind(conn_id)
    .bind(db)
    .bind(&kw)
    .fetch_all(pool)
    .await
    {
        for r in rows {
            out.push(CompletionItem {
                kind: "table".into(),
                label: r.get("table_name"),
                detail: r.get::<String, _>("comment"),
                db_name: db.to_string(),
                table_name: r.get("table_name"),
                is_primary_key: false,
            });
        }
    }
    // Columns
    if let Ok(rows) = sqlx::query(
        "SELECT name, type, table_name, is_pk FROM meta_columns
         WHERE conn_id=? AND db_name=? AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 100",
    )
    .bind(conn_id)
    .bind(db)
    .bind(&kw)
    .fetch_all(pool)
    .await
    {
        for r in rows {
            out.push(CompletionItem {
                kind: "column".into(),
                label: r.get("name"),
                detail: r.get::<String, _>("type"),
                db_name: db.to_string(),
                table_name: r.get("table_name"),
                is_primary_key: r.get::<i64, _>("is_pk") != 0,
            });
        }
    }
    out
}

pub async fn cached_tables(pool: &SqlitePool, conn_id: &str, db: &str) -> Vec<CachedTableEntry> {
    let rows = sqlx::query(
        "SELECT table_name, engine, size_bytes, comment FROM meta_tables WHERE conn_id=? AND db_name=? ORDER BY table_name",
    )
    .bind(conn_id)
    .bind(db)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.iter()
        .map(|r| CachedTableEntry {
            table_name: r.get("table_name"),
            engine: r.get("engine"),
            size_bytes: r.get("size_bytes"),
            comment: r.get("comment"),
            columns: None,
        })
        .collect()
}

pub async fn cached_databases(pool: &SqlitePool, conn_id: &str) -> Vec<String> {
    sqlx::query_scalar("SELECT DISTINCT db_name FROM meta_tables WHERE conn_id=? ORDER BY db_name")
        .bind(conn_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default()
}

pub async fn cached_table_schema(pool: &SqlitePool, conn_id: &str, db: &str, table: &str) -> Option<CachedTableSchema> {
    let trow = sqlx::query("SELECT * FROM meta_tables WHERE conn_id=? AND db_name=? AND table_name=?")
        .bind(conn_id)
        .bind(db)
        .bind(table)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()?;
    let crows = sqlx::query(
        "SELECT ordinal,name,type,nullable,is_pk,comment FROM meta_columns
         WHERE conn_id=? AND db_name=? AND table_name=? ORDER BY ordinal",
    )
    .bind(conn_id)
    .bind(db)
    .bind(table)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let columns = crows
        .iter()
        .map(|r| CachedColumn {
            ordinal: r.get("ordinal"),
            name: r.get("name"),
            type_: r.get("type"),
            nullable: r.get::<i64, _>("nullable") != 0,
            is_primary_key: r.get::<i64, _>("is_pk") != 0,
            extra: None,
            comment: Some(r.get::<String, _>("comment")),
        })
        .collect();
    Some(CachedTableSchema {
        found: true,
        conn_id: conn_id.to_string(),
        db_name: db.to_string(),
        table_name: table.to_string(),
        kind: trow.get("kind"),
        row_count: trow.get("row_count"),
        size_bytes: trow.get("size_bytes"),
        synced_at: trow.get("synced_at"),
        comment: trow.get("comment"),
        engine: trow.get("engine"),
        charset: trow.get("charset"),
        collation: trow.get("collation"),
        auto_increment: trow.get("auto_increment"),
        columns,
    })
}
