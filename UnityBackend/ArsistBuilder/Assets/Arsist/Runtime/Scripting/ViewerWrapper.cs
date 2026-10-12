// ==============================================
// Arsist Engine - Viewer Wrapper (user viewpoint)
// Assets/Arsist/Runtime/Scripting/ViewerWrapper.cs
// ==============================================
using System.Collections.Generic;
using Jint.Native;
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// Jint に "viewer" として公開される、ユーザー視点（＝XRのメインカメラ）のラッパー。
    ///
    /// これまで「今ユーザーがどこにいて、どこを向いているか」を外から知る手段が無く、
    /// 「ユーザーの正面◯m に置く」といった配置もできなかった。
    /// ライブ配置モード（エディタ側の別UI）と、ユーザースクリプトの両方から使う。
    ///
    /// 座標系の注意: ここで扱うのは全て **実行時の Unity ワールド座標** であって、
    /// エディタのIR座標（X反転前）ではない。IRへ書き戻す側で変換すること。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class ViewerWrapper
    {
        private readonly SceneWrapper _scene;
        private Camera _camera;

        public ViewerWrapper(SceneWrapper scene)
        {
            _scene = scene;
        }

        /// <summary>JS の値の受け渡し (ScriptEngineManager が入れる)</summary>
        public JsBridge Js { get; set; }

        /// <summary>ユーザーの頭 (視点カメラ)。無ければ null。他のラッパー (scene / camera / audio) が使う。</summary>
        public Transform HeadTransform
        {
            get
            {
                var cam = ResolveCamera();
                return cam != null ? cam.transform : null;
            }
        }

        /// <summary>
        /// viewer.pose() → { x, y, z, yaw, pitch, forward: { x, y, z }, tracking }。
        /// 頭の向きであって目の向きではない。yaw は +Z からの水平の角度 (右回りが +)、pitch は上を向くと +。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public JsValue pose()
        {
            var head = HeadTransform;
            if (head == null || Js == null) return JsValue.Null;
            var p = head.position;
            var f = head.forward;
            double yaw = Mathf.Atan2(f.x, f.z) * Mathf.Rad2Deg;
            double pitch = Mathf.Asin(Mathf.Clamp(f.y, -1f, 1f)) * Mathf.Rad2Deg;
            return Js.ToJs(new Dictionary<string, object>
            {
                ["x"] = (double)p.x, ["y"] = (double)p.y, ["z"] = (double)p.z,
                ["yaw"] = yaw,
                ["pitch"] = pitch,
                ["forward"] = new Dictionary<string, object> { ["x"] = (double)f.x, ["y"] = (double)f.y, ["z"] = (double)f.z },
                ["tracking"] = IsTracking(),
            });
        }

        /// <summary>
        /// viewer.isLookingAt(id[, degrees]) — 頭の正面とその物の方向の角度が degrees (既定 15) 以内か。
        /// VRM (人型) は頭のボーン、他は見た目の中心 (描画範囲の中心。無ければ物の位置) で測る。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public bool isLookingAt(string id, double degrees = 15)
        {
            var head = HeadTransform;
            if (head == null || _scene == null || !_scene.TryGetObject(id, out var obj)) return false;
            var target = AimPoint(obj);
            var to = target - head.position;
            if (to.sqrMagnitude < 1e-6f) return true;
            return Vector3.Angle(head.forward, to) <= degrees;
        }

        private static Vector3 AimPoint(GameObject obj)
        {
            var animator = obj.GetComponentInChildren<Animator>();
            if (animator != null && animator.isHuman)
            {
                var bone = animator.GetBoneTransform(HumanBodyBones.Head);
                if (bone != null) return bone.position;
            }
            var renderers = obj.GetComponentsInChildren<Renderer>();
            if (renderers.Length > 0)
            {
                var bounds = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
                return bounds.center;
            }
            return obj.transform.position;
        }

        /// <summary>
        /// 視点カメラ。Camera.main が取れない構成（MainCameraタグ無し）でも
        /// シーン内の有効なカメラで代替する。
        /// </summary>
        private Camera ResolveCamera()
        {
            if (_camera != null && _camera.isActiveAndEnabled) return _camera;

            _camera = Camera.main;
            if (_camera == null)
            {
#if UNITY_2023_1_OR_NEWER
                _camera = Object.FindFirstObjectByType<Camera>();
#else
                _camera = Object.FindObjectOfType<Camera>();
#endif
            }
            return _camera;
        }

        /// <summary>ユーザー視点の現在の姿勢。取れない場合は Available=false。</summary>
        [UnityEngine.Scripting.Preserve]
        public ViewerPose GetPose()
        {
            var cam = ResolveCamera();
            if (cam == null)
            {
                return new ViewerPose { Available = false, Error = "No camera found in scene" };
            }

            var t = cam.transform;
            return new ViewerPose
            {
                Available = true,
                Position = new[] { t.position.x, t.position.y, t.position.z },
                Rotation = new[] { t.eulerAngles.x, t.eulerAngles.y, t.eulerAngles.z },
                Forward  = new[] { t.forward.x, t.forward.y, t.forward.z },
                Up       = new[] { t.up.x, t.up.y, t.up.z },
                // 実機の実効FOVはSDKが決めるので、参考値としてカメラの現在値も返す
                FieldOfView = cam.fieldOfView,
                Tracking = IsTracking(),
            };
        }

        private bool IsTracking()
        {
#if UNITY_2023_1_OR_NEWER
            var setup = Object.FindFirstObjectByType<XROriginSetup>();
#else
            var setup = Object.FindObjectOfType<XROriginSetup>();
#endif
            return setup != null && setup.IsTracking;
        }

        /// <summary>
        /// 視点の位置をリセットする（XROriginSetup.RecenterCamera）。
        /// 水平方向のズレだけを戻す（高さはトラッキング原点のまま）。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public bool recenter()
        {
#if UNITY_2023_1_OR_NEWER
            var setup = Object.FindFirstObjectByType<XROriginSetup>();
#else
            var setup = Object.FindObjectOfType<XROriginSetup>();
#endif
            if (setup == null)
            {
                Debug.LogWarning("[ViewerWrapper] XROriginSetup not found; cannot recenter.");
                return false;
            }

            setup.RecenterCamera();
            return true;
        }

        /// <summary>
        /// 登録済みオブジェクトを「ユーザーの正面 distance[m] 先」に移動する。
        ///
        /// faceUser=true のとき、オブジェクトの forward をユーザーの視線方向と揃える。
        /// これは Unity の World Space Canvas が「+Z 側から見て正しく読める」向きなので、
        /// パネル類をこの向きにするとユーザーから正対して見える。
        /// </summary>
        [UnityEngine.Scripting.Preserve]
        public bool placeInFront(string id, float distance, bool faceUser)
        {
            var cam = ResolveCamera();
            if (cam == null)
            {
                Debug.LogWarning("[ViewerWrapper] No camera; cannot placeInFront.");
                return false;
            }

            var t = cam.transform;
            var target = t.position + t.forward * distance;

            _scene.setPosition(id, target.x, target.y, target.z);

            if (faceUser)
            {
                var e = Quaternion.LookRotation(t.forward, Vector3.up).eulerAngles;
                _scene.setRotation(id, e.x, e.y, e.z);
            }
            return true;
        }

        [UnityEngine.Scripting.Preserve]
        public bool placeInFront(string id, float distance)
        {
            return placeInFront(id, distance, true);
        }

        [UnityEngine.Scripting.Preserve]
        public class ViewerPose
        {
            public bool Available;
            public string Error;
            public float[] Position = new float[3];
            public float[] Rotation = new float[3];
            public float[] Forward = new float[] { 0f, 0f, 1f };
            public float[] Up = new float[] { 0f, 1f, 0f };
            public float FieldOfView;
            public bool Tracking;
        }
    }
}
