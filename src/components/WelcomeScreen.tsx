import { useState } from 'react';
import { Plus, Zap } from 'lucide-react';
import { useTabStore, useConnectionStore } from '../stores';
import { ConnectionDialog } from './ConnectionPanel/ConnectionDialog';
import { FerrobaseIcon } from './icons/DbIcons';

export function WelcomeScreen() {
  const openQueryTab = useTabStore((s) => s.openQueryTab);
  const connections = useConnectionStore((s) => s.connections);
  const [showDialog, setShowDialog] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center h-full bg-[var(--bg-primary)] select-none">
      <div className="flex flex-col items-center gap-6 max-w-sm text-center">
        <div className="flex items-center gap-3">
          <FerrobaseIcon size={64} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">Ferrobase</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Lightweight cross-platform database client
          </p>
        </div>

        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={() => setShowDialog(true)}
            className="flex items-center gap-2 justify-center px-4 py-2.5 bg-[var(--accent)] text-white text-sm rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Plus size={15} />
            New Connection
          </button>
          {connections.length > 0 && (
            <button
              onClick={() => openQueryTab()}
              className="flex items-center gap-2 justify-center px-4 py-2.5 border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Zap size={15} />
              New Query
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 w-full text-center">
          {[
            { label: '< 1s', sub: 'Startup' },
            { label: '< 80MB', sub: 'Memory' },
            { label: '< 15MB', sub: 'Install' },
          ].map(({ label, sub }) => (
            <div
              key={sub}
              className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-3"
            >
              <p className="text-base font-bold text-[var(--accent)]">{label}</p>
              <p className="text-xs text-[var(--text-muted)]">{sub}</p>
            </div>
          ))}
        </div>
      </div>

      {showDialog && <ConnectionDialog onClose={() => setShowDialog(false)} />}
    </div>
  );
}
