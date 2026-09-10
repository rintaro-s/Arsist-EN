/**
 * PerceptionInspector — 画像アンカーの設定UI
 *
 * 作者に新しい概念をなるべく持ち込まない方針で作ってある。
 * 実質的に新しいのは「実物の横幅」ひとつだけで、それ以外は
 * 写真を選ぶ・貼り付け先を選ぶ、という既存の操作に寄せている。
 */
import { useEffect, useState } from 'react';
import { Image as ImageIcon, Pin, Trash2, RefreshCw, ScanText, Frame } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { toArsistFileUrl } from '../../utils/assetUrl';
import { scoreImageFromUrl, type ImageQualityResult } from '../../perception/imageQuality';
import { defaultPlacement } from '../../../shared/placement';
import type {
  AnchorPlacement, PerceptionAnalysisKind, PerceptionTask, PlacementSide, SceneObject,
} from '../../../shared/types';
import { RegionEditor } from './RegionEditor';
import { useT } from '../../i18n';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="input-label">{label}</label>
      {children}
    </div>
  );
}

/** ターゲット本体の設定。左パネルで画像アンカーを選ぶと出る。 */
export function PerceptionTargetInspector() {
  const t = useT();
  const {
    project, projectPath, selectedPerceptionTargetId, selectedPerceptionRegionId,
    updatePerceptionTarget, removePerceptionTarget,
    addPerceptionRegion, updatePerceptionRegion, removePerceptionRegion, selectPerceptionRegion,
  } = useProjectStore();

  const target = project?.perception?.targets.find((x) => x.id === selectedPerceptionTargetId);
  const [rescoring, setRescoring] = useState(false);
  const [quality, setQuality] = useState<ImageQualityResult | null>(null);

  const imageUrl = target && projectPath ? toArsistFileUrl(projectPath, target.imagePath) : null;

  // 写真を差し替えたときにスコアを取り直す
  useEffect(() => {
    if (!target || !imageUrl || target.quality !== undefined) return;
    let cancelled = false;
    setRescoring(true);
    scoreImageFromUrl(imageUrl).then((result) => {
      if (cancelled) return;
      setRescoring(false);
      setQuality(result);
      if (result) updatePerceptionTarget(target.id, { quality: result.score });
    });
    return () => { cancelled = true; };
  }, [target?.id, target?.imagePath, target?.quality, imageUrl]);

  if (!target) return null;

  const anchoredCount = project?.scenes.reduce(
    (sum, scene) => sum + scene.objects.filter((o) => o.anchor?.targetId === target.id).length, 0) ?? 0;

  const score = target.quality;
  const qualityTone =
    score === undefined ? 'text-arsist-muted' :
    score >= 65 ? 'text-emerald-400' :
    score >= 40 ? 'text-amber-400' : 'text-arsist-error';

  // 低いときは「なぜ低いか」を出す。特徴が少ないのか、暗いのか、そもそも小さいのかで
  // 直し方がまったく違うため。
  const qualityMessage =
    score === undefined ? '' :
    quality?.reason === 'tooSmall'
      ? t('perception.qualityTooSmall', { width: quality.width, height: quality.height }) :
    quality?.reason === 'lowContrast' && score < 65 ? t('perception.qualityLowContrast') :
    score >= 65 ? t('perception.qualityGood') :
    score >= 40 ? t('perception.qualityFair') : t('perception.qualityPoor');

  const replacePhoto = async () => {
    if (!window.electronAPI || !projectPath) return;
    const selected = await window.electronAPI.fs.selectFile([
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg'] },
    ]);
    if (!selected) return;
    const imported = await window.electronAPI.assets.import({
      projectPath, sourcePath: selected, kind: 'texture',
    });
    if (!imported?.success || !imported.assetPath) return;
    // quality を undefined に戻すと上の effect が測り直す
    updatePerceptionTarget(target.id, { imagePath: imported.assetPath, quality: undefined });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header">
        <ImageIcon size={13} className="text-emerald-400" />
        <span>{t('perception.inspector')}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">

        <Field label={t('perception.name')}>
          <input className="input text-sm" value={target.name}
            onChange={(e) => updatePerceptionTarget(target.id, { name: e.target.value })} />
        </Field>

        {/* Reference photo */}
        <div className="space-y-2">
          <label className="input-label">{t('perception.referencePhoto')}</label>
          <button className="btn btn-ghost text-xs w-full justify-center" onClick={replacePhoto}>
            <RefreshCw size={12} /> {t('perception.replacePhoto')}
          </button>
        </div>

        {/* Trackability */}
        <div className="p-3 rounded-lg bg-arsist-hover space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-arsist-text">{t('perception.quality')}</span>
            <span className={`text-xs font-mono ${qualityTone}`}>
              {rescoring ? '…' : score === undefined ? '—' : `${score}/100`}
            </span>
          </div>
          {qualityMessage && (
            <p className={`text-[9px] leading-tight ${qualityTone}`}>{qualityMessage}</p>
          )}
          {quality && (
            <p className="text-[9px] text-arsist-muted">
              {t('perception.qualityResolution')}: {quality.width}x{quality.height}
            </p>
          )}
        </div>

        {/* Regions drawn on the photo */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Frame size={13} className="text-emerald-400" />
            <label className="text-xs font-semibold text-emerald-400">{t('perception.regions')}</label>
          </div>
          <RegionEditor
            imageUrl={imageUrl}
            regions={target.regions ?? []}
            selectedId={selectedPerceptionRegionId}
            onSelect={selectPerceptionRegion}
            onCreate={(rect) => addPerceptionRegion(target.id, rect)}
            onChange={(regionId, rect) => updatePerceptionRegion(target.id, regionId, { rect })}
          />

          {(target.regions ?? []).length === 0 && (
            <p className="text-[9px] text-arsist-muted">{t('perception.regionEmpty')}</p>
          )}

          {(target.regions ?? []).map((region) => (
            <div key={region.id}
              className={`flex items-center gap-1 rounded px-1 py-0.5 ${
                region.id === selectedPerceptionRegionId ? 'bg-arsist-active' : ''}`}
              onClick={() => selectPerceptionRegion(region.id)}>
              <Frame size={11} className="text-emerald-400 shrink-0" />
              <input className="input text-xs py-0.5 flex-1" value={region.name}
                onChange={(e) => updatePerceptionRegion(target.id, region.id, { name: e.target.value })} />
              <button className="btn-icon text-arsist-error shrink-0"
                title={t('perception.regionDelete')}
                onClick={(e) => { e.stopPropagation(); removePerceptionRegion(target.id, region.id); }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {(target.regions ?? []).length > 0 && (
            <p className="text-[9px] text-arsist-muted">{t('perception.regionDeleteWarning')}</p>
          )}
        </div>

        {/* Physical size */}
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('perception.physicalWidth')}>
            <input type="number" step="0.5" min="0.1" className="input text-xs py-1"
              value={+(target.physicalWidth * 100).toFixed(2)}
              onChange={(e) => {
                const cm = parseFloat(e.target.value);
                if (!(cm > 0)) return;
                updatePerceptionTarget(target.id, { physicalWidth: cm / 100 });
              }} />
          </Field>
          <Field label={t('perception.physicalHeight')}>
            <input type="number" step="0.5" min="0" className="input text-xs py-1"
              placeholder={t('perception.physicalHeightAuto')}
              value={target.physicalHeight ? +(target.physicalHeight * 100).toFixed(2) : ''}
              onChange={(e) => {
                const cm = parseFloat(e.target.value);
                updatePerceptionTarget(target.id, {
                  physicalHeight: cm > 0 ? cm / 100 : undefined,
                });
              }} />
          </Field>
        </div>
        <p className="text-[9px] text-arsist-muted leading-tight -mt-2">
          {t('perception.physicalWidthHint')}
        </p>

        <Field label={t('perception.holdMs')}>
          <input type="number" step="500" min="100" className="input text-xs py-1"
            value={target.holdMs ?? 2000}
            onChange={(e) => updatePerceptionTarget(target.id, {
              holdMs: Math.max(100, parseInt(e.target.value, 10) || 2000),
            })} />
        </Field>

        <p className="text-[9px] text-arsist-muted leading-tight">
          {t('perception.planarNote')}
        </p>

        {anchoredCount > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
            <Pin size={11} />
            <span>{t('perception.anchoredCount', { count: anchoredCount })}</span>
          </div>
        )}

        <div className="space-y-1">
          <button onClick={() => removePerceptionTarget(target.id)}
            className="btn btn-ghost text-arsist-error text-xs w-full justify-center">
            <Trash2 size={12} /> {t('perception.deleteTarget')}
          </button>
          {anchoredCount > 0 && (
            <p className="text-[9px] text-arsist-muted text-center">{t('perception.deleteWarning')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** オブジェクト側の「どのアンカーに、どう貼るか」設定。オブジェクトインスペクタに埋め込む。 */
export function ObjectAnchorSection({ object }: { object: SceneObject }) {
  const t = useT();
  const { project, updateObject } = useProjectStore();
  const targets = project?.perception?.targets ?? [];

  // ターゲットが1つも無いプロジェクトでは、この項目自体を出さない
  if (targets.length === 0 && !object.anchor) return null;

  const anchor = object.anchor;
  const targetMissing = !!anchor && !targets.some((x) => x.id === anchor.targetId);
  const target = anchor ? targets.find((x) => x.id === anchor.targetId) : undefined;
  const placement = anchor?.placement;

  const setPlacement = (updates: Partial<AnchorPlacement>) => {
    if (!anchor?.placement) return;
    updateObject(object.id, { anchor: { ...anchor, placement: { ...anchor.placement, ...updates } } });
  };

  return (
    <div className="p-3 rounded-lg bg-arsist-hover space-y-2">
      <div className="flex items-center gap-1.5">
        <Pin size={14} className="text-emerald-400" />
        <label className="text-xs font-semibold text-emerald-400">{t('perception.anchorTo')}</label>
      </div>

      <select className="input text-xs"
        value={anchor?.targetId ?? ''}
        onChange={(e) => {
          const targetId = e.target.value;
          updateObject(object.id, {
            anchor: targetId
              ? {
                  targetId,
                  whenNotFound: anchor?.whenNotFound ?? 'lastKnown',
                  placement: anchor?.placement ?? defaultPlacement(),
                }
              : undefined,
          });
        }}>
        <option value="">{t('perception.anchorNone')}</option>
        {targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>

      {targetMissing && (
        <p className="text-[9px] text-arsist-error">{t('perception.targetMissing')}</p>
      )}

      {anchor && !targetMissing && (
        <>
          {/* 置き方: 相対配置 / 自由なオフセット */}
          <Field label={t('perception.placementMode')}>
            <select className="input text-xs"
              value={placement ? 'relative' : 'offset'}
              onChange={(e) => updateObject(object.id, {
                anchor: {
                  ...anchor,
                  placement: e.target.value === 'relative' ? (placement ?? defaultPlacement()) : undefined,
                },
              })}>
              <option value="relative">{t('perception.placementRelative')}</option>
              <option value="offset">{t('perception.placementOffset')}</option>
            </select>
          </Field>

          {placement && (
            <>
              <p className="text-[9px] text-arsist-muted leading-tight">{t('perception.placementHint')}</p>

              <Field label={t('perception.placementBase')}>
                <select className="input text-xs" value={placement.regionId ?? ''}
                  onChange={(e) => setPlacement({ regionId: e.target.value || undefined })}>
                  <option value="">{t('perception.placementBaseWhole')}</option>
                  {(target?.regions ?? []).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </Field>

              <Field label={t('perception.side')}>
                <select className="input text-xs" value={placement.side}
                  onChange={(e) => setPlacement({ side: e.target.value as PlacementSide })}>
                  <option value="center">{t('perception.sideCenter')}</option>
                  <option value="left">{t('perception.sideLeft')}</option>
                  <option value="right">{t('perception.sideRight')}</option>
                  <option value="above">{t('perception.sideAbove')}</option>
                  <option value="below">{t('perception.sideBelow')}</option>
                  <option value="front">{t('perception.sideFront')}</option>
                  <option value="behind">{t('perception.sideBehind')}</option>
                </select>
              </Field>

              {placement.side !== 'center' && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('perception.gap')}>
                    <input type="number" step="1" className="input text-xs py-1"
                      value={+(placement.gap * 100).toFixed(1)}
                      onChange={(e) => {
                        const cm = parseFloat(e.target.value);
                        setPlacement({ gap: Number.isFinite(cm) ? cm / 100 : 0 });
                      }} />
                  </Field>
                  <Field label={t('perception.align')}>
                    <select className="input text-xs py-1" value={placement.align}
                      onChange={(e) => setPlacement({ align: e.target.value as AnchorPlacement['align'] })}>
                      <option value="near">{t('perception.alignNear')}</option>
                      <option value="center">{t('perception.alignCenter')}</option>
                    </select>
                  </Field>
                </div>
              )}

              {(placement.side === 'left' || placement.side === 'right' ||
                placement.side === 'above' || placement.side === 'below') && (
                <Field label={t('perception.cross')}>
                  <select className="input text-xs" value={placement.cross}
                    onChange={(e) => setPlacement({ cross: e.target.value as AnchorPlacement['cross'] })}>
                    <option value="start">{t('perception.crossStart')}</option>
                    <option value="center">{t('perception.crossCenter')}</option>
                    <option value="end">{t('perception.crossEnd')}</option>
                  </select>
                </Field>
              )}

              <Field label={t('perception.facing')}>
                <select className="input text-xs" value={placement.facing}
                  onChange={(e) => setPlacement({ facing: e.target.value as AnchorPlacement['facing'] })}>
                  <option value="user">{t('perception.facingUser')}</option>
                  <option value="target">{t('perception.facingTarget')}</option>
                </select>
              </Field>

              <p className="text-[9px] text-arsist-muted leading-tight">{t('perception.nudgeHint')}</p>
            </>
          )}

          <Field label={t('perception.whenNotFound')}>
            <select className="input text-xs" value={anchor.whenNotFound}
              onChange={(e) => updateObject(object.id, {
                anchor: { ...anchor, whenNotFound: e.target.value as typeof anchor.whenNotFound },
              })}>
              <option value="hidden">{t('perception.whenNotFoundHidden')}</option>
              <option value="lastKnown">{t('perception.whenNotFoundLastKnown')}</option>
              <option value="visible">{t('perception.whenNotFoundVisible')}</option>
            </select>
          </Field>

          {!placement && (
            <p className="text-[9px] text-arsist-muted leading-tight">{t('perception.anchorHint')}</p>
          )}
        </>
      )}
    </div>
  );
}

/** 画像認識タスクの設定。左パネルでタスクを選ぶと出る。 */
export function PerceptionTaskInspector() {
  const t = useT();
  const { project, selectedPerceptionTaskId, updatePerceptionTask, removePerceptionTask } = useProjectStore();

  const task = project?.perception?.tasks?.find((x) => x.id === selectedPerceptionTaskId);
  if (!task) return null;

  const targets = project?.perception?.targets ?? [];
  // ボタンの bindingId と「ターゲットを見つけた」イベントは同じイベントバスに乗るので、
  // どちらもそのままトリガにできる（ランタイム側の追加実装は不要）。
  const buttonIds = collectButtonBindingIds(project);
  const foundEvents = targets.map((x) => ({ value: `perception.found:${x.id}`, label: x.name }));
  const hasAnyEvent = buttonIds.length > 0 || foundEvents.length > 0;
  const source = task.source;
  const engine = task.engine ?? { kind: 'mlkit' as const, script: 'japanese' as const };
  const trigger = task.trigger as { type: string; value?: number | string };

  const analysis = task.analysis ?? { kind: 'color' as const };
  // 空の塗り替え先に使えるのは Image 要素だけ。bindingId が無いものは指定しようがない
  const imageBindingIds = collectImageBindingIds(project);

  const setSource = (next: PerceptionTask['source']) => updatePerceptionTask(task.id, { source: next });
  const setAnalysis = (updates: Partial<NonNullable<PerceptionTask['analysis']>>) =>
    updatePerceptionTask(task.id, { analysis: { ...analysis, ...updates } });
  const setEngine = (updates: Partial<NonNullable<PerceptionTask['engine']>>) =>
    updatePerceptionTask(task.id, { engine: { ...engine, ...updates } });

  // 枠がまだ1つも無いと「写真の上の枠」は選べない
  const regionOptions = targets.flatMap((target) =>
    (target.regions ?? []).map((region) => ({
      value: `${target.id}|${region.id}`,
      label: `${target.name} / ${region.name}`,
    })),
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="panel-header">
        <ScanText size={13} className="text-sky-400" />
        <span>{t('perception.taskInspector')}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">

        <Field label={t('perception.taskName')}>
          <input className="input text-sm" value={task.name}
            onChange={(e) => updatePerceptionTask(task.id, { name: e.target.value })} />
        </Field>

        <Field label={t('perception.taskType')}>
          <select className="input text-xs" value={task.type}
            onChange={(e) => updatePerceptionTask(task.id, { type: e.target.value as PerceptionTask['type'] })}>
            <option value="ocr">{t('perception.taskTypeOcr')}</option>
            <option value="capture">{t('perception.taskTypeCapture')}</option>
            <option value="analyze">{t('perception.taskTypeAnalyze')}</option>
          </select>
        </Field>

        {/* 見る範囲 */}
        <Field label={t('perception.taskSource')}>
          <select className="input text-xs" value={source.kind}
            onChange={(e) => setSource(e.target.value === 'region'
              ? { kind: 'region', targetId: targets[0]?.id ?? '', regionId: targets[0]?.regions?.[0]?.id ?? '' }
              : { kind: 'viewport', rect: { x: 0.25, y: 0.35, width: 0.5, height: 0.3 } })}>
            <option value="region">{t('perception.taskSourceRegion')}</option>
            <option value="viewport">{t('perception.taskSourceViewport')}</option>
          </select>
        </Field>

        {source.kind === 'viewport' && (
          <p className="text-[9px] text-amber-400 leading-tight">{t('perception.taskViewportNoGuide')}</p>
        )}

        {source.kind === 'region' && (
          regionOptions.length === 0 ? (
            <p className="text-[9px] text-arsist-error">{t('perception.taskNeedsRegion')}</p>
          ) : (
            <select className="input text-xs" value={`${source.targetId}|${source.regionId}`}
              onChange={(e) => {
                const [targetId, regionId] = e.target.value.split('|');
                setSource({ kind: 'region', targetId, regionId });
              }}>
              {regionOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )
        )}

        {/* きっかけ */}
        <Field label={t('perception.taskTrigger')}>
          <select className="input text-xs" value={trigger.type}
            onChange={(e) => {
              const type = e.target.value;
              updatePerceptionTask(task.id, {
                trigger: type === 'event'
                  ? { type: 'event', value: buttonIds[0] ?? foundEvents[0]?.value ?? '' }
                  : type === 'interval' ? { type: 'interval', value: 5000 }
                  : type === 'onStart' ? { type: 'onStart' }
                  : { type: 'manual' },
              } as Partial<PerceptionTask>);
            }}>
            <option value="manual">{t('perception.taskTriggerManual')}</option>
            <option value="event">{t('perception.taskTriggerEvent')}</option>
            <option value="onStart">{t('perception.taskTriggerOnStart')}</option>
            <option value="interval">{t('perception.taskTriggerInterval')}</option>
          </select>
        </Field>

        {trigger.type === 'event' && (
          !hasAnyEvent ? (
            <p className="text-[9px] text-arsist-error">{t('perception.taskTriggerNoButtons')}</p>
          ) : (
            <Field label={t('perception.taskTriggerButton')}>
              <select className="input text-xs" value={String(trigger.value ?? '')}
                onChange={(e) => updatePerceptionTask(task.id, {
                  trigger: { type: 'event', value: e.target.value },
                } as Partial<PerceptionTask>)}>
                {buttonIds.length > 0 && (
                  <optgroup label={t('perception.taskTriggerGroupButtons')}>
                    {buttonIds.map((id) => <option key={id} value={id}>{id}</option>)}
                  </optgroup>
                )}
                {foundEvents.length > 0 && (
                  <optgroup label={t('perception.taskTriggerGroupFound')}>
                    {foundEvents.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                  </optgroup>
                )}
              </select>
            </Field>
          )
        )}

        {trigger.type === 'interval' && (
          <>
            <Field label={t('perception.taskInterval')}>
              <input type="number" step="500" min="500" className="input text-xs py-1"
                value={Number(trigger.value ?? 5000)}
                onChange={(e) => updatePerceptionTask(task.id, {
                  trigger: { type: 'interval', value: Math.max(500, parseInt(e.target.value, 10) || 5000) },
                } as Partial<PerceptionTask>)} />
            </Field>
            <p className="text-[9px] text-amber-400 leading-tight">{t('perception.taskIntervalWarning')}</p>
          </>
        )}

        {/* 結果の保存先 */}
        <Field label={t('perception.taskStoreAs')}>
          <input className="input text-xs font-mono" value={task.storeAs}
            onChange={(e) => updatePerceptionTask(task.id, { storeAs: e.target.value })} />
        </Field>
        <p className="text-[9px] text-[#4CAF50] leading-tight -mt-2">
          {t('perception.taskStoreHint', { key: task.storeAs || 'result' })}
        </p>

        {/* 古典的な画像処理。学習モデルもネットワークも要らないので端末を選ばない */}
        {task.type === 'analyze' && (
          <>
            <Field label={t('perception.analysisKind')}>
              <select className="input text-xs" value={analysis.kind}
                onChange={(e) => setAnalysis({ kind: e.target.value as PerceptionAnalysisKind })}>
                <option value="color">{t('perception.analysisColor')}</option>
                <option value="blobs">{t('perception.analysisBlobs')}</option>
                <option value="shapes">{t('perception.analysisShapes')}</option>
                <option value="sky">{t('perception.analysisSky')}</option>
              </select>
            </Field>
            <p className="text-[9px] text-arsist-muted leading-tight -mt-2">
              {t(`perception.analysisHint.${analysis.kind}`)}
            </p>

            {analysis.kind === 'blobs' && (
              <>
                <Field label={t('perception.analysisHue')}>
                  <div className="flex gap-1 items-center">
                    <input type="number" min="0" max="359" className="input text-xs py-1"
                      value={analysis.hue?.min ?? 0}
                      onChange={(e) => setAnalysis({
                        hue: { min: clampInt(e.target.value, 0, 359, 0), max: analysis.hue?.max ?? 359 },
                      })} />
                    <span className="text-[9px] text-arsist-muted">-</span>
                    <input type="number" min="0" max="359" className="input text-xs py-1"
                      value={analysis.hue?.max ?? 359}
                      onChange={(e) => setAnalysis({
                        hue: { min: analysis.hue?.min ?? 0, max: clampInt(e.target.value, 0, 359, 359) },
                      })} />
                  </div>
                </Field>
                <p className="text-[9px] text-arsist-muted leading-tight -mt-2">
                  {t('perception.analysisHueHint')}
                </p>
                <Field label={t('perception.analysisMinArea')}>
                  <input type="number" min="1" className="input text-xs py-1"
                    value={analysis.minArea ?? 60}
                    onChange={(e) => setAnalysis({ minArea: clampInt(e.target.value, 1, 1000000, 60) })} />
                </Field>
              </>
            )}

            {analysis.kind === 'sky' && (
              <>
                <Field label={t('perception.analysisDisplay')}>
                  <select className="input text-xs" value={analysis.display ?? 'world'}
                    onChange={(e) => setAnalysis({ display: e.target.value as 'world' | 'image' })}>
                    <option value="world">{t('perception.analysisDisplayWorld')}</option>
                    <option value="image">{t('perception.analysisDisplayImage')}</option>
                  </select>
                </Field>
                <p className="text-[9px] text-arsist-muted leading-tight -mt-2">
                  {t(`perception.analysisDisplayHint.${analysis.display ?? 'world'}`)}
                </p>

                {(analysis.display ?? 'world') === 'world' && source.kind === 'region' && (
                  <p className="text-[9px] text-arsist-error leading-tight">
                    {t('perception.analysisDisplayNeedsViewport')}
                  </p>
                )}

                {(analysis.display ?? 'world') === 'image' && (
                <Field label={t('perception.analysisPreview')}>
                  {imageBindingIds.length === 0 ? (
                    <p className="text-[9px] text-amber-400 leading-tight">
                      {t('perception.analysisPreviewNone')}
                    </p>
                  ) : (
                    <select className="input text-xs" value={analysis.previewBindingId ?? ''}
                      onChange={(e) => setAnalysis({ previewBindingId: e.target.value || undefined })}>
                      <option value="">{t('perception.analysisPreviewOff')}</option>
                      {imageBindingIds.map((id) => <option key={id} value={id}>{id}</option>)}
                    </select>
                  )}
                </Field>
                )}

                <Field label={t('perception.analysisStrength')}>
                  <input type="range" min="0" max="1" step="0.05"
                    value={analysis.repaintStrength ?? 1}
                    onChange={(e) => setAnalysis({ repaintStrength: parseFloat(e.target.value) })} />
                </Field>
              </>
            )}
          </>
        )}

        {/* エンジン */}
        {task.type === 'ocr' && (
          <>
            <Field label={t('perception.taskEngine')}>
              <select className="input text-xs" value={engine.kind}
                onChange={(e) => setEngine({ kind: e.target.value as 'mlkit' | 'mock' })}>
                <option value="mlkit">{t('perception.taskEngineMlkit')}</option>
                <option value="mock">{t('perception.taskEngineMock')}</option>
              </select>
            </Field>

            {engine.kind === 'mlkit' && (
              <Field label={t('perception.taskScript')}>
                <select className="input text-xs" value={engine.script ?? 'japanese'}
                  onChange={(e) => setEngine({ script: e.target.value as 'latin' | 'japanese' })}>
                  <option value="japanese">{t('perception.taskScriptJapanese')}</option>
                  <option value="latin">{t('perception.taskScriptLatin')}</option>
                </select>
              </Field>
            )}

            {engine.kind === 'mock' && (
              <Field label={t('perception.taskMockText')}>
                <input className="input text-xs" value={engine.mockText ?? ''}
                  onChange={(e) => setEngine({ mockText: e.target.value })} />
              </Field>
            )}
          </>
        )}

        <div className="p-2 rounded bg-arsist-surface">
          <div className="text-[9px] text-arsist-muted mb-1">{t('perception.taskScriptExample')}</div>
          <code className="text-[9px] font-mono text-arsist-text break-all">
            perception.run('{task.id.slice(0, 8)}...', r =&gt; log(r.Text))
          </code>
        </div>

        <button onClick={() => removePerceptionTask(task.id)}
          className="btn btn-ghost text-arsist-error text-xs w-full justify-center">
          <Trash2 size={12} /> {t('perception.taskDelete')}
        </button>
      </div>
    </div>
  );
}

/** UI レイアウトの中から bindingId を持つ Button を集める（タスクのトリガ候補）。 */
/** 数値入力を安全に読む。空文字や NaN で設定が壊れないようにする。 */
function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const value = parseInt(raw, 10);
  if (Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 塗り替え結果を出せる Image 要素の bindingId を集める。 */
function collectImageBindingIds(project: ReturnType<typeof useProjectStore.getState>['project']): string[] {
  const ids: string[] = [];
  const walk = (element: { type: string; bindingId?: string; children?: unknown[] }) => {
    if (element.type === 'Image' && element.bindingId) ids.push(element.bindingId);
    for (const child of (element.children ?? []) as typeof element[]) walk(child);
  };
  for (const layout of project?.uiLayouts ?? []) walk(layout.root as never);
  return Array.from(new Set(ids));
}

function collectButtonBindingIds(project: ReturnType<typeof useProjectStore.getState>['project']): string[] {
  const ids: string[] = [];
  const walk = (element: { type: string; bindingId?: string; children?: unknown[] }) => {
    if (element.type === 'Button' && element.bindingId) ids.push(element.bindingId);
    for (const child of (element.children ?? []) as typeof element[]) walk(child);
  };
  for (const layout of project?.uiLayouts ?? []) walk(layout.root as never);
  return Array.from(new Set(ids));
}
