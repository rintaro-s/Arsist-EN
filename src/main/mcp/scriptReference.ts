/**
 * エージェント (MCP / 内蔵エージェント) に渡す、Arsist のスクリプトと IR の早見表。
 *
 * スクリプトの API は src/shared/scriptApi.ts (エディタのスクリプトタブの早見表と同じ元)。
 * ラッパーにメソッドを足したら、そちらに足す (書いていない API はエージェントにも人にも見えない)。
 * 拡張機能の API は、入っている拡張機能の README の「スクリプト」の節をそのまま添える (scriptReferenceFor)。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import type { ExtensionManifest } from '../../shared/extensions';
import { renderScriptApiText, SCRIPT_RULES_TEXT, SCRIPT_TRIGGERS_TEXT } from '../../shared/scriptApi';

export const ENGINE_SCRIPT_REFERENCE = [
  '# Arsist scripts (JavaScript, runs on the device with Jint — ES2020 without modules)',
  SCRIPT_TRIGGERS_TEXT,
  'Globals (all calls are synchronous unless they take a callback):',
  renderScriptApiText(),
  SCRIPT_RULES_TEXT,
].join('\n\n') + '\n';

export const IR_REFERENCE = `# Arsist project (IR) essentials

Editor coordinates (what the tools take): meters, origin = where the user's head is at app start,
+Z = straight ahead, +Y = up, +X = the user's LEFT. A panel 1.8 m ahead at eye level: { x: 0, y: 0, z: 1.8 }.
Rotation is Euler degrees. Content facing the user needs rotation { x: 0, y: 0, z: 0 }.

Scene object types: primitive (primitiveType cube|sphere|plane|cylinder|capsule), model (GLB/glTF, modelPath),
vrm, light, empty, canvas (a UI layout shown as a panel in space: canvasSettings { layoutId, widthMeters, heightMeters, pixelsPerUnit }).
assetId is how scripts address an object.
A vrm object may have character { animation, blink, breathe, lookAtUser: "off"|"always"|"nearby" } (IR v5): it then
plays that animation in a loop, blinks, breathes and looks at the user. Animations are FBX files in Assets/Animations/
(humanoid, e.g. Mixamo; walking downloaded "In Place"); the name is the file name without extension — the same name
scripts pass to vrm.playAnimation / vrm.walkTo. Without character a VRM stands still (as before v5).

UI layouts: scope "uhd" (fixed to the view) or "canvas" (placed in space through a canvas object).
Element types: Panel, Text, Button, Image, Slider, Input, Gauge, Graph, Keyboard. Elements nest (children).
Useful fields: content (text), bindingId (scripts/events: a Button fires an event with this name),
reveal { speed } (Text/Button: the text appears letter by letter, speed letters per second, whenever it changes),
bind { key, format } (shows a store value), style { width, height, fontSize, color, backgroundColor, ... }, layout FlexRow|FlexColumn|Absolute.

Saved on the device: project.storage.persist lists store keys kept across launches ("memory." = every key starting
with memory.; otherwise an exact key). Everything else in the store starts empty on each launch.

Data flow: dataSources (polling/event inputs written to the store) and transforms (store → store).

Editing the files directly (the IR is plain JSON; any agent that can edit text can use it):
- project.json — everything: settings, scripts[] (code inline), dataFlow, extensions, models, and copies of scenes[] and uiLayouts[].
- Scenes/<id>.json and UI/<id>.json — one scene / one UI layout each. Edit either copy: the editor uses the one that
  changed. A scene listed in project.json scenes[] with full content needs no Scenes/ file; a Scenes/ file whose id is not
  listed in project.json is ignored.
- The open editor reloads within about a second, keeping the user's view and selection. While a file is not valid JSON it
  keeps the last good version and reloads once it is valid again. Missing fields (transform, ids, children, style) are
  filled with defaults rather than failing. ir_validate_project lists what was filled in and which copy was used.
- Do not change irVersion. A project with an older irVersion must be upgraded in the editor first.

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
