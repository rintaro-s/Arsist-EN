# IR Type Definitions — `src/shared/types.ts`

This file is the **single source of truth** for every data shape that flows through the system. All three processes (main, renderer, Unity via JSON) consume these structures.

---

## Top-Level Structure — `ArsistProject`

```
ArsistProject
├── id, name, version, createdAt, updatedAt
├── appType: ProjectTemplate         ('3d_ar_scene' | '2d_floating_screen' | 'head_locked_hud')
├── targetDevice: string             ('XREAL_Air2', 'Quest3', ...)
├── arSettings: ARSettings
├── designSystem: DesignSystem
├── dataFlow: DataFlowDefinition
├── scenes: SceneData[]
├── uiLayouts: UILayoutData[]
├── buildSettings: BuildSettings
└── scripts?: ScriptData[]
```

The entire project is serialised to `project.json` at the project root. Individual scenes and UI layouts are additionally written to `Scenes/<id>.json` and `UI/<id>.json` for granular diff-ability.

---

## AR Settings — `ARSettings`

| Field | Type | Purpose |
|-------|------|---------|
| `trackingMode` | `'6dof' \| '3dof' \| 'head_locked'` | 6DoF = full spatial, 3DoF = rotation only, head_locked = fixed to camera |
| `presentationMode` | `'world_anchored' \| 'floating_screen' \| 'head_locked_hud'` | How objects anchor in AR space |
| `worldScale` | number | Multiplier applied during Unity export (default 1) |
| `defaultDepth` | number | Default Z placement for floating mode |
| `floatingScreen` | object | Width/height/distance/gaze-lock for floating_screen mode |
| `enableRemoteControl` | boolean | Start WebSocket server on device for runtime control |
| `remoteControlPort` | number | WebSocket port (default 8765) |
| `remoteControlPassword` | string | Auth password for remote control (empty = no auth) |

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
  transform: Transform           // position, rotation, scale (all Vector3)
  material?: MaterialData
  children?: SceneObject[]
}
```

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
  type: UIElementType    // 'Panel' | 'Text' | 'Button' | 'Image' | 'Slider' | 'Input' | 'Gauge' | 'Graph'
  content?: string       // display text (Text / Button)
  assetPath?: string     // for Image elements
  bindingId?: string     // script-addressable ID (ui.setText(bindingId, ...))
  bind?: UIBinding       // DataStore variable binding
  layout?: 'FlexRow' | 'FlexColumn' | 'Absolute'
  style: UIStyle
  children: UIElement[]
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

**Script bundle** (`ScriptBundle`) is the export format written to `Assets/ArsistGenerated/scripts.json`:

```typescript
{
  version: '1.0',
  scripts: [{ id, trigger, code, enabled }, ...]
}
```

Scripts interact with the runtime via a sandboxed API injected by Jint:
- `api.get(url, cb)`, `api.post(url, body, cb)` — HTTP
- `ui.setText(id, text)`, `ui.setVisibility(id, bool)`, `ui.setColor(id, hex)`, `ui.setAlpha(id, 0-1)` — UI mutation
- `event.emit(name, payload)`, `event.on(name, cb)` — event bus
- `store.get(key)`, `store.set(key, value)` — persistent storage
- `log(msg)`, `error(msg)` — debug output

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

`RemoteInputSettings` enables UDP/TCP sockets inside the APK for external event injection.
