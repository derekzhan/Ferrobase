use crate::error::{AppError, Result};
use futures::TryStreamExt;
use mongodb::{bson::Document, options::ClientOptions, Client};
use serde_json::Value;

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
        let json_str =
            serde_json::to_string(&doc).map_err(|e| AppError::Serialization(e.to_string()))?;
        let val: Value =
            serde_json::from_str(&json_str).map_err(|e| AppError::Serialization(e.to_string()))?;
        results.push(val);
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
        let json_str =
            serde_json::to_string(&doc).map_err(|e| AppError::Serialization(e.to_string()))?;
        let val: Value =
            serde_json::from_str(&json_str).map_err(|e| AppError::Serialization(e.to_string()))?;
        results.push(val);
    }
    Ok(results)
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
