# 15. 学習済みモデル (ONNX)、GPU の使い方、IR の版 (`doc/15-models-and-ir-versions.md`)

`Runtime/Perception/Models/` ・ `Runtime/Perception/Sources/GpuFrameReader.cs` ・ `Runtime/Perception/FrameBudget.cs`
・ `src/main/model/` ・ `src/main/project/migrations.ts` ・ `src/shared/irVersion.ts`

三つとも「エンジンに個別の機能を足さずに、汎用の土台を強くする」ための仕事。

## 1. 学習済みモデル — ONNX で十分か

**十分。別形式は定義しない。** 理由:

- Unity 側は **Inference Engine** (`com.unity.ai.inference`、旧 Sentis) が ONNX を直接読み、
  GPU のコンピュートシェーダーで動かす。2.6 で ONNX opset 25 まで対応。Quest / XREAL / 普通のスマホは
  すべてコンピュートシェーダーが使える。
- エディタのプレビューは **ONNX Runtime** (.NET の NuGet) が同じファイルを読む。
- ONNX に足りないのは「入力をどう正規化するか」「出力をどう読むか」だけ。これは重みではなく
  **メタ情報**なので、IR の `ModelDefinition` として持つ (サイドカー)。ONNX のバイト列は触らない。

つまり「変換ライブラリ」は要らない。要るのは *ONNX を読んで定義の下書きを作る* 側の道具で、
それが `src/main/model/OnnxInspector.ts` (依存の無い protobuf デコーダ、`protobuf.ts`)。
入出力の名前と形、opset、演算子の種類、外部の重みファイルを読み、`suggestDefinition` が
よくある書き出し (torchvision の分類 / Ultralytics の検出 / `[1,C,H,W]` の領域分割) に合う
下書きを作る。

### 1.1 IR

モデルは Layster.Virtual の `project.json` の `models` に並ぶ。Layster.Spatial の `project.spatial.json` も
同じ `ModelDefinition` を `models` に持つ (スクリプトの `model.*` は両方で使える)。ただし画像処理の
`infer` op を流す画像処理タスク (`perception.tasks`) は **Virtual だけ**にある。

```
ArsistProject.models?: ModelDefinition[]

ModelDefinition
├── id, name, file (Assets/Models/*.onnx), format: 'onnx'
├── use         image | text | tensor (α3〜)             ← 以下の task〜labels は image のときだけ。text は doc/16
├── task        classify | detect | segment | raw      ← `infer` op の出力の型がこれで決まる
├── input       { name?, width, height, layout: NCHW|NHWC, channels: 1|3, colorOrder: RGB|BGR,
│                 scale, mean[], std[], resize: stretch|letterbox, padValue? }
├── output      task ごとの読み方 (softmax / boxLayout / maskMode …、src/shared/types.ts を見る)
├── labels?     クラス番号 → 名前
├── backend?    auto | gpu | cpu                        ← Inference Engine のバックエンド
├── runtime?    auto | unity | onnxruntime              ← 実機の推論器 (doc/16 §3)。取り込み時に演算子を見て決める
├── includeInBuild?  既定 true。false ならエディタで試せるが APK には入らない (マニフェストから外す)
└── inspection? ファイルから読んだこと (入出力・opset・演算子・外部の重み。参考情報)
```

`VisionOpType` に `infer` がある。`params.model` にモデルの id。使えるのは `use: 'image'` の
モデルだけ (それ以外は `modelNotImage`)。さらに **実機で Unity の Inference Engine が動かすモデル
(`runtime` が `unity`) に限る**: 同梱の ONNX Runtime に回したモデルは Resources に入らないので、
`infer` に指定するとビルドが `CopyModelsToProject` ではっきり止まる (そういうモデルはスクリプトの `model.*` で使う)。**出力の型はモデルの task で変わる**:
classify / raw → record、detect → blobs、segment → mask。
だから領域分割モデルの出力は、そのまま `recolor` に渡して現実に塗れる。検出モデルの出力は
`blobs` op と同じ一覧 (label / score / x / y / width / height、0..1、原点左下) になる。

### 1.2 実行の流れ

```
ColorImage ─ ModelPreprocess ─▶ TensorData ─ IVisionModelRunner ─▶ TensorData ─ ModelPostprocess ─▶ VisionValue
              (縮小/letterbox,                  実機: ArsistModelExecutor            (softmax / NMS / argmax,
               行順反転, NCHW/NHWC,              エディタ: OnnxModelRunner             letterbox を戻す, y を下からに)
               正規化)                          検証: 偽物)
```

前処理・後処理は UnityEngine 非依存 (`tools/perception-check/ModelChecks.cs` が数値で叩く)。
推論エンジンだけを `IVisionModelRunner` の向こうに置くので、**エディタと実機で違うのは
浮動小数の丸めだけ**。

実機の `ArsistModelExecutor` (MonoBehaviour、`Runtime/Inference/`。スクリプトの `model.*` も同じものを通る。doc/16):
- パイプラインはワーカースレッドで回るが Inference Engine はメインスレッドからしか触れない。
  ワーカーは依頼を積んで待ち (`ManualResetEventSlim`)、メインは `Update` で `Schedule` →
  非同期 readback (`ReadbackRequest` / `IsReadbackRequestDone`) → 完了で起こす。
  GPU を待つ間もメインスレッドは止まらない。
- バックエンドは `auto` なら `SystemInfo.supportsComputeShaders ? GPUCompute : CPU`。
  GPUCompute の生成に失敗したら CPU に落ちる。最初の実行と 50 回ごとに ms をログに出す。
- モデルは `Resources/ArsistModels/<id>/model.onnx` (ビルド時に `CopyModelsToProject` が置く。重みの別ファイルと
  文章のモデルの `tokenizer.json` も同じフォルダ)。StreamingAssets にしないのは、Android では APK の中 (jar:) に
  あってファイルとして開けないため。ONNX Runtime に回したモデルだけは例外で StreamingAssets に置く (doc/16 §3.1)。

### 1.3 パッケージは使うときだけ

`com.unity.ai.inference` は **モデルを使うプロジェクトのビルドでだけ** `Packages/manifest.json` に入る
(`UnityBuilder.ensureInferencePackage`。数えるのはビルドに含めるモデル = `includeInBuild` が false でないもの)。常に入れると、使わない APK までコンピュートシェーダー分
太る。`ArsistModelExecutor` は `ARSIST_INFERENCE` の define で本物と空の実装を切り替える。
Inference Engine で動かすモデルがあるのにパッケージが無ければビルドは**落ちる**。「ビルドは通るのに実機で何も起きない」
が一番困るので。

define は **二か所**で揃える。`ArsistBuildPipeline.ApplyDeviceScriptingDefines` (ビルド中、パッケージの
有無で) と、`UnityBuilder.syncInferenceDefine` (Unity を起動する前に `ProjectSettings.asset` を直す)。
後者が無いと、モデルを外したプロジェクトを同じ作業フォルダでビルドしたとき、パッケージだけ消えて
define が残り、Unity 起動時のコンパイルで `Unity.InferenceEngine` が見つからず落ちる (実際に一度踏んだ)。

### 1.4 エディタ

「モデル」タブ (α3 (旧 IR v3) から画像処理タブの外。画像以外のモデルと Hugging Face からの取り込みは doc/16)。取り込み (`model:import`) →
`Assets/Models/` にコピー → 入出力を読んで用途 (画像 / 文章 / テンソル) と下書きを作る → フォームで直す。正規化はプリセット (0..1 / ImageNet / 0..255)、検出は出力の形
(YOLOv8/11 / v5 / NMS 済み / 別々の出力)、領域分割は argmax / sigmoid。

プレビュー (`tools/vision-preview`) は `-p:ArsistOnnx=true` で ONNX Runtime を含めてビルドし、
取れない環境 (オフライン) では無しでビルドし直す。その場合、モデルの一手だけ
「プレビューできない」と出て、古典的な一手は今までどおり見える。

ツールは**一度ビルドして DLL を直接動かす** (以前は毎回 `dotnet run` で 1〜2 秒待たされた)。
ソースが DLL より新しければ作り直す。

### 1.5 動作確認用のモデル

```bash
npm run make:sample-onnx     # tools/model-samples/channel-mean.onnx (169 バイト)
```

`ReduceMean(axes=[2,3])` だけの ONNX。入力 `[1,3,32,32]` → 出力 `[1,3]`。
labels を red / green / blue にすると「一番強い色チャンネルを当てる分類モデル」になる。
学習が要らないので、取り込み → プレビュー → 実機の Inference Engine までの道が通っているかを、
ネットからモデルを落とさずに確かめられる。ONNX Runtime 経由のプレビューで、赤い画が `red`、
緑の画が `green` と分類されることを確認済み。

## 2. GPU を活かす — カメラの画の運び方

「画像処理を GPU でやる」より先に効くのは、**画を GPU から CPU に運ぶ量を減らすこと**。
読み出しも変換も画素数に比例する。

以前 (スマホ):
`WebCamTexture.GetPixels32` でフル解像度 (1280x720) を**同期的に**読む → 回転・輝度・色の変換
(ワーカー) → 480 幅に縮める。GetPixels32 は呼ぶたびに GPU の描画完了を待つので、画を取るたびに
数 ms〜十数 ms 引っかかっていた。

今:

```
GPU テクスチャ ─ Graphics.Blit (縮小) ─▶ RenderTexture (要る大きさ) ─ AsyncGPUReadback ─▶ Color32[] (使い回し)
                                                                             │ 非同期、メインは止まらない
                                                                             ▼
                                                              ワーカー: 回転 / 輝度 / 色 / 検出用の縮小
```

- **要る大きさ** は `FrameBudget.TargetWidth` が決める。待っている消費者 (検出 640 幅、画像処理タスク
  「切り出し後に maxWidth になる幅」、OCR は 0 = フル) の**一番大きい要求**だけを読む。
  誰かがフルを求めていればフル。拡大はしない。
- 縮めたぶん内部パラメータも換算する (`FrameBudget.ScaleIntrinsics`、半画素の規約は
  `GrayImage.Scaled` と同じ)。ここを忘れると現実に重ねた絵がずれる。
- **行順は測る。** RenderTexture を読み出したときの行順はグラフィックス API で違う
  (OpenGL は下から上、Vulkan / D3D / Metal は上から下のことが多い)。決め打ちすると
  「検出はできるのに上下逆に貼り付く」を実機でしか気付けない。`GpuFrameReader.EnsureProbe`
  が最初に 2x2 の既知の絵を同じ経路で読み、どちらで来るかを見る (ログ:
  `GPU frame reader: … readback rows are top-down (will flip)`)。
- 非同期読み出しに対応しない端末では `ReadPixels` (同期) に落ちる。遅いが動く。

デバイスごと:

| 供給 | 経路 | 縮小 |
|---|---|---|
| スマホ `ArsistWebcamCameraSource` | Blit → AsyncGPUReadback | GPU |
| Quest `ArsistQuestCameraSource` | Blit → AsyncGPUReadback (GetColors は WaitForCompletion で止まるので使わない) | GPU |
| XREAL / ARCore `ArsistARFoundationCameraSource` | CPU 画像 (YUV) | `XRCpuImage.Convert` の outputDimensions (ネイティブ) |

検出用の縮小も、以前はメインスレッド (1〜3 ms) だったのをワーカーに移した。

### 2.1 実機の画をエディタへ

`query.getPerceptionSnapshot { taskId }` (WebSocket、ライブ配置モードと同じサーバー) が、タスクが直近に
処理した画 (枠で切り出し済み) を JPEG で返す。エディタの「実機から取り込む」はこれを素材にする。
写真で組んだものが実機のカメラ (露出・色・解像度) でどう見えるかを、ビルドし直さずに確かめられる。

### 2.2 証拠の見方

5 秒ごとにログに出る:

```
[Arsist] Perception frames: gpu-async 1280x720->640x360, 25 readback(s) avg 1.8 ms (max 4.1),
         25 convert(s) avg 3.2 ms (max 6.0) on worker, 10 still(s), 15 detection(s) in 5 s
```

`gpu-async` か `gpu-sync` (非同期に対応しない端末) か `cpu-yuv` (AR Foundation) か、
ネイティブから何に縮めて読んでいるか、読み出しと変換に何 ms 掛かっているかが分かる。
モデルは別に `Model '<id>' on GPUCompute: 12 ms (avg 11 ms over 50 run(s))`。

数値検証: `FrameBudgetChecks` (幅の決め方、内部パラメータの換算、統計の要約)。

## 3. IR の版と「任意の」アップグレード

IR (第2層) の名前は **Layster** で、今までの `project.json` の形は **Layster.Virtual** と呼ぶ
(もう一つの形 Layster.Spatial と、名前の付け方の全体は `doc/19-layster.md`)。

| 中の数 (`irVersion`) | 名前 |
|---|---|
| 1〜5 | **α1〜α5** (今までの版) |
| 6 | **Layster.Virtual β 1.0.0** (形は α5 と同じ。先頭に `layster` の見出しが入る) |
| 7 | **Layster.Virtual β 1.1.0** (カメラ `type: 'camera'` + `camera`、UI の画像の `source`、VRM の `character.embody`。項目を足しただけで移行の ops は空。doc/23) |

`project.json` は版の数 `irVersion` (`src/shared/irVersion.ts` の `CURRENT_IR_VERSION`、無ければ 1) と、
β からは見出し `"layster": { "profile": "virtual", "stage": "beta", "version": "1.1.0" }` (今の版) を持つ。
**版の判定は数で行い、見出しは人とエージェントのため**。数と名前の対応は `src/shared/layster/version.ts` の
`VIRTUAL_FORMATS` だけが持ち、画面・ログ・エージェント向けの文は `describeVirtualIrVersion` / `formatLayster` を通す
(「IR v5」とは書かず「Layster.Virtual α5」)。数を残しているのは、α のエディタが β のファイルを
「新しすぎる」と言って断れるようにするため。

Unity と同じ振る舞い:

| 開いたファイル | すること |
|---|---|
| 今の版 | そのまま開く (見出しが欠けていれば、メモリ上で補い、次の保存で書く) |
| 古い版 | メモリ上で移行して開き、「アップグレードするか」を訊く。承諾されるまで**読み取り専用** (保存を断る) |
| 新しい版 | 開かない (`irTooNew`)。壊すよりは断る |

承諾すると、元の `project.json` を `Backups/project.<版>.<日時>.json` (`alpha5` / `beta1.0.0` …) に写してから
今の版で書き戻す。見送ると編集はできるが保存できない (タイトルバーに「読み取り専用」)。保存しようとするともう一度訊く。
エディタを使わずに同じことをするなら `node scripts/layster-upgrade.mjs <フォルダ>... [--dry-run]`
(先に `npm run build:main`。書くのは `project.json` だけ。Spatial と新しすぎるファイルは断る)。

移行は `src/main/project/migrations.ts` に「前の版 → 次の版」を順に並べる。各移行は冪等で、
今の版のプロジェクトに掛けても何も変えない (`migrations.test.ts`)。見出しは `migrateProject` が最後に
今の版のものを書くので、各移行では触らない。
それまで `ProjectManager.loadProject` に散らばっていた後方互換の補正 (テンプレートの旧名、
`arSettings` / `interaction` / `dataFlow` / `scripts` の補完、`logicGraphs` などの削除、
一時期あった空専用の `analysis`) は、すべて **α1 → α2** の移行として明文化した。

版を上げる手順 (`npm run ir:new -- "<説明>" ["<English>"] [--version x.y.z]` が 1〜3 の雛形を入れる):

1. `CURRENT_IR_VERSION` を上げ、`VIRTUAL_FORMATS` に名前 (β x.y.z。既定は直前の β の minor + 1) を足す
2. `migrations.ts` に `defineMigration(<新しい版>, { ops: [...] })` を足す
3. `src/renderer/i18n/strings.ts` に `ir.migration.<新しい版>` の説明を足す (ダイアログに出る)
4. `migrations.test.ts` に「古い形 → 新しい形」を足す

版の履歴: α2 で `irVersion` と `models`、α3 でモデルの `use` (画像 / 文章 / テンソル) と `text` (doc/16)、
α4 で拡張機能、α5 でキャラクターと保存、β 1.0.0 で `layster` の見出し、β 1.1.0 でカメラ・画像に映すもの・自分の体 (doc/23)。

Unity 側のマニフェストにも `irVersion` と `layster` を入れている。実機のログから「どの版のエディタで作った APK か」が追える。

## 4. 検証

```bash
npm run test:perception   # 前処理・後処理 (ModelChecks)、読み出しの幅 (FrameBudgetChecks) を含む
npx vitest run            # ONNX の読み取り (OnnxInspector.test)、移行 (migrations.test)、結線 (validate.test)
npm run make:sample-onnx  # 動作確認用の ONNX
```

実機を持っていない状態で確かめられないのは「行順の測定が正しく効くか」と「Inference Engine の
バックエンド選択」の二つ。どちらもログに証拠が出る (§2.2 の `GPU frame reader: …` と `Model '<id>' loaded: backend=…`)。
