/**
 * 画像処理エディタ。
 *
 * 上に絵コンテ (カメラ → 一手 → … → 出しどころ を結果の絵つきで横に)、中央に選んだ一手の
 * 大きな絵と時間軸、右に設定。画像処理は途中経過が見えないと当てずっぽうになるので、
 * 文字の一覧やノードの線ではなく、各段の「絵」を並べ、選んだ段を大きく見せる。
 *
 * 画面の流れ:
 *   1. 素材を読み込む (写真、写真の束、動画、実機の画)。無くても組めるが、絵が出ない
 *   2. 出発点を選ぶ (ひな型か、学習済みモデルか、白紙)
 *   3. 絵コンテの「+」で一手を足す。候補は今の画で全部試した絵で並ぶ
 *   4. 中央の絵を見ながら右で設定を直す。色やしきい値は画をクリックして拾える
 *   5. 「結果の出しどころ」で、現実に置く・重ねる・値として保存する、を決める
 *
 * 走らせているのは実機と同じ C# なので、ここで見えているものがそのまま端末で起きる。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BoxSelect } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useT } from '../../i18n';
import { isImageModel, type PerceptionTask, type VisionOp, type VisionOpType, type VisionPipeline } from '../../../shared/types';
import { OP_CATALOG, SOURCE_NAME, outputKindOf, type VisionValueKind } from '../../vision/opCatalog';
import { inferTypes, validatePipeline } from '../../vision/validate';
import { usePreview, useProbe } from '../../vision/usePreview';
import { frameAsStep, mediaFromFiles } from '../../vision/testMedia';
import { useVisionStore } from '../../vision/visionStore';
import { draftOp } from '../../vision/draft';
import { rgbToHsv } from '../../vision/stageDraw';
import { referencedModels } from '../../../bridge/UnityBridge';
import { StartScreen } from './StartScreen';
import { TaskBar } from './TaskBar';
import { GuideBanner } from './GuideBanner';
import { AddStepPicker } from './AddStepPicker';
import { Storyboard } from './Storyboard';
import { Stage, type StagePick, type StageRect } from './Stage';
import { Timeline } from './Timeline';
import { StepInspector, type ValueOption } from './StepInspector';
import { OutputsInspector } from './OutputsInspector';
import { useUIStore } from '../../stores/uiStore';
import { useModelsStore } from '../../models/modelsStore';
import { DevicePanel } from './DevicePanel';

export function VisionEditor() {
  const t = useT();
  const {
    project, projectPath, readOnly, selectedPerceptionTaskId,
    updatePerceptionTask, addPerceptionTask, selectPerceptionTask,
  } = useProjectStore();
  const { media, setMedia, focus, selection, select, stepFocus, setPickMode } = useVisionStore();

  const tasks = useMemo(() => (project?.perception?.tasks ?? []).filter((x) => x.type === 'vision'), [project]);
  const task = tasks.find((x) => x.id === selectedPerceptionTaskId) ?? tasks[0] ?? null;
  const pipeline = task?.pipeline ?? null;
  // 画像の一手に使えるのは画像のモデルだけ。結線チェックには全部渡す (文章のモデルを指していたら名指しで知らせる)。
  const allModels = useMemo(() => project?.models ?? [], [project]);
  const models = useMemo(() => allModels.filter(isImageModel), [allModels]);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const selectModel = useModelsStore((s) => s.select);
  /** モデルはモデルタブで扱う (画像認識の外の資産)。 */
  const openModels = useCallback((id?: string) => {
    if (id) selectModel(id);
    setCurrentView('models');
  }, [selectModel, setCurrentView]);
  const sceneObjects = useMemo(
    () => (project?.scenes ?? []).flatMap((s) => s.objects).filter((o) => o.assetId).map((o) => ({ id: o.assetId!, name: o.name })),
    [project],
  );

  const [picker, setPicker] = useState<{ index: number } | null>(null);
  const [devicePanel, setDevicePanel] = useState(false);

  // プレビューに要るのは、このパイプラインが参照するモデルだけ
  const usedModels = useMemo(
    () => (project && task ? referencedModels({ ...project, perception: { targets: [], tasks: [task] } }) : []),
    [project, task],
  );
  const preview = usePreview(pipeline, media, focus, task, usedModels, projectPath);

  // 「一手を足す」画面: 繋げる候補を全部下書きにして、今の画で試す
  const candidates = useMemo(() => {
    const map = new Map<VisionOpType, VisionOp>();
    if (!picker || !pipeline) return map;
    for (const definition of OP_CATALOG) {
      if (definition.op === 'infer' && models.length === 0) continue;
      const draft = draftOp(pipeline, picker.index, definition.op, models);
      if (!draft || (draft.in ?? []).some((name) => !name)) continue; // 繋げないものは試さない
      map.set(definition.op, { ...draft, id: definition.op });
    }
    return map;
  }, [picker, pipeline, models]);
  const probe = useProbe(pipeline, picker?.index ?? null, [...candidates.values()], media, focus, task, usedModels, projectPath);

  const problems = useMemo(() => (pipeline ? validatePipeline(pipeline, allModels) : []), [pipeline, allModels]);
  const types = useMemo(() => (pipeline ? inferTypes(pipeline, allModels) : new Map<string, VisionValueKind>()), [pipeline, allModels]);

  const setPipeline = useCallback((next: VisionPipeline) => {
    if (!task) return;
    updatePerceptionTask(task.id, { pipeline: next } as Partial<PerceptionTask>);
  }, [task, updatePerceptionTask]);

  // 選んでいた一手が消えたら、カメラに戻す
  useEffect(() => {
    if (selection.kind === 'op' && !pipeline?.ops.some((o) => o.id === selection.id)) select({ kind: 'source' });
  }, [pipeline, selection, select]);

  /** 一手を足す (index の位置に)。直前までにある値から、型の合うものを自動で繋ぐ。 */
  const insertOp = (index: number, opType: VisionOpType) => {
    if (!pipeline) return;
    const draft = draftOp(pipeline, index, opType, models);
    if (!draft) return;

    const ops = [...pipeline.ops];
    ops.splice(index, 0, draft);
    setPipeline({ ...pipeline, ops });
    select({ kind: 'op', id: draft.id });
    setPicker(null);
  };

  const chooseStart = (next: VisionPipeline, name: string) => {
    if (task) {
      setPipeline(next);
      if (task.name === t('vision.task.defaultName') || tasks.length === 1) updatePerceptionTask(task.id, { name });
    } else {
      const id = addPerceptionTask({
        name, type: 'vision',
        source: { kind: 'viewport', rect: { x: 0, y: 0, width: 1, height: 1 } },
        trigger: { type: 'interval', value: 500 },
        storeAs: 'vision',
      });
      if (id) updatePerceptionTask(id, { pipeline: next } as Partial<PerceptionTask>);
    }
    select({ kind: 'source' });
  };

  const newTask = () => {
    const id = addPerceptionTask({
      name: t('vision.task.defaultName'), type: 'vision',
      source: { kind: 'viewport', rect: { x: 0, y: 0, width: 1, height: 1 } },
      trigger: { type: 'interval', value: 500 },
      storeAs: `vision${tasks.length + 1}`,
    });
    if (id) selectPerceptionTask(id);
    select({ kind: 'source' });
  };

  const importModel = async () => {
    if (!projectPath) return;
    const result = await window.electronAPI.model.import(projectPath);
    if (result.success && result.model) {
      useProjectStore.getState().addModel(result.model);
      useModelsStore.getState().setWarnings(result.model.id, result.warnings ?? []);
      // 画像のモデルならここで使える。それ以外 (文章・テンソル) はモデルタブで見せる。
      if (!isImageModel(result.model)) openModels(result.model.id);
    } else if (result.error && result.error !== 'cancelled') {
      openModels();
    }
  };

  // 結線候補: 人が読めるラベルつき
  const valueOptions = useCallback((upTo: number): ValueOption[] => {
    const options: ValueOption[] = [{ name: SOURCE_NAME, label: t('vision.source'), kind: 'color' }];
    (pipeline?.ops ?? []).slice(0, upTo).forEach((o, i) => {
      const kind = types.get(o.out);
      if (!kind) return;
      options.push({ name: o.out, label: `${i + 1}. ${t(`vision.op.${o.op}`)} (${t(`vision.kind.${kind}`)})`, kind });
    });
    return options;
  }, [pipeline, types, t]);

  if (!project) return null;

  const sourceStep = preview.steps.find((s) => s.name === SOURCE_NAME);
  // カメラのカードでは、切り出す前の画に「見る枠」を重ねて見せる
  const fullFrame = media && !media.precropped ? media.frames[Math.min(media.frames.length - 1, Math.max(0, focus))] : null;
  const fullFrameStep = fullFrame ? frameAsStep(fullFrame) : undefined;
  const viewportRect: StageRect | null = task?.source.kind === 'viewport' && fullFrame ? task.source.rect : null;
  const selectedOpIndex = selection.kind === 'op' ? (pipeline?.ops.findIndex((o) => o.id === selection.id) ?? -1) : -1;
  const selectedOp = selectedOpIndex >= 0 ? pipeline!.ops[selectedOpIndex] : null;
  const stageStep = selection.kind === 'source' ? sourceStep : selectedOp ? preview.steps.find((s) => s.name === selectedOp.out) : undefined;
  const stageKind: VisionValueKind = selection.kind === 'source' ? 'color' : selectedOp ? (types.get(selectedOp.out) ?? outputKindOf(selectedOp, models)) : 'color';
  const stageTitle = selection.kind === 'source' ? t('vision.source') : selectedOp ? `${selectedOpIndex + 1}. ${t(`vision.op.${selectedOp.op}`)}` : t('vision.outputs');
  const firstInputStep = selectedOp ? preview.steps.find((s) => s.name === (selectedOp.in?.[0] ?? '')) : undefined;
  const pickable = selectedOp?.op === 'hsvRange' || selectedOp?.op === 'threshold';

  /** 画をクリックして設定する: 色で拾う → その色の周り、しきい値 → その明るさ。 */
  const onPick = (pick: StagePick) => {
    if (!pipeline || !selectedOp) return;
    let params = { ...selectedOp.params };
    if (selectedOp.op === 'hsvRange' && pick.rgb) {
      const { h, s, v } = rgbToHsv(pick.rgb.r, pick.rgb.g, pick.rgb.b);
      if (s < 40) {
        // 灰色っぽい所: 色相は当てにならないので、彩度と明るさで拾う
        params = { ...params, hueMin: 0, hueMax: 359, satMin: 0, satMax: Math.min(255, s + 50), valMin: Math.max(0, v - 60), valMax: Math.min(255, v + 60) };
      } else {
        params = { ...params, hueMin: (h - 20 + 360) % 360, hueMax: (h + 20) % 360, satMin: Math.max(0, s - 80), satMax: 255, valMin: Math.max(0, v - 80), valMax: 255 };
      }
    } else if (selectedOp.op === 'threshold' && pick.input !== null) {
      params = { ...params, mode: 'fixed', value: pick.input };
    } else {
      return;
    }
    setPipeline({ ...pipeline, ops: pipeline.ops.map((o) => (o.id === selectedOp.id ? { ...o, params } : o)) });
  };

  const onRect = (rect: StageRect) => {
    if (!task) return;
    updatePerceptionTask(task.id, { source: { kind: 'viewport', rect } });
    setPickMode('none');
  };

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden outline-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
        if (e.key === 'ArrowRight') stepFocus(1);
        if (e.key === 'ArrowLeft') stepFocus(-1);
      }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={async (e) => {
        e.preventDefault();
        const next = await mediaFromFiles(Array.from(e.dataTransfer.files ?? []));
        if (next) setMedia(next);
      }}
    >
      <TaskBar
        tasks={tasks}
        task={task}
        media={media}
        preview={preview}
        readOnly={readOnly}
        onSelectTask={(id) => { selectPerceptionTask(id); select({ kind: 'source' }); }}
        onNewTask={newTask}
        onUpdateTask={(updates) => task && updatePerceptionTask(task.id, updates)}
        onMedia={setMedia}
        onOpenModels={() => openModels()}
        onOpenDevice={() => setDevicePanel(true)}
      />
      <GuideBanner />

      {!task || !pipeline || pipeline.ops.length === 0 ? (
        <StartScreen models={models} onChoose={chooseStart} onImportModel={() => { void importModel(); }} onOpenModels={() => openModels()} />
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0 flex flex-col">
            <Storyboard
              pipeline={pipeline}
              models={models}
              types={types}
              problems={problems}
              preview={preview}
              onChange={setPipeline}
              onInsert={(index) => setPicker({ index })}
            />
            {!media && (
              <p className="text-[11px] text-arsist-muted leading-snug bg-arsist-accent/10 px-3 py-1.5">{t('vision.dropHint')}</p>
            )}
            {problems.length > 0 && (
              <p className="text-[11px] text-arsist-error flex items-center gap-1.5 px-3 py-1 bg-arsist-error/10">
                <AlertTriangle size={12} /> {t('vision.problemCount', { count: problems.length })}
              </p>
            )}
            <Stage
              title={stageTitle}
              kind={stageKind}
              step={selection.kind === 'source' && fullFrameStep ? fullFrameStep : stageStep}
              source={selection.kind === 'source' && fullFrameStep ? fullFrameStep : sourceStep}
              inputStep={firstInputStep}
              preview={preview}
              rect={selection.kind === 'source' ? viewportRect : null}
              onPick={pickable ? onPick : undefined}
              onRect={selection.kind === 'source' && task.source.kind === 'viewport' ? onRect : undefined}
            />
            {media && media.frames.length > 1 && <Timeline media={media} preview={preview} />}
          </div>

          <div className="w-[340px] shrink-0 hairline-l overflow-y-auto bg-arsist-panel/40">
            {selection.kind === 'source' && (
              <div className="p-4 space-y-3">
                <h3 className="text-sm font-medium">{t('vision.source')}</h3>
                <p className="text-[11px] text-arsist-muted leading-relaxed">{t('vision.sourceHint')}</p>
                {task.source.kind === 'viewport' && (
                  <button
                    className={`w-full text-left rounded-lg px-3 py-2 flex items-center gap-2 text-[11px] transition-colors ${
                      useVisionStore.getState().pickMode === 'rect' ? 'bg-arsist-accent/20 text-arsist-accent' : 'bg-arsist-surface hover:bg-arsist-hover'
                    }`}
                    onClick={() => setPickMode(useVisionStore.getState().pickMode === 'rect' ? 'none' : 'rect')}
                  >
                    <BoxSelect size={13} className="shrink-0" />
                    <span>{fullFrame ? t('vision.pick.buttonRect') : t('vision.pick.buttonRectNoMedia')}</span>
                  </button>
                )}
                <label className="grid grid-cols-[7rem_1fr] items-center gap-2 text-[11px]">
                  <span className="text-arsist-muted">{t('vision.maxWidth')}</span>
                  <span className="flex items-center gap-2">
                    <input type="range" className="flex-1 min-w-0" min={160} max={1280} step={32} value={pipeline.maxWidth ?? 480}
                      onChange={(e) => setPipeline({ ...pipeline, maxWidth: parseInt(e.target.value, 10) })} />
                    <span className="font-mono w-14">{pipeline.maxWidth ?? 480} px</span>
                  </span>
                  <span className="col-start-2 text-[10px] text-arsist-muted leading-snug">{t('vision.maxWidthHint')}</span>
                </label>
                {media && (
                  <p className="text-[11px] text-arsist-muted leading-relaxed">
                    {t('vision.mediaInfo', { kind: t(`vision.media.kind.${media.kind}`), frames: media.frames.length, size: `${media.frames[0].width}×${media.frames[0].height}` })}
                  </p>
                )}
              </div>
            )}

            {selectedOp && (
              <StepInspector
                key={selectedOp.id}
                op={selectedOp}
                index={selectedOpIndex}
                models={models}
                values={valueOptions(selectedOpIndex)}
                problems={problems.filter((p) => p.opId === selectedOp.id)}
                inputStep={firstInputStep}
                onChange={(next) => setPipeline({ ...pipeline, ops: pipeline.ops.map((o) => (o.id === next.id ? next : o)) })}
                onRemove={() => {
                  setPipeline({ ...pipeline, ops: pipeline.ops.filter((o) => o.id !== selectedOp.id) });
                  select({ kind: 'source' });
                }}
                onOpenModels={(id) => openModels(id)}
              />
            )}

            {selection.kind === 'outputs' && (
              <OutputsInspector
                pipeline={pipeline}
                values={valueOptions(pipeline.ops.length)}
                problems={problems.filter((p) => !p.opId)}
                isViewport={task.source.kind === 'viewport'}
                sceneObjects={sceneObjects}
                onChange={setPipeline}
              />
            )}
          </div>
        </div>
      )}

      {picker && pipeline && (
        <AddStepPicker
          pipeline={pipeline}
          index={picker.index}
          availableKinds={new Set(valueOptions(picker.index).map((v) => v.kind))}
          models={models}
          candidates={candidates}
          probes={probe.probes}
          probing={probe.running}
          previewSteps={preview.steps}
          onPick={(op) => insertOp(picker.index, op)}
          onClose={() => setPicker(null)}
          onOpenModels={() => { setPicker(null); openModels(); }}
        />
      )}
      {devicePanel && <DevicePanel taskId={task?.id ?? null} onClose={() => setDevicePanel(false)} />}
    </div>
  );
}
