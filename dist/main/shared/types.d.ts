/**
 * Arsist Engine — 中間表現 (IR) 型定義
 *
 * 本システムの唯一の正 (Single Source of Truth)。
 * DataSource → DataStore → UI の3層宣言型アーキテクチャ。
 *
 * ユーザーは C# を一切書かない。
 * ユーザーが扱うのは「UI定義」と「データ定義」のみ。
 */
export type ProjectTemplate = '3d_ar_scene' | '2d_floating_screen' | 'head_locked_hud';
export type TrackingMode = '6dof' | '3dof' | 'head_locked';
export type PresentationMode = 'world_anchored' | 'floating_screen' | 'head_locked_hud';
export type DataSourceMode = 'polling' | 'event';
/** センサー・通信・システムのデータ取得元 */
export type DataSourceType = 'XR_Tracker' | 'XR_HandPose' | 'Device_Status' | 'Location_Provider' | 'REST_Client' | 'WebSocket_Stream' | 'MQTT_Subscriber' | 'System_Clock' | 'Voice_Recognition' | 'Microphone_Level';
/** DataStore の値を加工するトランスフォーム */
export type TransformType = 'Formula' | 'Clamper' | 'Remap' | 'Smoother' | 'Comparator' | 'Threshold' | 'State_Mapper' | 'String_Template' | 'Time_Formatter' | 'History_Buffer' | 'Accumulator';
export interface DataSourceDefinition {
    id: string;
    type: DataSourceType;
    mode: DataSourceMode;
    storeAs: string;
    updateRate?: number;
    parameters?: Record<string, unknown>;
}
export interface TransformDefinition {
    id: string;
    type: TransformType;
    inputs: string[];
    storeAs: string;
    expression?: string;
    updateRate?: number;
    parameters?: Record<string, unknown>;
}
export interface DataFlowDefinition {
    dataSources: DataSourceDefinition[];
    transforms: TransformDefinition[];
}
/**
 * 背景（カメラの clear）の描き方。
 *
 * XREAL のような光学シースルー機では、そもそも黒＝素通しなので選択の余地は無い
 * （常に passthrough 相当）。Quest のようなビデオシースルー機だけが、
 * 「パススルー映像を見せる MR」と「現実を隠す VR」を選べる。
 */
export type BackgroundMode = 'passthrough' | 'skybox' | 'solidColor';
/**
 * ユーザーがシーン内オブジェクトを選択・操作する方式。
 * 少なくとも1つは有効でないと、ビルドしたアプリを一切操作できなくなるため、
 * 両方 false でのビルドはエラーにする（UnityBuilder / ArsistBuildPipeline 側で検証）。
 */
export interface InteractionSettings {
    /**
     * コントローラー / ハンドコントローラーからのレイキャストでポインタ操作する (default: true)。
     * XREAL・Quest とも対応。トリガーボタンで選択を確定する。
     */
    controllerRay: boolean;
    /**
     * ハンドトラッキングでのピンチ操作を有効にする (default: false)。
     * Quest のみ対応（要 com.unity.xr.hands パッケージ、OpenXR の Hand Tracking 拡張）。
     * XREAL One 系にはハンドトラッキング用カメラが無いため、有効にしても効果が無い。
     */
    handTracking: boolean;
}
export interface ARSettings {
    trackingMode: TrackingMode;
    presentationMode: PresentationMode;
    worldScale: number;
    defaultDepth: number;
    floatingScreen?: {
        width: number;
        height: number;
        distance: number;
        lockToGaze: boolean;
    };
    /** Python 等外部クライアントからの WebSocket リモートコントロールを有効にする (default: false) */
    enableRemoteControl?: boolean;
    /** WebSocket サーバーのポート番号 (default: 8765) */
    remoteControlPort?: number;
    /** WebSocket リモート制御の認証パスワード（空文字なら認証なし） */
    remoteControlPassword?: string;
    /**
     * 背景の描き方 (default: 'passthrough')。
     * ビデオシースルー機 (Meta Quest) でのみ意味を持つ。XREAL では無視される。
     */
    backgroundMode?: BackgroundMode;
    /** backgroundMode === 'solidColor' のときの背景色 (#RRGGBB, default: '#000000') */
    backgroundColor?: string;
    /**
     * 操作方法 (default: { controllerRay: true, handTracking: false })。
     * 両方 false でのビルドはエラーになる。
     */
    interaction?: InteractionSettings;
}
export interface DesignSystem {
    defaultFont: string;
    primaryColor: string;
    secondaryColor: string;
    backgroundColor: string;
    textColor: string;
}
export interface BuildSettings {
    packageName: string;
    version: string;
    versionCode: number;
    minSdkVersion: number;
    targetSdkVersion: number;
    remoteInput?: RemoteInputSettings;
}
export interface RemoteInputSettings {
    udp?: {
        enabled: boolean;
        port: number;
    };
    tcp?: {
        enabled: boolean;
        port: number;
    };
    allowedEvents?: string[];
}
export interface SceneData {
    id: string;
    name: string;
    objects: SceneObject[];
}
export type SceneObjectType = 'primitive' | 'model' | 'vrm' | 'light' | 'camera' | 'empty' | 'canvas';
export interface SceneObject {
    id: string;
    name: string;
    type: SceneObjectType;
    primitiveType?: 'cube' | 'sphere' | 'plane' | 'cylinder' | 'capsule';
    modelPath?: string;
    /** スクリプトからこのオブジェクトを操作するためのID */
    assetId?: string;
    /** type === 'canvas' の場合のみ有効 */
    canvasSettings?: CanvasSettings;
    transform: Transform;
    material?: MaterialData;
    children?: SceneObject[];
}
/** 3D空間に配置するUIキャンバスの設定 */
export interface CanvasSettings {
    /** アタッチする UILayout の ID */
    layoutId: string;
    /** 3D空間上の幅（メートル） */
    widthMeters: number;
    /** 3D空間上の高さ（メートル） */
    heightMeters: number;
    pixelsPerUnit: number;
}
export interface Transform {
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
}
export interface Vector3 {
    x: number;
    y: number;
    z: number;
}
export interface MaterialData {
    color: string;
    metallic?: number;
    roughness?: number;
    texture?: string;
    emissive?: string;
    emissiveIntensity?: number;
}
export interface UILayoutData {
    id: string;
    name: string;
    /** uhd = 常時表示HUD, canvas = 3D空間サーフェス */
    scope: 'uhd' | 'canvas';
    resolution: {
        width: number;
        height: number;
    };
    root: UIElement;
}
export type UIElementType = 'Panel' | 'Text' | 'Button' | 'Image' | 'Slider' | 'Input' | 'Gauge' | 'Graph';
export interface UIElement {
    id: string;
    type: UIElementType;
    content?: string;
    assetPath?: string;
    /** スクリプトからこの要素を操作するためのID */
    bindingId?: string;
    bind?: UIBinding;
    layout?: 'FlexRow' | 'FlexColumn' | 'Absolute';
    style: UIStyle;
    children: UIElement[];
}
/** DataStore キーへのバインド定義 */
export interface UIBinding {
    key: string;
    format?: string;
}
export interface UIStyle {
    width?: number | string;
    height?: number | string;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    margin?: Spacing;
    padding?: Spacing;
    flexDirection?: 'row' | 'column';
    justifyContent?: string;
    alignItems?: string;
    gap?: number;
    backgroundColor?: string;
    color?: string;
    borderRadius?: number;
    borderWidth?: number;
    borderColor?: string;
    blur?: number;
    opacity?: number;
    shadow?: ShadowStyle;
    fontSize?: number;
    fontWeight?: string;
    textAlign?: 'left' | 'center' | 'right';
    position?: 'relative' | 'absolute';
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
}
export interface Spacing {
    top: number;
    right: number;
    bottom: number;
    left: number;
}
export interface ShadowStyle {
    offsetX: number;
    offsetY: number;
    blur: number;
    color: string;
}
/** スクリプトトリガーの種別 */
export type ScriptTriggerType = 'onStart' | 'onUpdate' | 'interval' | 'event';
/** スクリプトトリガー設定 */
export interface ScriptTrigger {
    /** トリガー種別 */
    type: ScriptTriggerType;
    /**
     * interval の場合: ミリ秒 (例: 5000 = 5秒ごと)
     * event の場合: イベント名 (例: "btn_refresh")
     * onStart / onUpdate の場合: 未使用
     */
    value?: number | string;
}
/** 一つのスクリプト定義 */
export interface ScriptData {
    id: string;
    name: string;
    trigger: ScriptTrigger;
    /** JavaScriptコード本体 */
    code: string;
    /** スクリプトが有効かどうか */
    enabled: boolean;
    description?: string;
    createdAt: string;
    updatedAt: string;
}
/** Unity に書き出すスクリプトバンドル (JSON IR) */
export interface ScriptBundle {
    version: '1.0';
    scripts: Array<{
        id: string;
        trigger: ScriptTrigger;
        code: string;
        enabled: boolean;
    }>;
}
export interface ArsistProject {
    id: string;
    name: string;
    version: string;
    createdAt: string;
    updatedAt: string;
    appType: ProjectTemplate;
    targetDevice: string;
    arSettings: ARSettings;
    designSystem: DesignSystem;
    dataFlow: DataFlowDefinition;
    scenes: SceneData[];
    uiLayouts: UILayoutData[];
    buildSettings: BuildSettings;
    /** 動的スクリプト定義リスト (省略可・後方互換) */
    scripts?: ScriptData[];
}
export interface BuildConfig {
    targetDevice: string;
    buildTarget: 'Android';
    outputPath: string;
    developmentBuild: boolean;
}
export interface BuildResult {
    success: boolean;
    outputPath?: string;
    error?: string;
    warnings?: string[];
    buildTime?: number;
    fileSize?: number;
}
export interface LayoutSettings {
    leftPanelWidth: number;
    rightPanelWidth: number;
    bottomPanelHeight: number;
}
//# sourceMappingURL=types.d.ts.map