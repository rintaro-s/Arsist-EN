# 17. 拡張機能・タグ・IR (Layster) の変え方 (`doc/17-extensions.md`)

`Extensions/<id>/` ・ `samples/extensions/` ・ `src/shared/{tags,irOps,extensions,engineFeatures,adapterTags}.ts`
・ `src/main/extensions/` ・ `Runtime/Extensions/` ・ `Editor/Extensions/`
・ `scripts/{ext-new,ir-new}.mjs`

エンジンの基礎ができた後で「特別なことをさせたい」「機能を足したい」となるたびに、
ビルドパイプライン (7000 行) や IR の型や画面をあちこち直すのはつらい。そこで、

- **エンジンの機能・端末 (アダプタ)・拡張機能を、名前ではなくタグで結ぶ** (§1)
- **機能はフォルダ 1 つの「拡張機能」として足す**。エンジン本体は触らない (§2)
- **IR (Layster.Virtual) の形は宣言的な操作 1 行で変えられる**。本体と拡張機能で別々に版を持つ (§3)

IR は Layster と呼び、Layster.Virtual (`project.json`) と Layster.Spatial (`project.spatial.json`) の 2 つの形がある
(doc/19)。拡張機能はどちらのプロジェクトでも同じ仕組みでビルドに入る。下で `project.json` と書いたところは、Spatial では
`project.spatial.json` の同じ名前の項目 (`extensions.<id>`、物の `ext.<id>`) になる。

にしてある。

## 1. タグ

形は `名前空間:値`。条件 (`requires`) は `all` / `any` / `none` の組み合わせで、`ns:*` も書ける。

| 名前空間 | 意味 | どこから来るか |
|---|---|---|
| `device:` | 端末そのもの | `adapter.json` の `id` (`device:meta-quest`) |
| `platform:` | OS | `adapter.json` の `build.platform` |
| `cap:` | 端末ができること | `adapter.json` の `capabilities` (true のもの) + `tags` |
| `sdk:` | ビルドに入る SDK | ビルド時に `sdk/` を見て決まる (`sdk:meta-mruk` など) |
| `feature:` | エンジンの機能 | プロジェクトが使っているもの (`src/shared/engineFeatures.ts`) |
| `ext:` | 拡張機能 | 拡張機能ごとに自動で付く |

```
 Adapters/Meta_Quest/adapter.json          src/shared/engineFeatures.ts         samples/extensions/quest-room/extension.json
   capabilities.handTracking: true  ─┐       feature:hand-tracking                 requires:
   tags: [cap:scene-understanding]   ├─▶ 端末のタグ ◀── requires: cap:hand-tracking   all: [cap:scene-understanding,
 sdk/quest/…mrutilitykit-*.tgz ─────┘    (+ sdk:meta-mruk)                              sdk:meta-mruk]
```

- 端末が足りないタグを持つ機能を使っていると、ビルドの最初に `WARNING: feature:… is used, but … lacks …` が出る
  (ビルドは止めない。その端末ではその機能が効かないだけ)。
- 新しい端末を足すときは、`adapter.json` の `capabilities` と `tags` を正しく書けば、
  手の操作を要る機能や拡張機能は自動で付いてくる。コードの名前比較を探して回らなくてよい。
- `sdk:*` はエディタ上では判断できない (sdk/ に何を置いたか次第) ので、画面には「ビルド時に確認」と出る。
  ビルドで足りなければ、その拡張機能だけ理由付きで外れる。
- 外れた拡張機能のスクリプトの名前 (`room` など) には、実機で**何もしない代役**が入る。どの呼び出しも
  `undefined` を返し、最初の 1 回だけ理由をログに出す。だから `room.onReady(function () { … })` と書いた
  プロジェクトを XREAL やスマホに出しても落ちず、その端末では中身が実行されないだけになる
  (`ArsistExtensions.InstallStandIns`、manifest の `absentExtensions`)。

**ルール:** `requires` には「無いと動かない」ものだけを書く。代わりの手段がある機能
(端末キーボードが無ければアプリ内キーボード、のような) に書くと、動く組み合わせに警告が出る。

## 2. 拡張機能

### 2.1 1 つの拡張機能 = 1 つのフォルダ

```
Extensions/<id>/
  extension.json     何で・どこで動き・どんな設定とデータを持つか (src/shared/extensions.ts の ExtensionManifest)
  Runtime/*.cs       実機で動く C#。ArsistRuntimeExtension を継承した入口を 1 つ
  Runtime/**/*.java  (任意) Android の Java。隣に .java.meta (PluginImporter で Android だけ) を置く
  Editor/*.cs        ビルド時に動く C# (任意)。ArsistBuildExtension を継承
  README.md
```

`Runtime/` と `Editor/` は中身ごと (`.java` や `.meta` も) `Assets/ArsistExtensions/<id>/` に写される。なので Android の
Java は `Runtime/Android/Foo.java` + `Foo.java.meta` (`platformData` で Android: enabled 1、Editor / Any: 0) を置けば、
Unity がそのまま Android のプラグインとしてコンパイルする (例: `quest-input` の録画、`Runtime/Android/ArsistRecorder.java`)。
C# からは `AndroidJavaClass` / `AndroidJNI` で呼ぶ。**呼ぶのはメインスレッドから** (別スレッドは `AttachCurrentThread` が要る。CLAUDE.md)。
Maven の依存が要るもの (ML Kit や ONNX Runtime のような) は、今はこの口では足せない。

雛形: `npm run ext:new -- <id> [--requires cap:hand-tracking] [--name "表示名"]`。
そのままビルドが通り、スクリプトから `<名前>.hello('x')` が呼べる見本になっている。

置き場は 4 つ (後ほど優先、同じ id なら後が勝つ):

1. `Extensions/` (リポジトリ。エンジンに同梱する**公式**の拡張機能。拡張機能タブに「公式」と出る。今は `vrm10`)
2. `<resources>/Extensions` (パッケージ版に同梱されたもの)
3. `<ユーザーデータ>/extensions` (自分で置くもの。エディタの拡張機能タブ → フォルダのボタン)
4. **登録したフォルダ** (設定の `extensionFolders`)。コピーせず、その場所のまま使う。
   フォルダ自体が拡張機能でも、拡張機能を並べたフォルダでもよい

3 があるので、同梱の拡張機能をエンジンごと更新しなくても、同じ id のフォルダを置けば差し替えられる。
4 は、作っている途中の拡張機能やサンプル向け: 書き換えがそのまま次のビルドに入り、`.arsist` に固め直す手間が無い。

```bash
npm run ext:link -- samples/extensions     # 登録 (エディタ: 拡張機能 → 鎖のボタン「フォルダを登録」)
npm run ext:links                          # 登録しているフォルダの一覧
npm run ext:unlink -- samples/extensions   # 登録を外す (フォルダの中身には触れない)
```

エディタ・ビルド (`scripts/run-unity-build.js` も)・MCP サーバーは、同じ一覧 (`config.json` の `extensionFolders`) を見る。
登録したフォルダが消えていると、拡張機能の一覧に「registered extension folder does not exist」と出る。

**サンプル**: 作例の `quest-room` と `quest-input` (§4, §5) はエンジンの一部ではなく、`samples/extensions/` にある見本。
使うにはそのフォルダを登録するか、`.arsist` にして読み込む。

### 2.2 エンジンとの約束

| したいこと | 書くところ | エンジンがやること |
|---|---|---|
| どの端末で動くか | `requires` | 合わない端末のビルドには **C# ごと入れない** (ログに理由) |
| 設定 | `data.settings` | エディタの入力欄を自動で作る → `project.json` の `extensions.<id>.settings` |
| 物ごとの指定 | `data.object` | 物のインスペクタに自動で出す → シーンの物の `ext.<id>` → 実機の `ArsistObjectExt` |
| 空間 (Spatial) の世界の状態を埋める | 入口の `OnStart` で `context.Spatial.AddProvider` | 部屋のスキャン・検出した物を entity として世界の状態に入れる (doc/20 §3) |
| データの形を変える | `data.version` + `data.migrations` | 開いたプロジェクトのその拡張機能のデータだけを移行 (§3.2) |
| スクリプトの API | `script.globals` + 入口の `RegisterScriptGlobals` | Jint に登録。組み込みの名前は `replaces` に書いたときだけ上書きできる |
| エンジンの部品を置き換える | `replaces` + 入口の `ReplaceEngineParts` | エンジンがその部品を使うとき、拡張機能の実装を使う (§2.6) |
| Android の権限 | `android.permissions` / `features` / `metadata` | AndroidManifest.xml に**足りないものだけ**足す |
| シーンに部品を置く | `Editor/*.cs` の `OnScene` | シーン保存の直前に呼ぶ |
| PlayerSettings | `Editor/*.cs` の `OnPlayerSettings` | 端末のパッチの後に呼ぶ |

C# は入口 (`unity.entry`) をビルドが生成する `ArsistExtensionRegistry.g.cs` が `new` するので、
リフレクションの型探しは無い。スクリプト API は Jint がリフレクションで呼ぶので、
入口の名前空間は `link.xml` で IL2CPP の削除から守る (自動)。

**合わない端末には C# が入らない**ので、Quest 専用の拡張機能は Meta の SDK を `#if` 無しで直接使ってよい
(`quest-room` がそう)。逆に、どの端末でも動く拡張機能は、端末の SDK に触れないこと。

### 2.2.1 端末・SDK・エンジンの改変

拡張機能は機能だけでなく、**端末そのもの**や**エンジンの中身**も足せる:

```
Extensions/<id>/
  Adapters/<端末>/adapter.json, AndroidManifest.xml   端末のアダプタ (provides.adapters に名前を書く)
  Packages/<SDK>.tgz または Packages/<SDK>/            端末の SDK (unity.packages に書く)
  Overrides/<Assets/Arsist からのパス>                  エンジンのファイルの改変版 (unity.overrides)
  Editor/*.cs                                          XR ローダー・OpenXR 機能の設定 (OnPlayerSettings)
```

- **端末を足す** — `npm run ext:new -- my-glasses --device My_Glasses` で雛形ができる。
  `provides.adapters` の端末は、エディタの端末の選択肢 (ビルド画面・新規作成) に出る。プロジェクトの
  targetDevice がその端末なら、その拡張機能は**有効にしなくても必ずビルドに入る** (`because: 'device'`)。
  アダプタの探し方はエンジン同梱の `Adapters/` と同じ (`src/main/adapters/adapterDirs.ts`)。同じ名前なら同梱が勝つ。
  XR の設定は Editor のフックで `context.AddXRLoader("<ローダーの型>")` / `context.EnableOpenXRFeature("<機能 ID>")`。
- **機能と端末をセットで** — 同じ拡張機能に `provides.adapters` と Runtime/Editor の C# を置き、
  `requires: { all: ['device:<その端末>'] }` にすれば、その端末向けのビルドにだけ、端末と機能が一緒に入る。
- **SDK** — `unity.packages`: `{ "com.vendor.sdk": "Packages/com.vendor.sdk-1.0.0.tgz" }` (拡張機能の中のファイル /
  フォルダ) か `"1.2.3"` (レジストリ)。入るビルドでだけ `Packages/manifest.json` に足し、要らなくなったら外す。
  エンジンが入れているパッケージは上書きしない (警告だけ出す)。
- **.unitypackage** — `unity.unitypackages`: `["Packages/VRM-0.131.3_011b.unitypackage"]` (拡張機能の中のファイル)。
  UniVRM のように .unitypackage でしか配られていないもの用。ビルドが Unity を使わずに作業用の Unity プロジェクトへ
  展開し (`src/main/extensions/unitypackage.ts`。置き場所は `Assets/` と `Packages/` の中だけ)、何を置いたかを
  `.arsist-extension-unitypackages.json` に覚え、拡張機能が入らなくなったらそれだけを消す。2 つの拡張機能が同じファイルを
  置こうとしたら止める。
- **エンジンの部品の置き換え** — §2.6。エンジンのファイルを書き換えずに済むなら、下の改変よりこちらを使う。
- **エンジンの改変** — `npm run ext:override -- <拡張機能のフォルダ> Runtime/Scripting/CoroutineRunner.cs` が、
  エンジンの元ファイルを `Overrides/` に写し、`unity.overrides` に**元のファイルの SHA-256** (`replaces`) を書く。
  あとは写しを編集する。ビルドは、その拡張機能が入るときだけ作業用の Unity プロジェクトのそのファイルを置き換え、
  入らなくなったら元に戻す (記録: `Assets/.arsist-overrides.json`)。**エンジンが更新されて元のファイルが
  変わっていたら、上書きせずにビルドを止める** — 古い前提の改変で、新しいエンジンの修正を黙って消さないため。
  直すときは自分の変更を新しい元ファイルに当て直してから、もう一度 `npm run ext:override` (replaces が今のエンジンに合う)。
  2 つの拡張機能が同じファイルを改変しようとしたら止める。リポジトリのエンジン本体は書き換えない。

### 2.2.2 配る・入れる (`.arsist`)

拡張機能はファイルの集まり (上のフォルダ) で、そのまま配っても、1 つのファイルにまとめても配れる。

```bash
npm run ext:pack -- samples/extensions/quest-input    # → samples/extensions/quest-input-1.0.0.arsist
npm run ext:install -- quest-input-1.0.0.arsist        # エディタの「インポート」と同じ (同じ id があれば --force)
npm run ext:install -- path/to/extension-folder        # フォルダからも
```

`.arsist` は zip で、`arsist-package.json` に全ファイルの SHA-256 が入っている。入れるときは一時フォルダに展開して、
パスが外に出ないか (`../`・絶対パス・シンボリックリンク)、全ファイルのハッシュ、`extension.json` と参照先のファイルを
確かめてから入れ替える (失敗したら既存のものはそのまま)。手でフォルダを zip にしたもの (ハッシュ無し) も受け付ける。

エディタでは、拡張機能タブ (上のタブ) の
**.arsist を読み込む / フォルダから読み込む (コピー) / フォルダを登録 (コピーしない) / .arsist に書き出す / 削除 (登録したものは「登録を外す」)**。入れ先は `<ユーザーデータ>/extensions/<id>`
(同梱の同じ id より優先)。同じ id が入っていれば、上書きか (古い版に戻すか) を訊く。

### 2.2.3 プロジェクトを開くときの確認

IR は「どの拡張機能を有効にしたか」(`extensions.<id>`) と「どの端末向けか」(`targetDevice`) を持っているので、
**開く前に、足りないものが分かる** (`checkProjectRequirements`)。

| 足りないもの | 例 |
|---|---|
| 有効にしている拡張機能が入っていない | 他の人から受け取ったプロジェクト |
| 入っている拡張機能が、プロジェクトのデータより古い | 相手が新しい版で保存した |
| 拡張機能が、このエディタより新しいエンジンを要る | |
| 端末のアダプタが、同梱にも拡張機能にも無い | 端末の拡張機能を入れていない |

どれかがあれば、エディタは**開かずに**一覧を出し、その場で拡張機能を読み込んで開き直せる
(`MissingRequirementsDialog`)。足りないまま開くと、その設定が画面に出ないまま保存され、ビルドからも黙って外れるため。
ビルドも同じ規則で止まる (無効にした拡張機能・端末に合わないだけの拡張機能は止めない)。

Layster.Spatial のプロジェクトは、今は**開くときにはこの確認をしない** (ビルドでは同じ規則で止まる)。Spatial のエディタには
拡張機能を有効にする画面も物ごとの指定の欄もまだ無いので、`project.spatial.json` の `extensions.<id>` / 物の `ext.<id>` を
直接書く (samples/spatial は `quest-room` を有効にしている)。

### 2.3 実機側で使えるもの (`ArsistExtensionContext`)

拡張機能がエンジンに触れる窓口はこれ 1 つ。エンジンの内部を直接いじらない
(そうしておけば、エンジンの中を作り変えても拡張機能は壊れない)。足りなければ、ここに口を足す。

| | |
|---|---|
| `Settings` / `GetBool` / `GetFloat` / `GetString` | 設定 (既定値の上にプロジェクトの値) |
| `DeviceTags` / `Features` / `HasTag` / `TargetDevice` | この端末とアプリ |
| `SetStore` / `GetStore` | 値の置き場 (UI の bind・スクリプトの store と同じ) |
| `FireEvent("<id>:<何>")` | スクリプトのイベント (trigger `{ type: "event", value: … }`) |
| `ObjectsWithData` / `ObjectData` / `FindObject` | IR で指定された物、名前や assetId で探す |
| `Host` | コルーチン用の MonoBehaviour |
| `Log` / `Warn` / `Error` | `[Arsist:<id>]` 付きで出る (`npm run logs` にも流れる) |
| `Spatial` (`Active` / `AddProvider`) | Layster.Spatial の世界の状態に provider を足す。Virtual のプロジェクトでは `Active` が false で、足しても何も起きない (doc/20 §3) |

スクリプトとの値の受け渡しは `ArsistScriptBridge` (`ToJs` / `FromJs` / `Call`)。素の値 ⇔ JSON で渡すので、
プロパティ名が C# 流になったり、IL2CPP で消えた getter が実機でだけ undefined になったりしない。

### 2.4 ビルドで起きること

```
UnityBuilder.planExtensions     端末のタグ + sdk:* + feature:* → 入る拡張機能を決める (ログに全部出す)
  → manifest.json               deviceTags / features / extensions (id・版・設定)
                                replaces → 部品ごとに 1 つの拡張機能 (manifest.replacements)。2 つが名乗れば止める
UnityBuilder.stageExtensions    Assets/ArsistExtensions/<id>/{Runtime,Editor} に差分同期
                                unity.unitypackages を展開 / 外れたものを消す
                                vrm-loader が置き換えられていれば、エンジンの UniVRM 0.x を作業用プロジェクトから外す
                                ArsistExtensionRegistry.g.cs / link.xml を生成
                                AndroidManifest.xml に足りない宣言を足す
                                前回入れて今回入らない拡張機能は消す
ArsistBuildPipeline             CreateGameObject: ext を ArsistObjectExt に
                                GenerateScenes: ArsistExtensionHost を置き、OnScene を呼ぶ
                                Phase 3.16: OnPlayerSettings を呼ぶ
実機                            ArsistExtensions が manifest と登録を突き合わせ、
                                ScriptEngineManager の初期化中に RegisterScriptGlobals、最初の Start で OnStart
```

フックが例外を投げたらビルドを止める (黙って続けると「ビルドは通ったのに実機で動かない」になる)。

## 3. IR の形を変える

### 3.1 エンジン本体の IR (Layster.Virtual)

`npm run ir:new -- "<変更の説明>" ["<English>"] [--version x.y.z]` が雛形を入れる
(`CURRENT_IR_VERSION` +1・`src/shared/layster/version.ts` の `VIRTUAL_FORMATS` に `β x.y.z` を 1 行・
`defineMigration(<版>, { ops: [] })`・アップグレード画面の説明)。`--version` を省くと直前の β の minor を 1 上げる。
中の数 (`irVersion`) は 1〜5 = α1〜α5、6 = β 1.0.0。画面やログには `describeVirtualIrVersion` / `formatLayster` を通して
「Layster.Virtual β 1.0.0」のように出す。Layster.Spatial にはまだ移行の仕組みが無い (β 1.0.0 だけ。今より新しい版のファイルは開かない)。
変更は宣言的な操作で書く (`src/shared/irOps.ts`):

```ts
defineMigration(5, { ops: [
  { op: 'default', path: 'arSettings.interaction.textInput', value: 'auto' },   // 無ければ足す
  { op: 'rename',  path: 'scenes[].objects[].assetPath', to: 'modelPath' },      // 名前を変える
  { op: 'remove',  path: 'logicGraphs' },                                        // 消す
  { op: 'map',     path: 'appType', values: { '3D_AR': '3d_ar_scene' } },        // 値の言い換え
] }),
```

`list[]` は配列の要素すべて、`*` はオブジェクトの値すべて。どの操作も冪等。
操作で書けない変更だけ `apply: (project) => string[]` に関数で書く。

`migrations.test.ts` が**全部の移行について**、版の抜け・2 回掛けても変わらないこと・説明文 (英日) の有無を
自動で確かめる。人が足すのは「古い形 → 新しい形」の例 1 つと、型 (`types.ts`)・`UnityBridge.ts`・Unity 側の読み手。

### 3.2 拡張機能のデータ

拡張機能のデータ (`extensions.<id>` と物の `ext.<id>`) は**拡張機能ごとに版を持つ** (`dataVersion`)。
エンジン本体の版を上げずに、拡張機能だけを更新できる:

```json
"data": {
  "version": 2,
  "settings": [ … ],
  "migrations": [
    { "from": 1, "to": 2,
      "settings": [ { "op": "rename", "path": "speed", "to": "velocity" } ],
      "object":   [ { "op": "map", "path": "glow", "values": { "true": "on", "false": "off" } } ] }
  ]
}
```

プロジェクトを開くと、本体の IR と同じく**メモリ上で移行して読み取り専用で開き、承諾されたら書き戻す**
(元の project.json は Backups/ に残る)。入っていない拡張機能のデータには一切触れない
(消すと、入れ直したときに設定が戻らない)。移行の道筋が途中で切れているときは、途中まで掛けずに理由を出す。

### 2.5 拡張機能がエンジンの機能を使う

拡張機能が `tags` に `feature:*` を書くと、「このアプリはその機能を使う」としてビルドの `manifest.features` に入る。
エンジンはそれを見て必要な宣言を入れる。例えば `quest-input` は `feature:text-input` を名乗るので、
プロジェクトに入力欄 (Input 要素) が無くても Quest のシステムキーボードの宣言が入り、`keyboard.open()` が使える。
`feature:hand-tracking` なら、ビルド設定でハンドトラッキングを切っていても手の宣言が入る。

### 2.6 エンジンの部品を置き換える (`replaces`)

エンジンのやり方を丸ごと別のものにしたいことがある (VRM 1.0 を読みたい、保存先をクラウドにしたい、`audio` を
別の音声エンジンにしたい…)。§2.2.1 の改変 (ファイルの差し替え) でもできるが、エンジンが更新されるたびに
直しが要る。そこで、エンジンは**置き換えられる部品**を決まった形 (C# のインターフェース) で使っていて、拡張機能は
その形の実装を 1 つ渡すだけで置き換えられるようにしてある。エンジンの中が変わっても、形が同じなら拡張機能は壊れない。

| 部品 (`replaces` に書く名前) | 実装する形 | エンジン標準 |
|---|---|---|
| `vrm-loader` VRM の読み込み | `Arsist.Runtime.VRM.IArsistVrmLoader` (+ 任意で `IArsistVrmFace` / `IArsistVrmEyes` をモデルに付ける) | UniVRM 0.x (VRM 0.x だけ) |
| `storage-backend` 端末に保存する値の置き場 | `Arsist.Runtime.Data.IArsistStorageBackend` | 端末の中のファイル 1 つ |
| `script:<組み込みの名前>` (`script:audio` など) | 何でも (Jint に渡すオブジェクト) | エンジンの `audio` など |

一覧の元は `src/shared/engineParts.ts` (実機側は `Runtime/Extensions/ArsistEngineParts.cs`。テストで照合)。

```json
"replaces": ["vrm-loader"]
```

```csharp
public override void ReplaceEngineParts(ArsistEngineParts.Replacer parts, ArsistExtensionContext context)
{
    parts.Replace<IArsistVrmLoader>(ArsistEngineParts.VrmLoader, new MyLoader(context));
}

// 組み込みのスクリプトの名前は RegisterScriptGlobals で ("replaces": ["script:audio"])
public override void RegisterScriptGlobals(ArsistScriptBridge script, ArsistExtensionContext context)
{
    script.Set("audio", new MyAudio(context));
}
```

雛形: `npm run ext:new -- my-thing --replaces vrm-loader,storage-backend,script:audio`
(入口の `ReplaceEngineParts` と、部品ごとの実装の雛形ができる。`storage-backend` の雛形は PlayerPrefs に書く動く見本)。

- **1 つの部品を置き換えられるのは 1 つの拡張機能だけ。** 2 つが有効ならビルドが理由付きで止まる。エディタの
  拡張機能タブ (「エンジンの部品を置き換える」) と `ir_validate_project` も先に言う。
- **宣言していない置き換えは実機で断る。** `replaces` に書いていない部品を `Replace` しても、組み込みの名前を `Set` しても、
  ログに理由を出してエンジン標準のまま動く (ビルドが manifest に書いた `replacements` と照らす)。
- `ReplaceEngineParts` は、エンジンがその部品を初めて使う直前に 1 回呼ばれる (シーンの `Start` より前のことがある。
  `context.Host` はまだ無い)。
- 部品が要るものをビルドが入れなくなることがある (`dropsFromBuild`)。`vrm-loader` を置き換えると、エンジンの
  UniVRM 0.x は作業用の Unity プロジェクトから外れる (拡張機能が自分の UniVRM を持ってくるので、UniGLTF の版違いが
  ぶつからないように)。拡張機能を外すと、次のビルドで元に戻る。

**作例: 公式の拡張機能 `Extensions/vrm10`** — `vrm-loader` を UniVRM 0.131.3 の VRM 1.0 用 (UniVRM10) に置き換える。
UniVRM10 は `Packages/VRM-0.131.3_011b.unitypackage` (UniVRM のリリースそのもの) を `unity.unitypackages` で持ってくる。
VRM 0.x のモデルも読み込み時に 1.0 に変換して読む。表情と目は `Vrm10Face` (`IArsistVrmFace` / `IArsistVrmEyes`)。

**エンジンに部品を足すとき:** インターフェースを作り (`Runtime/<場所>/IArsist….cs`)、エンジンがそれを使う場所を
`ArsistEngineParts.Get<T>(id) ?? エンジン標準` にし、`engineParts.ts` の `ENGINE_PARTS` と `ArsistEngineParts.Parts` に
1 行ずつ足す。インターフェースは小さく保つ (拡張機能が実装しやすく、エンジンが中を作り変えても形を保てるように)。

## 4. 作例: `quest-room` (Quest で部屋を理解する)

`samples/extensions/quest-room/README.md`。ヘッドセットがスキャンした部屋 (壁・床・天井・机・ソファ) を Meta の MRUK で読み、

- パネルや物を本物の壁・机・床に置く (物のインスペクタで「本物の面に置く」)
- 本物の家具に当たり判定を付ける (UI を指す邪魔はしない)
- 認識した面の輪郭を描く (現実とずれていないかの確認)
- `room.*` をストアに入れ、UI の文字にそのままつなげられる
- スクリプトの `room` (`room.place` / `room.lookAt` / `room.list` / `room.pin` …)
- `room.pin(id)`: 空間アンカーで、次に起動しても同じ場所に戻る
- Layster.Spatial のプロジェクトでは、読んだ部屋 (床・壁・家具) を provider (`QuestRoomSpatialProvider`) として世界の状態に入れる。
  置き方の `on: { is: ["table"] }` が本物の机に当たるのはこれのおかげ

`requires: cap:scene-understanding + sdk:meta-mruk` なので、XREAL・スマホ向けのビルドには入らない。
同じプロジェクトをそれらに出しても、パネルは作者が置いた場所にそのまま出る (壁に貼られないだけ)。

## 5. 作例: `quest-input` (Quest の入力ぜんぶ)

`samples/extensions/quest-input/README.md`。Touch コントローラー (全ボタン・タッチ・スティック・振動・姿勢)、
ハンドトラッキング (26 関節・つまみ・ジェスチャー)、システムキーボードと Bluetooth キーボード、マイク
(音量・話し始め / 終わり・WAV)、ヘッドセット (着脱・リセンター・リフレッシュレート) を

- スクリプトの `controller` / `hands` / `mic` / `keyboard` / `headset` (どれも `on(name, fn)`)
- store の `input.*` / `mic.*` / `keyboard.*` / `headset.*` (UI の表示にそのまま)
- スクリプトイベント `quest-input:<名前>` (関数を書かずに)
- 物のインスペクタの「つかめる」(コード無しでつかむ / 投げる)

から使える。ジェスチャーとマイクの計算は UnityEngine 非依存で、`npm run test:perception` が合成データで確かめる。
