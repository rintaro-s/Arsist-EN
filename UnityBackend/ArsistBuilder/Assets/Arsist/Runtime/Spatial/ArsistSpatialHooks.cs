// ==============================================
// Arsist Engine - Layster.Spatial: エンジン本体からの入口
// Assets/Arsist/Runtime/Spatial/ArsistSpatialHooks.cs
//
// エンジンの他の場所 (ScriptEngineManager・拡張機能の窓口) が Spatial に触れるのはここだけ。
// Spatial のプロジェクトかどうかは Resources/ArsistSpatial.json (ビルドが spatial.json から写す) の有無で決まる。
// Virtual のビルドにはこのファイルが無いので、どの入口も何もしない。
// ==============================================

using System.Collections.Generic;
using Arsist.Runtime.Scripting;
using UnityEngine;

namespace Arsist.Runtime.Spatial
{
    [UnityEngine.Scripting.Preserve]
    public static class ArsistSpatialHooks
    {
        /// <summary>Resources 内の名前 (拡張子なし)。ArsistBuildPipeline.CopySpatialToResources と合わせる。</summary>
        public const string ResourceName = "ArsistSpatial";

        private static bool _checked;
        private static string _json;

        /// <summary>spatial.json の中身。Spatial のプロジェクトでなければ null。</summary>
        public static string Json
        {
            get
            {
                if (!_checked)
                {
                    _checked = true;
                    var asset = Resources.Load<TextAsset>(ResourceName);
                    _json = asset != null && !string.IsNullOrEmpty(asset.text) ? asset.text : null;
                }
                return _json;
            }
        }

        public static bool IsSpatial => Json != null;

        /// <summary>
        /// スクリプトに `world` を出す (ScriptEngineManager.InitEngine から)。
        /// 中身 (WorldWrapper) は ArsistSpatialRuntime が出来てから働く。それまでの呼び出しは null / false を返す。
        /// </summary>
        public static void InstallScriptGlobals(Jint.Engine engine, JsBridge js)
        {
            if (!IsSpatial || engine == null) return;
            engine.SetValue("world", new WorldWrapper(js));
        }

        /// <summary>
        /// 端末に残す store のキーを足す (ScriptEngineManager.ApplyStorageSettings から)。
        /// "layster." = PC のアドレス (layster.edge) と、keep: forever の置き場所 (layster.place.*)。
        /// </summary>
        public static void AddPersistRules(List<string> rules)
        {
            if (!IsSpatial || rules == null) return;
            if (!rules.Contains("layster.")) rules.Add("layster.");
        }
    }
}
