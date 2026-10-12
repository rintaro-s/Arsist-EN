# 18. キャラクター・声・カメラ・記憶 (`doc/18-characters-voice-memory.md`)

`src/shared/{scriptApi,characterChecks}.ts` ・ `src/main/project/animationAssets.ts` ・ `Runtime/VRM/ArsistCharacter.cs`
・ `Runtime/Scripting/*Wrapper.cs` ・ `Runtime/Data/ArsistPersistentStore.cs` ・ `Runtime/UI/ArsistTextReveal.cs`
・ `Editor/ArsistBuildPipeline.cs` (`ImportCharacterAnimations`)

「部屋の中にキャラクターがいて、話しかけると声で答え、見たものや出来事を次の日も覚えている」ような
アプリを、エディタの画面とスクリプトだけで組めるようにするための機能 (IR v5)。どれも特定のアプリ向けではなく、
キャラクター・音・カメラ・保存という汎用の部品として入っている。

| やりたいこと | 使うもの | エディタのどこで |
|---|---|---|
| VRM を動かす (待機・歩く・座る・手を振る…) | `Assets/Animations/*.fbx` + 物の `character` / `vrm.playAnimation` | VRM を選ぶ → インスペクタ「キャラクター」 |
| まばたき・呼吸・こちらを見る | 物の `character` (blink / breathe / lookAtUser) | 同上 |
| 歩いて移動する・向きを変える | `vrm.walkTo` / `vrm.turnTo` / `scene.moveTo` | スクリプト |
| しゃべる (読み上げの音声を鳴らし、口を動かす) | `audio.play(base64, { at: 'キャラ' })` | スクリプト |
| 聞く (音声認識) | `quest-input` の `mic.on('speechEnd')` + `api.request({ form })` | 拡張機能タブ + スクリプト |
| LLM・画像の API を呼ぶ | `api.request` (JSON / マルチパート / base64) | スクリプト |
| カメラの画を API に送る | `camera.capture({ around })` | スクリプト (カメラは自動でビルドに入る) |
| アプリを閉じても覚えている | `project.storage.persist` + `store` / `storage` | スクリプトタブの右パネル「端末に保存する値」 |
| 文字を書いていくように出す | UI 要素の `reveal { speed }` | UI タブで Text / Button を選ぶ |
| 本物の机・壁で隠す / 机に寝かせて置く | `quest-room` の `occlusion` / 物の `lie: flat` | 拡張機能タブ / インスペクタ |
| 少し後に何かする | `setTimeout` / `setInterval` | スクリプト |

スクリプトの API の一覧は `src/shared/scriptApi.ts` が唯一の元で、スクリプトタブの早見表とエージェントの早見表
(`arsist_script_reference`) の両方がそこから作られる。

## 1. キャラクターの動き

### 1.1 動きのファイル

- **人型の FBX** を `Assets/Animations/` に入れる (インスペクタの「FBX を読み込む」、エージェントなら `ir_import_animation`)。
  Mixamo なら動きを選んで **FBX / Without Skin** で落とす。**歩きは "In Place" に印を付ける** (付けなくても、
  ビルドが根元の水平移動を捨てるので前に進みはしない。移動は `vrm.walkTo` が受け持つ)。
- **ファイル名がそのまま動きの名前**になる (`Walk.fbx` → `"Walk"`)。物の `character.animation`、スクリプトの
  `vrm.playAnimation(id, 'Walk')`、Unity の AnimatorController の状態名がすべて同じ名前。だから他のアセットと違って
  ハッシュを付けずに置く (同じ名前で中身が違えば `_2`)。`src/main/project/animationAssets.ts`。
- `vrm.walkTo` は `"Walk"` で歩き、着いたら `"Idle"` に戻る (無ければ滑って動く・前の動きのまま)。
- VRMA (VRM アニメーション) は使えない: エンジン標準の UniVRM が 0.x 系で、VRMA の読み込みが無い
  (拡張機能 vrm10 の UniVRM10 には VRMA の読み込みがあるが、エンジンはまだ使っていない)。

ビルドは `Assets/ArsistProjectAssets/Animations/*.fbx` を Humanoid として取り込み (ループ・回転と高さは姿勢に焼く・
水平移動は捨てる)、`Assets/ArsistGenerated/Resources/ArsistCharacterAnimations.controller` (状態 = ファイル名、
既定は何もしない `Arsist_None`) と、名前と長さの表 `ArsistCharacterAnimationsIndex.json` を作る。設定が既に正しい
FBX は取り込み直さない (ビルドの使い回しを壊さない)。人型にならない FBX は理由を付けてログに出し、飛ばす。

名前の食い違い (物やスクリプトが、無い動きを指している) は実機では「動かない」だけなので、ビルドの最初に
`WARNING: … uses animation "…", which is not in Assets/Animations` と出す。エージェントは `ir_validate_project` で見る
(`src/shared/characterChecks.ts`)。

### 1.2 `character` (VRM の物の設定)

```json
{ "type": "vrm", "assetId": "Sister", "modelPath": "Assets/Models/sister.vrm",
  "character": { "animation": "Idle", "blink": true, "breathe": true, "lookAtUser": "nearby" } }
```

| 項目 | 意味 |
|---|---|
| `animation` | 起動したら流す動き (ループ)。空なら動かさない |
| `blink` | 2〜6 秒おきにまばたき (表情 `blink`) |
| `breathe` | 胸がわずかに上下する |
| `lookAtUser` | `off` / `always` / `nearby` (2.5 m 以内で、ユーザーの頭がこちらを向いているとき。少し余裕を持って外れる) |

**`character` が無い VRM は v4 までとまったく同じ** (立っているだけ)。古いプロジェクトをアップグレードしても補わない
(補うと、古いアプリのキャラクターがいきなり瞬きを始める)。エディタやエージェントが新しく置いた VRM には
`CHARACTER_DEFAULTS` (まばたき・呼吸・近くで見られたら見返す) が入る。

実機では読み込み後に `ArsistCharacter` (実行順 9990: Animator の後、視線・腕の IK (10000) の前) が付く。
キャラクターの正面は、VRM 0.x / 1.0 で根元の向きが 180° 違うので、両脚の付け根から求めている。

**VRM 1.0 のモデル**: エンジン標準の読み込み (UniVRM 0.x) は VRM 0.x しか読めない。VRM 1.0 は公式の拡張機能 `vrm10`
(`Extensions/vrm10`、エンジンに同梱) が「VRM の読み込み」を UniVRM 0.131.3 の UniVRM10 に置き換えて読む (doc/17 §2.6)。
VRM 0.x も読み込み時に 1.0 に変換される。人型の動きは UniVRM10 の「コントロールリグ」(正規化した骨) に当たり、
表情・まばたき・口の動き・目は拡張機能の `Vrm10Face` (`IArsistVrmFace` / `IArsistVrmEyes`) を通る。頭を向けるのは
今までどおりエンジンの `VRMLookAtController`。VRM 1.0 のモデルを置いて拡張機能が無効なら、インスペクタ
(`VrmFormatNotice`)・`ir_validate_project`・ビルドのログがそう言う。

### 1.3 スクリプトから

```js
vrm.playAnimation('Sister', 'Wave', { fade: 0.3, then: 'Idle' });   // 1 回振って待機に戻る
vrm.walkTo('Sister', 1.2, 0.8, { speed: 0.6 }, function (ok, reason) {
  if (!ok) log('止まった: ' + reason);   // blocked (本物の机などに塞がれた) / stopped / replaced
  scene.faceUser('Sister', 0.8);
});
var head = vrm.bonePosition('Sister', 'Head');   // 手で頭に触れたかの判定などに
if (viewer.isLookingAt('Sister', 15)) { … }       // 頭の向きで判定 (目の向きではない)
```

歩く道の障害物は、前方 0.3 m の高さの球で確かめる。`quest-room` の当たり判定 (Ignore Raycast レイヤー) も含む。
経路探索はしない (塞がれたら止まって `blocked` を返すので、スクリプトで別の点へ回すか、`scene.setPosition` で移す)。

## 2. 音と声

```js
// 読み上げ (OpenAI 互換の /v1/audio/speech) の WAV を、キャラクターの位置から鳴らす。口が声に合わせて動く
api.request({ url: SERVER + '/v1/audio/speech', method: 'POST', json: { model: 'tts-1', voice: 'nova', input: text, response_format: 'wav' },
              responseType: 'base64' }, function (r) {
  if (r.ok) audio.play(r.base64, { at: 'Sister' }, function () { log('言い終わった'); });
});

// 音声認識 (マルチパート)。WAV は quest-input のマイクから
mic.on('speechEnd', function (r) {
  api.request({ url: SERVER + '/v1/audio/transcriptions', method: 'POST', responseType: 'json',
                form: { model: 'whisper-1', file: { base64: r.wav, filename: 'a.wav', type: 'audio/wav' } } },
              function (res) { if (res.ok) log(res.json.text); });
});
```

- `audio.play` の source は URL・プロジェクトのファイル (`Assets/Audio/…`。ビルドが `StreamingAssets/ArsistAssets/Audio/` に
  そのまま置く)・base64 / `data:` (WAV / MP3 / OGG)。WAV は自前で読み、MP3 / OGG は一時ファイル経由で Unity に読ませる。
  止められたら fn は `(false, 'stopped')`。
- `at` が VRM なら、音はその頭から鳴り (3D)、口 (`aa`) が音量に合わせて動く (`lipSync: false` で切れる)。
- 表情の値は **0..100** (`VRMExpressionController`)。毎フレーム表情を変えるものは `VRMWrapper.setExpression` を通さない
  (1 回ごとにログを書くため)。

## 3. カメラの画を API に送る

```js
var hit = room.lookAt('table');   // ユーザーが見ている机の点
camera.capture({ maxWidth: 1024, quality: 85, around: { x: hit.x, y: hit.y, z: hit.z, size: 0.5 } }, function (shot) {
  // shot.image は JPEG の base64。その 50 cm 四方が写っている部分だけ
  api.request({ url: SERVER + '/v1/chat/completions', method: 'POST', responseType: 'json', json: { model: VISION_MODEL,
    messages: [{ role: 'user', content: [{ type: 'text', text: '…' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + shot.image } }] }] } }, function (r) { … });
});
```

- スクリプトに `camera.capture` / `camera.project` / `camera.available` / `model.runImage` が書いてあれば、プロジェクトは
  `feature:camera` を使う扱いになり、ビルドに認識の部品とカメラの許可 (Quest: `horizonos.permission.HEADSET_CAMERA`)
  が入る (画像処理タスクが無くても)。Quest 3 / 3S のパススルーカメラ。それ以外のカメラが無い端末では
  `camera.available()` が false。
- 撮れなかったときは `error` が `noCamera` (この端末・このビルドにカメラが無い) / `timeout` (10 秒。許可されなかった等)。
- `camera.project(x, y, z)` は `{ x, y (左上から 0..1), inView, ready }`。最初の 1 枚を撮るまで `ready: false`。
- `around` はワールドの点のまわり `size` m 四方が写る範囲 (カメラの内部パラメータと撮った瞬間の姿勢で求める)。
  結果の `region` は、元の画の中での切り抜き (左上から 0..1)。
  送る画を小さくでき、関係の無いもの (人の顔・他の書類) が入りにくい。送る前に何を送るかを利用者に見せること。

## 4. 端末に保存する (記憶)

`store` はアプリを閉じると消える。残したいキーを **スクリプトタブの右パネル「端末に保存する値」** (`project.storage.persist`) に書く。

| 書き方 | 残るもの |
|---|---|
| `memory.` (末尾が `.`) | `memory.` で始まるキーすべて |
| `user.name` | そのキーだけ |

- 値は数・文字・真偽・配列・オブジェクトのまま残る (`store.set('memory.episodes', [{ t, event, source }])`)。
  `store.set` は JSON の写しを入れ、`store.get` は本物の JS の配列・オブジェクトとして返す (Jint は CLR の List を
  JS の配列として見せないため)。**get の結果は写し**なので、中身を変えたら `store.set` し直す。
- キーの大文字小文字は区別しない (実機の store がそうなので、`isPersistedKey` も合わせてある)。
- UI の bind は `memory.episodes[0].event` のように、点を含むキーの中にも入れる。
- 保存のファイルが壊れていたら `.broken` として残し、何も戻さずに起動する。
- 実機は `Application.persistentDataPath/arsist-storage.json` に、変わって約 1 秒後とアプリが裏に回ったときに書く
  (一時ファイルに書いてから差し替える)。次の起動では **どのスクリプトよりも先に** 読み戻す。
- `storage.save()` (今すぐ) / `storage.forget('memory.')` (消す。記憶の削除の画面などに) / `storage.keys()` / `storage.isSaved(key)`。
- 規則は `isPersistedKey` (`src/shared/types.ts`) と実機で同じ。エディタは、スクリプトに書かれた `store.set('…')` の
  キーのうちどれが残るかを表示する。

## 5. 文字を書いていくように出す

UI タブで Text / Button を選び「書いていくように出す」(1 秒に何文字)。IR では `reveal: { speed }`。
文字が変わるたびに (ui.setText でも store の bind でも) 先頭から現れる。前の文字に書き足された (LLM の返事を少しずつ
足していく) ときは続きから。色などのタグは数えない。実機は `ArsistTextReveal` (TMP の `maxVisibleCharacters`)。

## 6. `quest-room` に足したもの

- **`occlusion`** (設定): 本物の家具・壁の箱を「深度だけ」描き、その向こうの仮想の物を隠す。スキャンした箱の形なので
  縁は大まか。手や動く物では隠れない (それには Meta の Depth API と、それに対応したシェーダーが要る。VRM の MToon は未対応)。
- **`lie`** (物ごと): 机・床の上で `upright` (立ててこちらを向く) か `flat` (机に置いた紙のように寝かせ、座った位置から
  読める向き)。`room.place(id, 'table', 'gaze', 0.005, 'flat')`。
- **`room.raycast(x, y, z, dx, dy, dz[, surface])`**: 手やコントローラーで指した先の面 (「ここが席」を決めるなど)。

## 7. その他のスクリプトの追加

- `setTimeout` / `setInterval` / `clearTimeout` / `clearInterval`
- `scene.getPosition` / `scene.moveTo` / `scene.rotateTo` / `scene.faceUser` / `scene.distanceToUser`
- `viewer.pose()` (頭の位置・向き) / `viewer.isLookingAt(id[, 度])`
- スクリプトのイベント `app:pause` / `app:resume` (アプリが裏に回った・戻った)

## 8. できないこと・確かめていないこと

- 実機 (Quest) での動作は未確認。確認済みなのはビルド (C# のコンパイル・IL2CPP) と、エディタの画面と、スクリプトの
  論理 (偽の実機 API の上で 1 セッションを流した) まで。最初に試すときは `npm run logs` で `[Arsist]` と `[ArsistJS]` を見る。
- 経路探索 (NavMesh) は無い。音声認識・読み上げ・LLM は端末の外 (同じ LAN の PC かクラウド) の API を呼ぶ。
  Quest には Android 標準の音声認識・読み上げが無い。
