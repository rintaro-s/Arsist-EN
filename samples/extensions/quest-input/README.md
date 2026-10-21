# Quest の入力ぜんぶ — `quest-input`

Quest で使える入力を、スクリプト・UI の表示・スクリプトイベント・コード無しの操作のどれからでも使えるようにする拡張機能。

| 入力 | できること |
|---|---|
| **Touch コントローラー** | 全ボタン (トリガー・グリップ・A/B/X/Y・スティック押し込み・メニュー)、指を乗せているか (トリガー・ボタン・スティック・サムレスト)、トリガー/グリップの深さ、スティックの傾き・倒した向き、握り/指す位置と向き、**振動**、電池 |
| **ハンドトラッキング** | 26 関節の位置と向き、つまむ強さ、**ジェスチャー** (グー・指差し・ピース・パー・グッド・つまむ)、指している向き |
| **キーボード** | **システムキーボードをスクリプトから開く** (入力欄が無くてよい。日本語・音声入力つき)、**Bluetooth キーボード** の打鍵・文字 |
| **マイク** | 音量、**話し始め / 話し終わり**、話した部分を **WAV で受け取る** (既定 16 kHz)、秒数を指定して録音 |
| **ヘッドセット** | かぶった / 外した、入力フォーカス、トラッキングの喪失、リセンター、電池、**リフレッシュレートの取得と変更** |
| **コード無し** | 物を「つかめる」にすると、グリップや手で**つかんで動かす / 投げる** |

## どこで動くか

`requires: { all: [cap:controllers, cap:hand-tracking, sdk:meta-core] }` — Quest 向けのビルドにだけ入る。
XREAL・スマホ向けのビルドでは外れ、スクリプトの `controller` などは「何もしない代役」になる (落ちない)。

## 使い方

1. 上のタブの **拡張機能** → 「Quest の入力ぜんぶ」のスイッチを入れる (選ぶと設定・説明が出る)
2. コード無しで物をつかみたいとき: 物を選び、インスペクタ → 拡張機能 → **つかめる** を `つかんで動かす` / `つかんで投げる`
   - コントローラー: 物の近く (見た目の範囲 + 6 cm) でグリップを握る
   - 手: つまむか握る。**パネル (Canvas) は握るだけ** — つまむのはパネルのボタンを押す操作だから
   - 投げる物は、離した瞬間の手の速さで飛び、重力で落ちる。`quest-room` の当たり判定があれば本物の床や机で止まる
3. スクリプト / UI / イベントから使う (下)

## スクリプト

```js
// コントローラー
controller.on('right.a.down', function () { controller.vibrate('right', 0.6, 0.08); });
controller.on('left.stick.right', function () { log('次へ'); });
if (controller.isDown('right', 'trigger')) { … }
var t = controller.value('right', 'trigger');   // 0..1
var s = controller.stick('left');                // { x, y }
var p = controller.aim('right');                 // { x, y, z, rx, ry, rz, forward: {…}, tracked }

// 手
hands.on('right.gesture', function (name, previous) { log(previous + ' → ' + name); });
hands.on('left.pinch.start', function () { … });
hands.gesture('right');                          // 'fist' | 'thumbsUp' | 'pinch' | 'point' | 'peace' | 'open' | 'none'
hands.pinch('left');                             // 0..1
hands.joint('right', 'indexTip');                // { x, y, z, rx, ry, rz, forward }
hands.joints('left');                            // { wrist, palm, thumbTip, … }

// キーボード
keyboard.open({ text: '', placeholder: '名前', multiline: false }, function (text, submitted) { … });
keyboard.on('key', function (name) { if (name === 'space') … });   // Bluetooth キーボード
keyboard.on('text', function (chars) { … });

// マイク
mic.on('speechEnd', function (r) {               // 話し終わったら、その発話
  // r = { ok, wav: '<base64>', sampleRate: 16000, seconds, level }
  api.post(MY_STT_URL, JSON.stringify({ audio: r.wav }), function (res) { … });
});
mic.start();                                     // 初回は許可を求める
mic.record(3, function (r) { … });               // これから 3 秒

// ヘッドセット
headset.on('unmounted', function () { … });      // 外した
headset.setRefreshRate(120);                     // headset.refreshRates() にある値
```

### 出来事 (`on(name, fn)`) — どのオブジェクトの `on` でも同じ表

| 名前 | 引数 |
|---|---|
| `<hand>.<button>.down` / `.up` — button: `trigger grip a b x y stick menu` (右は a/b、左は x/y) | |
| `<hand>.<part>.touch` / `.untouch` — part: `trigger a b x y stick thumbrest` | |
| `<hand>.stick.left` / `.right` / `.up` / `.down` (倒したとき 1 回) | |
| `<hand>.connected` / `.disconnected` | |
| `<hand>.hand.tracked` / `.lost` | |
| `<hand>.pinch.start` / `.end` | |
| `<hand>.gesture` | (name, previous) |
| `<hand>.gesture.<name>` (例: `right.gesture.thumbsUp`) | |
| `mode` (controllers / hands / none が変わった) | (mode, previous) |
| `grab` / `release` | ({ id, hand, by }) |
| `speechStart` / `speechEnd` | — / ({ ok, wav, sampleRate, seconds, level }) |
| `key` / `text` (Bluetooth キーボード) | (name) / (chars) |
| `change` / `submit` / `cancel` (システムキーボード) | (text) |
| `mounted` `unmounted` `focusLost` `focusGained` `trackingLost` `trackingAcquired` `recentered` | |

`<hand>` は `left` / `right`。

### スクリプトイベント (関数を書かずに)

同じ出来事が `quest-input:<名前>` としても鳴る。スクリプトのトリガーを
`{ type: "event", value: "quest-input:right.a.down" }` にすれば、A を押したときにそのスクリプトが走る。

## UI の表示 (store)

値が変わったときだけ書くので、UI の文字や表示切り替えにそのままつなげられる。

| キー | 値 |
|---|---|
| `input.mode` | controllers / hands / none |
| `input.<hand>.connected` | true / false |
| `input.<hand>.trigger` `grip` `a` `b` `x` `y` `stick` `menu` | 押しているか |
| `input.<hand>.triggerValue` `gripValue` `stickX` `stickY` | 0.05 刻み |
| `input.<hand>.handTracked` `pinch` `pinchStrength` `gesture` | 手 |
| `input.<hand>.holding` | つかんでいる物の ID |
| `mic.active` `mic.level` `mic.speaking` | マイク |
| `keyboard.open` `keyboard.text` | キーボード |
| `headset.mounted` `headset.battery` | ヘッドセット |

## 設定

| 項目 | 既定 | 意味 |
|---|---|---|
| publishToStore | on | 上の値をストアに入れる |
| scriptEvents | on | `quest-input:*` のスクリプトイベントを鳴らす |
| physicalKeyboard | on | Bluetooth キーボードを読む |
| micAutoStart | off | 起動したらマイクを開く (初回は許可を求める) |
| voiceThreshold | 0.45 | 話し始めとみなす音量 (0..1、dB 目盛り。0.5 ≈ -30 dBFS) |
| micOutputRate | 16 kHz | 渡す WAV のサンプルレート |
| gestureHoldSeconds | 0.1 | この時間続いた形だけをジェスチャーとして数える |

## 仕組みと、エンジン側でしたこと

- コントローラー: Unity の XR 入力 (`InputDevices`)。エンジンのレイと同じ経路。入力の名前は端末が実際に持つ一覧から探す
  (最初に繋がったとき `[Arsist:quest-input] controller right: … [Trigger, TriggerButton, …]` とログに出る)
- 手: XR Hands (`XRHandSubsystem`)。ジェスチャーの判定 (`HandGestureMath`) とマイクの計算 (`MicMath`) は
  UnityEngine に依存せず、`npm run test:perception` で合成データに対して検証している
- マイク: Unity の `Microphone`。端末上の音声認識は入れていない (Quest に Android 標準の音声認識サービスが無いため)。
  WAV を音声認識の API や、プロジェクトに入れた音声モデルに渡す
- この拡張機能は `feature:text-input` と `feature:hand-tracking` を名乗る。エンジンはそれを見て、入力欄が無くても
  システムキーボードの宣言 (`oculus.software.overlay_keyboard` / requiresSystemKeyboard) を、
  ビルド設定でハンドトラッキングを切っていても手の宣言を入れる
- **エンジンの修正 (この拡張機能を作る中で見つけたもの)**: エンジンのハンドトラッキング操作 (`ArsistHandInteraction`) は
  中身が `#if XR_HANDS` で囲まれていたのに、その define がどこでも立っておらず、空のクラスとしてビルドされていた
  (それまでの APK の IL2CPP メタデータに `ComputePinch` などが無い)。さらに OpenXR の "Hand Tracking Subsystem" も
  有効になっていなかった。どちらも Quest ビルドで入るようにした (`ArsistBuildPipeline.ApplyDeviceScriptingDefines` /
  `EnableQuestOpenXRFeatures`)。直列化するフィールドは `#if` の外に出した (ビルド途中に立つ define の内側に置くと
  `script class layout is incompatible between the editor and the player` でビルドが止まる)

## 状態

ビルド (コンパイル・権限・機能の宣言・IL2CPP に API が残ること) は確認済み。
**実機での動作は未確認** (このリポジトリの作業では端末に入れていない)。最初に試すときは
`npm run logs` で `[Arsist:quest-input]` を見る — コントローラーの入力名の一覧、手のサブシステムが動いたか、
マイクのサンプルレート、つかんだ / 離したが出る。
