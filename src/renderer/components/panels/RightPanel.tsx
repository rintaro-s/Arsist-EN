/**
 * RightPanel — ビュー別プロパティインスペクター
 * Scene: Object Inspector (Transform, Material, Canvas設定)
 * UI: Element Inspector (スタイル, Bind, レイアウト)
 * DataFlow: Source / Transform 設定
 */
import React, { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import type { Vector3, UIElement, UIStyle, DataSourceDefinition, TransformDefinition } from '../../../shared/types';
import { Box, Compass, Layout, Database, Activity, Wifi, User } from 'lucide-react';
import { ScriptInspector } from '../viewport/ScriptEditor';

export function RightPanel() {
  const { currentView } = useUIStore();
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {currentView === 'scene' && <ObjectInspector />}
      {currentView === 'ui' && <UIInspector />}
      {currentView === 'dataflow' && <DataFlowInspector />}
      {currentView === 'script' && <ScriptInspector />}
    </div>
  );
}

/* ════════════════════════════════════════
   Project AR Settings (オブジェクト未選択時に表示)
   ════════════════════════════════════════ */

function ProjectARSettings() {
  const { project, updateARSettings } = useProjectStore();
  if (!project) return <EmptyState icon={<Box size={28} />} text="オブジェクトを選択" sub="シーン内のオブジェクトをクリック" />;

  const ar = project.arSettings;
  const hasVRM = project.scenes.some((scene) => scene.objects.some((obj) => obj.type === 'vrm'));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header"><span>Project Settings</span></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">

        {/* AR コンテキスト */}
        <div className="text-[10px] text-arsist-muted flex items-center gap-1.5">
          <Compass size={12} />
          <span>{ar.trackingMode.toUpperCase()} / {ar.presentationMode.replace(/_/g, ' ')}</span>
        </div>

        {/* リモートコントロール（VRMが存在する場合のみ表示） */}
        {hasVRM && (
          <div className="p-3 rounded-lg border border-arsist-border space-y-2">
            <div className="flex items-center gap-1.5">
              <Wifi size={14} className="text-arsist-accent" />
              <label className="text-xs font-semibold text-arsist-text">Python リモートコントロール</label>
            </div>
            <p className="text-[9px] text-arsist-muted leading-tight">
              有効にするとビルド成果物に WS サーバーが起動し、Python から接続できます。同一 LAN 上のクライアントのみ接続可能です。
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
                リモートコントロールを有効にする
              </label>
            </div>
            {ar.enableRemoteControl && (
              <>
                <Field label="WebSocket ポート">
                  <input
                    type="number"
                    className="input text-xs py-1"
                    value={ar.remoteControlPort ?? 8765}
                    onChange={(e) => updateARSettings({ remoteControlPort: parseInt(e.target.value, 10) || 8765 })}
                    min={1024}
                    max={65535}
                  />
                </Field>
                <Field label="認証パスワード (任意)">
                  <input
                    type="password"
                    className="input text-xs py-1"
                    value={ar.remoteControlPassword ?? ''}
                    onChange={(e) => updateARSettings({ remoteControlPassword: e.target.value })}
                    placeholder="未設定なら認証なし"
                  />
                </Field>
              </>
            )}
            {ar.enableRemoteControl && (
              <p className="text-[9px] text-arsist-warning leading-tight">
                ⚠ 注意: 有効時は同一 LAN 内から接続可能です。公開ネットワークでは必ずパスワードを設定してください。
              </p>
            )}
          </div>
        )}

        {!hasVRM && (
          <div className="p-3 rounded-lg border border-arsist-border/60 bg-arsist-surface/40">
            <p className="text-[10px] text-arsist-muted leading-tight">
              リモートコントロールは VRM オブジェクトが 1 つ以上ある場合に表示されます。
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
      <div className="panel-header"><span>Inspector</span></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* AR context */}
        {project && (
          <div className="text-[10px] text-arsist-muted flex items-center gap-1.5">
            <Compass size={12} />
            <span>{project.arSettings.trackingMode.toUpperCase()} / {project.arSettings.presentationMode.replace(/_/g, ' ')}</span>
          </div>
        )}

        {/* Name */}
        <Field label="名前">
          <input className="input text-sm" value={obj.name} onChange={(e) => updateObject(obj.id, { name: e.target.value })} />
        </Field>

        {/* Asset ID (for scripting) */}
        <div className="p-3 rounded-lg border border-[#FF9800]/30 bg-[#E65100]/10 space-y-2">
          <div className="flex items-center gap-1.5">
            <Box size={14} className="text-[#FF9800]" />
            <label className="text-xs font-semibold text-[#FF9800]">Asset ID (スクリプト用)</label>
          </div>
          <p className="text-[9px] text-[#9e9e9e] leading-tight">
            スクリプトやPythonからこのオブジェクトを制御するためのIDです
          </p>
          <Field label="ID">
            <input className="input text-xs font-mono" placeholder="例: avatar, robot_01"
              value={obj.assetId || ''}
              onChange={(e) => updateObject(obj.id, { assetId: e.target.value || undefined })} />
          </Field>
          {obj.assetId && (
            <p className="text-[9px] text-[#4CAF50] mt-1">
              スクリプトで <span className="font-mono bg-[#2d2d2d] px-1 rounded">scene.setPosition('{obj.assetId}', 0, 0, 2)</span> のように使用できます
            </p>
          )}
          {obj.type === 'vrm' && obj.assetId && (
            <p className="text-[9px] text-[#2196F3] mt-1">
              VRM制御: <span className="font-mono bg-[#2d2d2d] px-1 rounded">vrm.setExpression('{obj.assetId}', 'Joy', 100)</span>
            </p>
          )}
        </div>

        {/* Transform */}
        {(['position', 'rotation', 'scale'] as const).map((key) => (
          <div key={key}>
            <label className="input-label">{key}</label>
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
            <label className="input-label">マテリアル</label>
            <div className="flex items-center gap-2">
              <input type="color" value={obj.material.color} className="w-8 h-8 rounded border border-arsist-border cursor-pointer"
                onChange={(e) => updateObject(obj.id, { material: { ...obj.material!, color: e.target.value } })} />
              <span className="text-xs font-mono text-arsist-muted">{obj.material.color}</span>
            </div>
          </div>
        )}

        {/* Canvas settings */}
        {obj.type === 'canvas' && obj.canvasSettings && (
          <div className="space-y-2">
            <label className="input-label">Canvas 設定</label>
            <Field label="UIレイアウト">
              <select className="input text-xs" value={obj.canvasSettings.layoutId}
                onChange={(e) => updateObject(obj.id, { canvasSettings: { ...obj.canvasSettings!, layoutId: e.target.value } })}>
                {canvasLayouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="幅 (m)">
                <input type="number" step="0.1" className="input text-xs py-1" value={obj.canvasSettings.widthMeters}
                  onChange={(e) => updateObject(obj.id, { canvasSettings: { ...obj.canvasSettings!, widthMeters: parseFloat(e.target.value) || 1 } })} />
              </Field>
              <Field label="高さ (m)">
                <input type="number" step="0.1" className="input text-xs py-1" value={obj.canvasSettings.heightMeters}
                  onChange={(e) => updateObject(obj.id, { canvasSettings: { ...obj.canvasSettings!, heightMeters: parseFloat(e.target.value) || 1 } })} />
              </Field>
            </div>
          </div>
        )}

        {/* VRM Capabilities (VRMタイプの場合のみ表示) */}
        {obj.type === 'vrm' && <VRMCapabilitiesPanel assetId={obj.assetId} modelPath={obj.modelPath} />}

        {/* Delete */}
        <button onClick={() => removeObject(obj.id)} className="btn btn-ghost text-arsist-error text-xs w-full justify-center">
          削除
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   VRM Capabilities Panel
   ════════════════════════════════════════ */

/** VRM固有の情報: 表情・ボーン・リモートコントロール用ヒント */
function VRMCapabilitiesPanel({ assetId, modelPath }: { assetId?: string; modelPath?: string }) {
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
    <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-900/10 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <User size={14} className="text-purple-400" />
        <label className="text-xs font-semibold text-purple-400">VRM 情報</label>
      </div>

      {/* Model file */}
      {fileName && (
        <div className="text-[9px] text-arsist-muted">
          モデル: <span className="font-mono text-arsist-text">{fileName}</span>
        </div>
      )}

      {/* Asset ID reminder */}
      {assetId ? (
        <div className="text-[9px] text-[#4CAF50]">
          制御ID: <span className="font-mono font-bold">{assetId}</span>
        </div>
      ) : (
        <div className="text-[9px] text-[#FF9800]">
          ⚠ Asset ID を設定するとスクリプトから制御できます
        </div>
      )}

      {/* Expressions section */}
      <div>
        <button
          className="flex items-center gap-1 text-xs text-arsist-text hover:text-arsist-accent w-full text-left"
          onClick={() => setExpanded(prev => ({ ...prev, expressions: !prev.expressions }))}
        >
          <span className="text-[10px]">{expanded.expressions ? '▼' : '▶'}</span>
          <span className="font-semibold">表情 (Expressions)</span>
          <span className="text-[10px] text-arsist-muted ml-auto">{vrmExpressions.length} 標準</span>
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
              ※ 実際の表情はモデルに依存します。ビルド後にクエリAPIで正確な一覧を取得できます
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
          <span className="font-semibold">ボーン (Humanoid Bones)</span>
          <span className="text-[10px] text-arsist-muted ml-auto">{humanoidBones.length} 主要</span>
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
              ※ VRM 0.x / 1.0 両対応。ビルド後にクエリAPIで正確な一覧を取得できます
            </p>
          </div>
        )}
      </div>

      {/* Python remote control snippet */}
      {assetId && (
        <div className="mt-2 p-2 rounded bg-[#1e1e1e] border border-arsist-border">
          <div className="text-[9px] text-arsist-muted mb-1">Python リモート制御サンプル:</div>
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

  if (!element) return <EmptyState icon={<Layout size={28} />} text="UI要素を選択" sub="キャンバスまたは左パネルでクリック" />;

  const update = (updates: Partial<UIElement>) => updateUIElement(element.id, updates);
  const updateStyle = (s: Partial<UIStyle>) => update({ style: { ...element.style, ...s } });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header"><span>UI Inspector</span></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Type */}
        <div className="text-[10px] text-arsist-muted flex items-center gap-1.5">
          <Layout size={12} />
          <span className="font-medium text-arsist-text">{element.type}</span>
          <span className="font-mono">{element.id.slice(0, 8)}</span>
        </div>

        {/* Content */}
        {(element.type === 'Text' || element.type === 'Button') && (
          <Field label="テキスト">
            <input className="input text-xs" value={element.content || ''} onChange={(e) => update({ content: e.target.value })} />
          </Field>
        )}

        {/* Binding ID (for scripting) */}
        <div className="p-3 rounded-lg border border-[#FF9800]/30 bg-[#E65100]/10 space-y-2">
          <div className="flex items-center gap-1.5">
            <Layout size={14} className="text-[#FF9800]" />
            <label className="text-xs font-semibold text-[#FF9800]">Binding ID (スクリプト用)</label>
          </div>
          <p className="text-[9px] text-[#9e9e9e] leading-tight">
            スクリプトからこのUI要素を操作するためのIDです
          </p>
          <Field label="ID">
            <input className="input text-xs font-mono" placeholder="例: welcomeText"
              value={element.bindingId || ''}
              onChange={(e) => update({ bindingId: e.target.value || undefined })} />
          </Field>
          {element.bindingId && (
            <p className="text-[9px] text-[#4CAF50] mt-1">
              スクリプトで <span className="font-mono bg-[#2d2d2d] px-1 rounded">ui.setText('{element.bindingId}', '...')</span> のように使用できます
            </p>
          )}
        </div>

        {/* Bind (DataStore) */}
        <div className="p-3 rounded-lg border border-[#2196F3]/30 bg-[#0D47A1]/10 space-y-2">
          <div className="flex items-center gap-1.5">
            <Database size={14} className="text-[#2196F3]" />
            <label className="text-xs font-semibold text-[#2196F3]">DataStore バインディング</label>
          </div>
          <p className="text-[9px] text-[#9e9e9e] leading-tight">
            DataStoreの変数をUIに表示します
          </p>
          <Field label="変数を選択">
            <select className="input text-xs"
              value={element.bind?.key || ''}
              onChange={(e) => update({ bind: e.target.value ? { key: e.target.value, format: element.bind?.format } : undefined })}>
              <option value="">バインディングなし</option>
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
            <Field label="表示形式（オプション）">
              <input className="input text-xs font-mono" placeholder="例: {value} km/h"
                value={element.bind?.format || ''}
                onChange={(e) => update({ bind: { key: element.bind?.key || '', format: e.target.value } })} />
              <p className="text-[9px] text-[#9e9e9e] mt-1">変数 <span className="text-[#4CAF50] font-mono">{element.bind.key}</span> をバインド</p>
            </Field>
          )}
        </div>

        {/* 要素タイプ別ヒント */}
        {element.type === 'Slider' && (
          <div className="p-2.5 rounded-lg bg-[#4CAF50]/10 border border-[#4CAF50]/30 space-y-1">
            <p className="text-xs font-semibold text-[#4CAF50] flex items-center gap-1">
              💡 スライダーの使い方
            </p>
            <p className="text-[9px] text-[#9e9e9e] leading-tight">
              DataFlowエディタで値を持つDataSourceを作成 → このスライダーにバインド → 自動的に値が表示・操作可能になります
            </p>
          </div>
        )}
        {element.type === 'Gauge' && (
          <div className="p-2.5 rounded-lg bg-[#2196F3]/10 border border-[#2196F3]/30 space-y-1">
            <p className="text-xs font-semibold text-[#2196F3] flex items-center gap-1">
              📊 ゲージの使い方
            </p>
            <p className="text-[9px] text-[#9e9e9e] leading-tight">
              0～100の値をバインドするとゲージが自動的に更新されます。温度、バッテリー残量などの表示に最適です
            </p>
          </div>
        )}
        {element.type === 'Graph' && (
          <div className="p-2.5 rounded-lg bg-[#FF9800]/10 border border-[#FF9800]/30 space-y-1">
            <p className="text-xs font-semibold text-[#FF9800] flex items-center gap-1">
              📈 グラフの使い方
            </p>
            <p className="text-[9px] text-[#9e9e9e] leading-tight">
              DataFlowエディタで History_Buffer を作成し、過去データを保持 → このグラフにバインドしてリアルタイムグラフを作成
            </p>
          </div>
        )}

        {/* Layout */}
        {element.type === 'Panel' && (
          <Field label="レイアウト">
            <select className="input text-xs" value={element.layout || 'FlexColumn'}
              onChange={(e) => update({ layout: e.target.value as UIElement['layout'] })}>
              <option value="FlexColumn">Flex Column</option>
              <option value="FlexRow">Flex Row</option>
              <option value="Absolute">Absolute</option>
            </select>
          </Field>
        )}

        {/* Size */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="幅">
            <input className="input text-xs py-1" placeholder="auto" value={element.style.width ?? ''}
              onChange={(e) => updateStyle({ width: e.target.value === '' ? undefined : (isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) })} />
          </Field>
          <Field label="高さ">
            <input className="input text-xs py-1" placeholder="auto" value={element.style.height ?? ''}
              onChange={(e) => updateStyle({ height: e.target.value === '' ? undefined : (isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value)) })} />
          </Field>
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="背景色">
            <div className="flex items-center gap-1">
              <input type="color" value={element.style.backgroundColor || '#000000'} className="w-6 h-6 rounded border border-arsist-border"
                onChange={(e) => updateStyle({ backgroundColor: e.target.value })} />
              <input className="input text-xs py-1 flex-1 font-mono" value={element.style.backgroundColor || ''}
                onChange={(e) => updateStyle({ backgroundColor: e.target.value })} />
            </div>
          </Field>
          <Field label="文字色">
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
          <Field label="フォントサイズ">
            <input type="number" className="input text-xs py-1" value={element.style.fontSize ?? ''} placeholder="14"
              onChange={(e) => updateStyle({ fontSize: e.target.value ? parseInt(e.target.value) : undefined })} />
          </Field>
          <Field label="太さ">
            <select className="input text-xs py-1" value={element.style.fontWeight || 'normal'}
              onChange={(e) => updateStyle({ fontWeight: e.target.value })}>
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
              <option value="300">Light</option>
              <option value="500">Medium</option>
              <option value="700">Bold</option>
            </select>
          </Field>
        </div>

        {/* Border / Radius */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="角丸">
            <input type="number" className="input text-xs py-1" value={element.style.borderRadius ?? ''} placeholder="0"
              onChange={(e) => updateStyle({ borderRadius: e.target.value ? parseInt(e.target.value) : undefined })} />
          </Field>
          <Field label="透明度">
            <input type="number" step="0.1" min="0" max="1" className="input text-xs py-1" value={element.style.opacity ?? 1}
              onChange={(e) => updateStyle({ opacity: parseFloat(e.target.value) })} />
          </Field>
        </div>

        {/* Gap */}
        {element.type === 'Panel' && (
          <Field label="Gap">
            <input type="number" className="input text-xs py-1" value={element.style.gap ?? ''} placeholder="0"
              onChange={(e) => updateStyle({ gap: e.target.value ? parseInt(e.target.value) : undefined })} />
          </Field>
        )}

        <button onClick={() => removeUIElement(element.id)} className="btn btn-ghost text-arsist-error text-xs w-full justify-center">
          要素を削除
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   DataFlow Inspector
   ════════════════════════════════════════ */

function DataFlowInspector() {
  const { project, selectedDataSourceId, updateDataSource, selectedTransformId, updateTransform } = useProjectStore();
  const source = project?.dataFlow.dataSources.find((d) => d.id === selectedDataSourceId);
  const transform = project?.dataFlow.transforms.find((t) => t.id === selectedTransformId);

  if (source) return <DataSourceEditor source={source} onUpdate={(u) => updateDataSource(source.id, u)} />;
  if (transform) return <TransformEditor transform={transform} onUpdate={(u) => updateTransform(transform.id, u)} />;
  return <EmptyState icon={<Database size={28} />} text="DataSource / Transform を選択" sub="左パネルまたは中央エディタでクリック" />;
}

function DataSourceEditor({ source, onUpdate }: { source: DataSourceDefinition; onUpdate: (u: Partial<DataSourceDefinition>) => void }) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header"><span>DataSource 設定</span></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="text-[10px] text-arsist-accent flex items-center gap-1.5">
          <Database size={12} />
          <span className="font-medium">{source.type}</span>
        </div>

        <Field label="Store As (変数名)">
          <input className="input text-xs font-mono" value={source.storeAs} onChange={(e) => onUpdate({ storeAs: e.target.value })} />
        </Field>

        <Field label="モード">
          <select className="input text-xs" value={source.mode} onChange={(e) => onUpdate({ mode: e.target.value as 'polling' | 'event' })}>
            <option value="polling">Polling (定期取得)</option>
            <option value="event">Event (随時)</option>
          </select>
        </Field>

        <Field label="更新レート (Hz)">
          <input type="number" className="input text-xs py-1" value={source.updateRate ?? ''} placeholder="60"
            onChange={(e) => onUpdate({ updateRate: e.target.value ? parseFloat(e.target.value) : undefined })} />
        </Field>

        {/* タイプ固有パラメータ */}
        {source.type === 'REST_Client' && (
          <>
            <Field label="URL">
              <input className="input text-xs font-mono" placeholder="https://api.example.com/data"
                value={(source.parameters?.url as string) || ''}
                onChange={(e) => onUpdate({ parameters: { ...source.parameters, url: e.target.value } })} />
            </Field>
            <Field label="メソッド">
              <select className="input text-xs" value={(source.parameters?.method as string) || 'GET'}
                onChange={(e) => onUpdate({ parameters: { ...source.parameters, method: e.target.value } })}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </Field>
          </>
        )}

        {source.type === 'WebSocket_Stream' && (
          <Field label="URL">
            <input className="input text-xs font-mono" placeholder="wss://stream.example.com"
              value={(source.parameters?.url as string) || ''}
              onChange={(e) => onUpdate({ parameters: { ...source.parameters, url: e.target.value } })} />
          </Field>
        )}

        {source.type === 'MQTT_Subscriber' && (
          <>
            <Field label="Broker">
              <input className="input text-xs font-mono" placeholder="broker.example.com"
                value={(source.parameters?.broker as string) || ''}
                onChange={(e) => onUpdate({ parameters: { ...source.parameters, broker: e.target.value } })} />
            </Field>
            <Field label="Topic">
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
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header"><span>Transform 設定</span></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="text-[10px] text-arsist-warning flex items-center gap-1.5">
          <Activity size={12} />
          <span className="font-medium">{transform.type}</span>
        </div>

        <Field label="Store As (変数名)">
          <input className="input text-xs font-mono" value={transform.storeAs} onChange={(e) => onUpdate({ storeAs: e.target.value })} />
        </Field>

        <Field label="入力キー (カンマ区切り)">
          <input className="input text-xs font-mono" placeholder="raw_speed, raw_temp"
            value={transform.inputs.join(', ')}
            onChange={(e) => onUpdate({ inputs: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </Field>

        {(transform.type === 'Formula' || transform.type === 'String_Template') && (
          <Field label="式 / テンプレート">
            <input className="input text-xs font-mono" placeholder="(val * 1.8) + 32"
              value={transform.expression || ''}
              onChange={(e) => onUpdate({ expression: e.target.value })} />
          </Field>
        )}

        {transform.type === 'Clamper' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min">
              <input type="number" className="input text-xs py-1" value={(transform.parameters?.min as number) ?? ''}
                onChange={(e) => onUpdate({ parameters: { ...transform.parameters, min: parseFloat(e.target.value) } })} />
            </Field>
            <Field label="Max">
              <input type="number" className="input text-xs py-1" value={(transform.parameters?.max as number) ?? ''}
                onChange={(e) => onUpdate({ parameters: { ...transform.parameters, max: parseFloat(e.target.value) } })} />
            </Field>
          </div>
        )}

        {transform.type === 'Remap' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="入力 Min">
                <input type="number" className="input text-xs py-1" value={(transform.parameters?.inputMin as number) ?? 0}
                  onChange={(e) => onUpdate({ parameters: { ...transform.parameters, inputMin: parseFloat(e.target.value) } })} />
              </Field>
              <Field label="入力 Max">
                <input type="number" className="input text-xs py-1" value={(transform.parameters?.inputMax as number) ?? 1}
                  onChange={(e) => onUpdate({ parameters: { ...transform.parameters, inputMax: parseFloat(e.target.value) } })} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="出力 Min">
                <input type="number" className="input text-xs py-1" value={(transform.parameters?.outputMin as number) ?? 0}
                  onChange={(e) => onUpdate({ parameters: { ...transform.parameters, outputMin: parseFloat(e.target.value) } })} />
              </Field>
              <Field label="出力 Max">
                <input type="number" className="input text-xs py-1" value={(transform.parameters?.outputMax as number) ?? 100}
                  onChange={(e) => onUpdate({ parameters: { ...transform.parameters, outputMax: parseFloat(e.target.value) } })} />
              </Field>
            </div>
          </>
        )}

        {transform.type === 'Threshold' && (
          <Field label="しきい値">
            <input type="number" className="input text-xs py-1" value={(transform.parameters?.threshold as number) ?? ''}
              onChange={(e) => onUpdate({ parameters: { ...transform.parameters, threshold: parseFloat(e.target.value) } })} />
          </Field>
        )}

        {transform.type === 'History_Buffer' && (
          <Field label="バッファサイズ">
            <input type="number" className="input text-xs py-1" value={(transform.parameters?.size as number) ?? 60}
              onChange={(e) => onUpdate({ parameters: { ...transform.parameters, size: parseInt(e.target.value) } })} />
          </Field>
        )}

        <Field label="更新レート (Hz)">
          <input type="number" className="input text-xs py-1" value={transform.updateRate ?? ''} placeholder="自動"
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
