export type DatabaseType =
  | 'mysql'
  | 'postgres'
  | 'sqlite'
  | 'mongodb'
  | 'redis'
  | 'sqlServer'
  | 'clickhouse';

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  dbType: DatabaseType;
  host: string;
  port: number;
  database?: string;
  username?: string;
  useSsl: boolean;
  useSshTunnel: boolean;
  sshConfig?: SshConfig;
  connectionTimeoutSecs: number;
  queryTimeoutSecs: number;
  color?: string;
  group?: string;
  createdAt: string;
  updatedAt: string;
}

export type ConnectionStatus = 'Connected' | 'Disconnected' | 'Connecting' | { Error: string };

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: Array<Array<unknown>>;
  rowCount: number;
  affectedRows: number;
  executionTimeMs: number;
  query: string;
}

export interface DatabaseInfo {
  name: string;
  sizeBytes?: number;
  charset?: string;
  collation?: string;
}

export interface SchemaInfo {
  name: string;
  owner?: string;
}

export interface TableInfo {
  name: string;
  schema?: string;
  rowCount?: number;
  sizeBytes?: number;
  comment?: string;
  tableType: 'Table' | 'View' | 'MaterializedView' | 'SystemTable';
}

export interface ColumnDetail {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  defaultValue?: string;
  comment?: string;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  ordinalPosition: number;
  /** Raw MySQL key indicator: "PRI", "UNI", "MUL", or "" */
  keyType: string;
  /** Extra info: "auto_increment", "on update CURRENT_TIMESTAMP", etc. */
  extra: string;
  charMaxLength?: number;
  numericPrecision?: number;
  numericScale?: number;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  indexType: string;
}

export interface QueryHistoryEntry {
  id: string;
  connectionId: string;
  database?: string;
  query: string;
  executedAt: string;
  executionTimeMs: number;
  rowCount: number;
  hadError: boolean;
  errorMessage?: string;
}

export type ExportFormat = 'Csv' | 'Json' | 'Xlsx' | 'SqlInsert';

export interface ExportOptions {
  format: ExportFormat;
  filePath: string;
  includeHeaders: boolean;
  tableName?: string;
}

export interface RedisKeyInfo {
  key: string;
  keyType: string;
  ttl: number;
  encoding?: string;
}

export type RedisValue =
  | { type: 'String'; value: string }
  | { type: 'List'; value: string[] }
  | { type: 'Set'; value: string[] }
  | { type: 'ZSet'; value: [string, number][] }
  | { type: 'Hash'; value: [string, string][] }
  | { type: 'Stream'; value: unknown[] }
  | { type: 'None' };

// Tree node types for database browser
export type TreeNodeType =
  | 'connection'
  | 'database'
  | 'schema'
  | 'tables-folder'
  | 'views-folder'
  | 'procedures-folder'
  | 'table'
  | 'view'
  | 'procedure'
  | 'collection'
  | 'redis-keys';

export interface TreeNode {
  id: string;
  label: string;
  type: TreeNodeType;
  connectionId: string;
  database?: string;
  schema?: string;
  icon?: string;
  color?: string;
  children?: TreeNode[];
  isLoading?: boolean;
  isLoaded?: boolean;
  hasChildren?: boolean;
}

// Tab types
export interface QueryTab {
  id: string;
  title: string;
  connectionId?: string;
  database?: string;
  schema?: string;
  sql: string;
  results: QueryResult[];
  isExecuting: boolean;
  activeResultTab: 'results' | 'messages' | 'history';
  filePath?: string;
  isDirty: boolean;
  error?: string;
}

export interface TableTab {
  id: string;
  title: string;
  connectionId: string;
  database: string;
  schema?: string;
  tableName: string;
  activeTab: 'columns' | 'indexes' | 'ddl' | 'data';
  selectedColumn?: string;
}

export interface RedisTab {
  id: string;
  title: string;
  connectionId: string;
  database: string; // DB index e.g. "0"
  redisKey: string;
}

export type Tab =
  | { kind: 'query'; data: QueryTab }
  | { kind: 'table'; data: TableTab }
  | { kind: 'redis'; data: RedisTab };

export const DB_TYPE_LABELS: Record<DatabaseType, string> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
  redis: 'Redis',
  sqlServer: 'SQL Server',
  clickhouse: 'ClickHouse',
};

export const DB_DEFAULT_PORTS: Record<DatabaseType, number> = {
  mysql: 3306,
  postgres: 5432,
  sqlite: 0,
  mongodb: 27017,
  redis: 6379,
  sqlServer: 1433,
  clickhouse: 8123,
};
