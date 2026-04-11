import { useState } from 'react';
import { X, Monitor, Moon, Sun, RotateCcw } from 'lucide-react';
import { useThemeStore, useSettingsStore } from '../../stores';
import { useConfirmDialog } from '../ConfirmDialog';
import { cn } from '../../lib/utils';

interface Props {
  onClose: () => void;
}

type SettingsTab = 'appearance' | 'editor' | 'data' | 'connections';

export function SettingsPanel({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const { theme, setTheme } = useThemeStore();
  const { settings, updateSettings, resetSettings } = useSettingsStore();
  const { confirm, ConfirmDialogElement } = useConfirmDialog();

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'editor', label: 'SQL Editor' },
    { id: 'data', label: 'Data Grid' },
    { id: 'connections', label: 'Connections' },
  ];

  return (
    <>
      {ConfirmDialogElement}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
      <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl shadow-2xl w-[680px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold">Preferences</h2>
          <button onClick={onClose} className="p-1 hover:bg-[var(--bg-hover)] rounded">
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left nav */}
          <div className="w-40 border-r border-[var(--border)] p-2 space-y-0.5 flex-shrink-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  'w-full text-left px-3 py-1.5 rounded text-xs transition-colors',
                  activeTab === t.id
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === 'appearance' && (
              <div className="space-y-5">
                <Section title="Theme">
                  <div className="flex gap-3">
                    {(
                      [
                        { value: 'dark', label: 'Dark', Icon: Moon },
                        { value: 'light', label: 'Light', Icon: Sun },
                        { value: 'system', label: 'System', Icon: Monitor },
                      ] as const
                    ).map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        onClick={() => setTheme(value)}
                        className={cn(
                          'flex flex-col items-center gap-2 px-4 py-3 rounded-lg border text-xs transition-colors',
                          theme === value
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                            : 'border-[var(--border)] hover:border-[var(--accent)]/50 text-[var(--text-muted)]',
                        )}
                      >
                        <Icon size={18} />
                        {label}
                      </button>
                    ))}
                  </div>
                </Section>
              </div>
            )}

            {activeTab === 'editor' && (
              <div className="space-y-5">
                <Section title="Font">
                  <Row label="Font Size">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={10}
                        max={20}
                        value={settings.editorFontSize}
                        onChange={(e) => updateSettings({ editorFontSize: Number(e.target.value) })}
                        className="w-32"
                      />
                      <span className="text-xs w-8 text-right">{settings.editorFontSize}px</span>
                    </div>
                  </Row>
                  <Row label="Font Family">
                    <select
                      value={settings.editorFontFamily}
                      onChange={(e) => updateSettings({ editorFontFamily: e.target.value })}
                      className="text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 outline-none"
                    >
                      <option value="'JetBrains Mono', 'Fira Code', monospace">JetBrains Mono</option>
                      <option value="'Fira Code', monospace">Fira Code</option>
                      <option value="'Cascadia Code', monospace">Cascadia Code</option>
                      <option value="'Source Code Pro', monospace">Source Code Pro</option>
                      <option value="monospace">System Monospace</option>
                    </select>
                  </Row>
                </Section>
                <Section title="Behavior">
                  <Row label="Auto Format on Paste">
                    <Toggle
                      value={settings.autoFormatOnPaste}
                      onChange={(v) => updateSettings({ autoFormatOnPaste: v })}
                    />
                  </Row>
                </Section>
              </div>
            )}

            {activeTab === 'data' && (
              <div className="space-y-5">
                <Section title="Display">
                  <Row label="NULL Display">
                    <select
                      value={settings.nullDisplay}
                      onChange={(e) =>
                        updateSettings({
                          nullDisplay: e.target.value as typeof settings.nullDisplay,
                        })
                      }
                      className="text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 outline-none"
                    >
                      <option value="NULL">NULL</option>
                      <option value="(null)">(null)</option>
                      <option value="—">—</option>
                      <option value="">(empty)</option>
                    </select>
                  </Row>
                  <Row label="Boolean Display">
                    <select
                      value={settings.boolDisplay}
                      onChange={(e) =>
                        updateSettings({
                          boolDisplay: e.target.value as typeof settings.boolDisplay,
                        })
                      }
                      className="text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 outline-none"
                    >
                      <option value="true/false">true / false</option>
                      <option value="1/0">1 / 0</option>
                      <option value="YES/NO">YES / NO</option>
                    </select>
                  </Row>
                  <Row label="Max Decimal Places">
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={settings.maxDecimalPlaces}
                      onChange={(e) =>
                        updateSettings({ maxDecimalPlaces: Number(e.target.value) })
                      }
                      autoComplete="off"
                      autoCapitalize="off"
                      className="w-16 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 outline-none"
                    />
                  </Row>
                </Section>
                <Section title="Pagination">
                  <Row label="Default Row Limit">
                    <select
                      value={settings.defaultQueryLimit}
                      onChange={(e) =>
                        updateSettings({ defaultQueryLimit: Number(e.target.value) })
                      }
                      className="text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 outline-none"
                    >
                      {[100, 200, 500, 1000, 5000, 10000].map((n) => (
                        <option key={n} value={n}>{n.toLocaleString()} rows</option>
                      ))}
                    </select>
                  </Row>
                </Section>
              </div>
            )}

            {activeTab === 'connections' && (
              <div className="space-y-5">
                <Section title="Timeouts">
                  <Row label="Query Timeout (seconds)">
                    <input
                      type="number"
                      min={5}
                      max={3600}
                      value={settings.queryTimeoutSecs}
                      onChange={(e) =>
                        updateSettings({ queryTimeoutSecs: Number(e.target.value) })
                      }
                      autoComplete="off"
                      autoCapitalize="off"
                      className="w-20 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-2 py-1 outline-none"
                    />
                  </Row>
                </Section>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)]">
          <button
            onClick={async () => {
              const ok = await confirm({
                title: 'Reset Settings',
                message: 'Are you sure you want to reset all settings to their default values?',
                variant: 'warning',
                confirmLabel: 'Reset',
              });
              if (ok) resetSettings();
            }}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <RotateCcw size={12} />
            Reset to Defaults
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--text-primary)]">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        value ? 'bg-[var(--accent)]' : 'bg-[var(--border)]',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
          value ? 'translate-x-4.5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
