import { invoke } from '@tauri-apps/api/core';
import type { RedisKeyInfo, RedisValue } from '../types';

export const redisApi = {
  listKeys: (connectionId: string, pattern?: string, count?: number) =>
    invoke<RedisKeyInfo[]>('list_keys', { connectionId, pattern, count }),

  getKey: (connectionId: string, key: string) =>
    invoke<RedisValue>('get_key', { connectionId, key }),

  setKey: (connectionId: string, key: string, value: string) =>
    invoke<void>('set_key', { connectionId, key, value }),

  deleteKey: (connectionId: string, key: string) =>
    invoke<number>('delete_key', { connectionId, key }),

  getKeyTtl: (connectionId: string, key: string) =>
    invoke<number>('get_key_ttl', { connectionId, key }),

  setKeyTtl: (connectionId: string, key: string, ttlSecs: number) =>
    invoke<void>('set_key_ttl', { connectionId, key, ttlSecs }),

  getServerInfo: (connectionId: string) =>
    invoke<unknown>('get_server_info', { connectionId }),

  executeRedisCommand: (connectionId: string, args: string[]) =>
    invoke<unknown>('execute_redis_command', { connectionId, args }),
};
