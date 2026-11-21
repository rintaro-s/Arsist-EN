// ==============================================
// Arsist Engine - Media: レイヤー (自分の体・カメラの形)
// Assets/Arsist/Runtime/Media/ArsistMediaLayers.cs
//
// doc/23-cameras-media.md「自分の目に写さない」。
//
//   ArsistSelfOnlyHidden  自分の体 (character.embody の hideFromSelf)。頭のカメラは描かない。仮想カメラは showSelf なら描く
//   ArsistCameraGizmo     仮想カメラの形と撮る範囲 (showGizmo)。頭のカメラは描く。仮想カメラは描かない
//
// 名前はビルド (ArsistBuildPipeline.EnsureMediaLayersExist) が TagManager に入れる。番号は空いているところ
// (UI = 5、ArsistHUD = 8 番以降の最初の空き、シミュレーターの部屋 = 31) と重ならない 29 / 30 を先に試す。
// 名前が引けなければ (古いワークスペース) その番号をそのまま使う。
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.Media
{
    public static class ArsistMediaLayers
    {
        public const string SelfHiddenName = "ArsistSelfOnlyHidden";
        public const string GizmoName = "ArsistCameraGizmo";
        public const int SelfHiddenFallback = 29;
        public const int GizmoFallback = 30;

        private static int _self = -2, _gizmo = -2;

        public static int SelfHidden
        {
            get
            {
                if (_self == -2) { _self = LayerMask.NameToLayer(SelfHiddenName); if (_self < 0) _self = SelfHiddenFallback; }
                return _self;
            }
        }

        public static int Gizmo
        {
            get
            {
                if (_gizmo == -2) { _gizmo = LayerMask.NameToLayer(GizmoName); if (_gizmo < 0) _gizmo = GizmoFallback; }
                return _gizmo;
            }
        }

        /// <summary>常時表示の UI のレイヤー (頭に付いた板)。仮想カメラには写さない。無ければ -1。</summary>
        public static int Hud => LayerMask.NameToLayer("ArsistHUD");

        private static Camera _lastHead;
        private static int _lastMask;

        /// <summary>
        /// 頭のカメラ (Camera.main) から自分の体を外し、カメラの形を入れる。毎フレーム呼んでよい
        /// (カメラか cullingMask が変わったときだけ書く)。
        /// </summary>
        public static void EnsureHeadCamera()
        {
            var cam = Camera.main;
            if (cam == null) return;
            if (cam == _lastHead && cam.cullingMask == _lastMask) return;
            int mask = cam.cullingMask;
            mask &= ~(1 << SelfHidden);
            mask |= 1 << Gizmo;
            cam.cullingMask = mask;
            if (cam != _lastHead) Debug.Log($"[Arsist] head camera '{cam.name}': self layer {SelfHidden} hidden, camera gizmo layer {Gizmo} shown");
            _lastHead = cam;
            _lastMask = mask;
        }

        /// <summary>仮想カメラの cullingMask。カメラの形・頭の UI・シミュレーターの部屋は写さない。</summary>
        public static int VirtualCameraMask(bool showSelf)
        {
            int mask = ~0;
            mask &= ~(1 << Gizmo);
            int hud = Hud;
            if (hud >= 0) mask &= ~(1 << hud);
            mask &= ~(1 << 31); // シミュレーターの部屋 (ArsistSimulator.RoomLayer。実機では使わない番号)
            if (!showSelf) mask &= ~(1 << SelfHidden);
            return mask;
        }

        public static void SetLayerRecursively(GameObject root, int layer)
        {
            if (root == null) return;
            root.layer = layer;
            foreach (Transform child in root.transform) SetLayerRecursively(child.gameObject, layer);
        }
    }
}
