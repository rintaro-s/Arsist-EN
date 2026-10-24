# 20. Layster.Spatial のランタイム (`doc/20-spatial-runtime.md`)

`UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/Spatial/` ・ `Runtime/Spatial/Core/` ・ `Editor/ArsistBuildPipeline.cs` (Spatial の節)
・ `samples/extensions/quest-room/Runtime/QuestRoomSpatialProvider.cs` ・ `python/layster/` ・ `tools/perception-check/SpatialChecks.cs`

doc/19 の Layster.Spatial を、端末の上で動かす部分。IR (`project.spatial.json`) は `lower.ts` で第3層の 5 つの
ファイルになり (doc/19 §4.1)、Unity のビルドがそれを読む。VRM・モデル・UI・スクリプト・store・音は Virtual と同じ
エンジンの部品をそのまま使い、Spatial が足すのは「置き場所を実行時に決める」ことと、世界の状態・Mind・体・記録だけ。

## 1. 構成

| ファイル | 役目 |
|---|---|
| `Core/` (UnityEngine に依存しない。`npm run test:perception` の `SpatialChecks` で確かめる) | |
| `SpatialModel.cs` | `spatial.json` (形式 `layster.spatial.runtime/1`) を型にする |
| `Vocabulary.cs` | 言葉の規則 (`vocabulary.ts` の写し)。表そのものは `spatial.json` から |
| `PlacementSolver.cs` | 置き方の計算 (`solver.ts` の写し)。`solver-cases.json` の 35 の置き場所で TS と同じ答えになることを確かめている |
| `WorldState.cs` | entity の表。出どころごとの扱い (下)、`Seen` / `Lost`、`Version` |
| `ObservationBuilder.cs` | Mind の観測 (`observe.ts` の写し) |
| `MindProtocol.cs` | Mind との話し方 (`mindProtocol.ts` の写し。指示文の文字まで同じ) |
| `ActionModel.cs` | 行動の形の確認、Mind が返してよい行動の絞り込み、規則の条件 |
| `SafetyGate.cs` | 体への命令の安全の門 |
| `EpisodeFormat.cs` | 記録の形式 `layster.episode/1` |
| Unity 側 | |
| `ArsistSpatialRuntime.cs` | 本体。ビルドが `[LaysterSpatial]` に 1 つ置く。毎フレーム frames → user → world → things → rules → minds → bodies → record |
| `ArsistSpatialHooks.cs` | エンジンの他の場所からの入口 (`world` のスクリプト名、保存するキー)。Spatial かどうかは `Resources/ArsistSpatial.json` の有無 |
| `SpatialFrames.cs` | spatial ↔ Unity の座標の変換 (ここだけ) |
| `SpatialUser.cs` / `SpatialGaze.cs` | 頭・手 (XR Hands の手のひら → XR の入力デバイス)・何を見ているか |
| `SpatialProviders.cs` | provider の口と登録簿、仮の床 |
| `ThingPlacer.cs` | 物を置く・隠す・付いて行かせる・覚える |
| `RuleEngine.cs` / `SpatialEvents.cs` | 規則と出来事 |
| `MindRunner.cs` / `SpatialCamera.cs` | Mind の呼び出し (UnityWebRequest) と、添えるカメラの画 |
| `ActionExecutor.cs` | 行動の実行 |
| `BodyLink.cs` | 体との WebSocket と安全の門 |
| `SpatialUi.cs` / `SpatialBillboard.cs` | 字幕・確認・強調の枠と札・体の動ける範囲 |
| `SpatialRecorder.cs` | 記録 |
| `WorldWrapper.cs` | スクリプトの `world` (一覧は `src/shared/layster/spatial/scriptApi.ts`) |
| `ArsistSpatialThing.cs` | シーンの物と thing の対応 (ビルドが付ける) |

ビルド (`ArsistBuildPipeline`): `Assets/ArsistGenerated/spatial.json` があれば `Resources/ArsistSpatial.json` に写し
(無ければ前のビルドの写しを消す。作業用の Unity プロジェクトは使い回すので)、`things[].object` に当たるシーンの物に
`ArsistSpatialThing` を付け、`ArsistSpatialRuntime` とスクリプトエンジンを置く。Virtual のビルドでは何も変わらない。

## 2. 座標

spatial の world は「起動したときの足元が原点、+Z は起動したときの水平の向き」。Unity の world は
「起動したときの頭が原点」(`PinSpawnViewpointToOrigin`) で、端末によっては床が原点。軸 (右・上・前) と yaw の向きは
同じなので、違いは原点と向きだけ。`SpatialFrames` は起動して 15 フレーム後の頭の位置と水平の向きを覚え、

```
unity = origin + R(yaw0) · spatial        origin = (頭の x, 床の y, 頭の z)
```

で変換する。床の高さは確かなものから順に:

| 出どころ | 確かさ |
|---|---|
| 部屋のスキャンの床 (`quest-room` の provider) | 0.9 |
| XR の追跡が Floor (その原点) | 0.8 |
| XR の境界 (ガーディアン) の点 | 0.6 |
| 頭 − `presentation.assumedEyeHeight` (既定 1.5 m) | 0.3 (最初) |

後から床が分かったら高さだけ直し、置いた物を spatial の姿勢のまま Unity で置き直す。目の高さとして無理な値
(0.5 m 未満・2.3 m 超) は捨てる。

物の置き方: 解いた姿勢は箱の中心。キャラクターは足元を箱の底に、モデルは見た目の範囲の底の中心を箱の底に合わせ、
`model.height` があれば高さをそれに縮める。物の前は +Z。Canvas (パネル・札) は 180° 回す。キャラクターは
`ArsistCharacter.Forward` (VRM の顔の向き) を前にする。`head` に付く物は頭のローカル (`at` をそのまま頭の
`TransformPoint`)、`hand` は手のひらからユーザーの水平の向きで `at` ずらし、頭の方を向く (手が見えないと隠れる)。
ビルドが付けた傾き (立てた quad など) は残し、水平の向きだけを置き方で決める。

## 3. 世界の状態と provider

| 出どころ | 薄れ方 |
|---|---|
| `scan` / `space` / `user` / `assumed` | 薄れない |
| `detector:<id>` | 確かさが 10 秒で 1/e |
| `mind:<id>` / `script` | 20 秒で 1/e |

0.15 を切ると消える (`lost`)。薄れる出どころの値は、薄れない出どころの entity をより低い確かさで上書きできない。

拡張機能は provider を足して世界の状態を埋める:

```csharp
public override void OnStart(ArsistExtensionContext context)
{
    if (context.Spatial.Active) context.Spatial.AddProvider(new MyProvider());
}

sealed class MyProvider : ISpatialProvider
{
    public string Id => "my-scanner";
    public void Begin(SpatialProviderContext c) { }
    public void Tick(SpatialProviderContext c)              // 毎フレーム、メインスレッド。変わったときだけ書く
    {
        var e = c.Box("table-1", new[] { "TABLE" }, unityCenter, unityRotation, localSize, 0.95);  // 言葉は語彙で正規化
        c.Upsert(e);
        c.ReportFloor(floorUnityY, 0.9, "my-scanner");        // 床が分かるなら
        c.Ready("my-scanner");                                 // 読み終えた → 置き直しの待ち時間を終える
    }
}
```

`Box` は Unity の箱 (中心・回転・ローカルの大きさ) を entity にする。一番鉛直に近い軸が高さ、残り 2 つのうち
後の軸が奥行き (+Z、yaw の向き)。面は奥行き 0 の箱で、法線の軸を最後に (MRUK の面は `forward` が法線で、壁は部屋の内側)。
`quest-room` の provider (`QuestRoomSpatialProvider`) が見本で、id は `mruk-<UUID の先頭 8 文字>` (起動をまたいで同じ)。
`quest-room` はエンジンの一部ではなく `samples/extensions/` の見本なので、使うにはフォルダを登録し
(`npm run ext:link -- samples/extensions`)、`project.spatial.json` の `extensions["quest-room"].enabled` を true にする
(samples/spatial はそうしてある。Spatial のエディタにはまだ拡張機能を有効にする画面が無い)。
`ISpatialAnchorStore` (任意) を持つ provider は端末の空間アンカーで `keep: forever` を覚えられる (今はまだ使っていない。
下の「載せた面からの相対位置」で覚える)。

組み込みの provider は**仮の床**だけ (出どころ `assumed`、確かさ 0.3 (XR から床の高さが分かっていれば 0.45)、足元 8 m 四方。
ユーザーが 2 m 動いたら付いて行き、確かさ 0.5 以上の床が来たら消える)。
だから部屋のスキャンが無い端末でも、置き方は fallback を通って必ず解ける。

## 4. 置く時刻と、覚える場所

| | いつ解くか |
|---|---|
| 起動 | 頭が取れたらすべて |
| 待ち時間 (provider の `Ready` から 1 秒後、最長 8 秒) | 世界が変わるたびにすべて (0.5 秒に 1 回まで) |
| `keep: none` | 待ち時間の後も、世界が変わるたびに (1 秒に 1 回まで) |
| `keep: session` | 待ち時間の後は動かない |
| `keep: forever` | 待ち時間の後、載せた面 (薄れない出どころの entity) からの相対位置を store の `layster.place.<id>` に残す。次の起動でその面があればそこに戻す |
| `mode: body` | ユーザーが 1.2 m 動くか 60° 向きを変えたら解き直し、0.6 秒かけて移る |

置いた・置き直した (規則が変わった) ときに `placed`、本来の置き方でなかったら `fallback` の出来事。ログは
`[Layster] placed quiz (start): rule 0 on desk world [...]`。`layster.` で始まる store のキーは自動で端末に残る
(PC のアドレス `layster.edge` もここ)。

## 5. Layster Body Protocol (`layster.body/1`)

WebSocket、テキストフレームに JSON 1 つ。位置はすべて**体の根元の frame** (根元の thing の置いた姿勢。メートル、
x 右・y 上・z 前)。

```jsonc
// 端末 → 橋 (つながったら最初に)
{ "type": "hello", "protocol": "layster.body/1", "body": "arm", "app": "Robot Helper",
  "commands": ["pick", "home", "stop"], "workspace": { "center": [0, 0.15, 0.2], "size": [0.5, 0.4, 0.4] } }
// 命令。引数のうち型が target / pose のものは { at, yaw, frame: "body" } に直してある
{ "type": "command", "id": "c3", "name": "pick", "args": { "target": { "at": [0.02, 0.05, 0.25], "yaw": 0, "frame": "body" } }, "frame": "body" }
// 止める (動いている間にユーザーの手が目標に近づいたとき)
{ "type": "stop", "id": "s4", "reason": "handTooClose" }

// 橋 → 端末
{ "type": "hello", "name": "sim-arm", "protocol": "layster.body/1" }
{ "type": "state", "status": "picking", "busy": true, "joints": { … }, "tool": [x, y, z] }   // 何でも足してよい
{ "type": "result", "id": "c3", "ok": true }        // { "ok": false, "error": "stopped" }
```

端末の store (`body.store`、既定 `body.<id>`): `.connected` (bool)・`.status` (短い文: `connected` / `picking` /
`blocked: hand too close` …。`state.status` が来たらそれ)・`.busy` (bool、`state.busy`)・`.state` (最後の state そのまま)。
出来事 `body:<id>` (state・result・つながった / 切れた) と `blocked`。切れたら 3 秒ごとにつなぎ直す。

`rosbridge` のときは、命令ごとの `ros.topic` に `advertise` (最初の 1 回) と `publish` (`msg` = 直した引数) を送る。
結果は返らないので、送れたら成功とする。

安全の門 (`Core/SafetyGate`): 体に無い命令 → `unknownCommand`、目標が動ける範囲の外 → `outsideWorkspace`、
ユーザーの手が目標から `stopIfHandWithin` (既定 0.25 m) 以内 → `handTooClose`、1 秒に `maxPerSecond` (既定 2) 回まで →
`tooFrequent`、`confirm: "always"` → 目の前に「OK / ×」を出し、承諾されたらもう一度門を通してから送る (60 秒で ×)。
根元の thing がまだ置かれていない・つながっていないときも送らない。見本は `python/layster/body_bridge.py`。

## 6. Mind

`run.on`: `interval` (`everyMs`、返事の `nextInMs` があればそれ)・`change` (世界の `Version` が変わったら)・`event`
(その名前の出来事で)・`manual` (`ask` の行動・`world.ask`)。どれも前回から `minGapMs` 空ける。1 つの Mind は同時に
1 つしか走らない。失敗したら 5 秒 (か everyMs) 待つ。

要求: `endpoint` の `{edge}` / `{edge-host}` を置き換え、`Content-Type: application/json`・`User-Agent: Layster/1.0 (Arsist)`
(Groq は既定の User-Agent を断る)・`auth` (ビルドが解決済みの値) を付けて POST。`openai-chat` の本文と返事の読み方は
`mindProtocol.ts` と同じ。返事の belief と `believe` の行動の位置は**観測の frame** で書かれているので world に戻す
(確かさが無ければ 0.5、出どころ `mind:<id>`)。行動は `output.actions` にあるものだけ実行し、他は捨ててログに出す。
`observe.camera` があれば `lower.ts` が `feature:camera` を要るものとして manifest に書き、カメラの係 (`ArsistPerceptionManager`)
がビルドに入る (端末にカメラがあれば)。そのとき 3 秒以内に撮れた静止画
(JPEG、`camera.pose` は spatial の world) を添える。撮れなければ画無しで呼ぶ。

store: `mind.<id>.status` (`thinking` / `ok` / `error: …`)・`mind.<id>.text`・`mind.<id>.ms`、`output.text` のキー。
出来事 `mind` (主語は Mind の id、data = `{ mind, ok, text, actions, beliefs, ms, error }`)。

## 7. 行動の約束

| 行動 | ランタイムがすること |
|---|---|
| `say` | store の `say.text` に文、`say.thing` に話す物の id (無ければ "") を入れ、`seconds` (既定 1.2 + 0.12 × 文字数、最大 12 秒) たったら `say.text` を "" に戻す (後の say に置き換わっていなければ)。`audio` (URL か base64 の WAV) があれば話す物の位置で鳴らす (`audio.play` と同じ道、VRM なら口も動く)。`say.text` を表示するパネル (UI の bind) がプロジェクトに無ければ、視界の下に字幕を 1 行出す |
| `highlight` | entity・物を線の箱で囲み、`label` があれば上に小さな札 (いつもユーザーの方を向く)。`seconds` (既定 5) で消える |
| `set` | store に入れる (UI の bind はその場で追従する) |
| `emit` | `ArsistScriptEvent` で鳴らす。規則の `{ event }`・`run.on: "event"` の Mind・`world.on(name)`・Virtual 式の `{ type: "event" }` のスクリプトがすべて受ける (`data` は ArsistScriptEvent では運べないので預けておき、規則・Mind・world.on に渡す) |
| `move` | キャラクターは歩く (`ArsistCharacter.WalkTo`、既定 0.7 m/s)。他の物は滑らせる。entity へなら、その上に載せる |
| `look` | キャラクターは体ごと向き、目もそちらを見る。他の物はそちらを向く |
| `animate` | `ArsistCharacter.Play` (`then: "stand"` で立ち姿へ) |
| `place` | `at` があればその姿勢 (yaw が無ければユーザーの方を向く)、無ければ `place` か物の置き方で解き直す |

実行した行動はすべて出来事 `action:<do>` になる。パネルのボタン (`bindingId` = `<thing>.<item>` か `event`) が押されると、
その名前の出来事と `select` (data = `{ thing, item, event }`) の両方が鳴る。

## 8. 記録 (`layster.episode/1`)

`Application.persistentDataPath/layster/episodes/<UTC の開始時刻>/`:

| ファイル | 中身 |
|---|---|
| `meta.json` | `{ format, app, layster, device, startedAt, streams, hz, frame: "world" }` |
| `episode.jsonl` | 1 行 1 つ `{ "t": 起動からの秒, "kind": …, "data": … }` |
| `camera/<t>.jpg` | カメラの画 (camera を記録するときだけ) |

`kind`: `start` / `stop` / `mark` / `pose` (`{ head, forward, feet, yaw }`)・`hands` (`{ left, right }`)・`world`
(`{ entities, things }`、変わったとき最大 2 秒に 1 回)・`event` (`{ name, data }`)・`action` (`{ source, action }`)・
`mind` (`{ mind, phase: request / reply / error, data }`)・`camera` (`{ file, width, height, pose, fov }`)・`command`・`blocked`。
位置はすべて spatial の world。始める前に必ず同意の文を出し (`recording.consent.text`)、承諾されるまで何も書かない
(起動ごとに聞く)。`send.url` があれば終わったときに `meta` と `episode` を multipart で送る。
store `layster.recording.active` / `layster.recording.dir`。

## 9. 確かめたこと / まだのこと

- `npm run test:perception`: 置き方 (`solver-cases.json` の 7 空間 × 5 物 = 35 の置き場所が TS と一致)・世界の状態の薄れ方・
  安全の門・Mind の返事の読み方・観測の frame
- `python/layster/` の 2 つ: 標準ライブラリのクライアントで要求と返事、WebSocket の hello → command → state → result を確かめた
- Quest 向けのビルド (C# のエラー 0、APK ができる) と、同じ作業用プロジェクトでの Virtual のビルド。XREAL One 向けは
  ビルドの画面で選べるが、まだ作っていない
- まだ無いもの: 物の `occlusion` / `grabbable` (`SpatialModel` が読むだけ)、`virtual-room` の仮の部屋、`ISpatialAnchorStore` を
  使った `keep: forever`、記録の再生、端末の中で動く Mind
- **実機では一度も動かしていない**。特に確かめたいのは: 床の高さ (Device の追跡で境界の点が取れるか)、MRUK の箱の向き
  (机の yaw・大きさの軸)、パネルの 180° と VRM の顔の向き、手の位置 (XR Hands の手のひら)、ClientWebSocket が IL2CPP で
  つながるか、確認のパネルが押せるか
