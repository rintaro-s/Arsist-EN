// ==============================================
// Arsist Engine - Layster.Spatial: ランタイムが自分で出す表示
// Assets/Arsist/Runtime/Spatial/SpatialUi.cs
//
//   字幕       say.text を出すパネルがプロジェクトに無いとき、視界の下に 1 行
//   確認       体への命令 (confirm: always)・記録の同意。目の前 0.8 m に「はい / いいえ」
//   強調       entity・物を枠 (線の箱) で囲み、上に札
//   体の範囲   twin.showWorkspace の体の、動ける範囲の箱
// どれも World Space の Canvas / LineRenderer を実行時に作る。レイヤーは ArsistUiLayers の約束どおり
// "UI" に揃える (new GameObject は Default になり、HUD のカメラの後ろに隠れることがある)。
// 押す仕組みはエンジンのボタンと同じ (Image + Button + ArsistGazeTarget。ArsistUiPointer が Canvas の矩形に当てる)。
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using Arsist.Runtime.Spatial.Core;
using Arsist.Runtime.UI;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Arsist.Runtime.Spatial
{
    public sealed class SpatialUi
    {
        private const float PixelSize = 0.001f; // 1 px = 1 mm
        private readonly ArsistSpatialRuntime _rt;
        private readonly int _layer;
        private Material _lineMaterial;
        private GameObject _subtitle;
        private TextMeshProUGUI _subtitleText;
        private float _subtitleUntil;
        private GameObject _confirm;

        public SpatialUi(ArsistSpatialRuntime runtime)
        {
            _rt = runtime;
            int ui = LayerMask.NameToLayer("UI");
            _layer = ui >= 0 ? ui : 0;
        }

        // ---- 部品 ----

        private GameObject NewObject(string name, Transform parent = null)
        {
            var go = new GameObject(name);
            if (parent != null) go.transform.SetParent(parent, false);
            go.layer = _layer;
            return go;
        }

        private Canvas NewCanvas(string name, Vector2 sizePx)
        {
            var go = NewObject(name, _rt.transform);
            var canvas = go.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            var rect = go.GetComponent<RectTransform>();
            rect.sizeDelta = sizePx;
            go.transform.localScale = Vector3.one * PixelSize;
            go.AddComponent<CanvasScaler>().dynamicPixelsPerUnit = 4;
            return canvas;
        }

        private RectTransform Rect(GameObject go, Vector2 anchorMin, Vector2 anchorMax, Vector2 offsetMin, Vector2 offsetMax)
        {
            var rect = go.GetComponent<RectTransform>();
            if (rect == null) rect = go.AddComponent<RectTransform>();
            rect.anchorMin = anchorMin;
            rect.anchorMax = anchorMax;
            rect.offsetMin = offsetMin;
            rect.offsetMax = offsetMax;
            return rect;
        }

        private TextMeshProUGUI Text(Transform parent, string text, float size, TextAlignmentOptions align)
        {
            var go = NewObject("Text", parent);
            Rect(go, Vector2.zero, Vector2.one, new Vector2(16, 8), new Vector2(-16, -8));
            var t = go.AddComponent<TextMeshProUGUI>();
            if (TMP_Settings.defaultFontAsset != null) t.font = TMP_Settings.defaultFontAsset;
            t.text = text;
            t.fontSize = size;
            t.color = Color.white;
            t.alignment = align;
            t.textWrappingMode = TextWrappingModes.Normal;
            t.raycastTarget = false;
            return t;
        }

        private void Button(Transform parent, string label, Vector2 min, Vector2 max, Color color, Action press)
        {
            var go = NewObject("Button " + label, parent);
            Rect(go, min, max, Vector2.zero, Vector2.zero);
            var image = go.AddComponent<Image>();
            image.color = color;
            var button = go.AddComponent<Button>();
            button.targetGraphic = image;
            bool pressed = false;
            void Press()
            {
                if (pressed) return;
                pressed = true;
                press();
            }
            button.onClick.AddListener(Press);
            var gaze = go.AddComponent<Arsist.Runtime.Input.ArsistGazeTarget>();
            if (gaze.onGazeSelect == null) gaze.onGazeSelect = new UnityEngine.Events.UnityEvent();
            gaze.onGazeSelect.AddListener(Press);
            Text(go.transform, label, 40, TextAlignmentOptions.Center);
        }

        private Material LineMaterial()
        {
            if (_lineMaterial != null) return _lineMaterial;
            foreach (var name in new[] { "Unlit/Color", "Sprites/Default", "Universal Render Pipeline/Unlit" })
            {
                var shader = Shader.Find(name);
                if (shader != null) { _lineMaterial = new Material(shader); break; }
            }
            return _lineMaterial;
        }

        /// <summary>目の前 (頭の水平の向き) に、こちらを向けて置く。</summary>
        private void InFront(Transform t, float distance, float drop)
        {
            var head = _rt.User.Head;
            if (head == null) return;
            var f = head.forward;
            f.y = 0;
            if (f.sqrMagnitude < 1e-4f) f = Vector3.forward;
            f.Normalize();
            t.position = head.position + f * distance + Vector3.down * drop;
            t.rotation = Quaternion.LookRotation(f, Vector3.up);
        }

        // ---- 字幕 ----

        public void Subtitle(string text, float seconds)
        {
            if (_subtitle == null)
            {
                var canvas = NewCanvas("[Layster Subtitle]", new Vector2(900, 120));
                _subtitle = canvas.gameObject;
                var bg = NewObject("Background", _subtitle.transform);
                Rect(bg, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
                var image = bg.AddComponent<Image>();
                image.color = new Color(0, 0, 0, 0.55f);
                image.raycastTarget = false;
                _subtitleText = Text(_subtitle.transform, "", 42, TextAlignmentOptions.Center);
            }
            _subtitleText.text = text ?? "";
            _subtitle.SetActive(!string.IsNullOrEmpty(text));
            _subtitleUntil = Time.unscaledTime + seconds;
        }

        // ---- 確認 ----

        /// <summary>「はい / いいえ」を聞く。answer は必ず 1 回 (60 秒で「いいえ」)。</summary>
        public void Confirm(string question, Action<bool> answer)
        {
            if (_confirm != null) UnityEngine.Object.Destroy(_confirm);
            var canvas = NewCanvas("[Layster Confirm]", new Vector2(700, 380));
            _confirm = canvas.gameObject;
            var panel = _confirm;
            var bg = NewObject("Background", panel.transform);
            Rect(bg, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            var image = bg.AddComponent<Image>();
            image.color = new Color(0.1f, 0.1f, 0.14f, 0.92f);
            var textHolder = NewObject("Question", panel.transform);
            Rect(textHolder, new Vector2(0, 0.38f), Vector2.one, new Vector2(24, 0), new Vector2(-24, -24));
            Text(textHolder.transform, question, 38, TextAlignmentOptions.Center);
            bool answered = false;
            void Answer(bool ok)
            {
                if (answered) return;
                answered = true;
                if (panel != null) UnityEngine.Object.Destroy(panel);
                if (_confirm == panel) _confirm = null;
                answer?.Invoke(ok);
            }
            Button(panel.transform, "OK", new Vector2(0.06f, 0.08f), new Vector2(0.47f, 0.33f), new Color(0.2f, 0.55f, 0.45f, 1), () => Answer(true));
            Button(panel.transform, "×", new Vector2(0.53f, 0.08f), new Vector2(0.94f, 0.33f), new Color(0.45f, 0.22f, 0.22f, 1), () => Answer(false));
            InFront(panel.transform, 0.8f, 0.1f);
            _rt.StartCoroutine(Timeout(60f, () => Answer(false)));
        }

        private static IEnumerator Timeout(float seconds, Action then)
        {
            yield return new WaitForSecondsRealtime(seconds);
            then();
        }

        // ---- 強調・箱 ----

        private GameObject WireBox(string name, Vector3 center, Vector3 size, Quaternion rotation, Color color, float width)
        {
            var go = NewObject(name, _rt.transform);
            go.transform.SetPositionAndRotation(center, rotation);
            var h = size * 0.5f;
            var c = new Vector3[8];
            for (int i = 0; i < 8; i++) c[i] = new Vector3((i & 1) == 0 ? -h.x : h.x, (i & 2) == 0 ? -h.y : h.y, (i & 4) == 0 ? -h.z : h.z);
            int[,] edges = { { 0, 1 }, { 2, 3 }, { 4, 5 }, { 6, 7 }, { 0, 2 }, { 1, 3 }, { 4, 6 }, { 5, 7 }, { 0, 4 }, { 1, 5 }, { 2, 6 }, { 3, 7 } };
            for (int e = 0; e < 12; e++)
            {
                var edge = NewObject("Edge", go.transform);
                var line = edge.AddComponent<LineRenderer>();
                line.useWorldSpace = false;
                line.positionCount = 2;
                line.SetPosition(0, c[edges[e, 0]]);
                line.SetPosition(1, c[edges[e, 1]]);
                line.startWidth = line.endWidth = width;
                var m = LineMaterial();
                if (m != null) line.material = m;
                line.startColor = line.endColor = color;
                if (line.material != null) line.material.color = color;
            }
            return go;
        }

        private GameObject Label(string text, Vector3 position, Color color)
        {
            var canvas = NewCanvas("[Layster Label]", new Vector2(Mathf.Clamp(40 + text.Length * 26, 120, 700), 70));
            var bg = NewObject("Background", canvas.transform);
            Rect(bg, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
            var image = bg.AddComponent<Image>();
            image.color = new Color(color.r * 0.35f, color.g * 0.35f, color.b * 0.35f, 0.85f);
            image.raycastTarget = false;
            Text(canvas.transform, text, 36, TextAlignmentOptions.Center);
            canvas.transform.position = position;
            canvas.gameObject.AddComponent<SpatialBillboard>();
            return canvas.gameObject;
        }

        public void Highlight(Vec3 center, Vec3 size, double yaw, string label, Color color, float seconds)
        {
            var unity = _rt.Frames.ToUnity(center);
            var s = new Vector3((float)Math.Max(size.X, 0.02) + 0.02f, (float)Math.Max(size.Y, 0.02) + 0.02f, (float)Math.Max(size.Z, 0.02) + 0.02f);
            var box = WireBox("[Layster Highlight]", unity, s, _rt.Frames.RotationToUnity(yaw), color, 0.006f);
            GameObject tag = null;
            if (!string.IsNullOrEmpty(label)) tag = Label(label, unity + Vector3.up * (s.y / 2 + 0.08f), color);
            _rt.StartCoroutine(Timeout(Mathf.Max(0.5f, seconds), () =>
            {
                if (box != null) UnityEngine.Object.Destroy(box);
                if (tag != null) UnityEngine.Object.Destroy(tag);
            }));
        }

        /// <summary>体の動ける範囲 (体の frame の箱) を線で描く。base が動いたら呼び直す。</summary>
        public GameObject Workspace(GameObject previous, SpatialPose basePose, Vec3 center, Vec3 size)
        {
            if (previous != null) UnityEngine.Object.Destroy(previous);
            var world = SpatialMath.FrameToWorld(center, basePose.At, basePose.Yaw);
            return WireBox("[Layster Workspace]", _rt.Frames.ToUnity(world), new Vector3((float)size.X, (float)size.Y, (float)size.Z),
                _rt.Frames.RotationToUnity(basePose.Yaw), new Color(1f, 0.75f, 0.2f), 0.003f);
        }

        public void Tick()
        {
            if (_subtitle != null && _subtitle.activeSelf)
            {
                if (Time.unscaledTime > _subtitleUntil) _subtitle.SetActive(false);
                else InFront(_subtitle.transform, 1.4f, 0.45f);
            }
        }
    }
}
