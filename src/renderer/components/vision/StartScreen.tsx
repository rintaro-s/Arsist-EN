/**
 * 最初の画面。「何をしたいか」を選ぶだけで、動くパイプラインが置かれる。
 *
 * 白紙の道具箱から始めさせない。ひな型はどれも汎用の一手の並びなので、
 * 置いたあとに一手ずつ足したり消したりできる。
 */
import { Activity, Brush, Cpu, FilePlus2, Hash, Palette, ScanLine, Shapes, Sparkles } from 'lucide-react';
import { useT } from '../../i18n';
import type { ImageModelDefinition, VisionPipeline } from '../../../shared/types';
import { PIPELINE_PRESETS, buildModelPipeline, type PipelinePreset } from '../../vision/presets';

const PICTURES: Record<PipelinePreset['picture'], JSX.Element> = {
  count: <Hash size={20} />,
  motion: <Activity size={20} />,
  sign: <ScanLine size={20} />,
  paint: <Brush size={20} />,
  shapes: <Shapes size={20} />,
  colour: <Palette size={20} />,
};

export function StartScreen({
  models, onChoose, onImportModel, onOpenModels,
}: {
  models: ImageModelDefinition[];
  onChoose: (pipeline: VisionPipeline, name: string) => void;
  onImportModel: () => void;
  onOpenModels: () => void;
}) {
  const t = useT();

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-8 space-y-8">
        <div className="space-y-2">
          <h2 className="text-lg font-medium">{t('vision.start.title')}</h2>
          <p className="text-sm text-arsist-muted leading-relaxed">{t('vision.start.body')}</p>
        </div>

        <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('vision.start.classic')}</p>
          <div className="grid grid-cols-2 gap-3">
            {PIPELINE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className="text-left rounded-lg bg-arsist-surface hover:bg-arsist-hover p-4 flex gap-3 items-start transition-colors"
                onClick={() => onChoose(preset.build(), t(`vision.preset.${preset.id}`))}
              >
                <span className="shrink-0 w-10 h-10 rounded-lg bg-arsist-accent/15 text-arsist-accent flex items-center justify-center">
                  {PICTURES[preset.picture]}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(`vision.preset.${preset.id}`)}</span>
                  <span className="block text-[11px] text-arsist-muted leading-relaxed mt-1">{t(`vision.presetHint.${preset.id}`)}</span>
                  {preset.needsFrames && <span className="block text-[10px] text-arsist-accent mt-1">{t('vision.start.needsFrames')}</span>}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-[11px] uppercase tracking-wide text-arsist-muted">{t('vision.start.ai')}</p>
          <p className="text-[11px] text-arsist-muted leading-relaxed">{t('vision.start.aiHint')}</p>
          <div className="grid grid-cols-2 gap-3">
            {models.map((model) => (
              <button
                key={model.id}
                className="text-left rounded-lg bg-arsist-surface hover:bg-arsist-hover p-4 flex gap-3 items-start transition-colors"
                onClick={() => onChoose(buildModelPipeline(model), model.name)}
              >
                <span className="shrink-0 w-10 h-10 rounded-lg bg-purple-500/15 text-purple-300 flex items-center justify-center"><Cpu size={20} /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{model.name}</span>
                  <span className="block text-[11px] text-arsist-muted mt-1">
                    {t(`vision.model.task.${model.task}`)} · {model.input.width}×{model.input.height} · {t(`vision.start.modelFlow.${model.task}`)}
                  </span>
                </span>
              </button>
            ))}
            <button
              className="text-left rounded-lg bg-arsist-surface hover:bg-arsist-hover p-4 flex gap-3 items-start transition-colors"
              onClick={onImportModel}
            >
              <span className="shrink-0 w-10 h-10 rounded-lg bg-purple-500/15 text-purple-300 flex items-center justify-center"><Sparkles size={20} /></span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t('vision.start.importOnnx')}</span>
                <span className="block text-[11px] text-arsist-muted leading-relaxed mt-1">{t('vision.start.importOnnxHint')}</span>
              </span>
            </button>
          </div>
          {models.length > 0 && <button className="btn-ghost text-[11px] px-2 py-1" onClick={onOpenModels}>{t('vision.start.manageModels')}</button>}
        </section>

        <section>
          <button
            className="w-full text-left rounded-lg hover:bg-arsist-hover p-3 flex gap-3 items-center text-arsist-muted transition-colors"
            onClick={() => onChoose({ id: 'pipeline', name: t('vision.start.blankName'), maxWidth: 480, ops: [], outputs: [] }, t('vision.start.blankName'))}
          >
            <FilePlus2 size={16} />
            <span className="text-sm">{t('vision.start.blank')}</span>
          </button>
        </section>
      </div>
    </div>
  );
}
