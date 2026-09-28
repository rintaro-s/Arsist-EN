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
  Database, Activity, Trash2, User, Image as ImageIcon, Pin, ScanText,
  ScanEye,
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { UIElement } from '../../../shared/types';
import { ScriptFileList } from '../viewport/ScriptEditor';
import { scoreImageFromUrl } from '../../perception/imageQuality';
import { toArsistFileUrl } from '../../utils/assetUrl';
import { useT } from '../../i18n';

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
  const t = useT();
  const {
    project, projectPath, currentSceneId, setCurrentScene,
    selectedObjectIds, selectObjects, addObject, addUILayout,
    addPerceptionTarget, selectPerceptionTarget, selectedPerceptionTargetId,
    addPerceptionTask, selectPerceptionTask, selectedPerceptionTaskId,
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
      // 原点 = 起動時のユーザーの視点 (doc/12)。目の高さの少し下、1.8m 先に出す。
      // 大きさは 1920x1080 の下書きがそのまま収まる比 (1.6m x 0.9m, 1m あたり 1200px)。
      canvasSettings: { layoutId, widthMeters: 1.6, heightMeters: 0.9, pixelsPerUnit: 1200 },
      transform: { position: { x: 0, y: -0.05, z: 1.8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    });
  };

  /**
   * 画像アンカーの追加。写真を1枚選ぶだけで、あとは実物の幅を入れるだけにする。
   * 追跡しやすさのスコアはこの時点で測っておき、ダメな写真をビルド前に気付けるようにする。
   */
  const addImageAnchor = async () => {
    setMenuOpen(false);
    if (!window.electronAPI || !projectPath) return;

    const selected = await window.electronAPI.fs.selectFile([
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg'] },
    ]);
    if (!selected) return;

    const imported = await window.electronAPI.assets.import({
      projectPath,
      sourcePath: selected,
      kind: 'texture',
    });
    if (!imported?.success || !imported.assetPath) return;

    const quality = await scoreImageFromUrl(toArsistFileUrl(projectPath, imported.assetPath));
    const baseName = selected.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'Image Anchor';

    addPerceptionTarget({
      name: baseName,
      imagePath: imported.assetPath,
      physicalWidth: 0.3, // 30cm 相当。ユーザーが実測値に直す前提の初期値
      quality: quality?.score,
    });
  };

  /**
   * 画像認識タスクの追加。写真の上に枠が既にあればそれを見るタスクに、
   * 無ければ「画面上の枠を狙う」タスクとして作る（枠が無くても始められるように）。
   */
  const addRecognitionTask = () => {
    setMenuOpen(false);
    const targetWithRegion = project?.perception?.targets.find((x) => (x.regions ?? []).length > 0);
    addPerceptionTask({
      name: 'OCR',
      type: 'ocr',
      source: targetWithRegion
        ? { kind: 'region', targetId: targetWithRegion.id, regionId: targetWithRegion.regions![0].id }
        : { kind: 'viewport', rect: { x: 0.25, y: 0.35, width: 0.5, height: 0.3 } },
    });
  };

  /** 画像処理パイプラインのタスク。中身は Vision タブで組むので、そこへ移る。 */
  const addVisionTask = () => {
    setMenuOpen(false);
    addPerceptionTask({
      name: t('vision.task.defaultName'),
      type: 'vision',
      source: { kind: 'viewport', rect: { x: 0, y: 0, width: 1, height: 1 } },
      trigger: { type: 'interval', value: 500 },
      storeAs: 'vision',
    });
    useUIStore.getState().setCurrentView('vision');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header">
        <span>{t('leftPanel.scene')}</span>
        <div className="relative" ref={menuRef}>
          <button className="btn-icon" onClick={() => setMenuOpen((v) => !v)}><Plus size={15} /></button>
          {menuOpen && (
            <div className="context-menu" style={{ right: 0, top: '100%' }}>
              <MenuItem icon={<FolderOpen size={14} />} label={t('leftPanel.importGlbGltf')} onClick={handleImport} />
              <MenuItem icon={<User size={14} />} label={t('leftPanel.importVrm')} onClick={handleImportVRM} />
              <div className="context-menu-separator" />
              <MenuItem icon={<Box size={14} />} label={t('leftPanel.cube')} onClick={() => add('primitive', 'cube')} />
              <MenuItem icon={<Circle size={14} />} label={t('leftPanel.sphere')} onClick={() => add('primitive', 'sphere')} />
              <MenuItem icon={<Square size={14} />} label={t('leftPanel.plane')} onClick={() => add('primitive', 'plane')} />
              <MenuItem icon={<Cylinder size={14} />} label={t('leftPanel.cylinder')} onClick={() => add('primitive', 'cylinder')} />
              <div className="context-menu-separator" />
              <MenuItem icon={<Layout size={14} />} label={t('leftPanel.canvasUiSurface')} onClick={addCanvas} />
              <MenuItem icon={<ImageIcon size={14} />} label={t('perception.addTarget')} onClick={addImageAnchor} />
              <MenuItem icon={<ScanText size={14} />} label={t('perception.addTask')} onClick={addRecognitionTask} />
              <MenuItem icon={<ScanEye size={14} />} label={t('perception.addVisionTask')} onClick={addVisionTask} />
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

      {/* Image anchors */}
      {(project?.perception?.targets.length ?? 0) > 0 && (
        <div className="px-1.5 py-1 border-b border-arsist-border">
          <div className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-arsist-muted uppercase tracking-wider">
            <ImageIcon size={11} />
            <span>{t('perception.section')}</span>
          </div>
          {project!.perception!.targets.map((target) => (
            <div key={target.id} onClick={() => selectPerceptionTarget(target.id)}
              className={`tree-item ${selectedPerceptionTargetId === target.id ? 'selected' : ''}`}>
              <ImageIcon size={13} className="text-emerald-400" />
              <span className="text-[12px] truncate">{target.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recognition tasks */}
      {(project?.perception?.tasks?.length ?? 0) > 0 && (
        <div className="px-1.5 py-1 border-b border-arsist-border">
          <div className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-arsist-muted uppercase tracking-wider">
            <ScanText size={11} />
            <span>{t('perception.tasks')}</span>
          </div>
          {project!.perception!.tasks!.map((task) => (
            <div key={task.id} onClick={() => selectPerceptionTask(task.id)}
              className={`tree-item ${selectedPerceptionTaskId === task.id ? 'selected' : ''}`}>
              <ScanText size={13} className="text-sky-400" />
              <span className="text-[12px] truncate">{task.name}</span>
            </div>
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
              {obj.anchor && <Pin size={11} className="ml-auto shrink-0 text-emerald-400" />}
            </div>
          );
        })}
        {(!scene || scene.objects.length === 0) && (
          <Empty icon={<Box size={20} />} text={t('leftPanel.clickPlusToAddObject')} />
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   UI Hierarchy
   ════════════════════════════════════════ */

function UIHierarchy() {
  const t = useT();
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
        <span>{t('leftPanel.uiLayouts')}</span>
      </div>

      {/* UHD Section */}
      <LayoutSection
        label={t('leftPanel.uhdAlwaysVisible')}
        layouts={uhdLayouts}
        currentId={currentUILayoutId}
        onSelect={setCurrentUILayout}
        onAdd={() => addUILayout(`UHD_${uhdLayouts.length + 1}`, 'uhd')}
        onRemove={removeUILayout}
        minCount={1}
      />

      {/* Canvas Section */}
      <LayoutSection
        label={t('leftPanel.canvas3dSpace')}
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
          <span className="text-[10px] text-arsist-muted mr-1">{t('leftPanel.add')}</span>
          {(['Panel', 'Text', 'Button', 'Image', 'Input', 'Keyboard', 'Slider', 'Gauge', 'Graph'] as const).map((t) => (
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
          <Empty icon={<Layout size={20} />} text={t('leftPanel.selectLayout')} />
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
  const t = useT();
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
                  title={t('leftPanel.delete')}
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
  const t = useT();
  const {
    project, selectedDataSourceId, selectDataSource, removeDataSource,
    selectedTransformId, selectTransform, removeTransform,
  } = useProjectStore();
  const sources = project?.dataFlow.dataSources || [];
  const transforms = project?.dataFlow.transforms || [];

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header"><span>{t('leftPanel.dataFlow')}</span></div>

      <div className="px-2 py-1 border-b border-arsist-border bg-arsist-hover">
        <span className="text-[10px] text-arsist-muted uppercase tracking-wider">{t('leftPanel.sources', { count: sources.length })}</span>
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
        {sources.length === 0 && <div className="text-[10px] text-arsist-muted text-center py-2">{t('leftPanel.addFromDataFlowEditor')}</div>}
      </div>

      <div className="px-2 py-1 border-b border-t border-arsist-border bg-arsist-hover">
        <span className="text-[10px] text-arsist-muted uppercase tracking-wider">{t('leftPanel.transforms', { count: transforms.length })}</span>
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
        {transforms.length === 0 && <div className="text-[10px] text-arsist-muted text-center py-2">{t('leftPanel.addFromDataFlowEditor')}</div>}
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
