/**
 * Arsist Engine - Bridge Layer
 * エディタデータをUnityが解釈可能な形式に変換
 */
import type { ArsistProject, SceneData, UILayoutData, Vector3 } from '../shared/types';
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
 * プロジェクト全体をUnityマニフェストに変換
 */
export declare function generateUnityManifest(project: ArsistProject): object;
export {};
//# sourceMappingURL=UnityBridge.d.ts.map