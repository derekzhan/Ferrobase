import { useTabStore } from '../stores';
import { TabBar } from './TabBar';
import { QueryEditorTab } from './QueryEditor/QueryEditorTab';
import { TableViewTab } from './TableView/TableViewTab';
import { RedisKeyViewer } from './RedisViewer/RedisKeyViewer';
import { WelcomeScreen } from './WelcomeScreen';

export function MainArea() {
  const { tabs, activeTabId } = useTabStore();

  if (tabs.length === 0) {
    return <WelcomeScreen />;
  }

  const activeTab = tabs.find((t) => t.data.id === activeTabId);

  return (
    <div className="flex flex-col h-full">
      <TabBar />
      <div className="flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.data.id}
            className={tab.data.id === activeTabId ? 'h-full' : 'hidden'}
          >
            {tab.kind === 'query' ? (
              <QueryEditorTab tab={tab.data} />
            ) : tab.kind === 'table' ? (
              <TableViewTab tab={tab.data} />
            ) : tab.kind === 'redis' ? (
              <RedisKeyViewer tab={tab.data} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
