// ==============================================
// Arsist Engine - Tracking
// スマホのカメラ映像を、3D の奥に敷く (ビデオシースルー AR)
//
// Quest のパススルーの代わりに、背面カメラの映像を背景にする。
// Screen Space - Camera の Canvas をメインカメラの遠い位置に置くので、
// シーンの物体はすべてこの映像の手前に描かれる。
//
// 向きと鏡写しは Unity の公式リファレンスに従う:
//   videoRotationAngle は「時計回り」の角度 → UI は反時計回りが正なので符号を反転
//   videoVerticallyMirrored は再生直後はまだ正しくないことがあるので、毎フレーム見る
// ==============================================

using UnityEngine;
using UnityEngine.UI;

namespace Arsist.Runtime.Tracking
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistCameraBackground : MonoBehaviour
    {
        private Camera _camera;
        private Canvas _canvas;
        private RawImage _image;
        private RectTransform _rect;

        private int _lastWidth, _lastHeight, _lastAngle;
        private int _lastScreenWidth, _lastScreenHeight;
        private bool _lastMirrored;

        private void Start()
        {
            _camera = GetComponent<Camera>();
            if (_camera == null) _camera = Camera.main;
            if (_camera == null)
            {
                Debug.LogWarning("[Arsist] No camera for the AR background.");
                enabled = false;
                return;
            }

            // 映像が背景を全部覆うので、塗り潰しの色は何でもいい。黒にしておくと、
            // 映像が来るまでの一瞬が目立たない。
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = Color.black;

            var go = new GameObject("[ArsistCameraBackground]");
            go.transform.SetParent(transform, false);
            _canvas = go.AddComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceCamera;
            _canvas.worldCamera = _camera;
            // far clip の手前ぎりぎり。現実に重ねる板 (ArsistWorldOverlay, 60m) より奥に置く。
            _canvas.planeDistance = _camera.farClipPlane * 0.9f;
            _canvas.sortingOrder = -1000;

            var imageGo = new GameObject("Video");
            imageGo.transform.SetParent(go.transform, false);
            _image = imageGo.AddComponent<RawImage>();
            _image.raycastTarget = false;   // 背景がタップを吸うと、UI が押せなくなる
            _rect = _image.rectTransform;
            _rect.anchorMin = _rect.anchorMax = new Vector2(0.5f, 0.5f);
            _rect.pivot = new Vector2(0.5f, 0.5f);
        }

        private void LateUpdate()
        {
            var device = ArsistDeviceCamera.Instance;
            if (device == null || !device.IsStreaming || _image == null) return;

            var texture = device.Texture;
            if (_image.texture != texture) _image.texture = texture;

            int angle = texture.videoRotationAngle;
            bool mirrored = texture.videoVerticallyMirrored;

            // 変わったときだけ組み直す。毎フレーム触ると UI の再構築が走る。
            if (texture.width == _lastWidth && texture.height == _lastHeight && angle == _lastAngle
                && mirrored == _lastMirrored
                && Screen.width == _lastScreenWidth && Screen.height == _lastScreenHeight)
            {
                return;
            }
            _lastWidth = texture.width;
            _lastHeight = texture.height;
            _lastAngle = angle;
            _lastMirrored = mirrored;
            _lastScreenWidth = Screen.width;
            _lastScreenHeight = Screen.height;

            Layout(texture.width, texture.height, angle, mirrored);
        }

        private void Layout(int textureWidth, int textureHeight, int clockwiseAngle, bool mirrored)
        {
            int turns = PhoneCameraMath.QuarterTurns(clockwiseAngle);
            PhoneCameraMath.RotatedSize(textureWidth, textureHeight, turns, out int shownWidth, out int shownHeight);

            // Canvas の単位は画面の画素と同じ (Screen Space - Camera, scaleFactor 1)。
            var canvasRect = ((RectTransform)_canvas.transform).rect;
            float screenWidth = canvasRect.width > 0 ? canvasRect.width : Screen.width;
            float screenHeight = canvasRect.height > 0 ? canvasRect.height : Screen.height;

            // はみ出す方に合わせて拡大し、隙間を作らない。
            float scale = Mathf.Max(screenWidth / shownWidth, screenHeight / shownHeight);

            // 回す前の矩形は映像そのものの縦横。回したあとに画面いっぱいになる。
            _rect.sizeDelta = new Vector2(textureWidth * scale, textureHeight * scale);
            _rect.localEulerAngles = new Vector3(0f, 0f, -clockwiseAngle);

            // 鏡写しなら上下を反転して読む。
            _image.uvRect = mirrored ? new Rect(0f, 1f, 1f, -1f) : new Rect(0f, 0f, 1f, 1f);

            // Unity カメラの画角を、画面に見えている映像の画角に合わせる。
            // ここが合っていないと、置いた物体が映像の上を滑る。
            _camera.fieldOfView = (float)PhoneCameraMath.VisibleVerticalFov(
                shownWidth, shownHeight, PhoneCameraSettings.HorizontalFovDegrees,
                Mathf.RoundToInt(screenWidth), Mathf.RoundToInt(screenHeight));

            Debug.Log($"[Arsist] Camera background {textureWidth}x{textureHeight} rot={clockwiseAngle} " +
                      $"mirrored={mirrored} -> fov {_camera.fieldOfView:F1}");
        }
    }
}
