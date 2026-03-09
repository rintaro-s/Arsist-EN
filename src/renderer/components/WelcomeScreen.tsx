import { useEffect, useState } from 'react';
import { Plus, FolderOpen, Glasses, Activity, Layout, Box } from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';

interface WelcomeScreenProps {
  onNewProject: () => void;
}

export function WelcomeScreen({ onNewProject }: WelcomeScreenProps) {
  const loadProject = useProjectStore((s) => s.loadProject);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const api: any = (window as any).electronAPI;
        if (typeof api?.store?.get !== 'function') return;
        const list = await api.store.get('recentProjects');
        if (!mounted) return;
        if (Array.isArray(list)) {
          setRecent(list.filter((p) => typeof p === 'string').slice(0, 5));
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleOpenProject = async () => {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.fs.selectDirectory();
    if (path) {
      await loadProject(path);
    }
  };

  const handleOpenRecent = async (projectPath: string) => {
    await loadProject(projectPath);
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-arsist-bg">
      <div className="max-w-2xl w-full px-8">
        {/* Logo and Title */}
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-arsist-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Glasses size={40} className="text-arsist-bg" />
          </div>
          <h1 className="text-3xl font-bold text-arsist-text mb-2">Arsist Engine</h1>
          <p className="text-arsist-muted">
            Cross-Platform Development Engine for AR Glasses
          </p>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={onNewProject}
            className="p-5 bg-arsist-surface rounded-lg border border-arsist-border hover:border-arsist-accent transition-all text-left group"
          >
            <div className="w-10 h-10 bg-arsist-accent/20 rounded-lg flex items-center justify-center mb-3 group-hover:bg-arsist-accent/30 transition-colors">
              <Plus size={20} className="text-arsist-accent" />
            </div>
            <h3 className="font-medium mb-1">New Project</h3>
            <p className="text-xs text-arsist-muted">
              Create a new AR app from template
            </p>
          </button>

          <button
            onClick={handleOpenProject}
            className="p-5 bg-arsist-surface rounded-lg border border-arsist-border hover:border-arsist-accent transition-all text-left group"
          >
            <div className="w-10 h-10 bg-arsist-hover rounded-lg flex items-center justify-center mb-3 group-hover:bg-arsist-active transition-colors">
              <FolderOpen size={20} className="text-arsist-muted" />
            </div>
            <h3 className="font-medium mb-1">Open Project</h3>
            <p className="text-xs text-arsist-muted">
              Load an existing Arsist project
            </p>
          </button>
        </div>

        {recent.length > 0 && (
          <div className="mb-6">
            <h4 className="text-xs font-medium text-arsist-muted mb-2">Recent Projects</h4>
            <div className="space-y-2">
              {recent.map((p) => (
                <button
                  key={p}
                  onClick={() => handleOpenRecent(p)}
                  className="w-full p-3 bg-arsist-surface/50 rounded-lg border border-arsist-border hover:border-arsist-accent transition-all text-left"
                  title={p}
                >
                  <div className="text-xs text-arsist-text truncate">{p.split('/').pop() || p}</div>
                  <div className="text-[10px] text-arsist-muted truncate">{p}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Features */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="p-3 bg-arsist-surface/50 rounded-lg border border-arsist-border text-center">
            <Box size={20} className="text-arsist-primary mx-auto mb-1" />
            <p className="text-xs text-arsist-muted">3D Scene Editing</p>
          </div>
          <div className="p-3 bg-arsist-surface/50 rounded-lg border border-arsist-border text-center">
            <Layout size={20} className="text-arsist-warning mx-auto mb-1" />
            <p className="text-xs text-arsist-muted">UI/HUD Design</p>
          </div>
          <div className="p-3 bg-arsist-surface/50 rounded-lg border border-arsist-border text-center">
            <Activity size={20} className="text-arsist-accent mx-auto mb-1" />
            <p className="text-xs text-arsist-muted">Data Flow</p>
          </div>
        </div>

        {/* Supported Devices */}
        <div className="bg-arsist-surface/50 rounded-lg p-4 border border-arsist-border">
          <h4 className="text-xs font-medium text-arsist-muted mb-3">Supported Devices</h4>
          <div className="flex flex-wrap gap-2">
            {['XREAL One', 'XREAL Air 2', 'Rokid Max', 'VITURE One'].map((device) => (
              <span
                key={device}
                className="px-2 py-1 bg-arsist-hover rounded text-xs"
              >
                {device}
              </span>
            ))}
            <span className="px-2 py-1 bg-arsist-bg rounded text-xs text-arsist-muted">
              + More Coming
            </span>
          </div>
        </div>

        {/* Quick Start Hint */}
        <div className="mt-4 text-center">
          <p className="text-xs text-arsist-muted">
            <span className="kbd">Ctrl+N</span> New | <span className="kbd">Ctrl+O</span> Open | <span className="kbd">Ctrl+,</span> Settings
          </p>
        </div>
      </div>
    </div>
  );
}
