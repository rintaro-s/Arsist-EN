/**
 * Arsist Engine - Bridge Layer
 * エディタデータをUnityが解釈可能な形式に変換
 */
import type { ArsistProject, ModelDefinition, SceneData, UILayoutData } from '../shared/types';
/**
 * APK に入れるモデル。モデルはプロジェクトの資産 (IR v3) で、画像認識の `infer` op だけでなく
 * スクリプトの model.* からも名前で呼ばれる。スクリプトの参照は文字列なので静的には追えない。
 * だから取り込んだものは全部入れる。要らないモデルはモデルタブで消す。
 */
export declare function shippedModels(project: ArsistProject): ModelDefinition[];
/**
 * パイプラインの `infer` op が参照しているモデルの定義を集める (画像処理のプレビュー用)。
 * 参照先が無いものは黙って飛ばす。
 */
export declare function referencedModels(project: ArsistProject): ModelDefinition[];
/**
 * Unity に渡すシーン (scenes.json / manifest.scenes)。IR のままの形で、名前も IR と同じ。
 * 既定のある項目 (β1.1.0〜) は埋めて渡す: Unity 側が既定を持たなくてよいように。
 *   - type 'camera' の物の camera → CAMERA_DEFAULTS で埋める (無くても作る)
 *   - VRM の character.embody → EMBODY_DEFAULTS で埋める (embody が無ければ足さない = 今までどおり)
 * 何度通しても同じ結果になる (ビルドの入口が複数あり、どこで通しても困らないように)。元の IR は書き換えない。
 */
export declare function unityScenesData(scenes: SceneData[] | undefined | null): SceneData[];
/**
 * Unity に渡す UI (ui_layouts.json)。Image の source は mirror を埋める (無ければ false)。
 * 元の IR は書き換えない。何度通しても同じ。
 */
export declare function unityUiData(layouts: UILayoutData[] | undefined | null): UILayoutData[];
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
export declare function generateBuildManifest(project: ArsistProject, overrides?: {
    targetDevice?: string;
}): Record<string, unknown>;
export declare function generateUnityManifest(project: ArsistProject): object;
//# sourceMappingURL=UnityBridge.d.ts.map