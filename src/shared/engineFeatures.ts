/**
 * エンジンの機能を「タグの付いた部品」として並べた表。
 *
 * 1 つの機能について、ここに 1 行:
 *   - tag       その機能の名前 (`feature:<id>`)
 *   - uses      プロジェクトがその機能を使っているか (IR を見て決める)
 *   - requires  端末に要るもの (アダプタのタグに対する条件)
 *
 * 使い道は 3 つ:
 *   1. ビルド前に「この端末ではこの機能が動かない」を警告する (UnityBuilder)
 *   2. ビルドに「このアプリが使っている機能」を載せる (manifest.features → 実機のログと拡張機能)
 *   3. 拡張機能が `requires: { all: ['feature:text-input'] }` のように機能に乗っかれる
 *
 * 機能を足すときは、ここに 1 行足せば上の 3 つに自動で入る。
 * requires は「無いと動かない」ものだけを書くこと。代わりの手段がある機能
 * (例: 端末キーボードが無ければアプリ内キーボードが出る文字入力) には書かない —
 * 書くと、ちゃんと動く組み合わせに警告が出てしまう。
 */
import type { ArsistProject, SceneObject, UIElement } from './types';
import { matchTagQuery, type Tag, type TagQuery } from './tags';

export interface EngineFeature {
  /** `feature:<id>` の <id> */
  id: string;
  /** プロジェクトがこの機能を使っているか */
  uses: (project: ArsistProject) => boolean;
  /** 端末に要るもの。無ければ条件なし (どの端末でも動く) */
  requires?: TagQuery;
  /** ログ用の短い説明 */
  summary: string;
}

function allObjects(project: ArsistProject): SceneObject[] {
  const out: SceneObject[] = [];
  const visit = (objects: SceneObject[] | undefined) => {
    for (const obj of objects ?? []) {
      out.push(obj);
      visit(obj.children);
    }
  };
  for (const scene of project.scenes ?? []) visit(scene.objects);
  return out;
}

function someElement(project: ArsistProject, test: (el: UIElement) => boolean): boolean {
  const visit = (el: UIElement | undefined): boolean => {
    if (!el) return false;
    if (test(el)) return true;
    return (el.children ?? []).some(visit);
  };
  return (project.uiLayouts ?? []).some((layout) => visit(layout.root));
}

/** 有効なスクリプトのどれかに pattern が書かれているか (コメントの中でも当たるが、積みすぎる方に倒れるだけ)。 */
function scriptsMention(project: ArsistProject, pattern: RegExp): boolean {
  return (project.scripts ?? []).some((s) => s.enabled && pattern.test(s.code ?? ''));
}

export const ENGINE_FEATURES: EngineFeature[] = [
  {
    id: 'scripting',
    summary: 'JavaScript (Jint) on the device',
    uses: (p) => (p.scripts ?? []).some((s) => s.enabled),
  },
  {
    id: 'ui-hud',
    summary: 'UI fixed to the view',
    uses: (p) => (p.uiLayouts ?? []).some((l) => l.scope === 'uhd' && (l.root?.children?.length ?? 0) > 0),
  },
  {
    id: 'ui-canvas',
    summary: 'UI placed in space',
    uses: (p) => allObjects(p).some((o) => o.type === 'canvas'),
  },
  {
    id: 'text-input',
    // 端末キーボードが無ければアプリ内キーボードに落ちるので、端末の条件は無い
    summary: 'text fields (device keyboard, in-app fallback)',
    uses: (p) => someElement(p, (el) => el.type === 'Input'),
  },
  {
    id: '3d-models',
    summary: 'GLB / glTF models',
    uses: (p) => allObjects(p).some((o) => o.type === 'model'),
  },
  {
    id: 'vrm',
    summary: 'VRM avatars',
    uses: (p) => allObjects(p).some((o) => o.type === 'vrm'),
  },
  {
    id: 'models',
    summary: 'on-device ONNX models',
    uses: (p) => (p.models ?? []).some((m) => m && m.file && m.includeInBuild !== false),
  },
  {
    id: 'vision',
    summary: 'image pipelines on the camera picture',
    uses: (p) => (p.perception?.tasks?.length ?? 0) > 0,
    requires: { all: ['cap:camera-access'] },
  },
  {
    id: 'image-anchors',
    summary: 'content placed on registered pictures',
    uses: (p) => (p.perception?.targets?.length ?? 0) > 0,
    requires: { all: ['cap:camera-access'] },
  },
  {
    id: 'camera',
    // スクリプトがカメラの画を取る (camera.* / model.runImage)。画像処理タスクが無くてもカメラを積む
    summary: 'camera pictures from scripts (camera.*, model.runImage)',
    uses: (p) => scriptsMention(p, /\bcamera\s*\.\s*(capture|project|available)\s*\(|\bmodel\s*\.\s*runImage\s*\(/),
    requires: { all: ['cap:camera-access'] },
  },
  {
    id: 'character-animation',
    summary: 'VRM characters moving with FBX animations (Assets/Animations)',
    uses: (p) => allObjects(p).some((o) => o.type === 'vrm' && !!o.character?.animation)
      || scriptsMention(p, /\bvrm\s*\.\s*(playAnimation|walkTo)\s*\(/),
  },
  {
    id: 'storage',
    summary: 'store values kept on the device across launches',
    uses: (p) => (p.storage?.persist?.length ?? 0) > 0,
  },
  {
    id: 'hand-tracking',
    summary: 'pinch to select with bare hands',
    uses: (p) => p.arSettings?.interaction?.handTracking === true,
    requires: { all: ['cap:hand-tracking'] },
  },
  {
    id: 'passthrough',
    summary: 'see the real world behind the content',
    uses: (p) => (p.arSettings?.backgroundMode ?? 'passthrough') === 'passthrough',
    requires: { any: ['cap:passthrough', 'cap:optical-see-through'] },
  },
  {
    id: 'remote-control',
    summary: 'WebSocket remote control',
    uses: (p) => p.arSettings?.enableRemoteControl === true,
  },
];

/** プロジェクトが使っている機能のタグ (`feature:<id>`)。 */
export function projectFeatureTags(project: ArsistProject): Tag[] {
  return ENGINE_FEATURES.filter((f) => safeUses(f, project)).map((f) => `feature:${f.id}`).sort();
}

function safeUses(feature: EngineFeature, project: ArsistProject): boolean {
  try {
    return feature.uses(project);
  } catch {
    return false; // 壊れた IR で表全体を止めない (IR の検査は別でやっている)
  }
}

export interface FeatureSupportIssue {
  feature: string;
  summary: string;
  missing: Tag[];
}

/** 使っているのに、端末のタグが条件を満たさない機能。 */
export function unsupportedFeatures(project: ArsistProject, deviceTags: Iterable<Tag>): FeatureSupportIssue[] {
  const tags = [...deviceTags];
  const issues: FeatureSupportIssue[] = [];
  for (const feature of ENGINE_FEATURES) {
    if (!feature.requires || !safeUses(feature, project)) continue;
    const result = matchTagQuery(feature.requires, tags);
    if (!result.ok) {
      issues.push({
        feature: `feature:${feature.id}`,
        summary: feature.summary,
        missing: [...result.missing, ...result.missingAny, ...result.blocked],
      });
    }
  }
  return issues;
}
