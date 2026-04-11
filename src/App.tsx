import { useEffect } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useConnectionStore, useThemeStore } from './stores';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { MainArea } from './components/MainArea';
import { StatusBar } from './components/StatusBar';

export default function App() {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const setTheme = useThemeStore((s) => s.setTheme);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    loadConnections();
    setTheme(theme);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <PanelGroup direction="horizontal" autoSaveId="main-layout">
          <Panel defaultSize={20} minSize={12} maxSize={40}>
            <Sidebar />
          </Panel>
          <PanelResizeHandle className="w-px bg-[var(--border)] hover:bg-[var(--accent)] transition-colors cursor-col-resize" />
          <Panel defaultSize={80} minSize={40}>
            <MainArea />
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar />
    </div>
  );
}
