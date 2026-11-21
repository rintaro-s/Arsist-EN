// ==============================================
// Arsist Engine - Media: virtual cameras (contract)
// Assets/Arsist/Runtime/Media/ArsistCameras.cs
//
// シーンに置いた仮想カメラ (IR の type: "camera"、camera 設定) の登録簿。doc/23-cameras-media.md。
// カメラは自分の RenderTexture に撮る。誰も使っていないカメラは撮らない (Require / Release)。
//
//   エンジン      UI の画像 (source.kind = "camera")・スクリプト (cameras.*) が使う
//   拡張機能      context.Cameras から。録画は Require してから Rendered で毎回の画を受け取る:
//
//       var cams = context.Cameras;
//       cams.Require("Cam", this);                       // 撮り始める (fps は IR の camera.fps)
//       cams.Rendered += (id, rt) => { if (id == "Cam") … AsyncGPUReadback.Request(rt) … };
//       cams.Release("Cam", this);                       // 撮り終わる
//
// id は IR の物の id でも assetId でもよい (どちらでも同じカメラ)。Rendered の id は IR の物の id。
// ==============================================

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arsist.Runtime.Media
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistCameras
    {
        public static ArsistCameras Instance { get; } = new ArsistCameras();

        private readonly Dictionary<string, ArsistVirtualCamera> _byId = new Dictionary<string, ArsistVirtualCamera>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _alias = new Dictionary<string, string>(StringComparer.Ordinal);

        /// <summary>撮れたあと (カメラの RenderTexture が新しくなったあと) に鳴る。id は IR の物の id。メインスレッド。</summary>
        public event Action<string, RenderTexture> Rendered;

        /// <summary>登録されているカメラの IR の id。</summary>
        public IReadOnlyCollection<string> Ids => _byId.Keys;

        /// <summary>カメラの RenderTexture。そのカメラが無ければ null。Require していなくても取れる (中身は古いかもしれない)。</summary>
        public RenderTexture GetTexture(string idOrAssetId) => Find(idOrAssetId)?.Texture;

        /// <summary>Unity の Camera (位置・画角を読む用)。無ければ null。</summary>
        public Camera GetCamera(string idOrAssetId) => Find(idOrAssetId)?.Camera;

        /// <summary>撮り始めてほしい。owner ごとに数え、全員が Release したら撮るのをやめる。カメラが無ければ false。</summary>
        public bool Require(string idOrAssetId, object owner)
        {
            var cam = Find(idOrAssetId);
            if (cam == null || owner == null) return false;
            cam.AddUser(owner);
            return true;
        }

        public void Release(string idOrAssetId, object owner)
        {
            var cam = Find(idOrAssetId);
            if (cam != null && owner != null) cam.RemoveUser(owner);
        }

        // ---- エンジンの中から ----

        internal void Register(ArsistVirtualCamera cam, string id, string assetId)
        {
            if (cam == null || string.IsNullOrEmpty(id)) return;
            _byId[id] = cam;
            if (!string.IsNullOrEmpty(assetId) && assetId != id) _alias[assetId] = id;
        }

        internal void Unregister(string id)
        {
            if (string.IsNullOrEmpty(id)) return;
            _byId.Remove(id);
            var stale = new List<string>();
            foreach (var kv in _alias) if (kv.Value == id) stale.Add(kv.Key);
            foreach (var k in stale) _alias.Remove(k);
        }

        internal void NotifyRendered(string id, RenderTexture rt)
        {
            var handler = Rendered;
            if (handler == null) return;
            try { handler(id, rt); }
            catch (Exception e) { Debug.LogError($"[Arsist] camera '{id}' Rendered handler threw: {e}"); }
        }

        internal ArsistVirtualCamera Find(string idOrAssetId)
        {
            if (string.IsNullOrEmpty(idOrAssetId)) return null;
            if (_byId.TryGetValue(idOrAssetId, out var cam) && cam != null) return cam;
            if (_alias.TryGetValue(idOrAssetId, out var id) && _byId.TryGetValue(id, out cam) && cam != null) return cam;
            return null;
        }
    }

    /// <summary>
    /// 声の大きさの受け渡し所。マイクを持つ拡張機能 (quest-input の mic など) が毎フレーム入れ、
    /// エンジン (character.embody の口パク) が読む。誰も入れていなければ 0。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public static class ArsistVoice
    {
        private static float _level;
        private static float _setAt = -1f;

        /// <summary>0..1。最後に入れてから 0.5 秒たつと 0 に戻る (マイクが止まったとき口が開いたままにならないように)。</summary>
        public static float Level => Time.unscaledTime - _setAt > 0.5f ? 0f : _level;

        /// <summary>最後に入れた拡張機能の id。</summary>
        public static string Source { get; private set; } = "";

        public static void SetLevel(float level01, string source)
        {
            _level = Mathf.Clamp01(level01);
            _setAt = Time.unscaledTime;
            Source = source ?? "";
        }
    }
}
