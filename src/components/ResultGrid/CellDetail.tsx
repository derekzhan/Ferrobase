import { X, Copy } from 'lucide-react';

interface Props {
  value: unknown;
  columnName: string;
  onClose: () => void;
}

export function CellDetail({ value, columnName, onClose }: Props) {
  const displayValue =
    typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);

  const copy = () => {
    navigator.clipboard.writeText(displayValue);
  };

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)] max-h-48">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)]">
        <span className="text-xs font-medium text-[var(--text-muted)]">{columnName}</span>
        <div className="flex-1" />
        <button
          onClick={copy}
          className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <Copy size={12} />
        </button>
        <button
          onClick={onClose}
          className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)]"
        >
          <X size={12} />
        </button>
      </div>
      <div className="p-3 overflow-auto max-h-36">
        <pre className="text-xs font-mono text-[var(--text-primary)] whitespace-pre-wrap break-all selectable">
          {displayValue}
        </pre>
      </div>
    </div>
  );
}
