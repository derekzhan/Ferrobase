import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AppSettings {
  // Appearance
  editorFontSize: number;
  editorFontFamily: string;
  // Data grid
  nullDisplay: 'NULL' | '(null)' | '—' | '';
  boolDisplay: 'true/false' | '1/0' | 'YES/NO';
  maxDecimalPlaces: number;
  // Query editor
  defaultQueryLimit: number;
  queryTimeoutSecs: number;
  autoFormatOnPaste: boolean;
  // Data
  dateFormat: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  editorFontSize: 13,
  editorFontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  nullDisplay: 'NULL',
  boolDisplay: 'true/false',
  maxDecimalPlaces: 6,
  defaultQueryLimit: 1000,
  queryTimeoutSecs: 60,
  autoFormatOnPaste: false,
  dateFormat: 'YYYY-MM-DD HH:mm:ss',
};

interface SettingsStore {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      updateSettings: (partial) =>
        set((state) => ({ settings: { ...state.settings, ...partial } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    { name: 'ferrobase-settings' }
  )
);
