import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  Save, RotateCcw, AlertCircle, Plus, Trash2,
  ArrowUp, ArrowDown, ChevronsUpDown, Copy, ClipboardList,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { QueryResult } from '../../types';
import { cn, extractErrorMessage } from '../../lib/utils';
import { useSettingsStore } from '../../stores';
import { ContextMenu, type MenuItemOrSeparator } from '../ContextMenu';
import { JsonEditorDialog } from './JsonEditorDialog';
import { useConfirmDialog } from '../ConfirmDialog';
import {
  formatMongoValue,
  parseMongoInputValue,
  shouldUseMongoJsonEditor,
} from './mongoValue';

interface Props {
  results: QueryResult;
  connectionId: string;
  database: string;
  tableName: string;
  schema?: string;
  dbType: string;
  onRefresh: () => void;
  onRowSelect?: (rowIndex: number) => void;
}

type DirtyRows = Map<number, Record<string, unknown>>;
type NewRowData = Record<string, unknown>;

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

export function EditableDataGrid({
  results, connectionId, database, tableName, schema, dbType, onRefresh, onRowSelect,
}: Props) {
  const { settings } = useSettingsStore();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();

  // Sort state
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Selection
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // Edits
  const [dirtyRows, setDirtyRows] = useState<DirtyRows>(new Map());
  const [newRows, setNewRows] = useState<NewRowData[]>([]);
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set());

  // Cell editing
  const [editingCell, setEditingCell] = useState<{ rowRef: 'new' | number; newIdx?: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Row context menu
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; items: MenuItemOrSeparator[] } | null>(null);

  // JSON editor dialog
  const [jsonEditor, setJsonEditor] = useState<{
    rowRef: 'new' | number;
    newIdx?: number;
    colIdx: number;
    value: unknown;
    columnName: string;
    readOnly: boolean;
  } | null>(null);

  const pkCols = results.columns.filter((c) => c.isPrimaryKey);
  const hasPk = pkCols.length > 0;
  const tblRef = buildTableRef(database, schema, tableName, dbType);
  const hasChanges = dirtyRows.size > 0 || newRows.length > 0 || deletedRows.size > 0 || editingCell !== null;

  // Sorted original row indices (exclude deleted)
  const sortedIndices = useMemo(() => {
    const indices = Array.from({ length: results.rows.length }, (_, i) => i)
      .filter((i) => !deletedRows.has(i));
    if (!sortCol) return indices;
    const colIdx = results.columns.findIndex((c) => c.name === sortCol);
    if (colIdx < 0) return indices;
    return [...indices].sort((a, b) => {
      const av = results.rows[a][colIdx];
      const bv = results.rows[b][colIdx];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [results, sortCol, sortDir, deletedRows]);

  const toggleSort = (colName: string) => {
    if (sortCol === colName) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortCol(null); }
    } else {
      setSortCol(colName);
      setSortDir('asc');
    }
  };

  // Cell value lookup
  const getCellVal = (originalIdx: number, colIdx: number): unknown => {
    const colName = results.columns[colIdx].name;
    const dirty = dirtyRows.get(originalIdx);
    return dirty && colName in dirty ? dirty[colName] : results.rows[originalIdx][colIdx];
  };

  const getNewCellVal = (newIdx: number, colIdx: number): unknown => {
    const colName = results.columns[colIdx].name;
    return newRows[newIdx]?.[colName] ?? null;
  };

  // Toggle row selection
  const toggleSelectRow = (originalIdx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(originalIdx)) next.delete(originalIdx);
      else next.add(originalIdx);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === sortedIndices.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(sortedIndices));
    }
  };

  // Start editing — open JSON editor for object/json values, inline input for primitives
  const startEdit = (rowRef: 'new' | number, newIdx: number | undefined, colIdx: number) => {
    if (rowRef !== 'new' && !hasPk) return;
    if (dbType === 'mongodb' && rowRef !== 'new' && results.columns[colIdx].name === '_id') return;
    let currentVal: unknown;
    if (rowRef === 'new' && newIdx !== undefined) {
      currentVal = getNewCellVal(newIdx, colIdx);
    } else if (typeof rowRef === 'number') {
      currentVal = getCellVal(rowRef, colIdx);
    }

    const colDataType = results.columns[colIdx].dataType?.toLowerCase() ?? '';
    const opensJsonEditor = dbType === 'mongodb'
      ? shouldUseMongoJsonEditor(currentVal, colDataType)
      : colDataType === 'json' || colDataType === 'jsonb' || (currentVal !== null && currentVal !== undefined && typeof currentVal === 'object');

    // Open JSON editor dialog for object values or JSON-typed columns
    if (opensJsonEditor) {
      setJsonEditor({
        rowRef,
        newIdx,
        colIdx,
        value: currentVal,
        columnName: results.columns[colIdx].name,
        readOnly: rowRef !== 'new' && !hasPk,
      });
      return;
    }

    setEditingCell({ rowRef, newIdx, col: colIdx });
    setEditValue(
      currentVal === null || currentVal === undefined
        ? ''
        : dbType === 'mongodb'
          ? formatMongoValue(currentVal)
          : String(currentVal)
    );
    setTimeout(() => inputRef.current?.select(), 0);
  };

  // Handle save from JSON editor dialog
  const handleJsonEditorSave = (newVal: unknown) => {
    if (!jsonEditor) return;
    const { rowRef, newIdx, colIdx } = jsonEditor;
    const colName = results.columns[colIdx].name;

    if (rowRef === 'new' && newIdx !== undefined) {
      setNewRows((prev) => {
        const next = [...prev];
        next[newIdx] = { ...next[newIdx], [colName]: newVal };
        return next;
      });
    } else if (typeof rowRef === 'number') {
      const originalVal = results.rows[rowRef][colIdx];
      const unchanged = JSON.stringify(newVal) === JSON.stringify(originalVal);
      setDirtyRows((prev) => {
        const next = new Map(prev);
        const row = { ...(next.get(rowRef) ?? {}) };
        if (!unchanged) row[colName] = newVal;
        else delete row[colName];
        if (Object.keys(row).length > 0) next.set(rowRef, row);
        else next.delete(rowRef);
        return next;
      });
    }
  };

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const { rowRef, newIdx, col: colIdx } = editingCell;
    const colName = results.columns[colIdx].name;
    const colDataType = results.columns[colIdx].dataType?.toLowerCase() ?? '';
    let newVal: unknown = editValue.trim().toUpperCase() === 'NULL'
      ? null
      : dbType === 'mongodb'
        ? parseMongoInputValue(editValue, colDataType)
        : editValue;

    if (rowRef === 'new' && newIdx !== undefined) {
      setNewRows((prev) => {
        const next = [...prev];
        next[newIdx] = { ...next[newIdx], [colName]: newVal };
        return next;
      });
    } else if (typeof rowRef === 'number') {
      const originalVal = results.rows[rowRef][colIdx];
      const unchanged = (newVal === null && (originalVal === null || originalVal === undefined))
        || (newVal !== null && String(newVal) === String(originalVal));
      setDirtyRows((prev) => {
        const next = new Map(prev);
        const row = { ...(next.get(rowRef) ?? {}) };
        if (!unchanged) row[colName] = newVal;
        else delete row[colName];
        if (Object.keys(row).length > 0) next.set(rowRef, row);
        else next.delete(rowRef);
        return next;
      });
    }
    setEditingCell(null);
  }, [dbType, editingCell, editValue, results]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') setEditingCell(null);
  };

  // Add row
  const addRow = () => {
    const emptyRow: NewRowData = {};
    results.columns.forEach((c) => { emptyRow[c.name] = null; });
    setNewRows((prev) => [...prev, emptyRow]);
  };

  // Delete selected rows
  const deleteSelected = () => {
    if (!hasPk && deletedRows.size === 0) return;
    setDeletedRows((prev) => {
      const next = new Set(prev);
      selectedRows.forEach((i) => next.add(i));
      return next;
    });
    setSelectedRows(new Set());
  };

  const removeNewRow = (idx: number) => {
    setNewRows((prev) => prev.filter((_, i) => i !== idx));
  };

  // Row SQL helpers
  const rowToInsertSql = (row: unknown[], colIndices?: number[]) => {
    const cols = (colIndices ?? results.columns.map((_, i) => i));
    const colList = cols.map((i) => quoteId(results.columns[i].name, dbType)).join(', ');
    const valList = cols.map((i) => sqlVal(row[i])).join(', ');
    return `INSERT INTO ${tblRef} (${colList}) VALUES (${valList});`;
  };

  const rowToUpdateSql = (originalIdx: number) => {
    if (!hasPk) return null;
    const row = results.rows[originalIdx];
    const editableCols = results.columns.filter((c) => !c.isPrimaryKey);
    const setClause = editableCols.map((c, _) => {
      const colIdx = results.columns.findIndex((x) => x.name === c.name);
      return `${quoteId(c.name, dbType)} = ${sqlVal(row[colIdx])}`;
    }).join(', ');
    const whereClause = pkCols.map((pk) => {
      const pkIdx = results.columns.findIndex((c) => c.name === pk.name);
      return `${quoteId(pk.name, dbType)} = ${sqlVal(row[pkIdx])}`;
    }).join(' AND ');
    return `UPDATE ${tblRef} SET ${setClause} WHERE ${whereClause};`;
  };

  const rowToDeleteSql = (originalIdx: number) => {
    if (!hasPk) return null;
    const row = results.rows[originalIdx];
    const whereClause = pkCols.map((pk) => {
      const pkIdx = results.columns.findIndex((c) => c.name === pk.name);
      return `${quoteId(pk.name, dbType)} = ${sqlVal(row[pkIdx])}`;
    }).join(' AND ');
    return `DELETE FROM ${tblRef} WHERE ${whereClause};`;
  };

  const showRowMenu = (e: React.MouseEvent, originalIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItemOrSeparator[] = [
      {
        label: 'Copy as INSERT',
        icon: <Copy size={12} />,
        onClick: () => navigator.clipboard.writeText(rowToInsertSql(results.rows[originalIdx])),
      },
    ];
    const updateSql = rowToUpdateSql(originalIdx);
    if (updateSql) {
      items.push({
        label: 'Copy as UPDATE',
        icon: <ClipboardList size={12} />,
        onClick: () => navigator.clipboard.writeText(updateSql),
      });
    }
    const deleteSql = rowToDeleteSql(originalIdx);
    if (deleteSql) {
      items.push({
        label: 'Copy as DELETE',
        icon: <Trash2 size={12} />,
        onClick: () => navigator.clipboard.writeText(deleteSql),
      });
    }
    if (hasPk) {
      items.push({ separator: true });
      items.push({
        label: 'Delete Row',
        icon: <Trash2 size={12} />,
        danger: true,
        onClick: () => setDeletedRows((prev) => new Set([...prev, originalIdx])),
      });
    }
    setRowMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Save all changes — uses refs to always read latest state
  const dirtyRowsRef = useRef(dirtyRows);
  dirtyRowsRef.current = dirtyRows;
  const newRowsRef = useRef(newRows);
  newRowsRef.current = newRows;
  const deletedRowsRef = useRef(deletedRows);
  deletedRowsRef.current = deletedRows;
  const editingCellRef = useRef(editingCell);
  editingCellRef.current = editingCell;
  const editValueRef = useRef(editValue);
  editValueRef.current = editValue;

  const saveChanges = async () => {
    // If a cell is currently being edited, commit it synchronously via ref-based logic
    if (editingCellRef.current) {
      commitEdit();
      // Wait one tick for React state to update refs
      await new Promise((r) => setTimeout(r, 0));
    }

    const currentDirty = dirtyRowsRef.current;
    const currentNew = newRowsRef.current;
    const currentDeleted = deletedRowsRef.current;

    if (currentDirty.size === 0 && currentNew.length === 0 && currentDeleted.size === 0) {
      return;
    }

    // Confirm if there are deletions
    if (currentDeleted.size > 0) {
      const ok = await confirm({
        title: 'Confirm Delete',
        message: `You are about to permanently delete ${currentDeleted.size} row${currentDeleted.size > 1 ? 's' : ''} from table "${tableName}". This action cannot be undone.`,
        variant: 'danger',
        confirmLabel: `Delete ${currentDeleted.size} Row${currentDeleted.size > 1 ? 's' : ''}`,
      });
      if (!ok) return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      if (dbType === 'mongodb') {
        await saveChangesMongo(currentDirty, currentNew, currentDeleted);
      } else {
        await saveChangesSql(currentDirty, currentNew, currentDeleted);
      }

      setDirtyRows(new Map());
      setNewRows([]);
      setDeletedRows(new Set());
      setSelectedRows(new Set());
      onRefresh();
    } catch (e) {
      setSaveError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // MongoDB-specific save: uses MongoDB API (not SQL)
  const saveChangesMongo = async (
    currentDirty: DirtyRows,
    currentNew: NewRowData[],
    currentDeleted: Set<number>,
  ) => {
    const idColIdx = results.columns.findIndex((c) => c.name === '_id');

    // 1. DELETE
    for (const rowIdx of currentDeleted) {
      const row = results.rows[rowIdx];
      const idVal = idColIdx >= 0 ? row[idColIdx] : null;
      if (!idVal) continue;
      await invoke('delete_document', {
        connectionId, database, collection: tableName, filter: { _id: idVal },
      });
    }

    // 2. UPDATE
    for (const [rowIdx, changes] of currentDirty.entries()) {
      if (currentDeleted.has(rowIdx)) continue;
      const row = results.rows[rowIdx];
      const idVal = idColIdx >= 0 ? row[idColIdx] : null;
      if (!idVal) continue;
      await invoke('update_document', {
        connectionId, database, collection: tableName,
        filter: { _id: idVal },
        update: { $set: changes },
      });
    }

    // 3. INSERT
    for (const newRow of currentNew) {
      const doc: Record<string, unknown> = {};
      for (const col of results.columns) {
        if (col.name === '_id') continue; // let MongoDB generate _id
        const val = newRow[col.name];
        if (val !== null && val !== undefined && val !== '') doc[col.name] = val;
      }
      if (Object.keys(doc).length === 0) continue;
      await invoke('insert_document', { connectionId, database, collection: tableName, document: doc });
    }
  };

  // SQL-based save (MySQL, PostgreSQL, SQLite)
  const saveChangesSql = async (
    currentDirty: DirtyRows,
    currentNew: NewRowData[],
    currentDeleted: Set<number>,
  ) => {
    // 1. DELETE
    for (const rowIdx of currentDeleted) {
      const row = results.rows[rowIdx];
      const whereClause = pkCols
        .map((pk) => {
          const pkIdx = results.columns.findIndex((c) => c.name === pk.name);
          return `${quoteId(pk.name, dbType)} = ${sqlVal(row[pkIdx])}`;
        })
        .join(' AND ');
      const sql = `DELETE FROM ${tblRef} WHERE ${whereClause}`;
      await invoke('execute_query', { connectionId, sql, database });
    }

    // 2. UPDATE
    for (const [rowIdx, changes] of currentDirty.entries()) {
      if (currentDeleted.has(rowIdx)) continue;
      const row = results.rows[rowIdx];
      const setClause = Object.entries(changes)
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

    // 3. INSERT new rows
    for (const newRow of currentNew) {
      const nonNullCols = results.columns.filter(
        (c) => newRow[c.name] !== null && newRow[c.name] !== undefined && newRow[c.name] !== '',
      );
      if (nonNullCols.length === 0) continue;
      const colList = nonNullCols.map((c) => quoteId(c.name, dbType)).join(', ');
      const valList = nonNullCols.map((c) => sqlVal(newRow[c.name])).join(', ');
      const sql = `INSERT INTO ${tblRef} (${colList}) VALUES (${valList})`;
      await invoke('execute_query', { connectionId, sql, database });
    }
  };

  const revertChanges = () => {
    setDirtyRows(new Map());
    setNewRows([]);
    setDeletedRows(new Set());
    setSelectedRows(new Set());
    setEditingCell(null);
    setSaveError(null);
  };

  // Stats for selected (or all) rows — only computed when rows are selected
  const stats = useMemo(() => {
    if (selectedRows.size === 0) return null;
    const targetIndices = [...selectedRows].filter((i) => !deletedRows.has(i));
    if (targetIndices.length === 0) return null;
    const numericCols = results.columns.map((col, ci) => ({ col, ci })).filter(({ ci }) =>
      targetIndices.some((ri) => typeof results.rows[ri][ci] === 'number')
    );
    if (numericCols.length === 0) return null;
    return numericCols.slice(0, 5).map(({ col, ci }) => {
      const vals = targetIndices.map((ri) => results.rows[ri][ci]).filter((v): v is number => typeof v === 'number');
      if (vals.length === 0) return null;
      const sum = vals.reduce((a, b) => a + b, 0);
      const avg = sum / vals.length;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      return { name: col.name, count: vals.length, sum, avg, min, max };
    }).filter(Boolean);
  }, [results, selectedRows, sortedIndices, deletedRows]);

  const renderCellDisplay = (val: unknown) => {
    if (val === null || val === undefined) {
      return <span className="text-[var(--text-muted)] italic text-[10px]">{settings.nullDisplay || 'NULL'}</span>;
    }
    if (typeof val === 'boolean') {
      const labels = { 'true/false': val ? 'true' : 'false', '1/0': val ? '1' : '0', 'YES/NO': val ? 'YES' : 'NO' };
      return <span className={val ? 'text-green-400' : 'text-red-400'}>{labels[settings.boolDisplay]}</span>;
    }
    if (typeof val === 'object') {
      if (dbType === 'mongodb') {
        return <span className="text-purple-400 text-[10px] cursor-pointer">{formatMongoValue(val)}</span>;
      }
      const jsonStr = JSON.stringify(val);
      return <span className="text-purple-400 text-[10px] cursor-pointer" title={jsonStr}>{jsonStr.length > 60 ? jsonStr.slice(0, 60) + '…' : jsonStr}</span>;
    }
    return <span>{String(val)}</span>;
  };

  const allSelected = sortedIndices.length > 0 && sortedIndices.every((i) => selectedRows.has(i));

  return (
    <div className="flex flex-col h-full text-xs">
      {ConfirmDialogElement}
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex-shrink-0">
        <button
          onClick={addRow}
          title="Add new row"
          className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <Plus size={11} /> Add Row
        </button>
        {selectedRows.size > 0 && hasPk && (
          <button
            onClick={deleteSelected}
            title="Delete selected rows"
            className="flex items-center gap-1 px-2 py-1 rounded border border-red-500/30 hover:bg-red-500/10 text-red-400"
          >
            <Trash2 size={11} /> Delete ({selectedRows.size})
          </button>
        )}
        {!hasPk && (
          <span className="flex items-center gap-1 text-yellow-500/70">
            <AlertCircle size={10} /> No PK — editing disabled
          </span>
        )}
        <div className="flex-1" />
        {hasChanges && (
          <>
            {saveError && (
              <span className="text-red-400 flex items-center gap-1 max-w-[200px] truncate">
                <AlertCircle size={10} className="flex-shrink-0" /> {saveError}
              </span>
            )}
            <button
              onClick={revertChanges}
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
              <Save size={10} /> {saving ? 'Saving…' : `Save${deletedRows.size + dirtyRows.size + newRows.length > 0 ? ` (${deletedRows.size + dirtyRows.size + newRows.length})` : ''}`}
            </button>
          </>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse" style={{ minWidth: 'max-content', width: '100%' }}>
          <thead className="sticky top-0 z-10">
            <tr>
              {/* Checkbox */}
              <th className="w-8 px-2 py-1.5 bg-[var(--bg-secondary)] border-b border-r border-[var(--border)] text-center select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="cursor-pointer"
                />
              </th>
              {/* Row number */}
              <th className="w-8 px-2 py-1.5 bg-[var(--bg-secondary)] border-b border-r border-[var(--border)] text-right text-[var(--text-muted)] font-normal select-none">
                #
              </th>
              {results.columns.map((col) => {
                const isSorted = sortCol === col.name;
                return (
                  <th
                    key={col.name}
                    className={cn(
                      'px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-r border-[var(--border)] text-left font-semibold whitespace-nowrap cursor-pointer hover:bg-[var(--bg-hover)] select-none',
                      col.isPrimaryKey ? 'text-yellow-400' : 'text-[var(--text-muted)]',
                    )}
                    onClick={() => toggleSort(col.name)}
                  >
                    <div className="flex items-center gap-1">
                      {col.isPrimaryKey && <span className="text-[10px]">🔑</span>}
                      <span>{col.name}</span>
                      <span className="opacity-50 text-[10px]">{col.dataType}</span>
                      {isSorted ? (
                        sortDir === 'asc' ? <ArrowUp size={10} className="text-[var(--accent)]" /> : <ArrowDown size={10} className="text-[var(--accent)]" />
                      ) : (
                        <ChevronsUpDown size={9} className="opacity-20" />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Existing rows */}
            {sortedIndices.map((originalIdx, displayIdx) => {
              const isSelected = selectedRows.has(originalIdx);
              const isDirty = dirtyRows.has(originalIdx);
              return (
                <tr
                  key={originalIdx}
                  className={cn(
                    'border-b border-[var(--border)] hover:bg-[var(--bg-hover)]',
                    isSelected && 'bg-[var(--accent)]/5',
                    isDirty && !isSelected && 'bg-yellow-500/5',
                  )}
                  onClick={() => onRowSelect?.(originalIdx)}
                  onContextMenu={(e) => showRowMenu(e, originalIdx)}
                >
                  <td className="px-2 py-1 text-center border-r border-[var(--border)] select-none">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      onClick={(e) => toggleSelectRow(originalIdx, e)}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-2 py-1 text-right text-[var(--text-muted)] border-r border-[var(--border)] tabular-nums select-none">
                    {displayIdx + 1}
                  </td>
                  {results.columns.map((col, colIdx) => {
                    const isEditing = editingCell?.rowRef === originalIdx && editingCell?.col === colIdx;
                    const val = getCellVal(originalIdx, colIdx);
                    const cellDirty = dirtyRows.get(originalIdx)?.[col.name] !== undefined;
                    return (
                      <td
                        key={col.name}
                        className={cn(
                          'px-3 py-1 border-r border-[var(--border)] max-w-[280px] truncate',
                          cellDirty && 'bg-yellow-500/10',
                          hasPk && !isEditing && !(dbType === 'mongodb' && col.name === '_id') && 'cursor-text',
                        )}
                        onDoubleClick={() => startEdit(originalIdx, undefined, colIdx)}
                        title={val !== null && val !== undefined ? (dbType === 'mongodb' ? formatMongoValue(val) : typeof val !== 'object' ? String(val) : undefined) : undefined}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={commitEdit}
                            autoComplete="off"
                            autoCapitalize="off"
                            className="w-full bg-[var(--bg-primary)] border border-[var(--accent)] rounded px-1 py-0.5 outline-none min-w-[80px]"
                            autoFocus
                          />
                        ) : renderCellDisplay(val)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* New rows */}
            {newRows.map((newRow, newIdx) => (
              <tr key={`new_${newIdx}`} className="border-b border-[var(--border)] bg-green-500/5">
                <td className="px-2 py-1 text-center border-r border-[var(--border)]">
                  <button
                    onClick={() => removeNewRow(newIdx)}
                    className="text-red-400 hover:text-red-300"
                    title="Remove new row"
                  >
                    <Trash2 size={10} />
                  </button>
                </td>
                <td className="px-2 py-1 text-right text-green-400 border-r border-[var(--border)] select-none font-semibold">
                  +
                </td>
                {results.columns.map((col, colIdx) => {
                  const isEditing = editingCell?.rowRef === 'new' && editingCell?.newIdx === newIdx && editingCell?.col === colIdx;
                  const val = getNewCellVal(newIdx, colIdx);
                  return (
                    <td
                      key={col.name}
                      className="px-3 py-1 border-r border-[var(--border)] max-w-[280px] truncate cursor-text"
                      onDoubleClick={() => startEdit('new', newIdx, colIdx)}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={handleKeyDown}
                          onBlur={commitEdit}
                          autoComplete="off"
                          autoCapitalize="off"
                          className="w-full bg-[var(--bg-primary)] border border-green-500 rounded px-1 py-0.5 outline-none min-w-[80px]"
                          autoFocus
                        />
                      ) : (
                        <span className="text-green-400/80 italic text-[10px]">
                          {val === null || val === undefined ? 'click to edit' : dbType === 'mongodb' ? formatMongoValue(val) : String(val)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            {sortedIndices.length === 0 && newRows.length === 0 && (
              <tr>
                <td colSpan={results.columns.length + 2} className="px-3 py-8 text-center text-[var(--text-muted)]">
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Stats bar — only shown when rows are selected */}
      {stats && stats.length > 0 && (
        <div className="flex items-center gap-4 px-3 py-1 border-t border-[var(--border)] bg-[var(--bg-secondary)] text-[10px] text-[var(--text-muted)] flex-shrink-0 overflow-x-auto">
          <span className="text-[var(--text-primary)] font-semibold">{selectedRows.size} selected</span>
          {stats.map((s) => s && (
            <span key={s.name} className="flex items-center gap-1.5 flex-shrink-0">
              <span className="font-semibold text-[var(--accent)]">{s.name}</span>
              <span>Count: {s.count}</span>
              <span className="text-[var(--text-muted)]">|</span>
              <span>Sum: {Number.isInteger(s.sum) ? s.sum.toLocaleString() : s.sum.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              <span className="text-[var(--text-muted)]">|</span>
              <span>Avg: {s.avg.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              <span className="text-[var(--text-muted)]">|</span>
              <span>Min: {s.min.toLocaleString()}</span>
              <span className="text-[var(--text-muted)]">|</span>
              <span>Max: {s.max.toLocaleString()}</span>
            </span>
          ))}
        </div>
      )}

      {/* Row context menu */}
      {rowMenu && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={rowMenu.items}
          onClose={() => setRowMenu(null)}
        />
      )}

      {/* JSON editor dialog */}
      {jsonEditor && (
        <JsonEditorDialog
          value={jsonEditor.value}
          columnName={jsonEditor.columnName}
          readOnly={jsonEditor.readOnly}
          onSave={handleJsonEditorSave}
          onClose={() => setJsonEditor(null)}
        />
      )}
    </div>
  );
}
