use crate::error::{AppError, Result};
use crate::models::ColumnDetail;
use futures::TryStreamExt;
use mongodb::{
    bson::{self, Bson, Document},
    options::ClientOptions,
    Client,
};
use std::str::FromStr;
use std::collections::BTreeMap;
use serde_json::Value;

pub fn bson_to_json_value(value: Bson) -> Value {
    value.into_canonical_extjson()
}

pub fn bson_doc_to_json_value(doc: Document) -> Value {
    bson_to_json_value(Bson::Document(doc))
}

pub async fn connect(url: &str, timeout_secs: u32) -> Result<Client> {
    let mut options = ClientOptions::parse(url)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

    options.connect_timeout = Some(std::time::Duration::from_secs(timeout_secs as u64));
    options.server_selection_timeout = Some(std::time::Duration::from_secs(timeout_secs as u64));

    Client::with_options(options).map_err(|e| AppError::Connection(e.to_string()))
}

pub async fn test_connection(client: &Client) -> Result<()> {
    client
        .list_database_names()
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
    Ok(())
}

pub async fn list_databases(client: &Client) -> Result<Vec<String>> {
    client
        .list_database_names()
        .await
        .map_err(|e| AppError::Database(e.to_string()))
}

pub async fn list_collections(client: &Client, database: &str) -> Result<Vec<String>> {
    let db = client.database(database);
    db.list_collection_names()
        .await
        .map_err(|e| AppError::Database(e.to_string()))
}

pub async fn query_collection(
    client: &Client,
    database: &str,
    collection: &str,
    filter: Option<Document>,
    projection: Option<Document>,
    sort: Option<Document>,
    limit: i64,
    skip: u64,
) -> Result<Vec<Value>> {
    let db = client.database(database);
    let coll = db.collection::<Document>(collection);

    // Use the builder pattern API (mongodb 3.x)
    let mut find = coll.find(filter.unwrap_or_default());
    if let Some(s) = sort {
        find = find.sort(s);
    }
    if let Some(p) = projection {
        find = find.projection(p);
    }
    find = find.limit(limit).skip(skip);

    let mut cursor = find.await.map_err(|e| AppError::Query(e.to_string()))?;

    let mut results = Vec::new();
    while let Some(doc) = cursor
        .try_next()
        .await
        .map_err(|e| AppError::Query(e.to_string()))?
    {
        results.push(bson_doc_to_json_value(doc));
    }
    Ok(results)
}

pub async fn query_collection_owned(
    client: Client,
    database: String,
    collection: String,
    filter: Option<Document>,
    projection: Option<Document>,
    sort: Option<Document>,
    limit: i64,
    skip: u64,
) -> Result<Vec<Value>> {
    let db = client.database(&database);
    let coll = db.collection::<Document>(&collection);

    let mut find = coll.find(filter.unwrap_or_default());
    if let Some(s) = sort {
        find = find.sort(s);
    }
    if let Some(p) = projection {
        find = find.projection(p);
    }
    find = find.limit(limit).skip(skip);

    let mut cursor = find.await.map_err(|e| AppError::Query(e.to_string()))?;

    let mut results = Vec::new();
    while let Some(doc) = cursor
        .try_next()
        .await
        .map_err(|e| AppError::Query(e.to_string()))?
    {
        results.push(bson_doc_to_json_value(doc));
    }
    Ok(results)
}

pub async fn aggregate_collection_owned(
    client: Client,
    database: String,
    collection: String,
    mut pipeline: Vec<Document>,
    limit: Option<i64>,
    skip: Option<u64>,
) -> Result<Vec<Value>> {
    let db = client.database(&database);
    let coll = db.collection::<Document>(&collection);

    if let Some(skip) = skip.filter(|skip| *skip > 0) {
        pipeline.push(mongodb::bson::doc! { "$skip": skip as i64 });
    }
    if let Some(limit) = limit.filter(|limit| *limit > 0) {
        pipeline.push(mongodb::bson::doc! { "$limit": limit });
    }

    let mut cursor = coll
        .aggregate(pipeline)
        .await
        .map_err(|e| AppError::Query(e.to_string()))?;

    let mut results = Vec::new();
    while let Some(doc) = cursor
        .try_next()
        .await
        .map_err(|e| AppError::Query(e.to_string()))?
    {
        results.push(bson_doc_to_json_value(doc));
    }
    Ok(results)
}

fn is_extended_json_scalar(map: &serde_json::Map<String, Value>) -> Option<&'static str> {
    if map.len() != 1 {
        return None;
    }

    match map.keys().next().map(String::as_str) {
        Some("$oid") => Some("objectId"),
        Some("$date") => Some("date"),
        Some("$numberLong") => Some("long"),
        Some("$numberInt") => Some("int"),
        Some("$numberDouble") => Some("double"),
        Some("$numberDecimal") => Some("decimal"),
        Some("$timestamp") => Some("timestamp"),
        Some("$regularExpression") => Some("regex"),
        Some("$binary") => Some("binData"),
        _ => None,
    }
}

pub fn mongo_value_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(n) if n.is_i64() || n.is_u64() => "int",
        Value::Number(_) => "double",
        Value::String(_) => "string",
        Value::Array(_) => "json",
        Value::Object(map) => is_extended_json_scalar(map).unwrap_or("json"),
    }
}

fn merge_mongo_type(existing: Option<String>, next: &str) -> String {
    match existing {
        None => next.to_string(),
        Some(current) if current == next || next == "null" => current,
        Some(current) if current == "null" => next.to_string(),
        Some(current) if current == "int" && next == "long" => "long".to_string(),
        Some(current) if current == "long" && next == "int" => "long".to_string(),
        Some(current)
            if (current == "int" || current == "long" || current == "double")
                && (next == "int" || next == "long" || next == "double") =>
        {
            if current == "double" || next == "double" {
                "double".to_string()
            } else if current == "long" || next == "long" {
                "long".to_string()
            } else {
                "int".to_string()
            }
        }
        Some(_) => "json".to_string(),
    }
}

fn collect_document_fields(
    value: &Value,
    prefix: Option<&str>,
    field_types: &mut BTreeMap<String, String>,
) {
    match value {
        Value::Object(map) => {
            for (key, nested) in map {
                let path = match prefix {
                    Some(prefix) if !prefix.is_empty() => format!("{prefix}.{key}"),
                    _ => key.clone(),
                };
                let next_type = mongo_value_type_name(nested);
                let merged = merge_mongo_type(field_types.get(&path).cloned(), next_type);
                field_types.insert(path.clone(), merged);

                match nested {
                    Value::Object(_) => collect_document_fields(nested, Some(&path), field_types),
                    Value::Array(items) => {
                        for item in items.iter().take(3) {
                            if item.is_object() {
                                collect_document_fields(item, Some(&path), field_types);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        Value::Array(items) => {
            for item in items.iter().take(3) {
                if item.is_object() {
                    collect_document_fields(item, prefix, field_types);
                }
            }
        }
        _ => {}
    }
}

pub async fn infer_collection_columns_owned(
    client: Client,
    database: String,
    collection: String,
    sample_size: i64,
) -> Result<Vec<ColumnDetail>> {
    let docs = query_collection_owned(
        client,
        database,
        collection,
        None,
        None,
        None,
        sample_size.max(1),
        0,
    )
    .await?;

    let mut field_types = BTreeMap::<String, String>::new();
    for doc in &docs {
        collect_document_fields(doc, None, &mut field_types);
    }

    let mut fields: Vec<(String, String)> = field_types.into_iter().collect();
    fields.sort_by(|(left, _), (right, _)| match (left == "_id", right == "_id") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => left.cmp(right),
    });

    Ok(fields
        .into_iter()
        .enumerate()
        .map(|(index, (name, data_type))| ColumnDetail {
            name: name.clone(),
            data_type: data_type.clone(),
            column_type: data_type,
            nullable: true,
            default_value: None,
            comment: Some("Inferred from sampled MongoDB documents".to_string()),
            is_primary_key: name == "_id",
            is_auto_increment: false,
            ordinal_position: (index + 1) as u32,
            key_type: if name == "_id" {
                "PRI".to_string()
            } else {
                String::new()
            },
            extra: String::new(),
            char_max_length: None,
            numeric_precision: None,
            numeric_scale: None,
        })
        .collect())
}

pub fn find_shell_close_paren(s: &str) -> Option<usize> {
    let mut depth = 1i32;
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

struct MongoShellParser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> MongoShellParser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, pos: 0 }
    }

    fn peek(&self) -> Option<char> {
        self.input[self.pos..].chars().next()
    }

    fn next(&mut self) -> Option<char> {
        let ch = self.peek()?;
        self.pos += ch.len_utf8();
        Some(ch)
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(c) if c.is_whitespace()) {
            self.next();
        }
    }

    fn consume_char(&mut self, expected: char) -> bool {
        self.skip_ws();
        if self.peek() == Some(expected) {
            self.next();
            true
        } else {
            false
        }
    }

    fn parse_string(&mut self) -> Option<String> {
        self.skip_ws();
        let quote = self.next()?;
        if quote != '"' && quote != '\'' {
            return None;
        }

        let mut out = String::new();
        while let Some(ch) = self.next() {
            match ch {
                c if c == quote => return Some(out),
                '\\' => {
                    let escaped = self.next()?;
                    match escaped {
                        '"' => out.push('"'),
                        '\'' => out.push('\''),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{0008}'),
                        'f' => out.push('\u{000C}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            let hex = self.take_exact(4)?;
                            let code = u16::from_str_radix(&hex, 16).ok()?;
                            out.push(char::from_u32(code as u32)?);
                        }
                        other => out.push(other),
                    }
                }
                other => out.push(other),
            }
        }
        None
    }

    fn take_exact(&mut self, count: usize) -> Option<String> {
        let mut out = String::new();
        for _ in 0..count {
            out.push(self.next()?);
        }
        Some(out)
    }

    fn parse_identifier(&mut self) -> Option<String> {
        self.skip_ws();
        let mut out = String::new();
        let first = self.peek()?;
        if !(first.is_ascii_alphabetic() || first == '_' || first == '$') {
            return None;
        }
        out.push(self.next()?);
        while let Some(ch) = self.peek() {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '$' || ch == '-' {
                out.push(self.next()?);
            } else {
                break;
            }
        }
        Some(out)
    }

    fn parse_number(&mut self) -> Option<Bson> {
        self.skip_ws();
        let start = self.pos;

        if self.peek() == Some('-') {
            self.next();
        }

        let mut has_digits = false;
        while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
            has_digits = true;
            self.next();
        }
        if !has_digits {
            self.pos = start;
            return None;
        }

        let mut is_float = false;
        if self.peek() == Some('.') {
            is_float = true;
            self.next();
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.next();
            }
        }

        if matches!(self.peek(), Some('e' | 'E')) {
            is_float = true;
            self.next();
            if matches!(self.peek(), Some('+' | '-')) {
                self.next();
            }
            while matches!(self.peek(), Some(c) if c.is_ascii_digit()) {
                self.next();
            }
        }

        let raw = &self.input[start..self.pos];
        if is_float {
            raw.parse::<f64>().ok().map(Bson::Double)
        } else {
            raw.parse::<i64>()
                .map(Bson::Int64)
                .ok()
                .or_else(|| raw.parse::<u64>().ok().map(|n| Bson::Double(n as f64)))
        }
    }

    fn parse_array(&mut self) -> Option<Vec<Bson>> {
        if !self.consume_char('[') {
            return None;
        }
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            if self.consume_char(']') {
                break;
            }
            items.push(self.parse_value()?);
            self.skip_ws();
            if self.consume_char(']') {
                break;
            }
            if !self.consume_char(',') {
                return None;
            }
        }
        Some(items)
    }

    fn parse_object(&mut self) -> Option<Document> {
        if !self.consume_char('{') {
            return None;
        }
        let mut doc = Document::new();
        loop {
            self.skip_ws();
            if self.consume_char('}') {
                break;
            }

            let key = match self.peek()? {
                '"' | '\'' => self.parse_string()?,
                _ => self.parse_identifier()?,
            };

            if !self.consume_char(':') {
                return None;
            }

            let value = self.parse_value()?;
            doc.insert(key, value);

            self.skip_ws();
            if self.consume_char('}') {
                break;
            }
            if !self.consume_char(',') {
                return None;
            }
        }
        Some(doc)
    }

    fn parse_function_call(&mut self, name: &str) -> Option<Bson> {
        if !self.consume_char('(') {
            return None;
        }
        self.skip_ws();

        let value = match name {
            "NumberLong" => match self.peek()? {
                '"' | '\'' => self.parse_string()?.parse::<i64>().ok().map(Bson::Int64),
                _ => self.parse_number(),
            }?,
            "ObjectId" => {
                let raw = self.parse_string()?;
                Bson::ObjectId(bson::oid::ObjectId::parse_str(raw).ok()?)
            }
            "ISODate" | "Date" => {
                let raw = self.parse_string()?;
                let dt = bson::DateTime::parse_rfc3339_str(&raw).ok()?;
                Bson::DateTime(dt)
            }
            _ => self.parse_value()?,
        };

        if !self.consume_char(')') {
            return None;
        }
        Some(value)
    }

    fn parse_value(&mut self) -> Option<Bson> {
        self.skip_ws();
        match self.peek()? {
            '{' => self.parse_object().map(Bson::Document),
            '[' => self.parse_array().map(Bson::Array),
            '"' | '\'' => self.parse_string().map(Bson::String),
            '-' | '0'..='9' => self.parse_number(),
            _ => {
                let ident = self.parse_identifier()?;
                self.skip_ws();
                if self.peek() == Some('(') {
                    return self.parse_function_call(&ident);
                }
                match ident.as_str() {
                    "true" => Some(Bson::Boolean(true)),
                    "false" => Some(Bson::Boolean(false)),
                    "null" => Some(Bson::Null),
                    _ => Some(Bson::String(ident)),
                }
            }
        }
    }
}

pub fn parse_shell_document(input: &str) -> Option<Document> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut parser = MongoShellParser::new(trimmed);
    let doc = parser.parse_object()?;
    parser.skip_ws();
    if parser.peek().is_some() {
        return None;
    }
    Some(doc)
}

pub fn parse_shell_pipeline(input: &str) -> Option<Vec<Document>> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut parser = MongoShellParser::new(trimmed);
    let arr = parser.parse_array()?;
    parser.skip_ws();
    if parser.peek().is_some() {
        return None;
    }
    arr.into_iter()
        .map(|item| match item {
            Bson::Document(doc) => Some(doc),
            _ => None,
        })
        .collect()
}

pub fn extract_shell_chain_arg(chain: &str, method: &str) -> Option<String> {
    let pattern = format!(".{}(", method);
    let pos = chain.find(&pattern)?;
    let after = &chain[pos + pattern.len()..];
    let end = find_shell_close_paren(after)?;
    Some(after[..end].trim().to_string())
}

pub fn extract_shell_chain_int(chain: &str, method: &str) -> Option<i64> {
    extract_shell_chain_arg(chain, method)?.trim().parse().ok()
}

pub fn serde_json_to_bson(value: serde_json::Value) -> Option<Bson> {
    match value {
        Value::Null => Some(Bson::Null),
        Value::Bool(v) => Some(Bson::Boolean(v)),
        Value::Number(n) => {
            if let Some(v) = n.as_i64() {
                Some(Bson::Int64(v))
            } else if let Some(v) = n.as_u64() {
                i64::try_from(v).ok().map(Bson::Int64).or(Some(Bson::Double(v as f64)))
            } else {
                n.as_f64().map(Bson::Double)
            }
        }
        Value::String(v) => Some(Bson::String(v)),
        Value::Array(values) => values
            .into_iter()
            .map(serde_json_to_bson)
            .collect::<Option<Vec<_>>>()
            .map(Bson::Array),
        Value::Object(map) => {
            if map.len() == 1 {
                if let Some(Value::String(raw)) = map.get("$oid") {
                    return bson::oid::ObjectId::parse_str(raw).ok().map(Bson::ObjectId);
                }
                if let Some(date_val) = map.get("$date") {
                    return match date_val {
                        Value::String(raw) => bson::DateTime::parse_rfc3339_str(raw).ok().map(Bson::DateTime),
                        Value::Object(inner) => inner
                            .get("$numberLong")
                            .and_then(Value::as_str)
                            .and_then(|raw| raw.parse::<i64>().ok())
                            .map(bson::DateTime::from_millis)
                            .map(Bson::DateTime),
                        _ => None,
                    };
                }
                if let Some(Value::String(raw)) = map.get("$numberLong") {
                    return raw.parse::<i64>().ok().map(Bson::Int64);
                }
                if let Some(Value::String(raw)) = map.get("$numberInt") {
                    return raw.parse::<i32>().ok().map(Bson::Int32);
                }
                if let Some(Value::String(raw)) = map.get("$numberDouble") {
                    return raw.parse::<f64>().ok().map(Bson::Double);
                }
                if let Some(Value::String(raw)) = map.get("$numberDecimal") {
                    return bson::Decimal128::from_str(raw).ok().map(Bson::Decimal128);
                }
            }

            let mut doc = Document::new();
            for (k, v) in map {
                doc.insert(k, serde_json_to_bson(v)?);
            }
            Some(Bson::Document(doc))
        }
    }
}

pub async fn insert_document(
    client: &Client,
    database: &str,
    collection: &str,
    document: Document,
) -> Result<String> {
    let db = client.database(database);
    let coll = db.collection::<Document>(collection);
    let result = coll
        .insert_one(document)
        .await
        .map_err(|e| AppError::Query(e.to_string()))?;
    Ok(result.inserted_id.to_string())
}

pub async fn update_document(
    client: &Client,
    database: &str,
    collection: &str,
    filter: Document,
    update: Document,
) -> Result<u64> {
    let db = client.database(database);
    let coll = db.collection::<Document>(collection);
    let result = coll
        .update_one(filter, update)
        .await
        .map_err(|e| AppError::Query(e.to_string()))?;
    Ok(result.modified_count)
}

pub async fn delete_document(
    client: &Client,
    database: &str,
    collection: &str,
    filter: Document,
) -> Result<u64> {
    let db = client.database(database);
    let coll = db.collection::<Document>(collection);
    let result = coll
        .delete_one(filter)
        .await
        .map_err(|e| AppError::Query(e.to_string()))?;
    Ok(result.deleted_count)
}
