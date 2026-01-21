import { 
  ChevronDown, 
  ChevronRight, 
  Box, 
  Circle, 
  Square,
  Cylinder,
  Lightbulb,
  Camera,
  Plus,
  FolderOpen,
  Layout,
  File,
  HelpCircle
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { useEffect, useRef, useState } from 'react';

export function LeftPanel() {
  const { currentView } = useUIStore();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {currentView === 'scene' && <SceneHierarchy />}
      {currentView === 'ui' && <UIHierarchy />}
      {currentView === 'logic' && <LogicList />}
      {currentView === 'code' && <CodeFileList />}
    </div>
  );
}

function SceneHierarchy() {
  const { project, projectPath, currentSceneId, setCurrentScene, selectedObjectIds, selectObjects, addObject } = useProjectStore();
  const currentScene = project?.scenes.find(s => s.id === currentSceneId);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const addMenuRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isAddMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (addMenuRootRef.current?.contains(target)) return;
      setIsAddMenuOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [isAddMenuOpen]);
  const handleImportModel = async () => {
    if (!window.electronAPI) return;
    const path = await window.electronAPI.fs.selectFile([
      { name: 'GLB/GLTF', extensions: ['glb', 'gltf'] },
    ]);
    if (!path) return;

    let modelPath = path;
    if (projectPath && window.electronAPI.assets?.import) {
      const imported = await window.electronAPI.assets.import({ projectPath, sourcePath: path, kind: 'model' });
      if (imported?.success && imported.assetPath) {
        modelPath = imported.assetPath;
      }
    }

    addObject({
      name: 'ImportedModel',
      type: 'model',
      modelPath,
      transform: {
        position: { x: 0, y: 0, z: 2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    });
  };

  const handleAddObject = (type: string, primitiveType?: string) => {
    addObject({
      name: `New ${type}`,
      type: type as any,
      primitiveType: primitiveType as any,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="panel-header">
        <span className="text-arsist-text">シーン階層</span>
        <div className="relative" ref={addMenuRootRef}>
          <button
            className="btn-icon"
            title="オブジェクト追加"
            onClick={() => setIsAddMenuOpen((v) => !v)}
          >
            <Plus size={16} />
          </button>
          {/* Add Object Dropdown */}
          <div className={`absolute right-0 top-full mt-1 z-50 ${isAddMenuOpen ? 'block' : 'hidden'}`}>
            <div className="context-menu">
              <button 
                onClick={async () => {
                  setIsAddMenuOpen(false);
                  await handleImportModel();
                }}
                className="context-menu-item w-full"
              >
                <FolderOpen size={16} /> Import GLB/GLTF
              </button>
              <div className="context-menu-separator" />
              <button 
                onClick={() => {
                  setIsAddMenuOpen(false);
                  handleAddObject('primitive', 'cube');
                }}
                className="context-menu-item w-full"
              >
                <Box size={16} /> Cube
              </button>
              <button 
                onClick={() => {
                  setIsAddMenuOpen(false);
                  handleAddObject('primitive', 'sphere');
                }}
                className="context-menu-item w-full"
              >
                <Circle size={16} /> Sphere
              </button>
              <button 
                onClick={() => {
                  setIsAddMenuOpen(false);
                  handleAddObject('primitive', 'plane');
                }}
                className="context-menu-item w-full"
              >
                <Square size={16} /> Plane
              </button>
              <button 
                onClick={() => {
                  setIsAddMenuOpen(false);
                  handleAddObject('primitive', 'cylinder');
                }}
                className="context-menu-item w-full"
              >
                <Cylinder size={16} /> Cylinder
              </button>
              <div className="context-menu-separator" />
              <button 
                onClick={() => {
                  setIsAddMenuOpen(false);
                  handleAddObject('light');
                }}
                className="context-menu-item w-full"
              >
                <Lightbulb size={16} /> Light
              </button>
              <button 
                onClick={() => {
                  setIsAddMenuOpen(false);
                  handleAddObject('camera');
                }}
                className="context-menu-item w-full"
              >
                <Camera size={16} /> Camera
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Scene Tabs */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-arsist-border overflow-x-auto bg-arsist-hover">
        {project?.scenes.map(scene => (
          <button
            key={scene.id}
            onClick={() => setCurrentScene(scene.id)}
            className={`px-3 py-1 rounded text-xs whitespace-nowrap transition-colors ${
              scene.id === currentSceneId
                ? 'bg-arsist-active text-arsist-accent'
                : 'hover:bg-arsist-hover text-arsist-muted hover:text-arsist-text'
            }`}
          >
            {scene.name}
          </button>
        ))}
      </div>

      {/* Objects List */}
      <div className="flex-1 overflow-y-auto p-2">
        {currentScene?.objects.map(obj => (
          <div
            key={obj.id}
            onClick={() => selectObjects([obj.id])}
            className={`tree-item ${selectedObjectIds.includes(obj.id) ? 'selected' : ''}`}
          >
            {obj.type === 'primitive' && obj.primitiveType === 'cube' && <Box size={14} className="text-arsist-muted" />}
            {obj.type === 'primitive' && obj.primitiveType === 'sphere' && <Circle size={14} className="text-arsist-muted" />}
            {obj.type === 'primitive' && obj.primitiveType === 'plane' && <Square size={14} className="text-arsist-muted" />}
            {obj.type === 'primitive' && obj.primitiveType === 'cylinder' && <Cylinder size={14} className="text-arsist-muted" />}
            {obj.type === 'light' && <Lightbulb size={14} className="text-yellow-400" />}
            {obj.type === 'camera' && <Camera size={14} className="text-blue-400" />}
            {obj.type === 'empty' && <FolderOpen size={14} className="text-arsist-muted" />}
            <span className="text-sm truncate">{obj.name}</span>
          </div>
        ))}

        {(!currentScene || currentScene.objects.length === 0) && (
          <div className="text-center py-8 text-arsist-muted text-xs">
            <Box size={24} className="mx-auto mb-2 opacity-30" />
            <p>オブジェクトがありません</p>
            <p className="mt-1 text-[10px]">+ボタンから追加してください</p>
          </div>
        )}
      </div>

      {/* ヘルプ */}
      <div className="p-2 border-t border-arsist-border bg-arsist-hover">
        <div className="text-[10px] text-arsist-muted flex items-center gap-1">
          <HelpCircle size={10} />
          <span>クリックで選択、ドラッグで移動</span>
        </div>
      </div>
    </div>
  );
}

function UIHierarchy() {
  const { 
    project, 
    currentUILayoutId, 
    setCurrentUILayout, 
    selectedUIElementId, 
    selectUIElement,
    addUIElement 
  } = useProjectStore();
  const uiAuthoringMode = project?.uiAuthoring?.mode || 'hybrid';
  const currentLayout = project?.uiLayouts.find(l => l.id === currentUILayoutId);

  if (uiAuthoringMode === 'code') {
    return (
      <div className="h-full flex items-center justify-center text-arsist-muted text-sm">
        UI/HUDのGUI編集は無効です。コードタブを使用してください。
      </div>
    );
  }

  const renderUIElement = (element: any, depth: number = 0) => {
    return (
      <div key={element.id}>
        <div
          onClick={() => selectUIElement(element.id)}
          className={`tree-item ${selectedUIElementId === element.id ? 'selected' : ''}`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {element.children?.length > 0 ? (
            <ChevronDown size={12} className="text-arsist-muted" />
          ) : (
            <ChevronRight size={12} className="opacity-0" />
          )}
          <Layout size={12} className="text-arsist-muted" />
          <span className="text-xs truncate">{element.type}</span>
        </div>
        {element.children?.map((child: any) => renderUIElement(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="text-arsist-text">UI階層</span>
        <button 
          className="btn-icon"
          onClick={() => addUIElement(null, { type: 'Panel' })}
          title="パネル追加"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Layout Tabs */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-arsist-border overflow-x-auto bg-arsist-hover">
        {project?.uiLayouts.map(layout => (
          <button
            key={layout.id}
            onClick={() => setCurrentUILayout(layout.id)}
            className={`px-3 py-1 rounded text-xs whitespace-nowrap transition-colors ${
              layout.id === currentUILayoutId
                ? 'bg-arsist-active text-arsist-accent'
                : 'hover:bg-arsist-hover text-arsist-muted hover:text-arsist-text'
            }`}
          >
            {layout.name}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {currentLayout && renderUIElement(currentLayout.root)}
      </div>

      <div className="p-2 border-t border-arsist-border bg-arsist-hover">
        <div className="text-[10px] text-arsist-muted flex items-center gap-1">
          <HelpCircle size={10} />
          <span>ツールバーでコード編集に切替可能</span>
        </div>
      </div>
    </div>
  );
}

function LogicList() {
  const { project, currentLogicGraphId, setCurrentLogicGraph, addLogicGraph } = useProjectStore();

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="text-arsist-text">ロジックグラフ</span>
        <button 
          className="btn-icon"
          onClick={() => addLogicGraph('New Graph')}
          title="グラフ追加"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {project?.logicGraphs.map(graph => (
          <div
            key={graph.id}
            onClick={() => setCurrentLogicGraph(graph.id)}
            className={`tree-item ${graph.id === currentLogicGraphId ? 'selected' : ''}`}
          >
            <File size={14} className="text-arsist-muted" />
            <span className="text-sm truncate">{graph.name}</span>
          </div>
        ))}

        {(!project?.logicGraphs || project.logicGraphs.length === 0) && (
          <div className="text-center py-8 text-arsist-muted text-xs">
            <File size={24} className="mx-auto mb-2 opacity-30" />
            <p>ロジックグラフがありません</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CodeFileList() {
  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span className="text-arsist-text">コードファイル</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="tree-item selected">
          <File size={14} className="text-orange-400" />
          <span className="text-sm">ui.html</span>
        </div>
        <div className="tree-item">
          <File size={14} className="text-blue-400" />
          <span className="text-sm">style.css</span>
        </div>
        <div className="tree-item">
          <File size={14} className="text-yellow-400" />
          <span className="text-sm">logic.js</span>
        </div>
      </div>

      <div className="p-2 border-t border-arsist-border bg-arsist-hover">
        <div className="text-[10px] text-arsist-muted flex items-center gap-1">
          <HelpCircle size={10} />
          <span>HTML/CSS/JSで直接UIを作成</span>
        </div>
      </div>
    </div>
  );
}
