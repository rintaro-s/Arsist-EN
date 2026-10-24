/**
 * 実機のスクリプト (Jint) で使える名前の一覧。**ここが唯一の元**。
 *
 * 読む側:
 *   - エディタのスクリプトタブの「API 早見表」(ScriptEditor)
 *   - エージェント (MCP / 内蔵アシスタント) に渡す早見表 (src/main/mcp/scriptReference.ts)
 *
 * 中身は実装 (UnityBackend/.../Runtime/Scripting/*Wrapper.cs・ScriptEngineManager.cs) から写したもの。
 * ラッパーにメソッドを足したら、ここにも足す (書いていない API はエディタにもエージェントにも見えない)。
 * 拡張機能の名前 (room / hands / mic …) はここに書かず、拡張機能の README の「スクリプト」節を添える。
 */

export interface ScriptApiEntry {
  /** 呼び方 (そのまま書けば動く形) */
  sig: string;
  en: string;
  ja: string;
}

export interface ScriptApiSection {
  /** グローバルの名前 (表示の見出し) */
  name: string;
  /** 早見表の色 (エディタ用) */
  color: string;
  en: string;
  ja: string;
  entries: ScriptApiEntry[];
}

export const SCRIPT_TRIGGERS_TEXT = `A script has { name, trigger, code, enabled }. Triggers:
  { type: "onStart" }                    once when the app starts (after saved values are back, see storage)
  { type: "onUpdate" }                   every frame (keep it cheap)
  { type: "interval", value: 5000 }      every N milliseconds
  { type: "event", value: "<name>" }     when that event fires. A UI Button/Input with bindingId "x" fires "x";
                                         an Input fires "x:submit" when confirmed; extensions fire "<extension-id>:<what>";
                                         the engine fires "app:pause" / "app:resume" when the app goes to the background and back.
                                         (Or receive events inside any script with ui.on("<name>", fn).)
All scripts share one JavaScript world: a variable or function defined at the top level of one script is visible in the others.`;

export const ENGINE_SCRIPT_API: ScriptApiSection[] = [
  {
    name: 'log',
    color: '#9e9e9e',
    en: 'Logging — shows up in "npm run logs"',
    ja: 'ログ — npm run logs で見える',
    entries: [
      { sig: 'log(msg) / error(msg) / console.log(…)', en: 'Write a line to the device log', ja: '実機のログに 1 行書く' },
    ],
  },
  {
    name: 'timers',
    color: '#9e9e9e',
    en: 'Timers (like a browser)',
    ja: 'タイマー (ブラウザと同じ)',
    entries: [
      { sig: 'var t = setTimeout(fn, ms) / clearTimeout(t)', en: 'Run fn once after ms milliseconds', ja: 'ms ミリ秒後に 1 回 fn を呼ぶ' },
      { sig: 'var t = setInterval(fn, ms) / clearInterval(t)', en: 'Run fn every ms milliseconds', ja: 'ms ミリ秒ごとに fn を呼ぶ' },
    ],
  },
  {
    name: 'store',
    color: '#f4a261',
    en: 'The app\'s one value store. UI elements with bind.key = "a.b" show store "a.b" live',
    ja: 'アプリで 1 つの値の入れ物。UI の bind.key = "a.b" はストアの "a.b" をそのまま表示する',
    entries: [
      { sig: 'store.get(key) / store.set(key, value)', en: 'Read / write. Values may be numbers, text, true/false, arrays and objects. get returns a copy: after changing it, store.set it again. Keys ignore upper/lower case', ja: '読む / 書く。数・文字・真偽・配列・オブジェクトを入れられる。get は写しを返すので、変えたら store.set し直す。キーの大文字小文字は区別しない' },
      { sig: 'store.has(key) / store.remove(key) / store.clear()', en: 'Check / delete', ja: 'あるか / 消す' },
    ],
  },
  {
    name: 'storage',
    color: '#f4a261',
    en: 'Keeping store values on the device across launches. Which keys: Script tab → right panel → "Saved on the device" (project.storage.persist; "memory." = every key starting with memory.)',
    ja: 'store の値を、アプリを閉じても端末に残す。どのキーかは スクリプトタブの右パネル →「端末に保存する値」で決める (project.storage.persist。"memory." なら memory. で始まるキーすべて)',
    entries: [
      { sig: 'storage.save()', en: 'Write now (returns true/false). Normally automatic: about 1 s after a change, and when the app goes to the background', ja: '今すぐ書き出す (成否を返す)。普段は自動 (変わって約 1 秒後と、アプリが裏に回ったとき)' },
      { sig: 'storage.forget(keyOrPrefix)', en: 'Delete from the store and from the device ("memory." deletes every memory.* key)', ja: 'ストアと端末から消す ("memory." なら memory.〜 すべて)' },
      { sig: 'storage.keys([prefix])', en: 'Saved keys (an array)', ja: '保存されているキーの配列' },
      { sig: 'storage.isSaved(key)', en: 'Whether this key is kept on the device', ja: 'このキーが端末に残る指定か' },
    ],
  },
  {
    name: 'ui',
    color: '#569cd6',
    en: 'UI elements by bindingId',
    ja: 'UI の要素を bindingId で操作',
    entries: [
      { sig: 'ui.setText(bindingId, text)', en: 'Change a Text/Button\'s text (an element with "write it out" shows it letter by letter)', ja: '文字を変える (「書いていくように出す」の要素は 1 文字ずつ現れる)' },
      { sig: 'ui.setVisibility(bindingId, bool) / ui.setColor(bindingId, "#RRGGBB") / ui.setAlpha(bindingId, 0..1)', en: 'Show/hide, colour, transparency', ja: '表示・色・透明度' },
      { sig: 'ui.on(name, fn) / ui.off(name)', en: 'Receive a script event inside this script: a Button\'s bindingId ("start"), an Input/Keyboard\'s "<bindingId>:submit", an extension\'s "<id>:<what>". One script can handle every button; event-trigger scripts still run too', ja: 'スクリプトのイベントをこのスクリプトの中で受ける: ボタンの bindingId ("start")・入力やキーボードの "<bindingId>:submit"・拡張機能の "<id>:<何>"。ボタンごとにスクリプトを分けなくてよい (trigger が event のスクリプトも今までどおり動く)' },
      { sig: 'ui.triggerEvent(name)', en: 'Fire a script event', ja: 'スクリプトのイベントを鳴らす' },
    ],
  },
  {
    name: 'scene',
    color: '#4fc1ff',
    en: 'Objects in the scene, by assetId (or name). Coordinates are RUNTIME Unity world space (x = right, metres)',
    ja: 'シーンの物を assetId (か名前) で操作。座標は実行時の Unity ワールド (x = 右、メートル)',
    entries: [
      { sig: 'scene.setPosition(id, x, y, z) / scene.move(id, dx, dy, dz)', en: 'Place / shift', ja: '置く / ずらす' },
      { sig: 'scene.getPosition(id)', en: '{ x, y, z } or null', ja: '{ x, y, z }。無ければ null' },
      { sig: 'scene.moveTo(id, x, y, z[, seconds][, fn])', en: 'Glide there smoothly (default 0.5 s); fn(true) when it arrives, fn(false) if another move or setPosition replaced it', ja: 'なめらかに移動 (既定 0.5 秒)。着いたら fn(true)、別の移動や setPosition に置き換えられたら fn(false)' },
      { sig: 'scene.setRotation(id, pitch, yaw, roll) / scene.rotate(id, dp, dy, dr)', en: 'Rotation in degrees', ja: '向き (度)' },
      { sig: 'scene.rotateTo(id, pitch, yaw, roll, seconds[, fn])', en: 'Turn smoothly', ja: 'なめらかに向きを変える' },
      { sig: 'scene.faceUser(id[, seconds])', en: 'Turn (around the vertical axis) to face the user — like content placed with rotation 0, so panels read and characters look at the user', ja: 'ユーザーの方を向く (水平に回る)。回転 0 で置いた物と同じ向きなので、パネルは読め、キャラクターはこちらを向く' },
      { sig: 'scene.distanceToUser(id)', en: 'Metres from the user\'s head (-1 if there is no such object)', ja: 'ユーザーの頭からの距離 (m)。無い物は -1' },
      { sig: 'scene.setScale(id, x, y, z) / scene.setUniformScale(id, s) / scene.setVisible(id, bool) / scene.exists(id)', en: 'Size / show / exists', ja: '大きさ / 表示 / あるか' },
      { sig: 'scene.playAnimation(id, name) / scene.stopAnimation(id) / scene.setAnimationSpeed(id, s)', en: 'Animations inside a GLB model', ja: 'GLB モデルが持っているアニメーション' },
      { sig: 'scene.setBlendShapeWeight(id, name, 0..100) / scene.setBoneRotation(id, bone, p, y, r)', en: 'Blend shapes / bones of a model', ja: 'モデルのブレンドシェイプ / ボーン' },
    ],
  },
  {
    name: 'viewer',
    color: '#4fc1ff',
    en: 'The user\'s head',
    ja: 'ユーザーの頭',
    entries: [
      { sig: 'viewer.pose()', en: '{ x, y, z, yaw, pitch, forward: { x, y, z }, tracking } — where the head is and where it faces (head direction, not the eyes)', ja: '{ x, y, z, yaw, pitch, forward, tracking } — 頭の位置と向き (目の向きではない)' },
      { sig: 'viewer.isLookingAt(id[, degrees])', en: 'Whether the head points at the object (within degrees, default 15; a VRM is judged by its head)', ja: '頭がその物の方を向いているか (既定 15 度以内。VRM は頭で判定)' },
      { sig: 'viewer.placeInFront(id, metres[, faceUser]) / viewer.recenter()', en: 'Put an object in front of the user / recentre', ja: '物を目の前に置く / 正面をリセット' },
    ],
  },
  {
    name: 'vrm',
    color: '#c586c0',
    en: 'VRM characters, by assetId. Animations are the FBX files in Assets/Animations (name = file name without extension)',
    ja: 'VRM キャラクターを assetId で操作。動きは Assets/Animations の FBX (名前 = 拡張子なしのファイル名)',
    entries: [
      { sig: 'vrm.playAnimation(id, name[, { fade, then, speed }])', en: 'Switch to an animation (cross-fade, default 0.25 s). then: the animation to return to after one loop (e.g. "Idle"), or "stand" to go back to the relaxed standing pose', ja: '動きを切り替える (既定 0.25 秒で混ぜる)。then: 1 回流したあとに戻る動き (例 "Idle")。"stand" なら力を抜いた立ち姿に戻る' },
      { sig: 'vrm.stopAnimation(id)', en: 'Stop the animation and stand relaxed (arms down, swaying a little). A character with no animation playing always stands like this, never in a T-pose', ja: '動きを止めて、力を抜いて立つ (腕を下ろして少し揺れる)。動きが流れていないキャラクターはいつもこの立ち姿で、T ポーズにはならない' },
      { sig: 'vrm.animations() / vrm.currentAnimation(id)', en: 'Animation names in this app / what the character is doing', ja: 'このアプリにある動きの名前 / 今の動き' },
      { sig: 'vrm.walkTo(id, x, z[, { speed, walk, idle }][, fn(ok, reason)])', en: 'Turn and walk there on the floor (default walk "Walk", then idle "Idle"). Stops if something solid (e.g. a real table from quest-room) is in the way: fn(false, "blocked")', ja: '向きを変えて床の上をそこまで歩く (既定: 歩き "Walk"、着いたら "Idle")。本物の机など当たり判定のある物に塞がれたら止まる: fn(false, "blocked")' },
      { sig: 'vrm.turnTo(id, x, z[, seconds][, fn]) / vrm.stop(id) / vrm.isWalking(id)', en: 'Face a point / stop walking / walking now?', ja: 'その点の方を向く / 歩くのをやめる / 歩いているか' },
      { sig: 'vrm.setExpression(id, name, 0..100) / vrm.resetExpressions(id)', en: 'Facial expression, 0..100 (happy, angry, sad, relaxed, surprised, aa, ih, ou, ee, oh, blink …)', ja: '表情。0..100 (happy angry sad relaxed surprised aa ih ou ee oh blink …)' },
      { sig: 'vrm.lookAt(id, x, y, z) / vrm.clearLookAt(id) / vrm.setLookAtUser(id, "off"|"always"|"nearby")', en: 'Where the eyes and head look', ja: '目と顔を向ける先' },
      { sig: 'vrm.setBlink(id, bool) / vrm.setBreathing(id, bool)', en: 'Blinking / breathing on or off', ja: 'まばたき / 呼吸 の on/off' },
      { sig: 'vrm.setHandTarget(id, "left"|"right", x, y, z) / vrm.clearHandTarget(id, side)', en: 'Reach (point) with a hand towards a point (arm IK)', ja: '手をその点へ伸ばす (指差し。腕の IK)' },
      { sig: 'vrm.bonePosition(id, bone)', en: '{ x, y, z } of a humanoid bone (Head, LeftHand, Chest …) — e.g. to check whether the user\'s hand touches the head', ja: '人型のボーン (Head, LeftHand, Chest …) の位置。手で頭に触れたかの判定などに' },
      { sig: 'vrm.setBoneRotation(id, bone, p, y, r)', en: 'Rotate a bone directly', ja: 'ボーンを直接回す' },
    ],
  },
  {
    name: 'audio',
    color: '#ce9178',
    en: 'Playing sound and voice',
    ja: '音・声を鳴らす',
    entries: [
      { sig: 'var h = audio.play(source[, { at, volume, loop, lipSync }][, fn(ok, error)])', en: 'source: a URL, a file in the project (Assets/Audio/x.wav), or base64 audio (WAV/MP3/OGG — e.g. a text-to-speech reply from api.request with responseType "base64", or mic WAV). at: an object id — the sound comes from there; when it is a VRM its mouth moves with the voice (lipSync, default on). fn is called when it finishes', ja: 'source: URL・プロジェクトのファイル (Assets/Audio/x.wav)・base64 の音 (WAV/MP3/OGG。api.request の responseType "base64" で受けた読み上げ音声やマイクの WAV)。at: 物の id — その位置から鳴る。VRM なら声に合わせて口が動く (lipSync、既定 on)。鳴り終わったら fn' },
      { sig: 'audio.stop([h]) / audio.isPlaying([h]) / audio.setVolume(h, 0..1) / audio.level(h)', en: 'Stop (all when no h; its fn gets (false, "stopped")) / playing? / volume / current loudness 0..1', ja: '止める (h 無しで全部。fn には (false, "stopped")) / 鳴っているか / 音量 / 今の大きさ 0..1' },
    ],
  },
  {
    name: 'camera',
    color: '#ce9178',
    en: 'Pictures from the headset / phone camera (Quest 3/3S: passthrough camera, asks for permission)',
    ja: 'ヘッドセット / スマホのカメラの画 (Quest 3/3S はパススルーカメラ。許可を求める)',
    entries: [
      { sig: 'camera.available()', en: 'Whether this device can give camera pictures', ja: 'この端末でカメラの画が取れるか' },
      { sig: 'camera.capture([{ maxWidth, quality, around: { x, y, z, size } }], fn(r))', en: 'Take a still: r = { ok, image (base64 JPEG), mime, width, height, pose, region, error } (error "noCamera" / "timeout" — e.g. permission refused). around: only the part of the picture showing a square of size metres around that world point (e.g. the desk) — to send just that region to a vision API', ja: '静止画を撮る: r = { ok, image (base64 JPEG), mime, width, height, pose, region, error } (error は "noCamera" / "timeout" (許可されなかった等))。around: そのワールドの点のまわり size m 四方が写っている部分だけ (例: 机)。その部分だけを画像 API に送るときに' },
      { sig: 'camera.project(x, y, z)', en: 'Where a world point appears in the camera picture: { x, y (0..1 from the top-left), inView, ready } — ready is false until the first picture has been taken', ja: 'ワールドの点がカメラの画のどこに写るか: { x, y (左上から 0..1), inView, ready }。最初の 1 枚を撮るまでは ready が false' },
    ],
  },
  {
    name: 'api',
    color: '#4ec9b0',
    en: 'HTTP (LLM APIs, speech recognition / synthesis, your own server)',
    ja: 'HTTP (LLM の API・音声認識 / 読み上げ・自分のサーバー)',
    entries: [
      { sig: 'api.request({ url, method, headers, json | body | form, responseType, timeout }, fn(r))', en: 'Any request. json: an object sent as JSON; form: multipart fields ({ file: { base64, filename, type } } for files, e.g. speech-to-text); responseType "text" | "json" | "base64" (audio, images); timeout in seconds (default 60). r = { ok, status, text, json, base64, type, error }', ja: '何でも送る。json: JSON で送るオブジェクト / form: マルチパート ({ file: { base64, filename, type } } でファイル。音声認識など) / responseType "text" | "json" | "base64" (音声・画像) / timeout 秒 (既定 60)。r = { ok, status, text, json, base64, type, error }' },
      { sig: 'api.get(url[, headersJson], fn(text)) / api.post(url, bodyJson[, headersJson], fn(text))', en: 'Short forms; text is null on failure', ja: '短い形。失敗すると text が null' },
    ],
  },
  {
    name: 'model',
    color: '#c586c0',
    en: 'Models in the project (Models tab), run on the device',
    ja: 'プロジェクトのモデル (モデルタブ) を端末で動かす',
    entries: [
      { sig: 'model.generate(id, prompt, { onToken: function (piece, soFar) {} }, fn(r))', en: 'Text generation (LLM); r.ok, r.text', ja: '文章の生成 (LLM)。r.ok / r.text' },
      { sig: 'model.embed(id, text, fn(r)) / model.similarity(a, b) / model.classifyText(id, text, fn)', en: 'Embeddings / similarity / text classification', ja: '埋め込み / 似ている度合い / 文の分類' },
      { sig: 'model.runImage(id, fn) / model.run(id, inputs, fn)', en: 'An image model on the current camera picture / raw tensors', ja: '今のカメラの画に画像のモデル / テンソルをそのまま' },
      { sig: 'model.list() / model.info(id) / model.busy(id) / model.stop([id]) / model.tokenize(id, text) / model.detokenize(id, ids)', en: 'Housekeeping', ja: 'その他' },
    ],
  },
  {
    name: 'perception',
    color: '#4fc1ff',
    en: 'Image anchors and vision tasks (Vision tab)',
    ja: '画像アンカーと画像処理 (画像処理タブ)',
    entries: [
      { sig: 'perception.isTracked(targetId) / perception.isVisible(targetId) / perception.getPose(targetId) / perception.listTargets()', en: 'Image anchors', ja: '画像アンカー' },
      { sig: 'perception.getRegionPose(targetId, regionId)', en: 'Pose of a named region on a tracked image', ja: '追跡中の画像の上の領域の姿勢' },
      { sig: 'perception.run(taskId[, fn(r)]) / perception.value(storeAs, key) / perception.lastResult(taskId)', en: 'Run a vision task', ja: '画像処理を走らせる' },
      { sig: 'perception.gated(storeAs)', en: 'true when the last run stopped at a gate step', ja: '前回の実行が gate で止まったら true' },
    ],
  },
  {
    name: 'remote',
    color: '#9e9e9e',
    en: 'Remote control from Python',
    ja: 'Python からの遠隔操作',
    entries: [
      { sig: 'remote.startServer(port, password) / remote.stopServer() / remote.isRunning()', en: 'WebSocket control server', ja: 'WebSocket の操作サーバー' },
    ],
  },
];

export const SCRIPT_RULES_TEXT = `Rules of thumb:
  - Bind UI to the store instead of calling ui.setText in a loop: set bind.key on the element, then store.set(key, value).
  - Callbacks arrive later on the main thread; never busy-wait. One call may run at most 5 s.
  - A global of an extension that is not in a device's build is a harmless stand-in there (calls do nothing).
  - Things to remember between launches go in store keys listed in project.storage.persist (e.g. "memory.").`;

/** 早見表をテキストにする (エージェント用。英語)。 */
export function renderScriptApiText(sections: ScriptApiSection[] = ENGINE_SCRIPT_API): string {
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(`${section.name} — ${section.en}`);
    for (const entry of section.entries) lines.push(`  ${entry.sig}\n      ${entry.en}`);
  }
  return lines.join('\n');
}
