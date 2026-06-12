//! MongoDB backend: database/collection listing, a pragmatic Mongo-shell
//! expression evaluator for the console, collection paging, and inline edits.

use futures::TryStreamExt;
use mongodb::bson::{doc, oid::ObjectId, Bson, Document};
use mongodb::Client;
use serde_json::Value;

use crate::models::*;

const MAX_DOCS: i64 = 1000;

pub async fn list_databases(client: &Client) -> Result<Vec<String>, String> {
    client.list_database_names().await.map_err(|e| e.to_string())
}

pub async fn list_collections(client: &Client, db: &str) -> Result<Vec<TableInfo>, String> {
    let database = client.database(db);
    let names = database
        .list_collection_names()
        .await
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(names.len());
    for n in names {
        // Best-effort document count + storage size for the tree badge. A
        // failure (e.g. on a view) must not drop the collection from the list.
        let (row_count, size_bytes) = match database.run_command(doc! { "collStats": &n }).await {
            Ok(stats) => (bson_i64(&stats, "count"), bson_i64(&stats, "size")),
            Err(_) => (0, 0),
        };
        out.push(TableInfo {
            name: n,
            schema: db.to_string(),
            kind: "collection".into(),
            row_count,
            size_bytes,
            ..Default::default()
        });
    }
    Ok(out)
}

fn bson_i64(doc: &Document, key: &str) -> i64 {
    match doc.get(key) {
        Some(Bson::Int64(v)) => *v,
        Some(Bson::Int32(v)) => *v as i64,
        Some(Bson::Double(v)) => *v as i64,
        _ => 0,
    }
}

/// Infer a pseudo-schema for a collection from a single sample document.
/// `_id` is always the first column (primary key); remaining top-level keys
/// follow in document order. Mirrors the original `inferColumns` behaviour.
pub async fn infer_schema(
    client: &Client,
    conn_id: &str,
    db: &str,
    coll: &str,
) -> Result<CachedTableSchema, String> {
    let c = client.database(db).collection::<Document>(coll);
    let sample = c.find_one(doc! {}).await.map_err(|e| e.to_string())?;

    let mut columns: Vec<CachedColumn> = Vec::new();
    let mut ordinal = 1i64;
    let mut push = |name: &str, ty: String, pk: bool, ord: &mut i64| {
        columns.push(CachedColumn {
            ordinal: *ord,
            name: name.to_string(),
            type_: ty,
            nullable: !pk,
            is_primary_key: pk,
            extra: None,
            comment: None,
        });
        *ord += 1;
    };

    match &sample {
        Some(d) => {
            let id_ty = d.get("_id").map(bson_type_name).unwrap_or_else(|| "objectId".into());
            push("_id", id_ty, true, &mut ordinal);
            for (k, v) in d.iter() {
                if k == "_id" {
                    continue;
                }
                push(k, bson_type_name(v), false, &mut ordinal);
            }
        }
        None => push("_id", "objectId".into(), true, &mut ordinal),
    }

    Ok(CachedTableSchema {
        found: true,
        conn_id: conn_id.to_string(),
        db_name: db.to_string(),
        table_name: coll.to_string(),
        kind: "collection".into(),
        row_count: -1,
        size_bytes: -1,
        columns,
        ..Default::default()
    })
}

/// List a collection's indexes as `AdvancedTableProperties` (only `indexes` is
/// populated for MongoDB; DDL/constraints/etc. are not applicable).
pub async fn advanced_properties(
    client: &Client,
    db: &str,
    coll: &str,
) -> Result<AdvancedTableProperties, String> {
    let c = client.database(db).collection::<Document>(coll);
    let mut cursor = c.list_indexes().await.map_err(|e| e.to_string())?;
    let mut indexes: Vec<IndexDetail> = Vec::new();
    while let Some(ix) = cursor.try_next().await.map_err(|e| e.to_string())? {
        let name = ix.options.as_ref().and_then(|o| o.name.clone()).unwrap_or_default();
        let unique = ix.options.as_ref().and_then(|o| o.unique).unwrap_or(false);
        let columns: Vec<String> = ix.keys.keys().cloned().collect();
        indexes.push(IndexDetail {
            name,
            type_: "BTREE".into(),
            unique,
            columns,
            comment: String::new(),
        });
    }
    Ok(AdvancedTableProperties {
        schema: db.to_string(),
        table: coll.to_string(),
        indexes,
        ..Default::default()
    })
}

fn bson_type_name(b: &Bson) -> String {
    match b {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Document(_) => "object",
        Bson::Array(_) => "array",
        Bson::Boolean(_) => "bool",
        Bson::Null | Bson::Undefined => "null",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Decimal128(_) => "decimal",
        Bson::Binary(_) => "binData",
        Bson::RegularExpression(_) => "regex",
        Bson::Timestamp(_) => "timestamp",
        Bson::JavaScriptCode(_) | Bson::JavaScriptCodeWithScope(_) => "javascript",
        Bson::Symbol(_) => "symbol",
        Bson::MinKey => "minKey",
        Bson::MaxKey => "maxKey",
        _ => "mixed",
    }
    .to_string()
}

// ── BSON → JSON cell rendering ───────────────────────────────────────────────

fn bson_cell(b: &Bson) -> Value {
    match b {
        Bson::Double(f) => serde_json::Number::from_f64(*f).map(Value::Number).unwrap_or(Value::Null),
        Bson::String(s) => Value::String(s.clone()),
        Bson::Boolean(v) => Value::Bool(*v),
        Bson::Null | Bson::Undefined => Value::Null,
        Bson::Int32(i) => Value::Number((*i as i64).into()),
        Bson::Int64(i) => Value::Number((*i).into()),
        Bson::ObjectId(oid) => Value::String(oid.to_hex()),
        Bson::DateTime(dt) => Value::String(dt.try_to_rfc3339_string().unwrap_or_else(|_| dt.to_string())),
        Bson::Decimal128(d) => Value::String(d.to_string()),
        Bson::Document(d) => Value::String(relaxed_json(&Bson::Document(d.clone()))),
        Bson::Array(_) => Value::String(relaxed_json(b)),
        Bson::RegularExpression(r) => Value::String(format!("/{}/{}", r.pattern, r.options)),
        Bson::Timestamp(t) => Value::String(format!("Timestamp({}, {})", t.time, t.increment)),
        Bson::Binary(_) => Value::String("<binary>".into()),
        other => Value::String(other.to_string()),
    }
}

fn relaxed_json(b: &Bson) -> String {
    // serde_json over Bson yields extended JSON; good enough for nested display.
    serde_json::to_string(&bson_to_plain(b)).unwrap_or_else(|_| b.to_string())
}

fn bson_to_plain(b: &Bson) -> Value {
    match b {
        Bson::Double(f) => serde_json::Number::from_f64(*f).map(Value::Number).unwrap_or(Value::Null),
        Bson::String(s) => Value::String(s.clone()),
        Bson::Boolean(v) => Value::Bool(*v),
        Bson::Null | Bson::Undefined => Value::Null,
        Bson::Int32(i) => Value::Number((*i as i64).into()),
        Bson::Int64(i) => Value::Number((*i).into()),
        Bson::ObjectId(oid) => Value::String(oid.to_hex()),
        Bson::DateTime(dt) => Value::String(dt.try_to_rfc3339_string().unwrap_or_else(|_| dt.to_string())),
        Bson::Decimal128(d) => Value::String(d.to_string()),
        Bson::Document(d) => {
            let mut m = serde_json::Map::new();
            for (k, v) in d.iter() {
                m.insert(k.clone(), bson_to_plain(v));
            }
            Value::Object(m)
        }
        Bson::Array(a) => Value::Array(a.iter().map(bson_to_plain).collect()),
        other => Value::String(other.to_string()),
    }
}

fn docs_to_result(docs: Vec<Document>, truncated: bool) -> QueryResult {
    let mut cols: Vec<String> = Vec::new();
    // _id first if present anywhere.
    if docs.iter().any(|d| d.contains_key("_id")) {
        cols.push("_id".to_string());
    }
    for d in &docs {
        for k in d.keys() {
            if k != "_id" && !cols.iter().any(|c| c == k) {
                cols.push(k.clone());
            }
        }
    }
    let columns: Vec<ColumnMeta> = cols
        .iter()
        .map(|c| ColumnMeta { name: c.clone(), type_: "document".into(), nullable: true })
        .collect();
    let rows: Vec<Vec<Value>> = docs
        .iter()
        .map(|d| cols.iter().map(|c| d.get(c).map(bson_cell).unwrap_or(Value::Null)).collect())
        .collect();
    QueryResult {
        row_count: rows.len() as i64,
        columns,
        rows,
        truncated,
        ..Default::default()
    }
}

fn text_result(text: &str) -> QueryResult {
    QueryResult {
        columns: vec![ColumnMeta { name: "result".into(), type_: "text".into(), nullable: true }],
        rows: vec![vec![Value::String(text.to_string())]],
        row_count: 1,
        ..Default::default()
    }
}

// ── Shell expression parsing ──────────────────────────────────────────────────

fn extract_balanced(s: &str) -> Option<(String, &str)> {
    // s starts with '('. Return (inner, rest_after_close).
    let bytes = s.as_bytes();
    if bytes.first() != Some(&b'(') {
        return None;
    }
    let mut depth = 0i32;
    let mut in_str: Option<u8> = None;
    let mut esc = false;
    for (i, &c) in bytes.iter().enumerate() {
        if let Some(q) = in_str {
            if esc {
                esc = false;
            } else if c == b'\\' {
                esc = true;
            } else if c == q {
                in_str = None;
            }
            continue;
        }
        match c {
            b'"' | b'\'' => in_str = Some(c),
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => {
                depth -= 1;
                if depth == 0 {
                    let inner = &s[1..i];
                    let rest = &s[i + 1..];
                    return Some((inner.to_string(), rest));
                }
            }
            _ => {}
        }
    }
    None
}

struct Call {
    method: String,
    args: String,
}

fn parse_db_expr(expr: &str) -> Option<(String, Vec<Call>)> {
    let s = expr.trim();
    let s = s.strip_prefix("db")?.trim_start();
    let s = s.strip_prefix('.')?.trim_start();
    // Collection handle is either `db.<name>.…` or `db.getCollection("<name>").…`.
    let (coll, mut rest) = if let Some(after) = s.strip_prefix("getCollection") {
        let after = after.trim_start();
        let (inner, after_close) = extract_balanced(after)?;
        let name = inner.trim().trim_matches(|c| c == '"' || c == '\'').to_string();
        let rest = after_close.trim_start().strip_prefix('.').map(|r| r.trim_start()).unwrap_or("");
        (name, rest)
    } else {
        let dot = s.find('.')?;
        (s[..dot].trim().to_string(), s[dot + 1..].trim_start())
    };
    let mut calls = Vec::new();
    while !rest.is_empty() {
        let p = rest.find('(')?;
        let method = rest[..p].trim().to_string();
        let (args, after) = extract_balanced(&rest[p..])?;
        calls.push(Call { method, args });
        rest = after.trim_start();
        if let Some(r) = rest.strip_prefix('.') {
            rest = r.trim_start();
        } else {
            break;
        }
    }
    Some((coll, calls))
}

/// Best-effort conversion of a JS object/array literal to strict JSON.
fn loosen(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    let bytes = s.as_bytes();
    let mut i = 0;
    let mut in_str: Option<u8> = None;
    let mut esc = false;
    while i < bytes.len() {
        let c = bytes[i];
        if let Some(q) = in_str {
            if esc {
                esc = false;
                out.push(c as char);
            } else if c == b'\\' {
                esc = true;
                out.push(c as char);
            } else if c == q {
                in_str = None;
                out.push('"'); // normalize closing quote to double
            } else if c == b'"' {
                out.push_str("\\\"");
            } else {
                out.push(c as char);
            }
            i += 1;
            continue;
        }
        match c {
            b'\'' | b'"' => {
                in_str = Some(c);
                out.push('"');
                i += 1;
            }
            // Quote bare identifiers used as object keys: <ident> followed by ':'
            b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' => {
                let start = i;
                while i < bytes.len()
                    && matches!(bytes[i], b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$' | b'.')
                {
                    i += 1;
                }
                let ident = &s[start..i];
                // peek next non-space
                let mut j = i;
                while j < bytes.len() && (bytes[j] as char).is_whitespace() {
                    j += 1;
                }
                if j < bytes.len() && bytes[j] == b':' && !matches!(ident, "true" | "false" | "null") {
                    out.push('"');
                    out.push_str(ident);
                    out.push('"');
                } else {
                    out.push_str(ident);
                }
            }
            _ => {
                out.push(c as char);
                i += 1;
            }
        }
    }
    out
}

fn parse_doc_arg(args: &str) -> Document {
    let t = args.trim();
    if t.is_empty() {
        return Document::new();
    }
    parse_value_to_doc(t)
}

fn parse_value_to_doc(t: &str) -> Document {
    let json = loosen(t);
    if let Ok(v) = serde_json::from_str::<Value>(&json) {
        if let Ok(Bson::Document(d)) = mongodb::bson::to_bson(&v).map(normalize_ids) {
            return d;
        }
    }
    Document::new()
}

fn parse_value(t: &str) -> Value {
    let json = loosen(t.trim());
    serde_json::from_str::<Value>(&json).unwrap_or(Value::Null)
}

/// Convert {"_id": "<24hex>"} style string ids to ObjectId where it looks like one.
fn normalize_ids(b: Bson) -> Bson {
    match b {
        Bson::Document(d) => {
            let mut out = Document::new();
            for (k, v) in d {
                let nv = if k == "_id" {
                    string_to_id(v)
                } else {
                    normalize_ids(v)
                };
                out.insert(k, nv);
            }
            Bson::Document(out)
        }
        Bson::Array(a) => Bson::Array(a.into_iter().map(normalize_ids).collect()),
        other => other,
    }
}

fn string_to_id(v: Bson) -> Bson {
    if let Bson::String(s) = &v {
        if s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit()) {
            if let Ok(oid) = ObjectId::parse_str(s) {
                return Bson::ObjectId(oid);
            }
        }
    }
    v
}

pub async fn run_console(client: &Client, db: &str, expr: &str) -> QueryResult {
    run_console_inner(client, db, expr, None, None).await
}

pub async fn run_console_page(client: &Client, db: &str, expr: &str, offset: i64, limit: i64) -> QueryResult {
    run_console_inner(client, db, expr, Some(offset.max(0) as u64), Some(if limit <= 0 { 200 } else { limit })).await
}

async fn run_console_inner(
    client: &Client,
    db: &str,
    expr: &str,
    page_skip: Option<u64>,
    page_limit: Option<i64>,
) -> QueryResult {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return QueryResult::default();
    }
    let database = client.database(db);

    // Raw command document → runCommand
    if trimmed.starts_with('{') {
        let cmd = parse_value_to_doc(trimmed);
        return match database.run_command(cmd).await {
            Ok(d) => text_result(&relaxed_json(&Bson::Document(d))),
            Err(e) => err_result(&e.to_string()),
        };
    }

    // Plain collection name → find all
    let (coll_name, calls) = match parse_db_expr(trimmed) {
        Some(v) => v,
        None => {
            // maybe "show dbs" / "show collections"
            if trimmed.eq_ignore_ascii_case("show dbs") || trimmed.eq_ignore_ascii_case("show databases") {
                return match list_databases(client).await {
                    Ok(names) => string_list_result("database", names),
                    Err(e) => err_result(&e),
                };
            }
            if trimmed.eq_ignore_ascii_case("show collections") || trimmed.eq_ignore_ascii_case("show tables") {
                return match list_collections(client, db).await {
                    Ok(ts) => string_list_result("collection", ts.into_iter().map(|t| t.name).collect()),
                    Err(e) => err_result(&e),
                };
            }
            return err_result("could not parse expression; expected db.<collection>.<method>(...) or a command document");
        }
    };

    let coll = database.collection::<Document>(&coll_name);
    let primary = match calls.first() {
        Some(c) => c,
        None => return err_result("missing collection method"),
    };

    match primary.method.as_str() {
        "find" => {
            let filter = parse_doc_arg(&primary.args);
            let mut sort: Option<Document> = None;
            let mut limit: Option<i64> = None;
            let mut skip: Option<u64> = None;
            let mut projection: Option<Document> = None;
            for c in &calls[1..] {
                match c.method.as_str() {
                    "sort" => sort = Some(parse_doc_arg(&c.args)),
                    "limit" => limit = c.args.trim().parse().ok(),
                    "skip" => skip = c.args.trim().parse().ok(),
                    "projection" => projection = Some(parse_doc_arg(&c.args)),
                    _ => {}
                }
            }
            if let Some(s) = page_skip {
                skip = Some(s);
            }
            if let Some(l) = page_limit {
                limit = Some(l);
            }
            let cap = limit.unwrap_or(MAX_DOCS).min(MAX_DOCS);
            let mut action = coll.find(filter);
            if let Some(s) = sort {
                action = action.sort(s);
            }
            if let Some(p) = projection {
                action = action.projection(p);
            }
            if let Some(sk) = skip {
                action = action.skip(sk);
            }
            action = action.limit(cap.max(0));
            match action.await {
                Ok(cursor) => collect_cursor(cursor, cap).await,
                Err(e) => err_result(&e.to_string()),
            }
        }
        "findOne" => {
            let filter = parse_doc_arg(&primary.args);
            match coll.find_one(filter).await {
                Ok(Some(d)) => docs_to_result(vec![d], false),
                Ok(None) => docs_to_result(vec![], false),
                Err(e) => err_result(&e.to_string()),
            }
        }
        "aggregate" => {
            let pipeline = parse_pipeline(&primary.args);
            match coll.aggregate(pipeline).await {
                Ok(cursor) => collect_cursor(cursor, MAX_DOCS).await,
                Err(e) => err_result(&e.to_string()),
            }
        }
        "countDocuments" | "count" => {
            let filter = parse_doc_arg(&primary.args);
            match coll.count_documents(filter).await {
                Ok(n) => count_result(n as i64),
                Err(e) => err_result(&e.to_string()),
            }
        }
        "estimatedDocumentCount" => match coll.estimated_document_count().await {
            Ok(n) => count_result(n as i64),
            Err(e) => err_result(&e.to_string()),
        },
        "distinct" => {
            let parts = split_top_args(&primary.args);
            let field = parts.get(0).map(|s| parse_value(s)).and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
            let filter = parts.get(1).map(|s| parse_value_to_doc(s)).unwrap_or_default();
            match coll.distinct(&field, filter).await {
                Ok(vals) => {
                    let items: Vec<String> = vals.iter().map(|b| bson_cell(b).to_string()).collect();
                    string_list_result(&field, items)
                }
                Err(e) => err_result(&e.to_string()),
            }
        }
        "insertOne" => {
            let d = parse_doc_arg(&primary.args);
            match coll.insert_one(d).await {
                Ok(r) => text_result(&format!("inserted: {}", bson_cell(&r.inserted_id))),
                Err(e) => err_result(&e.to_string()),
            }
        }
        "insertMany" => {
            let docs = parse_pipeline(&primary.args);
            match coll.insert_many(docs).await {
                Ok(r) => text_result(&format!("inserted {} document(s)", r.inserted_ids.len())),
                Err(e) => err_result(&e.to_string()),
            }
        }
        "updateOne" | "updateMany" => {
            let parts = split_top_args(&primary.args);
            let filter = parts.get(0).map(|s| parse_value_to_doc(s)).unwrap_or_default();
            let update = parts.get(1).map(|s| parse_value_to_doc(s)).unwrap_or_default();
            let res = if primary.method == "updateOne" {
                coll.update_one(filter, update).await
            } else {
                coll.update_many(filter, update).await
            };
            match res {
                Ok(r) => text_result(&format!("matched {}, modified {}", r.matched_count, r.modified_count)),
                Err(e) => err_result(&e.to_string()),
            }
        }
        "deleteOne" | "deleteMany" => {
            let filter = parse_doc_arg(&primary.args);
            let res = if primary.method == "deleteOne" {
                coll.delete_one(filter).await
            } else {
                coll.delete_many(filter).await
            };
            match res {
                Ok(r) => text_result(&format!("deleted {}", r.deleted_count)),
                Err(e) => err_result(&e.to_string()),
            }
        }
        other => err_result(&format!("unsupported collection method: {other}")),
    }
}

fn parse_pipeline(args: &str) -> Vec<Document> {
    let json = loosen(args.trim());
    if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&json) {
        return arr
            .into_iter()
            .filter_map(|v| match mongodb::bson::to_bson(&v).map(normalize_ids) {
                Ok(Bson::Document(d)) => Some(d),
                _ => None,
            })
            .collect();
    }
    Vec::new()
}

/// Split top-level comma-separated arguments (respecting nesting + strings).
fn split_top_args(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut in_str: Option<u8> = None;
    let mut esc = false;
    let mut start = 0usize;
    let bytes = s.as_bytes();
    for (i, &c) in bytes.iter().enumerate() {
        if let Some(q) = in_str {
            if esc {
                esc = false;
            } else if c == b'\\' {
                esc = true;
            } else if c == q {
                in_str = None;
            }
            continue;
        }
        match c {
            b'"' | b'\'' => in_str = Some(c),
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            b',' if depth == 0 => {
                parts.push(s[start..i].trim().to_string());
                start = i + 1;
            }
            _ => {}
        }
    }
    if start < s.len() {
        parts.push(s[start..].trim().to_string());
    }
    parts.into_iter().filter(|p| !p.is_empty()).collect()
}

async fn collect_cursor(mut cursor: mongodb::Cursor<Document>, cap: i64) -> QueryResult {
    let mut docs = Vec::new();
    let mut truncated = false;
    loop {
        match cursor.try_next().await {
            Ok(Some(d)) => {
                if docs.len() as i64 >= cap {
                    truncated = true;
                    break;
                }
                docs.push(d);
            }
            Ok(None) => break,
            Err(e) => return err_result(&e.to_string()),
        }
    }
    docs_to_result(docs, truncated)
}

fn err_result(msg: &str) -> QueryResult {
    QueryResult { error: msg.to_string(), ..Default::default() }
}

fn count_result(n: i64) -> QueryResult {
    QueryResult {
        columns: vec![ColumnMeta { name: "count".into(), type_: "int".into(), nullable: false }],
        rows: vec![vec![Value::Number(n.into())]],
        row_count: 1,
        ..Default::default()
    }
}

fn string_list_result(col: &str, items: Vec<String>) -> QueryResult {
    let rows: Vec<Vec<Value>> = items.into_iter().map(|s| vec![Value::String(s)]).collect();
    QueryResult {
        row_count: rows.len() as i64,
        columns: vec![ColumnMeta { name: col.to_string(), type_: "string".into(), nullable: false }],
        rows,
        ..Default::default()
    }
}

// ── Inline edits ───────────────────────────────────────────────────────────────

fn id_to_bson(v: &Value) -> Bson {
    if let Value::String(s) = v {
        if s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit()) {
            if let Ok(oid) = ObjectId::parse_str(s) {
                return Bson::ObjectId(oid);
            }
        }
    }
    mongodb::bson::to_bson(v).unwrap_or(Bson::Null)
}

fn value_to_bson(v: &Value) -> Bson {
    // Parse JSON-string cells back into structured BSON when possible.
    if let Value::String(s) = v {
        let t = s.trim();
        if (t.starts_with('{') && t.ends_with('}')) || (t.starts_with('[') && t.ends_with(']')) {
            if let Ok(parsed) = serde_json::from_str::<Value>(t) {
                return mongodb::bson::to_bson(&parsed).unwrap_or(Bson::Null);
            }
        }
    }
    mongodb::bson::to_bson(v).unwrap_or(Bson::Null)
}

pub async fn apply_changes(client: &Client, cs: &ChangeSet) -> ApplyResult {
    let start = std::time::Instant::now();
    let mut result = ApplyResult::default();
    let coll = client.database(&cs.database).collection::<Document>(&cs.table_name);
    let pk = if cs.primary_key.is_empty() { "_id".to_string() } else { cs.primary_key.clone() };

    // Deletes
    for id in &cs.deleted_ids {
        let filter = doc! { pk.clone(): id_to_bson(id) };
        match coll.delete_one(filter).await {
            Ok(r) => result.deleted_count += r.deleted_count as i64,
            Err(e) => {
                result.error = e.to_string();
                return result;
            }
        }
    }
    // Inserts
    for row in &cs.added_rows {
        if let Value::Object(map) = row {
            let mut d = Document::new();
            for (k, v) in map {
                d.insert(k.clone(), value_to_bson(v));
            }
            match coll.insert_one(d).await {
                Ok(_) => result.inserted_count += 1,
                Err(e) => {
                    result.error = e.to_string();
                    return result;
                }
            }
        }
    }
    // Updates
    for row in &cs.edited_rows {
        if let Value::Object(map) = row {
            if !map.contains_key(&pk) {
                continue;
            }
            let id = map.get(&pk).cloned().unwrap_or(Value::Null);
            let mut set_doc = Document::new();
            for (k, v) in map {
                if k != &pk {
                    set_doc.insert(k.clone(), value_to_bson(v));
                }
            }
            if set_doc.is_empty() {
                continue;
            }
            let filter = doc! { pk.clone(): id_to_bson(&id) };
            match coll.update_one(filter, doc! {"$set": set_doc}).await {
                Ok(r) => result.updated_count += r.modified_count as i64,
                Err(e) => {
                    result.error = e.to_string();
                    return result;
                }
            }
        }
    }
    result.time_ms = start.elapsed().as_millis() as i64;
    result
}
