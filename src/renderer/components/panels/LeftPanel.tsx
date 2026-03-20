/**
 * LeftPanel — View-specific hierarchy/list display
 * Scene: Object hierarchy + Canvas addition
 * UI: UHD / Canvas layouts + element tree
 * DataFlow: DataSource / Transform list
 */
import { useState, useRef, useEffect } from 'react';
import {
  Box, Circle, Square, Cylinder,
  Layout, Plus,
  FolderOpen, ChevronDown, ChevronRight,
  Database, Activity, Trash2, User,
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { UIElement } from '../../../shared/types';
import { ScriptFileList } from '../viewport/ScriptEditor';

export function LeftPanel() {
  const { currentView } = useUIStore();
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {currentView === 'scene' && <SceneHierarchy />}
      {currentView === 'ui' && <UIHierarchy />}
      {currentView === 'script' && <ScriptFileList />}
    </div>
  );
}

/* ════════════════════════════════════════
   Scene Hierarchy
   ════════════════════════════════════════ */

function SceneHierarchy() {
  const {
    project, projectPath, currentSceneId, setCurrentScene,
    selectedObjectIds, selectObjects, addObject, addUILayout,
  } = useProjectStore();
  const scene = project?.scenes.find((s) => s.id === currentSceneId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const handleImport = async () => {
    setMenuOpen(false);
    if (!window.electronAPI) return;
    const path = await window.electronAPI.fs.selectFile([{ name: 'GLB/GLTF', extensions: ['glb', 'gltf'] }]);
    if (!path) return;
    let modelPath = path;
    if (projectPath && window.electronAPI.assets?.import) {
      const res = await window.electronAPI.assets.import({ projectPath, sourcePath: path, kind: 'model' });
      if (res?.success && res.assetPath) modelPath = res.assetPath;
    }
    addObject({ name: 'Model', type: 'model', modelPath });
  };

  const handleImportVRM = async () => {
    setMenuOpen(false);
    if (!window.electronAPI) return;
    const path = await window.electronAPI.fs.selectFile([{ name: 'VRM', extensions: ['vrm'] }]);
    if (!path) return;
    let modelPath = path;
    if (projectPath && window.electronAPI.assets?.import) {
      const res = await window.electronAPI.assets.import({ projectPath, sourcePath: path, kind: 'model' });
      if (res?.success && res.assetPath) modelPath = res.assetPath;
    }
    addObject({ name: 'VRM Avatar', type: 'vrm', modelPath });
  };

  const add = (type: string, primitiveType?: string) => {
    setMenuOpen(false);
    addObject({ name: type, type: type as any, primitiveType: primitiveType as any });
  };

  const addCanvas = () => {
    setMenuOpen(false);
    const layouts = project?.uiLayouts.filter((l) => l.scope === 'canvas') || [];
    let layoutId = layouts[0]?.id;
    if (!layoutId) layoutId = addUILayout(`Canvas_${layouts.length + 1}`, 'canvas') || '';
    addObject({
      name: 'Canvas',
      type: 'canvas',
      canvasSettings: { layoutId, widthMeters: 1.2, heightMeters: 0.7, pixelsPerUnit: 1000 },
      transform: { position: { x: 0, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span>Scene</span>
        <div className="relative" ref={menuRef}>
          <button className="btn-icon" onClick={() => setMenuOpen((v) => !v)}><Plus size={15} /></button>
          {menuOpen && (
            <div className="context-menu" style={{ right: 0, top: '100%' }}>
              <MenuItem icon={<FolderOpen size={14} />} label="Import GLB/GLTF" onClick={handleImport} />
              <MenuItem icon={<User size={14} />} label="Import VRM" onClick={handleImportVRM} />
              <div className="context-menu-separator" />
              <MenuItem icon={<Box size={14} />} label="Cube" onClick={() => add('primitive', 'cube')} />
              <MenuItem icon={<Circle size={14} />} label="Sphere" onClick={() => add('primitive', 'sphere')} />
              <MenuItem icon={<Square size={14} />} label="Plane" onClick={() => add('primitive', 'plane')} />
              <MenuItem icon={<Cylinder size={14} />} label="Cylinder" onClick={() => add('primitive', 'cylinder')} />
              <div className="context-menu-separator" />
              <MenuItem icon={<Layout size={14} />} label="Canvas (UI Surface)" onClick={addCanvas} />
            </div>
          )}
        </div>
      </div>

      {/* Scene tabs */}
      {project && project.scenes.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-arsist-border bg-arsist-hover overflow-x-auto">
          {project.scenes.map((s) => (
            <button key={s.id} onClick={() => setCurrentScene(s.id)}
              className={`px-2 py-0.5 rounded text-[11px] ${s.id === currentSceneId ? 'bg-arsist-active text-arsist-accent' : 'text-arsist-muted hover:bg-arsist-hover'}`}
            >{s.name}</button>
          ))}
        </div>
      )}

      {/* Object list */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {scene?.objects.map((obj) => {
          const icon =
            obj.type === 'canvas' ? <Layout size={13} className="text-arsist-accent" /> :
            obj.type === 'light' ? <Box size={13} className="text-yellow-400" /> :
            obj.type === 'camera' ? <Box size={13} className="text-blue-400" /> :
            obj.type === 'vrm' ? <User size={13} className="text-purple-400" /> :
            obj.type === 'model' ? <Box size={13} className="text-arsist-primary" /> :
            <Box size={13} className="text-arsist-muted" />;
          return (
            <div key={obj.id} onClick={() => selectObjects([obj.id])}
              className={`tree-item ${selectedObjectIds.includes(obj.id) ? 'selected' : ''}`}>
              {icon}
              <span className="text-[12px] truncate">{obj.name}</span>
            </div>
          );
        })}
        {(!scene || scene.objects.length === 0) && (
          <Empty icon={<Box size={20} />} text="Click + to add an object" />
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   UI Hierarchy
   ════════════════════════════════════════ */

function UIHierarchy() {
  const {
    project, currentUILayoutId, setCurrentUILayout,
    selectedUIElementId, selectUIElement, addUIElement, addUILayout, removeUILayout,
  } = useProjectStore();
  const layout = project?.uiLayouts.find((l) => l.id === currentUILayoutId);
  const uhdLayouts = project?.uiLayouts.filter((l) => l.scope === 'uhd') || [];
  const canvasLayouts = project?.uiLayouts.filter((l) => l.scope === 'canvas') || [];

  const renderTree = (el: UIElement, depth = 0) => (
    <div key={el.id}>
      <div
        onClick={() => selectUIElement(el.id)}
        className={`tree-item ${selectedUIElementId === el.id ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {el.children.length > 0 ? <ChevronDown size={11} className="text-arsist-muted" /> : <ChevronRight size={11} className="opacity-0" />}
        <span className="text-[11px] truncate">{el.type}{el.bind?.key ? ` → ${el.bind.key}` : ''}</span>
      </div>
      {el.children.map((c) => renderTree(c, depth + 1))}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span>UI Layouts</span>
      </div>

      {/* UHD Section */}
      <LayoutSection
        label="UHD (Always Visible)"
        layouts={uhdLayouts}
        currentId={currentUILayoutId}
        onSelect={setCurrentUILayout}
        onAdd={() => addUILayout(`UHD_${uhdLayouts.length + 1}`, 'uhd')}
        onRemove={removeUILayout}
        minCount={1}
      />

      {/* Canvas Section */}
      <LayoutSection
        label="Canvas (3D Space)"
        layouts={canvasLayouts}
        currentId={currentUILayoutId}
        onSelect={setCurrentUILayout}
        onAdd={() => addUILayout(`Canvas_${canvasLayouts.length + 1}`, 'canvas')}
        onRemove={removeUILayout}
        minCount={0}
      />

      {/* Element Creation Toolbar */}
      {layout && (
        <div className="px-2 py-1.5 border-b border-arsist-border bg-arsist-hover flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-arsist-muted mr-1">Add:</span>
          {(['Panel', 'Text', 'Button', 'Image', 'Input', 'Slider', 'Gauge', 'Graph'] as const).map((t) => (
            <button
              key={t}
              onClick={() => addUIElement(selectedUIElementId, { type: t })}
              className="px-1.5 py-0.5 rounded text-[10px] border border-arsist-border hover:bg-arsist-hover text-arsist-muted hover:text-arsist-text"
            >{t}</button>
          ))}
        </div>
      )}

      {/* Element Tree */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {layout ? renderTree(layout.root) : (
          <Empty icon={<Layout size={20} />} text="Select a layout" />
        )}
      </div>
    </div>
  );
}

function LayoutSection({ label, layouts, currentId, onSelect, onAdd, onRemove, minCount = 0 }: {
  label: string;
  layouts: { id: string; name: string }[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove?: (id: string) => void;
  minCount?: number;
}) {
  return (
    <>
      <div className="px-2 py-1 border-b border-arsist-border bg-arsist-hover flex items-center justify-between">
        <span className="text-[10px] text-arsist-muted uppercase tracking-wider">{label}</span>
        <button className="btn-icon p-0.5" onClick={onAdd}><Plus size={13} /></button>
      </div>
      {layouts.length > 0 && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-arsist-border overflow-x-auto">
          {layouts.map((l) => (
            <div key={l.id} className="flex items-center gap-0.5 group">
              <button onClick={() => onSelect(l.id)}
                className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap ${l.id === currentId ? 'bg-arsist-active text-arsist-accent' : 'text-arsist-muted hover:bg-arsist-hover'}`}
              >{l.name}</button>
              {onRemove && layouts.length > minCount && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(l.id); }}
                  className="opacity-0 group-hover:opacity-100 text-arsist-muted hover:text-arsist-error transition-opacity p-0.5"
                  title="Delete"
                ><Trash2 size={11} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════
   DataFlow List
   ════════════════════════════════════════ */

function DataFlowList() {
  const {
    project, selectedDataSourceId, selectDataSource, removeDataSource,
    selectedTransformId, selectTransform, removeTransform,
  } = useProjectStore();
  const sources = project?.dataFlow.dataSources || [];
  const transforms = project?.dataFlow.transforms || [];

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header"><span>DataFlow</span></div>

      <div className="px-2 py-1 border-b border-arsist-border bg-arsist-hover">
        <span className="text-[10px] text-arsist-muted uppercase tracking-wider">Sources ({sources.length})</span>
      </div>
      <div className="overflow-y-auto p-1.5 space-y-0.5 max-h-[40%]">
        {sources.map((ds) => (
          <div key={ds.id} onClick={() => selectDataSource(ds.id)}
            className={`tree-item justify-between ${ds.id === selectedDataSourceId ? 'selected' : ''}`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <Database size={12} className="text-arsist-accent shrink-0" />
              <span className="text-[11px] truncate">{ds.type}</span>
              <span className="text-[10px] font-mono text-arsist-accent truncate">{ds.storeAs}</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); removeDataSource(ds.id); }} className="text-arsist-muted hover:text-arsist-error shrink-0"><Trash2 size={11} /></button>
          </div>
        ))}
        {sources.length === 0 && <div className="text-[10px] text-arsist-muted text-center py-2">Add from DataFlow editor</div>}
      </div>

      <div className="px-2 py-1 border-b border-t border-arsist-border bg-arsist-hover">
        <span className="text-[10px] text-arsist-muted uppercase tracking-wider">Transforms ({transforms.length})</span>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {transforms.map((tf) => (
          <div key={tf.id} onClick={() => selectTransform(tf.id)}
            className={`tree-item justify-between ${tf.id === selectedTransformId ? 'selected' : ''}`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <Activity size={12} className="text-arsist-warning shrink-0" />
              <span className="text-[11px] truncate">{tf.type}</span>
              <span className="text-[10px] font-mono text-arsist-warning truncate">{tf.storeAs}</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); removeTransform(tf.id); }} className="text-arsist-muted hover:text-arsist-error shrink-0"><Trash2 size={11} /></button>
          </div>
        ))}
        {transforms.length === 0 && <div className="text-[10px] text-arsist-muted text-center py-2">Add from DataFlow editor</div>}
      </div>
    </div>
  );
}

/* ── utils ── */

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="context-menu-item w-full">
      {icon}<span>{label}</span>
    </button>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="text-center py-6 text-arsist-muted text-[11px]">
      <div className="mx-auto mb-1.5 opacity-30">{icon}</div>
      <p>{text}</p>
    </div>
  );
}
