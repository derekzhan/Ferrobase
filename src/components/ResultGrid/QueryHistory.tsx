import { useEffect, useState } from 'react';
import { Clock, Trash2, CheckCircle, AlertCircle } from 'lucide-react';
import { queryApi } from '../../api';
import { useTabStore, useConnectionStore } from '../../stores';
import type { QueryHistoryEntry } from '../../types';
import { formatDuration, truncate } from '../../lib/utils';

export function QueryHistory() {
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const openQueryTab = useTabStore((s) => s.openQueryTab);
  const connections = useConnectionStore((s) => s.connections);

  useEffect(() => {
    queryApi.getQueryHistory().then(setHistory).catch(console.error);
  }, []);

  const clearHistory = async () => {
    await queryApi.clearQueryHistory();
    setHistory([]);
  };

  const rerunQuery = (entry: QueryHistoryEntry) => {
    const conn = connections.find((c) => c.id === entry.connectionId);
    openQueryTab({
      connectionId: entry.connectionId,
      database: entry.database,
      sql: entry.query,
      title: conn ? `Query - ${conn.name}` : 'Query',
    });
  };

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
        No query history
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <span className="text-xs font-medium text-[var(--text-muted)] flex-1">
          {history.length} queries
        </span>
        <button
          onClick={clearHistory}
          className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors"
        >
          <Trash2 size={11} />
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {history.map((entry) => (
          <div
            key={entry.id}
            className="flex items-start gap-2 px-3 py-2 border-b border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer group"
            onDoubleClick={() => rerunQuery(entry)}
          >
            {entry.hadError ? (
              <AlertCircle size={12} className="text-red-500 flex-shrink-0 mt-0.5" />
            ) : (
              <CheckCircle size={12} className="text-green-500 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-[var(--text-primary)] truncate">
                {truncate(entry.query, 80)}
              </p>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[var(--text-muted)]">
                <span>{new Date(entry.executedAt).toLocaleTimeString()}</span>
                <span>{formatDuration(entry.executionTimeMs)}</span>
                {entry.rowCount > 0 && <span>{entry.rowCount} rows</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
