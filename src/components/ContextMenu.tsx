import { useEffect, useRef, useCallback } from 'react';
import { cn } from '../lib/utils';

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: false;
}

export interface MenuSeparator {
  separator: true;
}

export type MenuItemOrSeparator = MenuItem | MenuSeparator;

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItemOrSeparator[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to stay within viewport
  const getAdjustedPosition = useCallback(() => {
    if (!menuRef.current) return { left: x, top: y };
    const rect = menuRef.current.getBoundingClientRect();
    let left = x;
    let top = y;
    if (x + rect.width > window.innerWidth) left = x - rect.width;
    if (y + rect.height > window.innerHeight) top = y - rect.height;
    if (left < 0) left = 4;
    if (top < 0) top = 4;
    return { left, top };
  }, [x, y]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  // Adjust position after render
  useEffect(() => {
    if (menuRef.current) {
      const { left, top } = getAdjustedPosition();
      menuRef.current.style.left = `${left}px`;
      menuRef.current.style.top = `${top}px`;
    }
  }, [getAdjustedPosition]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl py-1 animate-in fade-in"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={`sep-${i}`} className="my-1 border-t border-[var(--border)]" />;
        }
        const menuItem = item as MenuItem;
        return (
          <button
            key={i}
            disabled={menuItem.disabled}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
              menuItem.disabled
                ? 'text-[var(--text-muted)] cursor-not-allowed opacity-50'
                : menuItem.danger
                  ? 'text-red-400 hover:bg-red-500/10'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            )}
            onClick={() => {
              if (!menuItem.disabled) {
                menuItem.onClick();
                onClose();
              }
            }}
          >
            {menuItem.icon && (
              <span className="w-4 flex items-center justify-center flex-shrink-0">
                {menuItem.icon}
              </span>
            )}
            <span className="flex-1">{menuItem.label}</span>
            {menuItem.shortcut && (
              <span className="text-[10px] text-[var(--text-muted)] ml-4">
                {menuItem.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
