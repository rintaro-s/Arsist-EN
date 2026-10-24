/**
 * Arsist Engine - Bridge Layer
 * エディタデータをUnityが解釈可能な形式に変換
 */
import type {
  ArsistProject,
  PerceptionTarget,
  PerceptionTask,
  ScriptBundle,
  ModelDefinition,
} from '../shared/types';
import { CURRENT_IR_VERSION } from '../shared/irVersion';
import { virtualHeaderFor } from '../shared/layster/version';

/**
 * APK に入れるモデル。モデルはプロジェクトの資産 (IR v3) で、画像認識の `infer` op だけでなく
 * スクリプトの model.* からも名前で呼ばれる。スクリプトの参照は文字列なので静的には追えない。
 * だから取り込んだものは全部入れる。要らないモデルはモデルタブで消す。
 */
export function shippedModels(project: ArsistProject): ModelDefinition[] {
  return (project.models ?? []).filter((m) => m && m.id && m.file && m.includeInBuild !== false);
}

/**
 * パイプラインの `infer` op が参照しているモデルの定義を集める (画像処理のプレビュー用)。
 * 参照先が無いものは黙って飛ばす。
 */
export function referencedModels(project: ArsistProject): ModelDefinition[] {
  const models = project.models ?? [];
  if (models.length === 0) return [];

  const used = new Set<string>();
  for (const task of project.perception?.tasks ?? []) {
    if (task.type !== 'vision') continue;
    for (const op of task.pipeline?.ops ?? []) {
      if (op.op !== 'infer') continue;
      const id = op.params?.model;
      if (typeof id === 'string' && id) used.add(id);
    }
  }
  return models.filter((m) => used.has(m.id));
}

/**
 * タスクが参照しているターゲット / 領域が実在するか。
 * エディタで領域を消してもタスクは残るので、ここで落とす。
 */
function isTaskResolvable(task: PerceptionTask, targets: PerceptionTarget[]): boolean {
  if (!task.storeAs) return false;

  // パイプラインの無い vision タスクは、ビルドは通るのに実行時に必ず何もしない。
  if (task.type === 'vision' && (task.pipeline?.ops?.length ?? 0) === 0) return false;

  const source = task.source;
  if (source.kind === 'viewport') return true;

  const target = targets.find((t) => t.id === source.targetId);
  if (!target) return false;
  return (target.regions ?? []).some((r) => r.id === source.regionId);
}

/**
 * プロジェクト全体をUnityマニフェストに変換
 */
/**
 * ビルドに渡すマニフェスト。
 *
 * **画面のビルドも、コマンドのビルドも、必ずここを通すこと。** 以前ビルド画面が
 * 同じものを手書きで組んでいて、`models` と `perception` が丸ごと抜けていた。
 * つまりエディタから作った APK には**モデルが 1 つも入らず**、実機では
 * 「モデルが同梱されていません」としか分からない状態だった (2026-09 に踏んだ)。
 * IR に項目を足すたびに写しを直す運用は成立しない。
 *
 * @param overrides 画面で選んだもの (端末など)。IR より優先する。
 */
export function generateBuildManifest(
  project: ArsistProject,
  overrides: { targetDevice?: string } = {},
): Record<string, unknown> {
  const { remoteInput, ...androidBuild } = (project.buildSettings ?? {}) as unknown as Record<string, unknown>;

  return {
    ...(generateUnityManifest(project) as Record<string, unknown>),

    // Unity 側が読む形に合わせた、ビルド固有のもの
    targetDevice: overrides.targetDevice ?? project.targetDevice,
    version: project.version,
    build: androidBuild,
    buildSettings: project.buildSettings,
    remoteInput,
    designSystem: project.designSystem,
    scenes: project.scenes,
    // 有効にした拡張機能とその設定 (IR のまま)。どれが実際にビルドに入るかは、端末のタグと
    // sdk/ の中身を見て UnityBuilder.planExtensions が決め、manifest.json の extensions に書く。
    projectExtensions: project.extensions ?? {},
    // 端末に保存する store のキー。実機は scripts.json の storage を読む (ここはビルドの機能判定とログ用)
    storage: { persist: project.storage?.persist ?? [] },
    exportedAt: new Date().toISOString(),
  };
}

export function generateUnityManifest(project: ArsistProject): object {
  const scriptBundle: ScriptBundle = {
    version: '1.0',
    scripts: (project.scripts ?? [])
      .filter((sc) => sc.enabled)
      .map((sc) => ({
        id: sc.id,
        trigger: sc.trigger,
        code: sc.code,
        enabled: sc.enabled,
      })),
    storage: { persist: project.storage?.persist ?? [] },
  };

  return {
    arsistVersion: '1.0.0',
    projectId: project.id,
    projectName: project.name,
    appType: project.appType,
    targetDevice: project.targetDevice,
    arSettings: project.arSettings,
    dataFlow: project.dataFlow,
    
    build: {
      packageName: project.buildSettings.packageName,
      version: project.buildSettings.version,
      versionCode: project.buildSettings.versionCode,
      minSdkVersion: project.buildSettings.minSdkVersion,
      targetSdkVersion: project.buildSettings.targetSdkVersion,
    },
    
    design: {
      defaultFont: project.designSystem.defaultFont,
      primaryColor: project.designSystem.primaryColor,
      secondaryColor: project.designSystem.secondaryColor,
      backgroundColor: project.designSystem.backgroundColor,
      textColor: project.designSystem.textColor,
    },
    
    scenes: project.scenes.map(s => ({
      id: s.id,
      name: s.name,
      objectCount: s.objects.length,
    })),
    
    uiLayouts: project.uiLayouts.map(l => ({
      id: l.id,
      name: l.name,
      scope: l.scope,
    })),

    scriptBundle,

    // IR の版。Unity 側は読むだけだが、ログに残ると「どの版のエディタで作った APK か」が追える。
    irVersion: project.irVersion ?? CURRENT_IR_VERSION,
    // 形式の名前 (Layster.Virtual β 1.0.0 …)。ビルドのログと実機のログに出る。
    // Spatial から作った内部用のプロジェクトは自分の見出し (profile: 'spatial') を持って来るので、それを優先する
    layster: project.layster ?? virtualHeaderFor(project.irVersion ?? CURRENT_IR_VERSION),

    // 学習済みモデル。パイプラインの `infer` op が参照しているものだけを出す。
    // 使っていないモデルまで APK に入れると、数十 MB 単位で膨らむ。
    models: shippedModels(project),

    // 画像アンカー。ターゲットが無いプロジェクトでは undefined になり、
    // Unity 側は Perception 一式を丸ごとスキップする。
    // ターゲットが無くてもタスクだけのプロジェクトは成立する
    // （viewport ソースは「カメラ画像の矩形」なので追跡対象を必要としない）。
    perception: project.perception &&
      (project.perception.targets.length > 0 || (project.perception.tasks?.length ?? 0) > 0)
      ? {
          targets: project.perception.targets.map((t) => ({
            id: t.id,
            name: t.name,
            type: t.type,
            imagePath: t.imagePath,
            physicalWidth: t.physicalWidth,
            physicalHeight: t.physicalHeight,
            holdMs: t.holdMs ?? 2000,
            // 領域はランタイムで「正対化して読む枠」にも「配置の基準」にもなる
            regions: (t.regions ?? []).map((r) => ({
              id: r.id,
              name: r.name,
              rect: r.rect,
            })),
          })),
          // 参照先が消えているタスクは出さない。ビルドは通るのに実行時に必ず失敗する
          // オブジェクトを APK に入れないため。
          tasks: (project.perception.tasks ?? [])
            .filter((task) => isTaskResolvable(task, project.perception!.targets))
            .map((task) => ({
              id: task.id,
              name: task.name,
              type: task.type,
              source: task.source,
              trigger: task.trigger,
              storeAs: task.storeAs,
              // OCR 以外はエンジンを見ないが、既定を落とすと Unity 側で分岐が増えるので常に入れる
              engine: task.engine ?? { kind: 'mlkit', script: 'japanese' },
              // 画像処理パイプライン。中身はプロジェクト側が持つので、
              // ここは素通しにする。エンジンは op の並べ方を知らない。
              pipeline: task.type === 'vision' ? task.pipeline : undefined,
            })),
        }
      : undefined,

    generatedAt: new Date().toISOString(),
  };
}
