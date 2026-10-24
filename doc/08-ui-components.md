# UI Components — `src/renderer/components/` (Virtual) and `src/renderer/spatial/` (Spatial)

Overview of the major React components and their roles. The editor has **two separate workspaces**, one per
Layster profile; `App.tsx` shows exactly one of them (see doc/07 for the switch).

---

## Layout (Layster.Virtual — `MainLayout.tsx`)

```
App.tsx
├── TitleBar.tsx                 (project name, Layster version, dirty / read-only marks — also for Spatial)
├── WelcomeScreen.tsx            (no project open; recent projects tagged Virtual / Spatial)
├── MainLayout.tsx               (Virtual project, appMode 'editor')
│   ├── Toolbar.tsx              (view tabs, transform mode, build …)
│   ├── panels/LeftPanel.tsx     (hierarchy / list)
│   ├── viewport/ViewportContainer.tsx
│   │   ├── SceneViewport.tsx    (view='scene'; kept mounted while other tabs are open)
│   │   ├── UIEditor.tsx         (view='ui')
│   │   ├── ScriptEditor.tsx     (view='script')
│   │   ├── VisionEditor.tsx     (view='vision' → re-exports components/vision/VisionEditor; tab hidden by default)
│   │   ├── models/ModelsWorkspace.tsx         (view='models')
│   │   └── extensions/ExtensionsWorkspace.tsx (view='extensions')
│   ├── panels/RightPanel.tsx    (inspector)
│   └── panels/BottomPanel.tsx   (console)
├── live/LiveLayoutMode.tsx      (Virtual project, appMode 'live' — a separate screen)
└── spatial/SpatialWorkspace.tsx (Spatial project — see below)
```

The viewport area is selected by `uiStore.currentView`. `vision` / `models` / `extensions` are full-width
screens (no left/right panels). Dialogs float above everything and are controlled by the `show*` flags in `uiStore`.

`viewport/DataFlowEditor.tsx` and `viewport/UICanvas.tsx` still exist but are **not mounted anywhere**, and the
`'dataflow'` view is redirected to `'ui'` — there is currently no DataFlow editing screen (agents can still use the
`ir_*_datasource` / `ir_*_transform` tools, doc/09).

---

## `SceneViewport.tsx`

A full-screen [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) `<Canvas>`. Reads from `projectStore` (current scene objects, selected IDs, perception targets) and `uiStore` (grid, axes, spawn view, transform mode).

### Scene Object Renderers

| IR type | Component used |
|---------|---------------|
| `vrm` | `VRMViewer` |
| `model` | `ModelObject` (GLB/GLTF via `GltfScene`) |
| Anything else | `SceneObjectMesh` (primitive / canvas) |

`SceneObjectMesh` creates THREE.js geometry from `primitiveType`:
- `cube` → `BoxGeometry(1,1,1)`
- `sphere` → `SphereGeometry(0.5, 32, 32)`
- `plane` → `PlaneGeometry(1,1)`
- `cylinder` → `CylinderGeometry(0.5,0.5,1,32)`
- `capsule` → `CapsuleGeometry(0.25, 0.5, 8, 16)`
- `canvas` → `PlaneGeometry(widthMeters, heightMeters)` (default 1.2 × 0.7, teal emissive)

Image anchors (`perceptionTargets`) are drawn as `AnchorPlane`s; objects anchored to them are rendered inside the
anchor's group so the gizmo edits the offset.

### Gizmos

- `SceneTransformControls` — attached to the selected object. Mode driven by `transformMode` (W/E/R keyboard shortcuts or toolbar buttons).
- `OrbitControls` — camera orbit/pan/zoom. Restrictions change per `trackingMode`: 3DoF locks distance to 2m (no pan/zoom), `head_locked` disables rotate.
- `GizmoHelper` (bottom-right) — orientation cube showing camera direction.
- Lines use `StableLine`, never drei's `<Line>` (see CLAUDE.md).

### AR Mode Guides

- `floating_screen` → grey wireframe plane (1.6 × 0.9) at `(0,0,2)`
- `head_locked_hud` → teal wireframe plane (1.2 × 0.6) at `(0,0,1)`
- `OriginAxes` (`showAxes`) and `SpawnViewMarker` (`showSpawnView`) — the user's start point and the device's field of view

---

## `UIEditor.tsx`

2-D drag-and-drop canvas for building UI layouts. Uses `useProjectStore` to read/write `UILayoutData`.

Key behaviours:
- Renders the UI element tree recursively as absolutely- or flex-positioned `<div>` elements at the layout's `resolution` aspect ratio.
- Selected element shows resize handles and a blue outline.
- Dragging moves the element (updates `style.left` / `style.top` for Absolute layouts).
- Property changes bubble up through `updateUIElement`.

---

## `ScriptEditor.tsx`

A simple code editor built around a `<textarea>` with:
- Line number gutter (`LineNumbers`)
- Tab key → inserts two spaces
- Ctrl+S → save
- Searchable API drawer (`ApiDrawer`) generated from `src/shared/scriptApi.ts` (`ENGINE_SCRIPT_API`) plus each
  enabled extension's README "スクリプト" section; click inserts the signature
- `TriggerBadge` showing the current trigger type/value

The same file exports `ScriptInspector` (rendered in the RightPanel: name, trigger type, interval, enabled toggle,
description, and `StorageSection` for `project.storage.persist`) and `ScriptFileList` (LeftPanel).

---

## `VRMViewer.tsx`

Uses `@pixiv/three-vrm` to load and display a VRM 3D avatar inside the SceneViewport. Handles:
- Resolving `modelPath` to an `arsist-file://` URL (`modelUrl.ts`) and loading/caching it (`vrmCache.ts`)
- Attaching transform controls when selected
- Forwarding transform changes back to `updateObject`

---

## `LeftPanel.tsx`

Renders different content based on `currentView`:

| View | Content |
|------|---------|
| `scene` | Scene selector + scene object hierarchy (`SceneHierarchy`) |
| `ui` | UI layout lists (UHD / canvas) + UIElement tree (`UIHierarchy`) |
| `script` | Script file list (`ScriptFileList`) |

(`DataFlowList` is defined in the file but not rendered.) Add buttons use `projectStore.addObject`, `addUILayout`, `addUIElement`, `addScript`.

Model import opens `window.electronAPI.fs.selectFile` (GLB/GLTF or VRM, separate entries) and then calls
`window.electronAPI.assets.import({ kind: 'model' })`. "Image anchor" imports a PNG/JPG as a texture, scores its
trackability and adds a perception target.

---

## `RightPanel.tsx`

A context-sensitive property inspector:

| Condition | Inspector shown |
|-----------|----------------|
| `currentView === 'scene'` and object selected | `ObjectInspector` |
| `currentView === 'scene'`, image target / vision task selected | `PerceptionTargetInspector` / `PerceptionTaskInspector` (`PerceptionInspector.tsx`) |
| `currentView === 'scene'` and no selection | `ProjectARSettings` (project settings, Python remote control, `ProjectExtensionsSection`) |
| `currentView === 'ui'` | `UIInspector` (empty state when nothing selected) |
| `currentView === 'script'` | `ScriptInspector` |

### `ObjectInspector`

Flat list:
1. **Name**, **Asset ID** (for scripting — shows `scene.setPosition(...)` / `vrm.setExpression(...)` examples)
2. **Transform** — position/rotation/scale (X/Y/Z inputs)
3. **Material** — color picker, metallic/roughness (when the object has a material)
4. **Canvas Settings** — layoutId selector, widthMeters/heightMeters/pixelsPerUnit (only for `type === 'canvas'`)
5. **VRM** — `VrmFormatNotice`, `CharacterSection` (animation, blink, breathe, lookAtUser), `VRMCapabilitiesPanel` (expressions/bones) (only for `type === 'vrm'`)
6. `ObjectAnchorSection` (attach to an image anchor) and `ObjectExtensionsSection` (`SceneObject.ext.<id>`)

### `UIInspector`

Shows for the currently selected `UIElement`:
- Type label + ID prefix
- Text content input (Text/Button only)
- Binding ID input (for `ui.setText()` scripting)
- DataStore binding (key picker from available `storeAs` variables + optional format template)
- Element-type tips (Slider, Gauge, Graph)
- For `Keyboard`: the row layout lives in `content`, the typed text goes to `bind.key`, and pressing ⏎
  fires `<bindingId>:submit` (same contract as `Input`, which opens the device keyboard instead)
- `RevealSection` (text reveal animation)
- Layout selector (Panel only)
- Width/Height inputs
- Background color + text color pickers
- Font size + weight
- Border radius + opacity
- Gap (Panel only)
- Delete button

`DataSourceEditor` / `TransformEditor` (type-specific DataFlow parameter inputs) are defined in the same file
inside `DataFlowInspector`, which is currently not rendered.

---

## Layout (Layster.Spatial — `src/renderer/spatial/`)

`SpatialWorkspace.tsx` is a separate screen (doc/19-layster.md §4), state in `useSpatialStore` (doc/07). Panel sizes
persist in electron-store `spatialLayout`. Strings live in `i18n/spatialStrings.ts`.

```
SpatialWorkspace.tsx
├── TopBar                      (name, formatLayster version, save, undo/redo, build, close)
├── Outline.tsx                 (left: things / minds / bodies / rules / scripts / recording / settings / test spaces)
├── lab/SpaceLab.tsx            (centre: the test space in 3D + how each thing is placed — solver.ts via useSolve.ts;
│                                SpaceStrip, ThingMeshes, EntityBoxes, UserRig, BodyWorkspaces)
│   or inspector/ScriptInspector ScriptPane (when a script is selected)
├── inspector/Inspector.tsx     (right: Thing / Mind / Body / Rule / Script / Recording / Settings / Spaces inspectors,
│                                PlacementEditor, ActionEditor, VisualEditor)
├── bottom/BottomPanel.tsx      (World table / Mind I/O ("try Mind" via spatial:try-mind) / Problems from validate.ts)
└── SpatialBuildDialog.tsx      (device, output, dev build → spatial:build; progress and log arrive on the
                                 same unity:build-progress / unity:build-log events; blocked while there are errors)
```

`NewSpatialForm.tsx` is the Spatial branch of `NewProjectDialog`; `openProject.ts` opens a folder as Virtual or Spatial.

---

## Dialogs (in `components/dialogs/`)

| Dialog | Controlled by | Purpose |
|--------|--------------|---------|
| `NewProjectDialog` | `showNewProjectDialog` | First picks Layster.Virtual or Layster.Spatial; Virtual: template + device picker → `projectStore.createProject`; Spatial: `NewSpatialForm` |
| `BuildDialog` | `showBuildDialog` | Virtual build: device, output path, dev/clean build, progress bar, log viewer, `unity:build`, adb install (doc/04) |
| `SettingsDialog` | `showSettingsDialog` | Unity path, SDK dir, output dir, license file, language, theme, models (Vision tab, Hugging Face token) … |
| `PreviewDialog` | `showPreviewDialog` | UI preview with the DataStore context |
| `MCPDialog` | `showMCPDialog` | Register/unregister Arsist in external agents' settings, self-test (doc/09) |
| `SetupWizard` | `showSetupWizard` | First-run guide for Unity + SDK setup |
| `IrUpgradeDialog` | `projectStore.showIrUpgrade` | Offer to upgrade an older Layster.Virtual project (read-only until accepted) |
| `MissingRequirementsDialog` | `projectStore.missingRequirements` | Project needs an extension/device this editor lacks → import `.arsist` / folder |
| `ErrorDialog` | `BuildDialog` | Shows a build error in full |

Also mounted by `App.tsx`: `ai/AssistantPanel` (`showAssistant`), `ai/ExternalChangeBanner` (`projectStore.externalChange`),
`PackageResultDialog` (`ai/packageActions`, `.arsist` project packages). `models/HuggingFaceDialog` is opened from the Models tab.

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
