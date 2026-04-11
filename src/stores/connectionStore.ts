import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ConnectionConfig, ConnectionStatus, TreeNode } from '../types';
import { connectionApi } from '../api';

interface ConnectionStore {
  connections: ConnectionConfig[];
  statuses: Record<string, ConnectionStatus>;
  selectedConnectionId?: string;
  isLoading: boolean;
  error?: string;

  // Actions
  loadConnections: () => Promise<void>;
  createConnection: (input: Parameters<typeof connectionApi.createConnection>[0]) => Promise<ConnectionConfig>;
  updateConnection: (id: string, input: Parameters<typeof connectionApi.createConnection>[0]) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  testConnection: (input: Parameters<typeof connectionApi.testConnection>[0]) => Promise<void>;
  setSelectedConnection: (id?: string) => void;
  updateStatus: (id: string, status: ConnectionStatus) => void;
}

export const useConnectionStore = create<ConnectionStore>()(
  immer((set, get) => ({
    connections: [],
    statuses: {},
    isLoading: false,

    loadConnections: async () => {
      set((state) => { state.isLoading = true; });
      try {
        const connections = await connectionApi.listConnections();
        set((state) => {
          state.connections = connections;
          state.isLoading = false;
        });
      } catch (error) {
        set((state) => {
          state.error = String(error);
          state.isLoading = false;
        });
      }
    },

    createConnection: async (input) => {
      const conn = await connectionApi.createConnection(input);
      set((state) => {
        state.connections.push(conn);
        state.statuses[conn.id] = 'Disconnected';
      });
      return conn;
    },

    updateConnection: async (id, input) => {
      const updated = await connectionApi.updateConnection(id, input);
      set((state) => {
        const idx = state.connections.findIndex((c) => c.id === id);
        if (idx !== -1) state.connections[idx] = updated;
      });
    },

    deleteConnection: async (id) => {
      await connectionApi.deleteConnection(id);
      set((state) => {
        state.connections = state.connections.filter((c) => c.id !== id);
        delete state.statuses[id];
        if (state.selectedConnectionId === id) {
          state.selectedConnectionId = undefined;
        }
      });
    },

    connect: async (id) => {
      set((state) => { state.statuses[id] = 'Connecting'; });
      try {
        await connectionApi.connect(id);
        set((state) => { state.statuses[id] = 'Connected'; });
      } catch (error) {
        set((state) => { state.statuses[id] = { Error: String(error) }; });
        throw error;
      }
    },

    disconnect: async (id) => {
      await connectionApi.disconnect(id);
      set((state) => { state.statuses[id] = 'Disconnected'; });
    },

    testConnection: async (input) => {
      await connectionApi.testConnection(input);
    },

    setSelectedConnection: (id) => {
      set((state) => { state.selectedConnectionId = id; });
    },

    updateStatus: (id, status) => {
      set((state) => { state.statuses[id] = status; });
    },
  }))
);
