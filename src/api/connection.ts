import { invoke } from '@tauri-apps/api/core';
import type {
  ConnectionConfig,
  ConnectionStatus,
  DatabaseType,
  SshConfig,
} from '../types';

export interface CreateConnectionInput {
  name: string;
  dbType: DatabaseType;
  host: string;
  port: number;
  database?: string;
  username?: string;
  password?: string;
  useSsl: boolean;
  useSshTunnel: boolean;
  sshConfig?: SshConfig;
  connectionTimeoutSecs?: number;
  queryTimeoutSecs?: number;
  color?: string;
  group?: string;
}

export const connectionApi = {
  createConnection: (input: CreateConnectionInput) =>
    invoke<ConnectionConfig>('create_connection', { input }),

  updateConnection: (id: string, input: CreateConnectionInput) =>
    invoke<ConnectionConfig>('update_connection', { id, input }),

  deleteConnection: (id: string) =>
    invoke<void>('delete_connection', { id }),

  listConnections: () =>
    invoke<ConnectionConfig[]>('list_connections'),

  testConnection: (input: CreateConnectionInput) =>
    invoke<void>('test_connection', { input }),

  connect: (id: string) =>
    invoke<void>('connect', { id }),

  disconnect: (id: string) =>
    invoke<void>('disconnect', { id }),

  getConnectionStatus: (id: string) =>
    invoke<ConnectionStatus>('get_connection_status', { id }),

  cloneConnection: (connectionId: string) =>
    invoke<ConnectionConfig>('clone_connection', { connectionId }),
};
