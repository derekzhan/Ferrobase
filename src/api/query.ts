import { invoke } from '@tauri-apps/api/core';
import type { QueryResult, QueryHistoryEntry, ExportOptions } from '../types';

export const queryApi = {
  executeQuery: (connectionId: string, sql: string, database?: string) =>
    invoke<QueryResult[]>('execute_query', { connectionId, sql, database }),

  cancelQuery: (connectionId: string) =>
    invoke<void>('cancel_query', { connectionId }),

  getQueryHistory: () =>
    invoke<QueryHistoryEntry[]>('get_query_history'),

  clearQueryHistory: () =>
    invoke<void>('clear_query_history'),

  exportQueryResult: (connectionId: string, sql: string, options: ExportOptions) =>
    invoke<string>('export_query_result', { connectionId, sql, options }),
};
