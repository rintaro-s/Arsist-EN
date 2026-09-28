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
- For `Keyboard`: the row layout lives in `content`, the typed text goes to `bind.key`, and pressing ⏎
  fires `<bindingId>:submit` (same contract as `Input`, which opens the device keyboard instead)
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

## 「幅 100%」と、親が並べる係のとき

`FlexRow` / `FlexColumn` の親には Unity の LayoutGroup が付く。LayoutGroup は**子のアンカーを左上に固定する**ので、
「幅 100%」をアンカーの引き伸ばしで表していると、その子だけ幅が 0 になって消える
(`childControlWidth = false` なので、代わりの大きさも入らない)。

そのため `ApplyRectTransformStyle` は、親が LayoutGroup を持つときだけ、100% を**親の内側の実寸**に直して
入れる (`ParentControlsLayout`)。ビルドログに出る:

```
[Arsist] RectTransform inside a layout: size=(1636,380) (100% resolved against the parent, …)
```

2026-09 に、この抜けでチャット画面の答えの欄・入力欄・キーボードが実機で 3 つとも見えなくなった。
見出しだけが出ていたのは、そこだけ幅が auto だったため。

## UI の当たり判定は長方形で見る (コライダーではない)

レイ (視線・コントローラー・手) が UI に当たったかどうかは、`Runtime/UI/ArsistUiPointer.cs` が
**RectTransform の長方形そのもの**に当てて判定する。Canvas に登録されている Graphic のうち
`raycastTarget` が立っているものを見て、レイと面の交点が長方形の中かを調べるだけ。

以前は要素に貼った BoxCollider に任せていたが、これは壊れやすかった:

- コライダーの大きさはビルド時に決まるのに、RectTransform の実寸はレイアウトが走るまで決まらない。
  「幅 100%」のような要素では、当たり判定だけ 0 のまま残る。
- ボタンとスライダーにしか貼っていない。パネルや、実行時に作ったキーには無い。

実機での症状は「レイは見えているのに UI の上で止まらず素通りする」で、エディタでは分からない
(2026-09 に踏んだ)。3D の物は今までどおり `Physics.Raycast` で見て、近い方を採る。

**同じ板の上に重なっているものは、距離では決められない。** パネルとその上のボタン・キーは、
レイから見て**同じ距離**にある。距離だけで比べると、先に見つかった方 (登録が先の親のパネル) が勝ち、
キーには一生当たらない。実機では「輪は出るのに、トリガーを引いても何も起きない」という形で出る
(2026-09 に踏んだ)。5 mm 以内の差は同じ面とみなし、`Graphic.depth` が大きい方 ＝ 手前に描かれている方を採る。

## UHD と、空間に置く Canvas

UI レイアウトには 2 つの置き方がある (`uiLayouts[].scope`):

| scope | 置き方 | 作られ方 |
|---|---|---|
| `uhd` | **頭に固定**。常に視界の同じ位置 | `GenerateCanvasUI` が専用カメラ (`ArsistHUD` レイヤー) で手前に描く |
| `canvas` | **空間に置く**。その場に留まり、近づける・覗ける | シーンの `canvas` オブジェクト (`canvasSettings.layoutId` で結ぶ) |

空間に置くときの目安 (**原点 = 起動時のユーザーの視点**。`doc/12` の座標の約束):

```jsonc
"transform": { "position": { "x": 0, "y": -0.05, "z": 1.8 } },   // 目の高さの少し下、1.8m 先
"canvasSettings": { "widthMeters": 1.6, "heightMeters": 0.9, "pixelsPerUnit": 1200 }
```

**`widthMeters × pixelsPerUnit` が Canvas の画素数**になる。下書きが 1920×1080 なら
1.6m × 1200 = 1920 ✓ のように合わせること。小さいと、置いた要素が板からはみ出す。

常時表示の UI が 1 つも無いプロジェクトでは「HUD initialized」の板が出る (動いていることの確認用)。
空間に置く Canvas を持つプロジェクトでは邪魔なだけなので出さない。

## 実行時に作った UI は、レイヤーを親に合わせる

常時表示の UI (UHD) は**専用レイヤー + 専用カメラ**で描いている (`GenerateCanvasUI`):

| カメラ | 何を描くか |
|---|---|
| メインカメラ | `ArsistHUD` レイヤーを**描かない** (`ExcludeHudLayerFromMainCamera`) |
| UI カメラ | `ArsistHUD` **だけ**を描く。`depth = 100` で後から、深度を消して描く (常に手前) |

ビルド時に作る要素は Canvas ごとこのレイヤーに揃えている (`SetLayerRecursively`)。
ところが **`new GameObject()` は親のレイヤーを継がない** (必ず `Default` になる)。
そのため実行時に作った UI は:

1. メインカメラ側 (Default) に描かれ、
2. そのあと UI カメラが深度を消して HUD を描くので、**上から塗り潰されて消える**。

当たり判定 (`ArsistUiPointer`) はレイヤーを見ないので、**押せるのに見えない**という形で出る。
エディタのプレビューでは分からない (2026-09 に踏んだ: キーボードのキーが実機で出ない。
`ArsistVirtualKeyboard` のキーと、`ArsistTextEntry` が出すキーボードの板が両方これだった)。

実行時に UI を作るときは `Runtime/UI/ArsistUiLayers.cs` を通す:

```csharp
var go = ArsistUiLayers.CreateChild("Key a", parent);   // 親のレイヤーを継ぐ
ArsistUiLayers.MatchParent(gameObject, transform.parent); // 作り終わったあとに揃え直す
```

実機のログで確かめられる:

```
[Arsist] Keyboard ready: 47 keys, 1766x432, layer=ArsistHUD, font=LiberationSans SDF
[Arsist] Text entry: showing the in-app keyboard (1766x432, layer=ArsistHUD).
```

`layer=Default` と出ていたら、それは見えない。

**入り口は端末ごとでも、判定は 1 つ。** `ArsistUiPointer.RaycastScene` を、コントローラーのレイ
(`XROriginSetup`)・視線 (`ArsistGazeInput`)・ハンドトラッキング (`ArsistHandInteraction`) が全部使う。
どれか 1 つだけを直すと、同じプロジェクトが端末によって押せたり押せなかったりする。


## 文字の折り返し (TMP)

`AddComponent<TextMeshProUGUI>()` で足した文字は、**折り返しが切れた状態で入る**。
そのままだと 1 行のまま横に伸び続け、実機では「改行せず端まで出ていく」という形で出る
(2026-09 に踏んだ)。ビルド時に必ず立てる:

```csharp
tmp.textWrappingMode = TextWrappingModes.Normal;
tmp.alignment = TextAlignmentOptions.TopLeft;   // 縦は上そろえ (エディタのプレビューと同じ)
```

**折り返しには禁則処理の表が要る。** TMP は折り返す位置を決めるのに 2 つの文字表
(行末に置けない文字 / 行頭に置けない文字) を読む。TMP Essential Resources を取り込んでいない
プロジェクトでは未設定で、折り返しを有効にすると

```
The variable m_leadingCharacters of TMP_Settings has not been assigned.
```

でビルドが止まる。`EnsureTmpLineBreakingRules()` が Unity 同梱と同じ内容の表を
`Assets/Resources/` に書いて TMP Settings に割り当てる。**UI を作る前** (Phase 1 の頭) に
呼ぶこと。TMP は文字を並べる時点で読むので、後から用意しても間に合わない。
これで「、」「。」が行頭に来ない、括弧が行末で切れない、といった日本語の折り返しになる。
