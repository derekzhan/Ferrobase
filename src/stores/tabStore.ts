import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid';
import type { Tab, QueryTab, TableTab, RedisTab, QueryResult } from '../types';

interface TabStore {
  tabs: Tab[];
  activeTabId?: string;

  // Actions
  openQueryTab: (params?: Partial<QueryTab>) => string;
  openTableTab: (params: Omit<TableTab, 'id'>) => string;
  openRedisTab: (params: Omit<RedisTab, 'id'>) => string;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToLeft: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string) => void;
  updateQueryTab: (id: string, updates: Partial<QueryTab>) => void;
  updateTableTab: (id: string, updates: Partial<TableTab>) => void;
  setSql: (tabId: string, sql: string) => void;
  setResults: (tabId: string, results: QueryResult[], error?: string) => void;
  setExecuting: (tabId: string, executing: boolean) => void;
}

export const useTabStore = create<TabStore>()(
  immer((set, get) => ({
    tabs: [],
    activeTabId: undefined,

    openQueryTab: (params = {}) => {
      // Dedup: if connectionId + title match an existing tab, activate it
      if (params.connectionId && params.title) {
        const existing = get().tabs.find(
          (t) =>
            t.kind === 'query' &&
            t.data.connectionId === params.connectionId &&
            t.data.title === params.title
        );
        if (existing) {
          set((state) => { state.activeTabId = existing.data.id; });
          return existing.data.id;
        }
      }

      const id = uuidv4();
      const tab: Tab = {
        kind: 'query',
        data: {
          id,
          title: params.title ?? 'Query',
          connectionId: params.connectionId,
          database: params.database,
          schema: params.schema,
          sql: params.sql ?? '',
          results: [],
          isExecuting: false,
          activeResultTab: 'results',
          isDirty: false,
          ...params,
        },
      };
      set((state) => {
        state.tabs.push(tab);
        state.activeTabId = id;
      });
      return id;
    },

    openTableTab: (params) => {
      // Check if already open
      const existing = get().tabs.find(
        (t) =>
          t.kind === 'table' &&
          t.data.connectionId === params.connectionId &&
          t.data.database === params.database &&
          t.data.tableName === params.tableName
      );
      if (existing) {
        set((state) => {
          state.activeTabId = existing.data.id;
          // Update the sub-tab and selectedColumn if provided
          const tab = state.tabs.find((t) => t.kind === 'table' && t.data.id === existing.data.id);
          if (tab && tab.kind === 'table') {
            if (params.activeTab) tab.data.activeTab = params.activeTab;
            if (params.selectedColumn !== undefined) tab.data.selectedColumn = params.selectedColumn;
          }
        });
        return existing.data.id;
      }

      const id = uuidv4();
      const tab: Tab = {
        kind: 'table',
        data: { id, ...params },
      };
      set((state) => {
        state.tabs.push(tab);
        state.activeTabId = id;
      });
      return id;
    },

    openRedisTab: (params) => {
      const existing = get().tabs.find(
        (t) =>
          t.kind === 'redis' &&
          t.data.connectionId === params.connectionId &&
          t.data.redisKey === params.redisKey
      );
      if (existing) {
        set((state) => { state.activeTabId = existing.data.id; });
        return existing.data.id;
      }
      const id = uuidv4();
      const tab: Tab = { kind: 'redis', data: { id, ...params } };
      set((state) => {
        state.tabs.push(tab);
        state.activeTabId = id;
      });
      return id;
    },

    closeTab: (id) => {
      set((state) => {
        const idx = state.tabs.findIndex((t) => t.data.id === id);
        if (idx === -1) return;
        state.tabs.splice(idx, 1);
        if (state.activeTabId === id) {
          state.activeTabId = state.tabs[Math.max(0, idx - 1)]?.data.id;
        }
      });
    },

    closeOtherTabs: (id) => {
      set((state) => {
        state.tabs = state.tabs.filter((t) => t.data.id === id);
        state.activeTabId = id;
      });
    },

    closeTabsToLeft: (id) => {
      set((state) => {
        const idx = state.tabs.findIndex((t) => t.data.id === id);
        if (idx <= 0) return;
        state.tabs.splice(0, idx);
        // If active tab was removed, switch to the target tab
        if (!state.tabs.find((t) => t.data.id === state.activeTabId)) {
          state.activeTabId = id;
        }
      });
    },

    closeTabsToRight: (id) => {
      set((state) => {
        const idx = state.tabs.findIndex((t) => t.data.id === id);
        if (idx === -1 || idx >= state.tabs.length - 1) return;
        state.tabs.splice(idx + 1);
        if (!state.tabs.find((t) => t.data.id === state.activeTabId)) {
          state.activeTabId = id;
        }
      });
    },

    closeAllTabs: () => {
      set((state) => {
        state.tabs = [];
        state.activeTabId = undefined;
      });
    },

    setActiveTab: (id) => {
      set((state) => { state.activeTabId = id; });
    },

    updateQueryTab: (id, updates) => {
      set((state) => {
        const tab = state.tabs.find((t) => t.data.id === id);
        if (tab?.kind === 'query') {
          Object.assign(tab.data, updates);
        }
      });
    },

    updateTableTab: (id, updates) => {
      set((state) => {
        const tab = state.tabs.find((t) => t.data.id === id);
        if (tab?.kind === 'table') {
          Object.assign(tab.data, updates);
        }
      });
    },

    setSql: (tabId, sql) => {
      set((state) => {
        const tab = state.tabs.find((t) => t.data.id === tabId);
        if (tab?.kind === 'query') {
          tab.data.sql = sql;
          tab.data.isDirty = true;
        }
      });
    },

    setResults: (tabId, results, error) => {
      set((state) => {
        const tab = state.tabs.find((t) => t.data.id === tabId);
        if (tab?.kind === 'query') {
          tab.data.results = results;
          tab.data.error = error;
          tab.data.isExecuting = false;
        }
      });
    },

    setExecuting: (tabId, executing) => {
      set((state) => {
        const tab = state.tabs.find((t) => t.data.id === tabId);
        if (tab?.kind === 'query') {
          tab.data.isExecuting = executing;
          if (executing) tab.data.error = undefined;
        }
      });
    },
  }))
);
