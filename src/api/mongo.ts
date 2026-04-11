import { invoke } from '@tauri-apps/api/core';

export interface MongoQueryOptions {
  filter?: unknown;
  projection?: unknown;
  sort?: unknown;
  limit?: number;
  skip?: number;
}

export const mongoApi = {
  listCollections: (connectionId: string, database: string) =>
    invoke<string[]>('list_collections', { connectionId, database }),

  queryCollection: (
    connectionId: string,
    database: string,
    collection: string,
    options: MongoQueryOptions = {},
  ) =>
    invoke<unknown[]>('query_collection', { connectionId, database, collection, options }),

  insertDocument: (connectionId: string, database: string, collection: string, document: unknown) =>
    invoke<string>('insert_document', { connectionId, database, collection, document }),

  updateDocument: (
    connectionId: string,
    database: string,
    collection: string,
    filter: unknown,
    update: unknown,
  ) =>
    invoke<number>('update_document', { connectionId, database, collection, filter, update }),

  deleteDocument: (connectionId: string, database: string, collection: string, filter: unknown) =>
    invoke<number>('delete_document', { connectionId, database, collection, filter }),

  getCollectionIndexes: (connectionId: string, database: string, collection: string) =>
    invoke<unknown[]>('get_collection_indexes', { connectionId, database, collection }),
};
