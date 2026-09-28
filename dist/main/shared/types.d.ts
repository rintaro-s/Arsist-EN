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
    /**
     * 見つめ続けたら押す、までの秒数 (default: 0 = 使わない)。
     * コントローラーが手元に無い / つながっていないときの逃げ道。
     * コントローラーが見えている間は、そちらが優先でこちらは働かない。
     */
    gazeDwellSeconds?: number;
    /**
     * 文字入力 (Input 要素) で、どのキーボードを出すか (default: 'auto')。
     *   'auto'   端末のキーボードを試し、出なければアプリの中のキーボードに落とす
     *   'device' 端末のキーボードだけを使う (日本語・音声入力・予測変換が使える)
     *   'inApp'  アプリの中のキーボードだけを使う (英数字。どの端末でも同じ見た目・同じ操作)
     * 端末のキーボードが「どこに出るか」はエンジンからは分からない。たとえば XREAL では
     * Android の入力方式が**手元のスマホ側に出る**ため、グラス内では何も起きないように見える。
     * そういう端末では 'inApp' を選べるようにしてある。
     */
    textInput?: 'auto' | 'device' | 'inApp';
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
    /** スマホ (Android_Phone) で動かすときの設定 */
    phone?: PhoneSettings;
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
/**
 * スマホ (ヘッドセットではない Android 端末) で動かすときの設定。
 *
 * ヘッドセットの頭の向きの代わりにジャイロで見回す (3DoF)。これで同じシーンが
 * Quest でも XREAL でもスマホでも動く。
 */
export interface PhoneSettings {
    /** 段ボールゴーグル用に画面を左右に分ける。VR のときだけ効く */
    stereo?: boolean;
    /**
     * 背面カメラの横の画角 (度)。既定 63。
     * WebCamTexture は画角を教えてくれないので仮定値。映像と描いたものがずれるならここを直す
     */
    cameraFov?: number;
    /** 画面の向き。既定 'landscape' */
    orientation?: 'landscape' | 'portrait';
}
export interface LogRelaySettings {
    /** default: true */
    enabled: boolean;
    /** default: 9770 */
    port?: number;
}
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
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
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
export type PlacementSide = 'center' | 'left' | 'right' | 'above' | 'below' | 'front' | 'behind';
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
export type PerceptionTaskType = 
/** 枠の中の文字を読む */
'ocr'
/** 画素を取るだけ。動作確認や、後段をスクリプトで書きたいとき */
 | 'capture'
/** 画像処理パイプラインを流す。中身はユーザーが組む */
 | 'vision';
/**
 * 画像処理の一手。
 *
 * 値は名前で受け渡す。型は op ごとに決まっていて、噛み合わない繋ぎ方は
 * エディタとビルド時の両方で弾く。
 */
export type VisionOpType = 
/** 色 → 輝度 */
'grayscale'
/** 輝度 → 輝度。ノイズを落とす */
 | 'blur'
/** 輝度 → 勾配。輪郭の強さと向き */
 | 'sobel'
/** 輝度 → マスク。細い輪郭線 */
 | 'canny'
/** 勾配 → 境界線。端から走査して最初にぶつかる強い輪郭を追う */
 | 'edgeScan'
/** 境界線 → マスク。境界のどちら側を残すか */
 | 'maskSide'
/** 色 → マスク。色相・彩度・明度の範囲で拾う */
 | 'hsvRange'
/** 輝度 → マスク。固定値・大津法・「周りと比べて」で二値化 */
 | 'threshold'
/** マスク → マスク。膨張・収縮で穴と点を整える */
 | 'morphology'
/** マスク+マスク → マスク。論理演算 */
 | 'maskCombine'
/** マスク → マスク。一番大きい塊だけ残す */
 | 'largestBlob'
/** マスク → 塊の一覧。数・大きさ・位置 */
 | 'blobs'
/** マスク → 輪郭の一覧。形の名前つき */
 | 'contours'
/** マスク+画 → 統計値。面積比・平均・マスク外との比 */
 | 'stats'
/** 統計値 → 真偽。条件を満たさなければパイプラインを止める */
 | 'gate'
/** 色+マスク → 色。マスクの中を塗り替える */
 | 'recolor'
/** 色+マスク → 色の情報。代表色 */
 | 'dominantColor'
/** 輝度 → 一致位置。テンプレートマッチング */
 | 'templateMatch'
/**
 * 色 → (モデル次第) 数値 / 塊 / マスク。学習済みモデル (ONNX) を流す。
 * 出力の型はモデル定義の task で決まる: classify → 数値, detect → 塊, segment → マスク。
 */
 | 'infer'
/** 塊 → 塊。ラベル・スコア・大きさで絞り、並べ替える */
 | 'select'
/** 塊 → 数値。件数、ラベルごとの数、一番確かな物 */
 | 'countItems'
/** 塊 → 塊。フレームをまたいで同じ物に ID を付け、位置を均し、速度を出す */
 | 'track'
/** 色+塊 → 色。枠を描く */
 | 'annotate'
/** 塊 → マスク。枠 (または塗り潰し) のマスク。world 出力の alpha に */
 | 'boxMask'
/** 数値 → 数値。数は指数平滑、文字と真偽は多数決。ちらつきを落ち着かせる */
 | 'stabilize'
/** 輝度 → マスク。前のフレームと違う所 */
 | 'motion'
/** 数値 → 数値。条件を満たしたらイベントを発火する (止めない) */
 | 'event'
/** マスク → 四角形の一覧 (看板・画面・紙) */
 | 'quads'
/** 色+四角形 → 色。四角形の中を正対した長方形に起こす */
 | 'rectify';
export interface VisionOp {
    id: string;
    op: VisionOpType;
    /**
     * 入力の値名。op ごとに必要な数が決まっている。
     * 省略すると直前の op の出力を使う。
     */
    in?: string[];
    /** 出力の値名。後ろの op や outputs から参照する */
    out: string;
    params?: Record<string, unknown>;
    /**
     * 一時的に外す (素通し)。入力と出力の型が同じ op でだけ使える
     * (blur / morphology / select / track / stabilize / annotate …)。
     * 型が変わる op は外せない: 後ろの一手が受け取るものが無くなるため。
     */
    disabled?: boolean;
}
/** パイプラインの結果をどこに出すか。 */
export type VisionOutput = 
/** 数値・文字列・統計値を DataStore へ。UI から bind できる */
{
    kind: 'store';
    value: string;
    storeAs: string;
}
/**
 * 現実に重ねる。value は色の画、alpha はマスク。
 * 撮影時のカメラ姿勢に合わせてワールドに固定されるので、AR として成立する。
 * ビューポートソースのタスクでのみ使える。
 */
 | {
    kind: 'world';
    value: string;
    alpha?: string;
}
/** Canvas の Image 要素に出す。確認用 */
 | {
    kind: 'image';
    value: string;
    alpha?: string;
    bindingId: string;
}
/**
 * 見つけた物の位置に置く。value は塊 (blobs) か四角形 (quads)。
 * 画素 → 光線 → 指定の距離 (m) で、撮影時のカメラ姿勢からワールドに置く。
 * label は札に出す項目 ('label' / 'score' / 'labelScore' / 'id' / 'none')。
 * objectId を指定すると、最初の項目の位置へそのシーンオブジェクト (assetId) を動かす。
 * ビューポートソースのタスクでのみ使える。
 */
 | {
    kind: 'anchor';
    value: string;
    distance?: number;
    label?: string;
    objectId?: string;
    maxItems?: number;
};
export interface VisionPipeline {
    id: string;
    name: string;
    /**
     * 処理前に縮める幅 (px)。既定 480。
     * 大きいままだと携帯端末では重く、細かいノイズも拾いすぎる。
     */
    maxWidth?: number;
    ops: VisionOp[];
    outputs: VisionOutput[];
}
/** どの画素を見るか。 */
export type PerceptionSource = 
/** 追跡中のターゲット上の領域。斜めから見ていても正対に直してから処理する */
{
    kind: 'region';
    targetId: string;
    regionId: string;
}
/** カメラ画像そのものの矩形（正規化, 原点左下）。ターゲット不要 */
 | {
    kind: 'viewport';
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
};
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
 * 「所定のアクションで、指定の枠の中を見る」定義。
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
    trigger: ScriptTrigger | {
        type: 'manual';
    };
    /** 結果を書き込む DataStore キー */
    storeAs: string;
    engine?: PerceptionEngineConfig;
    /** type === 'vision' のときに流すパイプライン */
    pipeline?: VisionPipeline;
}
export interface PerceptionSettings {
    targets: PerceptionTarget[];
    /** 画像認識タスク (省略可) */
    tasks?: PerceptionTask[];
}
/** モデルを何に使うか。 */
export type ModelUse = 'image' | 'text' | 'tensor';
/**
 * モデルが解く問題。`infer` op の出力の型をこれで決める。
 *   classify → 数値 (label / score / top)
 *   detect   → 塊の一覧 (label / score / x / y / width / height)
 *   segment  → マスク
 *   raw      → 数値 (出力テンソルの生の値。デバッグやスクリプト用)
 */
export type ModelTask = 'classify' | 'detect' | 'segment' | 'raw';
/** 入力テンソルの作り方。 */
export interface ModelInputSpec {
    /** ONNX の入力名。省略時は最初の入力 */
    name?: string;
    width: number;
    height: number;
    /** 'NCHW' (PyTorch 系) か 'NHWC' (TensorFlow 系) */
    layout: 'NCHW' | 'NHWC';
    /** 3 = 色, 1 = 輝度 */
    channels: 1 | 3;
    colorOrder: 'RGB' | 'BGR';
    /** 画素値に掛ける係数。0..1 にするなら 1/255 */
    scale: number;
    /** (画素 * scale - mean) / std。チャンネルごと。ImageNet 系なら [0.485,0.456,0.406] / [0.229,0.224,0.225] */
    mean: number[];
    std: number[];
    /**
     * 'stretch'   = 入力の大きさに引き伸ばす
     * 'letterbox' = 比率を保って縮め、余白を padColor で埋める (YOLO 系はこちら)
     */
    resize: 'stretch' | 'letterbox';
    /** letterbox の余白 (0..255)。既定 114 */
    padValue?: number;
}
/** 出力テンソルの読み方。task ごとに使う項目が違う。 */
export interface ModelOutputSpec {
    /** 主出力の名前。省略時は最初の出力 */
    name?: string;
    /** 出力がロジットなら softmax を掛ける */
    softmax?: boolean;
    /** 上位いくつを top に入れるか (既定 5) */
    topK?: number;
    /**
     * 'yolo'      = [1, 4+C, N] か [1, N, 4+C] (YOLOv8/11)。cx,cy,w,h + クラス確率
     * 'yolo5'     = [1, N, 5+C] (YOLOv5)。cx,cy,w,h,objectness + クラス確率
     * 'xyxyScoreClass' = [N, 6] か [1, N, 6]。x1,y1,x2,y2,score,class (NMS 済みの出力)
     * 'separate'  = boxes / scores / classes が別々の出力
     */
    boxLayout?: 'yolo' | 'yolo5' | 'xyxyScoreClass' | 'separate';
    /** separate のときの出力名 */
    boxesName?: string;
    scoresName?: string;
    classesName?: string;
    /** 箱の座標が 0..1 なら true、入力画素なら false */
    boxesNormalized?: boolean;
    /** 箱の形式。yolo 系は cxcywh、それ以外は大抵 xyxy */
    boxFormat?: 'xyxy' | 'cxcywh' | 'xywh';
    scoreThreshold?: number;
    iouThreshold?: number;
    maxItems?: number;
    /**
     * 'argmax'  = [1, C, H, W] / [1, H, W, C]。一番強いクラスが classIndex ならマスク
     * 'sigmoid' = [1, 1, H, W] / [1, H, W]。値が maskThreshold を超えたらマスク
     */
    maskMode?: 'argmax' | 'sigmoid';
    /** argmax のとき、マスクにするクラス番号 (複数可) */
    classIndices?: number[];
    maskThreshold?: number;
    /** 出力にロジットが入っていて sigmoid が要るなら true */
    applySigmoid?: boolean;
    /** 生の値を先頭からいくつ store に入れるか (既定 16) */
    rawLimit?: number;
}
/** どの計算機で動かすか。'auto' はコンピュートシェーダーが使えれば GPU */
export type ModelBackend = 'auto' | 'gpu' | 'cpu';
/**
 * 実機で何に動かしてもらうか。
 *   'unity'       Unity の Inference Engine。GPU で動く。標準の ONNX 演算子だけのモデル向け
 *   'onnxruntime' APK に同梱する ONNX Runtime。CPU だが、最近の言語モデルの書き出し
 *                 (GroupQueryAttention / MatMulNBits / If など) も動く。33MB 大きくなる
 *   'auto'        取り込み時に調べた演算子で決める (Unity が読めないものがあれば onnxruntime)
 */
export type ModelRuntime = 'auto' | 'unity' | 'onnxruntime';
/** ONNX を読んで分かったこと。エディタが埋め、以後は参考情報 */
export interface ModelInspection {
    irVersion?: number;
    opset?: number;
    producer?: string;
    inputs: Array<{
        name: string;
        dims: Array<number | string>;
        elemType?: string;
    }>;
    outputs: Array<{
        name: string;
        dims: Array<number | string>;
        elemType?: string;
    }>;
    /** 使われている演算子の種類 */
    opTypes?: string[];
    /** 標準 ONNX 以外のドメイン (com.microsoft など)。Unity では動かない */
    customDomains?: string[];
    /** 重みを別ファイルに持つモデルが参照しているファイル名。ビルド時に一緒にコピーされる */
    externalData?: string[];
    fileSize?: number;
}
/** 文章のモデルが何をするか。 */
export type TextModelTask = 'generate' | 'embed' | 'classify';
/**
 * 会話をモデルが学習した書式にする方法。指示に従う LLM は学習時と同じ書式でないとまともに答えない。
 *   chatml (Qwen / SmolLM …) / llama3 / phi3 / gemma / mistral (Llama 2 も) / none (補完用) / custom
 */
export type ChatFormatName = 'chatml' | 'llama3' | 'phi3' | 'gemma' | 'mistral' | 'none' | 'custom';
/** 文章のモデル (use: 'text') の設定。Runtime/Inference/Text/TextModelSpec.cs が読む。 */
export interface TextModelSpec {
    task: TextModelTask;
    /** HuggingFace の tokenizer.json (プロジェクト相対、Assets/Models/ 以下)。BPE / WordPiece に対応 */
    tokenizer: string;
    chatFormat?: ChatFormatName;
    /** chatFormat が custom のときの型。{system} と {prompt} を埋める */
    promptTemplate?: string;
    /** 既定の system の指示。スクリプトの options.system で上書きできる */
    systemPrompt?: string;
    /** 1 回に書かせる長さの上限 (トークン)。既定 128 */
    maxNewTokens?: number;
    /** 0 = 毎回同じ答え。高いほどばらつく。既定 0.7 */
    temperature?: number;
    topK?: number;
    topP?: number;
    /** 同じ言葉の繰り返しを抑える。1 = 抑えない。既定 1.1 */
    repetitionPenalty?: number;
    /** この文字列が出たら止める */
    stop?: string[];
    /** 生成を止めるトークン (<|im_end|> など)。取り込み時に tokenizer_config / generation_config から埋める */
    eosTokens?: string[];
    /** プロンプト + 生成の長さの上限 (トークン)。既定 2048 */
    maxContext?: number;
    /**
     * 考えている途中 (<think> … </think>) を答えから外す。既定 true。
     * Qwen3 系など、答えの前に考えを書くモデル向け。
     */
    hideThinking?: boolean;
    /** 'mean' (平均) / 'cls' (先頭) / 'last' (最後)。出力が既に [1, D] ならそのまま */
    pooling?: 'mean' | 'cls' | 'last';
    /** ベクトルを長さ 1 にする (似ている度合いを測るならそのままで良い)。既定 true */
    normalize?: boolean;
    /** 使う出力の名前。省略時は sentence_embedding / last_hidden_state / logits の順に探す */
    outputName?: string;
    /** 入力の長さの上限 (トークン)。既定 256 */
    maxLength?: number;
    /** classify のクラス番号 → 名前 */
    labels?: string[];
}
export interface ModelDefinition {
    id: string;
    name: string;
    /** ONNX ファイル (プロジェクト相対、Assets/Models/ 以下) */
    file: string;
    format: 'onnx';
    /** 何に使うか (IR v3)。これで下のどの項目を読むかが決まる */
    use: ModelUse;
    task?: ModelTask;
    input?: ModelInputSpec;
    output?: ModelOutputSpec;
    /** クラス番号 → 名前。無ければ番号がそのまま名前になる */
    labels?: string[];
    text?: TextModelSpec;
    backend?: ModelBackend;
    /** 実機でどちらの推論器に動かしてもらうか。既定は 'auto' */
    runtime?: ModelRuntime;
    inspection?: ModelInspection;
    /**
     * APK に積むか。既定は true。
     * エディタの「試す」では動くが実機では動かないモデル (量子化された LLM など) を、
     * 手元で使いながらビルドからは外すための項目。
     */
    includeInBuild?: boolean;
}
/** 画像のモデル (画像認識の `infer` op に使える)。 */
export type ImageModelDefinition = ModelDefinition & {
    use: 'image';
    task: ModelTask;
    input: ModelInputSpec;
    output: ModelOutputSpec;
};
export declare function isImageModel(model: ModelDefinition | undefined | null): model is ImageModelDefinition;
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
export type UIElementType = 'Panel' | 'Text' | 'Button' | 'Image' | 'Slider' | 'Input' | 'Gauge' | 'Graph'
/**
 * アプリの中に出すキーボード (ArsistVirtualKeyboard)。
 * 打った文字は bind.key に入り、確定すると "<bindingId>:submit" のイベントが鳴る。
 * content にキーの並びを書ける ("1234567890|qwertyuiop|asdfghjkl|zxcvbnm")。
 * かな漢字変換が要るなら Input 要素 (端末のキーボード) を使う。
 */
 | 'Keyboard';
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
    /** アプリ (プロジェクト) のバージョン。ユーザーが決める。IR の版ではない */
    version: string;
    /**
     * IR (このファイル形式) の版。src/shared/irVersion.ts の CURRENT_IR_VERSION。
     * 無ければ 1 (この項目が無かった頃のプロジェクト)。
     * 古い版のプロジェクトを開くと、Unity と同じように「アップグレードするか」を訊く。
     * 移行の中身は src/main/project/migrations.ts。
     */
    irVersion?: number;
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
    /** 画像処理パイプラインの `infer` op が使う学習済みモデル (省略可) */
    models?: ModelDefinition[];
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