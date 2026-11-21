# Quest の入力ぜんぶ — `quest-input`

Quest で使える入力を、スクリプト・UI の表示・スクリプトイベント・コード無しの操作のどれからでも使えるようにする拡張機能。

| 入力 | できること |
|---|---|
| **Touch コントローラー** | 全ボタン (トリガー・グリップ・A/B/X/Y・スティック押し込み・メニュー)、指を乗せているか (トリガー・ボタン・スティック・サムレスト)、トリガー/グリップの深さ、スティックの傾き・倒した向き、握り/指す位置と向き、**振動**、電池 |
| **ハンドトラッキング** | 26 関節の位置と向き、つまむ強さ、**ジェスチャー** (グー・指差し・ピース・パー・グッド・つまむ)、指している向き |
| **キーボード** | **システムキーボードをスクリプトから開く** (入力欄が無くてよい。日本語・音声入力つき)、**Bluetooth キーボード** の打鍵・文字 |
| **マイク** | 音量、**話し始め / 話し終わり**、話した部分を **WAV で受け取る** (既定 16 kHz)、秒数を指定して録音 |
| **ヘッドセット** | かぶった / 外した、入力フォーカス、トラッキングの喪失、リセンター、電池、**リフレッシュレートの取得と変更** |
| **録画** | シーンに置いた**カメラの画を MP4 (H.264 + AAC) で録画**して `Movies/Arsist/` に保存、一時停止、**静止画 (JPEG)** を `Pictures/Arsist/` に、保存した動画の一覧 |
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
   - **届く距離** を `遠くから` にすると、手の届く物が無いとき、コントローラーを向けて (20 m まで) グリップでつかめる。
     持っている間はコントローラーを動かした分 (遠い物ほど少し大きく、1〜2 倍) だけ動き、水平の向きだけ回る (板は傾かない)。
     持っている手のスティック上下で奥へ押す / 手前へ引く。大きなスクリーンや奥の板の位置の微調整向け (`grab` の出来事の `by` は `ray`)
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

// 録画 (シーンのカメラ → MP4。Quest の実機だけ)
recorder.start({ camera: 'Cam', audio: true, fps: 30 }, function (r) {
  if (!r.ok) log('録画できない: ' + r.error);       // r = { ok, camera, width, height, fps, audio, sampleRate }
});
recorder.pause(); recorder.resume();             // 止めている間は動画の時間も進まない
recorder.stop(function (r) {                     // 保存が終わったら
  // r = { ok, file: 'Movies/Arsist/Arsist_20261025_142530.mp4', uri, seconds, bytes, width, height, frames, dropped, reason }
});
recorder.state;                                  // 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'
recorder.seconds();                              // 録っている秒数
recorder.photo({ camera: 'Cam' }, function (r) { … });   // JPEG → Pictures/Arsist/ ({ ok, file, uri, bytes, width, height })
recorder.list(function (videos) { … });          // [{ file, uri, bytes, date, seconds }] (このアプリが保存したもの)
recorder.on('recorder:stopped', function (r) { … });
```

### 録画 (`recorder`)

| 呼び出し | 中身 |
|---|---|
| `recorder.start(options?, fn?)` | 録り始める。options: `camera` (カメラの物の ID か assetId。省くとシーンの最初のカメラ)、`audio` (既定 true、マイクの音)、`fps` (既定 30、1〜60)、`bitrate` (既定は設定の値)、`width` / `height` (省くとカメラの大きさ。片方だけなら縦横比を保つ)。始まったら `fn({ ok, … })` |
| `recorder.stop(fn?)` | 止めて保存。`fn({ ok, file, uri, seconds, bytes, width, height, frames, dropped, reason, error? })` |
| `recorder.pause()` / `resume()` | 一時停止 / 再開 (録っていなければ false) |
| `recorder.photo(options?, fn?)` | 今の画を JPEG で保存。options: `camera`、`width` / `height` |
| `recorder.list(fn)` | このアプリが保存した動画 |
| `recorder.state` / `recorder.seconds()` | 状態 / 録っている秒数 |

- **画**はシーンに置いたカメラ (仮想カメラ、doc/23) のもの。ヘッドセットの目の画ではない。カメラはつかめる物にすれば
  手で持って動かせる (このカメラ自体も「つかめる」に設定できる)
- **音**はマイク (`mic` と同じもの)。マイクが閉じていれば開き (初回は許可を求める)、録画が終わると閉じる。
  許可が無い・マイクが無いときは音無しで録る (ログに理由)。サンプルレートはマイクのまま (普通 16 kHz) の AAC
- **保存先**: `Movies/<フォルダ>/<フォルダ>_<日付>_<時刻>.mp4`、静止画は `Pictures/<フォルダ>/…jpg` (フォルダは設定 `recorderFolder`、
  既定 `Arsist`)。Android の MediaStore に入るので権限は要らない。Quest からは
  - ヘッドセットの **「ファイル」アプリ** → 内部ストレージ → Movies / Pictures
  - **USB**: PC につなぎ、ヘッドセットで「ファイルへのアクセスを許可」→ `Quest 3/内部共有ストレージ/Movies/Arsist`
  - `adb pull /sdcard/Movies/Arsist/` でも取れる
  MediaStore に書けなかったとき (まれ) は、アプリ専用の `Android/data/<パッケージ名>/files/Movies/<フォルダ>/` に書く
  (`file` が絶対パスで返る。アプリを消すと一緒に消える)
- **アプリが裏に回ったら** (ヘッドセットを外した・メニューに戻った) 止めて保存する (`reason: 'appPaused'`)。
  最長 (設定 `recorderMaxMinutes`、既定 60 分) に達しても止めて保存する (`reason: 'maxDuration'`)
- **間に合わないフレームは捨てる** (メインスレッドを待たせない)。捨てた数は `dropped`。目安: 1920x1080 / 30 fps は余裕、
  4K や 60 fps は端末次第
- 大きさは幅を 16 の倍数、高さを偶数に切り下げる (最大 3840)
- エディタ・シミュレーター (Android 以外) では録画できず `start` は `{ ok: false, error: 'recorder needs Android' }`。
  `photo` は動き、`Application.persistentDataPath/Pictures/<フォルダ>/` に保存する

出来事 (`on` とスクリプトイベント `quest-input:recorder:*`):

| 名前 | 引数 |
|---|---|
| `recorder:started` | ({ camera, width, height, fps, bitrate, audio, sampleRate }) |
| `recorder:stopped` | 保存できた ({ ok: true, file, uri, seconds, … }) |
| `recorder:error` | 始められなかった / 保存できなかった ({ ok: false, error, … }) |
| `recorder:paused` / `recorder:resumed` | |
| `recorder:photo` | 静止画を保存した ({ ok, file, uri, … }) |

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
| `input.recorder.state` | idle / starting / recording / paused / stopping |
| `input.recorder.seconds` | 録っている秒数 (整数。UI に録画時間を出す) |
| `input.recorder.last` | 最後に保存したファイル (動画か静止画) |
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
| recorderFolder | Arsist | 録画を `Movies/<これ>/`、静止画を `Pictures/<これ>/` に保存 |
| recorderBitrate | 8000000 | 録画のビットレート (8 Mbps で 1 分およそ 60 MB) |
| recorderMaxMinutes | 60 | この長さで止めて保存 (0 で無制限) |

## 仕組みと、エンジン側でしたこと

- コントローラー: Unity の XR 入力 (`InputDevices`)。エンジンのレイと同じ経路。入力の名前は端末が実際に持つ一覧から探す
  (最初に繋がったとき `[Arsist:quest-input] controller right: … [Trigger, TriggerButton, …]` とログに出る)
- 手: XR Hands (`XRHandSubsystem`)。ジェスチャーの判定 (`HandGestureMath`) とマイクの計算 (`MicMath`) は
  UnityEngine に依存せず、`npm run test:perception` で合成データに対して検証している
- マイク: Unity の `Microphone`。端末上の音声認識は入れていない (Quest に Android 標準の音声認識サービスが無いため)。
  WAV を音声認識の API や、プロジェクトに入れた音声モデルに渡す
- マイクが開いている間 (設定 micAutoStart か `mic.start()`)、音量を毎フレームエンジンにも渡す (`context.SetVoiceLevel`)。キャラクターの口パク (`character.embody`) が使う
- 録画: `Recorder.cs` がカメラの画を (fps に間引いて) 自前の RT に Blit し、`AsyncGPUReadback.RequestIntoNativeArray` で
  Java と共有のバッファ (C# の NativeArray を包んだ direct ByteBuffer。3 枚) に直接読み出す。Java
  (`Runtime/Android/ArsistRecorder.java`) が自分のスレッドで YUV 4:2:0 に変換し (`ArsistYuv.java`。エンコーダが言う形:
  `COLOR_FormatYUV420Flexible` なら `getInputImage` の面へ、無ければ NV12 / I420)、MediaCodec で H.264 (I フレーム 1 秒ごと)
  と AAC にし、MediaMuxer で MP4 にする。書き込み先は MediaStore の `IS_PENDING=1` の項目で、書き終えたら 0 にする
  (書いている途中のファイルはギャラリーに出ない)。Java を呼ぶのはメインスレッドからだけ (別スレッドの JNI は黙って 0 を返す)。
  画素は JNI をまたいでコピーしない。時刻: 画は録り始めからの経過 (一時停止の分を引く)、音はサンプル数から
  (実時間から 0.15 秒以上ずれたら合わせ直す)。行の向き (GPU の読み出しが上から下か) は最初に 2x2 の絵で測る
- `.java` は `Runtime/Android/` に置き、隣の `.java.meta` で「Android だけ」と指定している。拡張機能の `Runtime/` は丸ごと
  `Assets/ArsistExtensions/quest-input/Runtime/` に写されるので、Unity がそのまま Android のプラグインとしてコンパイルする
  (ビルドの仕組みに追加は無い。Android の標準 API だけなので Gradle の依存も無い)
- 録画の計算 (`RecorderMath`: 時刻・間引き・大きさ・PCM16) は `npm run test:perception`、色変換 (`ArsistYuv.java`) は
  `node tools/recorder-yuv-check/run.js` (JDK が要る。`JAVA_HOME` に Unity 同梱の
  `<Unity>/Editor/Data/PlaybackEngines/AndroidPlayer/OpenJDK` を指定してよい) で確かめている
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

ビルド (コンパイル・権限・機能の宣言・IL2CPP に API が残ること) は確認済み (録画を足す前の版)。
**録画 (`recorder`) は Unity でのビルドも実機も未確認**: Java は Android SDK の android.jar に対して単体でコンパイルが通り、
C# は Unity 6 の DLL に対してコンパイルが通ることだけ確かめた。最初に試すときは logcat の `ArsistRecorder`
(選んだエンコーダと色の形、保存先) と `[Arsist:quest-input] recorder:` を見る。
**実機での動作は未確認** (このリポジトリの作業では端末に入れていない)。最初に試すときは
`npm run logs` で `[Arsist:quest-input]` を見る — コントローラーの入力名の一覧、手のサブシステムが動いたか、
マイクのサンプルレート、つかんだ / 離したが出る。
