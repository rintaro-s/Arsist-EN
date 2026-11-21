// ==============================================
// Arsist Engine - Media: UI の画像に「映すもの」を出す
// Assets/Arsist/Runtime/Media/ArsistMediaImage.cs
//
// UI の Image 要素の source (doc/23-cameras-media.md):
//   { kind: "camera", camera: "<物の id か assetId>", mirror }   仮想カメラの RenderTexture をそのまま
//   { kind: "stream", url: "http://{store:pc.address}/stream/slides", mirror }   MJPEG の配信 (MjpegStream)
//
// 要素そのもの (Image、assetPath の画像) はそのまま残し、子の RawImage ("Media") に映す。
// ui.setSource(id, null) で子を隠すと元の画像に戻る。子は AspectRatioFitter (FitInParent) で、
// 画の縦横比のまま要素の中に収める (はみ出さない)。映すものがまだ無い間は要素いっぱいの灰色。
//
// mirror は左右反転 (uvRect の幅を負に)。カメラの画は「鏡」に、配信の画は向かい合わせの表示に使う。
// 配信の状態は store の media.<bindingId>.status / media.<bindingId>.fps にも書く (変わったときだけ)。
// {store:key} の値が変わったら、つなぎ直す。
//
// ビルド (ArsistBuildPipeline.CreateUIElement の Image) が付けて sourceJson を入れる。
// スクリプトの ui.setSource が付けることもある。直列化するフィールドは #if の外。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.DataFlow;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace Arsist.Runtime.Media
{
    [UnityEngine.Scripting.Preserve]
    [DisallowMultipleComponent]
    public sealed class ArsistMediaImage : MonoBehaviour
    {
        [SerializeField] public string bindingId = "";
        /// <summary>IR の source (JSON)。空なら何も映さない。</summary>
        [SerializeField] public string sourceJson = "";

        private static readonly Color WaitingColor = new Color(0.32f, 0.34f, 0.38f, 1f);

        // ---- 今の source ----
        public string Kind { get; private set; } = "";
        public string CameraId { get; private set; } = "";
        public string UrlTemplate { get; private set; } = "";
        public bool Mirror { get; private set; }

        private RawImage _raw;
        private AspectRatioFitter _fitter;
        private MjpegStream _stream;
        private bool _cameraRequired;
        private string _requiredCamera;
        private float _nextResolveAt;
        private string _lastStatus, _lastFps;
        private bool _initialized;

        /// <summary>waiting / connecting / live / error: … (source が無ければ "none")。</summary>
        public string Status
        {
            get
            {
                if (string.IsNullOrEmpty(Kind)) return "none";
                if (Kind == "camera") return ArsistCameras.Instance.Find(CameraId) != null ? "live" : "waiting";
                return _stream?.Status ?? "waiting";
            }
        }

        public float Fps => Kind == "stream" ? (_stream?.Fps ?? 0f) : 0f;

        /// <summary>この要素の source を (無ければ付けて) 取る。</summary>
        public static ArsistMediaImage Ensure(GameObject element)
        {
            if (element == null) return null;
            var m = element.GetComponent<ArsistMediaImage>();
            if (m == null) m = element.AddComponent<ArsistMediaImage>();
            return m;
        }

        private void Awake()
        {
            if (string.IsNullOrEmpty(bindingId))
            {
                var reg = GetComponent<Arsist.Runtime.Scripting.UiBindingRegistry>();
                bindingId = reg != null && !string.IsNullOrEmpty(reg.bindingId) ? reg.bindingId : name;
            }
            Init();
            if (!string.IsNullOrEmpty(sourceJson)) ApplyJson(sourceJson);
        }

        private void Init()
        {
            if (_initialized) return;
            _initialized = true;
            var child = Arsist.Runtime.UI.ArsistUiLayers.CreateChild("Media", transform);
            var rt = child.AddComponent<RectTransform>();
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.offsetMin = rt.offsetMax = Vector2.zero;
            rt.pivot = new Vector2(0.5f, 0.5f);
            _raw = child.AddComponent<RawImage>();
            _raw.raycastTarget = false;
            _raw.color = WaitingColor;
            _fitter = child.AddComponent<AspectRatioFitter>();
            _fitter.aspectMode = AspectRatioFitter.AspectMode.FitInParent;
            _fitter.enabled = false;
            child.SetActive(false);
        }

        // ---- source を変える ----

        public void ApplyJson(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) { Clear(); return; }
            try
            {
                var o = JObject.Parse(json);
                Set(o["kind"]?.ToString(), o["camera"]?.ToString(), o["url"]?.ToString(),
                    o["mirror"]?.Type == JTokenType.Boolean && o["mirror"].Value<bool>());
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] UI image '{bindingId}': source is unreadable ({e.Message}): {json}");
            }
        }

        /// <summary>source を変える。kind が camera / stream でなければ消す (元の画像に戻る)。</summary>
        public void Set(string kind, string camera, string url, bool mirror)
        {
            Init();
            kind = (kind ?? "").Trim().ToLowerInvariant();
            if (kind != "camera" && kind != "stream") { Clear(); return; }

            ReleaseCamera();
            if (kind != "stream" && _stream != null) { _stream.Dispose(); _stream = null; }

            Kind = kind;
            CameraId = kind == "camera" ? (camera ?? "") : "";
            UrlTemplate = kind == "stream" ? (url ?? "") : "";
            Mirror = mirror;
            _nextResolveAt = 0f;
            _raw.gameObject.SetActive(true);
            ShowWaiting();
            if (kind == "stream")
            {
                if (_stream == null) _stream = new MjpegStream();
                _stream.SetUrl(null);
            }
            Debug.Log($"[Arsist] UI image '{bindingId}': source {kind} {(kind == "camera" ? CameraId : UrlTemplate)}{(mirror ? " (mirror)" : "")}");
            WriteStatus(true);
        }

        /// <summary>映すのをやめて、元の画像に戻る。</summary>
        public void Clear()
        {
            Init();
            ReleaseCamera();
            if (_stream != null) { _stream.Dispose(); _stream = null; }
            Kind = CameraId = UrlTemplate = "";
            _raw.texture = null;
            _raw.gameObject.SetActive(false);
            WriteStatus(true);
        }

        // ---- 毎フレーム ----

        private void OnEnable()
        {
            _nextResolveAt = 0f;
        }

        private void OnDisable()
        {
            // 見えていない間はカメラを撮らせない・配信を読まない
            ReleaseCamera();
            _stream?.SetUrl(null);
        }

        private void Update()
        {
            if (string.IsNullOrEmpty(Kind) || _raw == null) return;
            if (Kind == "camera") UpdateCamera();
            else UpdateStream();
            WriteStatus(false);
        }

        private void UpdateCamera()
        {
            var cams = ArsistCameras.Instance;
            var rt = cams.GetTexture(CameraId);
            if (rt == null)
            {
                ReleaseCamera();
                ShowWaiting();
                return;
            }
            if (!_cameraRequired || _requiredCamera != CameraId)
            {
                ReleaseCamera();
                _cameraRequired = cams.Require(CameraId, this);
                _requiredCamera = CameraId;
            }
            Show(rt, rt.width, rt.height);
        }

        private void UpdateStream()
        {
            if (_stream == null) _stream = new MjpegStream();
            if (Time.unscaledTime >= _nextResolveAt)
            {
                // {store:key} の値が変わったらつなぎ直す (SetUrl は同じ URL なら何もしない)
                _nextResolveAt = Time.unscaledTime + 0.5f;
                _stream.SetUrl(MediaUrlTemplate.Resolve(UrlTemplate, StoreText));
            }
            _stream.Tick();
            if (_stream.HasFrame) Show(_stream.Texture, _stream.Width, _stream.Height);
            else ShowWaiting();
        }

        private static string StoreText(string key)
        {
            if (!ArsistDataStore.Instance.TryGetValueByPath(key, out var v) || v == null) return null;
            return Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture);
        }

        private void Show(Texture tex, int w, int h)
        {
            if (_raw.texture != tex) _raw.texture = tex;
            _raw.color = Color.white;
            _raw.uvRect = Mirror ? new Rect(1f, 0f, -1f, 1f) : new Rect(0f, 0f, 1f, 1f);
            if (w > 0 && h > 0)
            {
                float aspect = (float)w / h;
                if (!_fitter.enabled) _fitter.enabled = true;
                if (!Mathf.Approximately(_fitter.aspectRatio, aspect)) _fitter.aspectRatio = aspect;
            }
        }

        private void ShowWaiting()
        {
            if (_raw == null) return;
            _raw.texture = null;
            _raw.color = WaitingColor;
            if (_fitter.enabled)
            {
                _fitter.enabled = false;
                var rt = (RectTransform)_raw.transform;
                rt.anchorMin = Vector2.zero;
                rt.anchorMax = Vector2.one;
                rt.offsetMin = rt.offsetMax = Vector2.zero;
            }
        }

        private void ReleaseCamera()
        {
            if (_cameraRequired && !string.IsNullOrEmpty(_requiredCamera)) ArsistCameras.Instance.Release(_requiredCamera, this);
            _cameraRequired = false;
            _requiredCamera = null;
        }

        private void WriteStatus(bool force)
        {
            if (string.IsNullOrEmpty(bindingId)) return;
            var status = Status;
            if (force || status != _lastStatus)
            {
                _lastStatus = status;
                ArsistDataStore.Instance.SetValue($"media.{bindingId}.status", status);
            }
            if (Kind == "stream")
            {
                var fps = Fps.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture);
                if (force || fps != _lastFps)
                {
                    _lastFps = fps;
                    ArsistDataStore.Instance.SetValue($"media.{bindingId}.fps", (double)Math.Round(Fps, 1));
                }
            }
        }

        private void OnDestroy()
        {
            ReleaseCamera();
            _stream?.Dispose();
            _stream = null;
        }
    }
}
