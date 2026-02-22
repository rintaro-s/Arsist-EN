import {
  Box,
  Layout,
  Database,
  Move,
  RotateCw,
  Maximize2,
  Grid3X3,
  Axis3D,
  Magnet,
  Settings,
  Download,
  Eye,
  Save,
  FolderOpen,
  Plus,
  Server,
  Zap,
} from 'lucide-react';
import { useUIStore } from '../stores/uiStore';
import { useProjectStore } from '../stores/projectStore';

export function Toolbar() {
  const {
    currentView,
    setCurrentView,
    transformMode,
    setTransformMode,
    showGrid,
    setShowGrid,
    showAxes,
    setShowAxes,
    snapToGrid,
    setSnapToGrid,
    setShowBuildDialog,
    setShowSettingsDialog,
    setShowNewProjectDialog,
    setShowPreviewDialog,
    setShowMCPDialog,
  } = useUIStore();

  const { project, saveProject, isDirty, loadProject } = useProjectStore();
  const showSceneTab = project?.appType !== 'head_locked_hud';

  const handleOpenProject = async () => {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.fs.selectDirectory();
    if (path) await loadProject(path);
  };

  return (
    <div className="h-11 bg-arsist-surface border-b border-arsist-border flex items-center justify-between px-2 select-none">
      {/* Left: Project + View tabs */}
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-0.5 pr-2 border-r border-arsist-border">
          <IconBtn icon={<Plus size={16} />} tip="新規プロジェクト" onClick={() => setShowNewProjectDialog(true)} />
          <IconBtn icon={<FolderOpen size={16} />} tip="プロジェクトを開く" onClick={handleOpenProject} />
          {isDirty && (
            <IconBtn icon={<Save size={16} />} tip="保存" className="text-arsist-warning" onClick={() => saveProject()} />
          )}
        </div>

        <div className="flex items-center gap-0.5 ml-1">
          {showSceneTab && (
            <ViewTab
              icon={<Box size={15} />}
              label="Scene"
              active={currentView === 'scene'}
              onClick={() => setCurrentView('scene')}
            />
          )}
          <ViewTab
            icon={<Layout size={15} />}
            label="UI"
            active={currentView === 'ui'}
            onClick={() => setCurrentView('ui')}
          />
          <ViewTab
            icon={<Database size={15} />}
            label="Data"
            active={currentView === 'dataflow'}
            onClick={() => setCurrentView('dataflow')}
          />
          <ViewTab
            icon={<Zap size={15} />}
            label="Script"
            active={currentView === 'script'}
            onClick={() => setCurrentView('script')}
          />
        </div>
      </div>

      {/* Center: Context-sensitive tools */}
      <div className="flex items-center gap-1">
        {currentView === 'scene' && (
          <>
            <div className="flex items-center bg-arsist-bg rounded p-0.5 gap-0.5">
              <ToolBtn icon={<Move size={15} />} active={transformMode === 'translate'} onClick={() => setTransformMode('translate')} tip="移動" />
              <ToolBtn icon={<RotateCw size={15} />} active={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')} tip="回転" />
              <ToolBtn icon={<Maximize2 size={15} />} active={transformMode === 'scale'} onClick={() => setTransformMode('scale')} tip="スケール" />
            </div>
            <div className="w-px h-5 bg-arsist-border" />
            <div className="flex items-center bg-arsist-bg rounded p-0.5 gap-0.5">
              <ToolBtn icon={<Grid3X3 size={15} />} active={showGrid} onClick={() => setShowGrid(!showGrid)} tip="グリッド" />
              <ToolBtn icon={<Axis3D size={15} />} active={showAxes} onClick={() => setShowAxes(!showAxes)} tip="軸" />
              <ToolBtn icon={<Magnet size={15} />} active={snapToGrid} onClick={() => setSnapToGrid(!snapToGrid)} tip="スナップ" />
            </div>
          </>
        )}

        {currentView === 'ui' && (
          <span className="text-[11px] text-arsist-muted">UI要素を左パネルから追加 / キャンバス上で編集</span>
        )}

        {currentView === 'dataflow' && (
          <span className="text-[11px] text-arsist-muted">DataSource → Transform → DataStore</span>
        )}

        {currentView === 'script' && (
          <span className="text-[11px] text-arsist-muted">JavaScript (Jint) • 左パネルからスクリプト追加 / 右パネルでトリガー設定</span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <IconBtn icon={<Server size={16} />} tip="MCP サーバー" onClick={() => setShowMCPDialog(true)} />
        <IconBtn icon={<Eye size={16} />} tip="プレビュー" onClick={() => setShowPreviewDialog(true)} />
        <IconBtn icon={<Settings size={16} />} tip="設定" onClick={() => setShowSettingsDialog(true)} />
        <button
          onClick={() => setShowBuildDialog(true)}
          className="btn btn-success text-xs h-7 px-3"
          disabled={!project}
        >
          <Download size={14} />
          <span>ビルド</span>
        </button>
      </div>
    </div>
  );
}

/* ── sub-components ────────────────────── */

function ViewTab({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
        active
          ? 'bg-arsist-active text-arsist-accent'
          : 'hover:bg-arsist-hover text-arsist-muted hover:text-arsist-text'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ToolBtn({ icon, active, onClick, tip }: {
  icon: React.ReactNode; active: boolean; onClick: () => void; tip: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-1 rounded transition-colors ${
        active ? 'bg-arsist-accent/20 text-arsist-accent' : 'hover:bg-arsist-hover text-arsist-muted'
      }`}
      title={tip}
    >
      {icon}
    </button>
  );
}

function IconBtn({ icon, onClick, tip, className = '' }: {
  icon: React.ReactNode; onClick: () => void; tip: string; className?: string;
}) {
  return (
    <button onClick={onClick} className={`p-1.5 rounded hover:bg-arsist-hover text-arsist-muted hover:text-arsist-text transition-colors ${className}`} title={tip}>
      {icon}
    </button>
  );
}
