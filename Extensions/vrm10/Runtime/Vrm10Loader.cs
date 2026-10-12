// ==============================================
// vrm10 — VRM のバイト列 → モデル (UniVRM10)
// Extensions/vrm10/Runtime/Vrm10Loader.cs
//
// エンジンの IArsistVrmLoader の実装。エンジン (ArsistVRMLoaderTask) は、できたモデルを物の下に置き、
// 表情・視線・骨・キャラクターの部品を付ける。ここがするのは
//   - Vrm10.LoadBytesAsync で読む (VRM 0.x は変換して読む)
//   - 人型の Animator は「コントロールリグ」(正規化した骨) に向ける。人型の動き (Mixamo の FBX など) は
//     どのモデルでも同じ骨の向きで当たり、UniVRM10 が毎フレーム本当の骨に写す
//   - 表情と目は UniVRM10 の仕組みを通す (Vrm10Face)。BlendShape を直接触ると UniVRM10 に上書きされる
// ==============================================

using System;
using System.Collections;
using System.Reflection;
using System.Threading.Tasks;
using Arsist.Runtime.Extensions;
using Arsist.Runtime.VRM;
using UniVRM10;
using UnityEngine;

namespace Arsist.Extensions.Vrm10
{
    [UnityEngine.Scripting.Preserve]
    public sealed class Vrm10Loader : IArsistVrmLoader
    {
        /// <summary>大きなモデル (テクスチャが多い) でも終わる長さ。止まったままにしない。</summary>
        private const float TimeoutSeconds = 180f;

        private readonly ArsistExtensionContext _context;

        public Vrm10Loader(ArsistExtensionContext context)
        {
            _context = context;
        }

        public IEnumerator Load(byte[] data, string source, Action<GameObject> onLoaded, Action<string> onError)
        {
            if (data == null || data.Length == 0)
            {
                onError?.Invoke("VRM data is empty");
                yield break;
            }

            var spec = "VRM 1.0";
            Task<Vrm10Instance> task;
            try
            {
                task = StartLoading(data, (thumbnail, vrm10Meta, vrm0Meta) =>
                {
                    if (vrm10Meta == null && vrm0Meta != null) spec = "VRM 0.x (converted to 1.0 on load)";
                });
            }
            catch (Exception e)
            {
                var inner = e is TargetInvocationException tie && tie.InnerException != null ? tie.InnerException : e;
                onError?.Invoke($"UniVRM10 could not start loading {source}: {inner.Message}");
                yield break;
            }

            var started = Time.realtimeSinceStartup;
            while (!task.IsCompleted)
            {
                if (Time.realtimeSinceStartup - started > TimeoutSeconds)
                {
                    onError?.Invoke($"UniVRM10 did not finish loading {source} within {TimeoutSeconds:F0} s");
                    yield break;
                }
                yield return null;
            }

            if (task.IsFaulted || task.IsCanceled)
            {
                var why = task.Exception?.GetBaseException().Message ?? "cancelled";
                onError?.Invoke($"UniVRM10 could not load {source}: {why}");
                yield break;
            }

            var instance = task.Result;
            if (instance == null)
            {
                onError?.Invoke($"UniVRM10 returned no model for {source}");
                yield break;
            }

            // コントロールリグを、読み込んだ直後の T ポーズのうちに作らせる (Runtime は最初に触ったときに作られる)。
            // 放っておくと最初の LateUpdate で作られるが、その前にエンジンが動き (Idle) を当てていると
            //   - リグが「動いた後の姿勢」を T ポーズだと思って作られ、以後の動きが歪む
            //   - Animator の avatar がリグに替わり、再生中の動きが最初の空の状態に戻る (= T ポーズのまま)
            // 2026-10-12 に Quest 3 で T ポーズのまま動かず、エディタで同じ順番にして再現した。
            var runtime = instance.Runtime;
            var root = instance.gameObject;
            var face = root.GetComponent<Vrm10Face>();
            if (face == null) face = root.AddComponent<Vrm10Face>();
            var animator = root.GetComponent<Animator>();
            _context.Log(
                $"loaded '{root.name}' from {source}: {spec}, humanoid={(animator != null && animator.isHuman)}, controlRig={(runtime.ControlRig != null)}, " +
                $"expressions={face.ExpressionNames.Count} ({string.Join(" ", face.ExpressionNames)})");
            onLoaded?.Invoke(root);
        }

        /// <summary>
        /// Vrm10.LoadBytesAsync(byte[] …) を呼ぶ。直接呼ばずにリフレクションで呼ぶのは、引数の型の一部
        /// (IAwaitCaller など) が UniGLTF.Utils にあり、そのアセンブリは自動では参照されない (autoReferenced: false) ため。
        /// 拡張機能の C# は Assembly-CSharp に入るので、参照を足す手段が無い。省いた引数は UniVRM の既定値
        /// (実行中は RuntimeOnlyAwaitCaller・組み込みのレンダーパイプライン用のマテリアル)。
        /// </summary>
        private static Task<Vrm10Instance> StartLoading(byte[] data, UniVRM10.Vrm10.VrmMetaInformationCallback onMeta)
        {
            MethodInfo method = null;
            foreach (var m in typeof(UniVRM10.Vrm10).GetMethods(BindingFlags.Public | BindingFlags.Static))
            {
                if (m.Name != "LoadBytesAsync") continue;
                var ps = m.GetParameters();
                if (ps.Length > 0 && ps[0].ParameterType == typeof(byte[])) { method = m; break; }
            }
            if (method == null) throw new MissingMethodException("UniVRM10.Vrm10.LoadBytesAsync(byte[] …) was not found");

            var parameters = method.GetParameters();
            var args = new object[parameters.Length];
            for (int i = 0; i < parameters.Length; i++)
            {
                var p = parameters[i];
                switch (p.Name)
                {
                    case "bytes": args[i] = data; break;
                    case "canLoadVrm0X": args[i] = true; break;
                    case "controlRigGenerationOption": args[i] = ControlRigGenerationOption.Generate; break;
                    case "showMeshes": args[i] = true; break;
                    case "vrmMetaInformationCallback": args[i] = onMeta; break;
                    default: args[i] = p.HasDefaultValue ? p.DefaultValue : null; break;
                }
            }
            return (Task<Vrm10Instance>)method.Invoke(null, args);
        }
    }
}
