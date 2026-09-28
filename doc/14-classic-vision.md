# 14. 画像処理パイプライン (`doc/14-classic-vision.md`)

`UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/Perception/{Vision/Classic,Pipeline,Models,Overlay}/`
・ エディタ: `src/renderer/components/vision/` ・ 契約: `src/renderer/vision/opCatalog.ts`
・ 学習済みモデル (ONNX) と GPU の使い方は `doc/15-models-and-ir-versions.md`

## 1. 方針 — エンジンは「一手」だけを持つ

**エンジンに「空を青くする」「ランプを数える」のような個別の機能を足してはいけない。**
足した瞬間、少し違うことをしたいユーザーが手も足も出なくなる。

代わりに、汎用の一手 (`VisionOp`) を並べて繋ぐ形にしてある。
「曇り空を青空にする」 (`products/BlueSky`) は、その並べ方のひとつでしかない。
エンジンのどこにも「空」という概念は出てこない。

これは過去に一度間違えた。最初は `analysis.kind: 'sky'` と空専用の `SkySegmenter` /
`ArsistSkyOverlay` をエンジンに入れていた。動きはしたが、ユーザーには作れないものだった。
`tools/perception-check/PipelineChecks.cs` の「青空アプリが汎用の op だけで組める」テストは、
この逆戻りを防ぐためにある。

## 2. 構成

```
カメラ → [op] → [op] → … → 出力
                              ├ store  : DataStore に値を入れる（UI から bind）
                              ├ world  : 現実に重ねて描く（AR）
                              ├ anchor : 見つけた物の位置に札やオブジェクトを置く（AR）
                              └ image  : Canvas の Image に描く（確認用）
              └ event op → ArsistScriptEvent（スクリプトや他のタスクが反応）
```

| 層 | 場所 | UnityEngine |
|---|---|---|
| 演算子 | `Vision/Classic/*.cs` | 使わない |
| パイプライン | `Pipeline/{VisionValue,VisionOps,VisionPipelineRunner}.cs` | 使わない |
| 現実に描く | `Overlay/ArsistWorldOverlay.cs` | 使う |
| 見つけた物に置く | `Overlay/ArsistWorldAnchors.cs` | 使う |
| タスクから呼ぶ | `ArsistPerceptionTaskRunner.RunPipeline` | 使う |

UnityEngine を使わない層は `tools/perception-check` (数値検証) と
`tools/vision-preview` (エディタのライブプレビュー) の両方がそのままコンパイルする。
**この制約を崩すと、どちらも使えなくなる。**

## 3. 一手の一覧

値には型があり、噛み合わない結線はエディタとビルドの両方で弾く。

| 型 | 中身 |
|---|---|
| color | 色の画 |
| gray | 輝度 |
| mask | 0/255 のマスク |
| edges | 勾配の強さと向き |
| boundary | 列（行）ごとの境界位置 |
| blobs / contours | 塊・輪郭の一覧 |
| record | 数値の集まり（DataStore にそのまま入る） |

| op | 入力 → 出力 | 何をするか |
|---|---|---|
| `grayscale` | color → gray | |
| `blur` | gray → gray | ノイズを落とす |
| `sobel` | gray → edges | 輪郭の強さ |
| `canny` | gray → mask | 細い輪郭線 |
| `edgeScan` | edges → boundary | 端から進んで最初の強い輪郭で止まる。地平線・机の縁・液面 |
| `maskSide` | boundary → mask | 境界の手前側／向こう側 |
| `hsvRange` | color → mask | 色で拾う。hueMin > hueMax は 0° またぎ（赤） |
| `threshold` | gray → mask | 固定値・大津法・**周りと比べて** (relativeMedian) |
| `morphology` | mask → mask | open / close / erode / dilate |
| `maskCombine` | mask, mask → mask | and / or / xor / subtract / not |
| `largestBlob` | mask → mask | 一番大きい塊だけ |
| `blobs` | mask → blobs | 数・大きさ・位置（正規化） |
| `contours` | mask → contours | 形の名前（triangle / square / circle …） |
| `stats` | mask → record | 面積比、マスクの**中と外**の平均、その比 |
| `gate` | record → record | 条件を満たさなければそこで止める |
| `recolor` | color, mask → color | 明暗を残して塗り替える |
| `dominantColor` | color → record | 多数派の色相と、その色の名前 |
| `templateMatch` | gray → record | 参照画像の位置（NCC） |
| `infer` | color → record / blobs / mask | 学習済みモデル (ONNX) を流す。**出力の型はモデルの task で決まる** (classify → record, detect → blobs, segment → mask)。`doc/15` |
| `select` | blobs → blobs | ラベル・スコア・大きさで絞り、並べ替え、数を絞る |
| `countItems` | blobs → record | 件数、ラベルごとの数、一番確かな物 |
| `track` | blobs → blobs | **フレームをまたいで**同じ物に ID、位置の平滑化、速度。状態を持つ |
| `annotate` | color, blobs → color | 枠を描く |
| `boxMask` | blobs → mask | 枠 (か塗り潰し) のマスク。`world` の alpha に |
| `stabilize` | record → record | 数は指数平滑、文字と真偽は多数決。状態を持つ |
| `motion` | gray → mask | 前のフレームとの差。状態を持つ |
| `event` | record → record | 条件を満たしたらイベントを発火 (止めない)。onChange / always、冷却時間。状態を持つ |
| `quads` | mask → quads | 四角形 (看板・画面・紙)。角は左下・右下・右上・左上 |
| `rectify` | color, quads → color | 四角形の中を正対した長方形に起こす |

「状態を持つ」op はタスクごとの `VisionState` に前回までの情報を残す (`VisionContext.State`)。
エディタのプレビューも同じ: 動画や連続した写真を順に流し、状態を引き継ぐ。

一手は `disabled` で一時的に外せる (素通し)。**入力と出力の型が同じ op だけ**。型が変わる op を
外すと後ろが受け取るものを失うので、両方の検証が弾く。

新しい op を足すときは **3 か所** を直す:

1. `Pipeline/VisionOps.cs` — `Apply` と `Signatures`
2. `src/renderer/vision/opCatalog.ts` — エディタの道具箱と型
3. `tools/perception-check` — 合成画像での検証

結線チェックは C# (`VisionPipelineRunner.Validate`) と TS (`src/renderer/vision/validate.ts`) の
**二重実装**。片方だけ直すと、エディタでは繋げるのにビルドで落ちる（またはその逆）になる。
両者を同じケースで叩くテストが `PipelineChecks.cs` と `validate.test.ts` にある。

## 4. エディタ (`src/renderer/components/vision/`)

`Vision` タブ。上に**絵コンテ** (カメラ → 一手 → … → 出しどころ を、**各段の結果の絵つき**で横に)、
中央に選んだ一手の大きな絵、右に設定。

ノードを線で繋ぐ形にも、文字の一覧にもしなかったのは、画像処理は途中経過が**絵で**見えないと
当てずっぽうになるから。「ぼかす → 色で拾う → 塊にする」と文字で並んでいても、人はどこで何が
変わったか想像できない (二度作り直した。最初の版は道具箱と生のパラメータ欄を並べただけ、
二つ目は縦の文字の一覧に小さなサムネイルを添えただけで、どちらも文字を読まないと分からなかった)。

絵で分かるようにするための決め事:

- **一手を足す前に、候補を今の画で全部試す。** 「一手を足す」画面は、候補ごとに「受け取る画 → 結果」の
  絵を並べる。名前と説明から結果を想像しなくて済む。試すのは実機と同じ C# (`--probe`、下記)
- **設定は画をクリックして決める。** 「色で拾う」は画の色をクリックすると、その色の周り (色相 ±20°) を
  拾う設定になる。「しきい値」は画をクリックした明るさが境目になる。カメラのカードでは、切り出す前の
  画に「見る枠」を重ね、ドラッグで描き直せる
- **どの一手でも「左が前・右が後」の比較**ができ、画の上に凡例 (緑 = 拾った所、青の枠 = 見つけた物 …) を出す
- 一手ごとにアイコン (`opIcons.tsx`) と結果の一言 (「拾った所 12%」「3 個」) を付ける


| 部品 | 何をするか |
|---|---|
| `TaskBar` | どのタスクか、タスク設定 (いつ走るか・どこを見るか・保存先) の吹き出し、素材の読み込み (写真・写真の束・動画)、実機、モデル |
| `GuideBanner` | 初回だけ 4 行の案内 |
| `StartScreen` | 一手も無いときの画面。ひな型 / 取り込んだモデル / 「ONNX を取り込む」/ 白紙 を選ぶだけで動くパイプラインが置かれる |
| `Storyboard` (上) | 絵コンテ。カメラ → 各手 (アイコン・名前・**結果の絵**・一言) → 「結果の出しどころ」を横に。カードの間の線は流れる値の種類の色、前の手以外から受け取る手には「受け取る: …」の札。ドラッグで並べ替え、目のアイコンで一時的に外す、「+」で挿入 |
| `Stage` (中央) | 選んだ一手の結果を大きく。マスクは元の画に色を被せ、塊・四角形は枠、境界線は折れ線。どの一手でも前後の比較スライダーと凡例。マウスで画素の値。raw / 全体 / 100% / 200%。スポイト (色・明るさ) と見る枠のドラッグ |
| `Timeline` (中央下) | 動画や連続した写真のフレーム。合否の帯、イベントの印、件数の折れ線。←→ と再生 |
| `AddStepPicker` | 候補を**今の画で全部試した絵** (前 → 後) で並べる (`useProbe`)。繋げない一手は薄く出し「先にマスクが要る」と書く。検索と ↑↓ Enter |
| `StepInspector` (右) | 選んだ一手: 説明、受け取るもの (人が読めるラベルで)、設定。色で拾う手には「画から色を拾う」と色相の帯、しきい値には「画から境目を拾う」と入力の明るさの分布。出力の名前は普段隠す |
| `OutputsInspector` (右) | 「見つけた [物] のそれぞれに札を置く。距離 1.5 m」のように**文として読める**出力 |
| `DevicePanel` | 実機で動いているアプリから、直近に処理した画を取り込む (`query.getPerceptionSnapshot`)。1 秒ごとの取り込みも |
| (モデルタブ) | ONNX の取り込みと定義は画像処理タブの外、「モデル」タブにある (`doc/15`、`doc/16`)。ここでは画像のモデルだけが選べる |

素材は `src/renderer/vision/testMedia.ts`: 写真、名前順の写真の束、動画 (1 秒 2 枚、最大 40 枚)、実機の JPEG。
実機と同じく、タスクの見る枠で**切り出してから**流す (`cropToTask`)。ここを揃えないと閾値が実機とずれる。

入力の自動結線 (`src/renderer/vision/draft.ts`): 一手を足すと、直前までにある値から**型の合う一番新しいもの**を
繋ぐ。出力の名前は型から自動で付ける (`mask`, `mask2`, …)。人が名前を決めるのは、スクリプトが
参照するときだけ。「一手を足す」画面で試す下書きと、実際に挿入する一手は同じ関数で作る。

候補を試す (`--probe`): `tools/vision-preview --probe probe.json` に `{ index, ops: [候補…] }` を渡すと、
挿入位置までの値を一度作り、各候補をまっさらな `VisionState` で当てて `probe_<k>.rgba` (幅 200 に縮小) と
被覆率・件数を返す。候補が 30 個あっても 1 回の呼び出しで済む。主のプレビューとは別の呼び出しにして、
候補が多くても主の絵を待たせない。

### ライブプレビューは実物を呼ぶ

プレビューは `tools/vision-preview`（.NET）で、**実機と同じ C# をそのまま**動かしている。
TypeScript で op を書き直すと三重実装になり、エディタで見えるものと端末で起きることが
いずれ食い違う。画像は生の RGBA でやり取りするので、PNG の符号化・復号をどちらの側でも書いていない。

`.NET SDK` が無い環境でも編集はできる。サムネイルが出ないだけ。
ツールは一度ビルドして DLL を直接動かす (`src/main/vision/VisionPreview.ts`)。以前は毎回 `dotnet run`
していて、パラメータを一つ動かすたびに 1〜2 秒待たされた。

### ひな型

「色で物を数えて、それぞれに札を置く」(`products/CountAndLabel`)、「動いたら知らせる」
(`products/MotionAlarm`)、「看板・画面を見つけて正対させる」、「曇り空を青空にする」(`products/BlueSky`、
塗りの例)、「形を見分ける」、「色を測る」。学習済みモデルからは task に応じた流れが組まれる
(検出なら 追跡 → 絞り込み → 数える → 札を置く → 枠を重ねる)。
**これはエンジンの機能ではない。** ただの op の並びで、置いたあとは自由に変えられる。

## 5. 現実に重ねる (`world` 出力)

AR なので、結果は Canvas ではなく**現実の上**に出す。

1. 出力の色の画と、描く範囲のマスクを受け取る
2. マスクの外を透明にした RGBA を作る（境界は 3 回ぼかす）
3. **撮影時のカメラ姿勢**と内部パラメータから、その画がちょうど収まる板を 60m 先にワールド固定で置く

遠くにワールド固定するので、対象が十分遠ければ首を振っても貼り付いたままになる。
**近くのものに使うと視差でずれる。** そのときは板ではなく、画像アンカー（`doc/11`）で
姿勢推定した 3D オブジェクトを使うのが筋。

ビューポートソースのタスクでだけ使える。写真の枠（region）は正対化で幾何が変わるので、
現実の向きに戻せない。

### 見つけた物の位置に置く (`anchor` 出力)

検出の AR 版。`blobs` (か `quads`) の各項目について:

1. 正規化した中心 (x, y) → 処理した画の内部パラメータで光線に (`ViewportMapping.RayFromNormalized`)
2. 撮影時のカメラ姿勢で回し、指定の距離 (m) だけ進めた点に置く (深度は測れないので距離は設定)
3. 札 (`TextMesh` + 板、常にユーザーの方を向く) を出す。`track` の ID があれば同じ物に同じ札を使い回す
4. `objectId` があれば、最初の項目の位置へそのシーンオブジェクトを動かす (`scene.setPosition` と同じ経路)

`Overlay/ArsistWorldAnchors.cs`。札の文字は TextMeshPro (UI と同じ既定フォント)。組み込みの
`GUI/Text Shader` を Always Included に足してはいけない: BuildPlayer が `unity_builtin_extra` の
書き出しで落ちる (実際に踏んだ)。

## 6. 実装で実際に踏んだもの

数値検証で捕まえたもの。同じ罠は繰り返し踏むので残す。

- **エンジンに個別機能を入れた**（§1）。動いたが、ユーザーには作れなかった。
- **大津法の返り値の意味**。`t` は「背景 = `t` 以下」。`value >= threshold` の `Fixed` に
  そのまま渡すと背景まで前景に入り、**マスクが全面真っ白**になる。`t + 1` で返している。
- **閉じた輪郭に対する Douglas-Peucker**。素の DP は始点と終点を必ず残すので、
  **正方形が五角形**になる。始点から最も遠い点をもう一方の錨にして、二つの弧に分ける。
- **連結成分ラベリングの再帰**。空のように広い領域でスタックが溢れる。明示的なスタックを使う。
- **画像の端の行の勾配は必ず 0**。Sobel の窓が外に出るため。`edgeScan` はそこを飛ばす。
- **色相の山の中心**。窓の中心をそのまま使うと、真っ赤が 15° ずれて**オレンジと呼ばれる**。
- **明るさを絶対値で切った**。夕方や曇りの濃い日の空がまるごと落ちた。
  `threshold` の `relativeMedian`（周りの中央値の何割か）で解決。
- **平坦さを絶対値で切った**。暗い場面ではセンサーノイズで空でも勾配が上がる。
  `gate` の `orRelativeTo`（「マスクの外の何割以下なら通す」）で解決。
  合成データの実測で、ノイズの乗った薄暗い空が 0.45、地面だけの誤検出が 0.94。
- **切り出し・縮小のあとの内部パラメータ**（`ViewportMapping.ForCrop`）。素直に scale を掛けるだけだと
  **半画素ずれる**。縮小後の 1 画素は元の 1/scale 画素を覆うので、対応点はその中心:
  `Cx' = scale * (Cx - cropX + 0.5) - 0.5`。

## 7. 検証

```bash
npm run test:perception   # 演算子・パイプライン・結線チェック・現実への重ね方・ジャイロ・モデルの前後処理・読み出しの幅
npx vitest run            # エディタ側の結線チェック（C# と同じケース）、ONNX の読み取り、IR の移行
```

**しきい値や符号を触ったら必ず通すこと。** 間違っていてもコンパイルは通り、
実機では「なんとなく違う」としか分からない。
