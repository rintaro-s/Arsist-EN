/**
 * RightPanel — View-specific Property Inspector
 * Scene: Object Inspector (Transform, Material, Canvas settings)
 * UI: Element Inspector (Style, Bind, Layout)
 * DataFlow: Source / Transform settings
 */
import React from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { Vector3, UIElement, UIStyle, DataSourceDefinition, TransformDefinition } from '../../../shared/types';
import { Box, Compass, Layout, Database, Activity, Wifi, User } from 'lucide-react';
import { ScriptInspector } from '../viewport/ScriptEditor';
import { useT } from '../../i18n';

export function RightPanel() {
  const { currentView } = useUIStore();
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {currentView === 'scene' && <ObjectInspector />}
      {currentView === 'ui' && <UIInspector />}
      {currentView === 'script' && <ScriptInspector />}
    </div>
  );
}

/* ════════════════════════════════════════
   Project AR Settings (displayed when no object selected)
   ════════════════════════════════════════ */

function ProjectARSettings() {
  const t = useT();
  const { project, updateARSettings } = useProjectStore();
  if (!project) return <EmptyState icon={<Box size={28} />} text={t('rightPanel.selectAnObject')} sub={t('rightPanel.clickAnObjectInScene')} />;

  const ar = project.arSettings;
  const hasVRM = project.scenes.some((scene) => scene.objects.some((obj) => obj.type === 'vrm'));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header"><span>{t('rightPanel.projectSettings')}</span></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">

        {/* AR context */}
        <div className="text-[10px] text-arsist-muted flex items-center gap-1.5">
          <Compass size={12} />
          <span>{ar.trackingMode.toUpperCase()} / {ar.presentationMode.replace(/_/g, ' ')}</span>
        </div>

        {/* Remote control (visible only when VRM objects exist) */}
        {hasVRM && (
          <div className="p-3 rounded-lg bg-arsist-hover space-y-2">
            <div className="flex items-center gap-1.5">
              <Wifi size={14} className="text-arsist-accent" />
              <label className="text-xs font-semibold text-arsist-text">{t('rightPanel.pythonRemoteControl')}</label>
            </div>
            <p className="text-[9px] text-arsist-muted leading-tight">
              {t('rightPanel.remoteControlDesc')}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enableRemoteControl"
                checked={ar.enableRemoteControl ?? false}
                onChange={(e) => updateARSettings({ enableRemoteControl: e.target.checked })}
                className="w-3.5 h-3.5 accent-arsist-accent"
              />
              <label htmlFor="enableRemoteControl" className="text-xs text-arsist-text cursor-pointer">
                {t('rightPanel.enableRemoteControl')}
              </label>
            </div>
            {ar.enableRemoteControl && (
              <>
                <Field label={t('rightPanel.webSocketPort')}>
                  <input
                    type="number"
                    className="input text-xs py-1"
                    value={ar.remoteControlPort ?? 8765}
                    onChange={(e) => updateARSettings({ remoteControlPort: parseInt(e.target.value, 10) || 8765 })}
                    min={1024}
                    max={65535}
                  />
                </Field>
                <Field label={t('rightPanel.authPassword')}>
                  <input
                    type="password"
                    className="input text-xs py-1"
                    value={ar.remoteControlPassword ?? ''}
                    onChange={(e) => updateARSettings({ remoteControlPassword: e.target.value })}
                    placeholder={t('rightPanel.noAuthWhenEmpty')}
                  />
                </Field>
              </>
            )}
            {ar.enableRemoteControl && (
              <p className="text-[9px] text-arsist-warning leading-tight">
                {t('rightPanel.remoteControlWarning')}
              </p>
            )}
          </div>
        )}

        {!hasVRM && (
          <div className="p-3 rounded-lg bg-arsist-hover">
            <p className="text-[10px] text-arsist-muted leading-tight">
              {t('rightPanel.remoteControlAppearsHint')}
            </p>
          </div>
        )}

      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Object Inspector (Scene)
   ════════════════════════════════════════ */

function ObjectInspector() {
  const t = useT();
  const { project, currentSceneId, selectedObjectIds, updateObject, removeObject } = useProjectStore();
  const scene = project?.scenes.find((s) => s.id === currentSceneId);
  const obj = scene?.objects.find((o) => o.id === selectedObjectIds[0]);
  const canvasLayouts = project?.uiLayouts.filter((l) => l.scope === 'canvas') || [];

  if (!obj) return (
    <ProjectARSettings />
  );

  const setTransform = (key: 'position' | 'rotation' | 'scale', axis: keyof Vector3, v: number) => {
    const t = { ...obj.transform, [key]: { ...obj.transform[key], [axis]: v } };
    updateObject(obj.id, { transform: t });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header"><span>{t('rightPanel.inspector')}</span></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* AR context */}
        {project && (
          <div className="text-[10px] text-arsist-muted flex items-center gap-1.5">
            <Compass size={12} />
            <span>{project.arSettings.trackingMode.toUpperCase()} / {project.arSettings.presentationMode.replace(/_/g, ' ')}</span>
          </div>
        )}

        {/* Name */}
        <Field label={t('rightPanel.name')}>
          <input className="input text-sm" value={obj.name} onChange={(e) => updateObject(obj.id, { name: e.target.value })} />
        </Field>

        {/* Asset ID (for scripting) */}
        <div className="p-3 rounded-lg bg-arsist-hover space-y-2">
          <div className="flex items-center gap-1.5">
            <Box size={14} className="text-[#FF9800]" />
            <label className="text-xs font-semibold text-[#FF9800]">{t('rightPanel.assetIdForScripting')}</label>
          </div>
          <p className="text-[9px] text-[#9e9e9e] leading-tight">
            {t('rightPanel.assetIdDesc')}
          </p>
          <Field label={t('rightPanel.id')}>
            <input className="input text-xs font-mono" placeholder={t('rightPanel.assetIdPlaceholder')}
              value={obj.assetId || ''}
              onChange={(e) => updateObject(obj.id, { assetId: e.target.value || undefined })} />
          </Field>
          {obj.assetId && (
            <p className="text-[9px] text-[#4CAF50] mt-1">
              {t('rightPanel.useInScriptsLike')} <span className="font-mono bg-[#2d2d2d] px-1 rounded">scene.setPosition('{obj.assetId}', 0, 0, 2)</span>
            </p>
          )}
          {obj.type === 'vrm' && obj.assetId && (
            <p className="text-[9px] text-[#2196F3] mt-1">
              {t('rightPanel.vrmControl')} <span className="font-mono bg-[#2d2d2d] px-1 rounded">vrm.setExpression('{obj.assetId}', 'Joy', 100)</span>
            </p>
          )}
        </div>

        {/* Transform */}
        {(['position', 'rotation', 'scale'] as const).map((key) => (
          <div key={key}>
            <label className="input-label">{t(`rightPanel.${key}`)}</label>
            <div className="grid grid-cols-3 gap-1">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <div key={axis} className="flex items-center gap-1">
                  <span className="text-[10px] text-arsist-muted w-3">{axis.toUpperCase()}</span>
                  <input type="number" step={key === 'scale' ? 0.1 : 0.5} className="input text-xs py-1 px-1.5"
                    value={obj.transform[key][axis]}
                    onChange={(e) => setTransform(key, axis, parseFloat(e.target.value) || 0)} />
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Material */}
        {obj.material && (
          <div>
            <label className="input-label">{t('rightPanel.material')}</label>
            <div className="flex items-center gap-2">
              <input type="color" value={obj.material.color} className="w-8 h-8 rounded border border-arsist-border cursor-pointer"
                onChange={(e) => updateObject(obj.id, { material: { ...obj.material!, color: e.target.value } })} />
              <span className="text-xs font-mono text-arsist-muted">{obj.material.color}</span>
            </div>
          </div>
        )}

        {/* Canvas settings
            canvasSettings が欠けている Canvas でも必ず表示する。
            以前は `obj.canvasSettings &&` で描画をガードしていたため、
            参照先レイアウトを削除した Canvas は設定UIごと消えて
            レイアウトを割り当て直せなくなっていた。 */}
        {obj.type === 'canvas' && (() => {
          const canvasSettings = obj.canvasSettings ?? {
            layoutId: '',
            widthMeters: 1.2,
            heightMeters: 0.7,
            pixelsPerUnit: 1000,
          };
          const layoutMissing = !canvasSettings.layoutId || !canvasLayouts.some((l) => l.id === canvasSettings.layoutId);
          return (
            <div className="space-y-2">
              <label className="input-label">{t('rightPanel.canvasSettings')}</label>
              <Field label={t('rightPanel.uiLayout')}>
                <select className="input text-xs" value={layoutMissing ? '' : canvasSettings.layoutId}
                  onChange={(e) => updateObject(obj.id, { canvasSettings: { ...canvasSettings, layoutId: e.target.value } })}>
                  <option value="">{t('rightPanel.uiLayoutUnassigned')}</option>
                  {canvasLayouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              {layoutMissing && (
                <p className="text-xs text-arsist-error">{t('rightPanel.uiLayoutMissingHint')}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('rightPanel.widthMeters')}>
                  <input type="number" step="0.1" className="input text-xs py-1" value={canvasSettings.widthMeters}
                    onChange={(e) => updateObject(obj.id, { canvasSettings: { ...canvasSettings, widthMeters: parseFloat(e.target.value) || 1 } })} />
                </Field>
                <Field label={t('rightPanel.heightMeters')}>
                  <input type="number" step="0.1" className="input text-xs py-1" value={canvasSettings.heightMeters}
                    onChange={(e) => updateObject(obj.id, { canvasSettings: { ...canvasSettings, heightMeters: parseFloat(e.target.value) || 1 } })} />
                </Field>
              </div>
            </div>
          );
        })()}

        {/* VRM Capabilities (shown only for VRM type) */}
        {obj.type === 'vrm' && <VRMCapabilitiesPanel assetId={obj.assetId} modelPath={obj.modelPath} />}

        {/* Delete */}
        <button onClick={() => removeObject(obj.id)} className="btn btn-ghost text-arsist-error text-xs w-full justify-center">
          {t('rightPanel.delete')}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   VRM Capabilities Panel
   ════════════════════════════════════════ */

/** VRM-specific info: expressions, bones, remote control hints */
function VRMCapabilitiesPanel({ assetId, modelPath }: { assetId?: string; modelPath?: string }) {
  const t = useT();
  const [expanded, setExpanded] = React.useState<{ expressions: boolean; bones: boolean }>({ expressions: false, bones: false });

  // VRM standard expressions (UniVRM 0.x / 1.0)
  const vrmExpressions = [
    'Joy', 'Angry', 'Sorrow', 'Fun', 'Blink', 'BlinkLeft', 'BlinkRight',
    'A', 'I', 'U', 'E', 'O', 'Surprised', 'Neutral',
  ];
  const humanoidBones = [
    'Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head',
    'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
    'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand',
    'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes',
    'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes',
  ];

  const fileName = modelPath ? modelPath.split(/[/\\]/).pop() : undefined;

  return (
    <div className="p-3 rounded-lg bg-arsist-hover space-y-3">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <User size={14} className="text-purple-400" />
        <label className="text-xs font-semibold text-purple-400">{t('rightPanel.vrmDetails')}</label>
      </div>

      {/* Model file */}
      {fileName && (
        <div className="text-[9px] text-arsist-muted">
          {t('rightPanel.model')} <span className="font-mono text-arsist-text">{fileName}</span>
        </div>
      )}

      {/* Asset ID reminder */}
      {assetId ? (
        <div className="text-[9px] text-[#4CAF50]">
          {t('rightPanel.controlId')} <span className="font-mono font-bold">{assetId}</span>
        </div>
      ) : (
        <div className="text-[9px] text-[#FF9800]">
          {t('rightPanel.setAssetIdHint')}
        </div>
      )}

      {/* Expressions section */}
      <div>
        <button
          className="flex items-center gap-1 text-xs text-arsist-text hover:text-arsist-accent w-full text-left"
          onClick={() => setExpanded(prev => ({ ...prev, expressions: !prev.expressions }))}
        >
          <span className="text-[10px]">{expanded.expressions ? '▼' : '▶'}</span>
          <span className="font-semibold">{t('rightPanel.expressions')}</span>
          <span className="text-[10px] text-arsist-muted ml-auto">{t('rightPanel.presetsCount', { count: vrmExpressions.length })}</span>
        </button>
        {expanded.expressions && (
          <div className="mt-1.5 space-y-1">
            <div className="flex flex-wrap gap-1">
              {vrmExpressions.map(expr => (
                <span key={expr} className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-arsist-surface border border-arsist-border text-arsist-muted">
                  {expr}
                </span>
              ))}
            </div>
            {assetId && (
              <p className="text-[9px] text-[#2196F3] mt-1">
                <span className="font-mono bg-[#2d2d2d] px-1 rounded">vrm.setExpression('{assetId}', 'Joy', 100)</span>
              </p>
            )}
            <p className="text-[9px] text-arsist-muted">
              {t('rightPanel.expressionsNote')}
            </p>
          </div>
        )}
      </div>

      {/* Bones section */}
      <div>
        <button
          className="flex items-center gap-1 text-xs text-arsist-text hover:text-arsist-accent w-full text-left"
          onClick={() => setExpanded(prev => ({ ...prev, bones: !prev.bones }))}
        >
          <span className="text-[10px]">{expanded.bones ? '▼' : '▶'}</span>
          <span className="font-semibold">{t('rightPanel.humanoidBones')}</span>
          <span className="text-[10px] text-arsist-muted ml-auto">{t('rightPanel.primaryCount', { count: humanoidBones.length })}</span>
        </button>
        {expanded.bones && (
          <div className="mt-1.5 space-y-1">
            <div className="flex flex-wrap gap-1">
              {humanoidBones.map(bone => (
                <span key={bone} className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-arsist-surface border border-arsist-border text-arsist-muted">
                  {bone}
                </span>
              ))}
            </div>
            {assetId && (
              <p className="text-[9px] text-[#2196F3] mt-1">
                <span className="font-mono bg-[#2d2d2d] px-1 rounded">vrm.setBoneRotation('{assetId}', 'Head', 15, 0, 0)</span>
              </p>
            )}
            <p className="text-[9px] text-arsist-muted">
              {t('rightPanel.bonesNote')}
            </p>
          </div>
        )}
      </div>

      {/* Python remote control snippet */}
      {assetId && (
        <div className="mt-2 p-2 rounded bg-[#1e1e1e] border border-arsist-border">
          <div className="text-[9px] text-arsist-muted mb-1">{t('rightPanel.pythonRemoteExample')}</div>
          <pre className="text-[9px] font-mono text-[#9CDCFE] leading-relaxed whitespace-pre-wrap">
{`from python.Control import ArsistControl
ctrl = ArsistControl("127.0.0.1", password="0000")
ctrl.connect()
caps = ctrl.get_capabilities("${assetId}")
ctrl.set_expression("${assetId}", "Joy", 100)
ctrl.set_bone_rotation("${assetId}", "Head", 15, 0, 0)
ctrl.disconnect()`}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   UI Inspector
   ════════════════════════════════════════ */

function UIInspector() {
  const t = useT();
  const { project, currentUILayoutId, selectedUIElementId, updateUIElement, removeUIElement } = useProjectStore();
  const layout = project?.uiLayouts.find((l) => l.id === currentUILayoutId);
  const dataFlow = project?.dataFlow || { dataSources: [], transforms: [] };

  const findElement = (el: UIElement, id: string): UIElement | null => {
    if (el.id === id) return el;
    for (const c of el.children) {
      const found = findElement(c, id);
      if (found) return found;
    }
    return null;
  };

  const element = layout && selectedUIElementId ? findElement(layout.root, selectedUIElementId) : null;

  if (!element) return <EmptyState icon={<Layout size={28} />} text={t('rightPanel.selectUiElement')} sub={t('rightPanel.clickCanvasOrLeftPanel')} />;

  const update = (updates: Partial<UIElement>) => updateUIElement(element.id, updates);
  const updateStyle = (s: Partial<UIStyle>) => update({ style: { ...element.style, ...s } });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header"><span>{t('rightPanel.uiInspector')}</span></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Type */}
        <div className="text-[10px] text-arsist-muted flex items-center gap-1.5">
          <Layout size={12} />
          <span className="font-medium text-arsist-text">{element.type}</span>
          <span className="font-mono">{element.id.slice(0, 8)}</span>
        </div>

        {/* Content */}
        {(element.type === 'Text' || element.type === 'Button') && (
          <Field label={t('rightPanel.text')}>
            <input className="input text-xs" value={element.content || ''} onChange={(e) => update({ content: e.target.value })} />
          </Field>
        )}

        {/* Binding ID (for scripting) */}
        <div className="p-3 rounded-lg bg-arsist-hover space-y-2">
          <div className="flex items-center gap-1.5">
            <Layout size={14} className="text-[#FF9800]" />
            <label className="text-xs font-semibold text-[#FF9800]">{t('rightPanel.bindingIdForScripting')}</label>
          </div>
          <p className="text-[9px] text-[#9e9e9e] leading-tight">
            {t('rightPanel.bindingIdDesc')}
          </p>
          <Field label={t('rightPanel.id')}>
            <input className="input text-xs font-mono" placeholder={t('rightPanel.bindingIdPlaceholder')}
              value={element.bindingId || ''}
              onChange={(e) => update({ bindingId: e.target.value || undefined })} />
          </Field>
          {element.bindingId && (
            <p className="text-[9px] text-[#4CAF50] mt-1">
              {t('rightPanel.useInScriptsLike')} <span className="font-mono bg-[#2d2d2d] px-1 rounded">ui.setText('{element.bindingId}', '...')</span>
            </p>
          )}
        </div>

        {/* Bind (DataStore) */}
        <div className="p-3 rounded-lg bg-arsist-hover space-y-2">
          <div className="flex items-center gap-1.5">
            <Database size={14} className="text-[#2196F3]" />
            <label className="text-xs font-semibold text-[#2196F3]">{t('rightPanel.dataStoreBinding')}</label>
          </div>
          <p className="text-[9px] text-[#9e9e9e] leading-tight">
            {t('rightPanel.dataStoreBindingDesc')}
          </p>
          <Field label={t('rightPanel.selectVariable')}>
            <select className="input text-xs"
              value={element.bind?.key || ''}
              onChange={(e) => update({ bind: e.target.value ? { key: e.target.value, format: element.bind?.format } : undefined })}>
              <option value="">{t('rightPanel.noBinding')}</option>
              {(dataFlow?.dataSources || []).map((s) => (
                <option key={s.id} value={s.storeAs}>
                  {s.storeAs} ({s.type})
                </option>
              ))}
              {(dataFlow?.transforms || []).map((t) => (
                <option key={t.id} value={t.storeAs}>
                  {t.storeAs} ({t.type})
                </option>
              ))}
            </select>
          </Field>
          {element.bind?.key && (
            <Field label={t('rightPanel.displayFormat')}>
              <input className="input text-xs font-mono" placeholder={t('rightPanel.displayFormatPlaceholder')}
                value={element.bind?.format || ''}
                onChange={(e) => update({ bind: { key: element.bind?.key || '', format: e.target.value } })} />
              <p className="text-[9px] text-[#9e9e9e] mt-1">{t('rightPanel.bindingVariable')} <span className="text-[#4CAF50] font-mono">{element.bind.key}</span></p>
            </Field>
          )}
        </div>

        {/* Element type hints */}
        {element.type === 'Slider' && (
          <div className="p-2.5 rounded-lg bg-arsist-hover space-y-1">
            <p className="text-xs font-semibold text-[#4CAF50] flex items-center gap-1">
              {t('rightPanel.sliderTips')}
            </p>
            <p className="text-[9px] text-[#9e9e9e] leading-tight">
              {t('rightPanel.sliderTipsDesc')}
            </p>
          </div>
        )}
        {element.type === 'Gauge' && (
          <div className="p-2.5 rounded-lg bg-arsist-hover space-y-1">
            <p className="text-xs font-semibold text-[#2196F3] flex items-center gap-1">
              {t('rightPanel.gaugeTips')}
            </p>
            <p className="text-[9px] text-[#9e9e9e] leading-tight">
              {t('rightPanel.gaugeTipsDesc')}
            </p>
          </div>
        )}
        {element.type === 'Graph' && (
          <div className="p-2.5 rounded-lg bg-arsist-hover space-y-1">
            <p className="text-xs font-semibold text-[#FF9800] flex items-center gap-1">
              {t('rightPanel.graphTips')}
            </p>
            <p className="text-[9px] text-[#9e9e9e] leading-tight">
              {t('rightPanel.graphTipsDesc')}
            </p>
          </div>
        )}

        {/* Layout */}
        {element.type === 'Panel' && (
          <Field label={t('rightPanel.layout')}>
            <select className="input text-xs" value={element.layout || 'FlexColumn'}
              onChange={(e) => update({ layout: e.target.value as UIElement['layout'] })}>
              <option value="FlexColumn">{t('rightPanel.flexColumn')}</option>
              <option value="FlexRow">{t('rightPanel.flexRow')}</option>
              <option value="Absolute">{t('rightPanel.absolute')}</option>
            </select>
          </Field>
        )}

        {/* Size */}
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('rightPanel.width')}>
            <input className="input text-xs py-1" placeholder={t('rightPanel.auto')} value={element.style.width ?? ''}
              onChange={(e) => updateStyle({ width: e.target.value === '' ? undefined : (isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) })} />
          </Field>
          <Field label={t('rightPanel.height')}>
            <input className="input text-xs py-1" placeholder={t('rightPanel.auto')} value={element.style.height ?? ''}
              onChange={(e) => updateStyle({ height: e.target.value === '' ? undefined : (isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) })} />
          </Field>
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('rightPanel.backgroundColor')}>
            <div className="flex items-center gap-1">
              <input type="color" value={element.style.backgroundColor || '#000000'} className="w-6 h-6 rounded border border-arsist-border"
                onChange={(e) => updateStyle({ backgroundColor: e.target.value })} />
              <input className="input text-xs py-1 flex-1 font-mono" value={element.style.backgroundColor || ''}
                onChange={(e) => updateStyle({ backgroundColor: e.target.value })} />
            </div>
          </Field>
          <Field label={t('rightPanel.textColor')}>
            <div className="flex items-center gap-1">
              <input type="color" value={element.style.color || '#ffffff'} className="w-6 h-6 rounded border border-arsist-border"
                onChange={(e) => updateStyle({ color: e.target.value })} />
              <input className="input text-xs py-1 flex-1 font-mono" value={element.style.color || ''}
                onChange={(e) => updateStyle({ color: e.target.value })} />
            </div>
          </Field>
        </div>

        {/* Font */}
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('rightPanel.fontSize')}>
            <input type="number" className="input text-xs py-1" value={element.style.fontSize ?? ''} placeholder="14"
              onChange={(e) => updateStyle({ fontSize: e.target.value ? parseInt(e.target.value) : undefined })} />
          </Field>
          <Field label={t('rightPanel.weight')}>
            <select className="input text-xs py-1" value={element.style.fontWeight || 'normal'}
              onChange={(e) => updateStyle({ fontWeight: e.target.value })}>
              <option value="normal">{t('rightPanel.normal')}</option>
              <option value="bold">{t('rightPanel.bold')}</option>
              <option value="300">{t('rightPanel.light')}</option>
              <option value="500">{t('rightPanel.medium')}</option>
              <option value="700">{t('rightPanel.bold')}</option>
            </select>
          </Field>
        </div>

        {/* Border / Radius */}
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('rightPanel.radius')}>
            <input type="number" className="input text-xs py-1" value={element.style.borderRadius ?? ''} placeholder="0"
              onChange={(e) => updateStyle({ borderRadius: e.target.value ? parseInt(e.target.value) : undefined })} />
          </Field>
          <Field label={t('rightPanel.opacity')}>
            <input type="number" step="0.1" min="0" max="1" className="input text-xs py-1" value={element.style.opacity ?? 1}
              onChange={(e) => updateStyle({ opacity: parseFloat(e.target.value) })} />
          </Field>
        </div>

        {/* Gap */}
        {element.type === 'Panel' && (
          <Field label={t('rightPanel.gap')}>
            <input type="number" className="input text-xs py-1" value={element.style.gap ?? ''} placeholder="0"
              onChange={(e) => updateStyle({ gap: e.target.value ? parseInt(e.target.value) : undefined })} />
          </Field>
        )}

        <button onClick={() => removeUIElement(element.id)} className="btn btn-ghost text-arsist-error text-xs w-full justify-center">
          {t('rightPanel.deleteElement')}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   DataFlow Inspector
   ════════════════════════════════════════ */

function DataFlowInspector() {
  const t = useT();
  const { project, selectedDataSourceId, updateDataSource, selectedTransformId, updateTransform } = useProjectStore();
  const source = project?.dataFlow.dataSources.find((d) => d.id === selectedDataSourceId);
  const transform = project?.dataFlow.transforms.find((t) => t.id === selectedTransformId);

  if (source) return <DataSourceEditor source={source} onUpdate={(u) => updateDataSource(source.id, u)} />;
  if (transform) return <TransformEditor transform={transform} onUpdate={(u) => updateTransform(transform.id, u)} />;
  return <EmptyState icon={<Database size={28} />} text={t('rightPanel.selectDataSourceTransform')} sub={t('rightPanel.clickLeftPanelOrCenter')} />;
}

function DataSourceEditor({ source, onUpdate }: { source: DataSourceDefinition; onUpdate: (u: Partial<DataSourceDefinition>) => void }) {
  const t = useT();
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header"><span>{t('rightPanel.dataSourceSettings')}</span></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="text-[10px] text-arsist-accent flex items-center gap-1.5">
          <Database size={12} />
          <span className="font-medium">{source.type}</span>
        </div>

        <Field label={t('rightPanel.storeAsVariable')}>
          <input className="input text-xs font-mono" value={source.storeAs} onChange={(e) => onUpdate({ storeAs: e.target.value })} />
        </Field>

        <Field label={t('rightPanel.mode')}>
          <select className="input text-xs" value={source.mode} onChange={(e) => onUpdate({ mode: e.target.value as 'polling' | 'event' })}>
            <option value="polling">{t('rightPanel.pollingInterval')}</option>
            <option value="event">{t('rightPanel.eventOnDemand')}</option>
          </select>
        </Field>

        <Field label={t('rightPanel.updateRateHz')}>
          <input type="number" className="input text-xs py-1" value={source.updateRate ?? ''} placeholder="60"
            onChange={(e) => onUpdate({ updateRate: e.target.value ? parseFloat(e.target.value) : undefined })} />
        </Field>

        {/* Type-specific parameters */}
        {source.type === 'REST_Client' && (
          <>
            <Field label={t('rightPanel.url')}>
              <input className="input text-xs font-mono" placeholder="https://api.example.com/data"
                value={(source.parameters?.url as string) || ''}
                onChange={(e) => onUpdate({ parameters: { ...source.parameters, url: e.target.value } })} />
            </Field>
            <Field label={t('rightPanel.method')}>
              <select className="input text-xs" value={(source.parameters?.method as string) || 'GET'}
                onChange={(e) => onUpdate({ parameters: { ...source.parameters, method: e.target.value } })}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </Field>
          </>
        )}

        {source.type === 'WebSocket_Stream' && (
          <Field label={t('rightPanel.url')}>
            <input className="input text-xs font-mono" placeholder="wss://stream.example.com"
              value={(source.parameters?.url as string) || ''}
              onChange={(e) => onUpdate({ parameters: { ...source.parameters, url: e.target.value } })} />
          </Field>
        )}

        {source.type === 'MQTT_Subscriber' && (
          <>
            <Field label={t('rightPanel.broker')}>
              <input className="input text-xs font-mono" placeholder="broker.example.com"
                value={(source.parameters?.broker as string) || ''}
                onChange={(e) => onUpdate({ parameters: { ...source.parameters, broker: e.target.value } })} />
            </Field>
            <Field label={t('rightPanel.topic')}>
              <input className="input text-xs font-mono" placeholder="sensors/temperature"
                value={(source.parameters?.topic as string) || ''}
                onChange={(e) => onUpdate({ parameters: { ...source.parameters, topic: e.target.value } })} />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

function TransformEditor({ transform, onUpdate }: { transform: TransformDefinition; onUpdate: (u: Partial<TransformDefinition>) => void }) {
  const t = useT();
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header"><span>{t('rightPanel.transformSettings')}</span></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="text-[10px] text-arsist-warning flex items-center gap-1.5">
          <Activity size={12} />
          <span className="font-medium">{transform.type}</span>
        </div>

        <Field label={t('rightPanel.storeAsVariable')}>
          <input className="input text-xs font-mono" value={transform.storeAs} onChange={(e) => onUpdate({ storeAs: e.target.value })} />
        </Field>

        <Field label={t('rightPanel.inputKeys')}>
          <input className="input text-xs font-mono" placeholder="raw_speed, raw_temp"
            value={transform.inputs.join(', ')}
            onChange={(e) => onUpdate({ inputs: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </Field>

        {(transform.type === 'Formula' || transform.type === 'String_Template') && (
          <Field label={t('rightPanel.expressionTemplate')}>
            <input className="input text-xs font-mono" placeholder="(val * 1.8) + 32"
              value={transform.expression || ''}
              onChange={(e) => onUpdate({ expression: e.target.value })} />
          </Field>
        )}

        {transform.type === 'Clamper' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('rightPanel.min')}>
              <input type="number" className="input text-xs py-1" value={(transform.parameters?.min as number) ?? ''}
                onChange={(e) => onUpdate({ parameters: { ...transform.parameters, min: parseFloat(e.target.value) } })} />
            </Field>
            <Field label={t('rightPanel.max')}>
              <input type="number" className="input text-xs py-1" value={(transform.parameters?.max as number) ?? ''}
                onChange={(e) => onUpdate({ parameters: { ...transform.parameters, max: parseFloat(e.target.value) } })} />
            </Field>
          </div>
        )}

        {transform.type === 'Remap' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('rightPanel.inputMin')}>
                <input type="number" className="input text-xs py-1" value={(transform.parameters?.inputMin as number) ?? 0}
                  onChange={(e) => onUpdate({ parameters: { ...transform.parameters, inputMin: parseFloat(e.target.value) } })} />
              </Field>
              <Field label={t('rightPanel.inputMax')}>
                <input type="number" className="input text-xs py-1" value={(transform.parameters?.inputMax as number) ?? 1}
                  onChange={(e) => onUpdate({ parameters: { ...transform.parameters, inputMax: parseFloat(e.target.value) } })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('rightPanel.outputMin')}>
                <input type="number" className="input text-xs py-1" value={(transform.parameters?.outputMin as number) ?? 0}
                  onChange={(e) => onUpdate({ parameters: { ...transform.parameters, outputMin: parseFloat(e.target.value) } })} />
              </Field>
              <Field label={t('rightPanel.outputMax')}>
                <input type="number" className="input text-xs py-1" value={(transform.parameters?.outputMax as number) ?? 100}
                  onChange={(e) => onUpdate({ parameters: { ...transform.parameters, outputMax: parseFloat(e.target.value) } })} />
              </Field>
            </div>
          </>
        )}

        {transform.type === 'Threshold' && (
          <Field label={t('rightPanel.threshold')}>
            <input type="number" className="input text-xs py-1" value={(transform.parameters?.threshold as number) ?? ''}
              onChange={(e) => onUpdate({ parameters: { ...transform.parameters, threshold: parseFloat(e.target.value) } })} />
          </Field>
        )}

        {transform.type === 'History_Buffer' && (
          <Field label={t('rightPanel.bufferSize')}>
            <input type="number" className="input text-xs py-1" value={(transform.parameters?.size as number) ?? 60}
              onChange={(e) => onUpdate({ parameters: { ...transform.parameters, size: parseInt(e.target.value) } })} />
          </Field>
        )}

        <Field label={t('rightPanel.updateRateHz')}>
          <input type="number" className="input text-xs py-1" value={transform.updateRate ?? ''} placeholder="Auto"
            onChange={(e) => onUpdate({ updateRate: e.target.value ? parseFloat(e.target.value) : undefined })} />
        </Field>
      </div>
    </div>
  );
}

/* ── Shared sub-components ── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="input-label">{label}</label>
      {children}
    </div>
  );
}

function EmptyState({ icon, text, sub }: { icon: React.ReactNode; text: string; sub: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-arsist-muted p-4">
      <div className="mb-2 opacity-30">{icon}</div>
      <p className="text-sm mb-0.5">{text}</p>
      <p className="text-[10px] text-center">{sub}</p>
    </div>
  );
}
