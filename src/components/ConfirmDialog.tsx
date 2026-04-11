import { useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, Trash2, Info, X } from 'lucide-react';
import { cn } from '../lib/utils';

export type ConfirmVariant = 'danger' | 'warning' | 'info';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Optional detail shown below the message in a code/monospace block */
  detail?: string;
  variant?: ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  detail,
  variant = 'danger',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus cancel button by default (safer for destructive actions)
  useEffect(() => {
    if (open) {
      setTimeout(() => cancelRef.current?.focus(), 50);
    }
  }, [open]);

  // ESC to cancel
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [onCancel]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  const iconMap = {
    danger: <Trash2 size={20} className="text-red-400" />,
    warning: <AlertTriangle size={20} className="text-yellow-400" />,
    info: <Info size={20} className="text-blue-400" />,
  };

  const confirmBtnClass = {
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    warning: 'bg-yellow-600 hover:bg-yellow-700 text-white',
    info: 'bg-blue-600 hover:bg-blue-700 text-white',
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-2xl w-[420px] max-w-[90vw] overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-2">
          <div className={cn(
            'flex items-center justify-center w-9 h-9 rounded-full',
            variant === 'danger' && 'bg-red-500/15',
            variant === 'warning' && 'bg-yellow-500/15',
            variant === 'info' && 'bg-blue-500/15',
          )}>
            {iconMap[variant]}
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex-1">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-3">
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{message}</p>
          {detail && (
            <div className="mt-2.5 p-2.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded text-[10px] font-mono text-[var(--text-muted)] max-h-[120px] overflow-auto whitespace-pre-wrap break-all">
              {detail}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 bg-[var(--bg-primary)] border-t border-[var(--border)]">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-3.5 py-1.5 text-xs rounded border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={cn('px-3.5 py-1.5 text-xs rounded font-medium transition-colors', confirmBtnClass[variant])}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Helper hook for imperative usage ============

import { useState } from 'react';

interface ConfirmOptions {
  title: string;
  message: string;
  detail?: string;
  variant?: ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/**
 * Hook that provides an imperative `confirm()` function returning a Promise<boolean>,
 * plus a <ConfirmDialog /> element to render.
 *
 * Usage:
 *   const { confirm, ConfirmDialogElement } = useConfirmDialog();
 *   const ok = await confirm({ title: '...', message: '...' });
 *   return <>{ConfirmDialogElement}</>
 */
export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ ...opts, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  const ConfirmDialogElement = (
    <ConfirmDialog
      open={state !== null}
      title={state?.title ?? ''}
      message={state?.message ?? ''}
      detail={state?.detail}
      variant={state?.variant}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { confirm, ConfirmDialogElement };
}
