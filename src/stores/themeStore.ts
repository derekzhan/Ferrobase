import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light' | 'system';

interface ThemeStore {
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  setTheme: (theme: Theme) => void;
}

function getSystemTheme(): 'dark' | 'light' {
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function applyTheme(resolved: 'dark' | 'light') {
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      resolvedTheme: 'dark',

      setTheme: (theme) => {
        const resolved = theme === 'system' ? getSystemTheme() : theme;
        applyTheme(resolved);
        set({ theme, resolvedTheme: resolved });
      },
    }),
    {
      name: 'ferrobase-theme',
      onRehydrateStorage: () => (state) => {
        if (state) {
          const resolved =
            state.theme === 'system' ? getSystemTheme() : state.theme;
          applyTheme(resolved);
          state.resolvedTheme = resolved;
        }
      },
    }
  )
);
