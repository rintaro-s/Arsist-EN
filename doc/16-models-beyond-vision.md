# 16. モデルを画像認識の外で使う — 言語モデル・埋め込み・任意の ONNX (`doc/16-models-beyond-vision.md`)

`Runtime/Inference/` ・ `Runtime/Scripting/ModelWrapper.cs` ・ `src/renderer/components/models/`
・ `src/main/model/{ModelImport,ModelTry}.ts` ・ `tools/vision-preview/{ModelTry,OnnxModelRunner}.cs`

IR v3 から、学習済みモデルは画像認識の部品ではなく**プロジェクトの独立した資産**になった
(エディタでは「モデル」タブ)。用途 (`use`) で分ける:

| use | 何に | どこから使う |
|---|---|---|
| `image` | 分類・検出・領域分割 (doc/15 §1) | 画像処理の `infer` ステップ / スクリプトの `model.runImage` |
| `text` | 言語モデル (生成)・文の埋め込み・文章の分類 | スクリプトの `model.generate` / `embed` / `classifyText` |
| `tensor` | それ以外の何でも | スクリプトの `model.run` (名前つきのテンソルを渡す) |

ONNX はそのまま使う (変換しない)。文章のモデルに ONNX の外で要るのは**分割器**だけで、
それも HuggingFace が配っている `tokenizer.json` をそのまま読む (§2)。

## 1. 仕組み

```
スクリプト (Jint)  model.generate("Name", "質問", { onToken }, cb)
      │
ModelWrapper ──▶ InferenceService (UnityEngine 非依存)
                   ├─ HfTokenizer          tokenizer.json で 文章 ⇄ 番号
                   ├─ ChatFormat           会話 → モデルが学習した書式 (ChatML / Llama 3 / …)
                   ├─ TextGenerationSession 1 トークンずつ、KV キャッシュ、止める判定
                   ├─ TextEncoding         埋め込み (pooling / 正規化)・分類
                   └─ IModelRunner  ──▶ 実機:     ArsistModelExecutor (Unity Inference Engine、GPU)
                                          エディタ: OnnxModelRunner (ONNX Runtime、「試す」)
```

- **推論器の契約は「名前つきのテンソル → 名前つきのテンソル」** (`ModelTensor`: float / int64 / int32 / bool、
  大きさ 0 の軸も可)。画像認識の `infer` も同じ推論器を通る (`IVisionModelRunner` は薄い包み)。
- 実機の推論器は**メインスレッドを止めない**。依頼を積み、`Update` で Schedule → 非同期 readback →
  完了したらコールバック。スクリプトのコールバックもメインスレッドで呼ばれる。
- 生成は「次に流す入力を作る」「出てきた出力を受け取る」だけのセッションで、推論器が同期
  (エディタ) でも非同期 (実機) でも同じコードが動く。同期のときは再帰せずループで回す
  (3000 トークンでもスタックが深くならないことを `InferenceChecks` で確認)。
- 結果は素の木 (辞書 / 配列) → JSON → `JSON.parse` でスクリプトに渡す。Jint の型変換に頼らない。

### 1.1 生成が読む入出力

ONNX の書き出し方 (Optimum / transformers.js / onnxruntime-genai / Unity の配布) で名前はほぼ揃っている。
`TextGenerationSession.Plan` が名前で役割を決め、知らない入力があれば**名指しで断る**
(`unsupportedInput:<name>`、Try にそのまま出る):

| 入力 | 入れるもの |
|---|---|
| `input_ids` (無ければ最初の整数の `[batch, 長さ]`) | まだキャッシュに無いトークン |
| `attention_mask` | 過去 + 今回の長さの 1 |
| `position_ids` / `cache_position` | 過去の長さから続く位置 |
| `past_key_values.<n>.key/value` | 前の一歩の `present.<n>.key/value` (最初は長さ 0) |
| `use_cache_branch` | 過去があるか (Optimum の merged 形式) |
| `num_logits_to_keep` / `logits_to_keep` | 1 (最後の位置だけ) |

出力は `logits` (無ければ `present` 以外の最初の出力) の最後の位置の行から次のトークンを選ぶ
(`Sampler`: 温度・top-k (ヒープで拾う、15 万語でも全体を並べ替えない)・top-p・繰り返しの抑制)。
キャッシュを取らないモデルは毎回全体を流し直す (遅いが動く)。

### 1.2 IR (`ModelDefinition.text`)

```
use: 'text'
text
├── task            generate | embed | classify
├── tokenizer       Assets/Models/<name>_<hash>.tokenizer.json
├── chatFormat      chatml | llama3 | phi3 | gemma | mistral | none | custom (+ promptTemplate)
├── systemPrompt?   既定の指示 (スクリプトの options.system で上書き)
├── maxNewTokens / temperature / topK / topP / repetitionPenalty / stop[] / eosTokens[] / maxContext
└── pooling / normalize / outputName / maxLength / labels      (embed / classify)
```

画像の読み方 (`task` / `input` / `output` / `labels`) は `use: 'image'` のときだけ持つ。
v2 のモデルは全部画像のモデルなので、2 → 3 の移行は `use: 'image'` を補うだけ。

## 2. 分割器 (tokenizer.json)

`HfTokenizer` が HuggingFace の `tokenizer.json` をそのまま読む。対応:

- model: **BPE** (GPT-2 / Qwen / Llama 3 / SmolLM の byte-level、Llama 2 / Mistral / Phi-3 の `▁` + byte_fallback)、
  **WordPiece** (BERT / MiniLM)、WordLevel
- normalizer / pre_tokenizer / post_processor / decoder: よく使われるもの一式 (ファイル頭の一覧)
- **Unigram (T5 / XLM-R) は未対応**。読み込み時にはっきり断る

公開されている分割結果と番号まで突き合わせてある (`ARSIST_HF_DIR` を置いて `npm run test:perception`):

| tokenizer | 入力 | 番号 |
|---|---|---|
| gpt2 | `Hello world` | `[15496, 995]` |
| bert-base-uncased / all-MiniLM-L6-v2 | `Hello world` | `[101, 7592, 2088, 102]` |
| SmolLM2 | ChatML の印・数字 1 桁ずつ・日本語 | 往復一致 |

取り込み (`ModelImport.importModel`) は、ONNX の隣か一つ上 (HuggingFace の `onnx/` の外) の
`tokenizer.json` を一緒に取り込み、`tokenizer_config.json` の `chat_template` から会話の書式を、
`eos_token` / `generation_config.json` から終わりのトークンを、`config.json` の `id2label` から分類の
ラベルを埋める。`tokenizer.json` が無く GPT-2 系の `vocab.json` + `merges.txt` だけの配布
(Unity の `data/` など) は、そこから byte-level BPE の `tokenizer.json` を組み立てる (中身は変えない)。

## 3. 実機で何に動かしてもらうか — 2 つの推論器

実機には推論器が 2 つある。モデルごとに、取り込み時に決める (`ModelDefinition.runtime`、既定は自動)。

| runtime | 何が動かすか | 得手 / 不得手 |
|---|---|---|
| `unity` | Unity Inference Engine | GPU (コンピュートシェーダー) で速い。**標準の ONNX 演算子だけ** |
| `onnxruntime` | APK に同梱する ONNX Runtime (`Runtime/Inference/ArsistOrtRunner.cs`) | CPU だが、最近の LLM の書き出しも動く。arm64 のライブラリで **+33MB** |

Inference Engine 2.6.1 の取り込みが扱える演算子は `src/shared/unityOps.ts` (パッケージの
`ONNXModelConverter.cs` の表をそのまま写した) で、**制御構文 (`If` / `Loop`) と、ONNX Runtime 専用の
融合演算子 (`com.microsoft` の `GroupQueryAttention` / `RotaryEmbedding` / `MatMulNBits` …) が無い**。
LLM の書き出しはこれらを使うことが多い。だから **Unity だけでは、最近の LLM は実機で動かせない**:

| ファイル | 実機 |
|---|---|
| HuggingFaceTB/SmolLM2-135M-Instruct `onnx/model.onnx` | ✕ (`GroupQueryAttention` など、com.microsoft) |
| Xenova/llama2.c-stories15M `onnx/decoder_model(_merged).onnx` | ✕ (`If`) |
| **unity/inference-engine-tiny-stories** `models/tinystories.onnx` | ○ (標準の演算子だけ) |
| Xenova/all-MiniLM-L6-v2 `onnx/model.onnx` (埋め込み) | ○ |
| onnx-community/Qwen3.5-0.8B-Text-ONNX (fp32 / fp16 / q4 …、**全部**) | ✕ (`GroupQueryAttention` / `LinearAttention` / `CausalConvWithState`、q4 は `MatMulNBits` も) |

Inference Engine 2.6.1 のパッケージには、これらの演算子がどこにも無い (`ONNXModelConverter` の表にも、
`com.microsoft` の実装にも)。**そのためのもう 1 つの推論器が `onnxruntime`** で、これを選んだモデルは
Unity のエンジンを通らない。取り込み時に演算子を見て自動で振り分けるので、普段は意識しなくてよい。

### 3.1 ONNX Runtime を同梱する道

```
C# (ArsistOrtRunner)
  │  AndroidJavaClass
  ▼
com.arsist.ort.ArsistOnnxRuntime (Java, Editor/AndroidPlugins/ArsistOnnxRuntime.java.txt)
  │  ai.onnxruntime
  ▼
libonnxruntime.so   (Maven: com.microsoft.onnxruntime:onnxruntime-android)
```

- **入れるのは必要なときだけ。** そういうモデルがあるビルドでだけ、Java ブリッジと Maven の依存を足す
  (`ConfigureOnnxRuntimePlugin`)。OCR (ML Kit) と同じ仕組みで、`mainTemplate.gradle` は
  両方の依存を集めてから 1 回で書く (`WriteAndroidGradleTemplate`)。
- **値は JNI をまたがない。** 出力は「あちら側の番号」として返り (`ModelTensor.Handle`)、次の一歩の入力に
  そのまま渡せる。KV キャッシュは 1 歩ごとに数 MB あるので、ここを運ぶ作りにすると速さが出ない。
  運ぶのは本当に読む値 (logits の最後の行) だけ。
- **置き場は StreamingAssets。** Inference Engine 用のモデルは Resources に `ModelAsset` として入るが、
  ONNX Runtime は実ファイルを開くので、素のまま `StreamingAssets/ArsistModels/<id>/` に置く。
  Android では APK の中にあって開けないため、初回だけ端末側へ写す (`ArsistOrtRunner.EnsureOnDisk`)。
  写し終わるまで `model.*` は `modelNotReady` を返す (黙って待たない)。
- 重みが別ファイルのモデル (`*.onnx_data`) も、同じフォルダに元の名前で並べる。

Java ブリッジは、Unity のビルドを待たずに確かめられる (ビルドは 10 分かかるので、書き間違いはここで潰す):

```bash
J=<Unity>/Editor/Data/PlaybackEngines/AndroidPlayer
$J/OpenJDK/bin/javac -cp "<onnxruntime-android.aar の classes.jar>:$J/SDK/platforms/android-*/android.jar" \
  Assets/Arsist/Editor/AndroidPlugins/ArsistOnnxRuntime.java.txt
```

### 3.2 どちらで動くかの見え方

モデルタブには、そのモデルを実機で何が動かすかが出る (一覧では `ORT` の印)。自動の判断は変えられる。
`unity` を選んだのに扱えない演算子があるときは、ビルドが `CopyModelsToProject` の取り込み確認で
**はっきり止まる** (動かない APK を作らない)。

### 3.3 Hugging Face から取り込む

モデルタブの「Hugging Face から」。リポジトリ名 (`onnx-community/Qwen3.5-0.8B-Text-ONNX`) か、その
ページのアドレスを貼ると、`src/main/model/HuggingFace.ts` が

1. ファイル一覧 (`/api/models/<repo>/tree/main?recursive=true`) を読み、
2. **同じモデルの精度違いをまとめ** (`model.onnx` / `model_fp16.onnx` / `model_q4.onnx` …)、
3. 重みが別ファイル (`*.onnx_data`) の分も足した**本当の大きさ**を出し、
4. 選ばれた 1 本と、その重み・`tokenizer.json`・設定ファイルだけを落とす

落としたものは `Assets/Models/<リポジトリ名>_<精度>/` に、**元のファイル名のまま**置く
(重みの参照は ONNX の中にファイル名で書かれているため)。その後は手元の ONNX と同じ道
(`importDownloadedModel` → `OnnxInspector` → 定義の下書き) を通る。大きな ONNX と `tokenizer.json` は
二重に持たない (その場を指す)。

- **精度の選び方**: 一覧には大きさと「実機でも動く見込み / エディタのみ」を添える。量子化された
  書き出し (q4 / int8 …) は ONNX Runtime 専用の演算子を使うので、実機では動かない (§3)。
  既定では q4 を選ぶ (手元で試すには一番軽い)。実際にどの演算子を使っているかは、落とした後の
  取り込みで確かめ、動かないものは **「ビルドに含める」を自動で外す** (`includeInBuild: false`)。
  そのモデルはエディタの「試す」では使えるが、APK には入らない。
- **トークン**: 設定の「Hugging Face のアクセストークン」。非公開・同意が要るリポジトリだけに要る。
  electron-store に置き、`huggingface.co` にだけ送る。
- 画像も読むモデル (VLM) は ONNX が複数 (`vision_encoder` / `embed_tokens` / `decoder_model_merged`) に
  分かれていて 1 本では動かないので、取り込む前に「文章だけの版を探して」と言う。

## 4. スクリプト API

```js
model.generate("TinyStories", "Once upon a time", {
  maxNewTokens: 64, temperature: 0.7,
  onToken: function (piece, text) { ui.setText("story", text); }   // 書けたそばから
}, function (r) {
  if (!r.ok) { error(r.error); return; }                             // r.text / r.tokens / r.reason / r.tokensPerSecond
});

model.generate("Chat", [{ role: "user", content: "..." }, { role: "assistant", content: "..." }, { role: "user", content: "..." }], cb);

model.embed("MiniLM", "明かりをつけて", function (a) {
  model.embed("MiniLM", "電気を点けてください", function (b) { log(model.similarity(a.vector, b.vector)); });
});

model.classifyText("Sentiment", "最高の一日", function (r) { log(r.label + " " + r.score); });
model.runImage("Detector", function (r) { log(r.count); });            // 今のカメラの画
model.run("AnyModel", { x: { shape: [1, 4], data: [1, 2, 3, 4] } }, function (r) { log(JSON.stringify(r.outputs)); });
model.stop("Chat");  model.busy("Chat");  model.list();  model.info("Chat");   // list: [{id,name,use,task}]
model.tokenize("Chat", "text");  model.detokenize("Chat", [1, 2, 3]);
```

名前か id で呼べる。1 つのモデルの生成は同時に 1 本 (2 本目は `busy`)。
`model.run` の出力は 1 本あたり 65536 値までスクリプトに渡す (LLM の logits を丸ごと渡すと重すぎる)。

### 4.1 考えている途中を隠す

Qwen3 系や R1 系は、答えの前に考えを `<think> … </think>` に書く。既定 (`text.hideThinking`) では
それを落として、答えだけを `r.text` と `onToken` に渡す (`TextGenerationSession.StripThinking`)。
考えも見たいときはモデルタブで外す。

## 5. エディタ (モデルタブ)

左に一覧 (用途のアイコン、実機で動かないものは赤い印)、中央に定義 (用途・分割器・生成の設定・
入出力の表・**スクリプトからの書き方** (名前入りでそのまま貼れる))、右に**試す**:

- 文章 (生成): 会話。書けたそばから出る。トークン数・毎秒のトークン数・止まった理由
- 文章 (埋め込み): 1 行 1 文。1 行目との近さを棒で
- 文章 (分類): ラベルと確からしさの棒
- 文章 (共通): 文がどんなトークンに切られるか (␣ = 空白)
- 画像: 画を選んで掛ける / テンソル: 形を決めて ゼロ・1・乱数 で流し、出力の形と先頭の値

「試す」は `tools/vision-preview --model-try` (画像処理のプレビューと同じ DLL) で、**実機と同じ
InferenceService** を ONNX Runtime で動かす。標準出力に 1 行 1 JSON を書き、生成は `delta` が逐次届く
(`src/main/model/ModelTry.ts` → IPC `model:try-line`)。止めるとプロセスを終わらせる。

画像処理タブは画像のモデルだけを見る (文章のモデルを `infer` に指定すると `modelNotImage` で名指し)。
「モデル」ボタンはモデルタブを開く。

## 6. 検証したこと

| 何を | 結果 |
|---|---|
| `InferenceChecks` (tools/perception-check) | JSON・3 種の分割器・サンプリング・KV キャッシュの長さ/位置/マスク・止める文字列・3000 トークン・埋め込み・書式 |
| SmolLM2-135M-Instruct (ONNX Runtime, KV キャッシュ) | 「フランスの首都は？」→ 正しい 1 文、約 39 トークン/秒 (CPU) |
| llama2.c-stories15M (キャッシュ無し / merged + `use_cache_branch`) | 同じ文章、99 / 220 トークン/秒 |
| unity/inference-engine-tiny-stories (入力名 `input`、int32) | 筋の通った続き、約 42 トークン/秒 |
| all-MiniLM-L6-v2 | 「Turn on the lights」に対し 「Switch the lamp on」0.61、「What is the weather tomorrow?」0.15 |
| 取り込み (dist の `importModel`) | SmolLM2 → text/generate/chatml/`<|im_end|>`、MiniLM → text/embed、tiny-stories → text/generate (vocab.json + merges.txt から組み立て) |
| Qwen3.5-0.8B-Text-ONNX q4 (注意のキャッシュ + 大きさの決まった状態、`num_logits_to_keep`) | 日本語で正しく答える。約 16 トークン/秒 (CPU)。`<think>` は隠れる |
| Hugging Face から取り込む | Qwen3.5 の精度 5 種を大きさつきで一覧 (fp32 2935MB … q4f16 448MB)、VLM のリポジトリは「複数に分かれている」と警告、MiniLM を実際に落として取り込み |

| ONNX Runtime 同梱のビルド | Qwen3.5-0.8B (q4) を積んだ Quest 向け APK が通る (654 MB)。APK の中に `lib/arm64-v8a/libonnxruntime.so` (33 MB) と `assets/ArsistModels/<id>/` (model.onnx + 重み 550 MB + tokenizer.json) が入る |
| Java ブリッジ | `javac` で単体コンパイルが通る (Unity のビルドを待たずに確かめられる。§3.1) |

実機で確かめていないこと: **同梱した ONNX Runtime が端末で実際に答えを返すところ**、GPU の上での生成の速さ、
長さ 0 の KV キャッシュを Inference Engine が受け付けるか。
ログは `[Arsist] Model '<id>' on ONNX Runtime: … ms` / `on GPUCompute: … ms` と `[ArsistJS]`。


## 同梱 ONNX Runtime の落とし穴 (2026-09 に踏んだもの)

**JNI は「つないでいないスレッド」からは何も呼べない。** 推論はメインスレッドを止めないために
別スレッドで回している。Unity の `AndroidJavaClass` は、つないでいないスレッドから呼ばれても
**例外を投げず 0 / 空文字を返す**。そのため実機では

```
答えられませんでした: badInput:input_ids:      ← 理由が何も書かれていない
```

という形にしかならなかった。`ArsistOrtRunner.RunBlocking` は、メインスレッド以外なら
`AndroidJNI.AttachCurrentThread()` してから Java を呼び、最後に `DetachCurrentThread()` する。

**要素 0 の入力は正しい。** 最初の一歩の KV キャッシュは `[1,2,0,256]` のように長さ 0 で渡す約束なので、
「空だから不正」と弾いてはいけない。形が要求する数と渡した数が**食い違うとき**だけ止める。

**ブリッジ自体はデスクトップで動かして確かめられる** (`tools/ort-bridge-check`)。実機と同じ版の
ONNX Runtime (デスクトップ用 jar) を取り、同じ Java を `android.util.Log` だけ差し替えて動かす。
open / describe / createLong / createFloat / 形の食い違いの扱いまで、C# と同じ順番で確認できる。
ただし**スレッドの問題はここでは出ない** (JNI が無いため)。
