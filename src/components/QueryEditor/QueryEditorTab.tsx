import { useState, useRef, useCallback, useEffect } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Play, Square, Clock, Save, FolderOpen } from 'lucide-react';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { useTabStore, useConnectionStore } from '../../stores';
import { queryApi, redisApi } from '../../api';
import { SqlEditor } from './SqlEditor';
import { ResultPanel } from '../ResultGrid/ResultPanel';
import { useConfirmDialog } from '../ConfirmDialog';
import type { QueryTab, QueryResult } from '../../types';
import { cn, extractErrorMessage } from '../../lib/utils';

interface Props {
  tab: QueryTab;
}

type DangerLevel = { title: string; message: string; variant: 'danger' | 'warning' };

/** Detect dangerous SQL statements that should require confirmation */
function detectDangerousSql(sql: string): DangerLevel | null {
  const trimmed = sql.trim().replace(/\s+/g, ' ');

  // DROP TABLE / DROP DATABASE / DROP INDEX / DROP VIEW
  if (/\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|TRIGGER|PROCEDURE|FUNCTION)\b/i.test(trimmed)) {
    return {
      title: 'Confirm DROP',
      message: 'This will permanently drop the object. This action is irreversible.',
      variant: 'danger',
    };
  }

  // TRUNCATE TABLE
  if (/\bTRUNCATE\s+(TABLE\s+)?\w/i.test(trimmed)) {
    return {
      title: 'Confirm TRUNCATE',
      message: 'This will permanently delete ALL rows from the table. This action cannot be undone.',
      variant: 'danger',
    };
  }

  // DELETE without WHERE (very dangerous)
  if (/\bDELETE\s+FROM\b/i.test(trimmed) && !/\bWHERE\b/i.test(trimmed)) {
    return {
      title: 'Confirm DELETE (no WHERE clause)',
      message: 'This DELETE statement has no WHERE clause and will delete ALL rows from the table.',
      variant: 'danger',
    };
  }

  // DELETE with WHERE (still needs confirmation)
  if (/\bDELETE\s+FROM\b/i.test(trimmed)) {
    return {
      title: 'Confirm DELETE',
      message: 'This will permanently delete matching rows from the table.',
      variant: 'warning',
    };
  }

  // UPDATE without WHERE (very dangerous)
  if (/\bUPDATE\s+\w+\s+SET\b/i.test(trimmed) && !/\bWHERE\b/i.test(trimmed)) {
    return {
      title: 'Confirm UPDATE (no WHERE clause)',
      message: 'This UPDATE statement has no WHERE clause and will modify ALL rows in the table.',
      variant: 'danger',
    };
  }

  // ALTER TABLE DROP COLUMN
  if (/\bALTER\s+TABLE\s+\w+\s+DROP\b/i.test(trimmed)) {
    return {
      title: 'Confirm ALTER TABLE DROP',
      message: 'This will permanently remove a column or constraint. Data in that column will be lost.',
      variant: 'danger',
    };
  }

  // RENAME / ALTER TABLE RENAME
  if (/\b(RENAME\s+TABLE|ALTER\s+TABLE\s+\w+\s+RENAME)\b/i.test(trimmed)) {
    return {
      title: 'Confirm RENAME',
      message: 'This will rename the table. Applications referencing the old name may break.',
      variant: 'warning',
    };
  }

  return null;
}

export function QueryEditorTab({ tab }: Props) {
  const { setSql, setResults, setExecuting, updateQueryTab } = useTabStore();
  const connections = useConnectionStore((s) => s.connections);
  const statuses = useConnectionStore((s) => s.statuses);
  const { confirm, ConfirmDialogElement } = useConfirmDialog();
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connectedConnections = connections.filter(
    (c) => statuses[c.id] === 'Connected'
  );

  const selectedConnection = connections.find((c) => c.id === tab.connectionId);

  const startTimer = () => {
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed((e) => e + 100);
    }, 100);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => stopTimer(), []);

  const executeQuery = useCallback(
    async (sqlOverride?: string) => {
      const sql = sqlOverride ?? tab.sql;
      if (!sql.trim() || !tab.connectionId) return;

      // Check for dangerous SQL and require confirmation
      const dangerCheck = detectDangerousSql(sql);
      if (dangerCheck) {
        const ok = await confirm({
          title: dangerCheck.title,
          message: dangerCheck.message,
          detail: sql.trim().length > 200 ? sql.trim().slice(0, 200) + '...' : sql.trim(),
          variant: dangerCheck.variant,
          confirmLabel: 'Execute',
        });
        if (!ok) return;
      }

      setExecuting(tab.id, true);
      startTimer();

      try {
        // Detect Redis connection and use Redis API
        const isRedisConn = selectedConnection?.dbType === 'redis';
        let results: QueryResult[];

        if (isRedisConn) {
          // Parse Redis command into args (split by whitespace, respecting quotes)
          const cmdArgs = sql.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(
            (a) => a.replace(/^["']|["']$/g, '')
          ) ?? [];
          const rawResult = await redisApi.executeRedisCommand(tab.connectionId, cmdArgs);
          const display = typeof rawResult === 'object' ? JSON.stringify(rawResult, null, 2) : String(rawResult ?? '(nil)');
          results = [{
            columns: [{ name: 'result', dataType: 'string', nullable: true, isPrimaryKey: false }],
            rows: [[display]],
            rowCount: 1,
            affectedRows: 0,
            executionTimeMs: 0,
            query: sql.trim(),
          }];
        } else {
          results = await queryApi.executeQuery(
            tab.connectionId,
            sql,
            tab.database
          );
        }
        stopTimer();
        setResults(tab.id, results);
        updateQueryTab(tab.id, { activeResultTab: 'results' });
      } catch (e) {
        stopTimer();
        setResults(tab.id, [], extractErrorMessage(e));
        updateQueryTab(tab.id, { activeResultTab: 'messages' });
      }
    },
    [tab.sql, tab.connectionId, tab.database, tab.id, selectedConnection?.dbType]
  );

  const cancelQuery = async () => {
    if (tab.connectionId) {
      await queryApi.cancelQuery(tab.connectionId);
    }
    stopTimer();
    setExecuting(tab.id, false);
  };

  // Save SQL to file
  const handleSave = useCallback(async () => {
    try {
      // If we already have a file path, save directly
      if (tab.filePath) {
        await writeTextFile(tab.filePath, tab.sql);
        updateQueryTab(tab.id, { isDirty: false });
        return;
      }

      // Otherwise, show save dialog
      const filePath = await save({
        filters: [
          { name: 'SQL Files', extensions: ['sql'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        defaultPath: `${tab.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.sql`,
      });

      if (filePath) {
        await writeTextFile(filePath, tab.sql);
        updateQueryTab(tab.id, {
          filePath,
          isDirty: false,
          title: filePath.split('/').pop()?.replace('.sql', '') ?? tab.title,
        });
      }
    } catch (e) {
      console.error('Save failed:', e);
    }
  }, [tab.id, tab.sql, tab.filePath, tab.title]);

  // Open SQL file
  const handleOpen = useCallback(async () => {
    try {
      const filePath = await open({
        filters: [
          { name: 'SQL Files', extensions: ['sql'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        multiple: false,
      });

      if (filePath) {
        const content = await readTextFile(filePath as string);
        setSql(tab.id, content);
        updateQueryTab(tab.id, {
          filePath: filePath as string,
          isDirty: false,
          title: (filePath as string).split('/').pop()?.replace('.sql', '') ?? tab.title,
        });
      }
    } catch (e) {
      console.error('Open failed:', e);
    }
  }, [tab.id, tab.title]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        executeQuery();
      }
    },
    [executeQuery]
  );

  return (
    <div className="flex flex-col h-full">
      {ConfirmDialogElement}
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
        {/* Connection selector */}
        <select
          value={tab.connectionId ?? ''}
          onChange={(e) => {
            const conn = connections.find((c) => c.id === e.target.value);
            updateQueryTab(tab.id, {
              connectionId: e.target.value,
              database: conn?.database,
              title: conn ? `Query - ${conn.name}` : 'Query',
            });
          }}
          className="text-xs bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-primary)] outline-none max-w-[180px]"
        >
          <option value="">Select connection...</option>
          {connectedConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {/* Database selector */}
        {tab.connectionId && (
          <input
            type="text"
            value={tab.database ?? ''}
            onChange={(e) => updateQueryTab(tab.id, { database: e.target.value })}
            placeholder="database..."
            autoComplete="off"
            autoCapitalize="off"
            className="text-xs bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-primary)] outline-none w-28"
          />
        )}

        <div className="flex-1" />

        {/* File operations */}
        <button
          onClick={handleOpen}
          className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title="Open SQL File (⌘O)"
        >
          <FolderOpen size={13} />
        </button>
        <button
          onClick={handleSave}
          className={cn(
            'p-1 hover:bg-[var(--bg-hover)] rounded transition-colors',
            tab.isDirty ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          )}
          title={tab.filePath ? `Save to ${tab.filePath} (⌘S)` : 'Save SQL to File (⌘S)'}
        >
          <Save size={13} />
        </button>

        <div className="w-px h-4 bg-[var(--border)]" />

        {/* Elapsed time */}
        {tab.isExecuting && (
          <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <Clock size={11} className="animate-pulse" />
            {(elapsed / 1000).toFixed(1)}s
          </div>
        )}

        {/* Execute / Cancel */}
        {tab.isExecuting ? (
          <button
            onClick={cancelQuery}
            className="flex items-center gap-1.5 px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
          >
            <Square size={11} />
            Cancel
          </button>
        ) : (
          <button
            onClick={() => executeQuery()}
            disabled={!tab.connectionId || !tab.sql.trim()}
            className="flex items-center gap-1.5 px-3 py-1 text-xs bg-[var(--accent)] text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Execute (⌘+Enter)"
          >
            <Play size={11} />
            Run
          </button>
        )}
      </div>

      {/* Editor + Results */}
      <PanelGroup direction="vertical" autoSaveId={`editor-${tab.id}`}>
        <Panel defaultSize={50} minSize={20}>
          <SqlEditor
            value={tab.sql}
            onChange={(sql) => setSql(tab.id, sql)}
            onExecute={executeQuery}
            onSave={handleSave}
            connectionId={tab.connectionId}
            database={tab.database}
            dbType={selectedConnection?.dbType}
          />
        </Panel>
        <PanelResizeHandle className="h-px bg-[var(--border)] hover:bg-[var(--accent)] transition-colors cursor-row-resize" />
        <Panel defaultSize={50} minSize={20}>
          <ResultPanel tab={tab} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
