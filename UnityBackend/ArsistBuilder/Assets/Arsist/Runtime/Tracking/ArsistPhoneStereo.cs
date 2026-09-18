// ==============================================
// Arsist Engine - Tracking
// スマホを段ボールゴーグル (Cardboard 型) に入れて使うための左右分割
//
// 画面を左右に分け、目の間隔ぶんずらした 2 台のカメラで描く。
// 向きはメインカメラ (ArsistGyroCamera が回している) に子として付けるので、そのまま追従する。
//
// VR 向け。AR (カメラ映像の背景) とは組み合わせない:
// 背面カメラは 1 台しか無く、左右で視差のある映像は作れないため。
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.Tracking
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistPhoneStereo : MonoBehaviour
    {
        /// <summary>目の間隔 (m)。成人の平均はおよそ 63mm。</summary>
        public float InterpupillaryDistance = 0.063f;

        private Camera _main;
        private Camera _left;
        private Camera _right;

        private void Start()
        {
            _main = GetComponent<Camera>();
            if (_main == null)
            {
                enabled = false;
                return;
            }

            _left = CreateEye("LeftEye", -InterpupillaryDistance * 0.5f, new Rect(0f, 0f, 0.5f, 1f));
            _right = CreateEye("RightEye", InterpupillaryDistance * 0.5f, new Rect(0.5f, 0f, 0.5f, 1f));

            // メインは向きを持つだけにして、描画は左右の目に任せる。
            // 消すと子の目まで止まるので、何も描かないようにしておく。
            _main.cullingMask = 0;
            _main.clearFlags = CameraClearFlags.Nothing;
        }

        private Camera CreateEye(string name, float offsetX, Rect viewport)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = new Vector3(offsetX, 0f, 0f);

            var eye = go.AddComponent<Camera>();
            eye.CopyFrom(_main);
            eye.rect = viewport;
            // 画面の半分を 1 つの目で使うので、縦横比は半分になる。
            // CopyFrom のあと rect を変えれば Unity が aspect を合わせ直す。
            return eye;
        }

        private void OnDestroy()
        {
            if (_left != null) Destroy(_left.gameObject);
            if (_right != null) Destroy(_right.gameObject);
        }
    }
}
