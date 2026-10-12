// ==============================================
// Arsist Extension: quest-hands — コントローラー 1 本
// samples/extensions/quest-hands/Runtime/ControllerShape.cs
//
// 形は Meta の SDK の模型 (OVRControllerPrefab。ビルドの QuestHandsBuildHook がシーンに置く)。
// 模型の切り替え (Quest 3 の Touch Plus / Quest 2 の Touch など) とボタンの動きは、模型に付いている
// OVRControllerHelper がする。ここがするのは、模型をコントローラーの位置に置くことだけ。
// 位置は Unity の XR 入力 (grip の姿勢) から取る。エンジンのレイ (XROriginSetup) と同じ座標なので、レイと模型がずれない。
// 模型が見つからなければ (SDK の差し替え等)、簡単な形 (握り + 輪) で代わりに描く。
// ==============================================

using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR;

namespace Arsist.Extensions.QuestHands
{
    internal sealed class ControllerShape
    {
        public const string LeftModelName = "QuestHands Left Controller";
        public const string RightModelName = "QuestHands Right Controller";

        private readonly bool _left;
        private readonly GameObject _root;
        private readonly bool _isMetaModel;
        private readonly Dictionary<Renderer, Material[]> _original = new Dictionary<Renderer, Material[]>();
        private readonly List<InputDevice> _buffer = new List<InputDevice>();
        private InputDevice _device;
        private float _nextScan;

        public bool IsMetaModel => _isMetaModel;

        public ControllerShape(bool left, Transform parent, Material fallbackMaterial)
        {
            _left = left;
            var model = FindSceneObject(left ? LeftModelName : RightModelName);
            if (model != null)
            {
                _root = model;
                _isMetaModel = true;
                _root.transform.SetParent(parent, true);
            }
            else
            {
                _root = BuildFallback(left, parent, fallbackMaterial);
            }
            foreach (var r in _root.GetComponentsInChildren<Renderer>(true))
            {
                _original[r] = r.sharedMaterials;
                r.shadowCastingMode = ShadowCastingMode.Off;
                r.receiveShadows = false;
            }
            _root.SetActive(false);
        }

        /// <summary>シーンの物を名前で探す (非アクティブも)。</summary>
        private static GameObject FindSceneObject(string name)
        {
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                if (t != null && t.name == name && t.gameObject.scene.IsValid()) return t.gameObject;
            }
            return null;
        }

        /// <summary>模型が無いときの形: 少し前に傾いた握りと、上の輪 (Touch の形の目安)。</summary>
        private static GameObject BuildFallback(bool left, Transform parent, Material material)
        {
            var root = new GameObject(left ? "QuestHands Left Controller (simple)" : "QuestHands Right Controller (simple)");
            root.transform.SetParent(parent, false);
            void Add(PrimitiveType type, Vector3 position, Vector3 euler, Vector3 scale)
            {
                var go = GameObject.CreatePrimitive(type);
                var c = go.GetComponent<Collider>();
                if (c != null) Object.Destroy(c);
                go.GetComponent<Renderer>().sharedMaterial = material;
                go.transform.SetParent(root.transform, false);
                go.transform.localPosition = position;
                go.transform.localEulerAngles = euler;
                go.transform.localScale = scale;
            }
            // grip の原点は握りの中ほど。握りは前 (+Z) に向かって少し下がる
            Add(PrimitiveType.Capsule, new Vector3(0f, -0.01f, -0.005f), new Vector3(70f, 0f, 0f), new Vector3(0.034f, 0.052f, 0.034f));
            Add(PrimitiveType.Cylinder, new Vector3(left ? 0.008f : -0.008f, 0.025f, 0.045f), new Vector3(-20f, 0f, 0f), new Vector3(0.075f, 0.006f, 0.075f));
            return root;
        }

        public void SetMaterial(Material occluderOrNull)
        {
            foreach (var kv in _original)
            {
                if (kv.Key == null) continue;
                if (occluderOrNull == null) kv.Key.sharedMaterials = kv.Value;
                else kv.Key.sharedMaterials = Enumerable.Repeat(occluderOrNull, kv.Value.Length).ToArray();
            }
        }

        public void Hide()
        {
            if (_root != null && _root.activeSelf) _root.SetActive(false);
        }

        public void Update(Transform space)
        {
            if (!_device.isValid && Time.unscaledTime >= _nextScan)
            {
                _nextScan = Time.unscaledTime + 1f;
                _buffer.Clear();
                var side = _left ? InputDeviceCharacteristics.Left : InputDeviceCharacteristics.Right;
                InputDevices.GetDevicesWithCharacteristics(InputDeviceCharacteristics.Controller | side, _buffer);
                // 手の追跡 (HandTracking) を名乗るものはコントローラーではない
                _device = _buffer.FirstOrDefault(d => d.isValid && (d.characteristics & InputDeviceCharacteristics.HandTracking) == 0);
            }
            bool tracked = _device.isValid
                && (!_device.TryGetFeatureValue(CommonUsages.isTracked, out bool isTracked) || isTracked)
                && _device.TryGetFeatureValue(CommonUsages.devicePosition, out Vector3 p)
                && _device.TryGetFeatureValue(CommonUsages.deviceRotation, out Quaternion r);
            if (!tracked)
            {
                Hide();
                return;
            }
            _device.TryGetFeatureValue(CommonUsages.devicePosition, out Vector3 position);
            _device.TryGetFeatureValue(CommonUsages.deviceRotation, out Quaternion rotation);
            var worldPosition = space != null ? space.TransformPoint(position) : position;
            var worldRotation = space != null ? space.rotation * rotation : rotation;
            _root.transform.SetPositionAndRotation(worldPosition, worldRotation);
            if (!_root.activeSelf) _root.SetActive(true);
        }
    }
}
