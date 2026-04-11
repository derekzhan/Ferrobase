import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Save, Trash2, Clock, Copy, Check, AlertCircle,
  Hash, List, Layers, BarChart3, Type, FileText,
} from 'lucide-react';
import { redisApi } from '../../api';
import { useConfirmDialog } from '../ConfirmDialog';
import { useTabStore } from '../../stores';
import type { RedisTab, RedisValue } from '../../types';
import { cn, extractErrorMessage } from '../../lib/utils';

interface Props {
  tab: RedisTab;
}

const TYPE_ICONS: Record<string, { icon: typeof Type; color: string; label: string }> = {
  string: { icon: Type, color: 'text-green-400', label: 'String' },
  list: { icon: List, color: 'text-blue-400', label: 'List' },
  set: { icon: Layers, color: 'text-purple-400', label: 'Set' },
  zset: { icon: BarChart3, color: 'text-orange-400', label: 'Sorted Set' },
  hash: { icon: Hash, color: 'text-cyan-400', label: 'Hash' },
  stream: { icon: FileText, color: 'text-yellow-400', label: 'Stream' },
};

export function RedisKeyViewer({ tab }: Props) {
  const { confirm, ConfirmDialogElement } = useConfirmDialog();
  const closeTab = useTabStore((s) => s.closeTab);

  const [keyType, setKeyType] = useState('string');
  const [ttl, setTtl] = useState(-1);
  const [ttlInput, setTtlInput] = useState('-1');
  const [value, setValue] = useState<RedisValue | null>(null);
  const [stringValue, setStringValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadKey = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [val, keyTtl] = await Promise.all([
        redisApi.getKey(tab.connectionId, tab.redisKey),
        redisApi.getKeyTtl(tab.connectionId, tab.redisKey),
      ]);
      setValue(val);
      setTtl(keyTtl);
      setTtlInput(String(keyTtl));
      setKeyType(val.type.toLowerCase());
      if (val.type === 'String') {
        setStringValue(val.value);
      }
      setDirty(false);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab.connectionId, tab.redisKey]);

  useEffect(() => { loadKey(); }, [loadKey]);

  const handleSave = async () => {
    if (keyType !== 'string') return;
    setSaving(true);
    try {
      await redisApi.setKey(tab.connectionId, tab.redisKey, stringValue);
      // Update TTL if changed
      const newTtl = parseInt(ttlInput, 10);
      if (!isNaN(newTtl) && newTtl !== ttl) {
        await redisApi.setKeyTtl(tab.connectionId, tab.redisKey, newTtl);
        setTtl(newTtl);
      }
      setDirty(false);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTtl = async () => {
    const newTtl = parseInt(ttlInput, 10);
    if (isNaN(newTtl)) return;
    try {
      await redisApi.setKeyTtl(tab.connectionId, tab.redisKey, newTtl);
      setTtl(newTtl);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete Key',
      message: `Are you sure you want to delete key "${tab.redisKey}"? This action cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete Key',
    });
    if (!ok) return;
    try {
      await redisApi.deleteKey(tab.connectionId, tab.redisKey);
      closeTab(tab.id);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  };

  const handleCopy = () => {
    const text = value?.type === 'String' ? value.value
      : value?.type === 'List' || value?.type === 'Set' ? JSON.stringify(value.value, null, 2)
      : value?.type === 'Hash' ? JSON.stringify(Object.fromEntries(value.value), null, 2)
      : value?.type === 'ZSet' ? JSON.stringify(value.value.map(([m, s]) => ({ member: m, score: s })), null, 2)
      : JSON.stringify(value, null, 2);
    navigator.clipboard.writeText(text ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const typeInfo = TYPE_ICONS[keyType] ?? TYPE_ICONS.string;
  const TypeIcon = typeInfo.icon;

  const getValueSize = (): string => {
    if (!value) return '—';
    if (value.type === 'String') return `${new Blob([value.value]).size} bytes`;
    if (value.type === 'List' || value.type === 'Set') return `${value.value.length} items`;
    if (value.type === 'Hash') return `${value.value.length} fields`;
    if (value.type === 'ZSet') return `${value.value.length} members`;
    return '—';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        <RefreshCw size={16} className="animate-spin mr-2" /> Loading key...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {ConfirmDialogElement}

      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)] flex-shrink-0">
        <TypeIcon size={14} className={typeInfo.color} />
        <span className="text-xs font-medium text-[var(--text-primary)] truncate flex-1" title={tab.redisKey}>
          {tab.redisKey}
        </span>
        <button
          onClick={() => loadKey(true)}
          className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)]"
          title="Refresh"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Key metadata */}
      <div className="flex items-center gap-4 px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)] flex-shrink-0">
        {/* Type badge */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-muted)]">Type</span>
          <span className={cn('text-xs font-mono px-1.5 py-0.5 rounded', typeInfo.color, 'bg-[var(--bg-primary)]')}>
            {typeInfo.label}
          </span>
        </div>

        {/* TTL */}
        <div className="flex items-center gap-1.5">
          <Clock size={11} className="text-[var(--text-muted)]" />
          <span className="text-[10px] text-[var(--text-muted)]">TTL</span>
          <input
            type="text"
            value={ttlInput}
            onChange={(e) => setTtlInput(e.target.value)}
            onBlur={handleSaveTtl}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveTtl()}
            autoComplete="off"
            autoCapitalize="off"
            className="text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border)] rounded px-1.5 py-0.5 w-16 text-center text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            title="TTL in seconds (-1 = no expiry, -2 = key not found)"
          />
        </div>

        {/* Size */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-muted)]">Size</span>
          <span className="text-xs text-[var(--text-primary)]">{getValueSize()}</span>
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <button
          onClick={handleCopy}
          className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)]"
          title="Copy value"
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
        </button>
        <button
          onClick={handleDelete}
          className="p-1 hover:bg-red-500/10 rounded text-red-400"
          title="Delete key"
        >
          <Trash2 size={12} />
        </button>
        {keyType === 'string' && dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90 disabled:opacity-50"
          >
            <Save size={11} /> {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {/* Value area */}
      <div className="flex-1 overflow-auto p-4">
        {value?.type === 'String' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Value</span>
            </div>
            <textarea
              value={stringValue}
              onChange={(e) => { setStringValue(e.target.value); setDirty(true); }}
              className="flex-1 w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded p-3 text-xs font-mono text-[var(--text-primary)] outline-none resize-none focus:border-[var(--accent)]"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        )}

        {value?.type === 'List' && (
          <div>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">
              List ({value.value.length} items)
            </div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-1.5 px-2 text-[var(--text-muted)] font-medium w-12">#</th>
                  <th className="text-left py-1.5 px-2 text-[var(--text-muted)] font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {value.value.map((item, i) => (
                  <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                    <td className="py-1 px-2 text-[var(--text-muted)] font-mono">{i}</td>
                    <td className="py-1 px-2 text-[var(--text-primary)] font-mono break-all">{item}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {value?.type === 'Set' && (
          <div>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Set ({value.value.length} members)
            </div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-1.5 px-2 text-[var(--text-muted)] font-medium w-12">#</th>
                  <th className="text-left py-1.5 px-2 text-[var(--text-muted)] font-medium">Member</th>
                </tr>
              </thead>
              <tbody>
                {value.value.map((item, i) => (
                  <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                    <td className="py-1 px-2 text-[var(--text-muted)] font-mono">{i + 1}</td>
                    <td className="py-1 px-2 text-[var(--text-primary)] font-mono break-all">{item}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {value?.type === 'Hash' && (
          <div>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Hash ({value.value.length} fields)
            </div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-1.5 px-2 text-[var(--text-muted)] font-medium w-12">#</th>
                  <th className="text-left py-1.5 px-2 text-[var(--text-muted)] font-medium">Field</th>
                  <th className="text-left py-1.5 px-2 text-[var(--text-muted)] font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {value.value.map(([field, val], i) => (
                  <tr key={field} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                    <td className="py-1 px-2 text-[var(--text-muted)] font-mono">{i + 1}</td>
                    <td className="py-1 px-2 text-cyan-400 font-mono">{field}</td>
                    <td className="py-1 px-2 text-[var(--text-primary)] font-mono break-all">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {value?.type === 'ZSet' && (
          <div>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Sorted Set ({value.value.length} members)
            </div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-1.5 px-2 text-[var(--text-muted)] font-medium w-12">#</th>
                  <th className="text-left py-1.5 px-2 text-[var(--text-muted)] font-medium">Score</th>
                  <th className="text-left py-1.5 px-2 text-[var(--text-muted)] font-medium">Member</th>
                </tr>
              </thead>
              <tbody>
                {value.value.map(([member, score], i) => (
                  <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--bg-hover)]">
                    <td className="py-1 px-2 text-[var(--text-muted)] font-mono">{i + 1}</td>
                    <td className="py-1 px-2 text-orange-400 font-mono">{score}</td>
                    <td className="py-1 px-2 text-[var(--text-primary)] font-mono break-all">{member}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {value?.type === 'None' && (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-xs">
            Key does not exist or has expired
          </div>
        )}
      </div>
    </div>
  );
}
