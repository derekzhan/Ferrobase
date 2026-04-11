import { useState, useEffect } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { useThemeStore } from '../stores';
import { cn } from '../lib/utils';
import { FerrobaseIcon } from './icons/DbIcons';
import { AboutDialog } from './AboutDialog';

export function TitleBar() {
  const { theme, setTheme } = useThemeStore();
  const [showAbout, setShowAbout] = useState(false);

  // Listen for native menu "About Ferrobase" click
  useEffect(() => {
    const unlisten = listen('show-about', () => {
      setShowAbout(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const themes = [
    { id: 'light' as const, icon: Sun },
    { id: 'dark' as const, icon: Moon },
    { id: 'system' as const, icon: Monitor },
  ];

  return (
    <>
      <div
        className="titlebar-drag flex items-center h-11 px-4 bg-[var(--bg-secondary)] border-b border-[var(--border)] select-none"
        style={{ paddingLeft: '10px' }}
      >
        {/* App logo & name */}
        <div className="titlebar-no-drag flex items-center gap-1.5 mr-auto">
          <FerrobaseIcon size={18} />
          <span className="text-sm font-semibold tracking-tight">Ferrobase</span>
        </div>

        {/* Theme switcher */}
        <div className="titlebar-no-drag flex items-center gap-1 bg-[var(--bg-primary)] rounded-md p-0.5 border border-[var(--border)]">
          {themes.map(({ id, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTheme(id)}
              className={cn(
                'p-1.5 rounded transition-colors',
                theme === id
                  ? 'bg-[var(--accent)] text-white'
                  : 'hover:bg-[var(--bg-hover)] text-[var(--text-muted)]'
              )}
              title={`${id} mode`}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>

      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
    </>
  );
}
