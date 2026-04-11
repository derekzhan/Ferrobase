use tauri::State;
use serde::{Deserialize, Serialize};
use mongodb::bson::Document;
use crate::pool::{ConnectionRegistry, DatabaseConnection};
use crate::error::AppError;
use crate::db::mongodb_driver;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MongoQueryOptions {
    pub filter: Option<serde_json::Value>,
    pub projection: Option<serde_json::Value>,
    pub sort: Option<serde_json::Value>,
    pub limit: Option<i64>,
    pub skip: Option<u64>,
}

fn json_to_bson_doc(val: serde_json::Value) -> Option<Document> {
    if let serde_json::Value::Object(map) = val {
        let mut doc = Document::new();
        for (k, v) in map {
            let bson_val = mongodb::bson::to_bson(&v).ok()?;
            doc.insert(k, bson_val);
        }
        Some(doc)
    } else {
        None
    }
}

/// Extract a cloned MongoDB client from the registry, dropping the lock before any `.await`.
async fn get_mongo_client(
    connection_id: &str,
    registry: &State<'_, ConnectionRegistry>,
) -> std::result::Result<mongodb::Client, AppError> {
    let connections = registry.connections();
    let map = connections.read().await;
    let entry = map
        .get(connection_id)
        .ok_or_else(|| AppError::NotConnected(connection_id.to_string()))?;
    match &entry.connection {
        DatabaseConnection::Mongodb(client) => Ok(client.clone()),
        _ => Err(AppError::UnsupportedOperation(
            "Not a MongoDB connection".to_string(),
        )),
    }
}

#[tauri::command]
pub async fn list_collections(
    connection_id: String,
    database: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<String>, AppError> {
    let client = get_mongo_client(&connection_id, &registry).await?;
    mongodb_driver::list_collections(&client, &database).await
}

#[tauri::command]
pub async fn query_collection(
    connection_id: String,
    database: String,
    collection: String,
    options: MongoQueryOptions,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<serde_json::Value>, AppError> {
    let client = get_mongo_client(&connection_id, &registry).await?;

    let filter = options.filter.and_then(json_to_bson_doc);
    let projection = options.projection.and_then(json_to_bson_doc);
    let sort = options.sort.and_then(json_to_bson_doc);
    let limit = options.limit.unwrap_or(100);
    let skip = options.skip.unwrap_or(0);

    mongodb_driver::query_collection(
        &client,
        &database,
        &collection,
        filter,
        projection,
        sort,
        limit,
        skip,
    )
    .await
}

#[tauri::command]
pub async fn insert_document(
    connection_id: String,
    database: String,
    collection: String,
    document: serde_json::Value,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<String, AppError> {
    let client = get_mongo_client(&connection_id, &registry).await?;
    let doc = json_to_bson_doc(document)
        .ok_or_else(|| AppError::Serialization("Invalid document".to_string()))?;
    mongodb_driver::insert_document(&client, &database, &collection, doc).await
}

#[tauri::command]
pub async fn update_document(
    connection_id: String,
    database: String,
    collection: String,
    filter: serde_json::Value,
    update: serde_json::Value,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<u64, AppError> {
    let client = get_mongo_client(&connection_id, &registry).await?;
    let filter_doc = json_to_bson_doc(filter)
        .ok_or_else(|| AppError::Serialization("Invalid filter".to_string()))?;
    let update_doc = json_to_bson_doc(update)
        .ok_or_else(|| AppError::Serialization("Invalid update".to_string()))?;
    mongodb_driver::update_document(&client, &database, &collection, filter_doc, update_doc).await
}

#[tauri::command]
pub async fn delete_document(
    connection_id: String,
    database: String,
    collection: String,
    filter: serde_json::Value,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<u64, AppError> {
    let client = get_mongo_client(&connection_id, &registry).await?;
    let filter_doc = json_to_bson_doc(filter)
        .ok_or_else(|| AppError::Serialization("Invalid filter".to_string()))?;
    mongodb_driver::delete_document(&client, &database, &collection, filter_doc).await
}

#[tauri::command]
pub async fn get_collection_indexes(
    connection_id: String,
    database: String,
    collection: String,
    registry: State<'_, ConnectionRegistry>,
) -> std::result::Result<Vec<serde_json::Value>, AppError> {
    let client = get_mongo_client(&connection_id, &registry).await?;

    let db = client.database(&database);
    let coll = db.collection::<Document>(&collection);
    use futures::TryStreamExt;
    let mut cursor = coll.list_indexes().await
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut indexes = Vec::new();
    while let Some(idx) = cursor.try_next().await.map_err(|e| AppError::Database(e.to_string()))? {
        let json_str = serde_json::to_string(&idx)
            .map_err(|e| AppError::Serialization(e.to_string()))?;
        let val: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| AppError::Serialization(e.to_string()))?;
        indexes.push(val);
    }
    Ok(indexes)
}
