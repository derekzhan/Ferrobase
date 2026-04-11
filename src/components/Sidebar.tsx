import { useState } from 'react';
import { Plus, Search, Settings } from 'lucide-react';
import { useConnectionStore } from '../stores';
import { DatabaseTree } from './DatabaseTree';
import { ConnectionDialog } from './ConnectionPanel/ConnectionDialog';
import { SettingsPanel } from './Settings/SettingsPanel';
import { useConfirmDialog } from './ConfirmDialog';
import { cn } from '../lib/utils';

export function Sidebar() {
  const connections = useConnectionStore((s) => s.connections);
  const statuses = useConnectionStore((s) => s.statuses);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [editConnectionId, setEditConnectionId] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const { confirm, ConfirmDialogElement } = useConfirmDialog();

  // When searching, show all connected connections (tables inside may match)
  // plus any disconnected connections whose name matches
  const filtered = searchQuery
    ? connections.filter((c) => {
        const q = searchQuery.toLowerCase();
        if (c.name.toLowerCase().includes(q)) return true;
        // Always show connected connections — table filtering happens inside DatabaseTree
        if (statuses[c.id] === 'Connected') return true;
        return false;
      })
    : connections;

  const handleEditConnection = (id: string) => {
    setEditConnectionId(id);
    setShowConnectionDialog(true);
  };

  const handleDeleteConnection = async (id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (!conn) return;
    const ok = await confirm({
      title: 'Delete Connection',
      message: `Are you sure you want to delete connection "${conn.name}"? This will remove the saved connection configuration.`,
      variant: 'warning',
      confirmLabel: 'Delete',
    });
    if (ok) {
      await deleteConnection(id);
    }
  };

  const handleCloseDialog = () => {
    setShowConnectionDialog(false);
    setEditConnectionId(undefined);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] border-r border-[var(--border)]">
      {ConfirmDialogElement}
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider flex-1">
          Connections
        </span>
        <button
          onClick={() => setShowSettings(true)}
          className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title="Preferences"
        >
          <Settings size={14} />
        </button>
        <button
          onClick={() => {
            setEditConnectionId(undefined);
            setShowConnectionDialog(true);
          }}
          className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title="New connection (⌘N)"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-1.5 bg-[var(--bg-primary)] rounded px-2 py-1 border border-[var(--border)]">
          <Search size={12} className="text-[var(--text-muted)] flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search connections..."
            autoComplete="off"
            autoCapitalize="off"
            className="text-xs bg-transparent outline-none w-full text-[var(--text-primary)] placeholder-[var(--text-muted)]"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && !searchQuery && (
          <div className="flex flex-col items-center justify-center h-40 text-[var(--text-muted)] px-4">
            <p className="text-xs text-center mb-2">No connections yet</p>
            <button
              onClick={() => setShowConnectionDialog(true)}
              className="text-xs text-[var(--accent)] hover:underline"
            >
              + Add connection
            </button>
          </div>
        )}
        {filtered.map((conn) => (
          <DatabaseTree
            key={conn.id}
            connection={conn}
            status={statuses[conn.id] ?? 'Disconnected'}
            onEditConnection={handleEditConnection}
            onDeleteConnection={handleDeleteConnection}
            searchQuery={searchQuery}
          />
        ))}
      </div>

      {/* Connection Dialog */}
      {showConnectionDialog && (
        <ConnectionDialog
          onClose={handleCloseDialog}
          editId={editConnectionId}
        />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
