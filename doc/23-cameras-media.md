# 23. カメラ・映すもの・自分の体・録画・画面の配信 (`doc/23-cameras-media.md`)

Layster.Virtual **β 1.1.0** (irVersion 7) で足したもの。用途の例は「プレゼン動画を撮る」アプリ
(PC の画面を巨大スクリーンに映し、自分は VRM になって身振りで説明し、仮想カメラで録画して Quest に保存する) だが、
**どれも汎用の部品**で、そのアプリ専用の機能はエンジンに無い。

| 部品 | 置き場 | 何をするか |
|---|---|---|
| 仮想カメラ | エンジン (IR `type: "camera"` + `camera`) | 置いた位置からシーンを撮って RenderTexture に描く |
| 映すもの | エンジン (UI の Image の `source`) | 画像にカメラの映像 (鏡も) か、PC から配信される画面を映す |
| 自分の体 | エンジン (`character.embody`) | VRM を自分の頭と手 (コントローラー / 手) で動かす。自分の目には写さず、カメラには写る。声で口が動く |
| 録画と保存 | 拡張機能 `quest-input` (`recorder`) | 仮想カメラの映像 + マイクの音を MP4 にして端末の「ムービー」に保存。静止画も |
| 画面の送信 | `products/ScreenCast` (PC で動くアプリ) | PC の画面 (またはウィンドウ) を MJPEG で LAN に配信。Quest からのスライド送りを受けてキーを押す |
| 見本 | `samples/virtual/presentation-recorder` | 上のすべてを使うプロジェクト |

## 1. IR (src/shared/types.ts)

```ts
SceneObject.type === 'camera'  →  SceneObject.camera?: CameraSettings
CameraSettings = { fov?: 50, resolution?: [1920,1080], fps?: 30, backgroundColor?: '#1e2430',
                   near?: 0.05, far?: 100, showSelf?: true, showGizmo?: true }        // 既定は CAMERA_DEFAULTS
UIElement (type 'Image').source?: MediaSource
MediaSource = { kind: 'camera', camera: '<物の id か assetId>', mirror?: boolean }
            | { kind: 'stream', url: 'http://{store:pc.address}/stream/slides', mirror?: boolean }
CharacterSettings.embody?: EmbodySettings   // 既定は EMBODY_DEFAULTS
EmbodySettings = { enabled, hands?: 'auto'|'controllers'|'hands', lipSync?: true, hideFromSelf?: true, matchHeight?: true }
```

- 移行 (6 → 7) は項目を足すだけなので ops は空。見出しは `β 1.1.0`。
- カメラの物の transform は他の物と同じ (Virtual の座標。+X = ユーザーの左)。カメラの前は物のローカル +Z。
- `source` を持つ Image は `assetPath` を使わない。画像の縦横比は `style` の大きさに合わせて**はみ出さないように収める** (contain)。
- `{store:<key>}` は DataStore の値。値が変わったらつなぎ直す。値が空の間はつながない (画像は「接続待ち」の灰色)。

## 2. エンジンのランタイム (`Runtime/Media/`)

| ファイル | 役目 |
|---|---|
| `ArsistCameras.cs` | 登録簿 (契約。拡張機能は `context.Cameras` で使う)、`ArsistVoice` (声の大きさの受け渡し所) |
| `ArsistVirtualCamera.cs` | 1 台のカメラ (MonoBehaviour)。`Camera` + `RenderTexture`。使う人がいる間だけ `fps` で撮る。撮れたら `ArsistCameras.NotifyRendered` |
| `ArsistMediaImage.cs` | UI の Image (RawImage) に source を映す。camera → RenderTexture を直接、stream → `MjpegStream` |
| `MjpegStream.cs` | MJPEG (multipart/x-mixed-replace) を読む。届いた JPEG を Texture2D に。つなぎ直し、状態 (`connecting` / `live` / `error: …` / `waiting`) |
| `MjpegParser.cs` | 区切りの解析 (UnityEngine 非依存、`npm run test:perception` で確かめる) |
| `ArsistEmbodiment.cs` | VRM を頭と手で動かす (Animator の IK + 頭の骨)。背の合わせ。口パク (`ArsistVoice.Level`) |

`ArsistVirtualCamera` の公開の形 (ArsistCameras が使う): `Camera Camera`、`RenderTexture Texture`、`void AddUser(object)`、`void RemoveUser(object)`
(ほかに `RenderOnce()` = 使う人がいなくても次のフレームで 1 枚、`SetFov`、`SetShowSelf`)。

### 撮り方 (`ArsistVirtualCamera`)

- ビルド (`ArsistBuildPipeline.ConfigureVirtualCamera`) が `type: "camera"` の物に付け、`camera` の値を入れる。`Camera` と
  `RenderTexture` は実行時に作る。Camera は普段 `enabled = false` で、使う人がいる間だけ `fps` の間隔で `Camera.Render()`
  (実行順 20000 = 体の IK・揺れものの後)。XR でも片目用にしない (`stereoTargetEye = None`)。
- 撮る先は作業用の RenderTexture (深度 24) で、撮れたら公開の `Texture` (`width`×`height`、ARGB32 sRGB、深度なし) に
  `Graphics.CopyTexture` で写してから `NotifyRendered`。カメラの画を映した板をそのカメラが撮っても、読みながら書くことにならない。
- 背景は `backgroundColor` の単色。写さないもの: カメラの形 (`ArsistCameraGizmo`)、頭に付いた UI (`ArsistHUD`)、
  シミュレーターの部屋 (31)。`showSelf: false` なら自分の体 (`ArsistSelfOnlyHidden`) も。空間に置いた Canvas (UI レイヤー) は写る。
- 撮る向きは物のローカル +Z。カメラの形 (箱とレンズ) と、0.6 m 先までの撮る範囲の線を頭のカメラにだけ見せる (`showGizmo`)。

### 自分の目に写さない (レイヤー、`Runtime/Media/ArsistMediaLayers.cs`)

- ビルドが TagManager に `ArsistSelfOnlyHidden` (29 番を先に試す) と `ArsistCameraGizmo` (30 番) を用意する。UI は 5、
  `ArsistHUD` は 8 番以降の最初の空き、シミュレーターの部屋は 31。名前が引けないとき (古い作業フォルダ) は 29 / 30 を使う。
- 体 (`hideFromSelf`) は `ArsistSelfOnlyHidden` に置き、頭のカメラ (`Camera.main`) の cullingMask から外す (カメラと
  体の部品が毎フレーム `EnsureHeadCamera` で確かめる。頭のカメラが替わっても付いていく)。仮想カメラは `showSelf` なら写す。
- カメラの形は `ArsistCameraGizmo`。頭のカメラには入れ、仮想カメラからは外す。

### 映すもの (`ArsistMediaImage`)

- ビルドは `source` を持つ Image に `ArsistMediaImage` を付ける (元の画像が無ければ要素は透明)。実行時に子の `RawImage`
  ("Media") を作り、`AspectRatioFitter` (FitInParent) で縦横比のまま要素の中に収める。`mirror` は `uvRect` の幅を負にする。
- camera: そのカメラを `Require` している間 (要素が見えている間) だけ撮らせる。カメラが見つからなければ灰色。
- stream: `MjpegStream` が `UnityWebRequest` + `DownloadHandlerScript` で読み続け、受け取った分を `MjpegParser` に渡す
  (Unity はこれをメインスレッドで呼ぶ。区切りを探すだけで軽い)。1 フレームに 1 回、最新の 1 枚だけを
  `ImageConversion.LoadImage` で使い回しの `Texture2D` に (古い枚は捨てる。JPEG の展開はメインスレッドなので、
  大きな画を速く送るとその分重い。ScreenCast は変わったときだけ送る)。切れたら 1, 2, 4… 最大 10 秒おいてつなぎ直す。
  10 秒何も届かなければ切ってつなぎ直す。`{store:key}` は 0.5 秒ごとに解き直し、変わったらつなぎ直す。スキームが無ければ `http://` を付ける。
- 状態: `waiting` (URL がまだ無い / カメラが無い)・`connecting`・`live`・`error: …`。`source` が無い要素は `none`。
- 平文の HTTP: 各端末の AndroidManifest に `usesCleartextTraffic="true"` があり、ビルドが `PlayerSettings.insecureHttpOption =
  AlwaysAllowed` にしている (どちらも前から)。

### 体の動かし方 (`ArsistEmbodiment`、実行順 9995)

- VRM を読み込んだ直後に (embody が無くても) 付き、骨の基準の形 (T ポーズ) をそこで覚える。`character.embody.enabled`
  か `vrm.embody(id, true)` で動き始める。動いている間は `ArsistCharacter` の動き・歩く・こちらを見るを止める (まばたきは残す)。
- 体の根元: 目 (カメラ) から頭の骨 (目の 7 cm 下・8 cm 後ろ、頭の向きで) を出し、そこから根元までの分だけ下げる。
  水平の向きは頭の向きに遅れて付いていく (40° より回すと体が付いてくる)。床より上には浮かせない (しゃがむと体ごと沈む)。
  床は VRM を置いた物 (ラッパー) の高さ。頭から 0.4〜2.5 m 下になければ頭の 1.6 m 下。
- 首・頭: 体から見た頭の向き (下 60°・上 50°・左右 75°・傾き 35° まで) を、首に 35%、頭に残りで当てる。
- 手: **自前の 2 本の骨の IK** (肘は下・後ろ・外へ)。Animator の IK (OnAnimatorIK) は動きの FBX が無い VRM
  (コントローラーが付かない) では呼ばれないので使わない。コントローラーは握りの位置から 8 cm 後ろを手首に、
  XR Hands (XR_HANDS のビルドだけ) は手首の関節。`hands`: `auto` = 手が見えていれば手、無ければコントローラー。
  見失ったら 0.3 秒かけて立ち姿 (ArsistCharacter の力を抜いた腕) に戻す。
- 指 (親指以外): コントローラーのトリガー → 人差し指、グリップ → 中指・薬指・小指。手のときは少し曲げたまま。
- 背の合わせ: 動き始めて 1 秒後の目の高さ (床から) と VRM の目の高さの比で体を拡大縮小 (`matchHeight`、0.3〜3 倍)。
  `vrm.calibrate(id)` で床と背を測り直す。
- 生成する AnimatorController の層は IK Pass を有効にする (ビルド。拡張機能やほかの部品が OnAnimatorIK を使えるように)。
- 口: `ArsistVoice.Level` → 表情 "aa" (0..100、`VRMExpressionController` を直接叩く。CLAUDE.md の注意)。UniVRM 0.x の
  モデルではプリセット `A` に当たる (名前だけの "aa" は 0.x では何も起きないので、プリセットとして読める名前を先に試す)。

## 3. スクリプト API (src/shared/scriptApi.ts に載せる)

| 呼び出し | 中身 |
|---|---|
| `cameras.list()` | カメラの id の配列 |
| `cameras.setPose(id, x, y, z, rx, ry, rz)` / `cameras.getPose(id)` | 位置と向き (度)。座標は `scene.setPosition` と同じ実行時の Unity ワールド (x = 右)。getPose は `{ x, y, z, rx, ry, rz, fov }` |
| `cameras.lookAt(id, x, y, z)` | そちらを向く |
| `cameras.setFov(id, deg)` | 画角 |
| `cameras.snapshot(id, cb)` | 今の画を JPEG (base64) で返す `{ ok, mime, width, height, data }` |
| `ui.setSource(bindingId, source)` | Image に映すものを変える (`null` で元の画像) |
| `ui.streamStatus(bindingId)` | `waiting` / `connecting` / `live` / `error: …` (source の無い要素は `none`) |
| `vrm.embody(id, on)` | 自分の体として動かすか |
| `vrm.calibrate(id)` | 背を測り直す |

store: `media.<bindingId>.status` (配信の状態)、`media.<bindingId>.fps`。

## 4. 録画 (`quest-input` 拡張機能、スクリプトの `recorder`)

マイクと物をつかむ機能を持っている `quest-input` に足す (つかんでカメラを動かせる)。Android の MediaCodec / MediaMuxer で
H.264 + AAC の MP4 を作り、MediaStore で `Movies/<フォルダ>/` に保存する (権限は要らない。Quest の「ファイル」アプリ・USB から見える)。

| 呼び出し | 中身 |
|---|---|
| `recorder.start({ camera: 'Cam', audio: true, fps: 30, bitrate: 8000000, width?, height? }, cb)` | 録り始める。`cb({ ok, error? })` |
| `recorder.stop(cb)` | 止めて保存。`cb({ ok, file, uri, seconds, bytes, width, height, error? })` |
| `recorder.pause()` / `recorder.resume()` | 一時停止 (止めている間は時間も進まない) |
| `recorder.photo({ camera: 'Cam' }, cb)` | 静止画 (JPEG) を `Pictures/<フォルダ>/` に |
| `recorder.state` | `idle` / `starting` / `recording` / `paused` / `stopping` |
| `recorder.list(cb)` | このアプリが保存した動画 `[{ file, uri, bytes, date }]` |

- store: `input.recorder.state` / `input.recorder.seconds` (UI に録画時間を出す) / `input.recorder.last` (最後のファイル名)
- イベント: `quest-input:recorder:started` / `:stopped` / `:error` / `:paused` / `:resumed` / `:photo`
- `stop` の結果には `frames` (書いた枚数)・`dropped` (間に合わず捨てた枚数)・`reason` (止まった理由) も入る。Android 以外では `start` が `{ ok: false, error: "recorder needs Android" }`
- 口パクに声の大きさを渡すのはマイクが開いている間だけ (`micAutoStart` か `mic.start()`)。詳しくは samples/extensions/quest-input/README.md
- 設定 (extension.json): `recorderFolder` (既定 "Arsist")、`recorderBitrate` (既定 8 Mbps)、`recorderMaxMinutes` (既定 60)
- 画: `context.Cameras.Require` → `Rendered` で `AsyncGPUReadback` (RGBA) → Java で NV12 に変換して入れる。
  音: `MicCapture` の生の PCM (48 kHz か端末の値) → AAC。時刻はどちらも録り始めからの経過 (一時停止の分は引く)。
- `context.SetVoiceLevel(mic level)` を毎フレーム呼ぶ (口パク用)。

## 5. 画面の配信 (`products/ScreenCast`)

PC で動く Electron のアプリ。画面かウィンドウを選び、名前を付けて配信する (既定 2 つ: `slides`・`notes`)。

| HTTP (既定ポート 8090) | 中身 |
|---|---|
| `GET /stream/<name>` | `multipart/x-mixed-replace; boundary=arsistframe`。各部分 `Content-Type: image/jpeg` + `Content-Length`。**変わったときだけ**送る (と 5 秒に 1 回) |
| `GET /frame/<name>.jpg` | 最新の 1 枚 |
| `GET /status` | `{ streams: [{ name, source, width, height, fps, clients }], control: true }` |
| `POST /control` | `{ action: "next" \| "prev" \| "first" \| "last" \| "key", key? }` → PC でキーを押す (スライド送り)。Linux (X11: xdotool / Wayland: ydotool)、Windows (PowerShell SendKeys)、macOS (osascript)。無ければ 501 |

- `?token=` を設定したら全部に要る。画面に LAN の URL を出す。
- Quest 側は `{ kind: 'stream', url: 'http://{store:pc.address}/stream/slides' }`。スライド送りはスクリプトの `api` で `POST /control`。

## 6. エディタ・確かめ・エージェント (TypeScript 側)

| どこ | 何 |
|---|---|
| `src/shared/media.ts` | 既定を埋める (`cameraSettingsOf` / `embodySettingsOf`)、参照を引く (`findCameraObject`: id か assetId)、値の確かめ (MCP)、ビルド前の確かめ `mediaIssues` |
| `src/bridge/UnityBridge.ts` | `unityScenesData` / `unityUiData`: Unity に渡す scenes / ui に既定を埋める (camera は全項目、embody はあるときだけ、source.mirror)。BuildDialog・`main.ts runUnityBuild`・書き出し・CLI のどの道でも通す (何度通しても同じ) |
| `ir_validate_project` | error: 無いカメラを映す画像・解像度 16..4096 の外・fov / near / far の矛盾。warning: http(s) で始まらない配信の url ({store:…} で始まるものは確かめない)・embody の VRM が 2 体以上・Image 以外の source |
| MCP | `ir_add_camera` (name, assetId, position, rotation, settings)、`ir_update_object` の `camera` / `character.embody` (null で外す)、`ir_add_ui_element` / `ir_update_ui_element` の `source` (null で外す) |
| エディタ | シーンの + と 3D ビューのツールバーに「カメラ」。3D ビューはカメラの形と撮る範囲、選ぶと左下に写る画 (CameraPreview)。インスペクタ: カメラ (`CameraSection`)、VRM の「自分の体として動かす」、画像の「映すもの」 (`MediaSourceSection`)。UI の下書きは何が映るかを書いた板 (`MediaPlaceholder`) |
| プレビューのシミュレーター | カメラの形、カメラの画を画像に 1 枚貼る、配信は板、embody の VRM は自分の目から隠してカメラには写す (doc/22) |
