//! Generic IPC dispatcher. The frontend calls `bridge_call(method, args)` for
//! every backend method (mirroring the Wails `window.go.main.App.<Method>` API).
//! This module deserializes the positional args and routes to the right
//! implementation, returning a JSON value (or an error string).

use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::conn;
use crate::models::*;
use crate::secret;
use crate::state::{AppState, Backend, LiveConn};
use crate::{mongo, mysql, redis_drv};

// ── arg helpers ───────────────────────────────────────────────────────────────

#[allow(dead_code)]
fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or(Value::Null)
}
fn arg_str(args: &[Value], i: usize) -> String {
    match args.get(i) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(v) => v.to_string(),
    }
}
fn arg_i64(args: &[Value], i: usize) -> i64 {
    match args.get(i) {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)).unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}
fn arg_u64(args: &[Value], i: usize) -> u64 {
    match args.get(i) {
        Some(Value::Number(n)) => n.as_u64().or_else(|| n.as_f64().map(|f| f as u64)).unwrap_or(0),
        Some(Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}
fn arg_f64(args: &[Value], i: usize) -> f64 {
    match args.get(i) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.parse().unwrap_or(0.0),
        _ => 0.0,
    }
}
fn arg_bool(args: &[Value], i: usize) -> bool {
    matches!(args.get(i), Some(Value::Bool(true)))
}
fn arg_de<T: DeserializeOwned + Default>(args: &[Value], i: usize) -> Result<T, String> {
    match args.get(i) {
        Some(v) if !v.is_null() => serde_json::from_value(v.clone()).map_err(|e| e.to_string()),
        _ => Ok(T::default()),
    }
}

fn ok<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

pub async fn dispatch(
    app: AppHandle,
    state: &AppState,
    method: &str,
    args: Vec<Value>,
) -> Result<Value, String> {
    let a = &args;
    match method {
        // ── App / build / misc ────────────────────────────────────────────
        "InitLocalDB" => Ok(Value::Null),
        "GetDBPath" => ok(state.db_path.clone()),
        "GetBuildInfo" => ok(build_info()),
        "BrowserOpenURL" => {
            let url = arg_str(a, 0);
            let _ = open::that(url);
            Ok(Value::Null)
        }
        "Quit" => {
            app.exit(0);
            Ok(Value::Null)
        }
        "OpenFileDialog" => open_file_dialog(&app, arg_str(a, 0)).await,
        "SaveTextFile" => save_text_file(&app, arg_str(a, 0), arg_str(a, 1)).await,
        "PickColor" => ok(arg_str(a, 0)),

        // ── Connection management ──────────────────────────────────────────
        "AddConnection" => add_connection(state, arg_de::<ConnectionConfig>(a, 0)?).await,
        "Connect" => connect(state, arg_de::<ConnectionConfig>(a, 0)?).await,
        "ConnectSaved" => connect_saved(state, arg_str(a, 0)).await,
        "Disconnect" | "RemoveConnection" => disconnect(state, arg_str(a, 0)).await,
        "ListConnections" => list_connections(state).await,
        "TestConnection" => test_connection(arg_de::<SavedConnection>(a, 0)?).await,
        "SaveConnection" => save_connection(state, arg_de::<SavedConnection>(a, 0)?).await,
        "ListSavedConnections" => list_saved_connections(state).await,
        "GetSavedConnection" => get_saved_connection(state, arg_str(a, 0)).await,
        "DeleteSavedConnection" => delete_saved_connection(state, arg_str(a, 0)).await,

        // ── Query history / filter / usage ─────────────────────────────────
        "GetDataFilterHistory" => {
            ok(crate::store::get_filter_history(&state.store, &arg_str(a, 0), &arg_str(a, 1), &arg_str(a, 2)).await)
        }
        "SetDataFilterHistory" => {
            let entries: Vec<String> = arg_de(a, 3)?;
            crate::store::set_filter_history(&state.store, &arg_str(a, 0), &arg_str(a, 1), &arg_str(a, 2), &entries).await;
            Ok(Value::Null)
        }
        "GetTableUsage" => ok(crate::store::table_usage(&state.store).await.map_err(|e| e.to_string())?),
        "RecordTableUsage" => {
            crate::store::record_table_usage(&state.store, &arg_str(a, 0), &arg_str(a, 1), &arg_str(a, 2)).await;
            Ok(Value::Null)
        }
        "GetQueryHistory" => {
            ok(crate::store::query_history(&state.store, &arg_str(a, 0), arg_i64(a, 1)).await.map_err(|e| e.to_string())?)
        }
        "ClearQueryHistory" => {
            crate::store::clear_query_history(&state.store, &arg_str(a, 0)).await.map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "CancelQuery" => {
            let qid = arg_str(a, 0);
            if let Some(h) = state.query_cancels.lock().await.remove(&qid) {
                h.notify_one();
            }
            Ok(Value::Null)
        }
        "KillQuery" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::kill_query(&pool, arg_i64(a, 1)).await)
        }

        // ── Metadata ───────────────────────────────────────────────────────
        "FetchDatabases" => {
            let conn_id = arg_str(a, 0);
            match state.ensure_live(&conn_id).await? {
                Backend::MySql(pool) => ok(mysql::fetch_databases(&pool).await?),
                Backend::Mongo(client) => ok(mongo::list_databases(&client).await?),
                Backend::Redis(client) => ok(redis_drv::databases(&client).await?),
            }
        }
        "FetchTables" => fetch_tables(state, arg_str(a, 0), arg_str(a, 1)).await,
        "GetTableSchema" => get_table_schema(state, arg_str(a, 0), arg_str(a, 1), arg_str(a, 2)).await,
        "RefreshTableMetadata" => {
            refresh_table_metadata(state, arg_str(a, 0), arg_str(a, 1), arg_str(a, 2)).await?;
            Ok(Value::Null)
        }
        "GetTableAdvancedProperties" => {
            let conn_id = arg_str(a, 0);
            match state.ensure_live(&conn_id).await? {
                Backend::MySql(pool) => ok(mysql::advanced_properties(&pool, &arg_str(a, 1), &arg_str(a, 2)).await?),
                Backend::Mongo(client) => ok(mongo::advanced_properties(&client, &arg_str(a, 1), &arg_str(a, 2)).await?),
                Backend::Redis(_) => ok(AdvancedTableProperties::default()),
            }
        }
        "FetchRoutines" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::fetch_routines(&pool, &arg_str(a, 1)).await.map_err(|e| e)?)
        }
        "FetchTriggers" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::fetch_triggers(&pool, &arg_str(a, 1)).await.map_err(|e| e)?)
        }
        "FetchEvents" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::fetch_events(&pool, &arg_str(a, 1)).await.map_err(|e| e)?)
        }
        "SearchCompletions" => {
            ok(crate::store::search_completions(&state.store, &arg_str(a, 0), &arg_str(a, 1), &arg_str(a, 2)).await)
        }
        "TriggerSync" | "SyncMetadata" => {
            trigger_sync(state, arg_str(a, 0)).await;
            Ok(Value::Null)
        }
        "GetSyncState" => ok(get_sync_state(state, arg_str(a, 0)).await),
        "GetTablesFromCache" => {
            ok(crate::store::cached_tables(&state.store, &arg_str(a, 0), &arg_str(a, 1)).await)
        }
        "GetDatabasesFromCache" => ok(crate::store::cached_databases(&state.store, &arg_str(a, 0)).await),
        "GetTableDetailFromCache" => {
            let conn_id = arg_str(a, 0);
            let db = arg_str(a, 1);
            let table = arg_str(a, 2);
            if let Some(s) = crate::store::cached_table_schema(&state.store, &conn_id, &db, &table).await {
                let cols: Vec<CachedColumn> = s.columns.clone();
                ok(CachedTableEntry {
                    table_name: table,
                    engine: s.engine,
                    size_bytes: s.size_bytes,
                    comment: s.comment,
                    columns: Some(cols),
                })
            } else {
                Ok(Value::Null)
            }
        }

        // ── Query execution ────────────────────────────────────────────────
        "RunQuery" => run_query(state, String::new(), arg_str(a, 0), arg_str(a, 1), arg_str(a, 2)).await,
        "RunQueryWithID" => run_query(state, arg_str(a, 0), arg_str(a, 1), arg_str(a, 2), arg_str(a, 3)).await,
        "RunQueryPage" => {
            run_query_page(state, arg_str(a, 0), arg_str(a, 1), arg_str(a, 2), arg_i64(a, 3), arg_i64(a, 4)).await
        }
        "RunQueryPageWithID" => {
            run_query_page(state, arg_str(a, 1), arg_str(a, 2), arg_str(a, 3), arg_i64(a, 4), arg_i64(a, 5)).await
        }
        "ExecuteQuery" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::exec_query(&pool, &arg_str(a, 1), arg_i64(a, 2)).await)
        }
        "ExecDML" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::exec_dml(&pool, &arg_str(a, 1)).await)
        }

        // ── Inline edit / apply ────────────────────────────────────────────
        "ApplyChanges" => {
            let cs: ChangeSet = arg_de(a, 0)?;
            let pool = state.mysql_pool(&cs.connection_id).await?;
            ok(mysql::apply_changes(&pool, &cs).await)
        }
        "ApplyMongoChanges" => {
            let cs: ChangeSet = arg_de(a, 0)?;
            let client = state.mongo_client(&cs.connection_id).await?;
            ok(mongo::apply_changes(&client, &cs).await)
        }

        // ── Schema alters ──────────────────────────────────────────────────
        "PreviewTableAlter" => ok(mysql::preview_table_alter(&arg_de::<SchemaChangeRequest>(a, 1)?)),
        "ExecuteTableAlter" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::execute_table_alter(&pool, &arg_de::<SchemaChangeRequest>(a, 1)?).await)
        }
        "PreviewIndexAlter" => ok(mysql::preview_index_alter(&arg_de::<IndexChangeRequest>(a, 1)?)),
        "ExecuteIndexAlter" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::execute_index_alter(&pool, &arg_de::<IndexChangeRequest>(a, 1)?).await)
        }
        "PreviewConstraintAlter" => ok(mysql::preview_constraint_alter(&arg_de::<ConstraintChangeRequest>(a, 1)?)),
        "ExecuteConstraintAlter" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::execute_constraint_alter(&pool, &arg_de::<ConstraintChangeRequest>(a, 1)?).await)
        }
        "PreviewPartitionAlter" => ok(mysql::preview_partition_alter(&arg_de::<PartitionChangeRequest>(a, 1)?)),
        "ExecutePartitionAlter" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::execute_partition_alter(&pool, &arg_de::<PartitionChangeRequest>(a, 1)?).await)
        }

        // ── Copy / export ──────────────────────────────────────────────────
        "CopyTable" => {
            let cfg: CopyTableConfig = arg_de(a, 0)?;
            ok(mysql::copy_table(app, state, cfg).await)
        }
        "CopyDatabase" => {
            let cfg: CopyDatabaseConfig = arg_de(a, 0)?;
            ok(mysql::copy_database(app, state, cfg).await)
        }
        "CancelCopy" => {
            state.copy_cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(Value::Null)
        }
        "ExportDump" => {
            let pool = state.mysql_pool(&arg_str(a, 0)).await?;
            ok(mysql::export_dump(&pool, &arg_str(a, 1), &arg_str(a, 2)).await.map_err(|e| e)?)
        }

        // ── Redis ──────────────────────────────────────────────────────────
        m if m.starts_with("Redis") => dispatch_redis(app, state, m, a).await,

        other => Err(format!("unknown method: {other}")),
    }
}

// ── Redis dispatch ──────────────────────────────────────────────────────────

async fn dispatch_redis(app: AppHandle, state: &AppState, method: &str, a: &[Value]) -> Result<Value, String> {
    // RedisDecodeValue is the only Redis method that does not need a connection.
    if method == "RedisDecodeValue" {
        return ok(redis_drv::decode_value(&arg_str(a, 0), &arg_str(a, 1)));
    }
    if method == "RedisUnsubscribe" {
        let sub = arg_str(a, 0);
        if let Some(h) = state.redis_subs.lock().await.remove(&sub) {
            h.abort();
        }
        return Ok(Value::Null);
    }
    let conn_id = arg_str(a, 0);
    let client = state.redis_client(&conn_id).await?;
    match method {
        "RedisDatabases" => ok(redis_drv::databases(&client).await?),
        "RedisDBSize" => ok(redis_drv::dbsize(&client, arg_i64(a, 1)).await?),
        "RedisScanKeys" => ok(redis_drv::scan_keys(&client, arg_i64(a, 1), &arg_str(a, 2), arg_u64(a, 3), arg_i64(a, 4)).await?),
        "RedisGetKey" => ok(redis_drv::get_key(&client, arg_i64(a, 1), &arg_str(a, 2)).await?),
        "RedisSetString" => {
            redis_drv::set_string(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3), arg_i64(a, 4)).await?;
            Ok(Value::Null)
        }
        "RedisHashSet" => {
            redis_drv::hash_set(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3), &arg_str(a, 4)).await?;
            Ok(Value::Null)
        }
        "RedisHashDelete" => {
            redis_drv::hash_delete(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3)).await?;
            Ok(Value::Null)
        }
        "RedisListSet" => {
            redis_drv::list_set(&client, arg_i64(a, 1), &arg_str(a, 2), arg_i64(a, 3), &arg_str(a, 4)).await?;
            Ok(Value::Null)
        }
        "RedisListPush" => {
            redis_drv::list_push(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3), arg_bool(a, 4)).await?;
            Ok(Value::Null)
        }
        "RedisListRemove" => {
            redis_drv::list_remove(&client, arg_i64(a, 1), &arg_str(a, 2), arg_i64(a, 3), &arg_str(a, 4)).await?;
            Ok(Value::Null)
        }
        "RedisSetAdd" => {
            redis_drv::set_add(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3)).await?;
            Ok(Value::Null)
        }
        "RedisSetRemove" => {
            redis_drv::set_remove(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3)).await?;
            Ok(Value::Null)
        }
        "RedisZAdd" => {
            redis_drv::zadd(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3), arg_f64(a, 4)).await?;
            Ok(Value::Null)
        }
        "RedisZRemove" => {
            redis_drv::zremove(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3)).await?;
            Ok(Value::Null)
        }
        "RedisStreamAdd" => {
            let fields: std::collections::BTreeMap<String, String> = arg_de(a, 4)?;
            ok(redis_drv::stream_add(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3), &fields).await?)
        }
        "RedisStreamDelete" => {
            redis_drv::stream_delete(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3)).await?;
            Ok(Value::Null)
        }
        "RedisRenameKey" => {
            redis_drv::rename_key(&client, arg_i64(a, 1), &arg_str(a, 2), &arg_str(a, 3)).await?;
            Ok(Value::Null)
        }
        "RedisDeleteKey" => {
            redis_drv::delete_key(&client, arg_i64(a, 1), &arg_str(a, 2)).await?;
            Ok(Value::Null)
        }
        "RedisSetTTL" => {
            redis_drv::set_ttl(&client, arg_i64(a, 1), &arg_str(a, 2), arg_i64(a, 3)).await?;
            Ok(Value::Null)
        }
        "RedisExecCommand" => ok(redis_drv::exec_command(&client, arg_i64(a, 1), &arg_str(a, 2)).await),
        "RedisServerInfo" => ok(redis_drv::server_info(&client).await?),
        "RedisSlowLog" => ok(redis_drv::slowlog(&client, arg_i64(a, 1)).await?),
        "RedisClientList" => ok(redis_drv::client_list(&client).await?),
        "RedisSubscribe" => {
            let channels: Vec<String> = arg_de(a, 1)?;
            let patterns: Vec<String> = arg_de(a, 2)?;
            ok(redis_drv::subscribe(app, state, &conn_id, client, channels, patterns).await?)
        }
        other => Err(format!("unknown redis method: {other}")),
    }
}

// ── Connection management impl ────────────────────────────────────────────────

async fn add_connection(state: &AppState, mut cfg: ConnectionConfig) -> Result<Value, String> {
    if cfg.id.is_empty() {
        return Err("connection ID must not be empty".into());
    }
    if cfg.password.is_empty() {
        let pw = secret::get_password(&cfg.id);
        if !pw.is_empty() {
            cfg.password = pw;
        }
    }
    let (backend, version) = conn::open_backend(&cfg).await?;
    let id = cfg.id.clone();
    state.conns.write().await.insert(
        id.clone(),
        LiveConn { backend, config: cfg.clone(), server_version: version },
    );
    spawn_sync(state, &id);
    ok(id)
}

async fn connect(state: &AppState, mut cfg: ConnectionConfig) -> Result<Value, String> {
    if cfg.id.is_empty() {
        cfg.id = uuid::Uuid::new_v4().to_string();
    }
    if cfg.password.is_empty() {
        let pw = secret::get_password(&cfg.id);
        if !pw.is_empty() {
            cfg.password = pw;
        }
    }
    match conn::open_backend(&cfg).await {
        Ok((backend, version)) => {
            let id = cfg.id.clone();
            state.conns.write().await.insert(
                id.clone(),
                LiveConn { backend, config: cfg.clone(), server_version: version.clone() },
            );
            spawn_sync(state, &id);
            ok(ConnectResult { connection_id: id, server_version: version, error: String::new() })
        }
        Err(e) => ok(ConnectResult { connection_id: String::new(), server_version: String::new(), error: e }),
    }
}

async fn connect_saved(state: &AppState, id: String) -> Result<Value, String> {
    let saved = crate::store::get_saved(&state.store, &id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("saved connection {id} not found"))?;
    let mut cfg = saved.to_config();
    cfg.password = secret::get_password(&id);
    let (backend, version) = conn::open_backend(&cfg).await?;
    state.conns.write().await.insert(
        id.clone(),
        LiveConn { backend, config: cfg, server_version: version },
    );
    spawn_sync(state, &id);
    ok(id)
}

async fn disconnect(state: &AppState, id: String) -> Result<Value, String> {
    state.conns.write().await.remove(&id);
    Ok(Value::Null)
}

async fn list_connections(state: &AppState) -> Result<Value, String> {
    let mut out: Vec<ConnectionInfo> = Vec::new();
    let saved = crate::store::list_saved(&state.store).await.unwrap_or_default();
    let live = state.conns.read().await;
    for sc in &saved {
        let (connected, version) = match live.get(&sc.id) {
            Some(c) => (true, c.server_version.clone()),
            None => (false, String::new()),
        };
        out.push(ConnectionInfo {
            id: sc.id.clone(),
            name: sc.name.clone(),
            kind: sc.kind.clone(),
            host: sc.host.clone(),
            port: sc.port,
            database: sc.database.clone(),
            server_version: version,
            connected,
            color: sc.color.clone(),
            read_only: sc.read_only,
        });
    }
    // Append live-only (unsaved) connections.
    for (id, c) in live.iter() {
        if saved.iter().any(|s| &s.id == id) {
            continue;
        }
        out.push(ConnectionInfo {
            id: id.clone(),
            name: c.config.name.clone(),
            kind: conn::normalized_kind(&c.config.kind).to_string(),
            host: c.config.host.clone(),
            port: c.config.port,
            database: c.config.database.clone(),
            server_version: c.server_version.clone(),
            connected: true,
            color: c.config.color.clone(),
            read_only: c.config.read_only,
        });
    }
    ok(out)
}

async fn test_connection(sc: SavedConnection) -> Result<Value, String> {
    let cfg = sc.to_config();
    match conn::open_backend(&cfg).await {
        Ok((_, version)) => ok(if version.is_empty() { "OK".to_string() } else { version }),
        Err(e) => Err(e),
    }
}

async fn save_connection(state: &AppState, mut sc: SavedConnection) -> Result<Value, String> {
    if sc.id.is_empty() {
        sc.id = uuid::Uuid::new_v4().to_string();
    }
    secret::set_password(&sc.id, &sc.password);
    crate::store::save_connection(&state.store, &sc).await.map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

async fn list_saved_connections(state: &AppState) -> Result<Value, String> {
    let mut saved = crate::store::list_saved(&state.store).await.map_err(|e| e.to_string())?;
    for sc in &mut saved {
        sc.password = secret::get_password(&sc.id);
    }
    ok(saved)
}

async fn get_saved_connection(state: &AppState, id: String) -> Result<Value, String> {
    match crate::store::get_saved(&state.store, &id).await.map_err(|e| e.to_string())? {
        Some(mut sc) => {
            sc.password = secret::get_password(&id);
            ok(sc)
        }
        None => Err(format!("saved connection {id} not found")),
    }
}

async fn delete_saved_connection(state: &AppState, id: String) -> Result<Value, String> {
    state.conns.write().await.remove(&id);
    secret::delete_password(&id);
    crate::store::delete_saved(&state.store, &id).await.map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

// ── Metadata helpers ──────────────────────────────────────────────────────────

async fn fetch_tables(state: &AppState, conn_id: String, db: String) -> Result<Value, String> {
    match state.ensure_live(&conn_id).await? {
        Backend::MySql(pool) => {
            let tables = mysql::fetch_tables(&pool, &db).await?;
            // cache for completions
            for t in &tables {
                crate::store::upsert_table_meta(&state.store, &conn_id, &db, t).await;
            }
            ok(tables)
        }
        Backend::Mongo(client) => ok(mongo::list_collections(&client, &db).await?),
        Backend::Redis(_) => ok(Vec::<TableInfo>::new()),
    }
}

async fn get_table_schema(state: &AppState, conn_id: String, db: String, table: String) -> Result<Value, String> {
    match state.ensure_live(&conn_id).await {
        Ok(Backend::MySql(pool)) => match mysql::get_table_schema(&pool, &conn_id, &db, &table).await {
            Ok(schema) => {
                crate::store::replace_columns_meta(&state.store, &conn_id, &db, &table, &schema.columns).await;
                return ok(schema);
            }
            Err(e) => return Err(e),
        },
        Ok(Backend::Mongo(client)) => {
            if let Ok(schema) = mongo::infer_schema(&client, &conn_id, &db, &table).await {
                return ok(schema);
            }
        }
        _ => {}
    }
    // Fallback to cache.
    if let Some(s) = crate::store::cached_table_schema(&state.store, &conn_id, &db, &table).await {
        ok(s)
    } else {
        ok(CachedTableSchema { found: false, conn_id, db_name: db, table_name: table, ..Default::default() })
    }
}

async fn refresh_table_metadata(state: &AppState, conn_id: String, db: String, table: String) -> Result<(), String> {
    if let Some(pool) = mysql_pool_opt(state, &conn_id).await {
        if let Ok(schema) = mysql::get_table_schema(&pool, &conn_id, &db, &table).await {
            crate::store::replace_columns_meta(&state.store, &conn_id, &db, &table, &schema.columns).await;
        }
    }
    Ok(())
}

async fn mysql_pool_opt(state: &AppState, conn_id: &str) -> Option<sqlx::MySqlPool> {
    // Lazily (re)open; on failure (server down, etc.) callers fall back to cache.
    match state.ensure_live(conn_id).await {
        Ok(Backend::MySql(p)) => Some(p),
        _ => None,
    }
}

fn spawn_sync(state: &AppState, conn_id: &str) {
    // metadata sync runs in dispatch path lazily; explicit sync via TriggerSync.
    let _ = (state, conn_id);
}

async fn trigger_sync(state: &AppState, conn_id: String) {
    let pool = match mysql_pool_opt(state, &conn_id).await {
        Some(p) => p,
        None => return,
    };
    {
        let mut s = state.sync_states.write().await;
        s.insert(conn_id.clone(), SyncStatus { conn_id: conn_id.clone(), state: "syncing".into(), ..Default::default() });
    }
    let dbs = mysql::fetch_databases(&pool).await.unwrap_or_default();
    for db in &dbs {
        if let Ok(tables) = mysql::fetch_tables(&pool, db).await {
            for t in &tables {
                crate::store::upsert_table_meta(&state.store, &conn_id, db, t).await;
                if let Ok(cols) = mysql::table_columns(&pool, db, &t.name).await {
                    crate::store::replace_columns_meta(&state.store, &conn_id, db, &t.name, &cols).await;
                }
            }
        }
    }
    let (tc, cc) = crate::store::meta_counts(&state.store, &conn_id).await;
    let mut s = state.sync_states.write().await;
    s.insert(
        conn_id.clone(),
        SyncStatus {
            conn_id,
            state: "ready".into(),
            tables_count: tc,
            cols_count: cc,
            last_sync_at: chrono::Utc::now().to_rfc3339(),
            error_msg: None,
        },
    );
}

async fn get_sync_state(state: &AppState, conn_id: String) -> SyncStatus {
    if let Some(s) = state.sync_states.read().await.get(&conn_id) {
        return s.clone();
    }
    let (tc, cc) = crate::store::meta_counts(&state.store, &conn_id).await;
    SyncStatus {
        conn_id,
        state: if tc > 0 { "ready".into() } else { "idle".into() },
        tables_count: tc,
        cols_count: cc,
        last_sync_at: String::new(),
        error_msg: None,
    }
}

// ── Query execution impl ──────────────────────────────────────────────────────

async fn run_query(state: &AppState, query_id: String, conn_id: String, db: String, sql: String) -> Result<Value, String> {
    let started = std::time::Instant::now();
    // MongoDB connections route SQL-console text to the Mongo shell evaluator.
    if let Backend::Mongo(client) = state.ensure_live(&conn_id).await? {
        let res = mongo::run_console(&client, &db, &sql).await;
        record_history(state, &conn_id, &db, &sql, started.elapsed().as_millis() as i64, &res.error).await;
        return ok(res);
    }
    let pool = state.mysql_pool(&conn_id).await?;
    let result = if query_id.is_empty() {
        mysql::run_query(pool, db.clone(), sql.clone()).await
    } else {
        // Awaited inline (not spawned): the unprepared `raw_sql` query future is
        // not `Send + 'static`-general enough for `tokio::spawn`, so we model
        // cancellation by racing it against a `Notify` and dropping it on cancel.
        let cancel = std::sync::Arc::new(tokio::sync::Notify::new());
        state.query_cancels.lock().await.insert(query_id.clone(), cancel.clone());
        let r = tokio::select! {
            r = mysql::run_query(pool, db.clone(), sql.clone()) => r,
            _ = cancel.notified() => QueryResult { error: "query cancelled".into(), ..Default::default() },
        };
        state.query_cancels.lock().await.remove(&query_id);
        r
    };
    record_history(state, &conn_id, &db, &sql, started.elapsed().as_millis() as i64, &result.error).await;
    ok(result)
}

async fn run_query_page(state: &AppState, conn_id: String, db: String, sql: String, offset: i64, limit: i64) -> Result<Value, String> {
    if let Backend::Mongo(client) = state.ensure_live(&conn_id).await? {
        return ok(mongo::run_console_page(&client, &db, &sql, offset, limit).await);
    }
    let pool = state.mysql_pool(&conn_id).await?;
    ok(mysql::run_query_page(&pool, &db, &sql, offset, limit).await)
}

async fn record_history(state: &AppState, conn_id: &str, db: &str, sql: &str, exec_ms: i64, error: &str) {
    crate::store::record_query(&state.store, conn_id, db, sql, exec_ms, error).await;
}

// ── Dialogs ───────────────────────────────────────────────────────────────────

async fn open_file_dialog(app: &AppHandle, _title: String) -> Result<Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_file(move |path| {
        let _ = tx.send(path.map(|p| p.to_string()));
    });
    let picked = rx.await.map_err(|e| e.to_string())?;
    ok(picked.unwrap_or_default())
}

async fn save_text_file(app: &AppHandle, default_filename: String, content: String) -> Result<Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&default_filename)
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let picked = rx.await.map_err(|e| e.to_string())?;
    match picked {
        Some(fp) => {
            let path = fp.to_string();
            std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
            ok(path)
        }
        None => ok(""),
    }
}

fn build_info() -> BuildInfo {
    BuildInfo {
        name: "Ferrobase".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        build_date: "".into(),
        platform: format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH),
        go_version: format!("rust/{}", "tauri-2"),
        license: "MIT".into(),
        author: "Ferrobase Contributors".into(),
        email: "alexzhan037@gmail.com".into(),
        homepage: "https://github.com/derekzhan/Ferrobase".into(),
    }
}

// Silence unused import warnings for json! used only in some builds.
#[allow(dead_code)]
fn _unused() {
    let _ = json!({});
}
