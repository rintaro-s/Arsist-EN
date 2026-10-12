# vrm10 — VRM 1.0 を実機で読む

エンジン標準の VRM の読み込みは UniVRM 0.x (`sdk/UniVRM-*.unitypackage`) で、**VRM 0.x しか読めない**。
今の VRoid Studio などが書き出す VRM 1.0 は、エディタの 3D ビューでは見えても、実機では出てこない。

この拡張機能を有効にすると、エンジンの「VRM の読み込み」を UniVRM 0.131.3 の VRM 1.0 用 (UniVRM10) に置き換える
(`extension.json` の `"replaces": ["vrm-loader"]`)。

- VRM 1.0 も VRM 0.x も読める (0.x は読み込み時に 1.0 に変換される)
- 表情 (`vrm.setExpression`)・まばたき・口の動き (`audio.play(…, { at })`)・視線 (`vrm.lookAt`、キャラクターの「こちらを見る」)・
  揺れもの (SpringBone)・人型の動き (`Assets/Animations/*.fbx`、`vrm.playAnimation` / `vrm.walkTo`) はそのまま使える
- 表情の名前は VRM 1.0 の名前 (`happy` `aa` `blink` …) でも VRM 0.x の名前 (`Joy` `A` `Blink` …) でもよい
- どの端末でも動く (端末の条件 `requires` は無い)

## 使い方

1. **公式の拡張機能** (エンジンに同梱、`Extensions/vrm10`) なので、登録しなくても拡張機能タブに「公式」として出る
2. プロジェクトで有効にする (拡張機能タブ → VRM 1.0 → 有効)。VRM 1.0 のモデルを置いたのに有効になっていなければ、
   インスペクタのキャラクターの欄にその旨と「有効にする」ボタンが出る
3. ビルドする。ログに次が出る:

```
[Arsist] Engine part 'vrm-loader' (VRM loading) is replaced by extension 'vrm10'; the engine's UniVRM 0.x (sdk/UniVRM-*.unitypackage) is left out of the build
[Arsist] VRM-0.131.3_011b.unitypackage from extension 'vrm10': 1797 file(s) written (Packages/com.vrmc.gltf, Packages/com.vrmc.vrm)
[Arsist] VRM models are loaded by extension 'vrm10' (engine UniVRM 0.x not imported)
```

実機のログ (`npm run logs`):

```
[Arsist:vrm10] replaces engine part 'vrm-loader' with Arsist.Extensions.Vrm10.Vrm10Loader
[ArsistVRMLoader] VRM loading is replaced by extension 'vrm10'
[Arsist:vrm10] loaded 'Sister' from …/VRM/Sis.vrm: VRM 1.0, humanoid=True, expressions=<数> (happy angry … blink …)
```

## 中身

| ファイル | |
|---|---|
| `Packages/VRM-0.131.3_011b.unitypackage` | UniVRM v0.131.3 のリリースにある VRM 1.0 用パッケージそのもの (SHA-256 `4de20729…988d90`、MIT ライセンス)。中身は `Packages/com.vrmc.gltf` (UniGLTF) と `Packages/com.vrmc.vrm` (UniVRM10)。ビルドが作業用の Unity プロジェクトに展開し、外れたら消す (`unity.unitypackages`) |
| `Runtime/Vrm10Extension.cs` | 入口。`ReplaceEngineParts` で読み込みを差し替える |
| `Runtime/Vrm10Loader.cs` | `IArsistVrmLoader`。`Vrm10.LoadBytesAsync` (VRM 0.x も可・コントロールリグあり) |
| `Runtime/Vrm10Face.cs` | `IArsistVrmFace` / `IArsistVrmEyes`。表情と目を UniVRM10 の仕組みで動かす |
| `Runtime/link.xml` | UniVRM10 のアセンブリを IL2CPP の削除から守る |

## 知っておくこと

- **置き換えている間、エンジンの UniVRM 0.x はビルドに入らない。** 同じ UniGLTF (`com.vrmc.gltf`) の 0.131.0 と 0.131.3 が
  ぶつかるため。有効を外すと、次のビルドでエンジンの UniVRM 0.x が元どおり取り込まれる。
- 人型の動きは「コントロールリグ」(UniVRM10 が作る正規化した骨) に当たる。Mixamo などの FBX はモデルの骨の向きに
  かかわらず同じように当たる。
- `com.vrmc.vrm` は Unity の Timeline パッケージ (`com.unity.timeline`) を使う。初めてのビルドでは Unity がレジストリから取る。
- UniVRM の版を変えるときは、同じリリースの `VRM-<版>.unitypackage` に差し替えて `extension.json` の `unitypackages` を直す。
