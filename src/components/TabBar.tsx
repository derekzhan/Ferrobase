import { useState, useCallback, useEffect, useRef } from 'react';
import { Plus, X, Code2, Table2, Key } from 'lucide-react';
import { useTabStore, useConnectionStore } from '../stores';
import { cn } from '../lib/utils';

interface TabContextMenu {
  x: number;
  y: number;
  tabId: string;
}

export function TabBar() {
  const {
    tabs, activeTabId,
    closeTab, closeOtherTabs, closeTabsToLeft, closeTabsToRight, closeAllTabs,
    setActiveTab, openQueryTab,
  } = useTabStore();
  const connections = useConnectionStore((s) => s.connections);
  const statuses = useConnectionStore((s) => s.statuses);
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const defaultConnectionId = connections.find(
    (c) => statuses[c.id] === 'Connected'
  )?.id;

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }, []);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  // Close on ESC
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [contextMenu]);

  const tabIdx = contextMenu ? tabs.findIndex((t) => t.data.id === contextMenu.tabId) : -1;
  const hasLeft = tabIdx > 0;
  const hasRight = tabIdx >= 0 && tabIdx < tabs.length - 1;
  const hasOthers = tabs.length > 1;

  const menuAction = (fn: () => void) => {
    fn();
    setContextMenu(null);
  };

  return (
    <div className="flex items-center bg-[var(--bg-secondary)] border-b border-[var(--border)] overflow-x-auto">
      {tabs.map((tab) => (
        <div
          key={tab.data.id}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 border-r border-[var(--border)] cursor-pointer text-xs select-none flex-shrink-0 max-w-[200px] group',
            activeTabId === tab.data.id
              ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] border-t-2 border-t-[var(--accent)]'
              : 'hover:bg-[var(--bg-hover)] text-[var(--text-muted)]'
          )}
          onClick={() => setActiveTab(tab.data.id)}
          onContextMenu={(e) => handleContextMenu(e, tab.data.id)}
        >
          {tab.kind === 'query' && <Code2 size={11} className="text-[var(--text-muted)] flex-shrink-0" />}
          {tab.kind === 'table' && <Table2 size={11} className="text-blue-400 flex-shrink-0" />}
          {tab.kind === 'redis' && <Key size={11} className="text-red-400 flex-shrink-0" />}
          <span className="truncate flex-1">
            {tab.kind === 'query' && tab.data.isDirty ? '● ' : ''}
            {tab.data.title}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.data.id);
            }}
            className="opacity-0 group-hover:opacity-100 hover:text-[var(--error)] flex-shrink-0 transition-opacity"
          >
            <X size={11} />
          </button>
        </div>
      ))}

      {/* New tab button */}
      <button
        onClick={() => openQueryTab({ connectionId: defaultConnectionId })}
        className="flex-shrink-0 p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        title="New query tab (⌘T)"
      >
        <Plus size={14} />
      </button>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-2xl py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            onClick={() => menuAction(() => closeTab(contextMenu.tabId))}
          >
            Close
          </button>
          <button
            className={cn(
              'w-full text-left px-3 py-1.5 text-xs transition-colors',
              hasOthers ? 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]' : 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
            )}
            disabled={!hasOthers}
            onClick={() => hasOthers && menuAction(() => closeOtherTabs(contextMenu.tabId))}
          >
            Close Others
          </button>
          <button
            className={cn(
              'w-full text-left px-3 py-1.5 text-xs transition-colors',
              hasLeft ? 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]' : 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
            )}
            disabled={!hasLeft}
            onClick={() => hasLeft && menuAction(() => closeTabsToLeft(contextMenu.tabId))}
          >
            Close Tabs to the Left
          </button>
          <button
            className={cn(
              'w-full text-left px-3 py-1.5 text-xs transition-colors',
              hasRight ? 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]' : 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
            )}
            disabled={!hasRight}
            onClick={() => hasRight && menuAction(() => closeTabsToRight(contextMenu.tabId))}
          >
            Close Tabs to the Right
          </button>
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            onClick={() => menuAction(closeAllTabs)}
          >
            Close All
          </button>
        </div>
      )}
    </div>
  );
}
