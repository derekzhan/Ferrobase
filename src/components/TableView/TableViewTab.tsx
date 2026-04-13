import { useState, useEffect, useMemo } from 'react';
import {
  Columns, List, Code, Table2, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, AlertCircle, PlusCircle, Filter, X,
  LayoutGrid, FileText,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { schemaApi } from '../../api';
import { SqlEditor } from '../QueryEditor/SqlEditor';
import { EditableDataGrid } from './EditableDataGrid';
import { RecordView } from './RecordView';
import { AddColumnDialog } from './AddColumnDialog';
import { AddIndexDialog } from './AddIndexDialog';
import type { TableTab, ColumnDetail, IndexInfo, QueryResult } from '../../types';
import { useTabStore, useConnectionStore } from '../../stores';
import { cn, extractErrorMessage } from '../../lib/utils';

interface Props {
  tab: TableTab;
}

const PAGE_SIZES = [50, 100, 200, 500];
const MONGO_FILTER_SNIPPETS = [
  '{ _id: ObjectId("...") }',
  "{ trackNumber: 'QA1106CP004' }",
  "{ createdAt: { $gte: ISODate('2024-01-01T00:00:00.000Z') } }",
  "{ status: { $in: ['open', 'closed'] } }",
  "{ $or: [{ type: 'delivery' }, { type: 'pickup' }] }",
];
const MONGO_FILTER_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$nin',
  '$exists',
  '$regex',
  '$and',
  '$or',
];

type SortDir = 'asc' | 'desc';
interface SortState {
  col: string;
  dir: SortDir;
}

export function TableViewTab({ tab }: Props) {
  const updateTableTab = useTabStore((s) => s.updateTableTab);
  const connection = useConnectionStore((s) =>
    s.connections.find((c) => c.id === tab.connectionId),
  );
  const dbType = connection?.dbType ?? 'mysql';

  const [columns, setColumns] = useState<ColumnDetail[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [ddl, setDdl] = useState('');
  const [previewData, setPreviewData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [whereInput, setWhereInput] = useState('');
  const [whereClause, setWhereClause] = useState('');
  const [showMongoFilterSuggestions, setShowMongoFilterSuggestions] = useState(false);
  const [dataViewMode, setDataViewMode] = useState<'grid' | 'record'>('grid');
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);

  const { activeTab } = tab;

  // Reset state when table changes
  useEffect(() => {
    setColumns([]);
    setIndexes([]);
    setDdl('');
    setPreviewData(null);
    setError(null);
    setPage(1);
    setWhereInput('');
    setWhereClause('');
    setShowMongoFilterSuggestions(false);
  }, [tab.tableName, tab.database]);

  useEffect(() => {
    loadData(activeTab);
  }, [activeTab, tab.tableName, tab.database]);

  // Always load columns in the background (needed by AddIndexDialog even when on indexes tab)
  useEffect(() => {
    if (tab.tableName) {
      schemaApi
        .getTableColumns(tab.connectionId, tab.database, tab.tableName, tab.schema)
        .then(setColumns)
        .catch(() => {});
    }
  }, [tab.tableName, tab.database]);

  // Reload data tab when page/pageSize/whereClause changes
  useEffect(() => {
    if (activeTab === 'data') {
      loadData('data');
    }
  }, [page, pageSize, whereClause]);

  const loadPreviewData = async (
    nextPage = page,
    nextPageSize = pageSize,
    nextWhereClause = whereClause,
    isRefresh = false,
  ) => {
    if (!isRefresh) setLoading(true);
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const offset = (nextPage - 1) * nextPageSize;
      const data = await schemaApi.getTableDataPreview(
        tab.connectionId,
        tab.database,
        tab.tableName,
        tab.schema,
        nextPageSize,
        offset,
        nextWhereClause || undefined,
      );
      setPreviewData(data);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      if (!isRefresh) setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  };

  const applyWhereFilter = async () => {
    const nextClause = whereInput.trim();
    const nextPage = 1;
    setWhereClause(nextClause);
    setPage(nextPage);
    setShowMongoFilterSuggestions(false);
    if (activeTab === 'data') {
      await loadPreviewData(nextPage, pageSize, nextClause, true);
    }
  };

  const loadData = async (t: typeof activeTab, isRefresh = false) => {
    // Only show full loading spinner on initial load, not on refresh
    // (refreshing keeps existing view visible to preserve scroll/row position)
    if (!isRefresh) setLoading(true);
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      switch (t) {
        case 'columns': {
          const cols = await schemaApi.getTableColumns(
            tab.connectionId,
            tab.database,
            tab.tableName,
            tab.schema,
          );
          setColumns(cols);
          break;
        }
        case 'indexes': {
          const idxs = await schemaApi.getTableIndexes(
            tab.connectionId,
            tab.database,
            tab.tableName,
            tab.schema,
          );
          setIndexes(idxs);
          break;
        }
        case 'ddl': {
          const d = await schemaApi.getTableDdl(
            tab.connectionId,
            tab.database,
            tab.tableName,
            tab.schema,
          );
          setDdl(d);
          break;
        }
        case 'data': {
          await loadPreviewData(page, pageSize, whereClause, isRefresh);
          break;
        }
      }
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      if (!isRefresh) setLoading(false);
      if (isRefresh) setRefreshing(false);
    }
  };

  const tabs = [
    { id: 'data' as const, icon: Table2, label: 'Data' },
    { id: 'columns' as const, icon: Columns, label: 'Columns' },
    { id: 'indexes' as const, icon: List, label: 'Indexes' },
    { id: 'ddl' as const, icon: Code, label: 'DDL' },
  ];

  const hasNextPage = previewData !== null && previewData.rowCount >= pageSize;
  const isMongo = dbType === 'mongodb';
  const mongoFilterSuggestions = useMemo(() => {
    if (!isMongo) return [];

    const suggestions = [
      ...columns.map((col) => col.name),
      ...columns.map((col) => `{ ${col.name}: '' }`),
      ...columns
        .filter((col) => col.dataType === 'objectId')
        .map((col) => `{ ${col.name}: ObjectId("") }`),
      ...columns
        .filter((col) => col.dataType === 'date')
        .map((col) => `{ ${col.name}: { $gte: ISODate("") } }`),
      ...MONGO_FILTER_OPERATORS,
      ...MONGO_FILTER_SNIPPETS,
    ];

    const tokenMatch = whereInput.match(/[\w$]+$/);
    const token = tokenMatch?.[0]?.toLowerCase() ?? '';
    const filtered = token
      ? suggestions.filter((item) => item.toLowerCase().includes(token))
      : suggestions;

    return [...new Set(filtered)].slice(0, 8);
  }, [columns, isMongo, whereInput]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
        <Table2 size={14} className="text-blue-400" />
        <span className="text-sm font-medium">
          {tab.schema ? `${tab.schema}.` : ''}{tab.tableName}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{tab.database}</span>
        <div className="flex-1" />
        <button
          onClick={() => loadData(activeTab, true)}
          disabled={refreshing}
          className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)]"
          title="Refresh"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center border-b border-[var(--border)] bg-[var(--bg-secondary)] px-1">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => updateTableTab(tab.id, { activeTab: id })}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors',
              activeTab === id
                ? 'text-[var(--text-primary)] border-[var(--accent)]'
                : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]',
            )}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 m-3 p-3 text-xs text-red-400 bg-red-500/10 rounded border border-red-500/20">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        ) : (
          <>
            {activeTab === 'data' && (
              <div className="flex flex-col flex-1 overflow-hidden">
                {/* WHERE filter bar + view mode toggle */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex-shrink-0">
                  {/* Grid / Record toggle */}
                  <div className="flex items-center rounded border border-[var(--border)] overflow-hidden flex-shrink-0">
                    <button
                      onClick={() => setDataViewMode('grid')}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 text-[11px]',
                        dataViewMode === 'grid'
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]',
                      )}
                      title="Grid view"
                    >
                      <LayoutGrid size={12} />
                      Grid
                    </button>
                    <button
                      onClick={() => setDataViewMode('record')}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 text-[11px] border-l border-[var(--border)]',
                        dataViewMode === 'record'
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]',
                      )}
                      title="Record view"
                    >
                      <FileText size={12} />
                      Record
                    </button>
                  </div>
                  <div className="w-px h-4 bg-[var(--border)]" />
                  <Filter size={12} className="text-[var(--text-muted)] flex-shrink-0" />
                  <span className="text-xs text-[var(--text-muted)] flex-shrink-0">WHERE</span>
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={whereInput}
                      onChange={(e) => {
                        setWhereInput(e.target.value);
                        if (isMongo) setShowMongoFilterSuggestions(true);
                      }}
                      onFocus={() => {
                        if (isMongo) setShowMongoFilterSuggestions(true);
                      }}
                      onBlur={() => {
                        if (isMongo) {
                          setTimeout(() => setShowMongoFilterSuggestions(false), 120);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          void applyWhereFilter();
                        } else if (e.key === 'Escape' && isMongo) {
                          setShowMongoFilterSuggestions(false);
                        }
                      }}
                      placeholder={isMongo ? "{ trackNumber: 'QA1106CP004' }" : "e.g. id > 100 AND status = 'active'"}
                      autoComplete="off"
                      autoCapitalize="off"
                      className="w-full text-xs bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 outline-none focus:border-[var(--accent)] text-[var(--text-primary)] placeholder-[var(--text-muted)] font-mono"
                    />
                    {isMongo && showMongoFilterSuggestions && mongoFilterSuggestions.length > 0 && (
                      <div className="absolute z-20 top-full mt-1 left-0 right-0 max-h-56 overflow-auto rounded border border-[var(--border)] bg-[var(--bg-primary)] shadow-lg">
                        {mongoFilterSuggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setWhereInput(suggestion);
                              setShowMongoFilterSuggestions(false);
                            }}
                            className="w-full px-2 py-1.5 text-left text-xs font-mono hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {whereClause && (
                    <button
                      onClick={() => { setWhereInput(''); setWhereClause(''); setPage(1); }}
                      className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)]"
                      title="Clear filter"
                    >
                      <X size={12} />
                    </button>
                  )}
                  <button
                    onClick={applyWhereFilter}
                    className="px-2 py-1 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90"
                  >
                    Apply
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  {previewData ? (
                    dataViewMode === 'grid' ? (
                      <EditableDataGrid
                        results={previewData}
                        connectionId={tab.connectionId}
                        database={tab.database}
                        tableName={tab.tableName}
                        schema={tab.schema}
                        dbType={dbType}
                        onRefresh={() => loadData('data', true)}
                        onRowSelect={setSelectedRowIndex}
                      />
                    ) : (
                      <RecordView
                        results={previewData}
                        connectionId={tab.connectionId}
                        database={tab.database}
                        tableName={tab.tableName}
                        schema={tab.schema}
                        dbType={dbType}
                        onRefresh={() => loadData('data', true)}
                        initialRowIndex={selectedRowIndex}
                        onRowChange={setSelectedRowIndex}
                      />
                    )
                  ) : (
                    <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
                      No data
                    </div>
                  )}
                </div>
                {/* Pagination controls */}
                <div className="flex items-center gap-3 px-3 py-1.5 border-t border-[var(--border)] bg-[var(--bg-secondary)] text-xs flex-shrink-0">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="p-0.5 hover:bg-[var(--bg-hover)] rounded disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Previous page"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-[var(--text-muted)] min-w-[60px] text-center">
                      Page {page}
                    </span>
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={!hasNextPage}
                      className="p-0.5 hover:bg-[var(--bg-hover)] rounded disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Next page"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                    <span>Rows per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      className="bg-[var(--bg-primary)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    >
                      {PAGE_SIZES.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                  {previewData && (
                    <span className="text-[var(--text-muted)]">
                      {previewData.rowCount} rows loaded
                    </span>
                  )}
                </div>
              </div>
            )}
            {activeTab === 'columns' && (
              <ColumnsList
                columns={columns}
                dbType={dbType}
                connectionId={tab.connectionId}
                database={tab.database}
                tableName={tab.tableName}
                schema={tab.schema}
                onSuccess={() => loadData('columns', true)}
                selectedColumn={tab.selectedColumn}
                onSelectColumn={(colName) => updateTableTab(tab.id, { selectedColumn: colName })}
                onClearSelection={() => updateTableTab(tab.id, { selectedColumn: undefined })}
              />
            )}
            {activeTab === 'indexes' && (
              <IndexesList
                indexes={indexes}
                dbType={dbType}
                connectionId={tab.connectionId}
                database={tab.database}
                tableName={tab.tableName}
                schema={tab.schema}
                columns={columns}
                onSuccess={() => loadData('indexes')}
              />
            )}
            {activeTab === 'ddl' && (
              <SqlEditor
                value={ddl}
                onChange={() => {}}
                onExecute={() => {}}
                readOnly
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── KeyBadge ────────────────────────────────────────────────────────────────

function KeyBadge({ keyType }: { keyType: string }) {
  if (!keyType) return null;
  const styles: Record<string, string> = {
    PRI: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    UNI: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    MUL: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };
  const cls =
    styles[keyType] ??
    'bg-[var(--bg-hover)] text-[var(--text-muted)] border-[var(--border)]';
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold ${cls}`}
    >
      {keyType}
    </span>
  );
}

// ─── SortableHeader ───────────────────────────────────────────────────────────

function SortableHeader({
  label,
  colKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  colKey: string;
  sort: SortState | null;
  onSort: (col: string) => void;
  className?: string;
}) {
  const active = sort?.col === colKey;
  return (
    <th
      onClick={() => onSort(colKey)}
      className={cn(
        'px-3 py-2 text-left font-semibold text-[var(--text-muted)] bg-[var(--bg-secondary)] border-b border-[var(--border)] whitespace-nowrap cursor-pointer hover:text-[var(--text-primary)] select-none',
        className,
      )}
    >
      {label}
      {active ? (
        <span className="ml-1 text-[var(--accent)]">{sort!.dir === 'asc' ? '↑' : '↓'}</span>
      ) : (
        <span className="ml-1 opacity-20">↕</span>
      )}
    </th>
  );
}

// ─── ColumnsList ─────────────────────────────────────────────────────────────

type ColSortKey = 'name' | 'columnType' | 'nullable' | 'keyType' | 'isAutoIncrement' | 'defaultValue' | 'extra' | 'comment';

function ColumnsList({
  columns,
  dbType,
  connectionId,
  database,
  tableName,
  schema,
  onSuccess,
  selectedColumn,
  onSelectColumn,
  onClearSelection,
}: {
  columns: ColumnDetail[];
  dbType: string;
  connectionId: string;
  database: string;
  tableName: string;
  schema?: string;
  onSuccess: () => void;
  selectedColumn?: string;
  onSelectColumn: (colName: string) => void;
  onClearSelection: () => void;
}) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [showAddColumn, setShowAddColumn] = useState(false);

  const handleSort = (col: string) => {
    setSort((prev) => {
      if (prev?.col === col) {
        return prev.dir === 'asc' ? { col, dir: 'desc' } : null;
      }
      return { col, dir: 'asc' };
    });
  };

  const sorted = sort
    ? [...columns].sort((a, b) => {
        const aVal = String(a[sort.col as ColSortKey] ?? '');
        const bVal = String(b[sort.col as ColSortKey] ?? '');
        const cmp = aVal.localeCompare(bVal);
        return sort.dir === 'asc' ? cmp : -cmp;
      })
    : columns;

  const selectedCol = selectedColumn ? columns.find((c) => c.name === selectedColumn) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex-shrink-0">
        <span className="text-xs text-[var(--text-muted)]">{columns.length} columns</span>
        {selectedCol && (
          <button
            onClick={onClearSelection}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20"
          >
            <X size={10} /> {selectedCol.name}
          </button>
        )}
        <div className="flex-1" />
        {dbType !== 'mongodb' && dbType !== 'redis' && (
          <button
            onClick={() => setShowAddColumn(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <PlusCircle size={12} />
            Add Column
          </button>
        )}
      </div>

      {/* Column Properties Panel (shown when a column is selected) */}
      {selectedCol && (
        <ColumnProperties
          col={selectedCol}
          dbType={dbType}
          connectionId={connectionId}
          database={database}
          tableName={tableName}
          schema={schema}
          onSuccess={onSuccess}
        />
      )}

      {/* Column list table */}
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs border-collapse" style={{ minWidth: 900 }}>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] bg-[var(--bg-secondary)] border-b border-[var(--border)] w-8">
                #
              </th>
              <SortableHeader label="Name" colKey="name" sort={sort} onSort={handleSort} />
              <SortableHeader label="Type" colKey="columnType" sort={sort} onSort={handleSort} />
              <SortableHeader label="Not Null" colKey="nullable" sort={sort} onSort={handleSort} />
              <SortableHeader label="Key" colKey="keyType" sort={sort} onSort={handleSort} />
              <SortableHeader label="Auto Inc" colKey="isAutoIncrement" sort={sort} onSort={handleSort} />
              <SortableHeader label="Default" colKey="defaultValue" sort={sort} onSort={handleSort} />
              <SortableHeader label="Extra" colKey="extra" sort={sort} onSort={handleSort} />
              <SortableHeader label="Comment" colKey="comment" sort={sort} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-[var(--text-muted)]">
                  No columns found
                </td>
              </tr>
            ) : (
              sorted.map((col, i) => (
                <tr
                  key={col.name}
                  className={cn(
                    'hover:bg-[var(--bg-hover)] border-b border-[var(--border)] cursor-pointer',
                    selectedColumn === col.name && 'bg-[var(--accent)]/10',
                  )}
                  onClick={() => onSelectColumn(col.name)}
                >
                  <td className="px-3 py-1.5 text-[var(--text-muted)] w-8 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-1.5 font-medium whitespace-nowrap">
                    {col.isPrimaryKey ? (
                      <span className="text-yellow-400">🔑 {col.name}</span>
                    ) : (
                      <span className="text-[var(--text-primary)]">{col.name}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-blue-400 whitespace-nowrap">
                    {col.columnType}
                  </td>
                  <td className="px-3 py-1.5">
                    {col.nullable ? (
                      <span className="text-[var(--text-muted)]">—</span>
                    ) : (
                      <span className="text-orange-400 font-semibold">✓</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <KeyBadge keyType={col.keyType ?? ''} />
                  </td>
                  <td className="px-3 py-1.5">
                    {col.isAutoIncrement ? (
                      <span className="text-green-400 font-semibold">✓</span>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[var(--text-muted)] max-w-[120px] truncate">
                    {col.defaultValue !== undefined && col.defaultValue !== null ? (
                      <span className="text-[var(--text-primary)]">{col.defaultValue}</span>
                    ) : (
                      <span>NULL</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-[var(--text-muted)] whitespace-nowrap">
                    {col.extra || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-[var(--text-muted)] max-w-[200px] truncate">
                    {col.comment || ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddColumn && (
        <AddColumnDialog
          connectionId={connectionId}
          database={database}
          tableName={tableName}
          schema={schema}
          dbType={dbType}
          columns={columns}
          onClose={() => setShowAddColumn(false)}
          onSuccess={onSuccess}
        />
      )}
    </div>
  );
}

// ─── ColumnProperties ───────────────────────────────────────────────────────

function ColumnProperties({
  col,
  dbType,
  connectionId,
  database,
  tableName,
  schema,
  onSuccess,
}: {
  col: ColumnDetail;
  dbType: string;
  connectionId: string;
  database: string;
  tableName: string;
  schema?: string;
  onSuccess: () => void;
}) {
  const [comment, setComment] = useState(col.comment ?? '');
  const [defaultVal, setDefaultVal] = useState(col.defaultValue ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when column changes
  const [prevName, setPrevName] = useState(col.name);
  if (col.name !== prevName) {
    setPrevName(col.name);
    setComment(col.comment ?? '');
    setDefaultVal(col.defaultValue ?? '');
    setError(null);
  }

  const quoteId = (name: string) => dbType === 'mysql' ? `\`${name}\`` : `"${name}"`;
  const tblRef = dbType === 'mysql'
    ? `\`${database}\`.\`${tableName}\``
    : dbType === 'sqlite'
      ? `"${tableName}"`
      : `"${schema ?? 'public'}"."${tableName}"`;

  const hasChanges = comment !== (col.comment ?? '') || defaultVal !== (col.defaultValue ?? '');

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Build ALTER statements based on what changed
      if (dbType === 'mysql') {
        // MySQL MODIFY COLUMN to change default + comment
        let typeDef = col.columnType;
        const parts = [typeDef];
        if (!col.nullable) parts.push('NOT NULL');
        else parts.push('NULL');
        if (col.isAutoIncrement) parts.push('AUTO_INCREMENT');
        if (defaultVal.trim()) parts.push(`DEFAULT ${defaultVal.trim()}`);
        if (comment.trim()) parts.push(`COMMENT '${comment.replace(/'/g, "''")}'`);
        const sql = `ALTER TABLE ${tblRef} MODIFY COLUMN ${quoteId(col.name)} ${parts.join(' ')}`;
        await invoke('execute_query', { connectionId, sql, database });
      } else if (dbType === 'postgres') {
        if (defaultVal !== (col.defaultValue ?? '')) {
          const sql = defaultVal.trim()
            ? `ALTER TABLE ${tblRef} ALTER COLUMN ${quoteId(col.name)} SET DEFAULT ${defaultVal.trim()}`
            : `ALTER TABLE ${tblRef} ALTER COLUMN ${quoteId(col.name)} DROP DEFAULT`;
          await invoke('execute_query', { connectionId, sql, database });
        }
        if (comment !== (col.comment ?? '')) {
          const sql = `COMMENT ON COLUMN ${tblRef}.${quoteId(col.name)} IS '${comment.replace(/'/g, "''")}'`;
          await invoke('execute_query', { connectionId, sql, database });
        }
      }
      onSuccess();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = 'bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 text-xs outline-none focus:border-[var(--accent)] text-[var(--text-primary)]';
  const labelClass = 'text-[10px] text-[var(--text-muted)] font-semibold whitespace-nowrap';
  const readonlyClass = 'bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text-primary)] cursor-default';

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-primary)] flex-shrink-0">
      {/* Properties header */}
      <div className="px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)] flex items-center gap-2">
        <Columns size={12} className="text-[var(--accent)]" />
        <span className="text-xs font-semibold text-[var(--text-primary)]">Properties</span>
        <span className="text-[10px] text-[var(--text-muted)]">— {col.name}</span>
        <div className="flex-1" />
        {hasChanges && dbType !== 'sqlite' && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        )}
      </div>

      {/* Properties grid */}
      <div className="grid grid-cols-[auto_1fr_auto_1fr_auto_1fr] gap-x-3 gap-y-2 px-4 py-3 text-xs items-center">
        {/* Row 1 */}
        <span className={labelClass}>Column Name:</span>
        <span className={readonlyClass}>{col.name}</span>
        <span className={labelClass}>Extra:</span>
        <span className={readonlyClass}>{col.extra || '—'}</span>
        <span className={labelClass}>Comment:</span>
        {dbType === 'sqlite' ? (
          <span className={readonlyClass}>{col.comment || '—'}</span>
        ) : (
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className={fieldClass}
            autoComplete="off"
            autoCapitalize="off"
          />
        )}

        {/* Row 2 */}
        <span className={labelClass}>Data Type:</span>
        <span className={readonlyClass}>{col.columnType}</span>
        <span className={labelClass}>#:</span>
        <span className={readonlyClass}>{col.ordinalPosition}</span>
        <span className={labelClass}>Key:</span>
        <span className={readonlyClass}>{col.keyType || '—'}</span>

        {/* Row 3 */}
        <span className={labelClass}>Not Null:</span>
        <div className="flex items-center gap-3">
          <span className={col.nullable ? 'text-[var(--text-muted)]' : 'text-orange-400 font-semibold'}>{col.nullable ? 'No' : 'Yes'}</span>
          {col.isAutoIncrement && <span className="text-green-400 font-semibold text-[10px]">AUTO_INCREMENT</span>}
        </div>
        <span className={labelClass}>Default:</span>
        {dbType === 'sqlite' ? (
          <span className={readonlyClass}>{col.defaultValue ?? '—'}</span>
        ) : (
          <input
            value={defaultVal}
            onChange={(e) => setDefaultVal(e.target.value)}
            className={fieldClass}
            placeholder="NULL"
            autoComplete="off"
            autoCapitalize="off"
          />
        )}
        <span className={labelClass} />
        <span />
      </div>

      {error && (
        <div className="px-4 pb-2 text-[10px] text-red-400">{error}</div>
      )}
    </div>
  );
}

// ─── IndexesList ─────────────────────────────────────────────────────────────

type IdxSortKey = 'name' | 'indexType' | 'isUnique' | 'isPrimary';

function IndexesList({
  indexes,
  dbType,
  connectionId,
  database,
  tableName,
  schema,
  columns,
  onSuccess,
}: {
  indexes: IndexInfo[];
  dbType: string;
  connectionId: string;
  database: string;
  tableName: string;
  schema?: string;
  columns: ColumnDetail[];
  onSuccess: () => void;
}) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [showAddIndex, setShowAddIndex] = useState(false);

  const handleSort = (col: string) => {
    setSort((prev) => {
      if (prev?.col === col) {
        return prev.dir === 'asc' ? { col, dir: 'desc' } : null;
      }
      return { col, dir: 'asc' };
    });
  };

  const sorted = sort
    ? [...indexes].sort((a, b) => {
        const aVal = String(a[sort.col as IdxSortKey] ?? '');
        const bVal = String(b[sort.col as IdxSortKey] ?? '');
        const cmp = aVal.localeCompare(bVal);
        return sort.dir === 'asc' ? cmp : -cmp;
      })
    : indexes;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex-shrink-0">
        <span className="text-xs text-[var(--text-muted)]">{indexes.length} indexes</span>
        <div className="flex-1" />
        {dbType !== 'mongodb' && dbType !== 'redis' && (
          <button
            onClick={() => setShowAddIndex(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <PlusCircle size={12} />
            Add Index
          </button>
        )}
      </div>

      <div className="overflow-auto flex-1">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0">
            <tr>
              <SortableHeader label="Name" colKey="name" sort={sort} onSort={handleSort} />
              <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                Columns
              </th>
              <SortableHeader label="Type" colKey="indexType" sort={sort} onSort={handleSort} />
              <SortableHeader label="Unique" colKey="isUnique" sort={sort} onSort={handleSort} />
              <SortableHeader label="Primary" colKey="isPrimary" sort={sort} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-[var(--text-muted)]">
                  No indexes found
                </td>
              </tr>
            ) : (
              sorted.map((idx) => (
                <tr
                  key={idx.name}
                  className="hover:bg-[var(--bg-hover)] border-b border-[var(--border)]"
                >
                  <td className="px-3 py-1.5 font-medium">{idx.name}</td>
                  <td className="px-3 py-1.5 font-mono">{idx.columns.join(', ')}</td>
                  <td className="px-3 py-1.5 text-[var(--text-muted)]">{idx.indexType}</td>
                  <td className="px-3 py-1.5">
                    {idx.isUnique && <span className="text-green-400">YES</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    {idx.isPrimary && <span className="text-[var(--accent)]">YES</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddIndex && (
        <AddIndexDialog
          connectionId={connectionId}
          database={database}
          tableName={tableName}
          schema={schema}
          dbType={dbType}
          columns={columns}
          onClose={() => setShowAddIndex(false)}
          onSuccess={onSuccess}
        />
      )}
    </div>
  );
}
