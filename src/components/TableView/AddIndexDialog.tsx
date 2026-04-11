import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { ColumnDetail } from '../../types';
import { extractErrorMessage } from '../../lib/utils';

interface Props {
  connectionId: string;
  database: string;
  tableName: string;
  schema?: string;
  dbType: string;
  columns: ColumnDetail[];
  onClose: () => void;
  onSuccess: () => void;
}

export function AddIndexDialog({
  connectionId,
  database,
  tableName,
  schema,
  dbType,
  columns,
  onClose,
  onSuccess,
}: Props) {
  const [indexName, setIndexName] = useState('');
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [isUnique, setIsUnique] = useState(false);
  const [indexType, setIndexType] = useState('BTREE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const indexTypes =
    dbType === 'mysql'
      ? ['BTREE', 'HASH']
      : dbType === 'sqlite'
      ? ['BTREE']
      : ['BTREE', 'HASH', 'GIST', 'GIN', 'BRIN'];

  const toggleCol = (col: string) => {
    setSelectedCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  };

  const buildSql = (): string => {
    const unique = isUnique ? 'UNIQUE ' : '';
    if (dbType === 'mysql') {
      const colList = selectedCols.map((c) => `\`${c}\``).join(', ');
      return `CREATE ${unique}INDEX \`${indexName}\` ON \`${database}\`.\`${tableName}\` (${colList}) USING ${indexType}`;
    } else if (dbType === 'sqlite') {
      const colList = selectedCols.map((c) => `"${c}"`).join(', ');
      return `CREATE ${unique}INDEX "${indexName}" ON "${tableName}" (${colList})`;
    } else {
      const s = schema ?? 'public';
      const colList = selectedCols.map((c) => `"${c}"`).join(', ');
      return `CREATE ${unique}INDEX "${indexName}" ON "${s}"."${tableName}" USING ${indexType} (${colList})`;
    }
  };

  const handleSubmit = async () => {
    if (!indexName.trim()) {
      setError('Index name is required');
      return;
    }
    if (selectedCols.length === 0) {
      setError('Select at least one column');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const sql = buildSql();
      await invoke('execute_query', { connectionId, sql, database });
      onSuccess();
      onClose();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-xl w-[440px] max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold">Add Index — {tableName}</h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--bg-hover)] rounded">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          {/* Index name */}
          <div>
            <label className="block text-[var(--text-muted)] mb-1">
              Index Name <span className="text-red-400">*</span>
            </label>
            <input
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder={`idx_${tableName}_column`}
              autoComplete="off"
              autoCapitalize="off"
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] text-xs"
              autoFocus
            />
          </div>

          {/* Type + Unique */}
          <div className="flex gap-4 items-end">
            {dbType !== 'sqlite' && (
              <div className="flex-1">
                <label className="block text-[var(--text-muted)] mb-1">Index Type</label>
                <select
                  value={indexType}
                  onChange={(e) => setIndexType(e.target.value)}
                  className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] text-xs"
                >
                  {indexTypes.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer pb-1.5 text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={isUnique}
                onChange={(e) => setIsUnique(e.target.checked)}
              />
              UNIQUE
            </label>
          </div>

          {/* Columns */}
          <div>
            <label className="block text-[var(--text-muted)] mb-1">
              Columns <span className="text-red-400">*</span>
              <span className="ml-1 font-normal text-[var(--text-muted)]">(checked = included, order matters)</span>
            </label>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded p-2 max-h-[160px] overflow-y-auto space-y-0.5">
              {columns.map((c) => (
                <label
                  key={c.name}
                  className="flex items-center gap-2 cursor-pointer hover:bg-[var(--bg-hover)] rounded px-1 py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={selectedCols.includes(c.name)}
                    onChange={() => toggleCol(c.name)}
                  />
                  <span className="font-mono text-[var(--text-primary)]">{c.name}</span>
                  <span className="text-[var(--text-muted)]">{c.columnType}</span>
                  {c.isPrimaryKey && (
                    <span className="text-yellow-400 text-[10px]">PK</span>
                  )}
                </label>
              ))}
            </div>
            {selectedCols.length > 0 && (
              <div className="mt-1 text-[var(--text-muted)]">
                Order: {selectedCols.join(' → ')}
              </div>
            )}
          </div>

          {/* SQL preview */}
          <div>
            <label className="block text-[var(--text-muted)] mb-1">SQL Preview</label>
            <pre className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-2 text-[10px] text-[var(--text-muted)] whitespace-pre-wrap break-all font-mono">
              {indexName.trim() && selectedCols.length > 0
                ? buildSql()
                : '(fill in name and select columns)'}
            </pre>
          </div>

          {error && (
            <div className="text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5 break-all">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-[var(--border)] hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={12} />
            {loading ? 'Creating…' : 'Create Index'}
          </button>
        </div>
      </div>
    </div>
  );
}
