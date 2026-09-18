# 14. 画像処理パイプライン (`doc/14-classic-vision.md`)

`UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/Perception/{Vision/Classic,Pipeline,Overlay}/`
・ エディタ: `src/renderer/components/viewport/VisionEditor.tsx` ・ 契約: `src/renderer/vision/opCatalog.ts`

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
                              ├ store : DataStore に値を入れる（UI から bind）
                              ├ world : 現実に重ねて描く（AR）
                              └ image : Canvas の Image に描く（確認用）
```

| 層 | 場所 | UnityEngine |
|---|---|---|
| 演算子 | `Vision/Classic/*.cs` | 使わない |
| パイプライン | `Pipeline/{VisionValue,VisionOps,VisionPipelineRunner}.cs` | 使わない |
| 現実に描く | `Overlay/ArsistWorldOverlay.cs` | 使う |
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

新しい op を足すときは **3 か所** を直す:

1. `Pipeline/VisionOps.cs` — `Apply` と `Signatures`
2. `src/renderer/vision/opCatalog.ts` — エディタの道具箱と型
3. `tools/perception-check` — 合成画像での検証

結線チェックは C# (`VisionPipelineRunner.Validate`) と TS (`src/renderer/vision/validate.ts`) の
**二重実装**。片方だけ直すと、エディタでは繋げるのにビルドで落ちる（またはその逆）になる。
両者を同じケースで叩くテストが `PipelineChecks.cs` と `validate.test.ts` にある。

## 4. エディタ

`画像処理` タブ。一手ずつ縦に積み、**各段の結果をその場でサムネイルで見る**形にしてある。

ノードを線で繋ぐ形にしなかったのは、画像処理は途中経過が見えないと当てずっぽうになるから。
流れはほぼ一本道で、たまに合流するだけなので、縦に並べて各段の絵を出す方が早く目的に着く。
合流は各段の入力欄で名前を選ぶ。

### ライブプレビューは実物を呼ぶ

プレビューは `tools/vision-preview`（.NET）で、**実機と同じ C# をそのまま**動かしている。
TypeScript で op を書き直すと三重実装になり、エディタで見えるものと端末で起きることが
いずれ食い違う。画像は生の RGBA でやり取りするので、PNG の符号化・復号をどちらの側でも書いていない。

`.NET SDK` が無い環境でも編集はできる。サムネイルが出ないだけ。

### ひな型

「曇り空を青空にする」「同じ色のものを数える」「形を見分ける」「色を測る」。
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
npm run test:perception   # 演算子・パイプライン・結線チェック・現実への重ね方・ジャイロ
npx vitest run            # エディタ側の結線チェック（C# と同じケース）
```

**しきい値や符号を触ったら必ず通すこと。** 間違っていてもコンパイルは通り、
実機では「なんとなく違う」としか分からない。
