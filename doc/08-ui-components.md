# UI Components — `src/renderer/components/`

Overview of the major React components and their roles.

---

## Layout

```
App.tsx
└── <three-column layout>
    ├── LeftPanel.tsx            (hierarchy / list)
    ├── <viewport area>
    │   ├── SceneViewport.tsx    (view='scene')
    │   ├── UIEditor.tsx         (view='ui')
    │   ├── DataFlowEditor.tsx   (view='dataflow', reachable via DataFlow tab)
    │   └── ScriptEditor.tsx     (view='script')
    └── RightPanel.tsx           (inspector)
```

The viewport area is selected by `uiStore.currentView`. Dialogs float above everything and are controlled by the `show*` flags in `uiStore`.

---

## `SceneViewport.tsx`

A full-screen [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) `<Canvas>`. Reads from `projectStore` (current scene objects, selected IDs) and `uiStore` (grid, axes, transform mode).

### Scene Object Renderers

| IR type | Component used |
|---------|---------------|
| `vrm` | `VRMViewer` |
| `model` | `ModelObject` (GLB/GLTF via `useGLTF`) |
| Anything else | `SceneObjectMesh` (primitive / canvas) |

`SceneObjectMesh` creates THREE.js geometry from `primitiveType`:
- `cube` → `BoxGeometry(1,1,1)`
- `sphere` → `SphereGeometry(0.5, 32, 32)`
- `plane` → `PlaneGeometry(1,1)`
- `cylinder` → `CylinderGeometry(0.5,0.5,1,32)`
- `canvas` → `PlaneGeometry(widthMeters, heightMeters)` (teal wireframe overlay)

### Gizmos

- `TransformControls` — attached to selected object. Mode driven by `transformMode` (W/E/R keyboard shortcuts or toolbar buttons).
- `OrbitControls` — camera orbit/pan/zoom. Restrictions change per `trackingMode`: 3DoF locks distance to 2m, head-locked disables rotate.
- `GizmoHelper` (bottom-right) — orientation cube showing camera direction.

### AR Mode Guides

- `floating_screen` → translucent grey plane at `(0,0,2)` representing the 2m floating panel
- `head_locked_hud` → translucent teal plane at `(0,0,1)` representing the HUD layer
- 6DoF always shows `StartPoseMarker` (origin sphere + forward arrow + 1m scale)

---

## `UIEditor.tsx`

2-D drag-and-drop canvas for building UI layouts. Uses `useProjectStore` to read/write `UILayoutData`.

Key behaviours:
- Renders the UI element tree recursively as absolutely- or flex-positioned `<div>` elements at the layout's `resolution` aspect ratio.
- Selected element shows resize handles and a blue outline.
- Dragging moves the element (updates `style.left` / `style.top` for Absolute layouts).
- Property changes bubble up through `updateUIElement`.

---

## `UICanvas.tsx`

A read-only preview of a `UILayoutData`. Renders the element tree using the same recursive renderer as `UIEditor` but without drag interaction. Used in the preview dialog.

---

## `DataFlowEditor.tsx`

Three-column view:
- **Left column** — DataSource cards (list + add/edit/delete)
- **Middle column** — Transform cards (list + add/edit/delete)
- **Right column** — DataStore variable listing (auto-derived from DataSources and Transforms)

Editing a card opens a modal (`SourceEditModal` / `TransformEditModal`) with type-specific parameter inputs.

The DataStore column is purely informational; it shows the `storeAs` key and type for each DataSource and Transform. UI elements bind to these keys via their `bind.key` field.

---

## `ScriptEditor.tsx`

A simple code editor built around a `<textarea>` with:
- Line number gutter (synchronized scroll via shared CSS)
- Tab key → inserts two spaces
- Ctrl+S → save
- Collapsible API quick-reference (`ApiQuickRef`)
- `TriggerBadge` showing the current trigger type/value

The `ScriptInspector` (rendered in the RightPanel) shows script metadata (name, trigger type, interval value, enabled toggle, description) when a script is selected.

---

## `VRMViewer.tsx`

Uses `@pixiv/three-vrm` to load and display a VRM 3D avatar inside the SceneViewport. Handles:
- Loading `modelPath` via `fetch()` through the `arsist-file://` protocol
- Attaching `TransformControls` when selected
- Forwarding transform changes back to `updateObject`

---

## `LeftPanel.tsx`

Renders different content based on `currentView`:

| View | Content |
|------|---------|
| `scene` | Scene selector dropdown + scene object hierarchy tree |
| `ui` | UI layout tabs + UIElement tree |
| `script` | Script file list with add/delete |
| `dataflow` | DataSource + Transform lists (summary only) |

Add buttons in the toolbar use `projectStore.addObject`, `addUILayout`, `addUIElement`, `addScript`.

The model import button opens a file dialog via `window.electronAPI.fs.selectFile` filtered to `.glb,.gltf,.vrm` and then calls `window.electronAPI.assets.import`.

---

## `RightPanel.tsx`

A context-sensitive property inspector. Selects which inspector to render:

| Condition | Inspector shown |
|-----------|----------------|
| `currentView === 'scene'` and object selected | `ObjectInspector` |
| `currentView === 'scene'` and no selection | `ARSettingsInspector` |
| `currentView === 'ui'` and element selected | `UIElementInspector` |
| `currentView === 'ui'` and no selection | empty state |
| `currentView === 'dataflow'` and source selected | `DataSourceEditor` |
| `currentView === 'dataflow'` and transform selected | `TransformEditor` |
| `currentView === 'script'` | `ScriptInspector` |

### `ObjectInspector`

Three expandable sections:
1. **Transform** — position/rotation/scale (X/Y/Z inputs)
2. **Material** — color picker, metallic/roughness sliders (only for non-canvas, non-VRM types)
3. **Canvas Settings** — layoutId selector, widthMeters/heightMeters/pixelsPerUnit (only for `type === 'canvas'`)
4. **VRM** — expression list, bone list, remote control toggle (only for `type === 'vrm'`)

### `UIElementInspector`

Shows for the currently selected `UIElement`:
- Type label + ID prefix
- Text content input (Text/Button only)
- Binding ID input (for `ui.setText()` scripting)
- DataStore binding (key picker from available `storeAs` variables + optional format template)
- Element-type tips (Slider, Gauge, Graph)
- Layout selector (Panel only)
- Width/Height inputs
- Background color + text color pickers
- Font size + weight
- Border radius + opacity
- Gap (Panel only)
- Delete button

### `DataSourceEditor` / `TransformEditor`

Show type-specific parameter inputs matching the DataFlow IR fields. REST_Client shows URL+method, WebSocket_Stream shows URL, MQTT_Subscriber shows broker+topic. Transforms show expression field, clamp/remap/threshold/history parameters as applicable.

---

## Dialogs (in `components/dialogs/`)

| Dialog | Controlled by | Purpose |
|--------|--------------|---------|
| `NewProjectDialog` | `showNewProjectDialog` | Template + device picker, calls `projectStore.createProject` |
| `BuildDialog` | `showBuildDialog` | Build config (output path, dev build toggle), progress bar, log viewer, calls `unity:build` |
| `SettingsDialog` | `showSettingsDialog` | Unity path, SDK dir, recent projects |
| `MCPDialog` | `showMCPDialog` | Start/stop MCP server, copy client config JSON |
| `SetupWizard` | `showSetupWizard` | First-run guide for Unity + SDK setup |
