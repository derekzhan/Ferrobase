import { invoke } from '@tauri-apps/api/core';
import type {
  DatabaseInfo,
  SchemaInfo,
  TableInfo,
  ColumnDetail,
  IndexInfo,
  QueryResult,
} from '../types';

export const schemaApi = {
  getDatabases: (connectionId: string) =>
    invoke<DatabaseInfo[]>('get_databases', { connectionId }),

  getSchemas: (connectionId: string) =>
    invoke<SchemaInfo[]>('get_schemas', { connectionId }),

  getTables: (connectionId: string, database: string, schema?: string) =>
    invoke<TableInfo[]>('get_tables', { connectionId, database, schema }),

  getTableColumns: (connectionId: string, database: string, table: string, schema?: string) =>
    invoke<ColumnDetail[]>('get_table_columns', { connectionId, database, table, schema }),

  getTableIndexes: (connectionId: string, database: string, table: string, schema?: string) =>
    invoke<IndexInfo[]>('get_table_indexes', { connectionId, database, table, schema }),

  getTableDdl: (connectionId: string, database: string, table: string, schema?: string) =>
    invoke<string>('get_table_ddl', { connectionId, database, table, schema }),

  getTableDataPreview: (
    connectionId: string,
    database: string,
    table: string,
    schema?: string,
    limit?: number,
    offset?: number,
    whereClause?: string,
  ) =>
    invoke<QueryResult>('get_table_data_preview', {
      connectionId,
      database,
      table,
      schema,
      limit,
      offset,
      whereClause,
    }),

  getViews: (connectionId: string, database: string, schema?: string) =>
    invoke<TableInfo[]>('get_views', { connectionId, database, schema }),

  getProcedures: (connectionId: string, database: string) =>
    invoke<string[]>('get_procedures', { connectionId, database }),
};
