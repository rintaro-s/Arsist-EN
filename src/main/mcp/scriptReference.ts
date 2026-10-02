/**
 * エージェント (MCP / 内蔵エージェント) に渡す、Arsist のスクリプトと IR の早見表。
 *
 * 中身は実装 (Runtime/Scripting/*Wrapper.cs・ScriptEngineManager.cs・src/shared/types.ts) から写したもの。
 * ラッパーにメソッドを足したら、ここにも足す (書いていない API はエージェントが使えない)。
 * 拡張機能の API は、入っている拡張機能の README の「スクリプト」の節をそのまま添える (scriptReferenceFor)。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import type { ExtensionManifest } from '../../shared/extensions';

export const ENGINE_SCRIPT_REFERENCE = `# Arsist scripts (JavaScript, runs on the device with Jint — ES2020 without modules)

A script has { name, trigger, code, enabled }. Triggers:
  { type: "onStart" }                    once when the app starts
  { type: "onUpdate" }                   every frame (keep it cheap)
  { type: "interval", value: 5000 }      every N milliseconds
  { type: "event", value: "<name>" }     when that event fires. A UI Button/Input with bindingId "x" fires "x";
                                         an Input fires "x:submit" when confirmed; extensions fire "<extension-id>:<what>".

Globals (all calls are synchronous unless they take a callback):
  log(msg) / error(msg) / console.log(...)   — shows up in "npm run logs"
  store.get(key) / store.set(key, value) / store.has(key) / store.remove(key) / store.clear()
      The one value store of the app. UI elements with bind.key = "a.b" show store "a.b" live.
  ui.setText(bindingId, text) / ui.setVisibility(bindingId, bool) / ui.setColor(bindingId, "#RRGGBB")
  ui.setAlpha(bindingId, 0..1) / ui.triggerEvent(name)
  scene.setPosition(id, x, y, z) / scene.move(id, dx, dy, dz) / scene.setRotation(id, pitch, yaw, roll)
  scene.rotate(id, dp, dy, dr) / scene.setScale(id, x, y, z) / scene.setUniformScale(id, s)
  scene.setVisible(id, bool) / scene.exists(id) / scene.getPositionX|Y|Z(id)
  scene.playAnimation(id, name) / scene.stopAnimation(id) / scene.setAnimationSpeed(id, s)
  scene.setBlendShapeWeight(id, name, 0..100) / scene.setBoneRotation(id, bone, p, y, r)
      id = the object's assetId (or its name). Coordinates here are RUNTIME Unity world space (x = right).
  viewer.placeInFront(id, distanceMeters[, faceUser]) / viewer.recenter()
  vrm.setExpression(id, name, 0..1) / vrm.resetExpressions(id) / vrm.lookAt(id, x, y, z) / vrm.clearLookAt(id)
  vrm.setBoneRotation(id, bone, p, y, r) / vrm.setHandTarget(id, "left"|"right", x, y, z) / vrm.playAnimation(id, name)
  api.get(url[, headersJson], function (text) { ... })            text is null on failure
  api.post(url, bodyJson[, headersJson], function (text) { ... })  headersJson e.g. JSON.stringify({ Authorization: "Bearer …" })
  model.list() / model.info(id) / model.busy(id) / model.stop([id])
  model.generate(id, prompt, { onToken: function (piece, textSoFar) {} }, function (r) { r.ok, r.text })
  model.embed(id, text, function (r) { r.vector }) / model.similarity(a, b) / model.classifyText(id, text, cb)
  model.run(id, inputs, cb) / model.runImage(id, cb) / model.tokenize(id, text) / model.detokenize(id, ids)
  perception.isTracked(targetId) / perception.isVisible(targetId) / perception.getPose(targetId) / perception.listTargets()
  perception.run(taskId[, function (r) { r.Ok, r.Text, r.Lines }]) / perception.value(storeAs, key) / perception.lastResult(taskId)
  remote.startServer(port, password) / remote.stopServer() / remote.isRunning()

Rules of thumb:
  - Bind UI to the store instead of calling ui.setText in a loop: set bind.key on the element, then store.set(key, value).
  - Callbacks arrive later on the main thread; never busy-wait.
  - A global of an extension that is not in a device's build is a harmless stand-in there (calls do nothing).
`;

export const IR_REFERENCE = `# Arsist project (IR) essentials

Editor coordinates (what the tools take): meters, origin = where the user's head is at app start,
+Z = straight ahead, +Y = up, +X = the user's LEFT. A panel 1.8 m ahead at eye level: { x: 0, y: 0, z: 1.8 }.
Rotation is Euler degrees. Content facing the user needs rotation { x: 0, y: 0, z: 0 }.

Scene object types: primitive (primitiveType cube|sphere|plane|cylinder|capsule), model (GLB/glTF, modelPath),
vrm, light, empty, canvas (a UI layout shown as a panel in space: canvasSettings { layoutId, widthMeters, heightMeters, pixelsPerUnit }).
assetId is how scripts address an object.

UI layouts: scope "uhd" (fixed to the view) or "canvas" (placed in space through a canvas object).
Element types: Panel, Text, Button, Image, Slider, Input, Gauge, Graph, Keyboard. Elements nest (children).
Useful fields: content (text), bindingId (scripts/events: a Button fires an event with this name),
bind { key, format } (shows a store value), style { width, height, fontSize, color, backgroundColor, ... }, layout FlexRow|FlexColumn|Absolute.

Data flow: dataSources (polling/event inputs written to the store) and transforms (store → store).

Extensions add features, devices and script globals. Enable them per project; settings live in extensions.<id>.settings,
per-object options in object.ext.<id>. A device may lack what an extension requires — the build then leaves it out.
`;

/** README の「## スクリプト」節 (次の ## まで)。無ければ null。 */
async function readmeScriptSection(dir: string): Promise<string | null> {
  try {
    const lines = (await fs.readFile(path.join(dir, 'README.md'), 'utf8')).split('\n');
    const start = lines.findIndex((l) => /^##\s*(スクリプト|Scripts?)(\s|$|\()/.test(l));
    if (start < 0) return null;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^##\s/.test(l));
    return [lines[start], ...(end < 0 ? rest : rest.slice(0, end))].join('\n').trim();
  } catch {
    return null;
  }
}

/** エンジンの早見表 + 入っている拡張機能のスクリプト API。 */
export async function scriptReferenceFor(extensions: Array<{ manifest: ExtensionManifest; dir: string }>): Promise<string> {
  const parts = [ENGINE_SCRIPT_REFERENCE, IR_REFERENCE];
  for (const { manifest, dir } of extensions) {
    const globals = manifest.script?.globals ?? [];
    if (globals.length === 0) continue;
    const section = await readmeScriptSection(dir);
    parts.push(
      `# Extension ${manifest.id} ${manifest.version} — globals: ${globals.join(', ')}\n` +
      `Runs only where it is enabled and the device fits: requires ${JSON.stringify(manifest.requires ?? {})}.\n` +
      (section ?? '(no script section in its README)'),
    );
  }
  return parts.join('\n\n');
}
