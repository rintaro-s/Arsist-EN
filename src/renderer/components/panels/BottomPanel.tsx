import React, { useEffect, useMemo, useState } from 'react';
import { Terminal, AlertCircle, FileText, Upload, RefreshCw, Plus, Package } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useProjectStore } from '../../stores/projectStore';

type TabType = 'console' | 'assets' | 'build';

export function BottomPanel() {
  const [activeTab, setActiveTab] = useState<TabType>('console');
  const { buildLogs, buildProgress, buildMessage, isBuilding } = useUIStore();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center border-b border-arsist-border bg-arsist-hover">
        <Tab
          icon={<Terminal size={14} />}
          label="コンソール"
          active={activeTab === 'console'}
          onClick={() => setActiveTab('console')}
        />
        <Tab
          icon={<Package size={14} />}
          label="アセット"
          active={activeTab === 'assets'}
          onClick={() => setActiveTab('assets')}
        />
        <Tab
          icon={<FileText size={14} />}
          label="ビルドログ"
          active={activeTab === 'build'}
          onClick={() => setActiveTab('build')}
          badge={isBuilding ? '...' : undefined}
        />

        {/* Build Progress */}
        {isBuilding && (
          <div className="ml-auto mr-4 flex items-center gap-2 text-sm">
            <div className="w-32 h-2 bg-arsist-bg rounded-full overflow-hidden">
              <div 
                className="h-full bg-arsist-accent transition-all duration-300"
                style={{ width: `${buildProgress}%` }}
              />
            </div>
            <span className="text-arsist-muted text-xs">{buildMessage}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'console' && <ConsolePanel />}
        {activeTab === 'assets' && <AssetsPanel />}
        {activeTab === 'build' && <BuildLogPanel logs={buildLogs} />}
      </div>
    </div>
  );
}

interface TabProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
}

function Tab({ icon, label, active, onClick, badge }: TabProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-xs border-b-2 transition-colors ${
        active
          ? 'border-arsist-accent text-arsist-text bg-arsist-surface'
          : 'border-transparent text-arsist-muted hover:text-arsist-text hover:bg-arsist-hover'
      }`}
    >
      {icon}
      {label}
      {badge && (
        <span className="px-1.5 py-0.5 bg-arsist-accent text-white text-[10px] rounded">
          {badge}
        </span>
      )}
    </button>
  );
}

function ConsolePanel() {
  const { consoleLogs, clearConsoleLogs } = useUIStore();

  return (
    <div className="h-full overflow-y-auto p-2 font-mono text-xs">
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="text-[10px] text-arsist-muted">アプリ内ログ</div>
        <button onClick={() => clearConsoleLogs()} className="btn btn-ghost text-[10px]">クリア</button>
      </div>

      {consoleLogs.map((log, index) => (
        <div 
          key={index}
          className={`flex items-start gap-2 py-1 ${
            log.type === 'error' ? 'text-red-400' :
            log.type === 'warning' ? 'text-yellow-400' :
            'text-arsist-muted'
          }`}
        >
          <span className="text-arsist-muted">[{log.time}]</span>
          {log.type === 'error' && <AlertCircle size={12} className="mt-0.5" />}
          <span>{log.message}</span>
        </div>
      ))}
      {consoleLogs.length === 0 && (
        <div className="text-center py-4 text-arsist-muted">
          ログはありません
        </div>
      )}
    </div>
  );
}

type AssetItem = {
  relPath: string;
  name: string;
  kind: 'model' | 'texture' | 'video' | 'other' | 'dir';
  size?: number;
  modifiedTime?: number;
};

function AssetsPanel() {
  const { project, projectPath, addObject } = useProjectStore();
  const { addNotification } = useUIStore();
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!window.electronAPI || !projectPath) return;
    setLoading(true);
    try {
      const api: any = window.electronAPI as any;
      if (typeof api?.assets?.list !== 'function') {
        addNotification({
          type: 'error',
          message: 'assets.list が利用できません（Electronのpreloadが古い/再起動が必要な可能性があります）',
        });
        return;
      }

      const result = await api.assets.list({ projectPath });
      if (result?.success) {
        setItems(result.items || []);
      } else {
        addNotification({ type: 'error', message: result?.error || 'アセット一覧の取得に失敗しました' });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [projectPath]);

  const files = useMemo(() => items.filter((i) => i.kind !== 'dir'), [items]);

  const handleImport = async () => {
    if (!window.electronAPI || !projectPath) return;

    const api: any = window.electronAPI as any;
    if (typeof api?.assets?.import !== 'function') {
      addNotification({
        type: 'error',
        message: 'assets.import が利用できません（Electronのpreloadが古い/再起動が必要な可能性があります）',
      });
      return;
    }

    const sourcePath = await window.electronAPI.fs.selectFile([
      { name: 'GLB', extensions: ['glb', 'GLB'] },
      { name: 'GLTF', extensions: ['gltf', 'GLTF'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'PNG', 'JPG', 'JPEG', 'WEBP', 'GIF'] },
      { name: 'Video', extensions: ['mp4', 'webm', 'mov', 'MP4', 'WEBM', 'MOV'] },
    ]);
    if (!sourcePath) return;

    const res = await api.assets.import({ projectPath, sourcePath });
    if (!res.success) {
      addNotification({ type: 'error', message: res.error || 'インポートに失敗しました' });
      return;
    }
    addNotification({ type: 'success', message: `インポートしました: ${res.assetPath}` });
    await refresh();
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-arsist-muted">プロジェクト Assets</div>
        <div className="flex items-center gap-2">
          <button onClick={handleImport} className="btn btn-secondary text-xs" disabled={!projectPath}>
            <Upload size={14} />
            インポート
          </button>
          <button onClick={refresh} className="btn btn-ghost text-xs" disabled={loading || !projectPath}>
            <RefreshCw size={14} />
            更新
          </button>
        </div>
      </div>

      {files.length > 0 ? (
        <div className="space-y-2">
          {files.map((item) => (
            <div key={item.relPath} className="flex items-center justify-between gap-3 p-2 bg-arsist-bg border border-arsist-border rounded">
              <div className="min-w-0">
                <div className="text-xs text-arsist-text truncate">{item.name}</div>
                <div className="text-[10px] text-arsist-muted truncate">{item.relPath}</div>
              </div>
              <div className="flex items-center gap-2">
                {(item.kind === 'model') && (
                  <button
                    className="btn btn-secondary text-[10px]"
                    title="現在のシーンに配置"
                    onClick={() => {
                      addObject({
                        type: 'model',
                        name: item.name,
                        modelPath: item.relPath,
                      });
                      addNotification({ type: 'success', message: `シーンに追加しました: ${item.name}` });
                    }}
                  >
                    <Plus size={12} />
                    シーンに追加
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-arsist-muted text-xs">
          {projectPath ? 'アセットがありません（インポートしてください）' : 'プロジェクトを開いてください'}
        </div>
      )}

      {!project && (
        <div className="text-center py-8 text-arsist-muted text-xs">
          プロジェクトを開いてください
        </div>
      )}
    </div>
  );
}

interface BuildLogPanelProps {
  logs: string[];
}

function BuildLogPanel({ logs }: BuildLogPanelProps) {
  return (
    <div className="h-full overflow-y-auto p-2 font-mono text-xs bg-arsist-bg">
      {logs.map((log, index) => (
        <div 
          key={index}
          className={`py-0.5 ${
            log.includes('Error') ? 'text-arsist-error' :
            log.includes('Warning') ? 'text-arsist-warning' :
            log.includes('[Arsist]') ? 'text-arsist-accent' :
            'text-arsist-muted'
          }`}
        >
          {log}
        </div>
      ))}
      {logs.length === 0 && (
        <div className="text-center py-4 text-arsist-muted text-xs">
          ビルドログはありません
        </div>
      )}
    </div>
  );
}
