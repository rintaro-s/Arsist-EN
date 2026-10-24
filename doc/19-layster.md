# 19. Layster — IR の名前と、Virtual / Spatial の 2 つの形 (`doc/19-layster.md`)

`src/shared/layster/` ・ `src/main/layster/` ・ `src/renderer/spatial/` ・ `Runtime/Spatial/`
・ `python/layster/`

ランタイムの中身・Mind と体の通信・記録の形式は [doc/20-spatial-runtime.md](20-spatial-runtime.md)、見本は `samples/spatial/`。

Arsist は 3 つの層でできている。

```
第1層  エディタ (Electron / React)   人とエージェントが書く
第2層  IR                            書かれたもの。唯一の正           ← これを Layster と呼ぶ
第3層  ビルドとランタイム (Unity)     IR を端末の上で動かす
```

第2層の IR を **Layster** と名付ける。Layster には形 (プロファイル) が 2 つあり、互いに互換性は持たない。

| 形 | 何を書くか | ファイル | 最初の版 |
|---|---|---|---|
| **Layster.Virtual** | 画面と座標。シーンに物を並べ、UI を作る、今までのアプリ (VR 的な作り方) | `project.json` | β 1.0.0 |
| **Layster.Spatial** | 空間。作者が知らない部屋・人・物・AI・ロボットの中で、何をどこにどうするか | `project.spatial.json` | β 1.0.0 |

エンジン (エディタ・ビルド・ランタイム) は両方を扱う。Virtual のプロジェクトを Spatial に変える道は作らない
(逆も)。形が違いすぎて、変換すると両方の良さが消えるため。

---

## 1. 名前と版

### 1.1 α と β

今までの IR の版 1〜5 は **α1〜α5** と呼ぶ。今から先は **Layster β 1.0.0** (Virtual β 1.0.0 と Spatial β 1.0.0)。

| 版 | 中身 |
|---|---|
| α1 | `irVersion` が無かった頃 |
| α2 | モデル (ONNX) と `infer` |
| α3 | モデルの `use` (image / text / tensor) |
| α4 | 拡張機能 |
| α5 | キャラクター・文字の reveal・端末への保存 |
| **Virtual β 1.0.0** | α5 と同じ形に、`layster` の見出しを足したもの |
| **Spatial β 1.0.0** | 新しい形 (この文書の §3) |

β の版は semver で数える。形を壊す変更は major、項目を足すだけなら minor、意味を変えない直しは patch。

### 1.2 ファイルの見出し

どちらのファイルも先頭に `layster` を持つ。エージェントも人も、ここを見れば何のファイルか分かる。

```json
"layster": { "profile": "virtual", "stage": "beta", "version": "1.0.0" }
"layster": { "profile": "spatial", "stage": "beta", "version": "1.0.0" }
```

画面での書き方は `Layster.Virtual β 1.0.0` / `Layster.Spatial β 1.0.0`。
(`src/shared/layster/version.ts` の `formatLayster` が唯一の書き方。)

### 1.3 Virtual の版の数え方 (中の数字)

Virtual は今までの移行の仕組み (`migrations.ts`、宣言的な `irOps`、`npm run ir:new`) をそのまま使う。
中では整数の `irVersion` を数え続け、**6 = β 1.0.0** とする。数と名前の対応は `VIRTUAL_FORMATS` が持つ。

- `irVersion` を残す理由: α のエディタは `irVersion` が自分より大きいと「新しすぎる」と言って開かない。
  β のファイルを α のエディタで開いて壊す事故がこれで防げる。
- α5 → β 1.0.0 の移行は `layster` の見出しを足すだけ。古いプロジェクトは今までどおり、承諾するまで読み取り専用。

### 1.4 Spatial のファイル名が違う理由

Spatial は `project.json` を使わない。α のエディタは `project.json` を探すので、Spatial のフォルダを開いても
「project.json が無い」で止まる (間違って α1 として読んで書き換える事故が起きない)。
フォルダにどちらのファイルがあるかで、エディタはどちらの画面を出すかを決める (`src/main/layster/projectKind.ts`)。
両方あるフォルダは作らない約束だが、あれば Spatial を優先する。新規作成の画面は最初に Virtual / Spatial を選ばせる
(`NewProjectDialog` → Spatial は `src/renderer/spatial/NewSpatialForm.tsx`)。

---

## 2. Layster.Virtual

中身は α5 と同じ。今までの文書 (doc/01〜18) がそのまま Virtual の説明。変わるのは名前と見出しだけで、
今までのプロジェクト・拡張機能・ビルドはすべてそのまま動く。

---

## 3. Layster.Spatial

### 3.0 何が違うか

Virtual は「作者が決めた座標に物を置く」IR。作者はアプリが動く部屋を知らないので、MR では次のことが起きる:

- 机の上に置いたつもりの物が、別の部屋では宙に浮くか、壁の中に埋まる
- 端末ごとに分かること (Quest は部屋のスキャン、XREAL は平面、スマホは何も無い) が違い、端末ごとに作り直す
- AI (World Model・VLA・判断モデル・LLM) に「今の空間」を渡す形が決まっていないので、毎回アプリが自前で組み立てる。
  AI の出力 (「カップを取って」「ここに置いて」) を実行する口も決まっていない
- ロボットのような現実の体 (Physical AI) は、XR から見ると「座標も安全もわからない外の機械」

Spatial は**空間を書く** IR。作者は座標の代わりに「何の上に」「誰の近くに」「見える所に」を書き、
エンジンが実際の部屋でそれを解く。部屋・人・物・AI・体は、すべて同じ「世界の状態」の上で出会う。

```
           ┌────────── 世界の状態 (World) ──────────┐
 端末の目 → │ 床・壁・机 (entity)   ユーザー (頭・手)   │ ← Mind の推測 (believe)
 拡張機能 → │ 見つけた物 (確かさ・最後に見た時刻・出どころ) │
           └───────┬──────────────┬─────────────┘
                   │観測 (observe)   │置き方を解く (solve)
                 Mind (AI)        Things (アプリの物)
                   │行動 (actions)    ↑
                   └──→ Action ───────┘──→ Body (ロボット)  … 安全の門を通る
```

### 3.1 座標

- 単位はメートル・度・秒。
- **軸は右・上・前 (RUF)**: +X = 右、+Y = 上、+Z = 前。Unity と同じ向き。エディタの 3D 表示 (three.js) は
  表示するときだけ Z を反転する。IR に鏡写しの約束は無い (Virtual にあった X の反転の罠を持ち込まない)。
- `yaw` は上から見て時計回り (+X の方へ回る) が正。
- 位置は必ず**どの座標系 (frame) で**を伴う。

| frame | 原点と向き |
|---|---|
| `world` | 起動したときのユーザーの足元 (床の高さ)。+Z は起動したときに向いていた水平の向き。重力に沿う |
| `user` | 今のユーザーの足元。向きは頭の水平の向き。重力に沿う (頭を傾けても傾かない) |
| `head` | 今の頭 (目の間)。頭と一緒に傾く |
| `hand.left` / `hand.right` | 手のひら (手が無ければコントローラーの握り) |
| `thing:<id>` | アプリの物 |
| `entity:<id>` | 世界の状態にあるもの (机・壁・見つけた物) |
| `body:<id>` | 体 (ロボット) の根元 |

床の高さが分からない端末では、頭の高さから `assumedEyeHeight` (既定 1.5 m) を引いた所を床とし、
その床の entity の確かさを低く (0.3) しておく。

### 3.2 世界の状態 (entity)

世界にあるものはすべて **entity**。部屋のスキャンも、物体検出も、Mind の推測も、試す空間 (§3.4) も同じ形。

```ts
interface Entity {
  id: string;
  is: string[];            // 何か。先頭が主 ('table')。語彙は vocabulary.ts (同義語あり)
  at: [x, y, z];           // world での箱の中心
  yaw?: number;            // 箱の向き
  size: [w, h, d];         // 箱の大きさ (箱のローカルの x, y, z)。壁は d≈0、床は h≈0
  has?: Affordance[];      // できること。無ければ is から決まる
  confidence: number;      // 0..1
  seenAt?: number;         // 最後に見た時刻 (起動からの秒)
  source: string;          // 'scan' | 'detector:<id>' | 'mind:<id>' | 'script' | 'space' | 'user' | 'assumed'
  data?: Record<string, unknown>;
}
```

形はすべて**向きのある箱**にそろえる (平面も厚み 0 の箱)。置き方を解く計算が 1 種類で済み、どの端末の
部屋の表し方 (Quest の MRUK・ARCore の平面・検出器の枠) からも作れる。壁の「部屋の内側」は箱のローカル +Z。

**できること (affordance)** — 置き方と AI の両方が使う共通の言葉:

| affordance | 意味 | 例 |
|---|---|---|
| `support` | 上に物を置ける | 机・棚・床・ベッド |
| `sit` | 座れる | 椅子・ソファ・ベッド |
| `mount` | 縦の面に貼れる | 壁 |
| `walk` | 歩ける | 床 |
| `grasp` | 手で持てる | カップ・本 |
| `obstacle` | ぶつかる | 床以外の背の高い物 |
| `screen` | 画面がある | テレビ・モニター |

語彙 (`is` の言葉・同義語・既定の affordance・典型的な大きさ) は `src/shared/layster/spatial/vocabulary.ts` が
唯一の元。ビルドで `spatial.json` に書き出すので、ランタイム (C#) は語彙を持たない (二重に持つとずれる)。

### 3.3 物 (things) と置き方 (placement)

アプリが出すものは **thing**。見た目 (`visual`) と置き方 (`place`) を持つ。

```ts
visual:
  { kind: 'shape',     shape: 'cube'|'sphere'|'cylinder'|'capsule'|'quad', size: [w,h,d], color, opacity? }
  { kind: 'model',     file: 'Assets/Models/x.glb', height? }           // height 既定 0.3 m
  { kind: 'character', file: 'Assets/Characters/x.vrm', animation?, blink?, breathe?, lookAtUser?, height? }
                       // blink / breathe 既定 true、lookAtUser 既定 'nearby'、height 既定 1.5 m
  { kind: 'panel',     size: [w,h], items: PanelItem[], ppm?, background?, padding? }
                       // items = text / button / input / image / row / space を縦に並べる。ppm 既定 1000 (1 px = 1 mm)
  { kind: 'label',     text, height?, color? }                           // height 既定 0.04 m
  { kind: 'marker' }                                        // 見えない目印 (他の物の基準・ロボットの根元)
```

物にはほかに `visibleAtStart` (既定 true。false なら `show` で出る)・`occlusion`・`grabbable`・`tags`・
`ext` (拡張機能ごとの指定。Virtual の `SceneObject.ext` と同じ。エディタでは物の「拡張機能」の欄) がある。

| 項目 | 意味 (ランタイムは doc/20 §3.2・§4.1) |
|---|---|
| `occlusion` | `auto` (既定) = 部屋の形を出す provider (`ISpatialOccluderSource`、見本は `quest-room`) があれば、本物の壁・家具の向こうで隠れる。`off` = 隠れない。provider が無い端末では何も隠れない |
| `grabbable` | `true` = コントローラーのグリップか、手でつまんでつかみ、動かせる (遠くはレイで)。離した所が新しい置き場所 (`keep: forever` なら覚え直す)。出来事 `grabbed` / `released` (と `grabbed:<id>` / `released:<id>`)。`mode: head` / `hand` の物はつかめない (validate が知らせる) |

置き方は**条件**で書く。座標で書くのは最後の手段。

```json
"place": {
  "on": { "is": ["table", "desk"] },
  "distance": [0.4, 1.5],
  "facing": "user",
  "clearance": [0.4, 0.3],
  "prefer": "closest",
  "keep": "forever",
  "fallback": [
    { "on": { "has": ["support"] }, "distance": [0.4, 2.0], "facing": "user" },
    { "at": { "frame": "user", "at": [0, 1.0, 0.8] }, "facing": "user" }
  ]
}
```

| 項目 | 意味 |
|---|---|
| `mode` | `world` (置いたら動かない、既定) / `body` (ユーザーについて来る。1.2 m 動くか 60° 向きを変えたら置き直す) / `head` (視界に固定。`at` 省略時は頭の前 1.2 m・0.1 m 下) / `hand` (手に付く。`at.frame` が `hand.left` でなければ右手) |
| `on` | 何の上 (縦の面なら前) に置くか。`is` (言葉) / `has` (できること) / `not` (除く言葉) / `minSize` / `within` |
| `near` | 何の近くか。`{ thing }` / `{ entity: query }` / `{ frame, at }` / `{ user: 'head' \| 'feet' \| 'hand.left' \| 'hand.right' }` |
| `around` | `near` の周りに取る輪の半径の範囲 (m)。既定 [0.3, 1.0] |
| `at` | frame からのずれ。`on` / `near` が無いときはそこが置き場所 |
| `distance` | ユーザーからの水平距離の範囲 (m) |
| `height` | 床からの高さの範囲 (m)。置く物の底の高さ |
| `facing` | `user` (既定) / `away` / `surface` (面の辺にそろえる) / `keep` (起動時の向き)。壁に貼る物は面の向きで決まる |
| `visible` | 置く瞬間に視界に入っていること。`true` = ±35°、数ならその半角 (度) |
| `clearance` | 置く面に空いていてほしい広さ [幅, 奥行き] |
| `avoid` | 離しておく物 (thing の id か言葉)。0.3 m 以上 |
| `prefer` | 候補の選び方 `closest` (既定) / `farthest` / `largest` / `center` / `inView`。距離の基準は `near` の点 (無ければユーザー) |
| `fallback` | 解けなかったときに順に試す、別の置き方 |
| `keep` | `none` (世界が変わるたびに解き直す) / `session` (起動中は動かない、既定) / `forever` (載せた面からの相対位置を端末の store `layster.place.<id>` に覚え、次の起動でその面があれば同じ場所。面の id が起動をまたいで同じなのは provider の約束 (quest-room は MRUK のアンカーの UUID) なので、別の空間アンカーは使わない。ユーザーがつかんで動かしたら、離した所で覚え直す。doc/20 §4) |

**解き方** (`src/shared/layster/spatial/solver.ts`、ランタイムは同じ計算の C# 版。同じ表で確かめる):

1. `mode` が `head` / `hand` ならその frame の `at` で終わり。
2. 置き場所の候補を作る。`on` があれば、合う entity の上面 (縦の面なら前面) に 10 cm 間隔の点を並べる
   (物の大きさの半分か `clearance` の半分だけ縁から内側。1 面 400 点を超えるなら間隔を広げる)。床はユーザーの周りの輪
   (`distance`、無ければ 0.6〜2.5 m)。`on` が無く `near` があれば、その周りの輪 (`around`) の上の点。
   `on` と `near` の両方なら候補は `on` から作り、`near` は `prefer` の距離の基準になる。どちらも無ければ `at`。
3. 硬い条件で落とす: `distance` / `height` / `visible` / 壁の裏に出ない / 床に立つ物は床の上 / 家具やもう置いた物と
   ぶつからない / `clearance` / `avoid`。
4. 残った候補に `prefer` で点を付け、一番良いものを選ぶ。同点なら候補の順 (結果は毎回同じ)。
5. 解けなければ `fallback` を順に (fallback は親の `mode` / `keep` を受け継がない)。全部だめなら**既定の置き場所**
   (ユーザーの前 1.2 / 0.9 / 0.6 m を正面と ±30° で試す。目の 0.25 m 下、こちら向き)。
   物が消えることは無い。どの規則で置かれたか (`rule`: 0 = 本来の置き方、1.. = fallback、`default`) と
   理由が結果に残り、エディタとログに出る。

物は参照される物が先に置かれる (`near` / `at` の `thing:` / `avoid` に出てくる物)。TS と C# の一致は
`solver-cases.json` (7 空間 × 5 物) を `solver.test.ts` と `npm run test:perception` の `SpatialChecks` が確かめる。

### 3.4 試す空間 (spaces) — 「どんな空間にも」を確かめる

作者は自分の部屋でしか試せない。Spatial のエディタは**いくつもの部屋で同時に**置き方を解いて見せる。

- 組み込みの空間 (`src/shared/layster/spatial/spaces.ts`、7 つ): `studio` (ワンルーム)・`desk-front` (机の前)・
  `living`・`classroom`・`open-floor` (何も無い所)・`tiny` (狭い部屋)・`no-scan` (スキャン無し、頭しか分からない)。
  中身は entity の一覧と、その空間で分かること (`knows`: `scan` / `hands` / `camera`)。
- プロジェクトの空間 (`spaces/<id>.json`): エディタの「試す空間」で組み込みのものを写し、JSON を書き換えて作る。
  使う空間は `spaces.use`。実機の世界の状態を書き出して取り込む道はまだ無い (§5)。
- エディタの真ん中 (Space Lab) は選んだ空間の 3D と、全空間の一覧 (「6 部屋中 5 部屋で机の上、1 部屋は fallback」) を出す。
- エージェントは `spatial_solve` で同じ表を得る。

### 3.5 Mind — AI を空間につなぐ

World Model・VLA・判断モデル (Lev / Jev)・LLM・VLM を、同じ形でつなぐ。Mind は
**何を見せるか (observe)** と **何を返してよいか (output)** と **どこで動くか** を宣言する。

```json
{
  "id": "helper",
  "role": "decide",
  "where": "edge",
  "protocol": "openai-chat",
  "endpoint": "http://{edge}/v1/chat/completions",
  "model": "qwen3.5:9b",
  "instructions": "ユーザーの机の上を整える手伝いをする。",
  "observe": { "frame": "user", "world": { "within": 3, "max": 30 }, "user": ["head", "hands"], "camera": { "width": 512 } },
  "output": { "actions": ["say", "highlight", "place"], "beliefs": true },
  "run": { "on": "interval", "everyMs": 5000, "timeoutMs": 8000 },
  "onFail": { "say": "考えがまとまりませんでした" }
}
```

- `role`: `decide` (何をするか決める) / `converse` (話す) / `perceive` (見て entity を足す) /
  `predict` (World Model: 先を予測して belief を足す) / `act` (VLA: 体への命令を出す)。画面の分類と、
  openai-chat のときの指示文の言い方に使う。
- `where`: `device` / `edge` (同じ LAN の PC) / `cloud`。画面に「どこで考えているか」を出すのに使う
  (Quest の中だけで推論しているように見せない)。今はどれも `endpoint` に HTTP で問い合わせる。端末の中 (ONNX) で
  動く Mind はまだ無い (§5)。
- `run.on`: `interval` (`everyMs`) / `change` (世界が変わったら) / `event` (`run.event` の出来事で) / `manual` (`ask` だけ)。
  `minGapMs` (既定 1000)・`timeoutMs` (既定 10000)。
- `output`: `actions` (返してよい行動)・`beliefs` (推測を受け取るか)・`text` (自由な文を入れる store のキー)。
- `onFail`: `use` (代わりに走らせる Mind の id) / `say` (字幕に出す文)。
- `protocol`:
  - **`layster`** — Layster Mind Protocol (下)。World Model やロボットの方策を包むサーバーを自分で書くとき
  - **`openai-chat`** — OpenAI 互換のチャット API (Ollama・Groq・vLLM・LM Studio …)。エンジンが観測を
    JSON にして渡し、返事の JSON を行動として読む。カメラの画は画像として添える。
    `extra` に書いた項目は要求にそのまま足す (`reasoning_effort: "none"` など、考えすぎて空を返すモデル向け)
- `endpoint` の `{edge}` は、端末に保存された PC のアドレス (`layster.edge`、既定は IR の `app.edge`、例 `192.168.0.23:8000`) に、
  `{edge-host}` はその host の部分だけ (`192.168.0.23`) に置き換わる。
- 鍵は IR に書かない。`auth.secret` に名前だけ書き (`header` 既定 `Authorization`、`scheme` 既定 `Bearer`)、値はプロジェクトの
  `.layster/secrets.local.json` (作成時に `.gitignore` に入る) に置く。値は main の外に出ない。ビルドが APK に焼き込み、
  ログに「焼き込んだ」と出す。値が無ければビルドは止まる。

**Layster Mind Protocol (`layster.mind/1`)** — HTTP POST、JSON。

```jsonc
// 要求 (端末 → Mind)
{
  "protocol": "layster.mind/1",
  "mind": "helper", "tick": 42, "time": 128.4,
  "frame": "user",
  "world":  [ { "id": "desk-1", "is": ["desk"], "at": [0.1, 0.36, 0.9], "yaw": 0, "size": [1.2, 0.72, 0.6], "confidence": 0.95, "seenAt": 127.9, "source": "scan" } ],
  "things": [ { "id": "quiz", "at": [...], "placed": true } ],
  "user":   { "head": { "at": [0, 1.52, 0], "forward": [0, -0.2, 0.98] }, "hands": { "left": null, "right": { "at": [...] } } },
  "camera": { "mime": "image/jpeg", "width": 512, "height": 384, "data": "<base64>", "fov": 70, "pose": {...} },
  "events": [ { "t": 126.0, "name": "select", "data": { "thing": "quiz.ok" } } ],
  "store":  { "study.state": "solving" },
  "actions": [ { "do": "say", "args": { "text": "string" } }, ... ],   // 返してよい行動とその形
  "goal": "…instructions…"
}
// 返事 (Mind → 端末)
{
  "actions": [ { "do": "highlight", "target": { "entity": { "id": "cup-3" } }, "label": "これ？" } ],
  "beliefs": [ { "id": "cup-3", "is": ["cup"], "at": [0.3, 0.75, 0.8], "size": [0.08, 0.1, 0.08], "confidence": 0.6 } ],
  "text": "（自由な文。store に入る）",
  "nextInMs": 2000
}
```

`beliefs` が World Model の口。Mind が「見えていないがあるはず」「この先こう動くはず」と考えたものは、
`source: "mind:<id>"` の entity として世界の状態に入り、確かさは時間とともに下がる。他の Mind・置き方・
スクリプトから、スキャンした物と同じように使える。

参考の実装: `python/layster/mind_server.py` (標準ライブラリだけ。そのまま動く見本で、自分のモデルを包む雛形)。

### 3.6 Action — 1 つの行動の語彙

規則 (§3.7)・Mind の返事・スクリプト (`world.act`) は、すべて同じ行動の語彙を使う。

| do | 中身 |
|---|---|
| `place` | 物を置き直す (`place` の条件か `at`) |
| `move` | 物を動かす。キャラクターは歩く |
| `look` | キャラクターがそちらを見る |
| `say` | キャラクター (か字幕) が話す。`audio` があれば鳴らす |
| `animate` | キャラクターの動き。`then: "stand"` で立ち姿に戻る |
| `show` / `hide` | 物を出す / 隠す |
| `highlight` | entity か物を光らせ、札を付ける (秒数) |
| `set` | store に値を入れる |
| `emit` | イベントを鳴らす (規則・スクリプトが拾う) |
| `believe` / `forget` | 世界の状態に entity を足す / 消す |
| `ask` | 別の Mind をすぐ走らせる |
| `command` | 体 (ロボット) に命令する。安全の門 (§3.8) を通る |

Mind が返してよいのは `output.actions` に書いたものだけ。それ以外は捨ててログに出す。

### 3.7 規則 (rules) とスクリプト

コードを書かずに済む振る舞いは規則で書く: `when` (きっかけ) → `if` (条件) → `do` (行動の並び)。

```json
{ "when": { "select": "panel.start" }, "do": [ { "do": "ask", "mind": "helper" } ] }
{ "when": { "seen": { "is": ["cup"] } }, "if": [ { "store": "mode", "eq": "tidy" } ],
  "do": [ { "do": "highlight", "target": { "entity": { "is": ["cup"] } }, "label": "カップ" } ], "cooldownMs": 10000 }
```

きっかけ: `start` / `every` / `select` (ボタン・物) / `gaze` / `near` / `seen` / `lost` / `event` /
`mind` (返事が来た) / `placed` / `fallback` (本来の置き方で置けなかった)。

それ以上はスクリプト (JavaScript、Virtual と同じエンジン)。Spatial では `world` が使える:
`world.find(query)` / `world.entities(query)` / `world.get(id)` / `world.believe(entity)` / `world.forget(id)` /
`world.user()` / `world.thing(id)` / `world.place(id, place?)` / `world.act(action | action[])` /
`world.ask(mind, extra?, cb)` / `world.on(name, cb)` / `world.command(body, name, args, cb)` / `world.snapshot(frame?)` /
`world.record.*` / `world.edge()` / `world.setEdge(addr)`。
Virtual と共有の `log` / タイマー / `store` / `storage` / `ui` / `audio` / `camera` / `api` / `model` も使える
(`scene` / `vrm` / `viewer` / `perception` / `remote` は使わない。`world` と行動で書く)。
一覧は `src/shared/layster/spatial/scriptApi.ts`。

### 3.8 Body — 現実の体 (Physical AI)

ロボットアーム・移動ロボット・家電は **body**。XR は「ロボットに空間を教え、ロボットの考えを見せ、
人を守る」ための装置になる。

```json
{
  "id": "arm", "kind": "arm",
  "link": { "protocol": "layster-body", "url": "ws://{edge-host}:8766" },
  "base": { "thing": "arm-base" },
  "workspace": { "center": [0, 0.15, 0.2], "size": [0.5, 0.4, 0.4] },
  "commands": [
    { "name": "pick", "args": { "target": "pose" }, "confirm": "always" },
    { "name": "home", "confirm": "never" }
  ],
  "safety": { "stopIfHandWithin": 0.25, "maxPerSecond": 2 },
  "twin": { "showWorkspace": true }
}
```

- `link.protocol`: `layster-body` (WebSocket・JSON、`python/layster/body_bridge.py` が見本) か
  `rosbridge` (ROS / ROS 2 の rosbridge の JSON。命令ごとに `ros: { topic, type }`)。
- `base`: 体の根元が世界のどこか。目印の thing (ユーザーが置く・画像で見つける) にする。
  体への命令の位置は body の frame に直して送る。
- **安全の門** — 体への命令はすべてここを通る:
  1. 命令の位置が `workspace` の外 → 送らない
  2. ユーザーの手が目標から `stopIfHandWithin` 以内 → 送らない (動いていれば止めを送る)。XR だから人の手の位置が分かる
  3. `confirm: "always"` → 視界に確認を出し、ユーザーが承諾してから送る
  4. 回数の上限 `maxPerSecond`
  どれで止めたかは出来事 `blocked` (data = `{ body, command, reason, source }`) とログに出る。

### 3.9 記録 (recording) — World Model の学習と、実機無しの試験のために

```json
"recording": { "enabled": true, "streams": ["pose", "hands", "world", "events", "actions", "minds", "camera"],
               "hz": 10, "camera": { "width": 320, "everyMs": 1000 }, "consent": { "text": "…" } }
```

端末の `layster/episodes/<開始時刻>/` に `meta.json`・`episode.jsonl` (1 行 1 出来事 `{ t, kind, data }`) と画像を書く。
同意の文を出し、承諾されるまで記録しない (記録を有効にして同意の文が空ならエラーで、ビルドできない)。`maxMinutes` で打ち切り、
`send.url` があれば終わったときに multipart で送る。形式 `layster.episode/1` は doc/20 §8
(LeRobot などの形式へは外で変換する。記録の再生はまだ無い)。

### 3.10 端末に依存しないために

Spatial の IR には端末の名前が出てこない。端末ごとの違いは**世界の状態を誰が埋めるか (provider)** だけ。

| provider | 何を埋めるか | どこ |
|---|---|---|
| 頭・手・コントローラー | `user` | エンジン (XR の入力) |
| 仮の床 | 床の entity (確かさ低) | エンジン (いつでも) |
| 部屋のスキャン | 床・壁・家具 | 拡張機能 (見本の `quest-room` が MRUK から。`samples/extensions/`) |
| 物体検出 | 見つけた物 | 拡張機能 / Mind (`perceive`) |
| Mind の推測 | belief | エンジン |

拡張機能は `ArsistExtensionContext.Spatial.AddProvider(...)` で provider を足す (doc/20 §3)。拡張機能を使うには
`project.spatial.json` の `extensions.<id>` で有効にする (形は Virtual と同じ `{ enabled, dataVersion, settings }`)。エディタでは
左の一覧の「プロジェクト → 拡張機能」で有効にし、設定を書く (入力欄は extension.json から作る。Virtual と同じ部品)。物ごとの指定
(`ext.<id>`) は物のインスペクタの「拡張機能」。エージェントは `spatial_set_settings` の `extensions`。
**開くとき・ビルドするときに、有効にした拡張機能と端末 (`targetDevice`) がこのエディタにあるかを確かめる** (Virtual と同じ
`checkProjectRequirements`)。足りなければ開かずに、読み込む画面 (MissingRequirementsDialog) を出す。samples/spatial は
`quest-room` を有効にしているので、`npm run ext:link -- samples/extensions` してから開く。
端末が足りなくても置き方は fallback で必ず解けるので、IR は端末を変えてもそのまま使える (見え方の質が変わるだけ)。
ビルドの端末は今 Meta Quest と XREAL One を選べるが、作って確かめたのは Quest 向けの APK だけ。

---

## 4. エンジンの中

| 層 | Virtual | Spatial |
|---|---|---|
| エディタ | 今までの画面 (`MainLayout`) | 作り直した画面 (`src/renderer/spatial/`): 左 = 物・Mind・体・規則・スクリプト・記録・空間・設定、真ん中 = Space Lab、右 = 置き方を文のように組むインスペクタ、下 = 世界の状態・Mind の入出力 (その場で Mind を試せる)・問題 |
| main | `ProjectManager` | `src/main/layster/SpatialProjectManager.ts` + IPC `spatial:*` |
| エージェント | MCP の今の道具 (`ir_*`) | `spatial_*` の 14 個 (同じ MCP サーバー、`src/main/mcp/spatialTools.ts`): `spatial_reference` / `spatial_create_project` / `spatial_get_project` / `spatial_get` / `spatial_set_{thing,mind,body,rule,script}` / `spatial_remove` / `spatial_set_settings` / `spatial_validate` / `spatial_solve` / `spatial_list_spaces`。`arsist_open_project` はフォルダの形を見て、どちらの道具を使うかを返す。`spatial_validate`・エディタのビルド・`scripts/layster-build.mjs` はフォルダが分かるので、`validateSpatialProject` に加えて動きの名前 (キャラクターの `animation`・`animate` の `clip` / `then`・スクリプトの `vrm.playAnimation`) が `Assets/Animations/*.fbx` にあるかも見る (`checkSpatialAnimations`。warning) |
| 第3層への書き出し | `UnityBridge` | `src/shared/layster/spatial/lower.ts` — 物を Unity のシーンの物と UI に、残りを `spatial.json` に書き出す。ビルドの機械 (`UnityBuilder`・端末の adapter・拡張機能) は共有 |
| ランタイム | 今までどおり | `Runtime/Spatial/` — `Core/` (UnityEngine 非依存: 世界の状態・置き方・行動・安全・Mind の要求と返事・記録の形式。`npm run test:perception` で確かめる) と、それを端末で動かす `ArsistSpatialRuntime` |

第3層 (ビルドの中間ファイルとランタイム) は 2 つの形の共有物で、IR ではない。Spatial は物の見た目を
Unity のシーンの物として書き出し、置き場所だけを実行時に決める。だから VRM・モデル・UI の作り方は
Virtual と同じ実績のある道を通る。

### 4.1 第3層への書き出し (`spatial.json` と、シーンの物)

`lower.ts` は Spatial のプロジェクトを、今のビルド (`UnityBuilder`) が受け取る形にする。

| 書き出すもの | 中身 |
|---|---|
| `manifest.json` | `UnityBridge` の `generateBuildManifest` に、Spatial から作った**内部用の** ArsistProject を渡したもの (ビルドの機能判定・拡張機能・モデル・ログの中継を Virtual と共有するため)。`layster` の見出し (Spatial) と、IR から決まる機能 `requiresFeatures` (Mind がカメラの画を見る・記録にカメラを含める → `feature:camera`) を持つ |
| `scenes.json` | シーン 1 つ。物 1 つにつき Unity のシーンの物 1 つ (`id` = `assetId` = thing の id)。最初は見えない所に置き、ランタイムが置き場所を解いてから出す |
| `ui_layouts.json` | パネル・札ごとに `scope: 'canvas'` のレイアウト 1 つ (`layster-<thing id>`) |
| `scripts.json` | Spatial のスクリプト + `memory.persist` |
| `spatial.json` | 下の形。ランタイム (`ArsistSpatialRuntime`) が読む |

物の見た目の書き出し方:

| visual | Unity のシーンの物 |
|---|---|
| `shape` | `primitive`、`scale` = 大きさ (円柱・カプセルは高さを 1/2)、色。`quad` は厚さ 2 mm の `cube` |
| `model` | `model` (`modelPath`)。高さ `height` への縮尺はランタイムが境界から決める |
| `character` | `vrm` (`modelPath` と `character`) |
| `panel` | `canvas` (`widthMeters` × `heightMeters`、`pixelsPerUnit` = `ppm`) + レイアウト。項目は縦に並べる。ボタンの `bindingId` は `event` か `<thing id>.<item id>`、id のある文字は `<thing id>.<item id>` (`ui.setText` で変えられる) |
| `label` | `canvas` + 文字 1 つ (`bindingId` = `<thing id>.text`) |
| `marker` | `empty` |

`spatial.json` (形式 `layster.spatial.runtime/1`):

```jsonc
{
  "format": "layster.spatial.runtime/1",
  "layster": { "profile": "spatial", "stage": "beta", "version": "1.0.0" },
  "name": "…",
  "edge": "192.168.0.23:8000",          // app.edge (無ければ "")
  "presentation": { … }, "interaction": { … },
  "virtualRoom": { "background", "floor", "grid", "gridCell", "wall", "furniture", "edge" },   // reality が virtual-room のときだけ (virtualRoom.ts)
  "vocabulary": [ { "word", "synonyms", "has", "vertical", "structural", "broader" } ],   // vocabularyForRuntime()
  "things": [ {
    "id", "name", "kind",                 // kind = visual.kind
    "object": "<scenes.json の物の id>",  // = thing の id
    "size": [w, h, d],                    // thingSize(visual)。置き方の計算に使う箱
    "place": { …Placement そのまま… },
    "visibleAtStart": true, "occlusion": "auto", "grabbable": false,
    "shape": { "shape": "cube", "color": "#…", "opacity": 1 },   // shape のときだけ
    "model": { "height": 0.3 },           // model のときだけ
    "character": { "height": 1.5, "animation": "…" },   // character のときだけ
    "panel": { "layoutId": "layster-<id>", "bindings": { "<item id>": "<bindingId>" } }  // panel / label のときだけ
  } ],
  "minds":  [ …Mind… ],                   // auth は解決済み: { "header": "Authorization", "value": "Bearer …" }。鍵の名前は残さない
  "bodies": [ …Body… ],
  "rules":  [ …Rule… ],
  "recording": { … },
  "memory": { "persist": [ … ] }
}
```

`presentation.reality: "virtual-room"` は背景を暗い単色にし (`arSettings.backgroundMode = solidColor`)、ランタイムが世界の状態から
**仮の部屋** (床の格子・壁・家具の箱、控えめな色) を描く (doc/20 §3.3)。何をどの色で描くかは
`src/shared/layster/spatial/virtualRoom.ts` だけで決め、エディタの 3D (Space Lab) も同じ見た目で見せる。

`app.logRelay` (`{ enabled, port? }`、省略 = 有効) は `arSettings.logRelay` になり、実機のログをビルドした PC へ LAN で流す
(doc/13。Virtual と同じ)。新しいプロジェクトは有効。有効な間は validate が warning を出す (配る APK では切る)。

物の「前」は箱のローカル +Z。`facing: "user"` は +Z をユーザーに向ける。Unity の Canvas は +Z の側から見ると
読めるので、ランタイムはパネル・札だけ 180° 回して置く。キャラクターは `ArsistCharacter.Forward` (VRM の顔の向き) を +Z とみなす。

ランタイムの world は「起動したときの足元」なので、頭の高さだけ Unity の world と縦にずれる
(Unity の原点は起動したときの頭、`PinSpawnViewpointToOrigin`)。床の高さが分かる端末はそれを使い、分からなければ
`presentation.assumedEyeHeight` を使う。変換は `Runtime/Spatial/SpatialFrames.cs` の 1 か所だけで行う。

---

## 5. 作る順番

1. 名前と版 (Virtual β 1.0.0 の移行、α の呼び方、サンプルの移行) ← 済
2. Spatial の型・語彙・試す空間・置き方の計算 (TS と C#、同じ表で確認) ← 済
3. Spatial のエディタ、プロジェクトの作成・読み書き、エージェントの道具 ← 済
4. ランタイム (世界の状態・置き方・Mind・行動・体・記録) とビルド ← 済 (Quest 向けの APK ができるところまで。
   **実機では一度も動かしていない**。XREAL 向けのビルドは選べるが試していない)
5. 物の `occlusion` / `grabbable`、`virtual-room` の仮の部屋、Spatial のエディタで拡張機能を有効にする画面、
   開くときの拡張機能の確認、ログの中継の設定、動きの名前の確認 ← 済 (ビルドまで。実機ではまだ)
6. 実機での確認、実機の部屋を空間として取り込む、記録の再生、端末内 (ONNX) の Mind ← 次

### やらないこと

- Virtual と Spatial の相互変換
- 特定の World Model・ロボット向けの機能をエンジンに入れること (Mind と Body の口は汎用。個別のものは外のサーバーか拡張機能)
