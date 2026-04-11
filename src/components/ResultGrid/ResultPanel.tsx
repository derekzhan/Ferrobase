import { useState, useRef, useEffect } from 'react';
import { Table2, MessageSquare, History, AlertCircle, CheckCircle, Download, ChevronDown } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { ResultGrid } from './ResultGrid';
import { QueryHistory } from './QueryHistory';
import type { QueryTab } from '../../types';
import { cn, formatDuration } from '../../lib/utils';
import { useTabStore } from '../../stores';

interface Props {
  tab: QueryTab;
}

export function ResultPanel({ tab }: Props) {
  const updateQueryTab = useTabStore((s) => s.updateQueryTab);
  const activeTab = tab.activeResultTab;
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (!exportBtnRef.current?.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  const handleExport = async (format: 'csv' | 'json' | 'sql') => {
    setShowExportMenu(false);
    const result = tab.results[tab.results.length - 1];
    if (!result) return;

    const filters: { name: string; extensions: string[] }[] = [];
    let defaultExt = format;
    if (format === 'csv') filters.push({ name: 'CSV', extensions: ['csv'] });
    else if (format === 'json') filters.push({ name: 'JSON', extensions: ['json'] });
    else { filters.push({ name: 'SQL', extensions: ['sql'] }); defaultExt = 'sql'; }

    const filePath = await save({ filters, defaultPath: `export.${defaultExt}` });
    if (!filePath) return;

    let content = '';
    if (format === 'csv') {
      const header = result.columns.map((c) => {
        const n = c.name;
        return n.includes(',') || n.includes('"') || n.includes('\n') ? `"${n.replace(/"/g, '""')}"` : n;
      }).join(',');
      const rows = result.rows.map((row) =>
        row.map((v) => {
          if (v === null || v === undefined) return '';
          const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',')
      );
      content = [header, ...rows].join('\n');
    } else if (format === 'json') {
      const records = result.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        result.columns.forEach((col, i) => { obj[col.name] = row[i] ?? null; });
        return obj;
      });
      content = JSON.stringify(records, null, 2);
    } else {
      const tableName = 'exported_table';
      const cols = result.columns.map((c) => `\`${c.name}\``).join(', ');
      content = result.rows.map((row) => {
        const vals = row.map((v) => {
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number' || typeof v === 'boolean') return String(v);
          return `'${String(v).replace(/'/g, "\\'")}'`;
        }).join(', ');
        return `INSERT INTO \`${tableName}\` (${cols}) VALUES (${vals});`;
      }).join('\n');
    }

    await writeTextFile(filePath, content);
  };

  const setActiveTab = (t: typeof activeTab) =>
    updateQueryTab(tab.id, { activeResultTab: t });

  const lastResult = tab.results[tab.results.length - 1];

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Tab bar */}
      <div className="flex items-center border-b border-[var(--border)] bg-[var(--bg-secondary)] px-1">
        {[
          { id: 'results' as const, icon: Table2, label: 'Results', count: lastResult?.rowCount },
          { id: 'messages' as const, icon: MessageSquare, label: 'Messages' },
          { id: 'history' as const, icon: History, label: 'History' },
        ].map(({ id, icon: Icon, label, count }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs transition-colors border-b-2',
              activeTab === id
                ? 'text-[var(--text-primary)] border-[var(--accent)]'
                : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]'
            )}
          >
            <Icon size={12} />
            {label}
            {count !== undefined && count > 0 && (
              <span className="bg-[var(--accent)] text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {count > 9999 ? '9999+' : count}
              </span>
            )}
          </button>
        ))}

        {/* Execution info + Export */}
        <div className="ml-auto flex items-center gap-3 pr-2 text-xs text-[var(--text-muted)]">
          {lastResult && (
            <>
              <span>{lastResult.rowCount.toLocaleString()} rows</span>
              <span>{formatDuration(lastResult.executionTimeMs)}</span>
            </>
          )}
          {lastResult && lastResult.rowCount > 0 && (
            <div ref={exportBtnRef} className="relative">
              <button
                onClick={() => setShowExportMenu((v) => !v)}
                className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                title="Export results"
              >
                <Download size={11} />
                <span>Export</span>
                <ChevronDown size={10} />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded shadow-lg z-50 min-w-[130px]">
                  {(['csv', 'json', 'sql'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => handleExport(fmt)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] uppercase font-mono"
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'results' && (
          <>
            {tab.isExecuting ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3 text-[var(--text-muted)]">
                  <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm">Executing query...</span>
                </div>
              </div>
            ) : tab.results.length > 0 ? (
              <ResultGrid results={tab.results} />
            ) : (
              <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
                <p className="text-sm">Run a query to see results</p>
              </div>
            )}
          </>
        )}

        {activeTab === 'messages' && (
          <div className="p-4 h-full overflow-y-auto">
            {tab.error ? (
              <div className="flex items-start gap-2 text-red-500 bg-red-500/10 rounded p-3 text-sm">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <pre className="whitespace-pre-wrap font-mono text-xs break-all">{tab.error}</pre>
              </div>
            ) : lastResult ? (
              <div className="flex items-start gap-2 text-green-500 bg-green-500/10 rounded p-3 text-sm">
                <CheckCircle size={16} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Query executed successfully</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {lastResult.rowCount > 0
                      ? `${lastResult.rowCount.toLocaleString()} rows returned`
                      : lastResult.affectedRows > 0
                      ? `${lastResult.affectedRows} rows affected`
                      : 'No rows returned'}
                    {' · '}
                    {formatDuration(lastResult.executionTimeMs)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">No messages</p>
            )}
          </div>
        )}

        {activeTab === 'history' && <QueryHistory />}
      </div>
    </div>
  );
}
