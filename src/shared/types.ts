/**
 * Arsist Engine — 中間表現 (IR) 型定義
 *
 * 本システムの唯一の正 (Single Source of Truth)。
 * DataSource → DataStore → UI の3層宣言型アーキテクチャ。
 *
 * ユーザーは C# を一切書かない。
 * ユーザーが扱うのは「UI定義」と「データ定義」のみ。
 */

// ========================================
// プロジェクト設定
// ========================================

export type ProjectTemplate =
  | '3d_ar_scene'
  | '2d_floating_screen'
  | 'head_locked_hud';

export type TrackingMode = '6dof' | '3dof' | 'head_locked';

export type PresentationMode =
  | 'world_anchored'
  | 'floating_screen'
  | 'head_locked_hud';

// ========================================
// DataFlow 定義
// ========================================

export type DataSourceMode = 'polling' | 'event';

/** センサー・通信・システムのデータ取得元 */
export type DataSourceType =
  | 'XR_Tracker'
  | 'XR_HandPose'
  | 'Device_Status'
  | 'Location_Provider'
  | 'REST_Client'
  | 'WebSocket_Stream'
  | 'MQTT_Subscriber'
  | 'System_Clock'
  | 'Voice_Recognition'
  | 'Microphone_Level';

/** DataStore の値を加工するトランスフォーム */
export type TransformType =
  | 'Formula'
  | 'Clamper'
  | 'Remap'
  | 'Smoother'
  | 'Comparator'
  | 'Threshold'
  | 'State_Mapper'
  | 'String_Template'
  | 'Time_Formatter'
  | 'History_Buffer'
  | 'Accumulator';

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

// ========================================
// AR 設定
// ========================================

/**
 * 背景（カメラの clear）の描き方。
 *
 * XREAL のような光学シースルー機では、そもそも黒＝素通しなので選択の余地は無い
 * （常に passthrough 相当）。Quest のようなビデオシースルー機だけが、
 * 「パススルー映像を見せる MR」と「現実を隠す VR」を選べる。
 */
export type BackgroundMode =
  | 'passthrough'   // MR: 外カメラ映像を背景に出す
  | 'skybox'        // VR: Skybox を背景に出す
  | 'solidColor';   // VR: 単色で塗りつぶす

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
  /** 実機のログを開発マシンへ流す設定 (default: 有効) */
  logRelay?: LogRelaySettings;
}

/**
 * 実機ログの LAN 中継。
 *
 * ビルドしたマシンの LAN アドレスをビルド時に APK へ焼き込み、
 * 起動したアプリがそこへ UDP でログを投げる。adb を繋がずに実機のログが読める。
 * 「ビルドした本人のマシンだけを信頼する」ので、ペアリング操作は要らない。
 *
 * 配布するビルドでは切ること（ログが LAN に平文で流れる）。
 */
export interface LogRelaySettings {
  /** default: true */
  enabled: boolean;
  /** default: 9770 */
  port?: number;
}

// ========================================
// Perception (画像アンカー)
// ========================================

/**
 * 現実世界から実行時に検出される対象。
 *
 * これは IR に初めて入る「作者が決めない姿勢」の語彙であり、将来 'plane' や
 * 'objectClass' を足せるように種別を持たせてある。詳細は doc/11-perception.md。
 */
export type PerceptionTargetType = 'image';

export interface PerceptionTarget {
  id: string;
  name: string;
  type: PerceptionTargetType;
  /** 参照写真のパス（プロジェクト相対）。ビルド時に StreamingAssets/Perception へコピーされる */
  imagePath: string;
  /**
   * 写真に写っている実物の横幅（メートル）。
   * スケールは画像だけからは復元できないため必須。
   */
  physicalWidth: number;
  /** 実物の高さ（メートル）。省略時は写真のアスペクト比から算出される */
  physicalHeight?: number;
  /** 見失ってから姿勢を保持し続ける時間 (ms, default 2000) */
  holdMs?: number;
  /** エディタが算出する追跡しやすさスコア 0-100（参考値。ビルドは止めない） */
  quality?: number;
  /** 写真の上に描いた矩形。位置指定の基準にも、OCR 等の対象にもなる */
  regions?: PerceptionRegion[];
}

/**
 * 参照写真の上に描く名前付き矩形。
 *
 * 独立して追跡されるものではなく、既に追跡中の平面ターゲットの部分矩形なので、
 * ランタイムコストはゼロでターゲットの姿勢をそのまま継承する。
 */
export interface PerceptionRegion {
  id: string;
  name: string;
  /**
   * 写真に対する正規化座標 (0..1)。原点は写真の左下、y は上向き。
   * （ランタイムの画像規約と揃えてある。エディタは上下を反転して描く。）
   */
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * SceneObject を PerceptionTarget に貼り付ける指定。
 *
 * anchor がある場合、SceneObject.transform は「絶対姿勢」ではなく
 * 「ターゲット座標系でのオフセット」として解釈される。
 * ターゲット座標系は原点=ターゲット中心・+X=右・+Y=上・+Z=面から手前（Unity の Quad 準拠）。
 */
export interface ObjectAnchor {
  /** PerceptionTarget.id */
  targetId: string;
  /** まだ一度も検出できていない / 見失った時の挙動 (default: 'lastKnown') */
  whenNotFound: 'hidden' | 'lastKnown' | 'visible';
  /**
   * 「その物の右に10cm」のような、方向と隙間による配置。
   * 省略時は transform を素のオフセットとして使う（従来どおり）。
   */
  placement?: AnchorPlacement;
}

/** ターゲット座標系での方向 (+X 右 / +Y 上 / +Z 面から手前)。 */
export type PlacementSide =
  | 'center' | 'left' | 'right' | 'above' | 'below' | 'front' | 'behind';

/**
 * 実寸を使った相対配置。
 *
 * 生のオフセット (x = 0.2) は、ターゲットの physicalWidth か置くオブジェクトの
 * 大きさが変わった瞬間に「横に並ぶ」という意味を失う。方向＋隙間なら両方に耐える。
 * placement と transform は合成される（placement が基準姿勢、transform が微調整）。
 */
export interface AnchorPlacement {
  /** 基準にする領域。省略時はターゲット全体 */
  regionId?: string;
  side: PlacementSide;
  /** 基準の縁からの間隔 (m)。side='center' では無視される */
  gap: number;
  /** 置くオブジェクト側のどこを合わせるか。'near' = 手前の縁、'center' = 中心 */
  align: 'near' | 'center';
  /** 縁に沿った方向の揃え。side='right' なら上下、'above' なら左右 */
  cross: 'start' | 'center' | 'end';
  /** 向き。'user' は常にユーザーの方を向く（ラベル向け） */
  facing: 'target' | 'user';
}

/** 画素に対して何をするか。将来: 'barcode' | 'color' | 'classify' */
export type PerceptionTaskType = 'ocr' | 'capture';

/** どの画素を見るか。 */
export type PerceptionSource =
  /** 追跡中のターゲット上の領域。斜めから見ていても正対に直してから処理する */
  | { kind: 'region'; targetId: string; regionId: string }
  /** カメラ画像そのものの矩形（正規化, 原点左下）。ターゲット不要 */
  | { kind: 'viewport'; rect: { x: number; y: number; width: number; height: number } };

/** 文字認識エンジンの選択。 */
export interface PerceptionEngineConfig {
  /**
   * 'mlkit' = 端末内 (ML Kit bundled, オフライン, Quest/Android のみ)
   * 'mock'  = 常に固定文字列を返す。実機なしで動作確認するため
   */
  kind: 'mlkit' | 'mock';
  /** ML Kit のモデル。'japanese' は日本語とLatinの両方を読む */
  script?: 'latin' | 'japanese';
  /** kind === 'mock' のときに返す文字列 */
  mockText?: string;
}

/**
 * 「所定のアクションで、指定の枠の中を読む」定義。
 *
 * 結果は DataStore に辞書として書かれ、UI の bind から
 * `<storeAs>.text` / `<storeAs>.status` のように参照できる。
 */
export interface PerceptionTask {
  id: string;
  name: string;
  type: PerceptionTaskType;
  source: PerceptionSource;
  /**
   * 既存の ScriptTrigger をそのまま使う。
   * 'manual' はスクリプト (perception.run) からのみ起動する。
   */
  trigger: ScriptTrigger | { type: 'manual' };
  /** 結果を書き込む DataStore キー */
  storeAs: string;
  engine?: PerceptionEngineConfig;
}

export interface PerceptionSettings {
  targets: PerceptionTarget[];
  /** 画像認識タスク (省略可) */
  tasks?: PerceptionTask[];
}

// ========================================
// デザインシステム
// ========================================

export interface DesignSystem {
  defaultFont: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
}

// ========================================
// ビルド設定
// ========================================

export interface BuildSettings {
  packageName: string;
  version: string;
  versionCode: number;
  minSdkVersion: number;
  targetSdkVersion: number;
  remoteInput?: RemoteInputSettings;
}

export interface RemoteInputSettings {
  udp?: { enabled: boolean; port: number };
  tcp?: { enabled: boolean; port: number };
  allowedEvents?: string[];
}

// ========================================
// シーンデータ
// ========================================

export interface SceneData {
  id: string;
  name: string;
  objects: SceneObject[];
}

export type SceneObjectType =
  | 'primitive'
  | 'model'
  | 'vrm'
  | 'light'
  | 'camera'
  | 'empty'
  | 'canvas';

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
  /**
   * 画像アンカーへの貼り付け指定。
   * 設定されている場合、transform はターゲット座標系のオフセットとして扱われる。
   */
  anchor?: ObjectAnchor;
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

// ========================================
// UI レイアウトデータ
// ========================================

export interface UILayoutData {
  id: string;
  name: string;
  /** uhd = 常時表示HUD, canvas = 3D空間サーフェス */
  scope: 'uhd' | 'canvas';
  resolution: { width: number; height: number };
  root: UIElement;
}

export type UIElementType =
  | 'Panel'
  | 'Text'
  | 'Button'
  | 'Image'
  | 'Slider'
  | 'Input'
  | 'Gauge'
  | 'Graph';

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

// ========================================
// スクリプトシステム
// ========================================

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

// ========================================
// プロジェクトルート
// ========================================

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
  /** 画像アンカー等の知覚ターゲット (省略可・後方互換) */
  perception?: PerceptionSettings;
}

// ========================================
// ビルド
// ========================================

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

// ========================================
// エディタ設定 (IR には含めない)
// ========================================

export interface LayoutSettings {
  leftPanelWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
}
