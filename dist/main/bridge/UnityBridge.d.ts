/**
 * Arsist Engine - Bridge Layer
 * エディタデータをUnityが解釈可能な形式に変換
 */
import type { ArsistProject, SceneData, UILayoutData, Vector3, ModelDefinition } from '../shared/types';
/**
 * シーンデータをUnity用JSONに変換
 */
export declare function convertSceneToUnity(scene: SceneData): UnitySceneData;
interface UnitySceneData {
    name: string;
    gameObjects: UnityGameObject[];
}
interface UnityGameObject {
    name: string;
    tag?: string;
    layer?: number;
    transform: {
        localPosition: Vector3;
        localRotation: Vector3;
        localScale: Vector3;
    };
    components: UnityComponent[];
    children?: UnityGameObject[];
}
interface UnityComponent {
    type: string;
    properties: Record<string, any>;
}
/**
 * UIレイアウトをUnity UI Toolkit/uGUI用に変換
 */
export declare function convertUIToUnity(layout: UILayoutData): UnityUIData;
interface UnityUIData {
    name: string;
    root: UnityUIElement;
}
interface UnityUIElement {
    name: string;
    type: string;
    rectTransform: {
        anchorMin: {
            x: number;
            y: number;
        };
        anchorMax: {
            x: number;
            y: number;
        };
        pivot: {
            x: number;
            y: number;
        };
        sizeDelta: {
            x: number;
            y: number;
        };
        anchoredPosition: {
            x: number;
            y: number;
        };
    };
    layoutGroup?: {
        type: 'Horizontal' | 'Vertical' | 'Grid';
        spacing: number;
        childAlignment: string;
        padding: {
            left: number;
            right: number;
            top: number;
            bottom: number;
        };
    };
    image?: {
        color: {
            r: number;
            g: number;
            b: number;
            a: number;
        };
        raycastTarget: boolean;
        material?: string;
    };
    text?: {
        text: string;
        fontSize: number;
        color: {
            r: number;
            g: number;
            b: number;
            a: number;
        };
        alignment: string;
        fontStyle: string;
    };
    button?: {
        targetGraphic: string;
        colors: {
            normalColor: {
                r: number;
                g: number;
                b: number;
                a: number;
            };
            highlightedColor: {
                r: number;
                g: number;
                b: number;
                a: number;
            };
            pressedColor: {
                r: number;
                g: number;
                b: number;
                a: number;
            };
        };
        onClick: string;
    };
    children: UnityUIElement[];
}
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
export declare function generateBuildManifest(project: ArsistProject, overrides?: {
    targetDevice?: string;
}): Record<string, unknown>;
export declare function generateUnityManifest(project: ArsistProject): object;
export {};
//# sourceMappingURL=UnityBridge.d.ts.map