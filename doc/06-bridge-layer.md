# Bridge Layer — `src/bridge/UnityBridge.ts` + `src/renderer/utils/uiCodeSync.ts`

Two conversion utilities that translate between the Arsist IR and other representations.

---

## `UnityBridge.ts` — IR → Unity JSON

Converts `ArsistProject` IR into the JSON formats that the Unity C# runtime (`ArsistBuildPipeline`) expects. Called by `ProjectManager.generateUnityManifest()` and directly inside `UnityBuilder.transferProjectData()`.

### Functions

#### `convertSceneToUnity(scene: SceneData): UnitySceneData`

Converts a single `SceneData` into a Unity scene descriptor.

**Output shape (`UnitySceneData`):**
```typescript
{
  id: string
  name: string
  gameObjects: UnityGameObject[]
}
```

Each `SceneObject` becomes a `UnityGameObject`:
```typescript
{
  id: string
  name: string
  type: string
  components: UnityComponent[]
  children: UnityGameObject[]
}
```

Component mapping per object type:

| IR type | Unity components added |
|---------|----------------------|
| `primitive` | `Transform`, `MeshRenderer`, `MeshFilter` (with primitive mesh name), `MaterialProperties` |
| `model` | `Transform`, `ModelLoader` (with `modelPath`) |
| `vrm` | `Transform`, `VRMLoader` (with `modelPath`), `VRMController` |
| `canvas` | `Transform`, `Canvas` (with `layoutId`, `widthMeters`, `heightMeters`, `pixelsPerUnit`) |
| `light` | `Transform`, `Light` |
| `camera` | `Transform`, `Camera` |
| `empty` | `Transform` only |

The `Transform` component always maps IR `position/rotation/scale` (Euler angles in degrees) directly to Unity component properties.

#### `convertUIToUnity(layouts: UILayoutData[]): UnityUIData`

Converts all UI layouts into a Unity UI data structure.

**Output shape (`UnityUIData`):**
```typescript
{
  layouts: UnityUILayout[]
}
```

Each `UILayoutData` becomes a `UnityUILayout`:
```typescript
{
  id: string
  name: string
  scope: 'uhd' | 'canvas'
  resolution: { width: number; height: number }
  elements: UnityUIElement[]
}
```

The `root` UIElement tree is **flattened** into a list of `UnityUIElement` objects using a depth-first traversal. Each element has a `parentId` reference instead of a nested children array.

**`UnityUIElement`:**
```typescript
{
  id: string
  parentId: string | null
  type: UIElementType
  content?: string
  bindingId?: string
  bind?: UIBinding
  layout?: string
  style: UnityUIStyle   // same keys as UIStyle, serialised for C#
}
```

#### `generateUnityManifest(project: ArsistProject): object`

Builds the top-level manifest object written to `Assets/ArsistGenerated/manifest.json`. Includes all project-level settings plus a `scenes` array (list of scene IDs with names) and the full `dataFlow` definition.

---

## `uiCodeSync.ts` — IR ↔ HTML

Provides bidirectional conversion between `UIElement` IR and HTML strings. Used by:
- `UIEditor.tsx` — when the user switches between "visual" and "code" modes
- `CodeEditor.tsx` — for displaying/editing the raw HTML representation

### `elementToHtml(element: UIElement): string`

Converts a `UIElement` (tree) to an HTML string.

- `Panel` → `<div>`
- `Text` → `<p>`
- `Button` → `<button>`
- `Image` → `<img>`
- `Slider` → `<input type="range">`
- `Input` → `<input type="text">`
- `Gauge` → `<div data-type="gauge">`
- `Graph` → `<canvas data-type="graph">`

Style is serialised to an inline CSS `style` attribute via `styleToCSS()`.

Binding data is written as `data-bind-key` and `data-bind-format` attributes. `bindingId` is written as `data-binding-id`.

`layout` is written as `data-layout` on Panel elements.

Children are recursively serialised and appended as inner HTML.

### `htmlToElement(html: string): UIElement`

Parses an HTML string (using the browser's `DOMParser`) back into a `UIElement` tree.

- Tag → UIElementType mapping is the reverse of the above
- Inline `style` attribute is parsed back to `UIStyle` via `cssToStyle()`
- `data-*` attributes restore `bind`, `bindingId`, and `layout`
- Children are recursively parsed

### `styleToCSS(style: UIStyle): string`

Serialises a `UIStyle` object to a CSS string. Key mappings:

| UIStyle field | CSS property |
|--------------|-------------|
| `width` / `height` | `width` / `height` (numbers → `px`, strings passed through) |
| `margin` / `padding` | Shorthand `{top}px {right}px {bottom}px {left}px` |
| `backgroundColor` | `background-color` |
| `borderRadius` | `border-radius` |
| `borderWidth` | `border-width` |
| `borderColor` | `border-color` |
| `fontSize` | `font-size` (→ `{n}px`) |
| `fontWeight` | `font-weight` |
| `textAlign` | `text-align` |
| `flexDirection` | `flex-direction` |
| `justifyContent` | `justify-content` |
| `alignItems` | `align-items` |
| `gap` | `gap` (→ `{n}px`) |
| `opacity` | `opacity` |
| `blur` | `filter: blur({n}px)` |
| `position`, `top/right/bottom/left` | CSS positioning properties |
| `shadow` | `box-shadow` |

### `cssToStyle(cssText: string): UIStyle`

Parses a CSS text string back to a `UIStyle` object. Handles `px` suffix stripping and shorthand expansion for `margin`/`padding`.
