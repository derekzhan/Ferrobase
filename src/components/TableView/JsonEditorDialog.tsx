import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Code, AlignLeft, Copy, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  value: unknown;
  columnName: string;
  readOnly?: boolean;
  onSave: (val: unknown) => void;
  onClose: () => void;
}

type ViewMode = 'text' | 'json';

export function JsonEditorDialog({ value, columnName, readOnly, onSave, onClose }: Props) {
  const initialText = value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value, null, 2)
      : String(value);

  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<ViewMode>('json');
  const [parseError, setParseError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Dragging
  const dialogRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 600, h: 450 });
  const [centered, setCentered] = useState(true);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);

  // Center on mount
  useEffect(() => {
    if (centered) {
      setPos({
        x: Math.max(0, (window.innerWidth - size.w) / 2),
        y: Math.max(0, (window.innerHeight - size.h) / 2),
      });
    }
  }, [centered]);

  // Drag handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, textarea, select')) return;
    e.preventDefault();
    setCentered(false);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.origX + ev.clientX - dragRef.current.startX,
        y: dragRef.current.origY + ev.clientY - dragRef.current.startY,
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [pos]);

  // Resize handlers
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCentered(false);
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h };

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      setSize({
        w: Math.max(350, resizeRef.current.origW + ev.clientX - resizeRef.current.startX),
        h: Math.max(250, resizeRef.current.origH + ev.clientY - resizeRef.current.startY),
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size]);

  // Format / validate
  const formatJson = () => {
    try {
      const parsed = JSON.parse(text);
      setText(JSON.stringify(parsed, null, 2));
      setParseError(null);
    } catch (e) {
      setParseError(String(e));
    }
  };

  const compactJson = () => {
    try {
      const parsed = JSON.parse(text);
      setText(JSON.stringify(parsed));
      setParseError(null);
    } catch (e) {
      setParseError(String(e));
    }
  };

  const handleModeChange = (m: ViewMode) => {
    setMode(m);
    if (m === 'json') {
      try {
        const parsed = JSON.parse(text);
        setText(JSON.stringify(parsed, null, 2));
        setParseError(null);
      } catch {
        // keep as-is
      }
    }
  };

  const handleSave = () => {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.toUpperCase() === 'NULL') {
      onSave(null);
      onClose();
      return;
    }
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(trimmed);
      onSave(parsed);
      onClose();
    } catch {
      // Save as string
      onSave(trimmed);
      onClose();
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && !readOnly) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [text, readOnly]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div
        ref={dialogRef}
        className="absolute bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{
          left: pos.x,
          top: pos.y,
          width: size.w,
          height: size.h,
        }}
      >
        {/* Title bar (draggable) */}
        <div
          className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)] cursor-move select-none flex-shrink-0"
          onMouseDown={onDragStart}
        >
          <Code size={14} className="text-[var(--accent)]" />
          <span className="text-xs font-semibold text-[var(--text-primary)] flex-1 truncate">
            {readOnly ? 'View' : 'Edit'}: {columnName}
          </span>

          {/* Mode toggle */}
          <div className="flex items-center gap-0.5 bg-[var(--bg-primary)] rounded border border-[var(--border)] p-0.5">
            <button
              onClick={() => handleModeChange('text')}
              className={cn(
                'px-2 py-0.5 text-[10px] rounded transition-colors',
                mode === 'text'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              )}
            >
              <AlignLeft size={10} className="inline mr-1" />
              Text
            </button>
            <button
              onClick={() => handleModeChange('json')}
              className={cn(
                'px-2 py-0.5 text-[10px] rounded transition-colors',
                mode === 'json'
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
              )}
            >
              <Code size={10} className="inline mr-1" />
              JSON
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex-shrink-0">
          {mode === 'json' && (
            <>
              <button
                onClick={formatJson}
                className="px-2 py-0.5 text-[10px] rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
              >
                Format
              </button>
              <button
                onClick={compactJson}
                className="px-2 py-0.5 text-[10px] rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)]"
              >
                Compact
              </button>
            </>
          )}
          <button
            onClick={handleCopy}
            className="px-2 py-0.5 text-[10px] rounded border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] flex items-center gap-1"
          >
            {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <div className="flex-1" />
          {parseError && (
            <span className="text-[10px] text-red-400 truncate max-w-[250px]">{parseError}</span>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden p-2">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setParseError(null); }}
            readOnly={readOnly}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            className={cn(
              'w-full h-full font-mono text-xs p-2 rounded border outline-none resize-none',
              'bg-[var(--bg-primary)] text-[var(--text-primary)] border-[var(--border)]',
              'focus:border-[var(--accent)]',
              readOnly && 'opacity-70 cursor-default',
            )}
            style={{ tabSize: 2 }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-secondary)] flex-shrink-0">
          <span className="text-[10px] text-[var(--text-muted)] flex-1">
            {text.length} chars
            {!readOnly && ' • ⌘S to save'}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          {!readOnly && (
            <button
              onClick={handleSave}
              className="px-3 py-1 text-xs rounded bg-[var(--accent)] text-white hover:opacity-90"
            >
              Save
            </button>
          )}
        </div>

        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          onMouseDown={onResizeStart}
          style={{
            background: 'linear-gradient(135deg, transparent 50%, var(--text-muted) 50%)',
            opacity: 0.3,
          }}
        />
      </div>
    </div>
  );
}
