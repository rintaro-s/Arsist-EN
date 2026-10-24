# IR Type Definitions — `src/shared/types.ts`

The IR is called **Layster** and has two incompatible profiles ([19-layster.md](19-layster.md)). This file
describes **Layster.Virtual** — the `project.json` format — whose types live in `src/shared/types.ts`, the
**single source of truth** for that format. Main, renderer and (via the generated JSON) Unity all consume these
structures. **Layster.Spatial** (`project.spatial.json`) has its own types; see the last section.

---

## Version and header

| Field | Meaning |
|-------|---------|
| `irVersion` | Integer format version, `CURRENT_IR_VERSION` in `src/shared/irVersion.ts` (now **6**). 1–5 = **α1–α5**, 6 = **Layster.Virtual β 1.0.0**. Missing = 1. Older projects are migrated in memory and open read-only until the user accepts the upgrade; newer ones do not open (`doc/03`, `doc/15` §3) |
| `layster` | Header `{ profile: 'virtual', stage: 'beta', version: '1.0.0' }` (`LaysterHeader`, `src/shared/layster/version.ts`). Written first in the file by `migrateProject`; informational — the version decision uses `irVersion` |
| `version` | The **app's** version, chosen by the user. Not the IR version |

Show versions to people only through `formatLayster` / `describeVirtualIrVersion` ("Layster.Virtual α5"), never "IR v5".

---

## Top-Level Structure — `ArsistProject`

```
ArsistProject
├── layster?: LaysterHeader           (β 1.0.0〜)
├── id, name, version, irVersion?, createdAt, updatedAt
├── appType: ProjectTemplate         ('3d_ar_scene' | '2d_floating_screen' | 'head_locked_hud')
├── targetDevice: string             adapter folder name: 'XREAL_One' | 'Meta_Quest' | 'Android_Phone' | an extension's device
├── arSettings: ARSettings
├── designSystem: DesignSystem
├── dataFlow: DataFlowDefinition
├── scenes: SceneData[]
├── uiLayouts: UILayoutData[]
├── buildSettings: BuildSettings
├── scripts?: ScriptData[]
├── perception?: PerceptionSettings   (画像アンカー・画像処理タスク)
├── models?: ModelDefinition[]        (ONNX, α2〜; use image/text/tensor α3〜 — doc/15, doc/16)
├── extensions?: Record<id, ProjectExtensionState>   (有効にした拡張機能と設定, α4〜 — doc/17)
└── storage?: { persist: string[] }   (端末に保存する store のキー, α5〜 — doc/18)
```

The entire project is serialised to `project.json` at the project root. Scenes and UI layouts are **also** written
to `Scenes/<id>.json` and `UI/<id>.json`; when only one copy is changed outside the editor, the changed copy wins
(`src/main/project/sceneCopies.ts`, `doc/03`). Missing fields in scenes/layouts are filled in by
`src/shared/irRepair.ts` instead of crashing the view.

---

## AR Settings — `ARSettings`

| Field | Type | Purpose |
|-------|------|---------|
| `trackingMode` | `'6dof' \| '3dof' \| 'head_locked'` | 6DoF = full spatial, 3DoF = rotation only, head_locked = fixed to camera |
| `presentationMode` | `'world_anchored' \| 'floating_screen' \| 'head_locked_hud'` | How objects anchor in AR space |
| `worldScale` | number | Default 1. Carried into the manifest, but currently not read by the Unity build/runtime |
| `defaultDepth` | number | Default Z placement; also how far the editor draws the spawn-view frustum |
| `floatingScreen` | object | Width/height/distance/gaze-lock for floating_screen mode |
| `enableRemoteControl` | boolean | Start WebSocket server on device for runtime control |
| `remoteControlPort` | number | WebSocket port (default 8765) |
| `remoteControlPassword` | string | Auth password for remote control (empty = no auth) |
| `backgroundMode` | `'passthrough' \| 'skybox' \| 'solidColor'` | How the camera clears the background (default `passthrough`). Only meaningful on video see-through headsets (Quest); optical see-through glasses (XREAL) are always passthrough because black is transparent in hardware. |
| `backgroundColor` | string | `#RRGGBB` used when `backgroundMode === 'solidColor'` (default `#000000`) |
| `interaction` | `InteractionSettings` | `{ controllerRay, handTracking, gazeDwellSeconds?, textInput? }` (default ray on, hands off). Both `controllerRay` and `handTracking` off is rejected at build time. `textInput`: `'auto' \| 'device' \| 'inApp'` |
| `phone` | `PhoneSettings` | For `Android_Phone`: `stereo`, `cameraFov` (default 63), `orientation`. AR vs VR follows `backgroundMode` |
| `logRelay` | `{ enabled, port? }` | LAN log relay to the build machine (default on, port 9770 — `doc/13`) |

`trackingMode` is read by the XREAL patcher (initial XREAL tracking type); `presentationMode` /
`floatingScreen.distance` by `ArsistBuildPipeline` for HUD placement.

---

## DataFlow — Three-Layer Pipeline

```
DataSourceDefinition
    └── DataStore key (storeAs)
            │
            ▼
TransformDefinition (reads one or more DataStore keys, writes result)
            │
            ▼
        UIBinding (UI element reads a DataStore key)
```

### `DataSourceDefinition`

```typescript
{
  id: string
  type: DataSourceType      // see below
  mode: 'polling' | 'event'
  storeAs: string           // DataStore variable name
  updateRate?: number       // Hz, polling only
  parameters?: Record<string, unknown>  // type-specific config
}
```

**DataSourceType values:**

| Value | Description |
|-------|-------------|
| `XR_Tracker` | 6DoF pose from XR system |
| `XR_HandPose` | Hand skeleton |
| `Device_Status` | Battery, connectivity info |
| `Location_Provider` | GPS coordinates |
| `REST_Client` | HTTP GET/POST with polling |
| `WebSocket_Stream` | Real-time event stream |
| `MQTT_Subscriber` | MQTT topic subscription |
| `System_Clock` | Local time/date |
| `Voice_Recognition` | Speech-to-text |
| `Microphone_Level` | Audio input level |

### `TransformDefinition`

```typescript
{
  id: string
  type: TransformType       // see below
  inputs: string[]          // DataStore keys to read
  storeAs: string           // DataStore key to write
  expression?: string       // Used by Formula / String_Template
  updateRate?: number       // Hz
  parameters?: Record<string, unknown>
}
```

**TransformType values:**

| Value | Description | Key parameters |
|-------|-------------|----------------|
| `Formula` | Math expression (`val * 1.8 + 32`) | `expression` |
| `Clamper` | Clamp to [min, max] | `parameters.min`, `parameters.max` |
| `Remap` | Map input range to output range | `inputMin/Max`, `outputMin/Max` |
| `Smoother` | Low-pass filter | — |
| `Comparator` | Compare two values → bool | — |
| `Threshold` | Boolean threshold on single value | `parameters.threshold` |
| `State_Mapper` | Map discrete values to labels | — |
| `String_Template` | Template string (`{val} km/h`) | `expression` |
| `Time_Formatter` | Format timestamps | — |
| `History_Buffer` | Ring buffer of past values (for Graph elements) | `parameters.size` |
| `Accumulator` | Running sum | — |

---

## Scene Data

```
SceneData
├── id, name
└── objects: SceneObject[]
```

### Coordinate system — the origin *is* the user

Scene coordinates are **user-relative**, not floor-relative:

| | Editor viewport (IR) | Unity world |
|---|---|---|
| origin `(0,0,0)` | the user's spawn viewpoint (eye level, session start) | XR Origin |
| `Z+` | forward (what the user faces) | forward — unchanged |
| `X+` | the user's **left** | right — **negated on export** (`x → -x`) |
| `Y+` | up | up — unchanged |

The conversion (`x → -x`, rotation mirrored about X) lives in `CreateGameObject` in
[ArsistBuildPipeline.cs](../UnityBackend/ArsistBuilder/Assets/Arsist/Editor/ArsistBuildPipeline.cs).

For "origin = the user's eye" to hold on device, `ConfigureXROriginComponent` pins
`XROrigin.RequestedTrackingOriginMode = Device` and `CameraYOffset = 0` (`PinSpawnViewpointToOrigin`).
Left at the XR default (`NotSpecified`) the height is device-dependent and matches neither the editor nor the
other device — see the note in [CODEMAP.md](../CODEMAP.md).

The scene viewport draws this spawn viewpoint (marker + forward arrow + the device's FOV frustum out to
`arSettings.defaultDepth`); toggle it from the toolbar.

### `SceneObject`

```typescript
{
  id: string
  name: string
  type: SceneObjectType          // 'primitive' | 'model' | 'vrm' | 'light' | 'camera' | 'empty' | 'canvas'
  primitiveType?: 'cube' | 'sphere' | 'plane' | 'cylinder' | 'capsule'
  modelPath?: string             // relative path inside project Assets/
  assetId?: string               // script-addressable ID
  canvasSettings?: CanvasSettings  // only when type === 'canvas'
  anchor?: ObjectAnchor          // pinned to an image target (see Perception below)
  transform: Transform           // position, rotation, scale (all Vector3)
  material?: MaterialData        // color, metallic, roughness, texture, emissive, emissiveIntensity
  children?: SceneObject[]
  ext?: Record<extId, Record<string, unknown>>   // per-object extension options (α4〜, doc/17)
  character?: CharacterSettings  // type === 'vrm' only (α5〜): { animation?, blink?, breathe?, lookAtUser? } (doc/18)
}
```

A VRM without `character` stands still (relaxed standing pose, never a T-pose); a VRM newly placed in the editor
gets `CHARACTER_DEFAULTS` (`blink`, `breathe`, `lookAtUser: 'nearby'`).

**`CanvasSettings`** — when a SceneObject is type `canvas`, it renders a UILayout into 3D space:

```typescript
{
  layoutId: string     // UILayoutData.id to render
  widthMeters: number  // physical width in 3D space
  heightMeters: number
  pixelsPerUnit: number
}
```

---

## Perception — image anchors

The first IR construct whose pose is **not** authored: it comes from the real world at runtime.
Full design in [11-perception.md](11-perception.md).

```
ArsistProject.perception?: { targets: PerceptionTarget[] }

PerceptionTarget
├── id, name
├── type: 'image'            (future: 'plane' | 'objectClass')
├── imagePath                reference photo, project-relative
├── physicalWidth            real-world width in metres — REQUIRED, scale is unrecoverable from a photo
├── physicalHeight?          metres; omitted = derived from the photo's aspect ratio
├── holdMs?                  how long an anchor counts as "visible" after leaving view (default 2000)
└── quality?                 editor-computed trackability 0-100, advisory only
```

A `SceneObject` joins a target through `anchor`:

```
SceneObject.anchor?: {
  targetId,
  whenNotFound: 'hidden' | 'lastKnown' | 'visible',
  placement?: AnchorPlacement,          // 「その物の右に10cm」
}

AnchorPlacement
├── regionId?          基準にする枠。省略 = 写真全体
├── side               center | left | right | above | below | front | behind
├── gap                縁からの間隔 (m)
├── align              near (縁から縁まで) | center
├── cross              start | center | end   縁に沿った揃え
└── facing             user (常に正面を向く) | target
```

**When `anchor` is present, `transform` changes meaning**: it is no longer an absolute pose but an
offset in the target's frame (`+X` printed right, `+Y` up, `+Z` out of the surface). Everything else
about the object — material, children, `assetId`, scripting — is unchanged, and it still goes through
the same `x → -x` export mirror as every other object.

`placement` と `transform` は合成される: placement が実寸から基準姿勢を決め、`transform` が
その上の微調整になる（ギズモで動かすと `transform` が変わる）。生の座標だけだと、ターゲットか
オブジェクトの大きさが変わった瞬間に「横に並ぶ」という意図が失われる。

### 枠と、枠に対する処理

```
PerceptionTarget.regions?: PerceptionRegion[]
PerceptionRegion { id, name, rect }        rect は 0..1、原点は写真の左下

ArsistProject.perception.tasks?: PerceptionTask[]
PerceptionTask
├── type       'ocr' | 'capture' | 'vision'
├── source     { kind:'region', targetId, regionId } | { kind:'viewport', rect }
├── trigger    ScriptTrigger (onStart / interval / event) または { type:'manual' }
├── storeAs    DataStore キー。UI の bind から <storeAs>.text / .status が読める
├── engine?    { kind:'mlkit'|'mock', script?:'latin'|'japanese', mockText? }
└── pipeline?  type === 'vision' のときの VisionPipeline (doc/14)。`infer` op は ArsistProject.models を参照する (doc/15)

VisionPipeline
├── maxWidth   処理前に縮める幅
├── ops[]      { id, op, in?, out, params?, disabled? }   disabled = 素通し (入出力の型が同じ op だけ)
└── outputs[]  store (DataStore へ) | world (現実に重ねる) | anchor (見つけた物の位置に札 / オブジェクト) | image (Canvas へ)

ArsistProject.models?: ModelDefinition[]      学習済みモデル (ONNX) の定義。重みは Assets/Models/*.onnx のまま (doc/15)
ArsistProject.irVersion?: number              この形式の版。無ければ 1。古い版は開くときに移行を提案する (doc/15 §3)
```

`region` 指定は「追跡中のターゲット上の枠」なので、斜めから見ていてもランタイムが正対に
起こしてから読む。`viewport` は「カメラ画像そのものの矩形」で、ターゲットを必要としない。

Targets are referenced across scenes, which is why they live on the project rather than inside
`SceneData`. Deleting a target strips `anchor` from every object that referenced it
(`removePerceptionTarget` in `projectStore`), because an anchor pointing at nothing builds fine and
then never appears at runtime.

## UI Layout Data

```
UILayoutData
├── id, name
├── scope: 'uhd' | 'canvas'   // uhd = always-on-top HUD, canvas = 3D surface
├── resolution: { width, height }
└── root: UIElement            // tree root (always a Panel)
```

### `UIElement`

```typescript
{
  id: string
  type: UIElementType    // 'Panel' | 'Text' | 'Button' | 'Image' | 'Slider' | 'Input' | 'Keyboard' | 'Gauge' | 'Graph'
                         //   Input    = 端末のキーボード (Quest のシステムキーボード)。かな漢字変換が使える
                         //   Keyboard = アプリの中に出すキーボード (ArsistVirtualKeyboard)。どの端末でも同じ。英数字のみ
                         //     打った文字 → bind.key、確定 (⏎) → イベント "<bindingId>:submit"、content にキーの並び
  content?: string       // display text (Text / Button)
  assetPath?: string     // for Image elements
  bindingId?: string     // script-addressable ID (ui.setText(bindingId, ...))
  bind?: UIBinding       // DataStore variable binding
  layout?: 'FlexRow' | 'FlexColumn' | 'Absolute'
  style: UIStyle
  children: UIElement[]
  reveal?: { speed: number }  // Text / Button: write the text out letter by letter (chars/s, α5〜)
}
```

**`UIBinding`:**
```typescript
{
  key: string      // DataStore variable name
  format?: string  // display template, e.g. "{value} km/h"
}
```

### `UIStyle` (abridged)

Key style fields that map to CSS and Unity UI properties:

| Category | Fields |
|----------|--------|
| Size | `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight` |
| Spacing | `margin: Spacing`, `padding: Spacing` |
| Flex | `flexDirection`, `justifyContent`, `alignItems`, `gap` |
| Visual | `backgroundColor`, `color`, `borderRadius`, `borderWidth`, `borderColor`, `opacity`, `blur` |
| Text | `fontSize`, `fontWeight`, `textAlign` |
| Position | `position`, `top`, `right`, `bottom`, `left` |
| Shadow | `shadow: ShadowStyle` |

---

## Script System

```
ScriptData
├── id, name, description
├── trigger: ScriptTrigger    // { type: ScriptTriggerType, value? }
├── code: string              // raw JavaScript (executed by Jint in Unity)
├── enabled: boolean
└── createdAt, updatedAt
```

**Trigger types:**

| Type | Fires when | `value` meaning |
|------|-----------|-----------------|
| `onStart` | Once at AR session start | — |
| `onUpdate` | Every frame | — |
| `interval` | On a timer | Milliseconds between executions |
| `event` | A named event is emitted | Event name string |

**Script bundle** (`ScriptBundle`) is the export format written to `Assets/ArsistGenerated/scripts.json`
(only enabled scripts):

```typescript
{
  version: '1.0',
  scripts: [{ id, trigger, code, enabled }, ...],
  storage?: { persist: string[] }   // project.storage; read by ArsistPersistentStore before scripts run
}
```

All scripts share one JavaScript world. The globals they can use (`log`, timers, `store`, `storage`, `ui`,
`scene`, `viewer`, `vrm`, `audio`, `camera`, `api`, `model`, `perception`, `remote`) are listed **once**, in
[src/shared/scriptApi.ts](../src/shared/scriptApi.ts) — the Script tab's reference and the agents' reference are
both generated from it. A few examples:
- `store.get(key)` / `store.set(key, value)` — the one DataStore (UI `bind.key` shows the same slot)
- `ui.setText(bindingId, text)`, `ui.on(eventName, fn)`, `ui.triggerEvent(name)` — UI and script events
- `api.request({...}, fn)`, `api.get(url[, headersJson], fn)` — HTTP
- `log(msg)` / `error(msg)` — device log (`npm run logs`)

`storage.*` keeps the keys listed in `project.storage.persist` on the device (`'memory.'` = prefix match;
`isPersistedKey` in `types.ts` and the runtime must agree). Extension globals are documented in each extension's README.

---

## Build Settings

```typescript
BuildSettings {
  packageName: string      // Android package name (com.example.app)
  version: string          // semantic version string
  versionCode: number      // Android versionCode integer
  minSdkVersion: number    // Android API level minimum
  targetSdkVersion: number
  remoteInput?: RemoteInputSettings
}
```

`RemoteInputSettings` (`{ udp?: { enabled, port }, tcp?: { enabled, port }, allowedEvents? }`, new projects:
UDP 19100 / TCP 19101) configures UDP/TCP sockets inside the APK for external event injection
(`Runtime/RemoteInput/ArsistRemoteInputBehaviour.cs`).

---

## Layster.Spatial types (not this file)

`project.spatial.json` is a different format with no converter to or from `ArsistProject`. Its types are
`SpatialProject` in [src/shared/layster/spatial/types.ts](../src/shared/layster/spatial/types.ts):

```
SpatialProject
├── layster: { profile: 'spatial', stage: 'beta', version: '1.0.0' }
├── id, name, version, createdAt, updatedAt, targetDevice
├── app, presentation, interaction
├── things[]      what to show, placed by conditions + fallbacks (no coordinates)
├── minds[]       AI endpoints (observe → actions)
├── bodies[]      real bodies (robots) behind a safety gate
├── rules[], scripts[]
├── memory: { persist }, recording
├── spaces: { use }   test spaces for the editor (built-in + spaces/*.json)
├── models[], extensions   (same definitions as Virtual)
```

Spec: [19-layster.md](19-layster.md) §3; runtime: [20-spatial-runtime.md](20-spatial-runtime.md). At build time
`src/shared/layster/spatial/lower.ts` turns it into an internal `ArsistProject` (for the shared manifest) plus
`spatial.json`.
