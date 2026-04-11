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

const MYSQL_TYPES = [
  'VARCHAR', 'CHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'INT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT',
  'FLOAT', 'DOUBLE', 'DECIMAL',
  'BOOLEAN',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'TINYBLOB',
  'JSON',
];
const PG_TYPES = [
  'VARCHAR', 'CHAR', 'TEXT',
  'SMALLINT', 'INTEGER', 'BIGINT', 'SERIAL', 'BIGSERIAL',
  'REAL', 'DOUBLE PRECISION', 'NUMERIC',
  'BOOLEAN',
  'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIME',
  'BYTEA', 'JSON', 'JSONB', 'UUID',
];
const SQLITE_TYPES = ['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC'];

const NEEDS_LENGTH = ['VARCHAR', 'CHAR', 'DECIMAL', 'NUMERIC'];
const INT_TYPES = ['INT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT', 'INTEGER'];

export function AddColumnDialog({
  connectionId,
  database,
  tableName,
  schema,
  dbType,
  columns,
  onClose,
  onSuccess,
}: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState('VARCHAR');
  const [length, setLength] = useState('255');
  const [notNull, setNotNull] = useState(false);
  const [defaultValue, setDefaultValue] = useState('');
  const [comment, setComment] = useState('');
  const [autoIncrement, setAutoIncrement] = useState(false);
  const [afterColumn, setAfterColumn] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeList = dbType === 'postgres' ? PG_TYPES : dbType === 'sqlite' ? SQLITE_TYPES : MYSQL_TYPES;
  const hasLength = NEEDS_LENGTH.some((t) => type.toUpperCase().startsWith(t));
  const canAutoInc = dbType === 'mysql' && INT_TYPES.includes(type.toUpperCase());

  const buildSql = (): string => {
    let typeDef = type;
    if (hasLength && length) typeDef = `${type}(${length})`;

    const parts: string[] = [typeDef];
    if (notNull) parts.push('NOT NULL');
    if (autoIncrement && dbType === 'mysql') parts.push('AUTO_INCREMENT');
    if (defaultValue.trim()) parts.push(`DEFAULT ${defaultValue.trim()}`);
    if (comment.trim() && dbType === 'mysql') {
      parts.push(`COMMENT '${comment.replace(/'/g, "''")}'`);
    }

    const colDef =
      dbType === 'mysql'
        ? `\`${name}\` ${parts.join(' ')}`
        : `"${name}" ${parts.join(' ')}`;

    if (dbType === 'mysql') {
      let sql = `ALTER TABLE \`${database}\`.\`${tableName}\` ADD COLUMN ${colDef}`;
      if (afterColumn) sql += ` AFTER \`${afterColumn}\``;
      return sql;
    } else if (dbType === 'sqlite') {
      return `ALTER TABLE "${tableName}" ADD COLUMN ${colDef}`;
    } else {
      const s = schema ?? 'public';
      return `ALTER TABLE "${s}"."${tableName}" ADD COLUMN ${colDef}`;
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Column name is required');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-xl w-[480px] max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold">Add Column — {tableName}</h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--bg-hover)] rounded">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          {/* Name */}
          <div>
            <label className="block text-[var(--text-muted)] mb-1">Column Name <span className="text-red-400">*</span></label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="column_name"
              autoComplete="off"
              autoCapitalize="off"
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] text-xs"
              autoFocus
            />
          </div>

          {/* Type + Length */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[var(--text-muted)] mb-1">Data Type</label>
              <select
                value={type}
                onChange={(e) => { setType(e.target.value); setAutoIncrement(false); }}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] text-xs"
              >
                {typeList.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {hasLength && (
              <div className="w-24">
                <label className="block text-[var(--text-muted)] mb-1">Length</label>
                <input
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] text-xs"
                />
              </div>
            )}
          </div>

          {/* Constraints */}
          <div className="flex gap-4 text-[var(--text-primary)]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={notNull} onChange={(e) => setNotNull(e.target.checked)} />
              NOT NULL
            </label>
            {canAutoInc && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={autoIncrement} onChange={(e) => setAutoIncrement(e.target.checked)} />
                AUTO_INCREMENT
              </label>
            )}
          </div>

          {/* Default */}
          <div>
            <label className="block text-[var(--text-muted)] mb-1">Default Value</label>
            <input
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder="e.g. 0, 'value', CURRENT_TIMESTAMP"
              autoComplete="off"
              autoCapitalize="off"
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] text-xs"
            />
          </div>

          {/* Comment (MySQL only) */}
          {dbType === 'mysql' && (
            <div>
              <label className="block text-[var(--text-muted)] mb-1">Comment</label>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] text-xs"
              />
            </div>
          )}

          {/* After column (MySQL only) */}
          {dbType === 'mysql' && columns.length > 0 && (
            <div>
              <label className="block text-[var(--text-muted)] mb-1">Insert After Column</label>
              <select
                value={afterColumn}
                onChange={(e) => setAfterColumn(e.target.value)}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1.5 outline-none focus:border-[var(--accent)] text-xs"
              >
                <option value="">— End of table —</option>
                {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* SQL preview */}
          <div>
            <label className="block text-[var(--text-muted)] mb-1">SQL Preview</label>
            <pre className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-2 text-[10px] text-[var(--text-muted)] whitespace-pre-wrap break-all font-mono">
              {name.trim() ? buildSql() : '(fill in column name)'}
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
            {loading ? 'Adding…' : 'Add Column'}
          </button>
        </div>
      </div>
    </div>
  );
}
