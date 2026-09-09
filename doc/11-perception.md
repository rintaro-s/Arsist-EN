# Perception Layer — image anchors (`doc/11-perception.md`)

> **Status: implemented.** This is the reference for Arsist's first perception feature:
> *"put this 3D object on top of that real thing, identified from one photo."*
>
> The accuracy-critical geometry (`LinAlg` / `Homography` / `PlanarPoseSolver`) has no UnityEngine
> dependency and is verified against synthetic data by `npm run test:perception`
> ([tools/perception-check/](../tools/perception-check/)). **Run it after touching any of that math** —
> a wrong sign there moves anchors by centimetres and the device build will not tell you.

---

## 1. Why this is a layer and not a feature

Every IR construct today is **absolute**: `SceneObject.transform` is a fixed pose in the user's spawn
frame ([src/shared/types.ts](../src/shared/types.ts)). There is no vocabulary for *"a pose that is not
known until runtime, because it comes from the real world."*

Image anchors are the first such construct. The way they are modelled decides whether plane anchors,
object-class anchors, and IoT-device anchors can be added later without reshaping the IR — so the
concepts below are deliberately named for the general case (`PerceptionTarget`, `ObjectAnchor`),
with image recognition as the first `type`.

---

## 2. Device reality check

This is the constraint that drives the whole design. Verified against the SDKs in `sdk/`:

| Device | Native image tracking | Camera frames + intrinsics + pose |
|--------|----------------------|-----------------------------------|
| **XREAL** | ✅ `XREALImageTrackingSubsystem` → AR Foundation `ARTrackedImageManager` | ✅ `XREALCameraSubsystem` (AR Foundation `ARCameraManager`) |
| **Meta Quest 3** | ❌ **none.** Meta ships no marker/image tracking API at all | ✅ MRUK `PassthroughCameraAccess` (`horizonos.permission.HEADSET_CAMERA`) |
| Android / ARCore | ✅ `ARTrackedImageManager` | ✅ `ARCameraManager` |
| Editor / PC | ❌ | ✅ webcam or simulated render |

The naive design — "use each SDK's image tracking" — **cannot work on Quest**, which is the exact
device this feature is being built for. Meta has camera pixels but no recognizer.

The only thing all four rows share is the *right-hand column*. So that is where the device boundary
goes:

```
 per-device (small, in Adapters/)      device-independent (the actual value)
┌──────────────────────────────┐     ┌─────────────────────────────────────┐
│ IArsistCameraFrameSource     │ --> │ ArsistImageRecognizer               │ --> Pose
│  pixels + intrinsics + pose  │     │  detect / describe / match / solve  │
└──────────────────────────────┘     └─────────────────────────────────────┘
    Quest: PassthroughCameraAccess        one implementation, every device
    XREAL/ARCore: ARCameraManager
    Editor: WebCamTexture / render
```

**One recognizer for every device** is not just a fallback for Quest — it is the correct choice even
where a native recognizer exists, because authoring predictability matters more than a few
milliseconds: an author who places a cube on a poster in the editor must get the same result on
XREAL and on Quest. A native fast path can be added later behind the same interface (§8), as an
optimisation, never as the contract.

### 2.1 The insight that makes this cheap

The target is **static in the world**, and the headset already does 6DoF tracking of itself. So the
recognizer does not have to track at frame rate — it only has to *localise the target once*, publish
a world-space pose, and let platform tracking hold it there. Re-detection at **5–10 Hz** is enough,
and it can run off the main thread. This removes the usual reason marker tracking needs a native CV
library.

---

## 3. IR additions

### 3.1 `PerceptionTarget` — what to look for

Stored on the project root, sibling to `scenes` / `uiLayouts`, because a target is referenced by
objects across scenes.

```ts
export type PerceptionTargetType = 'image';   // future: 'plane' | 'objectClass' | 'pose'

export interface PerceptionTarget {
  id: string;
  name: string;
  type: 'image';

  /** Reference photo, project-relative. Copied to StreamingAssets/Perception/ at build. */
  imagePath: string;

  /** Real-world width of what is in the photo, in metres. Required — scale is unrecoverable otherwise. */
  physicalWidth: number;

  /** Real-world height in metres. Omitted = derived from the photo's aspect ratio. */
  physicalHeight?: number;

  /** How long an anchor keeps its last pose after the target leaves view, ms (default 2000). */
  holdMs?: number;

  /** Editor-computed trackability score 0–100, advisory only. See §6.1. */
  quality?: number;
}
```

`ArsistProject` gains:

```ts
  /** Perception targets (optional, back-compatible). */
  perception?: { targets: PerceptionTarget[] };
```

### 3.2 `ObjectAnchor` — where an object goes

```ts
export interface ObjectAnchor {
  /** PerceptionTarget.id */
  targetId: string;
  whenNotFound: 'hidden' | 'lastKnown' | 'visible';
}
```

| `whenNotFound` | Behaviour |
|----------------|-----------|
| `hidden` | Hidden whenever the target has not been seen within `holdMs`. |
| `lastKnown` **(default)** | Hidden until the first localisation, then stays put in world space forever. |
| `visible` | Shown from the start; sits at the XR origin until the target is first localised. |

`lastKnown` is the default because it is what "stick this on that thing" means in practice: the
object should not vanish when you look away. See §5.3.

```ts
```

`SceneObject` gains `anchor?: ObjectAnchor`. **When `anchor` is present, `transform` is reinterpreted
as an offset in the target's local frame** instead of an absolute world pose. Nothing else about
`SceneObject` changes — materials, children, `assetId`, scripting all behave identically.

### 3.3 Target coordinate frame (normative)

```
        +Y  (up, as the photo is printed)
         │
         │
         └──── +X  (right, as the photo is printed)
        ╱
      +Z  (out of the surface, toward the viewer)

origin = centre of the target, right-handed, metres
```

This is the **Unity quad / Canvas convention**, chosen because it is what an author sees in the
editor viewport: `transform.position = (0, 0, 0.1)` means "10 cm in front of the surface."

This is a **right-handed** frame, consistent with the editor viewport and with every other IR
transform.

#### The handedness trap (normative — get this wrong and objects land mirrored)

Arsist already converts editor space to Unity space by mirroring X
(`ArsistBuildPipeline.CreateGameObject`: `(x,y,z) → (-x,y,z)`, rotation conjugated by the same
mirror). An anchored object is an ordinary child of the anchor node and goes through that mirror
**unchanged** — no special case. For that to be correct, the anchor node's *Unity* frame must be the
mirror conjugate `R_unity = M · R_editor · M` of the frame above, which works out to:

| Axis | IR / editor frame (right-handed) | Unity anchor node (left-handed) |
|------|----------------------------------|---------------------------------|
| local +X | printed right | printed **left** |
| local +Y | printed up | printed up |
| local +Z | out of the surface | out of the surface |

So the runtime builds the anchor node as:

```csharp
// n = outward surface normal (pointing at the viewer), u = printed-up, both in Unity world space
transform.rotation = Quaternion.LookRotation(n, u);
```

which yields exactly `right = -printedRight, up = printedUp, forward = n`. Verified: an object
authored at target-local `(0, 0, 0.1)` ends up 10 cm in front of the surface, and one at
`(-0.2, 0, 0)` ends up 20 cm to the printed left, on both sides of the mirror.

This is also **not** what AR Foundation uses — `ARTrackedImage` follows ARCore, where the image lies
in the XZ plane and +Y points out of the surface. Any AR Foundation-backed provider (§8) must
convert before publishing a pose. Normalising all of this is precisely the job of a middle layer;
providers convert, the IR does not.

### 3.4 Script triggers

No new trigger type. Perception reuses the existing `ScriptTrigger` `event` channel
([types.ts](../src/shared/types.ts) `ScriptTriggerType`), so every existing script keeps working:

| Event value | Fired when |
|-------------|-----------|
| `perception.found:<targetId>` | target transitions not-tracked → tracked |
| `perception.lost:<targetId>` | target transitions tracked → not-tracked (after `holdMs`) |

Fired through `ArsistScriptEvent.Fire(...)`, the same path `ArsistGazeTarget` already uses.

A `perception` JS global is added alongside `scene` / `viewer` / `ui`:

```js
perception.isTracked("microwave_panel")   // -> bool
perception.getPose("microwave_panel")     // -> {position, rotation} in world space, or null
```

---

## 4. Authoring UX — the "簡単に使える" requirement

The whole feature must not introduce a new mental model. It does not:

1. **Add → Image Anchor**, drop a photo on it.
2. Type the real-world width in cm. (One number. This is the only genuinely new concept.)
3. The anchor appears **in the existing 3D viewport as a textured plane at true physical size**.
4. Drag any 3D object onto it — it becomes a child, edited with the same gizmos as everything else.
5. Build.

Step 3 is what makes it feel free: the author is not "configuring image tracking", they are placing
an object on a picture of the thing, in the editor they already use. The existing Live Layout Mode
and PC simulator (`src/renderer/live/`) work on it unchanged, because an anchored object is still an
ordinary `SceneObject` with a parent.

---

## 5. Runtime design

### 5.1 Frame source contract (per device — the only device-specific code)

```csharp
public struct ArsistCameraFrame {
    public NativeArray<byte> Gray;     // single channel, tightly packed
    public int Width, Height;
    public Vector2 FocalLength;        // fx, fy in pixels
    public Vector2 PrincipalPoint;     // cx, cy in pixels
    public Pose CameraPose;            // Unity world space, at capture time
    public double TimestampSeconds;
}

public interface IArsistCameraFrameSource {
    bool IsSupported { get; }
    bool TryAcquireFrame(out ArsistCameraFrame frame);   // false = no new frame
    void Release(ArsistCameraFrame frame);
}
```

Implementations:

- **Quest** — `Meta.XR.MRUtilityKit.PassthroughCameraAccess`. Supplies everything directly:
  `GetColors()`, `Intrinsics` (`FocalLength` / `PrincipalPoint` / `SensorResolution`), `GetCameraPose()`,
  `IsUpdatedThisFrame`. Requires `horizonos.permission.HEADSET_CAMERA` and a runtime permission
  request. Request `640×480` to skip a downscale.
- **XREAL / ARCore** — `ARCameraManager.TryAcquireLatestCpuImage` + `TryGetIntrinsics`, pose from the
  AR camera transform at the frame's timestamp.
- **Editor** — `WebCamTexture`, or a render of the authored scene, so the recognizer is testable with
  no device attached.

`CameraPose` **must** be the pose at capture time, not at consumption time, or the anchor lands
offset whenever the head is moving.

### 5.2 Recognizer (device-independent)

Standard planar target pipeline, implemented in C# with Burst/Jobs — no native library, no
Asset Store dependency, no licence question:

| Stage | Choice | Note |
|-------|--------|------|
| Reference prep | 4-level image pyramid, once at startup | lets the target be recognised near and far |
| Keypoints | FAST-9 | |
| Descriptors | rotated BRIEF (ORB), 256-bit | Hamming distance = popcount, very cheap |
| Matching | brute force + Lowe ratio test (0.75) | reference sets are small (≤1000 keypoints) |
| Geometry | RANSAC homography → IPPE planar pose | physical size + intrinsics give metric scale |
| Acceptance | ≥ 20 inliers **and** reprojection RMSE < 3 px | rejects the false positives that make marker tracking feel broken |
| Output | pose smoothed, then **frozen in world space** | §2.1 — platform tracking holds it |

Runs on a worker thread at a target 5 Hz; the main thread never blocks. Budget: ≈15–30 ms per
detection at 640×480 on Quest 3.

### 5.3 Anchor application

`ArsistPerceptionManager` (runtime) owns targets and publishes world poses. `ArsistImageAnchor`
(one per anchored object) reads its target's pose each frame and applies `transform` as a local
offset, honouring `whenNotFound`. Objects with no `anchor` are untouched — zero cost when the
feature is unused.

### 5.4 If it goes wrong on device — read this first

| Symptom | Likely cause |
|---------|--------------|
| Nothing is ever detected, and the editor shows a low trackability score | The reference photo. Blurry, low-contrast or repetitive images have no usable keypoints (§6.1). |
| Nothing is detected, no `[Arsist] Perception target localized` in logcat | Camera permission (`horizonos.permission.HEADSET_CAMERA`) was denied, or the headset is not a Quest 3/3S on Horizon OS ≥ v74. `PassthroughCameraAccess.IsSupported` gates this and Arsist logs which frame source it chose. |
| It detects, but the object appears **mirrored or upside down** | The camera readback row order. Set `ArsistQuestCameraSource.FlipReadbackRows = true`. A vertical flip is itself a valid homography, so the reprojection error stays low and nothing else reports a problem — this is the one failure the maths cannot catch for you. |
| The object sits at the right place but the **distance is wrong** | `physicalWidth` does not match the real object. Scale comes only from that number. |
| The object lands on the wrong side of the surface | Sign of the authored `z` offset, or the anchor frame — see the handedness table in §3.3. |

---

## 6. Build pipeline changes

| File | Change |
|------|--------|
| [src/shared/types.ts](../src/shared/types.ts) | `PerceptionTarget`, `ObjectAnchor`, `ArsistProject.perception`, `SceneObject.anchor` |
| [src/bridge/UnityBridge.ts](../src/bridge/UnityBridge.ts) | emit `perception` into `manifest.json`; emit `anchor` per object |
| `ArsistBuildPipeline.cs` | copy reference photos → `StreamingAssets/Perception/`; add `ArsistPerceptionManager` to the scene only when targets exist; attach `ArsistImageAnchor` |
| `Adapters/Meta_Quest/` | `horizonos.permission.HEADSET_CAMERA` in the manifest; MRUK package requirement |
| `Adapters/XREAL_One/` | `android.permission.CAMERA` |
| `AdapterManager.ts` | `AdapterFeatures.imageTracking` becomes meaningful; add `cameraFrameAccess` |
| `src/renderer/i18n/strings.ts` | all new UI strings (en/ja), per project convention |

Reference photos go to StreamingAssets as plain files — **not** as Unity textures and **not** as an
`XRReferenceImageLibrary`. The recognizer reads them at runtime, which keeps the Editor step to a
file copy and keeps the same asset working in the PC simulator.

### 6.1 Editor-side quality score

The single biggest cause of "it doesn't detect anything" is a bad reference photo (low contrast,
blurry, repetitive texture). A cheap keypoint-density + contrast heuristic in the renderer, shown as
a 0–100 score with a warning under ~40, prevents most support questions before they happen. Advisory
only; never blocks a build.

---

## 7. Scope boundary for v1

**In:** one photo → one planar target → objects anchored to it; `found` / `lost` script events;
Quest + XREAL + Editor; multiple targets tracked simultaneously.

**Out (named so they are not accidentally assumed):**

- **Non-planar objects.** One photo determines a plane. "Recognise this mug from any angle" needs a
  3D model or multi-view capture — a different feature.
- Plane detection, object-class detection (`type: 'objectClass'`), hand-pose triggers. The IR is
  shaped to accept them; nothing is implemented.
- Persistent spatial anchors across sessions.
- Moving targets. Poses are frozen after detection (§2.1); a target that is picked up and moved
  updates only at the re-detection rate.

---

## 8. Later: native fast path

`IArsistImageRecognizer` sits behind the same interface, so an `ARTrackedImageManager`-backed
recognizer can be added for XREAL/ARCore without touching the IR, the editor, or user projects.
Worth doing only if the universal recognizer proves too slow or too jittery in practice — and it
must be measured against the universal path first, because divergent per-device behaviour is a real
cost to authors.

---

## 9. Relationship to the abstraction goal

This layer is the first time the IR can say *"this pose comes from the world, not from the author."*
The longer-term direction (a scene description keyed on real-world state rather than absolute
coordinates) is the same sentence with more `PerceptionTarget` types on the left-hand side. Keeping
`ObjectAnchor` general — a reference to a target id, not to an image — is what makes that possible
without an IR migration.
