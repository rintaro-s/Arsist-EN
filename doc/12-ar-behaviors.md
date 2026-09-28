# AR Behaviors — spatial placement + perception tasks (`doc/12-ar-behaviors.md`)

> **Status: implemented.** Phases 0–3 are done; see §8 for what is and is not covered.
>
> Two capabilities, one architecture:
>
> 1. **Placement** — *"show this Canvas 10 cm to the right of the thing in that photo."*
> 2. **Perception tasks** — *"when this button is pressed, OCR the text inside that frame."*
>
> The geometry that neither the Unity build nor the device can check for you — placement arithmetic and
> region rectification — is covered by `npm test` (`src/shared/placement.test.ts`) and
> `npm run test:perception` (`tools/perception-check/`). **Run both after touching either.**

---

## 0. The one-paragraph version

`doc/11` gave the IR its first runtime-determined pose: an image anchor. That is a **noun**. This document
adds the two things you actually build apps out of: a **preposition** (where something goes *relative to*
a real object, in words a person would use) and a **verb** (do something to the pixels inside a named
frame, when something happens). Both reuse machinery Arsist already has — the anchor's homography, the
DataStore, the script event bus — so the new surface area for an author is small: draw a rectangle on a
photo, pick a direction, pick a trigger.

---

## 1. What an author does (the target experience)

**Example A — a label beside a machine**

1. Add an image anchor, drop in a photo of the machine's front panel, type its real width (25 cm).
2. Add a Canvas, set *Pin to image anchor → Control Panel*, *Place: to the right, 10 cm, facing the user*.
3. Build. The Canvas hangs in the air beside the real panel, at the real scale, readable from any side.

No coordinates typed. No script.

**Example B — read the number off a display**

1. On the same anchor's photo, drag a rectangle over the display area, name it `reading`.
2. Add a perception task: *OCR* `reading` → store as `panelValue`, triggered by *button `btn_scan`*.
3. Put a Button (bindingId `btn_scan`) and a Text bound to `panelValue.text` on the Canvas.
4. Build. Press the button, the number appears.

Still no script. A script can do the same thing (`perception.run('scanPanel', cb)`) when the author wants
logic, but the declarative path exists so that the common case needs none.

---

## 2. IR additions

Three new concepts. All optional; a project without them serialises exactly as it does today.

### 2.1 `PerceptionRegion` — a named rectangle on a reference photo

```ts
/** 参照写真の上に描く矩形。位置指定の基準にも、OCR 等の対象にもなる。 */
export interface PerceptionRegion {
  id: string;
  name: string;
  /**
   * 写真に対する正規化座標 (0..1)。原点は写真の左下、y は上向き。
   * （ランタイムの画像規約と揃えてある。エディタは上下を反転して描く。）
   */
  rect: { x: number; y: number; width: number; height: number };
}
```

`PerceptionTarget` gains `regions?: PerceptionRegion[]`.

A region is *not* a separate tracked thing — it is a sub-rectangle of an already-tracked planar target, so
it costs nothing at runtime and inherits the target's pose exactly.

### 2.2 `AnchorPlacement` — the preposition

```ts
export type PlacementSide =
  | 'center' | 'left' | 'right' | 'above' | 'below' | 'front' | 'behind';

export interface AnchorPlacement {
  /** 基準にする領域。省略時はターゲット全体。 */
  regionId?: string;
  /** ターゲット座標系での方向 (+X 右 / +Y 上 / +Z 面から手前)。 */
  side: PlacementSide;
  /** 基準の縁からの間隔 (m)。side='center' は無視、'front'/'behind' は面からの距離。 */
  gap: number;
  /** 置くオブジェクト側のどこを合わせるか。'near' = 手前の縁、'center' = 中心。 */
  align: 'near' | 'center';
  /** 縁に沿った方向の揃え。'right' なら上下、'above' なら左右。 */
  cross: 'start' | 'center' | 'end';
  /** 向き。'user' は常にユーザーの方を向く（ラベル向け）。 */
  facing: 'target' | 'user';
}
```

`ObjectAnchor` becomes:

```ts
export interface ObjectAnchor {
  targetId: string;
  whenNotFound: 'hidden' | 'lastKnown' | 'visible';
  /** 省略時は従来どおり transform を素のオフセットとして使う（完全な後方互換）。 */
  placement?: AnchorPlacement;
}
```

**`placement` and `transform` compose**: placement computes a base pose from the two objects' real sizes,
then `transform` is applied on top as a manual nudge in the same target frame. So the gizmo keeps working
and an author can always fall back to dragging.

Why this rather than raw offsets: an offset of `x = 0.2` stops meaning "beside it" the moment the target's
`physicalWidth` or the object's size changes. `side: 'right', gap: 0.1` survives both, and it is what the
author actually meant.

### 2.3 `PerceptionTask` — the verb

```ts
export type PerceptionTaskType = 'ocr' | 'capture';   // 将来: 'barcode' | 'color' | 'classify'

/** 何のピクセルを見るか。 */
export type PerceptionSource =
  /** 追跡中のターゲット上の領域。角度がついていても正対に直してから処理する。 */
  | { kind: 'region'; targetId: string; regionId: string }
  /** カメラ画像そのものの矩形（正規化, 原点左下）。ターゲット不要。 */
  | { kind: 'viewport'; rect: { x: number; y: number; width: number; height: number } };

export interface PerceptionTask {
  id: string;
  name: string;
  type: PerceptionTaskType;
  source: PerceptionSource;

  /** 既存の ScriptTrigger をそのまま使う: onStart / interval / event / manual。 */
  trigger: ScriptTrigger | { type: 'manual' };

  /** 結果を書き込む DataStore キー。UI の bind からそのまま読める。 */
  storeAs: string;

  /** 認識エンジンの選択と設定。 */
  engine?: PerceptionEngineConfig;
}
```

---

## 3. Runtime design

### 3.1 Placement resolution

```
targetHalf   = 基準領域の半サイズ (m)          ← physicalWidth/Height と region.rect から
objectHalf   = 置くオブジェクトの半サイズ (m)   ← Renderer.bounds / Canvas の widthMeters
dir          = side をターゲット座標系の単位ベクトルにしたもの

localPos = regionCenter
         + dir * (targetHalf·|dir| + gap + (align === 'near' ? objectHalf·|dir| : 0))
         + crossOffset
         + transform.position          // 手動の微調整
```

`objectHalf` needs the object's bounds, which for a runtime-loaded GLB/VRM are not known until the model
arrives. `ArsistImageAnchor` therefore recomputes placement when the child hierarchy changes (the same
reason `SetVisible` re-queries children rather than caching them — see `doc/11` §5.3).

`facing: 'user'` overrides rotation each frame with a billboard that keeps the object's up axis vertical —
a label that rolls with the poster is unreadable.

### 3.2 Region extraction — rectify, don't crop

This is the part that makes OCR work at all, and it falls out of machinery we already have.

The recogniser already produces a homography `H` mapping **target-plane metres → live image pixels**
(`Homography.Estimate`, `doc/11` §5.2). For a region:

1. Map the region's four corners (metres, from `rect` × physical size) through `H` → a quad in the frame.
2. Build the inverse map and **warp that quad into an upright buffer** sized from the region's *physical*
   size at a chosen resolution (default ≈ 900 px on the long side, clamped by the source resolution).
3. OCR sees a fronto-parallel, correctly-scaled, deskewed image — the same view as the reference photo —
   no matter where the user is standing.

```
   live camera frame                 rectified crop (what the OCR engine sees)
   ┌───────────────────┐
   │      ╱‾‾‾‾╲       │             ┌──────────────┐
   │    ╱  ROI  ╲      │   ── H⁻¹ →  │  1 2 3 4 5   │
   │   ╲________╱      │             └──────────────┘
   └───────────────────┘
```

Two practical consequences:

- **Capture at full resolution, not at detection resolution.** Detection runs at 640×480 for speed
  (`doc/11` §5.1); a task requests a one-off full-resolution frame (1280×960 on Quest) so small text
  survives. The frame source grows a `TryCaptureHighRes(out frame)` alongside `TryAcquire`.
- **Reject rather than guess.** If the quad falls outside the frame, or the region is too oblique
  (rectified area below a minimum, i.e. viewed nearly edge-on), the task fails with a *reason the UI can
  show* — `outOfView` / `tooOblique` / `notTracked` — instead of returning garbage text.

`source.kind === 'viewport'` skips all of this and crops the raw frame: no target needed, use it for
"aim at the label and press".

### 3.3 Results go into the DataStore

Verified against the current runtime: `ArsistDataStore.TryGetValueByPath` walks nested dictionaries and
`ArsistUIBinding` re-renders on any key that shares a prefix. So a task writes **one dictionary** and the
author gets every field as a bindable path for free:

| DataStore path | Value |
|----------------|-------|
| `<storeAs>.text` | recognised text, lines joined by `\n` |
| `<storeAs>.lines` | array of lines |
| `<storeAs>.status` | `'idle' \| 'running' \| 'ok' \| 'error'` |
| `<storeAs>.error` | `'notTracked' \| 'outOfView' \| 'tooOblique' \| 'engine' \| 'network'` |
| `<storeAs>.at` | ISO 8601 timestamp |

A Text element bound to `<storeAs>.status` is a working spinner with zero code — which matters, because
OCR is not instant (§5).

Events fire alongside, on the existing bus: `perception.task.done:<id>` / `perception.task.failed:<id>`,
so a script can react without polling.

> **Do not route this through `DataSourceDefinition`.** It looks like the natural home, but
> `ArsistDataFlowEngine.cs` is **`.disabled`** — DataSources do not execute at runtime today. The live path
> is DataStore + `ArsistUIBinding`, and that is what perception writes to.

### 3.4 Scripting surface

Follows `ApiWrapper`'s existing callback shape (`api.get(url, cb)`), because OCR is async for the same
reason HTTP is:

```js
perception.run('scanPanel')                    // 実行のみ。結果は store と event へ
perception.run('scanPanel', (r) => {           // r = { ok, text, lines, error }
  if (r.ok) ui.setText('label', r.text);
})
perception.lastResult('scanPanel')             // 直近の結果（同期）
perception.regionPose('panel', 'reading')      // 領域中心のワールド姿勢
perception.isTracked('panel')                  // doc/11 から継続
```

---

## 4. The rectifier and the recogniser are separate components

This split is deliberate and load-bearing. **Geometry and text recognition are separated at a hard
boundary**, because they fail differently, are verified differently, and evolve independently.

```
region (metres on the target plane)
        │
        ▼
┌───────────────────────────┐   RgbaImage    ┌──────────────────────────┐
│ RegionRectifier           │ ─────────────► │ IArsistTextRecognizer    │
│  H⁻¹ で正対画像に起こす     │   + metadata   │  画素 → 文字             │
│  UnityEngine 非依存        │                │  端末依存・実機でしか      │
│  → 素の .NET でテスト可能   │                │    確かめられない         │
└───────────────────────────┘                └──────────────────────────┘
       知らない: OCR                                 知らない: ターゲット・homography
```

```csharp
/// 姿勢も homography も知らない。ただの上向きの画素。
public struct RgbaImage {
    public byte[] Pixels;      // RGBA8888, 行は上から下 (Android Bitmap と同じ)
    public int Width, Height;
}

public interface IArsistTextRecognizer {
    bool IsAvailable { get; }
    string Description { get; }
    void Recognize(RgbaImage image, TextRecognizeOptions options, Action<TextResult> done);
}
```

Three concrete benefits, not just tidiness:

- **The whole task pipeline can be built and tested with a `MockTextRecognizer`** that returns a canned
  string — triggers, queuing, the DataStore contract, the editor UI, all without a camera or a headset.
- **Rectification is verifiable offline.** It is pure geometry over `Homography`, which already lives in
  plain .NET and is covered by `npm run test:perception` (`doc/11` §0). Warp a synthetic region under a
  known homography, warp it back, assert sub-pixel round trip.
- **Swapping the recogniser is a one-line change**, so the on-device engine and a future cloud or
  barcode engine cost nothing structurally.

The rectifier's output contract also carries the reason it *could not* produce an image
(`notTracked` / `outOfView` / `tooOblique`), so the recogniser is never handed garbage and the UI can say
what went wrong (§3.3).

---

## 4a. The recogniser: ML Kit Text Recognition v2, bundled

**Decision: on-device ML Kit with the bundled model. No Google Play Services, no model download.**
A cloud engine may be added later behind the same interface, but it is not on the critical path.

### Why this is actually offline — verified at the artifact level

Quest's Horizon OS has no Google Play Services, so this only works if the model and the inference engine
both ship inside the APK. They do. From the published Maven artifacts:

| Artifact | What it actually contains |
|----------|---------------------------|
| `com.google.mlkit:text-recognition:16.0.1` | 1.4 MB — **Latin model** in `assets/mlkit-google-ocr-models/…binarypb` |
| `com.google.mlkit:text-recognition-japanese:16.0.1` | 2.6 MB — **Japanese + Latin models**, same layout |
| `com.google.mlkit:text-recognition-bundled-common:17.0.0` | 18 MB — **the OCR engine itself**: `jni/arm64-v8a/libmlkit_google_ocr_pipeline.so` (11 MB) |
| `com.google.android.gms:play-services-mlkit-text-recognition:19.0.1` | 78 KB — only the options classes (`TextRecognizerOptions`); *not* an implementation |

Two things worth knowing, because the naming misleads:

- The `com.google.android.gms:*` artifacts in this dependency graph are **compile-time shims and the
  Tasks API**, which is plain Java. Depending on them is not the same as requiring Play Services at
  runtime.
- None of the manifests declare `com.google.mlkit.vision.DEPENDENCIES` metadata — that is the marker
  for the *downloaded-model* path, and it is absent. Nothing is fetched at install or first run.

Cost: roughly **+12–15 MB** to the APK for arm64 (Unity already builds arm64-only, so the other three
ABIs in the AAR are stripped).

### Phase 0 result: confirmed on a Quest 3

Measured 2026-09-06 on a Meta Quest 3 (Horizon OS v207, Android 14 / API 34), with
`pm list packages | grep com.google.android.gms` returning **nothing** — no Play Services on the device:

```
[OcrSpike] device: Oculus Quest 3 / Android API 34
[OcrSpike] GooglePlayServices availability code: 9   (0 = available; 9 = SERVICE_INVALID)
[ArsistMlkitOcr] recognized in 100 ms, blocks=2
[OcrSpike] SUCCESS (100 ms)
ARSIST OCR TEST
Serial: QX-4821-B
Temp 23.5 C/61 %
温度センサー起動中
型番 ARS-1234
1234567890
```

Every line of the test image came back correct, Latin and Japanese together, in **100 ms** (two runs:
103 ms and 100 ms). The availability code of 9 with a successful recognition is the point: Play Services
is unusable on this device and the OCR ran anyway, from the model inside the APK.

The packaging side holds too: 25 MB APK containing `lib/arm64-v8a/libmlkit_google_ocr_pipeline.so`
(11 MB), 34 model files under `assets/mlkit-google-ocr-models/`, and **no**
`com.google.mlkit.vision.DEPENDENCIES` metadata. The `com.google.android.gms.version` meta-data that
`play-services-base` contributes to the merged manifest is present and, as hoped, inert.

**This closes the only question that could have invalidated the plan.** On-device OCR is the engine;
a cloud engine is not needed on the critical path.

### One dependency can be dropped

`com.google.mlkit:text-recognition-japanese` bundles a **Japanese *and* Latin** model — its asset is
literally `taser_tflite_gocrjapanese_and_latin_…`, and the run above read the Latin lines perfectly with
only that recogniser active. So shipping the Japanese artifact alone (2.6 MB) covers both scripts, and
`com.google.mlkit:text-recognition` (Latin-only, 1.4 MB) can be dropped for Japanese-market projects.
That resolves most of the open question in §10 about which models to ship: the choice is between
Latin-only and Japanese+Latin, not a combination of both.

### The Gradle mechanism (new to this repo, and needed anyway)

Arsist has had no way to add an Android Maven dependency — `Assets/Plugins/Android/` holds only a
manifest. The mechanism is smaller than expected:

1. Copy Unity's **own** `mainTemplate.gradle` out of the installed editor
   (`<Unity>/Editor/Data/PlaybackEngines/AndroidPlayer/Tools/GradleTemplates/mainTemplate.gradle`) into
   `Assets/Plugins/Android/`, and insert dependency lines before the `**DEPS**` token. Copying from the
   installed editor rather than checking in a fixed template means the file tracks the Unity version
   automatically — the tokens (`**APIVERSION**`, `**ABIFILTERS**`, …) are whatever that editor expects.
2. Nothing else. `google()` and `mavenCentral()` are already in Unity's `settingsTemplate.gradle`, and
   Unity 6 already emits `android.useAndroidX=true` / `android.enableJetifier=true`.
3. Java sources go in `Assets/Plugins/Android/*.java`; Unity compiles them into `unityLibrary`, so no
   prebuilt AAR and no Android toolchain in the repo.

**Two rules for that template, both found the hard way in Phase 0.** Neither failure names its cause —
both surface as a Gradle error about the *launcher* module ("does not specify `compileSdk`"), which is
nowhere near the real problem.

1. **ASCII only.** Unity rewrites the file while substituting placeholders and turns non-ASCII bytes into
   `?`, producing invalid Groovy. No Japanese comments in a Gradle template.
2. **Never write a placeholder token literally, not even in a comment.** Unity substitutes it there too —
   a comment reading "inserted before the `**`DEPS`**` token" gets the entire dependency list injected
   into the middle of the sentence.

The pipeline should assert both when it generates the template rather than let them recur.

Once Arsist owns this, every future native capability (barcode, BLE, audio) uses the same hook: an
adapter contributes dependency lines, `ArsistBuildPipeline` merges them into the copied template.

### Calling it

The Java side is a thin static bridge (`ArsistMlkitOcr.recognizeRgba`) that builds an ARGB_8888 `Bitmap`
from the rectified pixels and returns via `UnityPlayer.UnitySendMessage`, which marshals back to the
Unity main thread for free. The one non-obvious detail: **Unity textures are bottom-up and Android
bitmaps are top-down**, so the flip happens on the C# side before the call — forgetting it produces the
quiet failure mode where text is detected but comes back as nonsense.

Language selection is per task: `TextRecognizerOptions.DEFAULT_OPTIONS` (Latin) or
`JapaneseTextRecognizerOptions` (Japanese + Latin). Shipping only the language you need keeps the APK
smaller, so the engine choice belongs in the IR, not hardcoded.

---

## 5. Latency, and designing around it

| Stage | Quest 3, rough |
|-------|----------------|
| high-res frame capture + readback | 10–30 ms |
| rectify a region | 2–10 ms |
| OCR — ML Kit bundled, on-device | **100 ms measured** on Quest 3, 1000x520 crop, Japanese model |

So a task is **always** asynchronous, always writes `status: 'running'` first, and never blocks the main
thread. The declarative path gives the author a status binding for free precisely so the app does not look
frozen. Tasks are queued per-task-id — pressing the button twice does not launch two requests.

`interval` triggers are allowed but capped: on-device OCR is free per call but not free in battery, and
a 10 Hz OCR loop on a headset is a heat problem, not a feature.

---

## 6. Editor work

The authoring surface is where this feature is won or lost. Four pieces:

1. **Region editor on the photo.** Click the reference photo in the anchor inspector → it opens at size →
   drag rectangles → name them. Same interaction as `UIEditor`'s absolutely-positioned elements, so the
   drag/resize logic is largely already written.
2. **Placement controls.** A 7-way direction picker + gap + facing, replacing raw XYZ for anchored
   objects (raw XYZ stays available as the nudge). The viewport preview updates live, which is the whole
   point — you see the Canvas move to the right of the photo plane as you pick.
3. **A perception panel** listing tasks: type, source region, trigger (a dropdown of button bindingIds
   found in the project, plus `manual` / `onFound` / `interval`), `storeAs`, engine.
4. **Preview in the editor, on the reference photo.** Region tuning without a headset needs *some*
   recogniser that runs on the desktop, and the on-device engine by definition does not. Options, in
   order of preference: (a) run the rectifier in the editor and show the exact crop the device would see
   — cheap, and catches most framing mistakes on its own; (b) add a desktop-only recogniser later
   (Tesseract via a local binary, or an optional cloud call) behind the same interface. **(a) ships
   first**, because the crop preview is most of the value and costs nothing extra.

Everything user-facing goes through `src/renderer/i18n/strings.ts` (en/ja), per repo convention.

### 6.1 Simulation

The PC simulator and Live Layout mode (`src/renderer/live/`) already render a first-person view. Feeding
that rendered view into the *same* recogniser closes the loop: an author can place a virtual copy of the
target in the simulated scene and watch the anchor lock on and the OCR fire, entirely on the desktop.
This is a small addition on top of what §3 already builds, and it is the strongest answer to the
"AR is hard to iterate on" problem the project is aimed at.

---

## 7. Build pipeline changes

| File | Change |
|------|--------|
| `src/shared/types.ts` | `PerceptionRegion`, `AnchorPlacement`, `PerceptionTask`, `PerceptionEngineConfig` |
| `src/bridge/UnityBridge.ts` | emit `regions` / `tasks` into the manifest |
| `ArsistBuildPipeline.cs` | write regions + tasks into `StreamingAssets/Perception/perception.json`; add `ArsistPerceptionTaskRunner` to the scene only when tasks exist |
| `Runtime/Perception/` | `RegionRectifier` (geometry only), `ArsistPerceptionTaskRunner` |
| `Runtime/Perception/Text/` | `IArsistTextRecognizer`, `MockTextRecognizer`, `MlKitTextRecognizer` |
| `Assets/Plugins/Android/` | `ArsistMlkitOcr.java` bridge; `mainTemplate.gradle` copied from the installed editor with ML Kit deps injected |
| `Runtime/Scripting/PerceptionWrapper.cs` | `run` / `lastResult` / `regionPose` |
| `Adapters/*` | Gradle dependency lines contributed per device; merged into the copied template by the pipeline |
| `src/renderer/…` | region editor, placement controls, task panel, preview |

Regions and tasks are **additive to the existing `perception.json`** — an older APK ignores them, and a
project with no tasks produces byte-identical output to today.

---

## 8. Phasing

Ordered so the **least certain thing is settled first**. Everything after Phase 0 is work whose outcome we
can already predict; Phase 0 is the one step that can invalidate the plan, so it happens before anything
is built on top of it.

| Phase | Contents | Ends with |
|-------|----------|-----------|
| **0. Spike** ✅ **done** | A minimal non-VR APK ([`tools/mlkit-spike/`](../tools/mlkit-spike/), `npm run spike:mlkit`): Gradle template + `.java` bridge + a bundled test image. No camera, no XR, no Arsist pipeline. | **Confirmed on hardware**: bundled ML Kit reads Latin + Japanese in 100 ms on a Quest 3 with no Play Services (§4a) |
| **1. Placement** ✅ | `AnchorPlacement` + regions in the IR, runtime resolution, direction/gap UI, viewport preview | *"show this Canvas to the right of that thing"* |
| **2. Rectifier + task pipeline** ✅ | regions → `RegionRectifier` → high-res still → task runner → DataStore contract → script API, plus `MockTextRecognizer` | The whole app-facing feature, verifiable with no camera and no OCR |
| **3. Wire in the real engine** ✅ | Gradle machinery in `ArsistBuildPipeline`, `MlKitTextRecognizer` behind `IArsistTextRecognizer` | *"press the button, OCR that frame"*, offline |
| **4. Simulation** ⬜ | feed the simulated first-person view into the recogniser | the whole loop testable on a desktop |

### Two things that only showed up on hardware

Both were silent: the build succeeded, the editor was happy, and the device just did nothing.

- **IL2CPP stripped the type the Quest camera source reaches by reflection.** `PassthroughCameraAccess`
  lives in MRUK and is reached by name (it cannot be referenced directly — MRUK is absent from XREAL
  builds), so the managed-code stripper removed it and the only symptom was
  `No camera frame source available on this device`. The pipeline now writes a `link.xml` preserving that
  type whenever perception is enabled. **Any type reached only by reflection needs the same treatment.**
- **A 48×48 reference photo scored 72/100 in the editor and produced zero features on device.** The
  quality score measured corner *density* on a downscaled copy and never looked at the original
  resolution. The runtime's ORB pyramid discards a 22 px border at each of six levels, so a short side
  under ~240 px cannot yield a single keypoint no matter how detailed the image is. The score is now
  resolution-aware and says which of the three problems it found (too small / low contrast / too few
  features), and `ArsistBuildPipeline` reads the PNG/JPEG header and warns at build time as well.

### The XR plugin conflict that hid all of this

The on-device symptom was `PcaCameraAndroid … Unsupported graphics API 0`, which reads like a rendering
problem and is not one. The chain, found by reading Meta's current docs rather than by more log-staring:

1. `UnityBuilder.applyQuestXrBootstrap` seeded `Assets/XR` from `sdk/quest/Unity-InteractionSDK-Samples`,
   a **Unity 2022.3 / Meta XR v83** project, which brought an `OculusLoader.asset`.
2. `applyQuestRequiredDependencies` also added **`com.unity.xr.oculus` 4.4.0** explicitly.
3. That package is deprecated and ships its **own OVRPlugin native binary (v1.92)**, which shadows the
   v1.117 binary Meta XR Core SDK 85's C# expects (`You are using an old version of OVRPlugin`).
4. Passthrough Camera Access is a post-v1.92 feature, so its native entry points are simply absent and
   `CameraPlay` fails.

Fix: Quest builds now use **OpenXR Loader + `com.meta.openxr.feature.metaxr`**, `com.unity.xr.oculus` is
removed rather than added, and the sample's `OculusLoader.asset` is dropped during the bootstrap. Per
Meta's documentation, Unity 6 with Meta XR SDK v74+ requires the Unity OpenXR Plugin; the Oculus XR Plugin
is scheduled for removal.

### Known gaps

- **No on-screen aiming frame for `viewport` tasks.** The runtime crops the configured rectangle, but the
  app draws no guide, so the user cannot see what they are aiming at. The editor says so next to the
  option. Region-based tasks (the common case) are unaffected.
- **Phase 4 (simulation) is not built.** Region tuning in the editor currently shows the photo and the
  frames, not a recogniser preview — the on-device engine by definition does not run on the desktop.
- **Editor object sizes are estimates for models.** Placement preview uses exact sizes for primitives and
  Canvases; a GLB/VRM is approximated by its scale until the runtime measures its real bounds
  (`src/renderer/perception/objectExtents.ts`).

Phase 1 is independent of 2–3 and is the smaller, lower-risk half — worth landing and using on its own.
Phase 2 is where the design's separation pays: it is the largest chunk of work and it needs neither
hardware nor a working recogniser.

A cloud recogniser is deliberately **not** in this list. It can be added at any point behind the same
interface if offline turns out to be insufficient, but it is not a dependency of anything.

### Phase 0 in detail — what the spike does and does not test

**Tests:** that `com.google.mlkit:text-recognition*` resolves and links in a Unity Android build; that the
`.so` and model assets land in the APK; that `TextRecognition.getClient(...).process(...)` returns text on
Horizon OS with no Play Services; how long it takes; whether Japanese and Latin both work.

**Deliberately does not test:** the camera, XR, passthrough, rectification, or any Arsist IR. It builds as
a **plain 2D Android app**, which on Quest opens as a flat panel. Every one of those omissions removes a
way for the spike to fail for a reason that is not the question being asked. It prints the
`GoogleApiAvailability` status code on screen next to the OCR result, so a successful read with a non-zero
status code *is* the evidence.

---

## 9. Verification plan

The rule established in `doc/11`: **anything the device build cannot check must be checkable without a
device.** The rectifier/recogniser split in §4 exists largely to make that possible here.

| What | How | Needs hardware |
|------|-----|----------------|
| Placement maths | pure functions, unit-tested in TS (the editor preview needs the same computation, so write it once and mirror the fixture table in C#) | no |
| Rectification | extend `tools/perception-check/` (plain .NET): warp a synthetic region under a known homography and assert a sub-pixel round trip | no |
| Task runner, triggers, queuing, DataStore contract | `MockTextRecognizer` returning a canned result | no |
| Editor UI | the CDP harness already used for the anchor UI | no |
| Gradle/AAR packaging | unzip the built APK and assert `lib/arm64-v8a/libmlkit_google_ocr_pipeline.so` and `assets/mlkit-google-ocr-models/` are present | no |
| **ML Kit actually running without GMS** | **Phase 0 spike on a Quest 3** | **yes** |
| OCR accuracy at working distance / angle | on-device, once Phase 3 lands | yes |

Only the last two genuinely need the headset, and the first of them is a one-command install.

---

## 10. Open questions worth deciding before Phase 2

1. **Which language model to ship.** Phase 0 showed the Japanese artifact (+2.6 MB) also reads Latin
   perfectly, so this is a one-of choice, not a combination: Latin-only (+1.4 MB) or Japanese+Latin
   (+2.6 MB). Per-project selection is the right answer long term — it belongs in the IR and it changes
   the Gradle dependency line — which means the Gradle merge step has to accept a project-dependent
   dependency list. Worth deciding before Phase 3.
2. **Does `viewport` source need a visible frame in-app?** Almost certainly yes (the user has to aim), which
   means a small HUD overlay the task owns. Cheap, but it is UI that does not exist yet.
3. **Region coordinates when the photo is replaced.** Regions are normalised, so they survive a
   replacement of the same framing but not a re-shot photo. Warn, don't silently move them.

## コントローラーのレイ

`XROriginSetup.UpdateRayInteraction` がレイを引き、当たった相手に `OnGazeEnter` / `OnGazeDwellSelect` を
SendMessage で送る (視線・ハンドトラッキングと同じ道)。

**OpenXR はインタラクションプロファイルが要る。** Quest ビルドは OpenXR で動く。OpenXR は
「どのコントローラーの形を使うか」(interaction profile) を有効にしていないと、**コントローラーを
一切見せない**。`InputDevices` は空、レイもトリガーも動かない。ビルドは何も言わずに通り、実機では
「線が出ない・UI を押せない」だけが起きる (2026-09 に踏んだ)。`EnableQuestOpenXRFeatures` が
`com.unity.openxr.feature.input.oculustouch` を有効にする。実機のログで確かめられる:

```
[Arsist] XR input: 'Oculus Touch Controller - Right' [Controller, TrackedDevice, HeldInHand, …]
[Arsist] XR input: no devices at all (…)      ← プロファイルが無効だとこうなる
```

**姿勢の空間に注意。** `InputDevices` が返すコントローラーの位置・向きは、カメラを吊っている
**Camera Offset の中の座標**で、ワールド座標ではない。そのまま LineRenderer や `Physics.Raycast` に
渡すと、床のあたりに線が引かれ、当たり判定も見当違いの場所を通る。実機では「レイが出ない」ように見え、
UI も押せない (2026-09 に踏んだ)。`_cameraOffset.TransformPoint(pos)` でワールドに直してから使う。

実機のログで切り分けられる:

```
[Arsist] Controller ray: using 'Oculus Touch Controller - Right' (2 controller(s) tracked).
[Arsist] Controller ray: no controller is being tracked yet.     ← 握って動かすと出なくなる
[Arsist] Select: 'Key a'                                         ← トリガーで何を押したか
[Arsist] Select: pressed, but the ray was not on anything.       ← 押せてはいる。狙いが外れている
```

**どのコントローラーを使うかを決め打ちにしない。** `InputDevices.GetDevicesWithCharacteristics` が返す
順番に意味は無い。`inputDevices[0]` だけを見ていると、それが左手だったときに**右手のトリガーが一生
見えない**。実機では「線は出ているのにトリガーで何も起きない」という形で出る (2026-09 に踏んだ)。
いま引いているもの → 前に使っていたもの → 右手 → 最初の 1 つ、の順で選び、トリガーは全部のコントローラーを見る。
押し方も端末で違うので `triggerButton` / `trigger` (0〜1、0.55 以上) / `primaryButton` のどれでも「決定」とする
(`XROriginSetup.IsSelectPressed`)。

**視線の輪は、コントローラーが見えている間は出さない。** 出していると、コントローラーで狙っている板の上に
常に丸が乗ったままになり、邪魔なだけになる (2026-09 に言われた)。押すのもコントローラーに任せる。

## 画面を触って押す (スマホ・パソコンでの確認)

`Runtime/Input/ArsistScreenPointer.cs`。触った場所からカメラ越しにレイを出し、視線・コントローラー・手と
**同じ判定 (`ArsistUiPointer.RaycastScene`) と同じ通知 (`OnGazeEnter` / `OnGazeDwellSelect` / `OnGazeDrag`)**
を使う。ビルドの種類にかかわらずいつも付ける: 触る画面が無い端末では何も起きないので害が無く、
これが無いと同じプロジェクトがスマホでは**何も押せない**。パソコンではマウスで同じことができる。

```
[Arsist] Touch: 'Key a'
```

## 見つめて押す (コントローラーが無いとき)

`interaction.gazeDwellSeconds` (ビルド画面の「見つめて押す」) を 0 より大きくすると、
ボタンを見つめたままにしたときに `OnGazeDwellSelect` が飛ぶ。溜まり具合は視線カーソルの
大きさで見せる。**コントローラーが見えている間は働かない** (持っているときに誤爆しない)。

コントローラーが繋がらない・電池切れ・そもそも持っていない、のときでも操作できる逃げ道として置いてある。

## 文字入力

**基本は `Input` 要素 1 つ。** 押すと文字を打ち始める。何で打つかは端末が決める
(`Runtime/Input/ArsistTextEntry.cs`):

| 端末 | 出るもの |
|---|---|
| キーボードを持っている端末 (Quest のオーバーレイ、XREAL/スマホの Android IME) | **その端末のキーボード**。日本語 (かな漢字変換)・音声入力・予測変換は端末のものがそのまま使える |
| 持っていない / 頼んでも出てこない端末、パソコンでの確認 | **アプリの中のキーボード**が下から出る (英数字のみ)。物理キーボードでも打てる |

端末を見て分岐するのは `ArsistTextEntry` だけで、プロジェクト (IR・スクリプト) は 1 つのまま。
**同じプロジェクトがどの端末でも同じように動く**ことがこのエンジンの前提なので、
「Quest だけ直す」は答えにならない。

`TouchScreenKeyboard.Open()` は、機能宣言や端末の設定が足りないと**黙って何も出さない**。
待っていても何も打てず、実機では「押しても何も起きない」にしか見えないので、1.5 秒出てこなければ
アプリの中のキーボードに落とす。ログに理由が出る:

```
[Arsist] Text entry: asked the device for its keyboard.
[Arsist] Text entry: the device keyboard did not appear; showing the in-app one.
[Arsist] Text entry: this device has no keyboard of its own; using the in-app one.
```

**どのキーボードを出すかは選べる** (ビルド画面の「入力欄で出すキーボード」、
IR は `arSettings.interaction.textInput`):

| 設定 | 動き |
|---|---|
| `auto` (既定) | 端末のキーボードを試し、出なければアプリの中のものに切り替える |
| `device` | 端末のキーボードだけ。出なければ打てない (ログにエラーを残す) |
| `inApp` | アプリの中のキーボードだけ。どの端末でも同じ見た目・同じ操作 |

選べるようにしてあるのは、**端末のキーボードが「どこに出るか」まではエンジンから分からない**ため。
たとえば XREAL は Android の入力方式が**手元のスマホ側に開く**ので、グラスの中では何も起きないように見える。
そういう端末では `inApp` を選ぶ。Quest は OS のオーバーレイがグラス内に出るので `auto` のままでよい。

### Android の入口は **Activity** でなければならない (Unity 6 の既定は GameActivity)

Unity 6 の `PlayerSettings.Android.applicationEntry` の既定は **GameActivity** で、そのまま作ると
起動 Activity が `com.unity3d.player.UnityPlayerGameActivity` になる。この入口では
**ソフトキーボードが一切出ない**:

- Quest のシステムキーボード オーバーレイは、Meta の Unity 統合が `UnityPlayerActivity` 前提。
  マニフェストに `oculus.software.overlay_keyboard` を宣言していても、GameActivity では出ない。
- スマホでも、GameActivity は文字入力を GameTextInput 経由で扱うため、
  `TouchScreenKeyboard.Open()` で IME が出ない。

ビルドは何も言わずに通り、実機では「入力欄を押しても何も起きない」だけが起きる (2026-09 に踏んだ。
Quest でも Android でも同じ症状で、当たり判定やレイヤーを直しても直らなかった原因はこれ)。
`UseClassicAndroidActivity()` が毎回 Activity に直す。

**入口とマニフェストは対で決まる。** アダプタの `AndroidManifest.xml` が GameActivity 用のままだと、
Gradle が `resource style/BaseUnityGameActivityTheme not found` で落ちる (そのテーマは GameActivity の
ビルドにしか入らない)。

| 入口 | Activity クラス | テーマ |
|---|---|---|
| Activity (Arsist はこちら) | `com.unity3d.player.UnityPlayerActivity` | `@style/UnityThemeSelector` |
| GameActivity (Unity 6 の既定) | `com.unity3d.player.UnityPlayerGameActivity` | `@style/BaseUnityGameActivityTheme` |

(Unity 同梱の `PlaybackEngines/AndroidPlayer/Apk/UnityManifest.xml` がこの対を示している。)
アダプタは誰でも足せるので、`AlignAndroidManifestWithActivityEntry()` が食い違いを見つけたら書き換えて警告する。

ログとビルド結果で確かめられる:

```
[Arsist] Android application entry: GameActivity -> Activity (…)
```
```bash
$ANDROID_SDK/build-tools/<版>/aapt2 dump xmltree <apk> --file AndroidManifest.xml | grep "E: activity" -A2
#  UnityPlayerActivity / AppUIActivity (= UnityPlayerActivity の子) なら正しい
#  UnityPlayerGameActivity だと、キーボードは出ない
```

Quest で端末のキーボードを出すのに要るもの (Meta SDK の仕様):

- `AndroidManifest.xml` の `uses-feature oculus.software.overlay_keyboard`
- `OVRProjectConfig.requiresSystemKeyboard = true` (SDK の `Editor/OVRProjectConfig.cs` にある本物の項目。
  **OVRManager 側には無い** — 以前ここを reflection で触ろうとして、何の効果も無かった)

どちらも Input 要素があるプロジェクトのときだけ自動で入る
(`ProjectHasInputElement` → `QuestBuildPatcher.ConfigureSystemKeyboard` / `ConfigureOculusProjectConfigForQuest`)。
ビルドした APK で確かめるには:

```bash
$ANDROID_SDK/build-tools/<版>/aapt2 dump xmltree <apk> --file AndroidManifest.xml | grep overlay_keyboard
```

なお Meta SDK には `OVRVirtualKeyboard` (ランタイムが描く VR 用キーボード) もあるが、
入力源が Meta 独自の列挙 (`VirtualKeyboardInputSource`) 前提で Quest 専用になるため、使っていない。
どの端末でも同じ動きにするほうを採っている。

`Keyboard` 要素は、そのアプリ内キーボードを**最初から板として置く**もの (英数字のみ)。
日本語を打たせたいなら `Input` を使う。

どちらも、打った文字は `bind.key` (DataStore) に入り、確定すると `"<bindingId>:submit"` のイベントが鳴る。
スクリプト側の書き方は同じなので、後から入れ替えられる。

### 値の受け渡しは 1 か所 (ArsistDataStore) に集める

キーボード・UI の bind・スクリプトの `store.*`・認識タスクは、**同じ入れ物**を指していなければならない。

```
キーボード / 入力欄 ──書く──▶ ArsistDataStore ──読む──▶ スクリプト (store.get)
スクリプト (store.set) ──書く──▶ ArsistDataStore ──読む──▶ UI の bind (ArsistUIBinding が OnValueChanged で追従)
認識タスク            ──書く──▶ ArsistDataStore ──読む──▶ 両方
```

2026-09 に、ここが 2 つに割れていた:

- `store.*` (スクリプト) は**自前の Dictionary** を持っていて、DataStore と繋がっていなかった。
  → スクリプトは打った文字を読めず、スクリプトが書いた答えは UI に出ない。
- `SetValue("chat.input", …)` は「chat.input」という 1 つの名前で入れるのに、
  `TryGetValueByPath("chat.input")` はドットを入れ子として辿っていた。→ 書いた値を自分で読めない。

実機では「打っても入力欄に文字が出ない」「確定しても応答が無い」という形でしか見えない。
いまは名前を**まずそのまま**引き、無ければ入れ子として辿る。両方とも
`npm run test:perception` の `data store` で固定してある。

**「まだ無い」と「空」を混同しない。** 入力欄・キーボードは、DataStore に値が無いときに
「空だ」とみなすと、打った文字を毎フレーム自分で消してしまう (`TryReadStore` が bool を返すのはこのため)。

`Input` に `TMP_InputField` は付けない。EventSystem のクリックで動く部品なので、ワールド空間のレイ
(視線 / コントローラー / 手) では選ばれず、それでいて中の文字を自分で書き換えるため、打った文字を消してしまう。
表示は `ArsistTextInput` が自分で持つ。
