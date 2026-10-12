// ==============================================
// vrm10 — VRM 1.0 を実機で読む (エンジンの VRM の読み込みを置き換える)
// Extensions/vrm10/Runtime/Vrm10Extension.cs
//
// エンジン標準の VRM の読み込みは UniVRM 0.x で、VRM 0.x しか読めない。この拡張機能は
// extension.json の "replaces": ["vrm-loader"] で、それを UniVRM 0.131.3 の VRM 1.0 用 (UniVRM10) に置き換える。
// UniVRM10 は VRM 0.x も読み込み時に 1.0 に変換して読むので、プロジェクトの VRM はどちらの形式でもよい。
//
// UniVRM10 そのものは Packages/VRM-0.131.3_011b.unitypackage (unity.unitypackages) で、ビルドが
// 作業用の Unity プロジェクトに展開する (Packages/com.vrmc.gltf と Packages/com.vrmc.vrm)。
// 置き換えている間、エンジンの UniVRM 0.x はビルドに入らない (UniGLTF の版違いがぶつかるため)。
// ==============================================

using Arsist.Runtime.Extensions;
using Arsist.Runtime.VRM;

namespace Arsist.Extensions.Vrm10
{
    [UnityEngine.Scripting.Preserve]
    public sealed class Vrm10Extension : ArsistRuntimeExtension
    {
        public override string Id => "vrm10";

        public override void ReplaceEngineParts(ArsistEngineParts.Replacer parts, ArsistExtensionContext context)
        {
            parts.Replace<IArsistVrmLoader>(ArsistEngineParts.VrmLoader, new Vrm10Loader(context));
        }
    }
}
