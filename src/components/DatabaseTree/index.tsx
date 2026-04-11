import { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Database,
  Table2,
  Eye,
  Code2,
  RefreshCw,
  Loader2,
  Plug,
  PlugZap,
  AlertCircle,
  Pencil,
  Trash2,
  Copy,
  Key,
  FolderOpen,
  Columns,
  Search,
  FilePlus,
  FileEdit,
  XCircle,
  Scissors,
} from 'lucide-react';
import { useConnectionStore, useTabStore } from '../../stores';
import { schemaApi, redisApi, connectionApi } from '../../api';
import { invoke } from '@tauri-apps/api/core';
import { cn, extractErrorMessage } from '../../lib/utils';
import { DbTypeIcon } from '../icons/DbIcons';
import { ContextMenu, type MenuItemOrSeparator } from '../ContextMenu';
import { useConfirmDialog } from '../ConfirmDialog';
import type {
  ConnectionConfig,
  ConnectionStatus,
  DatabaseInfo,
  TableInfo,
  RedisKeyInfo,
  ColumnDetail,
} from '../../types';

interface DatabaseTreeProps {
  connection: ConnectionConfig;
  status: ConnectionStatus;
  onEditConnection: (id: string) => void;
  onDeleteConnection: (id: string) => void;
  searchQuery?: string;
}

interface DbNode {
  databases?: DatabaseInfo[];
  tables?: Record<string, TableInfo[]>;
  columns?: Record<string, ColumnDetail[]>;
  redisKeys?: RedisKeyInfo[];
  isLoadingDatabases?: boolean;
  isLoadingTables?: Record<string, boolean>;
  isLoadingColumns?: Record<string, boolean>;
  isLoadingKeys?: boolean;
  error?: string;
  tableErrors?: Record<string, string>;
}

type ContextMenuState = {
  x: number;
  y: number;
  items: MenuItemOrSeparator[];
} | null;

// Table sub-items definition
const TABLE_CHILDREN = [
  { id: 'columns' as const, label: 'Columns', icon: Columns, tab: 'columns' as const },
  { id: 'indexes' as const, label: 'Indexes', icon: Key, tab: 'indexes' as const },
  { id: 'ddl' as const, label: 'DDL', icon: Code2, tab: 'ddl' as const },
] as const;

export function DatabaseTree({ connection, status, onEditConnection, onDeleteConnection, searchQuery = '' }: DatabaseTreeProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [expandedTableChildren, setExpandedTableChildren] = useState<Set<string>>(new Set());
  const [node, setNode] = useState<DbNode>({});
  const [expandedRedisGroups, setExpandedRedisGroups] = useState<Set<string>>(new Set());
  const [redisSearch, setRedisSearch] = useState('');
  const connect = useConnectionStore((s) => s.connect);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const openQueryTab = useTabStore((s) => s.openQueryTab);
  const openTableTab = useTabStore((s) => s.openTableTab);
  const openRedisTab = useTabStore((s) => s.openRedisTab);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const { confirm, ConfirmDialogElement } = useConfirmDialog();

  const isConnected = status === 'Connected';
  const isConnecting = status === 'Connecting';
  const isMongo = connection.dbType === 'mongodb';
  const isRedis = connection.dbType === 'redis';

  const handleToggleConnection = async () => {
    if (isConnected) {
      await disconnect(connection.id);
      setExpanded(false);
      setNode({});
    } else if (!isConnecting) {
      try {
        await connect(connection.id);
        setExpanded(true);
        if (isRedis) {
          await loadRedisKeys();
        } else {
          await loadDatabases();
        }
      } catch (e) {
        // status set to Error in store
      }
    }
  };

  const loadDatabases = async () => {
    setNode((n) => ({ ...n, isLoadingDatabases: true, error: undefined }));
    try {
      const databases = await schemaApi.getDatabases(connection.id);
      setNode((n) => ({ ...n, databases, isLoadingDatabases: false }));
    } catch (e) {
      setNode((n) => ({ ...n, isLoadingDatabases: false, error: extractErrorMessage(e) }));
    }
  };

  const loadTables = async (database: string, schema?: string) => {
    const key = schema ? `${database}.${schema}` : database;
    setNode((n) => ({
      ...n,
      isLoadingTables: { ...n.isLoadingTables, [key]: true },
      tableErrors: { ...n.tableErrors, [key]: '' },
    }));
    try {
      const tables = await schemaApi.getTables(connection.id, database, schema);
      setNode((n) => ({
        ...n,
        tables: { ...n.tables, [key]: tables },
        isLoadingTables: { ...n.isLoadingTables, [key]: false },
      }));
    } catch (e) {
      setNode((n) => ({
        ...n,
        isLoadingTables: { ...n.isLoadingTables, [key]: false },
        tableErrors: { ...n.tableErrors, [key]: extractErrorMessage(e) },
      }));
    }
  };

  const loadRedisKeys = async (pattern = '*', count = 500) => {
    setNode((n) => ({ ...n, isLoadingKeys: true, error: undefined }));
    try {
      const keys = await redisApi.listKeys(connection.id, pattern, count);
      setNode((n) => ({ ...n, redisKeys: keys, isLoadingKeys: false }));
    } catch (e) {
      setNode((n) => ({ ...n, isLoadingKeys: false, error: extractErrorMessage(e) }));
    }
  };

  const loadColumns = async (database: string, tableName: string, schema?: string) => {
    const key = `${database}::${tableName}`;
    setNode((n) => ({ ...n, isLoadingColumns: { ...n.isLoadingColumns, [key]: true } }));
    try {
      const cols = await schemaApi.getTableColumns(connection.id, database, tableName, schema);
      setNode((n) => ({
        ...n,
        columns: { ...n.columns, [key]: cols },
        isLoadingColumns: { ...n.isLoadingColumns, [key]: false },
      }));
    } catch {
      setNode((n) => ({ ...n, isLoadingColumns: { ...n.isLoadingColumns, [key]: false } }));
    }
  };

  const toggleTableChild = (db: string, tableName: string, childId: string) => {
    const key = `${db}::${tableName}::${childId}`;
    const next = new Set(expandedTableChildren);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      // Load columns when Columns node is first expanded
      if (childId === 'columns') {
        const tableKey = `${db}::${tableName}`;
        if (!node.columns?.[tableKey]) {
          loadColumns(db, tableName);
        }
      }
    }
    setExpandedTableChildren(next);
  };

  const toggleDb = (dbName: string) => {
    const newSet = new Set(expandedDbs);
    if (newSet.has(dbName)) {
      newSet.delete(dbName);
    } else {
      newSet.add(dbName);
      if (!node.tables?.[dbName]) {
        loadTables(dbName);
      }
    }
    setExpandedDbs(newSet);
  };

  const toggleTable = (db: string, tableName: string) => {
    const key = `${db}::${tableName}`;
    const next = new Set(expandedTables);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedTables(next);
  };

  const handleTableClick = (db: string, table: TableInfo) => {
    if (isMongo) {
      // MongoDB collections go straight to data
      openTableTab({
        title: table.name,
        connectionId: connection.id,
        database: db,
        tableName: table.name,
        activeTab: 'data',
      });
    } else {
      toggleTable(db, table.name);
    }
  };

  const handleTableDoubleClick = (db: string, table: TableInfo) => {
    openTableTab({
      title: table.name,
      connectionId: connection.id,
      database: db,
      tableName: table.name,
      activeTab: 'data',
    });
  };

  const handleTableChildClick = (db: string, tableName: string, tab: 'columns' | 'indexes' | 'ddl') => {
    openTableTab({
      title: tableName,
      connectionId: connection.id,
      database: db,
      tableName,
      activeTab: tab,
    });
  };

  const handleColumnClick = (db: string, tableName: string, columnName: string) => {
    const tabStore = useTabStore.getState();
    // Find or create the table tab, then set selectedColumn
    const existing = tabStore.tabs.find(
      (t) => t.kind === 'table' && t.data.connectionId === connection.id && t.data.database === db && t.data.tableName === tableName
    );
    if (existing) {
      tabStore.updateTableTab(existing.data.id, { activeTab: 'columns', selectedColumn: columnName });
      tabStore.setActiveTab(existing.data.id);
    } else {
      openTableTab({
        title: tableName,
        connectionId: connection.id,
        database: db,
        tableName,
        activeTab: 'columns',
        selectedColumn: columnName,
      });
    }
  };

  const handleOpenQuery = (db: string) => {
    openQueryTab({
      title: `Query - ${db}`,
      connectionId: connection.id,
      database: db,
    });
  };

  const handleRedisKeyClick = (key: RedisKeyInfo) => {
    openRedisTab({
      title: key.key.length > 40 ? '...' + key.key.slice(-37) : key.key,
      connectionId: connection.id,
      database: connection.database ?? '0',
      redisKey: key.key,
    });
  };

  // ========== Context Menus ==========

  const showConnectionContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItemOrSeparator[] = [];

    if (isConnected) {
      items.push({
        label: 'Disconnect',
        icon: <PlugZap size={13} />,
        onClick: () => { disconnect(connection.id); setExpanded(false); setNode({}); },
      });
    } else {
      items.push({
        label: 'Connect',
        icon: <Plug size={13} />,
        onClick: handleToggleConnection,
        disabled: isConnecting,
      });
    }
    items.push({ separator: true });
    items.push({ label: 'Edit Connection...', icon: <Pencil size={13} />, onClick: () => onEditConnection(connection.id) });
    items.push({ label: 'Copy Connection Name', icon: <Copy size={13} />, onClick: () => navigator.clipboard.writeText(connection.name) });
    items.push({ separator: true });
    if (isConnected) {
      if (!isRedis) {
        items.push({ label: 'New SQL Editor', icon: <Code2 size={13} />, shortcut: '⌘T', onClick: () => handleOpenQuery(connection.database ?? '') });
      }
      items.push({
        label: 'Refresh',
        icon: <RefreshCw size={13} />,
        onClick: () => isRedis ? loadRedisKeys() : loadDatabases(),
      });
      items.push({ separator: true });
    }
    items.push({ separator: true });
    items.push({
      label: 'Clone Connection',
      icon: <Copy size={13} />,
      onClick: async () => {
        try {
          await connectionApi.cloneConnection(connection.id);
          window.location.reload();
        } catch (e) {
          alert('Failed to clone connection');
        }
      },
    });
    items.push({ label: 'Delete Connection', icon: <Trash2 size={13} />, onClick: () => onDeleteConnection(connection.id), danger: true, disabled: isConnected });
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const showDatabaseContextMenu = (e: React.MouseEvent, dbName: string) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItemOrSeparator[] = [
      { label: 'New SQL Editor', icon: <Code2 size={13} />, onClick: () => handleOpenQuery(dbName) },
      { separator: true },
      { label: 'Refresh', icon: <RefreshCw size={13} />, onClick: () => loadTables(dbName) },
      { label: 'Copy Database Name', icon: <Copy size={13} />, onClick: () => navigator.clipboard.writeText(dbName) },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  const showTableContextMenu = (e: React.MouseEvent, dbName: string, table: TableInfo) => {
    e.preventDefault();
    e.stopPropagation();
    const q = isMongo ? '' : connection.dbType === 'postgres'
      ? `"${table.name}"`
      : `\`${table.name}\``;
    const items: MenuItemOrSeparator[] = [
      { label: 'View Data', icon: <Table2 size={13} />, onClick: () => handleTableDoubleClick(dbName, table) },
    ];
    if (!isMongo) {
      items.push({ label: 'View Structure', icon: <Columns size={13} />, onClick: () => {
        openTableTab({ title: table.name, connectionId: connection.id, database: dbName, tableName: table.name, activeTab: 'columns' });
      }});
    }
    items.push({ separator: true });
    if (!isMongo) {
      items.push({
        label: 'Generate SELECT',
        icon: <Search size={13} />,
        onClick: () => openQueryTab({ title: `SELECT - ${table.name}`, connectionId: connection.id, database: dbName, sql: `SELECT * FROM ${q} LIMIT 100;` }),
      });
      items.push({
        label: 'Generate INSERT',
        icon: <FilePlus size={13} />,
        onClick: () => openQueryTab({ title: `INSERT - ${table.name}`, connectionId: connection.id, database: dbName, sql: `INSERT INTO ${q} () VALUES ();` }),
      });
      items.push({
        label: 'Generate UPDATE',
        icon: <FileEdit size={13} />,
        onClick: () => openQueryTab({ title: `UPDATE - ${table.name}`, connectionId: connection.id, database: dbName, sql: `UPDATE ${q} SET  WHERE ;` }),
      });
      items.push({
        label: 'Generate DELETE',
        icon: <Trash2 size={13} />,
        onClick: () => openQueryTab({ title: `DELETE - ${table.name}`, connectionId: connection.id, database: dbName, sql: `DELETE FROM ${q} WHERE ;` }),
      });
      items.push({ separator: true });
      items.push({
        label: 'Truncate Table',
        icon: <Scissors size={13} />,
        onClick: async () => {
          const ok = await confirm({
            title: 'Truncate Table',
            message: `This will permanently delete ALL rows from table "${table.name}". This action cannot be undone.`,
            detail: `TRUNCATE TABLE ${q}`,
            variant: 'danger',
            confirmLabel: 'Truncate',
          });
          if (!ok) return;
          try {
            await invoke('execute_query', { connectionId: connection.id, sql: `TRUNCATE TABLE ${q}` });
            await loadTables(dbName);
          } catch (err) {
            alert(`Truncate failed: ${err}`);
          }
        },
        danger: true,
      });
      if (table.tableType !== 'View') {
        items.push({
          label: 'Drop Table',
          icon: <XCircle size={13} />,
          onClick: async () => {
            const ok = await confirm({
              title: 'Drop Table',
              message: `This will permanently drop table "${table.name}" and all its data. This action is irreversible!`,
              detail: `DROP TABLE ${q}`,
              variant: 'danger',
              confirmLabel: 'Drop Table',
            });
            if (!ok) return;
            try {
              await invoke('execute_query', { connectionId: connection.id, sql: `DROP TABLE ${q}` });
              await loadTables(dbName);
            } catch (err) {
              alert(`Drop failed: ${err}`);
            }
          },
          danger: true,
        });
      } else {
        items.push({
          label: 'Drop View',
          icon: <XCircle size={13} />,
          onClick: async () => {
            const ok = await confirm({
              title: 'Drop View',
              message: `This will permanently drop view "${table.name}". This action is irreversible!`,
              detail: `DROP VIEW ${q}`,
              variant: 'danger',
              confirmLabel: 'Drop View',
            });
            if (!ok) return;
            try {
              await invoke('execute_query', { connectionId: connection.id, sql: `DROP VIEW ${q}` });
              await loadTables(dbName);
            } catch (err) {
              alert(`Drop failed: ${err}`);
            }
          },
          danger: true,
        });
      }
    }
    items.push({ separator: true });
    items.push({ label: isMongo ? 'Copy Collection Name' : 'Copy Table Name', icon: <Copy size={13} />, onClick: () => navigator.clipboard.writeText(table.name) });
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  };

  // ========== Rendering ==========

  const statusDot = () => {
    if (isConnecting)
      return <Loader2 size={10} className="animate-spin text-yellow-400" />;
    if (isConnected)
      return <span className="w-2 h-2 rounded-full bg-green-400" />;
    if (typeof status === 'object' && 'Error' in status)
      return <AlertCircle size={10} className="text-red-400" />;
    return <span className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />;
  };

  const getStatusTooltip = () => {
    if (isConnecting) return 'Connecting...';
    if (isConnected) return 'Connected - click to disconnect';
    if (typeof status === 'object' && 'Error' in status)
      return `Error: ${status.Error}`;
    return 'Click to connect';
  };

  // Build hierarchical tree from flat keys using ":" as the standard Redis separator.
  // Keys without ":" are placed directly at root level (no splitting by _ or other chars).
  interface RedisTreeNode {
    label: string;       // Display label for this node (the segment name)
    fullPrefix: string;  // Full prefix path including separator, e.g. "longbing:order"
    keys: RedisKeyInfo[];
    children: Map<string, RedisTreeNode>;
    count: number; // total leaf keys under this node
  }

  const REDIS_SEPARATOR = ':';

  const buildRedisTree = (keys: RedisKeyInfo[]): RedisTreeNode => {
    const root: RedisTreeNode = { label: '', fullPrefix: '', keys: [], children: new Map(), count: 0 };
    for (const k of keys) {
      const parts = k.key.split(REDIS_SEPARATOR);
      if (parts.length <= 1) {
        // No separator — place directly at root
        root.keys.push(k);
        continue;
      }
      let current = root;
      // Group by all parts except the last one (the last part is the leaf key name)
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const prefix = parts.slice(0, i + 1).join(REDIS_SEPARATOR);
        if (!current.children.has(part)) {
          current.children.set(part, { label: part, fullPrefix: prefix, keys: [], children: new Map(), count: 0 });
        }
        current = current.children.get(part)!;
      }
      current.keys.push(k);
    }

    // Collapse single-child folders: if a folder has exactly one child folder and no leaf keys,
    // merge it with its child (e.g. "a" -> "b" becomes "a:b")
    const collapse = (n: RedisTreeNode) => {
      for (const [key, child] of n.children) {
        collapse(child);
        if (child.children.size === 1 && child.keys.length === 0) {
          const [grandchildKey, grandchild] = [...child.children.entries()][0];
          grandchild.label = child.label + REDIS_SEPARATOR + grandchild.label;
          n.children.delete(key);
          n.children.set(key + REDIS_SEPARATOR + grandchildKey, grandchild);
        }
      }
    };
    collapse(root);

    // Count total keys recursively
    const countKeys = (n: RedisTreeNode): number => {
      let c = n.keys.length;
      for (const child of n.children.values()) c += countKeys(child);
      n.count = c;
      return c;
    };
    countKeys(root);
    return root;
  };

  const toggleRedisGroup = (prefix: string) => {
    const next = new Set(expandedRedisGroups);
    if (next.has(prefix)) next.delete(prefix);
    else next.add(prefix);
    setExpandedRedisGroups(next);
  };

  const renderRedisTreeNode = (treeNode: RedisTreeNode, depth: number): React.ReactNode => {
    const items: React.ReactNode[] = [];

    // Sort children alphabetically, then keys
    const sortedChildren = [...treeNode.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const sortedKeys = [...treeNode.keys].sort((a, b) => a.key.localeCompare(b.key));

    // Render folder children
    for (const [, child] of sortedChildren) {
      const isExpanded = expandedRedisGroups.has(child.fullPrefix);
      items.push(
        <div key={`g:${child.fullPrefix}`}>
          <div
            className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-[var(--bg-hover)] text-xs"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => toggleRedisGroup(child.fullPrefix)}
          >
            {isExpanded
              ? <ChevronDown size={11} className="text-[var(--text-muted)] flex-shrink-0" />
              : <ChevronRight size={11} className="text-[var(--text-muted)] flex-shrink-0" />}
            <FolderOpen size={11} className="text-yellow-500 flex-shrink-0" />
            <span className="truncate text-[var(--text-primary)]">{child.label}</span>
            <span className="text-[9px] text-[var(--text-muted)] opacity-50 ml-auto flex-shrink-0">({child.count})</span>
          </div>
          {isExpanded && renderRedisTreeNode(child, depth + 1)}
        </div>
      );
    }

    // Render leaf keys
    for (const k of sortedKeys) {
      // Show the key portion after the parent prefix
      // e.g., if parent prefix is "user:session" and key is "user:session:abc123", show "abc123"
      const parentPrefix = treeNode.fullPrefix;
      const displayName = parentPrefix && k.key.startsWith(parentPrefix + REDIS_SEPARATOR)
        ? k.key.slice(parentPrefix.length + 1)
        : k.key;
      items.push(
        <div
          key={`k:${k.key}`}
          className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-[var(--bg-hover)] text-xs"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => handleRedisKeyClick(k)}
          title={k.key}
        >
          <span className="w-[11px] flex-shrink-0" />
          <Key size={10} className="text-red-400 flex-shrink-0" />
          <span className="flex-1 truncate text-[var(--text-primary)]">{displayName}</span>
          <span className="text-[9px] text-[var(--text-muted)] font-mono uppercase flex-shrink-0">{k.keyType}</span>
        </div>
      );
    }

    return items;
  };

  const renderRedisKeys = () => {
    if (node.isLoadingKeys) {
      return (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--text-muted)] pl-6">
          <Loader2 size={12} className="animate-spin" /> Loading keys...
        </div>
      );
    }
    if (node.error) {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-red-400 pl-6">
          <AlertCircle size={12} /> {node.error}
        </div>
      );
    }
    const allKeys = node.redisKeys ?? [];
    if (allKeys.length === 0) {
      return (
        <div className="px-2 py-1.5 text-xs text-[var(--text-muted)] pl-6">
          No keys found
        </div>
      );
    }

    // Filter by search
    const sq = redisSearch.toLowerCase();
    const filteredKeys = sq ? allKeys.filter((k) => k.key.toLowerCase().includes(sq)) : allKeys;

    const tree = buildRedisTree(filteredKeys);

    return (
      <div>
        {/* Search box */}
        <div className="px-2 py-1">
          <div className="flex items-center gap-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded px-1.5 py-0.5">
            <Search size={10} className="text-[var(--text-muted)] flex-shrink-0" />
            <input
              type="text"
              value={redisSearch}
              onChange={(e) => setRedisSearch(e.target.value)}
              placeholder="Filter keys..."
              autoComplete="off"
              autoCapitalize="off"
              className="text-[10px] bg-transparent outline-none w-full text-[var(--text-primary)] placeholder-[var(--text-muted)]"
            />
          </div>
        </div>
        {/* Key count */}
        <div className="px-2 py-0.5 text-[9px] text-[var(--text-muted)]">
          {filteredKeys.length}{sq ? ` / ${allKeys.length}` : ''} keys
        </div>
        {/* Tree */}
        {filteredKeys.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-[var(--text-muted)] pl-6">
            No matching keys
          </div>
        ) : (
          renderRedisTreeNode(tree, 1)
        )}
        {/* Load more / Load all buttons */}
        <div className="flex gap-2 px-2 py-1.5">
          <button
            onClick={() => loadRedisKeys('*', (node.redisKeys?.length ?? 500) + 500)}
            className="flex-1 text-[10px] py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
          >
            Load More
          </button>
          <button
            onClick={() => loadRedisKeys('*', 100000)}
            className="flex-1 text-[10px] py-1 rounded bg-red-600 text-white hover:bg-red-700"
          >
            Load All
          </button>
        </div>
      </div>
    );
  };

  const renderDatabases = () => {
    if (node.isLoadingDatabases) {
      return (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--text-muted)]">
          <Loader2 size={12} className="animate-spin" /> Loading...
        </div>
      );
    }
    if (node.error) {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-red-400">
          <AlertCircle size={12} className="flex-shrink-0" />
          <span className="truncate">{node.error}</span>
        </div>
      );
    }
    const databases = node.databases ?? [];
    if (databases.length === 0) {
      return (
        <div className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
          No databases found
        </div>
      );
    }
    const sq = searchQuery.toLowerCase();
    return databases.map((db) => {
      const allTables = node.tables?.[db.name] ?? [];
      // Filter tables by search query (fuzzy: any substring match)
      const tables = sq
        ? allTables.filter((t) => t.name.toLowerCase().includes(sq))
        : allTables;
      // When searching and there are matching tables, auto-expand the database
      const isDbExpanded = sq
        ? (expandedDbs.has(db.name) || tables.length > 0)
        : expandedDbs.has(db.name);
      const isLoadingTables = node.isLoadingTables?.[db.name];
      const tableError = node.tableErrors?.[db.name];

      return (
        <div key={db.name}>
          <div
            className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-[var(--bg-hover)] group text-xs"
            onClick={() => toggleDb(db.name)}
            onContextMenu={(e) => showDatabaseContextMenu(e, db.name)}
          >
            {isDbExpanded ? (
              <ChevronDown size={12} className="text-[var(--text-muted)]" />
            ) : (
              <ChevronRight size={12} className="text-[var(--text-muted)]" />
            )}
            <Database size={12} className="text-[var(--accent)] flex-shrink-0" />
            <span className="flex-1 truncate">{db.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); handleOpenQuery(db.name); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--bg-primary)] rounded"
            >
              <Code2 size={10} className="text-[var(--text-muted)]" />
            </button>
          </div>

          {isDbExpanded && (
            <div className="pl-4">
              {isLoadingTables ? (
                <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-[var(--text-muted)]">
                  <Loader2 size={10} className="animate-spin" /> Loading...
                </div>
              ) : tableError ? (
                <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-red-400">
                  <AlertCircle size={10} /> {tableError}
                </div>
              ) : tables.length === 0 ? (
                <div className="px-2 py-1 text-xs text-[var(--text-muted)]">
                  {sq ? 'No matching tables' : isMongo ? 'No collections' : 'No tables'}
                </div>
              ) : (
                tables.map((table) => {
                  const tableKey = `${db.name}::${table.name}`;
                  const isTableExpanded = expandedTables.has(tableKey);
                  const showChildren = !isMongo && table.tableType !== 'View';
                  return (
                    <div key={table.name}>
                      <div
                        className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-[var(--bg-hover)] text-xs group"
                        onClick={() => handleTableClick(db.name, table)}
                        onDoubleClick={() => handleTableDoubleClick(db.name, table)}
                        onContextMenu={(e) => showTableContextMenu(e, db.name, table)}
                      >
                        {showChildren ? (
                          isTableExpanded
                            ? <ChevronDown size={11} className="text-[var(--text-muted)] flex-shrink-0" />
                            : <ChevronRight size={11} className="text-[var(--text-muted)] flex-shrink-0" />
                        ) : (
                          <span className="w-[11px] flex-shrink-0" />
                        )}
                        {isMongo ? (
                          <FolderOpen size={11} className="text-green-400 flex-shrink-0" />
                        ) : table.tableType === 'View' ? (
                          <Eye size={11} className="text-purple-400 flex-shrink-0" />
                        ) : (
                          <Table2 size={11} className="text-blue-400 flex-shrink-0" />
                        )}
                        <span className="flex-1 truncate text-[var(--text-primary)]">
                          {table.name}
                        </span>
                      </div>
                      {/* Table sub-items */}
                      {showChildren && isTableExpanded && (
                        <div className="pl-3">
                          {/* Data sub-item */}
                          <div
                            className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-[var(--bg-hover)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            onClick={() => handleTableDoubleClick(db.name, table)}
                          >
                            <span className="w-[11px] flex-shrink-0" />
                            <Table2 size={10} className="text-green-400 flex-shrink-0" />
                            <span>Data</span>
                          </div>
                          {/* Columns — expandable with column list */}
                          {(() => {
                            const colChildKey = `${db.name}::${table.name}::columns`;
                            const isColExpanded = expandedTableChildren.has(colChildKey);
                            const colCacheKey = `${db.name}::${table.name}`;
                            const cachedCols = node.columns?.[colCacheKey];
                            const isLoadingCols = node.isLoadingColumns?.[colCacheKey];
                            return (
                              <div>
                                <div
                                  className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-[var(--bg-hover)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                  onClick={() => toggleTableChild(db.name, table.name, 'columns')}
                                >
                                  {isColExpanded
                                    ? <ChevronDown size={11} className="text-[var(--text-muted)] flex-shrink-0" />
                                    : <ChevronRight size={11} className="text-[var(--text-muted)] flex-shrink-0" />}
                                  <Columns size={10} className="text-orange-400 flex-shrink-0" />
                                  <span>Columns</span>
                                  {cachedCols && <span className="text-[9px] opacity-50 ml-1">({cachedCols.length})</span>}
                                </div>
                                {isColExpanded && (
                                  <div className="pl-5">
                                    {isLoadingCols ? (
                                      <div className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                                        <Loader2 size={9} className="animate-spin" /> Loading...
                                      </div>
                                    ) : cachedCols ? (
                                      cachedCols.map((col) => (
                                        <div
                                          key={col.name}
                                          className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-[var(--bg-hover)] text-[11px]"
                                          onClick={() => handleColumnClick(db.name, table.name, col.name)}
                                          title={`${col.name} (${col.columnType})${col.isPrimaryKey ? ' PK' : ''}${col.comment ? ' — ' + col.comment : ''}`}
                                        >
                                          {col.isPrimaryKey
                                            ? <Key size={9} className="text-yellow-400 flex-shrink-0" />
                                            : <span className="w-[9px] h-[9px] rounded-sm flex-shrink-0 text-[7px] font-bold text-center leading-[9px]"
                                                style={{ color: col.dataType?.match(/int|decimal|numeric|float|double/i) ? '#60a5fa' : col.dataType?.match(/date|time/i) ? '#a78bfa' : '#94a3b8' }}>
                                                {col.dataType?.match(/int|bigint|decimal|numeric|float|double/i) ? '#' : col.dataType?.match(/date|time/i) ? '◷' : 'A'}
                                              </span>}
                                          <span className={`truncate ${col.isPrimaryKey ? 'text-yellow-400' : 'text-[var(--text-primary)]'}`}>
                                            {col.name}
                                          </span>
                                          <span className="text-[9px] text-[var(--text-muted)] opacity-60 truncate ml-auto">
                                            {col.columnType}
                                          </span>
                                        </div>
                                      ))
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {/* Indexes, DDL */}
                          {TABLE_CHILDREN.filter(c => c.id !== 'columns').map(({ id, label, icon: Icon, tab }) => (
                            <div
                              key={id}
                              className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer hover:bg-[var(--bg-hover)] text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              onClick={() => handleTableChildClick(db.name, table.name, tab)}
                            >
                              <span className="w-[11px] flex-shrink-0" />
                              <Icon size={10} className="text-orange-400 flex-shrink-0" />
                              <span>{label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div>
      {ConfirmDialogElement}
      {/* Connection row */}
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)] group text-sm',
          expanded && 'bg-[var(--bg-hover)]'
        )}
        style={{ borderLeft: connection.color ? `3px solid ${connection.color}` : '3px solid transparent' }}
        onContextMenu={showConnectionContextMenu}
      >
        <button
          onClick={() => {
            if (isConnected) setExpanded((e) => !e);
            else handleToggleConnection();
          }}
          className="flex-shrink-0 text-[var(--text-muted)]"
        >
          {isConnected && expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        <span className="flex-shrink-0">
          <DbTypeIcon dbType={connection.dbType} size={16} />
        </span>

        <span
          className="flex-1 truncate text-[var(--text-primary)] text-xs font-medium"
          onClick={() => {
            if (isConnected) setExpanded((e) => !e);
            else handleToggleConnection();
          }}
        >
          {connection.name}
        </span>

        <button
          onClick={handleToggleConnection}
          title={getStatusTooltip()}
          className="flex-shrink-0 flex items-center"
        >
          {statusDot()}
        </button>

        {isConnected && !isRedis && (
          <button
            onClick={() => handleOpenQuery(connection.database ?? '')}
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 hover:bg-[var(--bg-primary)] rounded"
            title="New query"
          >
            <Code2 size={11} className="text-[var(--text-muted)]" />
          </button>
        )}
      </div>

      {/* Tree content */}
      {isConnected && expanded && (
        <div className="pl-4">
          {isRedis ? renderRedisKeys() : renderDatabases()}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
