// ==============================================
// Arsist Engine - Extensions: per-object extension data
// Assets/Arsist/Runtime/Extensions/ArsistObjectExt.cs
//
// IR のシーンの物に付いた ext.<拡張機能の id> を、実機の GameObject に持たせる入れ物。
// ビルド (ArsistBuildPipeline.CreateGameObject) が ext を持つ物にだけ付ける。
// エンジンは中身を解釈しない。読むのは各拡張機能 (ArsistExtensionContext.ObjectsWithData)。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Inference;
using UnityEngine;

namespace Arsist.Runtime.Extensions
{
    [UnityEngine.Scripting.Preserve]
    [DisallowMultipleComponent]
    public sealed class ArsistObjectExt : MonoBehaviour
    {
        private static readonly List<ArsistObjectExt> All = new List<ArsistObjectExt>();

        [Tooltip("IR のシーンの物の id")]
        public string objectId;

        [Tooltip("スクリプトから使う ID (無ければ名前)")]
        public string assetId;

        [Tooltip("IR の ext をそのまま JSON で")]
        [TextArea] public string json;

        private Dictionary<string, object> _parsed;

        private void Awake()
        {
            if (!All.Contains(this)) All.Add(this);
        }

        private void OnDestroy()
        {
            All.Remove(this);
        }

        /// <summary>この物に付いている、指定した拡張機能のデータ。無ければ空。</summary>
        public Dictionary<string, object> DataFor(string extensionId)
        {
            if (_parsed == null)
            {
                try
                {
                    _parsed = string.IsNullOrEmpty(json) ? new Dictionary<string, object>() : MiniJson.ParseObject(json);
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[Arsist] Extension data on '{name}' could not be read: {e.Message}");
                    _parsed = new Dictionary<string, object>();
                }
            }
            return MiniJson.Obj(_parsed, extensionId) ?? new Dictionary<string, object>();
        }

        public bool Has(string extensionId) => DataFor(extensionId).Count > 0;

        /// <summary>指定した拡張機能のデータを持つ物 (シーンで有効なものだけ)。</summary>
        public static IEnumerable<ArsistObjectExt> WithExtension(string extensionId)
        {
            // 列挙中に Destroy されても壊れないよう、写してから回す
            foreach (var item in All.ToArray())
            {
                if (item != null && item.Has(extensionId)) yield return item;
            }
        }

        /// <summary>IR の id か assetId で探す。</summary>
        public static ArsistObjectExt Find(string idOrAssetId)
        {
            if (string.IsNullOrEmpty(idOrAssetId)) return null;
            foreach (var item in All)
            {
                if (item == null) continue;
                if (item.objectId == idOrAssetId || item.assetId == idOrAssetId) return item;
            }
            return null;
        }
    }
}
