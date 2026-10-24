/**
 * Layster.Spatial β 1.0.0 — 空間を書く IR の型 (doc/19-layster.md §3)。
 *
 * これが Spatial の唯一の正。エディタ (src/renderer/spatial/)・main (src/main/layster/)・
 * エージェントの道具 (spatial_*)・ビルドへの書き出し (lower.ts)・ランタイム (Runtime/Spatial/) は、
 * すべてこの形を読む。Layster.Virtual (../../types.ts) とは互換性を持たない。
 *
 * 約束:
 *   - 単位はメートル・度・秒 (ミリ秒は名前に Ms を付ける)
 *   - 軸は右・上・前 (RUF): +X 右 / +Y 上 / +Z 前。Unity と同じ。yaw は上から見て時計回りが正
 *   - 位置は必ず frame と一緒に書く (Offset)。entity の位置は world
 *   - ベクトルは [x, y, z] の配列 (エージェントが書きやすく、JSON で短い)
 */

import type { LaysterHeader } from '../version';
import type { ProjectExtensionState } from '../../extensions';
import type { ModelDefinition } from '../../types';

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

// ========================================
// 座標系
// ========================================

/**
 * 'world'       起動したときのユーザーの足元 (床の高さ)。+Z は起動時の水平の向き
 * 'user'        今のユーザーの足元。向きは頭の水平の向き。重力に沿う
 * 'head'        今の頭 (目の間)。頭と一緒に傾く
 * 'hand.left' / 'hand.right'  手のひら (無ければコントローラーの握り)
 * 'thing:<id>' / 'entity:<id>' / 'body:<id>'
 */
export type FrameRef =
  | 'world'
  | 'user'
  | 'head'
  | 'hand.left'
  | 'hand.right'
  | `thing:${string}`
  | `entity:${string}`
  | `body:${string}`;

/** frame からのずれ。 */
export interface Offset {
  frame: FrameRef;
  at: Vec3;
  /** frame に対する向き (度)。省略時は facing に従う */
  yaw?: number;
}

/** world での姿勢 (重力に沿う物はこれで足りる)。 */
export interface Pose {
  at: Vec3;
  yaw: number;
}

// ========================================
// 世界の状態
// ========================================

/**
 * できること。置き方と AI の両方が使う共通の言葉。
 * 語彙 (vocabulary.ts) が言葉ごとの既定を持つ。
 */
export type Affordance = 'support' | 'sit' | 'mount' | 'walk' | 'grasp' | 'obstacle' | 'screen';

export const AFFORDANCES: readonly Affordance[] = ['support', 'sit', 'mount', 'walk', 'grasp', 'obstacle', 'screen'];

/**
 * 世界にあるもの。部屋のスキャン・物体検出・Mind の推測・試す空間はすべてこの形。
 * 形は向きのある箱にそろえる (平面は厚み 0 の箱)。縦の面 (壁) の「部屋の内側」は箱のローカル +Z。
 */
export interface Entity {
  id: string;
  /** 何か。先頭が主。語彙は vocabulary.ts (同義語は正規化される) */
  is: string[];
  /** world での箱の中心 */
  at: Vec3;
  /** 箱の向き (度)。既定 0 */
  yaw?: number;
  /** 箱の大きさ [幅 (ローカル x), 高さ (y), 奥行き (z)] */
  size: Vec3;
  /** できること。無ければ is から決まる (vocabulary.affordancesOf) */
  has?: Affordance[];
  /** 0..1 */
  confidence: number;
  /** 最後に見た時刻 (起動からの秒)。試す空間では省略 */
  seenAt?: number;
  /** 'scan' | 'detector:<id>' | 'mind:<id>' | 'space' | 'user' | 'assumed' */
  source: string;
  data?: Record<string, unknown>;
}

/** entity を選ぶ条件。全部に当たるものを選ぶ。 */
export interface EntityQuery {
  /** id で 1 つに決める */
  id?: string;
  /** 言葉のどれか (同義語も当たる) */
  is?: string[];
  /** できることを全部持つ */
  has?: Affordance[];
  /** この言葉のどれかに当たるものは除く (「載せられる物、ただしベッドと床は除く」) */
  not?: string[];
  /** 上面 (縦の面なら前面) の大きさ [幅, 奥行き] の下限 */
  minSize?: Vec2;
  /** ユーザーからの水平距離の上限 (m) */
  within?: number;
  /** 確かさの下限 (既定 0.2) */
  minConfidence?: number;
}

/** 何かを指す。 */
export type Target =
  | { thing: string }
  | { entity: EntityQuery }
  | { frame: FrameRef; at?: Vec3 }
  | { user: 'head' | 'feet' | 'hand.left' | 'hand.right' };

// ========================================
// 置き方
// ========================================

export type PlaceMode = 'world' | 'body' | 'head' | 'hand';
export type Facing = 'user' | 'away' | 'surface' | 'keep';
export type Prefer = 'closest' | 'farthest' | 'largest' | 'center' | 'inView';
export type Keep = 'none' | 'session' | 'forever';

/**
 * 置き方。座標ではなく条件で書く。解き方は solver.ts (ランタイムは同じ計算の C# 版)。
 * 解けなければ fallback を順に試し、全部だめなら既定の置き場所 (ユーザーの前) に置く。物は消えない。
 */
export interface Placement {
  /** 'world' 置いたら動かない (既定) / 'body' ついて来る / 'head' 視界に固定 / 'hand' 手に付く */
  mode?: PlaceMode;
  /** 何の上 (縦の面なら前) に置くか */
  on?: EntityQuery;
  /** 何の近くか */
  near?: Target;
  /** frame からのずれ。on / near が無いときはそこが置き場所。head / hand では必須 */
  at?: Offset;
  /** ユーザーからの水平距離の範囲 (m) */
  distance?: Vec2;
  /** 床からの高さの範囲 (m)。置く物の底の高さ */
  height?: Vec2;
  /** 既定 'user' */
  facing?: Facing;
  /** 置く瞬間に視界に入っていること。true = ±35°、数なら半角 (度) */
  visible?: boolean | number;
  /** 置く面に空いていてほしい広さ [幅, 奥行き] (m) */
  clearance?: Vec2;
  /** 離しておく物 (thing の id か entity の言葉)。0.3 m 以上 */
  avoid?: string[];
  /** 既定 'closest' */
  prefer?: Prefer;
  /** 置き場所の周りに取る輪の半径 (near のとき, m)。既定 [0.3, 1.0] */
  around?: Vec2;
  fallback?: Placement[];
  /** 'none' 世界が変わるたびに解き直す / 'session' 起動中は動かない (既定) / 'forever' 空間アンカーで覚える */
  keep?: Keep;
}

// ========================================
// 物 (things)
// ========================================

export type ShapeKind = 'cube' | 'sphere' | 'cylinder' | 'capsule' | 'quad';

export type PanelItem =
  | { type: 'text'; id?: string; text: string; size?: number; color?: string; align?: 'left' | 'center' | 'right'; bind?: string; reveal?: number }
  | { type: 'button'; id: string; text: string; size?: number; color?: string; background?: string; event?: string }
  | { type: 'input'; id: string; bind: string; placeholder?: string; size?: number }
  | { type: 'image'; id?: string; file: string; height: number }
  | { type: 'row'; items: PanelItem[]; gap?: number }
  | { type: 'space'; height: number };

export type ThingVisual =
  | { kind: 'shape'; shape: ShapeKind; size: Vec3; color: string; opacity?: number }
  | { kind: 'model'; file: string; /** 高さがこれになるように縮める (m) */ height?: number }
  | {
      kind: 'character';
      file: string;
      animation?: string;
      blink?: boolean;
      breathe?: boolean;
      lookAtUser?: 'off' | 'always' | 'nearby';
      /** 背の高さ (m)。置き方の計算に使う。既定 1.5 */
      height?: number;
    }
  | {
      kind: 'panel';
      /** [幅, 高さ] (m) */
      size: Vec2;
      items: PanelItem[];
      /** 1 m あたりの画素。既定 1000 (1 px = 1 mm) */
      ppm?: number;
      background?: string;
      padding?: number;
    }
  | { kind: 'label'; text: string; /** 文字の高さ (m)。既定 0.04 */ height?: number; color?: string }
  | { kind: 'marker' };

export interface Thing {
  id: string;
  name?: string;
  visual: ThingVisual;
  place: Placement;
  /** 起動したときに出すか (既定 true)。false なら show の行動で出る */
  visibleAtStart?: boolean;
  /** 本物の物に隠されるか (既定 'auto' = 端末ができるなら) */
  occlusion?: 'auto' | 'off';
  /** 手やコントローラーでつかんで動かせる (既定 false) */
  grabbable?: boolean;
  tags?: string[];
  /** 拡張機能ごとの指定 (Virtual の SceneObject.ext と同じ考え方) */
  ext?: Record<string, Record<string, unknown>>;
}

// ========================================
// 行動
// ========================================

export type Action =
  | { do: 'place'; thing: string; place?: Placement; at?: Offset }
  | { do: 'move'; thing: string; to: Target; speed?: number }
  | { do: 'look'; thing: string; at: Target }
  | { do: 'say'; thing?: string; text: string; audio?: string; seconds?: number }
  | { do: 'animate'; thing: string; clip: string; then?: string }
  | { do: 'show'; thing: string }
  | { do: 'hide'; thing: string }
  | { do: 'highlight'; target: Target; label?: string; color?: string; seconds?: number }
  | { do: 'set'; key: string; value: unknown }
  | { do: 'emit'; event: string; data?: unknown }
  | { do: 'believe'; entity: Partial<Entity> & { id: string } }
  | { do: 'forget'; entity: string }
  | { do: 'ask'; mind: string; text?: string }
  | { do: 'command'; body: string; name: string; args?: Record<string, unknown> };

export type ActionKind = Action['do'];

export const ACTION_KINDS: readonly ActionKind[] = [
  'place', 'move', 'look', 'say', 'animate', 'show', 'hide', 'highlight', 'set', 'emit', 'believe', 'forget', 'ask', 'command',
];

// ========================================
// Mind (AI)
// ========================================

export type MindRole = 'decide' | 'converse' | 'perceive' | 'predict' | 'act';
export type MindWhere = 'device' | 'edge' | 'cloud';
export type MindProtocol = 'layster' | 'openai-chat';

/** Mind に何を見せるか。 */
export interface Observation {
  /** 位置をどの frame で書いて渡すか。既定 'user' */
  frame?: FrameRef;
  /** 世界の状態のうち渡すもの。省略なら渡さない */
  world?: { is?: string[]; within?: number; max?: number; minConfidence?: number };
  /** アプリの物の姿勢を渡す (true = 全部, 配列 = その id だけ) */
  things?: boolean | string[];
  /** ユーザーの何を渡すか */
  user?: Array<'head' | 'hands' | 'gaze'>;
  /** カメラの静止画 (JPEG) を添える */
  camera?: { width: number; quality?: number };
  /** 最近の出来事をいくつ渡すか */
  events?: number;
  /** 渡す store のキー (末尾 '.' は前方一致) */
  store?: string[];
}

export interface MindRun {
  /** 'interval' 一定間隔 / 'change' 世界が変わったら / 'event' イベントで / 'manual' ask かスクリプトだけ */
  on: 'interval' | 'change' | 'event' | 'manual';
  everyMs?: number;
  event?: string;
  /** 前回から最低これだけ空ける (既定 1000) */
  minGapMs?: number;
  /** 返事を待つ上限 (既定 10000) */
  timeoutMs?: number;
}

export interface Mind {
  id: string;
  name?: string;
  role: MindRole;
  where: MindWhere;
  protocol: MindProtocol;
  /** URL。'{edge}' は端末に保存された PC のアドレス (host:port)、'{edge-host}' は host だけに置き換わる */
  endpoint: string;
  /** openai-chat のモデル名 */
  model?: string;
  /** 鍵の名前 (値は .layster/secrets.local.json)。header 既定 Authorization、scheme 既定 Bearer */
  auth?: { secret: string; header?: string; scheme?: string };
  /** 指示 (openai-chat では system、layster では goal) */
  instructions?: string;
  observe: Observation;
  output: {
    /** 返してよい行動 */
    actions?: ActionKind[];
    /** belief (世界の状態への推測) を受け取る */
    beliefs?: boolean;
    /** 自由な文を入れる store のキー */
    text?: string;
  };
  run: MindRun;
  /** 要求にそのまま足す項目 (openai-chat: reasoning_effort など) */
  extra?: Record<string, unknown>;
  /** 失敗したとき。use = 代わりの Mind、say = 字幕に出す文 */
  onFail?: { use?: string; say?: string };
}

/** Layster Mind Protocol の要求 (端末 → Mind)。doc/19 §3.5 */
export interface MindRequest {
  protocol: 'layster.mind/1';
  mind: string;
  tick: number;
  time: number;
  frame: FrameRef;
  world?: Entity[];
  things?: Array<{ id: string; at: Vec3; yaw: number; placed: boolean; visible: boolean }>;
  user?: {
    head?: { at: Vec3; forward: Vec3 } | null;
    hands?: { left: { at: Vec3 } | null; right: { at: Vec3 } | null };
    gaze?: { thing?: string; entity?: string; point?: Vec3 } | null;
  };
  camera?: { mime: 'image/jpeg'; width: number; height: number; data: string; fov?: number; pose?: { at: Vec3; forward: Vec3 } };
  events?: Array<{ t: number; name: string; data?: unknown }>;
  store?: Record<string, unknown>;
  /** 返してよい行動の一覧 */
  actions: ActionKind[];
  goal?: string;
  extra?: Record<string, unknown>;
}

/** Layster Mind Protocol の返事 (Mind → 端末)。 */
export interface MindReply {
  actions?: Action[];
  beliefs?: Array<Partial<Entity> & { id: string }>;
  text?: string;
  /** 次に呼んでほしい時間 (interval のときの目安) */
  nextInMs?: number;
}

// ========================================
// Body (現実の体)
// ========================================

export type BodyKind = 'arm' | 'mobile' | 'humanoid' | 'device' | 'other';
export type BodyArgType = 'number' | 'string' | 'boolean' | 'pose' | 'target';

export interface BodyCommand {
  name: string;
  description?: string;
  args?: Record<string, BodyArgType>;
  /** 'always' = 視界に確認を出し、承諾されてから送る / 'never' (既定) */
  confirm?: 'never' | 'always';
  /** rosbridge のとき: 送る topic と型 */
  ros?: { topic: string; type: string };
}

export interface Body {
  id: string;
  name?: string;
  kind: BodyKind;
  /** url の '{edge}' / '{edge-host}' は Mind.endpoint と同じく置き換わる */
  link: { protocol: 'layster-body' | 'rosbridge'; url: string };
  /** 体の根元がどこか。目印の thing を指す */
  base: { thing: string };
  /** 体の frame での動ける範囲 (箱) */
  workspace: { center: Vec3; size: Vec3 };
  commands: BodyCommand[];
  safety?: {
    /** ユーザーの手が目標からこれ以内なら送らない (m)。既定 0.25 */
    stopIfHandWithin?: number;
    /** 1 秒あたりの命令の上限。既定 2 */
    maxPerSecond?: number;
  };
  twin?: { showWorkspace?: boolean; file?: string };
  /** 状態 (関節・状態) を入れる store のキー。既定 'body.<id>' */
  store?: string;
}

// ========================================
// 規則
// ========================================

export type When =
  | { start: true }
  | { every: number }
  | { select: string }
  | { gaze: string; seconds?: number }
  | { near: string; to: Target; within: number }
  | { seen: EntityQuery }
  | { lost: EntityQuery }
  | { event: string }
  | { mind: string }
  | { placed: string }
  | { fallback: string };

export type Condition =
  | { store: string; eq?: unknown; ne?: unknown; gt?: number; lt?: number; exists?: boolean }
  | { has: EntityQuery }
  | { not: Condition };

export interface Rule {
  id: string;
  name?: string;
  when: When;
  if?: Condition[];
  do: Action[];
  cooldownMs?: number;
  enabled?: boolean;
}

// ========================================
// スクリプト・記録・その他
// ========================================

export interface SpatialScript {
  id: string;
  name: string;
  /** Virtual と同じきっかけ (onStart / onUpdate / interval / event) */
  trigger: { type: 'onStart' | 'onUpdate' | 'interval' | 'event'; value?: number | string };
  code: string;
  enabled: boolean;
}

export type RecordingStream = 'pose' | 'hands' | 'world' | 'events' | 'actions' | 'minds' | 'camera';

export interface Recording {
  enabled: boolean;
  streams: RecordingStream[];
  /** pose / hands を書く頻度。既定 10 */
  hz?: number;
  camera?: { width: number; everyMs: number };
  maxMinutes?: number;
  /** 記録を始める前に見せる文 (承諾されるまで記録しない) */
  consent: { text: string };
  /** 終わったら送る先 (multipart POST)。省略なら端末に残すだけ */
  send?: { url: string };
}

export interface SpatialApp {
  packageName: string;
  versionCode: number;
  minSdkVersion: number;
  targetSdkVersion: number;
  /** PC (edge) の既定のアドレス ('192.168.0.23:8000')。端末では変えられる (layster.edge) */
  edge?: string;
}

export interface SpatialPresentation {
  /** 'passthrough' 現実を見せる (MR) / 'virtual-room' 現実を見せない端末・設定での仮の部屋 */
  reality: 'passthrough' | 'virtual-room';
  /** 床の高さが分からない端末で、頭から床までと仮定する高さ (m)。既定 1.5 */
  assumedEyeHeight?: number;
}

export interface SpatialInteraction {
  controllers: boolean;
  hands: boolean;
  /** 見つめて押すまでの秒 (0 = 使わない) */
  gazeDwellSeconds?: number;
}

/** project.spatial.json の中身。 */
export interface SpatialProject {
  layster: LaysterHeader & { profile: 'spatial' };
  id: string;
  name: string;
  /** アプリの版 (ユーザーが決める) */
  version: string;
  createdAt: string;
  updatedAt: string;
  /** ビルドに使う端末 (Adapters/ のフォルダ名)。IR の中身は端末に依存しない */
  targetDevice: string;
  app: SpatialApp;
  presentation: SpatialPresentation;
  interaction: SpatialInteraction;
  things: Thing[];
  minds: Mind[];
  bodies: Body[];
  rules: Rule[];
  scripts: SpatialScript[];
  /** 端末に保存する store のキー ('memory.' = 前方一致) */
  memory: { persist: string[] };
  recording: Recording;
  /** エディタで試す空間。組み込みの id と、プロジェクトの spaces/*.json の id */
  spaces: { use: string[] };
  /** 端末の中で動かすモデル (ONNX)。Virtual と同じ定義を使う */
  models: ModelDefinition[];
  extensions: Record<string, ProjectExtensionState>;
}

// ========================================
// 試す空間
// ========================================

/** 試す空間 (組み込みは spaces.ts、プロジェクトのものは spaces/<id>.json)。 */
export interface SpaceFixture {
  id: string;
  name: { en: string; ja: string };
  description?: { en: string; ja: string };
  /** 起動したときのユーザー (world の原点にいる前提。立っているなら頭 1.6 m、座っているなら 1.2 m) */
  user: { eyeHeight: number };
  /** この空間で分かること (端末の違いを表す)。'scan' が無ければ床しか分からない */
  knows: Array<'scan' | 'hands' | 'camera'>;
  entities: Entity[];
}
