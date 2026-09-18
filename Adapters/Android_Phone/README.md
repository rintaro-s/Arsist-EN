# Android_Phone アダプタ

ヘッドセットの無い普通の Android 端末で、Quest / XREAL と同じシーンを動かすためのアダプタ。

## 何が違うか

| | ヘッドセット | スマホ (このアダプタ) |
|---|---|---|
| 見回し | 頭の向き (6DoF) | ジャイロ (3DoF、位置は追わない) |
| 現実の映像 | パススルー / 光学シースルー | 背面カメラを背景に敷く |
| XR SDK | Meta XR / XREAL | **使わない** |
| ビルドに要るもの | 各社 SDK | Unity の Android Build Support だけ (Gradle 同梱) |

## 動き

- `ArsistDeviceCamera` — 背面カメラを **一度だけ** 開く。Android は同じカメラを同時に一度しか
  開けないので、背景と画像処理はこれを共有する (別々に開くと片方が真っ黒になる)。
- `ArsistGyroCamera` — ジャイロでメインカメラを回す。ジャイロが無ければ画面をなぞって見回す。
  式は `Runtime/Tracking/GyroMath.cs` にあり、`npm run test:perception` で数値検証している。
- `ArsistCameraBackground` — 映像をシーンの奥に敷き、Unity カメラの画角を映像に合わせる。
- `ArsistPhoneStereo` — `phone.stereo` かつ VR のとき、段ボールゴーグル用に左右分割する。

## 設定

AR か VR かは **背景モード (`arSettings.backgroundMode`)** で決まる。二重に持つと食い違うので、
スマホ専用の設定には置いていない。

| 背景モード | スマホでの意味 |
|---|---|
| `passthrough` | 背面カメラの映像を背景に敷く (ビデオシースルー AR) |
| `skybox` / `solidColor` | 映像を出さず、シーンだけを見回す (VR) |

その他は `arSettings.phone`:

| キー | 既定 | |
|---|---|---|
| `stereo` | `false` | 左右分割 (VR のときだけ) |
| `cameraFov` | `63` | 背面カメラの横の画角 (度)。WebCamTexture は画角を教えてくれないので仮定値 |
| `orientation` | `landscape` | `landscape` / `portrait` |

## 限界 (正直に)

- **位置は追わない。** ジャイロで分かるのは向きだけ。歩いても景色は付いてこない。
- **画角は仮定値。** 端末ごとに数度ずれる。描いたものが映像の上を滑るなら `cameraFov` を直す。
  正確な値と 6DoF が要るなら、ARCore のある端末で AR Foundation を使うのが筋
  (`ArsistARFoundationCameraSource` が既にある)。
- **遠くのものに重ねる前提。** `ArsistWorldOverlay` は 60m 先に板を置くので、空や遠景には合うが、
  手元の机には視差でずれる。

## 何も起きないとき（最初に見るログ）

`npm run logs`（adb 不要）か `adb logcat | grep Arsist` で、起動直後に次の 1 行が出ているかを見る。

```
[Arsist] Perception camera source: Device camera (phone, shared)
```

| 出ているログ | 意味 |
|---|---|
| 上の行 | カメラの画は画像処理に届いている。以降は `Task 'sky' -> ...` の中身（値や `gated: 理由`）を見る |
| `No camera frame source available on this device` | 画像処理に画が届いていない。`ArsistPerceptionManager.SelectSource` がスマホのカメラを候補にしていない |
| `Device camera opened: ...` が無い | カメラ自体が開いていない。権限（設定 → アプリ → カメラ）を確認 |

**実際に一度踏んでいる。** スマホのカメラ供給を選ぶ処理が `#if UNITY_EDITOR || UNITY_STANDALONE` の中に
残っていて、Android では候補から丸ごと消えていた。画像処理エンジンには一度も画が届かず、
「一切青にならない」になった。ビルドは成功し、権限も正しかったので、ログを見るまで分からなかった。

## カクつく・反映が遅いとき

`npm run logs` で 5 秒ごとに次が出る。

```
[Arsist] Phone fps: 59.8 avg, worst frame 21 ms
```

| 見るところ | 目安 |
|---|---|
| avg | 60 前後 (画面が 90Hz なら 90)。30 に張り付いているなら fps の指定が効いていない |
| worst frame | 33ms を大きく超えて周期的に出るなら、どこかがメインスレッドを止めている |
| `Task 'sky' -> ... (N ms)` | 画像処理 1 回の時間。ワーカーで回るので描画は止めないが、更新の遅れにはなる |

**実際に一度踏んでいる。** 最初の版は、
- Unity の Android 既定 (30fps 固定) のままだった — ヘッドセット用リグは 60 を指定していたが、スマホ用には無かった
- 画像処理をメインスレッドで回し、1 回 100〜160ms 描画を止めていた
- 更新間隔が 2 秒 (下限 0.5 秒) で、塗ってから平均 1 秒反映されなかった

いずれも Arsist 側の問題で、端末の性能のせいではなかった。
