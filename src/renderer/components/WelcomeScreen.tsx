import { useEffect, useState } from 'react';
import { Plus, FolderOpen, Glasses, Settings2 } from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { useT } from '../i18n';

interface WelcomeScreenProps {
  onNewProject: () => void;
}

export function WelcomeScreen({ onNewProject }: WelcomeScreenProps) {
  const t = useT();
  const loadProject = useProjectStore((s) => s.loadProject);
  const setShowSetupWizard = useUIStore((s) => s.setShowSetupWizard);
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
            {t('welcome.subtitle')}
          </p>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={onNewProject}
            className="p-5 bg-arsist-surface rounded-lg ring-1 ring-transparent hover:ring-arsist-accent/60 transition-all text-left group"
          >
            <div className="w-10 h-10 bg-arsist-accent/20 rounded-lg flex items-center justify-center mb-3 group-hover:bg-arsist-accent/30 transition-colors">
              <Plus size={20} className="text-arsist-accent" />
            </div>
            <h3 className="font-medium mb-1">{t('welcome.newProject')}</h3>
            <p className="text-xs text-arsist-muted">
              {t('welcome.newProjectDesc')}
            </p>
          </button>

          <button
            onClick={handleOpenProject}
            className="p-5 bg-arsist-surface rounded-lg ring-1 ring-transparent hover:ring-arsist-accent/60 transition-all text-left group"
          >
            <div className="w-10 h-10 bg-arsist-hover rounded-lg flex items-center justify-center mb-3 group-hover:bg-arsist-active transition-colors">
              <FolderOpen size={20} className="text-arsist-muted" />
            </div>
            <h3 className="font-medium mb-1">{t('welcome.openProject')}</h3>
            <p className="text-xs text-arsist-muted">
              {t('welcome.openProjectDesc')}
            </p>
          </button>
        </div>

        {recent.length > 0 && (
          <div className="mb-6">
            <h4 className="text-xs font-medium text-arsist-muted mb-2">{t('welcome.recentProjects')}</h4>
            <div className="space-y-2">
              {recent.map((p) => (
                <button
                  key={p}
                  onClick={() => handleOpenRecent(p)}
                  className="w-full p-3 bg-arsist-hover/60 rounded-lg ring-1 ring-transparent hover:ring-arsist-accent/60 transition-all text-left"
                  title={p}
                >
                  <div className="text-xs text-arsist-text truncate">{p.split('/').pop() || p}</div>
                  <div className="text-[10px] text-arsist-muted truncate">{p}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Setup Wizard CTA */}
        <div className="mb-6">
          <button
            onClick={() => setShowSetupWizard(true)}
            className="w-full p-6 bg-arsist-accent/10 rounded-lg hover:bg-arsist-accent/20 transition-all group"
          >
            <div className="flex items-center gap-3 justify-center">
              <Settings2 size={24} className="text-arsist-accent group-hover:scale-110 transition-transform" />
              <div className="text-left">
                <h3 className="font-semibold text-arsist-accent mb-0.5">{t('welcome.setupWizard')}</h3>
                <p className="text-xs text-arsist-muted">{t('welcome.setupWizardDesc')}</p>
              </div>
            </div>
          </button>
        </div>

        {/* Quick Start Hint */}
        <div className="text-center">
          <p className="text-xs text-arsist-muted">
            <span className="kbd">Ctrl+N</span> {t('welcome.quickNew')} · <span className="kbd">Ctrl+O</span> {t('welcome.quickOpen')} · <span className="kbd">Ctrl+,</span> {t('welcome.quickSettings')}
          </p>
        </div>
      </div>
    </div>
  );
}
