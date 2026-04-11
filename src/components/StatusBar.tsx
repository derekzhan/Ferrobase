import { useTabStore, useConnectionStore } from '../stores';

export function StatusBar() {
  const { tabs, activeTabId } = useTabStore();
  const connections = useConnectionStore((s) => s.connections);
  const statuses = useConnectionStore((s) => s.statuses);

  const activeTab = tabs.find((t) => t.data.id === activeTabId);
  const connectedCount = Object.values(statuses).filter(
    (s) => s === 'Connected'
  ).length;

  const queryTab = activeTab?.kind === 'query' ? activeTab.data : null;
  const lastResult = queryTab?.results?.[queryTab.results.length - 1];

  return (
    <div className="flex items-center gap-4 px-4 py-1 bg-[var(--bg-secondary)] border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
      <span>
        {connectedCount} connection{connectedCount !== 1 ? 's' : ''} active
      </span>

      {lastResult && (
        <>
          <span className="text-[var(--border)]">|</span>
          <span>{lastResult.rowCount.toLocaleString()} rows</span>
          <span className="text-[var(--border)]">|</span>
          <span>{lastResult.executionTimeMs}ms</span>
          {lastResult.affectedRows > 0 && (
            <>
              <span className="text-[var(--border)]">|</span>
              <span>{lastResult.affectedRows} affected</span>
            </>
          )}
        </>
      )}

      <span className="ml-auto">Ferrobase v0.1.0</span>
    </div>
  );
}
