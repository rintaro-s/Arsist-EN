# 部屋を理解する (Quest) — `quest-room`

Quest がスキャンして覚えている部屋 (壁・床・天井・机・ソファ・ベッド・棚・窓・ドア…) を
Meta の MR Utility Kit (MRUK) で読み取り、アプリから使えるようにする拡張機能。

- **本物の面に置く** — パネルや 3D の物を、本物の壁に貼る・机の上に載せる・床に立てる
- **本物の家具に当たる** — 壁・床・家具に当たり判定。落ちる物・投げた物がそこで止まる (UI を指す邪魔はしない)
- **本物の物で隠す** — 本物の机や壁の向こうに回った仮想の物 (キャラクターなど) が、その机・壁で隠れる
- **輪郭を見せる** — 認識した面の縁に線を引く。部屋が現実とずれていないかがひと目で分かる
- **場所を覚える** — `room.pin(id)` で空間アンカーを作り、次に起動しても同じ場所に戻る
- **部屋を問い合わせる** — スクリプトの `room.*`、ストアの `room.*`

## どこで動くか

`requires: { all: [cap:scene-understanding, sdk:meta-mruk] }`

- Quest (2 / 3 / 3S / Pro) 向けのビルドで、`sdk/quest/` に `com.meta.xr.mrutilitykit-*.tgz` があるとき
- それ以外 (XREAL・スマホ・MRUK を置いていない Quest) ではビルドから外れる。理由はビルドログに出る。
  同じプロジェクトはそのまま動き、パネルは作者が置いた場所に出る (面に貼られないだけ)。
  スクリプトの `room` は「何もしない代役」になり、`room.onReady(…)` の中身は実行されない (落ちない)

部屋が読めるのは、ヘッドセットで **スペースの設定 (部屋のスキャン)** が済んでいるとき。
済んでいなければ、設定 `requestSpaceSetup` が有効ならスキャン画面を開く。
初回に「空間データ」の許可を求める (断られたら `room.status` が `denied`)。

## 使い方 (エディタ)

1. 上のタブの **拡張機能** → 「部屋を理解する (Quest)」のスイッチを入れる (選ぶと設定・説明が出る)
2. 物 (例: Canvas) を選び、インスペクタ → **拡張機能** → 「本物の面に置く」を `壁` に
   - どれに置くか: `置いた方向の先にあるもの` (開始位置から、置いた場所の方を見て最初の壁) / `置いた位置にいちばん近いもの`
   - 机・床の上での向き: `立てる (こちらを向く)` / `寝かせる (机に置いた紙のように)` — 机の上に問題を「置く」ならパネルを寝かせる
   - 面からの浮かせ (m)
3. Quest 向けにビルド

向きは「作者がユーザーに対してどう向けたか」を保つ。ユーザーの正面に置いたパネルは、壁に貼っても
こちらを向く。机・床に置くときは、物の底を面に合わせ、ユーザーの方を向けて立てる。

## 設定

| 項目 | 既定 | 意味 |
|---|---|---|
| loadRoom | on | 起動したら部屋を読む (off なら `room.reload()` まで待つ) |
| requestSpaceSetup | on | 部屋が未スキャンなら、スキャン画面を開く |
| roomColliders | on | 壁・床・家具に当たり判定 (レイヤー Ignore Raycast。UI のレイには当たらない) |
| showSurfaces | off | 認識した面の輪郭を描く (壁=水色・床=緑・机=橙…) |
| occlusion | off | 本物の家具・壁が、その向こうの仮想の物を隠す (スキャンした箱の形なので縁は大まか。手や動く物では隠れない) |
| publishToStore | on | 下の `room.*` をストアに入れる |
| highFidelity | off | 斜めの天井・複数の階 (対応端末のみ。無ければ普通の部屋で読む) |

## ストア (UI の bind にそのまま使える)

| キー | 値 |
|---|---|
| `room.status` | `idle` / `permission` / `loading` / `ready` / `denied` / `noRoom` / `failed` / `noMruk` |
| `room.ready` | true / false |
| `room.detail` | 止まった理由 |
| `room.walls` / `room.tables` / `room.couches` / `room.anchors` | 数 |
| `room.width` / `room.depth` / `room.floorArea` | 床の大きさ (m / m²) |
| `room.ceilingHeight` | 天井の高さ (m) |
| `room.labels` | 見つかった面の種類 (`wall, floor, table, …`) |

## スクリプト

```js
room.onReady(function () {
  log('壁 ' + room.count('wall') + ' 枚、机 ' + room.count('table') + ' 台');

  // 今見ている壁にメモを貼り、次に起動しても同じ場所に出るようにする
  if (room.place('Memo', 'wall')) room.pin('Memo');

  // いちばん近い机の上にキャラクターを立たせる
  room.place('Avatar', 'table', 'nearest');
});

var hit = room.lookAt();          // { hit, label, x, y, z, distance, normal }
var tables = room.list('table');  // [{ label, x, y, z, width, depth, height, top, normal }]

// 机に置いた紙のように、問題のパネルを机の上に寝かせる
room.place('Quiz', 'table', 'nearest', 0.005, 'flat');

// コントローラー (quest-input) で指した床の点を「キャラクターの席」にする
var a = controller.aim('right');
var p = room.raycast(a.x, a.y, a.z, a.forward.x, a.forward.y, a.forward.z, 'floor');
if (p.hit) scene.setPosition('Sister', p.x, p.y, p.z);
```

| | |
|---|---|
| `room.status()` / `room.ready()` / `room.reload()` | 状態・読み直し |
| `room.onReady(fn)` | 使えるようになったら (もう使えるなら今すぐ) |
| `room.count(surface)` / `room.list([surface])` | 数・一覧 |
| `room.lookAt([surface])` | 今見ている先の面 |
| `room.place(id, surface[, pick[, offset[, lie]]])` | 置く。pick: `gaze` (今見ている先、既定) / `ahead` / `nearest`。lie: `upright` (既定) / `flat` (寝かせる) |
| `room.raycast(x, y, z, dx, dy, dz[, surface])` | その点からその向きに最初に当たる面 (`lookAt` と同じ形)。手・コントローラーで指した先 |
| `room.isInside()` | ユーザーが部屋の中にいるか |
| `room.pin(id[, fn(ok, detail)])` / `room.unpin(id[, fn])` / `room.pinned(id)` | 場所を覚える |

面の種類: `wall floor ceiling table couch bed storage screen door window art lamp plant other any`。
座標は実行時の Unity ワールド (`viewer.*` / `scene.*` と同じ)。
スクリプトのイベント `quest-room:ready` も鳴る (trigger `{ type: "event", value: "quest-room:ready" }`)。

## 仕組み

- `Editor/QuestRoomBuildHook.cs` — シーンに MRUK を置く。読み込みは MRUK 任せにしない
  (`LoadSceneOnStartup = false`)。World Lock は切る (OVRCameraRig を動かす仕組みで、Arsist は XR Origin を使う)
- `Runtime/QuestRoomService.cs` — 許可 → `MRUK.LoadSceneFromDevice` → 当たり判定・輪郭 → ストア → 物を置く →
  `quest-room:ready`。どこで止まっても `room.status` とログ `[Arsist:quest-room]` に理由が出る
- `Runtime/QuestRoomPins.cs` — `OVRSpatialAnchor` の保存と読み戻し。物を空間アンカーの子にはせず、
  `RoomPinFollower` が毎フレーム姿勢を写す (シーンの階層を変えない)
- `Runtime/RoomScriptApi.cs` — スクリプトの `room`
- `Runtime/Resources/ArsistQuestRoomOccluder.shader` — `occlusion` で使う「深度だけ書く」シェーダー。部屋の箱と同じ形を
  他の物より先に描き、その奥の仮想の物を隠す (パススルーの上なので、その形自体は見えない)
- `Runtime/QuestRoomSpatialProvider.cs` — Layster.Spatial のプロジェクトだけ: 部屋を世界の状態の entity にし
  (doc/20 §3)、アンカーごとの箱を `ISpatialOccluderSource` として出す。エンジンがそれを深度だけの箱にするので、
  Spatial の物の `occlusion: "auto"` は、この拡張機能の `occlusion` 設定を入れなくても効く (doc/20 §3.2)

MRUK は OVRCameraRig が無いと、部屋をワールド原点基準で置く。Arsist の XR Origin は原点にあるので
一致するはず。起動時のログ `tracking origin …, head at …` と、ずれていれば警告が出る。
`showSurfaces` を on にすると、ずれが目で見える。

## 状態

コンパイルと配線 (ビルドへの出し入れ・権限・シーンへの配置) は確認済み。
**実機での部屋の読み込み・配置・アンカーは未確認** (このリポジトリの作業では端末に入れていない)。
最初に試すときは `showSurfaces` を on にし、`npm run logs` で `[Arsist:quest-room]` を見る。
