# ML Kit bundled OCR — Quest 3 spike (`tools/mlkit-spike/`)

The one thing `doc/12-ar-behaviors.md` cannot settle by reading documentation:

> **Does ML Kit Text Recognition v2 with the bundled model actually run on Meta Horizon OS,
> which has no Google Play Services?**

This is a throwaway project that answers exactly that and nothing else.

## What it deliberately does not use

No camera, no XR, no passthrough, no Arsist IR, no rectification. It builds as a **plain 2D Android
app**, which on Quest opens as a flat panel. Every omission removes a way for the spike to fail for a
reason that is not the question being asked.

It loads `Assets/StreamingAssets/ocr_test.png` (Latin + Japanese text), runs OCR on it, and prints the
result on screen and to logcat — along with the `GoogleApiAvailability` status code. **A successful read
with a non-zero status code is the evidence**: Play Services is absent and OCR worked anyway.

## Build

```bash
npm run spike:mlkit                 # -> tools/mlkit-spike/Build/MlkitOcrSpike.apk
```

or directly:

```bash
"$UNITY" -batchmode -quit -nographics \
  -projectPath tools/mlkit-spike -buildTarget Android \
  -executeMethod SpikeBuild.BuildFromCLI \
  -arsistOutput "$PWD/tools/mlkit-spike/Build/MlkitOcrSpike.apk" \
  -logFile /tmp/spike-build.log
```

The first build downloads the ML Kit artifacts from Google Maven (~20 MB) and takes a few minutes.

## Run on the headset

```bash
adb install -r tools/mlkit-spike/Build/MlkitOcrSpike.apk
adb shell am start -n com.arsist.mlkitocrspike/com.unity3d.player.UnityPlayerGameActivity
adb logcat -c && adb logcat | grep -E 'OcrSpike|ArsistMlkitOcr'
```

On the headset it appears under **Apps → Unknown Sources → MlkitOcrSpike** and opens as a 2D panel.

To be sure the device really has no Play Services:

```bash
adb shell pm list packages | grep -i gms      # expect: nothing
```

## Result: PASS (2026-09-06, Quest 3 / Horizon OS v207 / Android 14)

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

`pm list packages | grep com.google.android.gms` returned nothing on this device. Every line of the test
image came back correct — Latin and Japanese in one pass with the Japanese model — in 100 ms (two runs:
103 / 100 ms). **The question this spike existed to answer is answered.**

Two things learned while getting there, both now baked into the build script:

- **`runInBackground` must be on.** Launched over `adb shell am start` while the headset is in standby,
  the panel never gains focus, Unity never runs a frame, and `Awake`/`Start` never execute — the app sits
  there alive and completely silent. Nothing to do with ML Kit, but indistinguishable from it in a log.
- **Managed stripping must be off** (or the callbacks marked `public` + `[Preserve]`). `UnitySendMessage`
  resolves methods by name, so with no other reference they are prime candidates for removal, and the
  failure looks like "OCR never returns".

## What a pass looks like

```
[OcrSpike] GooglePlayServices availability code: 1   (0 = available)
[OcrSpike] image loaded 1000x520
[ArsistMlkitOcr] recognized in 240 ms, blocks=6
[OcrSpike] SUCCESS (240 ms)
ARSIST OCR TEST
Serial: QX-4821-B
...
```

Record the **latency** and whether **Japanese** came back correctly — both feed straight into
`doc/12-ar-behaviors.md` §5 and the language-model decision in §10.

## What a fail looks like, and what it would mean

| Symptom | Meaning |
|---------|---------|
| `MlKitException: Waiting for the text recognition model to be downloaded` | the *unbundled* path got linked — the dependency is wrong, not the platform |
| `UnsatisfiedLinkError: libmlkit_google_ocr_pipeline.so` | the native library was stripped or the ABI does not match |
| `SecurityException` / `GooglePlayServicesNotAvailableException` | the real bad case: some code path hard-requires GMS. Plan B is Tesseract or a cloud engine. |
| APK builds but crashes on start | unrelated to ML Kit — check `adb logcat` for IL2CPP/Unity errors first |

## Packaging — already verified, no device needed

The built APK (25 MB) was checked and contains:

| | |
|---|---|
| `lib/arm64-v8a/libmlkit_google_ocr_pipeline.so` | 11 MB — the OCR engine, in the APK |
| `assets/mlkit-google-ocr-models/…` | 34 model files, including `Jpan_ctc` (Japanese) and `Latn_ctc` |
| `com.google.mlkit.vision.DEPENDENCIES` metadata | **absent** — this is the marker for the *downloaded* model path, so nothing is fetched at install or first run |

Re-check any time with:

```bash
unzip -l tools/mlkit-spike/Build/MlkitOcrSpike.apk | grep -E 'ocr_pipeline|mlkit-google-ocr-models'
```

**One thing the packaging check cannot settle.** The merged manifest does contain
`com.google.android.gms.version` metadata and a `GoogleApiActivity`, pulled in by `play-services-base`.
In principle they are inert on a device with no Play Services — nothing reads them unless code calls
`GoogleApiAvailability` — but "in principle" is exactly the gap this spike exists to close. That is the
one question left for the headset.

## The two reusable pieces

Everything else here is disposable, but these two carry over to the real implementation:

- **`Assets/Plugins/Android/mainTemplate.gradle`** — Unity's own template, copied from the installed
  editor, with only the ML Kit dependency lines inserted before `**DEPS**`. This is how Arsist will add
  any Android Maven dependency. **It must stay ASCII**: Unity rewrites the file while substituting tokens
  and mangles non-ASCII bytes into `?`, producing invalid Groovy — and the resulting Gradle error points
  at the *launcher* module ("does not specify `compileSdk`"), nowhere near the real cause.
- **`Assets/Plugins/Android/ArsistMlkitOcr.java`** — the bridge shape: RGBA pixels in, text back via
  `UnityPlayer.UnitySendMessage` (which marshals to the Unity main thread for free). Note that the caller
  flips rows: Unity textures are bottom-up, Android bitmaps are top-down, and getting that wrong fails
  quietly — text is found but comes back as nonsense.
