import React from 'react';
import { 
  Box, 
  Layout, 
  Move, 
  RotateCw, 
  Maximize2,
  Grid3X3,
  Axis3D,
  Magnet,
  Settings,
  Download,
  Code,
  MousePointer,
  Save,
  FolderOpen,
  Plus
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
    uiEditMode,
    setUIEditMode
  } = useUIStore();
  
  const { project, saveProject, isDirty, loadProject } = useProjectStore();
  const appType = project?.appType;
  const trackingMode = project?.arSettings?.trackingMode;
  const presentationMode = project?.arSettings?.presentationMode;
  const showSceneTab = appType !== '2D_HeadLocked';
  const showCodeTab = project?.uiAuthoring?.mode !== 'visual';

  const handleOpenProject = async () => {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.fs.selectDirectory();
    if (path) {
      await loadProject(path);
    }
  };

  return (
    <div className="h-12 bg-arsist-surface border-b border-arsist-border flex items-center justify-between px-2">
      {/* Left: Project actions + View Tabs */}
      <div className="flex items-center gap-2">
        {/* プロジェクト操作 */}
        <div className="flex items-center gap-1 pr-2 border-r border-arsist-border">
          <button
            onClick={() => setShowNewProjectDialog(true)}
            className="btn-icon"
            title="新規プロジェクト"
          >
            <Plus size={18} />
          </button>
          <button
            onClick={handleOpenProject}
            className="btn-icon"
            title="プロジェクトを開く"
          >
            <FolderOpen size={18} />
          </button>
          {isDirty && (
            <button
              onClick={() => saveProject()}
              className="btn-icon text-arsist-warning"
              title="保存 (Ctrl+S)"
            >
              <Save size={18} />
            </button>
          )}
        </div>

        {/* ビュータブ */}
        {showSceneTab && (
          <ViewTab
            icon={<Box size={16} />}
            label="3Dシーン"
            active={currentView === 'scene'}
            onClick={() => setCurrentView('scene')}
            shortcut="1"
            tooltip="現実世界に配置する3Dオブジェクト"
          />
        )}
        <ViewTab
          icon={<Layout size={16} />}
          label="UI/HUD"
          active={currentView === 'ui'}
          tooltip="視界に固定されるUI要素"
          onClick={() => setCurrentView('ui')}
          shortcut="2"
        />
        {/* ロジックビューは現在無効化 */}
        {showCodeTab && (
          <ViewTab
            icon={<Code size={16} />}
            label="コード"
            active={currentView === 'code'}
            onClick={() => setCurrentView('code')}
            shortcut="4"
          />
        )}
      </div>

      {/* Center: Context-sensitive tools */}
      <div className="flex items-center gap-2">
        {/* ARモードと3D/UI関係の説明 */}
        {trackingMode && (
          <div className="flex items-center gap-2">
            <div className="text-[10px] text-arsist-muted bg-arsist-bg border border-arsist-border rounded px-2 py-1">
              {trackingMode.toUpperCase()} / {presentationMode?.replace('_', ' ')}
            </div>
            <div className="text-[10px] text-arsist-muted">
              {currentView === 'scene' && '← 3D: 現実世界に配置'}
              {currentView === 'ui' && '← UI: 視界に固定表示'}
              {currentView === 'code' && '← コード: 直接編集'}
            </div>
          </div>
        )}
        {/* 3Dシーンツール */}
        {currentView === 'scene' && (
          <>
            <div className="flex items-center bg-arsist-bg rounded p-0.5 gap-0.5">
              <ToolButton
                icon={<Move size={16} />}
                active={transformMode === 'translate'}
                onClick={() => setTransformMode('translate')}
                tooltip="移動 (W)"
              />
              <ToolButton
                icon={<RotateCw size={16} />}
                active={transformMode === 'rotate'}
                onClick={() => setTransformMode('rotate')}
                tooltip="回転 (E)"
              />
              <ToolButton
                icon={<Maximize2 size={16} />}
                active={transformMode === 'scale'}
                onClick={() => setTransformMode('scale')}
                tooltip="スケール (R)"
              />
            </div>

            <div className="w-px h-6 bg-arsist-border" />

            <div className="flex items-center bg-arsist-bg rounded p-0.5 gap-0.5">
              <ToolButton
                icon={<Grid3X3 size={16} />}
                active={showGrid}
                onClick={() => setShowGrid(!showGrid)}
                tooltip="グリッド表示 (G)"
              />
              <ToolButton
                icon={<Axis3D size={16} />}
                active={showAxes}
                onClick={() => setShowAxes(!showAxes)}
                tooltip="軸表示"
              />
              <ToolButton
                icon={<Magnet size={16} />}
                active={snapToGrid}
                onClick={() => setSnapToGrid(!snapToGrid)}
                tooltip="スナップ"
              />
            </div>
          </>
        )}

        {/* UIデザインツール */}
        {currentView === 'ui' && project?.uiAuthoring?.mode === 'hybrid' && (
          <div className="flex items-center bg-arsist-bg rounded p-0.5 gap-0.5">
            <ToolButton
              icon={<MousePointer size={16} />}
              active={uiEditMode === 'visual'}
              onClick={() => setUIEditMode('visual')}
              tooltip="ビジュアル編集"
            />
            <ToolButton
              icon={<Code size={16} />}
              active={uiEditMode === 'code'}
              onClick={() => setUIEditMode('code')}
              tooltip="コード編集 (HTML/CSS)"
            />
          </div>
        )}

        {/* コードビュー説明 */}
        {currentView === 'code' && (
          <div className="text-xs text-arsist-muted flex items-center gap-2">
            <Code size={14} />
            <span>HTML/CSS/JSでUI・ロジックを直接編集</span>
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowSettingsDialog(true)}
          className="btn-icon"
          title="設定"
        >
          <Settings size={18} />
        </button>
        
        <button
          onClick={() => setShowBuildDialog(true)}
          className="btn btn-success text-sm h-8"
          disabled={!project}
        >
          <Download size={16} />
          <span>ビルド</span>
        </button>
      </div>
    </div>
  );
}

interface ViewTabProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  shortcut?: string;
  tooltip?: string;
}

function ViewTab({ icon, label, active, onClick, shortcut, tooltip }: ViewTabProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors text-sm ${
        active 
          ? 'bg-arsist-active text-arsist-accent' 
          : 'hover:bg-arsist-hover text-arsist-muted hover:text-arsist-text'
      }`}
      title={tooltip || (shortcut ? `${label} (${shortcut})` : label)}
    >
      {icon}
      <span className="font-medium">{label}</span>
      {shortcut && (
        <span className="kbd text-[10px] ml-1">{shortcut}</span>
      )}
    </button>
  );
}

interface ToolButtonProps {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  tooltip: string;
}

function ToolButton({ icon, active, onClick, tooltip }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        active 
          ? 'bg-arsist-accent/20 text-arsist-accent' 
          : 'hover:bg-arsist-hover text-arsist-muted hover:text-arsist-text'
      }`}
      title={tooltip}
    >
      {icon}
    </button>
  );
}
