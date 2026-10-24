// ==============================================
// Arsist Engine - Extensions: what an extension may touch
// Assets/Arsist/Runtime/Extensions/ArsistExtensionContext.cs
//
// 拡張機能がエンジンに触れる窓口はこれ 1 つ。ここに無いものに触りたくなったら、
// エンジン側にここから使える口を足す (拡張機能からエンジンの内部を直接いじらない)。
// そうしておけば、エンジンの中を作り変えても拡張機能は壊れない。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.DataFlow;
using Arsist.Runtime.Inference;
using Arsist.Runtime.Scripting;
using UnityEngine;

namespace Arsist.Runtime.Extensions
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistExtensionContext
    {
        private readonly HashSet<string> _tags;

        internal ArsistExtensionContext(
            string id,
            int dataVersion,
            Dictionary<string, object> settings,
            IEnumerable<string> deviceTags,
            IEnumerable<string> features,
            string targetDevice)
        {
            Id = id;
            DataVersion = dataVersion;
            Settings = settings ?? new Dictionary<string, object>();
            DeviceTags = new List<string>(deviceTags ?? Array.Empty<string>());
            Features = new List<string>(features ?? Array.Empty<string>());
            TargetDevice = targetDevice ?? "";
            _tags = new HashSet<string>(DeviceTags, StringComparer.OrdinalIgnoreCase);
            foreach (var f in Features) _tags.Add(f);
        }

        /// <summary>extension.json の id。</summary>
        public string Id { get; }

        /// <summary>保存されていた設定の版 (extension.json の data.version)。</summary>
        public int DataVersion { get; }

        /// <summary>
        /// プロジェクトの設定 (既定値の上にプロジェクトの値を重ねたもの)。
        /// 値は JSON をそのまま読んだ形 (bool / double / string / List&lt;object&gt; / Dictionary)。
        /// </summary>
        public Dictionary<string, object> Settings { get; }

        /// <summary>この端末のタグ (adapter.json 由来 + ビルド時の sdk:*)。</summary>
        public IReadOnlyList<string> DeviceTags { get; }

        /// <summary>このアプリが使っているエンジンの機能 (feature:*)。</summary>
        public IReadOnlyList<string> Features { get; }

        /// <summary>ビルドしたときの targetDevice (Adapters/ のフォルダ名)。</summary>
        public string TargetDevice { get; }

        /// <summary>コルーチンを回すための MonoBehaviour (ArsistExtensionHost)。OnStart から使える。</summary>
        public MonoBehaviour Host { get; internal set; }

        public bool HasTag(string tag) => !string.IsNullOrEmpty(tag) && _tags.Contains(tag);

        // ---- 設定 ----

        public bool GetBool(string key, bool fallback) => MiniJson.Bool(Settings, key, fallback);
        public float GetFloat(string key, float fallback) => (float)MiniJson.Number(Settings, key, fallback);
        public int GetInt(string key, int fallback) => MiniJson.Int(Settings, key, fallback);
        public string GetString(string key, string fallback) => MiniJson.Text(Settings, key, fallback);

        // ---- 値の置き場 (UI の bind / スクリプトの store と同じ入れ物) ----

        /// <summary>ArsistDataStore に書く。UI の bind はその場で追従する。</summary>
        public void SetStore(string key, object value)
        {
            if (string.IsNullOrEmpty(key)) return;
            ArsistDataStore.Instance.SetValue(key, value);
        }

        public object GetStore(string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            return ArsistDataStore.Instance.TryGetValueByPath(key, out var value) ? value : null;
        }

        /// <summary>
        /// スクリプトのイベントを鳴らす。trigger が { type: "event", value: name } のスクリプトが走る。
        /// 名前は `<拡張機能の id>:<何が起きたか>` にする (例: "quest-room:ready")。
        /// </summary>
        public void FireEvent(string name)
        {
            if (string.IsNullOrEmpty(name)) return;
            ArsistScriptEvent.Fire(name, warnIfUnhandled: false);
        }

        // ---- シーンの物 ----

        /// <summary>この拡張機能の指定 (IR の ext.&lt;id&gt;) を持っている物。</summary>
        public IEnumerable<ArsistObjectExt> ObjectsWithData() => ArsistObjectExt.WithExtension(Id);

        /// <summary>その物に付いている、この拡張機能の指定。無ければ空。</summary>
        public Dictionary<string, object> ObjectData(ArsistObjectExt obj) =>
            obj != null ? obj.DataFor(Id) : new Dictionary<string, object>();

        /// <summary>
        /// 物を探す。IR の id → スクリプトで使う assetId (SceneWrapper の登録) → GameObject の名前の順。
        /// </summary>
        public GameObject FindObject(string idOrAssetId)
        {
            if (string.IsNullOrEmpty(idOrAssetId)) return null;
            var tagged = ArsistObjectExt.Find(idOrAssetId);
            if (tagged != null) return tagged.gameObject;

            var scene = ScriptEngineManager.Instance != null ? ScriptEngineManager.Instance.SceneWrapper : null;
            if (scene != null && scene.TryGetObject(idOrAssetId, out var registered)) return registered;

            return GameObject.Find(idOrAssetId);
        }

        // ---- Layster.Spatial ----

        /// <summary>
        /// 空間 (Layster.Spatial) の窓口。provider (世界の状態を埋めるもの) を足す:
        /// <c>if (context.Spatial.Active) context.Spatial.AddProvider(new MyProvider());</c>
        /// Virtual のプロジェクトでは Active が false で、足しても何も起きない。doc/20-spatial-runtime.md §3。
        /// </summary>
        public Arsist.Runtime.Spatial.SpatialAccess Spatial => Arsist.Runtime.Spatial.SpatialAccess.Instance;

        // ---- ログ (npm run logs にも流れる) ----

        public void Log(string message) => Debug.Log($"[Arsist:{Id}] {message}");
        public void Warn(string message) => Debug.LogWarning($"[Arsist:{Id}] {message}");
        public void Error(string message) => Debug.LogError($"[Arsist:{Id}] {message}");
    }
}
