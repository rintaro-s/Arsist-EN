import React from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useProjectStore } from '../../stores/projectStore';
import { SceneViewport } from './SceneViewport';
import { UICanvas } from './UICanvas';
import { CodeEditor } from './CodeEditor';

export function ViewportContainer() {
  const { currentView, uiEditMode } = useUIStore();
  const { project } = useProjectStore();
  const uiAuthoringMode = project?.uiAuthoring?.mode || 'hybrid';

  return (
    <div className="w-full h-full bg-arsist-bg">
      {currentView === 'scene' && <SceneViewport />}
      {currentView === 'ui' && (
        uiAuthoringMode === 'code'
          ? <CodeOnlyUINotice />
          : uiAuthoringMode === 'visual'
            ? <UICanvas />
            : (uiEditMode === 'visual' ? <UICanvas /> : <UICodeEditor />)
      )}
      {currentView === 'logic' && (
        <div className="w-full h-full flex items-center justify-center text-arsist-muted text-sm">
          ロジックビューは現在無効化されています
        </div>
      )}
      {currentView === 'code' && (
        uiAuthoringMode === 'visual'
          ? <VisualOnlyNotice />
          : <CodeEditor />
      )}
    </div>
  );
}

// UI用コードエディタ（ビジュアルモードと切り替え可能）
function UICodeEditor({ mode }: { mode?: 'code-only' }) {
  return (
    <div className="w-full h-full">
      {mode === 'code-only' && (
        <div className="h-8 px-3 flex items-center text-xs bg-arsist-hover border-b border-arsist-border text-arsist-warning">
          このプロジェクトはコード専用です。GUI編集は無効です。
        </div>
      )}
      <CodeEditor />
    </div>
  );
}

function VisualOnlyNotice() {
  return (
    <div className="w-full h-full flex items-center justify-center text-arsist-muted text-sm">
      このプロジェクトはビジュアル専用です。コード編集は無効です。
    </div>
  );
}

function CodeOnlyUINotice() {
  return (
    <div className="w-full h-full flex items-center justify-center text-arsist-muted text-sm">
      UI/HUDのGUI編集は無効です。コードタブでHTML/CSS/JSを編集してください。
    </div>
  );
}
