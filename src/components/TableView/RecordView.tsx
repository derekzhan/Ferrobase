import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Save, RotateCcw, AlertCircle, Copy,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { QueryResult } from '../../types';
import { extractErrorMessage } from '../../lib/utils';
import { useSettingsStore } from '../../stores';
import { formatMongoValue, parseMongoInputValue, shouldUseMongoJsonEditor } from './mongoValue';

interface Props {
  results: QueryResult;
  connectionId: string;
  database: string;
  tableName: string;
  schema?: string;
  dbType: string;
  onRefresh: () => void;
  initialRowIndex?: number;
  onRowChange?: (rowIndex: number) => void;
}

function quoteId(name: string, dbType: string): string {
  return dbType === 'mysql' ? `\`${name}\`` : `"${name}"`;
}

function buildTableRef(database: string, schema: string | undefined, tableName: string, dbType: string): string {
  if (dbType === 'mysql') return `\`${database}\`.\`${tableName}\``;
  if (dbType === 'sqlite') return `"${tableName}"`;
  return `"${schema ?? 'public'}"."${tableName}"`;
}

function sqlVal(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'object') {
    const json = JSON.stringify(val);
    return `'${json.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  const s = String(val);
  if (s.trim().toUpperCase() === 'NULL') return 'NULL';
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function RecordView({
  results, connectionId, database, tableName, schema, dbType, onRefresh,
  initialRowIndex = 0, onRowChange,
}: Props) {
  const { settings } = useSettingsStore();
  const [currentRow, setCurrentRowRaw] = useState(
    Math.min(initialRowIndex, Math.max(0, results.rows.length - 1)),
  );
  const [editingField, setEditingField] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [dirtyFields, setDirtyFields] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Refs to always read latest state in async save flow
  const dirtyFieldsRef = useRef(dirtyFields);
  dirtyFieldsRef.current = dirtyFields;
  const editingFieldRef = useRef(editingField);
  editingFieldRef.current = editingField;

  // Wrap setCurrentRow to also notify parent
  const setCurrentRow = useCallback((idx: number | ((prev: number) => number)) => {
    setCurrentRowRaw((prev) => {
      const next = typeof idx === 'function' ? idx(prev) : idx;
      onRowChange?.(next);
      return next;
    });
  }, [onRowChange]);

  // Clamp currentRow when results change (e.g. after refresh with fewer rows)
  useEffect(() => {
    if (results.rows.length > 0 && currentRow >= results.rows.length) {
      setCurrentRow(results.rows.length - 1);
    }
  }, [results.rows.length]);

  const totalRows = results.rows.length;
  const pkCols = results.columns.filter((c) => c.isPrimaryKey);
  const hasPk = pkCols.length > 0;
  const tblRef = buildTableRef(database, schema, tableName, dbType);
  const hasChanges = Object.keys(dirtyFields).length > 0 || editingField !== null;

  const row = totalRows > 0 ? results.rows[currentRow] : null;

  const getCellVal = (colIdx: number): unknown => {
    const colName = results.columns[colIdx].name;
    if (colName in dirtyFields) return dirtyFields[colName];
    return row ? row[colIdx] : null;
  };

  const navigate = (target: number) => {
    if (hasChanges) {
      // auto-revert on navigate; data was not saved
      setDirtyFields({});
    }
    setEditingField(null);
    const clamped = Math.max(0, Math.min(totalRows - 1, target));
    setCurrentRow(clamped);
    setSaveError(null);
  };

  const startEdit = (colIdx: number) => {
    if (!hasPk) return;
    if (dbType === 'mongodb' && results.columns[colIdx].name === '_id') return;
    const val = getCellVal(colIdx);
    setEditingField(colIdx);
    if (val === null || val === undefined) {
      setEditValue('');
    } else if (dbType === 'mongodb' && !shouldUseMongoJsonEditor(val, results.columns[colIdx].dataType?.toLowerCase() ?? '')) {
      setEditValue(formatMongoValue(val));
    } else if (typeof val === 'object') {
      setEditValue(JSON.stringify(val, null, 2));
    } else {
      setEditValue(String(val));
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitEdit = useCallback(() => {
    if (editingField === null || !row) return;
    const colName = results.columns[editingField].name;
    const originalVal = row[editingField];
    const colDataType = results.columns[editingField].dataType?.toLowerCase() ?? '';
    let newVal: unknown = editValue.trim().toUpperCase() === 'NULL'
      ? null
      : dbType === 'mongodb'
        ? parseMongoInputValue(editValue, colDataType)
        : editValue;

    const unchanged =
      (newVal === null && (originalVal === null || originalVal === undefined)) ||
      (newVal !== null && String(newVal) === String(originalVal));

    setDirtyFields((prev) => {
      const next = { ...prev };
      if (!unchanged) next[colName] = newVal;
      else delete next[colName];
      return next;
    });
    setEditingField(null);
  }, [dbType, editingField, editValue, row, results]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditingField(null);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    }
  };

  const saveChanges = async () => {
    if (!row) return;

    // Always commit any active edit first, then wait for React to flush
    if (editingFieldRef.current !== null) {
      commitEdit();
      await new Promise((r) => setTimeout(r, 0));
    }

    // Read latest dirty fields from ref (after React flush)
    const currentDirty = dirtyFieldsRef.current;
    if (Object.keys(currentDirty).length === 0) {
      return; // nothing to save
    }

    setSaving(true);
    setSaveError(null);
    try {
      if (dbType === 'mongodb') {
        const idColIdx = results.columns.findIndex((c) => c.name === '_id');
        const idVal = idColIdx >= 0 ? row[idColIdx] : null;
        if (!idVal) throw new Error('Cannot save: no _id field');
        await invoke('update_document', {
          connectionId, database, collection: tableName,
          filter: { _id: idVal },
          update: { $set: currentDirty },
        });
      } else {
        const setClause = Object.entries(currentDirty)
          .map(([col, val]) => `${quoteId(col, dbType)} = ${sqlVal(val)}`)
          .join(', ');
        const whereClause = pkCols
          .map((pk) => {
            const pkIdx = results.columns.findIndex((c) => c.name === pk.name);
            return `${quoteId(pk.name, dbType)} = ${sqlVal(row[pkIdx])}`;
          })
          .join(' AND ');
        const sql = `UPDATE ${tblRef} SET ${setClause} WHERE ${whereClause}`;
        await invoke('execute_query', { connectionId, sql, database });
      }
      setDirtyFields({});
      onRefresh();
    } catch (e) {
      setSaveError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    setDirtyFields({});
    setEditingField(null);
    setSaveError(null);
  };

  const copyValue = (val: unknown) => {
    const text = val === null || val === undefined
      ? 'NULL'
      : typeof val === 'object'
        ? JSON.stringify(val, null, 2)
        : String(val);
    navigator.clipboard.writeText(text);
  };

  const renderValue = (val: unknown) => {
    if (val === null || val === undefined) {
      return <span className="text-[var(--text-muted)] italic">{settings.nullDisplay || 'NULL'}</span>;
    }
    if (typeof val === 'boolean') {
      return <span className={val ? 'text-green-400' : 'text-red-400'}>{String(val)}</span>;
    }
    if (typeof val === 'object') {
      if (dbType === 'mongodb') {
        return <span className="text-purple-400 font-mono text-[11px]">{formatMongoValue(val)}</span>;
      }
      return <span className="text-purple-400 font-mono text-[11px]">{JSON.stringify(val)}</span>;
    }
    return <span className="text-[var(--text-primary)]">{String(val)}</span>;
  };

  if (totalRows === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
        No data
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex-shrink-0">
        {/* Navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate(0)}
            disabled={currentRow <= 0}
            className="p-1 hover:bg-[var(--bg-hover)] rounded disabled:opacity-30"
            title="First row"
          >
            <ChevronsLeft size={14} />
          </button>
          <button
            onClick={() => navigate(currentRow - 1)}
            disabled={currentRow <= 0}
            className="p-1 hover:bg-[var(--bg-hover)] rounded disabled:opacity-30"
            title="Previous row"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[var(--text-muted)] min-w-[80px] text-center tabular-nums">
            Row {currentRow + 1}/{totalRows}
          </span>
          <button
            onClick={() => navigate(currentRow + 1)}
            disabled={currentRow >= totalRows - 1}
            className="p-1 hover:bg-[var(--bg-hover)] rounded disabled:opacity-30"
            title="Next row"
          >
            <ChevronRight size={14} />
          </button>
          <button
            onClick={() => navigate(totalRows - 1)}
            disabled={currentRow >= totalRows - 1}
            className="p-1 hover:bg-[var(--bg-hover)] rounded disabled:opacity-30"
            title="Last row"
          >
            <ChevronsRight size={14} />
          </button>
        </div>

        <div className="flex-1" />

        {!hasPk && (
          <span className="flex items-center gap-1 text-yellow-500/70">
            <AlertCircle size={10} /> No PK — editing disabled
          </span>
        )}

        {saveError && (
          <span className="text-red-400 flex items-center gap-1 max-w-[200px] truncate">
            <AlertCircle size={10} className="flex-shrink-0" /> {saveError}
          </span>
        )}

        {hasChanges && (
          <>
            <button
              onClick={revert}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
            >
              <RotateCcw size={10} /> Revert
            </button>
            <button
              onClick={saveChanges}
              disabled={saving}
              className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              <Save size={10} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>

      {/* Record fields */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse" style={{ minWidth: 500 }}>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] bg-[var(--bg-secondary)] border-b border-r border-[var(--border)] w-[280px]">
                Field
              </th>
              <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {results.columns.map((col, colIdx) => {
              const val = getCellVal(colIdx);
              const isDirty = col.name in dirtyFields;
              const isEditing = editingField === colIdx;
              return (
                <tr
                  key={col.name}
                  className={`border-b border-[var(--border)] hover:bg-[var(--bg-hover)] ${isDirty ? 'bg-yellow-500/5' : ''}`}
                >
                  {/* Field name cell */}
                  <td className="px-3 py-2 border-r border-[var(--border)] align-top w-[280px]">
                    <div className="flex items-center gap-2">
                      {col.isPrimaryKey && <span className="text-[10px]">🔑</span>}
                      <span className={`font-medium ${col.isPrimaryKey ? 'text-yellow-400' : 'text-[var(--text-primary)]'}`}>
                        {col.name}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] opacity-60">{col.dataType}</span>
                    </div>
                  </td>
                  {/* Value cell */}
                  <td
                    className={`px-3 py-2 align-top ${hasPk && !isEditing ? 'cursor-text' : ''}`}
                    onDoubleClick={() => startEdit(colIdx)}
                  >
                    {isEditing ? (
                      <div className="flex items-start gap-2">
                        <textarea
                          ref={inputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onBlur={commitEdit}
                          rows={Math.min(8, Math.max(1, editValue.split('\n').length))}
                          autoComplete="off"
                          autoCapitalize="off"
                          className="flex-1 bg-[var(--bg-primary)] border border-[var(--accent)] rounded px-2 py-1 outline-none font-mono text-xs resize-y min-w-[200px]"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 group">
                        <div className="flex-1 break-all font-mono text-[11px] whitespace-pre-wrap">
                          {renderValue(val)}
                        </div>
                        <button
                          onClick={() => copyValue(val)}
                          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 flex-shrink-0"
                          title="Copy value"
                        >
                          <Copy size={11} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
