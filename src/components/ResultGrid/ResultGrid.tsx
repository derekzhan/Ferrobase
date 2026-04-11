import { useState, useRef, useCallback, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import type { QueryResult } from '../../types';
import { cn } from '../../lib/utils';
import { CellDetail } from './CellDetail';
import { ArrowUp, ArrowDown } from 'lucide-react';

interface Props {
  results: QueryResult[];
}

export function ResultGrid({ results }: Props) {
  const [activeResultIdx] = useState(0);
  const result = results[activeResultIdx];

  if (!result || result.columns.length === 0) {
    if (result?.affectedRows > 0) {
      return (
        <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
          {result.affectedRows} row{result.affectedRows !== 1 ? 's' : ''} affected
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
        No results
      </div>
    );
  }

  return <DataTable result={result} />;
}

function DataTable({ result }: { result: QueryResult }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selectedCell, setSelectedCell] = useState<{ value: unknown; col: string } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const columns: ColumnDef<Array<unknown>>[] = result.columns.map((col, i) => ({
    id: col.name,
    accessorFn: (row) => row[i],
    header: col.name,
    size: Math.max(80, Math.min(240, col.name.length * 10 + 40)),
    meta: { dataType: col.dataType, isPrimaryKey: col.isPrimaryKey },
  }));

  const table = useReactTable({
    data: result.rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 20,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div className="flex flex-col h-full">
      {/* Multiple results selector */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto result-grid selectable"
      >
        <table className="w-full border-collapse text-xs" style={{ minWidth: 'max-content' }}>
          {/* Header */}
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {/* Row number column */}
                <th className="w-10 min-w-[40px] border-r border-b border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 text-right text-[var(--text-muted)] font-normal select-none">
                  #
                </th>
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as { isPrimaryKey?: boolean } | undefined;
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'border-r border-b border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-left font-semibold text-[var(--text-primary)] cursor-pointer hover:bg-[var(--bg-hover)] select-none',
                        meta?.isPrimaryKey && 'text-[var(--accent)]'
                      )}
                      style={{ width: header.getSize() }}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1 truncate">
                        <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                        {header.column.getIsSorted() === 'asc' && <ArrowUp size={10} />}
                        {header.column.getIsSorted() === 'desc' && <ArrowDown size={10} />}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          {/* Body with virtualization */}
          <tbody>
            {/* Top spacer */}
            {virtualRows.length > 0 && virtualRows[0].start > 0 && (
              <tr>
                <td style={{ height: virtualRows[0].start }} colSpan={columns.length + 1} />
              </tr>
            )}

            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              return (
                <tr
                  key={row.id}
                  className="hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <td className="border-r border-b border-[var(--border)] px-2 py-1.5 text-right text-[var(--text-muted)] select-none bg-[var(--bg-secondary)]">
                    {virtualRow.index + 1}
                  </td>
                  {row.getVisibleCells().map((cell) => {
                    const val = cell.getValue();
                    const isNull = val === null || val === undefined;
                    return (
                      <td
                        key={cell.id}
                        className="border-r border-b border-[var(--border)] px-3 py-1.5 max-w-[300px]"
                        onClick={() => {
                          if (!isNull && (typeof val === 'object' || (typeof val === 'string' && val.length > 100))) {
                            setSelectedCell({ value: val, col: cell.column.id });
                          }
                        }}
                        style={{ cursor: !isNull && (typeof val === 'object' || (typeof val === 'string' && (val as string).length > 100)) ? 'pointer' : 'default' }}
                      >
                        <CellValue value={val} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Bottom spacer */}
            {virtualRows.length > 0 && (
              <tr>
                <td
                  style={{
                    height: totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0),
                  }}
                  colSpan={columns.length + 1}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedCell && (
        <CellDetail
          value={selectedCell.value}
          columnName={selectedCell.col}
          onClose={() => setSelectedCell(null)}
        />
      )}
    </div>
  );
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="null-value">NULL</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-green-400' : 'text-red-400'}>
        {value ? 'true' : 'false'}
      </span>
    );
  }

  if (typeof value === 'number') {
    return <span className="text-blue-400 font-mono">{value}</span>;
  }

  if (typeof value === 'object') {
    return (
      <span className="json-value truncate block max-w-[280px]">
        {JSON.stringify(value)}
      </span>
    );
  }

  const str = String(value);
  return (
    <span className="truncate block max-w-[280px] text-[var(--text-primary)]">
      {str}
    </span>
  );
}
