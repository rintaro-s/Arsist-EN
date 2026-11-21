// ==============================================
// Arsist Engine - Layster.Spatial: 世界の状態を埋めるもの (provider)
// Assets/Arsist/Runtime/Spatial/SpatialProviders.cs
//
// 端末ごとの違いは「世界の状態を誰が埋めるか」だけ (doc/19-layster.md §3.10)。
// 拡張機能は ArsistExtensionContext.Spatial.AddProvider(...) で provider を足す (例: quest-room の MRUK)。
// provider は Unity の座標で見つけたものを、SpatialProviderContext の小道具で entity にして書く。
// 呼ばれるのはすべてメインスレッド。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Spatial.Core;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    /// <summary>世界の状態に entity を書くもの。</summary>
    public interface ISpatialProvider
    {
        /// <summary>ログと出どころの既定に使う名前</summary>
        string Id { get; }

        /// <summary>ランタイムが動き出したら 1 回 (座標の変換はもう使える)。</summary>
        void Begin(SpatialProviderContext context);

        /// <summary>毎フレーム。軽くしておくこと (変わったときだけ書く)。</summary>
        void Tick(SpatialProviderContext context);
    }

    /// <summary>
    /// 本物の物 (壁・家具) の形を「隠すための形」として出せる provider が持つ能力 (任意)。
    /// occlusion: "auto" の物は、ここで出した箱の向こうにあると隠れる (深度だけ書く箱。SpatialOcclusion)。
    /// 持っている provider が無ければ何も隠れない (現実が分からない端末では、隠す理由も無い)。
    /// </summary>
    public interface ISpatialOccluderSource
    {
        /// <summary>形が変わるたびに増やす (ランタイムはこれが変わったときだけ作り直す)</summary>
        int OccluderVersion { get; }

        /// <summary>今の形を into に足す。呼ばれるのはメインスレッド。</summary>
        void CollectOccluders(List<SpatialOccluder> into);
    }

    /// <summary>
    /// 隠すための箱 1 つ。Parent があればその子 (アンカーが動けば一緒に動く)、無ければ Unity の world。
    /// 面 (壁) は厚みを裏側 (部屋の外) に持たせること。表がちょうど面になるように (物が壁に貼り付いても欠けない)。
    /// </summary>
    public struct SpatialOccluder
    {
        public Transform Parent;
        public Vector3 Center;
        public Quaternion Rotation;
        public Vector3 Size;
    }

    /// <summary>provider に渡す窓口。座標の変換と、世界の状態への読み書き。</summary>
    public sealed class SpatialProviderContext
    {
        private readonly ArsistSpatialRuntime _runtime;

        internal SpatialProviderContext(ArsistSpatialRuntime runtime)
        {
            _runtime = runtime;
        }

        /// <summary>起動からの秒</summary>
        public double Now => _runtime.Now;

        public SpatialFrames Frames => _runtime.Frames;

        public Vec3 FromUnity(Vector3 p) => _runtime.Frames.FromUnity(p);

        /// <summary>言葉を語彙の正規の言葉に ('TABLE' → 'table'、'storage' → 'shelf')。</summary>
        public string Canonical(string word) => _runtime.Model.Vocabulary.Canonical(word);

        /// <summary>
        /// 向きのある箱 (Unity の中心・回転・ローカルの大きさ) を entity にする。
        /// 箱の軸のうち一番鉛直に近いものを高さ、残り 2 つを幅 (x) と奥行き (z) にし、奥行きの軸の水平の向きを yaw にする。
        /// 平面 (壁) は奥行き 0 の箱で、その軸 (法線) を部屋の内側に向けて渡すこと (MRUK の forward がそれ)。
        /// </summary>
        public Entity Box(string id, string[] words, Vector3 center, Quaternion rotation, Vector3 localSize, double confidence, string source = "scan")
        {
            var axes = new[] { rotation * Vector3.right, rotation * Vector3.up, rotation * Vector3.forward };
            var sizes = new[] { Mathf.Abs(localSize.x), Mathf.Abs(localSize.y), Mathf.Abs(localSize.z) };
            int up = 0;
            float best = -1;
            for (int i = 0; i < 3; i++)
            {
                float d = Mathf.Abs(Vector3.Dot(axes[i], Vector3.up));
                if (d > best + 1e-4f) { best = d; up = i; }
            }
            int a = up == 0 ? 1 : 0;
            int c = up == 2 ? 1 : 2;
            var depthAxis = axes[c];
            var e = new Entity
            {
                Id = id,
                At = FromUnity(center),
                Yaw = _runtime.Frames.YawFromForward(depthAxis),
                Size = new Vec3(sizes[a], sizes[up], sizes[c]),
                Confidence = confidence,
                Source = source,
                SeenAt = Now,
            };
            foreach (var w in words) if (!string.IsNullOrEmpty(w)) e.Is.Add(Canonical(w));
            return e;
        }

        public void Upsert(Entity entity) => _runtime.World.Upsert(entity, Now);

        public void Remove(string id) => _runtime.World.Remove(id);

        /// <summary>その出どころの entity のうち、keep に無いものを消す (部屋を読み直したとき)。</summary>
        public void RemoveSource(string source, HashSet<string> keep) => _runtime.World.RemoveSource(source, keep);

        /// <summary>床の Unity での高さが分かった。</summary>
        public void ReportFloor(float unityY, double confidence, string from) => _runtime.Frames.ReportFloor(unityY, confidence, from);

        /// <summary>部屋を読み終えた (置き直しの待ち時間をここで終える)。</summary>
        public void Ready(string from) => _runtime.ProviderReady(from);

        public void Log(string message) => Debug.Log($"[Layster] {message}");
    }

    /// <summary>provider の登録簿。拡張機能はランタイムより先に足してよい (OnStart の順は決まっていない)。</summary>
    [UnityEngine.Scripting.Preserve]
    public static class SpatialProviders
    {
        private static readonly List<ISpatialProvider> List = new List<ISpatialProvider>();

        /// <summary>足されたとき (ランタイムが動いていればすぐ Begin する)。</summary>
        internal static event Action<ISpatialProvider> Added;

        public static void Add(ISpatialProvider provider)
        {
            if (provider == null || List.Contains(provider)) return;
            List.Add(provider);
            Debug.Log($"[Layster] provider added: {provider.Id}");
            Added?.Invoke(provider);
        }

        public static IReadOnlyList<ISpatialProvider> All => List;
    }

    /// <summary>拡張機能から見た Spatial (ArsistExtensionContext.Spatial)。</summary>
    [UnityEngine.Scripting.Preserve]
    public sealed class SpatialAccess
    {
        public static readonly SpatialAccess Instance = new SpatialAccess();

        /// <summary>このアプリが Layster.Spatial のプロジェクトか (Virtual なら false。provider を足しても何も起きない)。</summary>
        public bool Active => ArsistSpatialHooks.IsSpatial;

        public void AddProvider(ISpatialProvider provider) => SpatialProviders.Add(provider);
    }

    // ========================================
    // 組み込みの provider
    // ========================================

    /// <summary>
    /// 仮の床。どの端末でも置き方が解けるように、いつも足元に床を 1 枚置く (確かさ 0.3、出どころ assumed)。
    /// 確かな床 (0.5 以上) が他から来たら消える。ユーザーが 2 m 動いたら足元へ付いて行く。
    /// </summary>
    internal sealed class AssumedFloorProvider : ISpatialProvider
    {
        public const string EntityId = "assumed-floor";
        private Vec3 _center;
        private bool _present;

        public string Id => "assumed-floor";

        public void Begin(SpatialProviderContext context) { }

        public void Tick(SpatialProviderContext context)
        {
            var runtime = ArsistSpatialRuntime.Instance;
            if (runtime == null) return;
            bool realFloor = false;
            foreach (var e in runtime.World.Entities())
            {
                if (e.Id == EntityId) continue;
                if (e.Confidence >= 0.5 && e.Is.Count > 0 && runtime.Model.Vocabulary.Canonical(e.Is[0]) == "floor") { realFloor = true; break; }
            }
            if (realFloor)
            {
                if (_present) { context.Remove(EntityId); _present = false; }
                return;
            }
            var feet = runtime.User.Feet;
            if (_present && SpatialMath.HorizontalDistance(feet, _center) < 2) return;
            _center = new Vec3(feet.X, 0, feet.Z);
            var e2 = new Entity
            {
                Id = EntityId, At = _center, Yaw = 0, Size = new Vec3(8, 0, 8),
                Confidence = runtime.Frames.FloorKnown ? 0.45 : 0.3, Source = "assumed", SeenAt = context.Now,
            };
            e2.Is.Add("floor");
            context.Upsert(e2);
            _present = true;
        }
    }
}
