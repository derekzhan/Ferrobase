import { useState } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useConnectionStore } from '../../stores';
import { cn, extractErrorMessage } from '../../lib/utils';
import { DbTypeIcon } from '../icons/DbIcons';
import type { DatabaseType } from '../../types';
import { DB_TYPE_LABELS, DB_DEFAULT_PORTS } from '../../types';

interface Props {
  onClose: () => void;
  editId?: string;
}

const DB_TYPES: DatabaseType[] = ['mysql', 'postgres', 'sqlite', 'mongodb', 'redis'];

export function ConnectionDialog({ onClose, editId }: Props) {
  const { createConnection, updateConnection, testConnection } = useConnectionStore();
  const connections = useConnectionStore((s) => s.connections);
  const existing = editId ? connections.find((c) => c.id === editId) : undefined;

  const [form, setForm] = useState({
    name: existing?.name ?? '',
    dbType: (existing?.dbType ?? 'mysql') as DatabaseType,
    host: existing?.host ?? 'localhost',
    port: existing?.port ?? DB_DEFAULT_PORTS['mysql'],
    database: existing?.database ?? '',
    username: existing?.username ?? '',
    password: '',
    useSsl: existing?.useSsl ?? false,
    useSshTunnel: existing?.useSshTunnel ?? false,
    color: existing?.color ?? '',
    group: existing?.group ?? '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testError, setTestError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isSQLite = form.dbType === 'sqlite';
  const isRedis = form.dbType === 'redis';

  const updateField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
    setTestResult(null);
  };

  const handleDbTypeChange = (dbType: DatabaseType) => {
    setForm((f) => ({
      ...f,
      dbType,
      port: DB_DEFAULT_PORTS[dbType],
      host: dbType === 'sqlite' ? '' : 'localhost',
    }));
    setTestResult(null);
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!isSQLite && !form.host.trim()) errs.host = 'Host is required';
    if (isSQLite && !form.host.trim()) errs.host = 'File path is required';
    return errs;
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    setTestError('');
    try {
      await testConnection({
        name: form.name,
        dbType: form.dbType,
        host: form.host,
        port: form.port,
        database: form.database || undefined,
        username: form.username || undefined,
        password: form.password || undefined,
        useSsl: form.useSsl,
        useSshTunnel: form.useSshTunnel,
      });
      setTestResult('success');
    } catch (e) {
      setTestResult('error');
      setTestError(extractErrorMessage(e));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setIsSaving(true);
    try {
      const input = {
        name: form.name,
        dbType: form.dbType,
        host: form.host,
        port: form.port,
        database: form.database || undefined,
        username: form.username || undefined,
        password: form.password || undefined,
        useSsl: form.useSsl,
        useSshTunnel: form.useSshTunnel,
        color: form.color || undefined,
        group: form.group || undefined,
      };

      if (editId) {
        await updateConnection(editId, input);
      } else {
        await createConnection(input);
      }
      onClose();
    } catch (e) {
      setErrors({ _: extractErrorMessage(e) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-secondary)] rounded-lg shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto border border-[var(--border)]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
          <DbTypeIcon dbType={form.dbType} size={24} />
          <h2 className="text-base font-semibold flex-1">
            {editId ? 'Edit Connection' : 'New Connection'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          {/* DB Type selector */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">
              Database Type
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {DB_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => handleDbTypeChange(type)}
                  className={cn(
                    'flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-colors',
                    form.dbType === type
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                      : 'border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)]'
                  )}
                >
                  <DbTypeIcon dbType={type} size={20} />
                  <span className="font-medium">{DB_TYPE_LABELS[type]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <Field label="Connection Name" error={errors.name}>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder={`My ${DB_TYPE_LABELS[form.dbType]}`}
              autoComplete="off"
              autoCapitalize="off"
              className={inputClass(!!errors.name)}
            />
          </Field>

          {/* Host / Port */}
          {isSQLite ? (
            <Field label="Database File Path" error={errors.host}>
              <input
                type="text"
                value={form.host}
                onChange={(e) => updateField('host', e.target.value)}
                placeholder="/path/to/database.db"
                autoComplete="off"
                autoCapitalize="off"
                className={inputClass(!!errors.host)}
              />
            </Field>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="Host" error={errors.host}>
                  <input
                    type="text"
                    value={form.host}
                    onChange={(e) => updateField('host', e.target.value)}
                    placeholder="localhost"
                    autoComplete="off"
                    autoCapitalize="off"
                    className={inputClass(!!errors.host)}
                  />
                </Field>
              </div>
              <Field label="Port">
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => updateField('port', parseInt(e.target.value) || 0)}
                  autoComplete="off"
                  autoCapitalize="off"
                  className={inputClass(false)}
                />
              </Field>
            </div>
          )}

          {/* Database name */}
          {!isSQLite && (
            <Field label={isRedis ? 'Database Index' : 'Database Name'}>
              <input
                type="text"
                value={form.database}
                onChange={(e) => updateField('database', e.target.value)}
                placeholder={isRedis ? '0' : 'Optional'}
                autoComplete="off"
                autoCapitalize="off"
                className={inputClass(false)}
              />
            </Field>
          )}

          {/* Username / Password */}
          {!isSQLite && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Username">
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => updateField('username', e.target.value)}
                  placeholder={isRedis ? 'Optional' : 'root'}
                  className={inputClass(false)}
                  autoComplete="username"
                />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => updateField('password', e.target.value)}
                    placeholder={editId ? "Leave blank to keep existing password" : "••••••••"}
                    className={cn(inputClass(false), 'pr-8')}
                    autoComplete="current-password"
                    autoCapitalize="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                  >
                    {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </Field>
            </div>
          )}

          {/* Color label */}
          <div className="flex items-center gap-3">
            <Field label="Color Label (optional)">
              <div className="flex gap-2">
                {['', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6'].map(
                  (color) => (
                    <button
                      key={color}
                      onClick={() => updateField('color', color)}
                      className={cn(
                        'w-5 h-5 rounded-full border-2 transition-all',
                        form.color === color
                          ? 'border-[var(--accent)] scale-125'
                          : 'border-transparent'
                      )}
                      style={{
                        background: color || 'var(--border)',
                      }}
                    />
                  )
                )}
              </div>
            </Field>
          </div>

          {/* Test result */}
          {testResult === 'success' && (
            <div className="flex items-center gap-2 text-green-500 text-xs bg-green-500/10 rounded px-3 py-2">
              <CheckCircle size={14} />
              Connection successful!
            </div>
          )}
          {testResult === 'error' && (
            <div className="flex items-start gap-2 text-red-500 text-xs bg-red-500/10 rounded px-3 py-2">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{testError || 'Connection failed'}</span>
            </div>
          )}

          {errors._ && (
            <div className="text-red-500 text-xs bg-red-500/10 rounded px-3 py-2">
              {errors._}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-primary)]">
          <button
            onClick={handleTest}
            disabled={isTesting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[var(--border)] rounded hover:bg-[var(--bg-hover)] text-[var(--text-primary)] transition-colors disabled:opacity-50"
          >
            {isTesting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CheckCircle size={12} />
            )}
            Test Connection
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs border border-[var(--border)] rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-[var(--accent)] text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {isSaving && <Loader2 size={12} className="animate-spin" />}
              {editId ? 'Save Changes' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function inputClass(hasError: boolean) {
  return cn(
    'w-full px-2.5 py-1.5 text-xs rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none transition-colors',
    hasError
      ? 'border-red-500 focus:border-red-500'
      : 'border-[var(--border)] focus:border-[var(--accent)]'
  );
}
