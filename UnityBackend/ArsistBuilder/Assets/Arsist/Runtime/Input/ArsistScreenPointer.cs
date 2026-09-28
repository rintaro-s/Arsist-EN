// ==============================================
// Arsist Engine - Input
// 画面を触って押す (スマホ、パソコンでの確認)
//
// 視線・コントローラーのレイ・ハンドトラッキングと同じ道 (ArsistUiPointer → SendMessage) を通す。
// 入り口が「画面のどこを触ったか」になるだけ。
//
// これが無いと、同じプロジェクトがスマホでは**何も押せない**。
// このエンジンは「1 つのプロジェクトが、どの端末でも同じように動く」ことが前提なので、
// 押す手立ての無い端末を残さない。ヘッドセットでは触る画面が無いので、何もしない。
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.Input
{
    [UnityEngine.Scripting.Preserve]
    public class ArsistScreenPointer : MonoBehaviour
    {
        [Tooltip("押せる距離 (m)")]
        [SerializeField] private float _maxDistance = 20f;

        private Camera _camera;
        private GameObject _current;

        private void Start()
        {
            _camera = Camera.main;
        }

        private void Update()
        {
            if (_camera == null)
            {
                _camera = Camera.main;
                if (_camera == null) return;
            }

            if (!TryGetPress(out var screenPosition, out var pressed, out var released)) return;

            var ray = _camera.ScreenPointToRay(screenPosition);
            if (!UI.ArsistUiPointer.RaycastScene(ray, _maxDistance, out var target, out var point))
            {
                Release();
                return;
            }

            if (target != _current)
            {
                Release();
                _current = target;
                _current.SendMessage("OnGazeEnter", point, SendMessageOptions.DontRequireReceiver);
            }

            // 触った瞬間だけを「決定」として送る (押しっぱなしで連打しない)
            if (pressed)
            {
                Debug.Log($"[Arsist] Touch: '{_current.name}'");
                _current.SendMessage("OnGazeDwellSelect", point, SendMessageOptions.DontRequireReceiver);
            }
            // なぞっている間は毎フレーム (Slider を動かす用途)
            _current.SendMessage("OnGazeDrag", point, SendMessageOptions.DontRequireReceiver);

            if (released) Release();
        }

        /// <summary>触られている場所。触られていなければ false。</summary>
        private static bool TryGetPress(out Vector2 position, out bool pressed, out bool released)
        {
            position = default;
            pressed = false;
            released = false;

            if (UnityEngine.Input.touchCount > 0)
            {
                var touch = UnityEngine.Input.GetTouch(0);
                position = touch.position;
                pressed = touch.phase == TouchPhase.Began;
                released = touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled;
                return true;
            }

            // パソコンでの確認用 (マウス)。ヘッドセットには無い。
            if (UnityEngine.Input.GetMouseButton(0) || UnityEngine.Input.GetMouseButtonUp(0))
            {
                position = UnityEngine.Input.mousePosition;
                pressed = UnityEngine.Input.GetMouseButtonDown(0);
                released = UnityEngine.Input.GetMouseButtonUp(0);
                return true;
            }

            return false;
        }

        private void Release()
        {
            if (_current == null) return;
            _current.SendMessage("OnGazeExit", SendMessageOptions.DontRequireReceiver);
            _current = null;
        }
    }
}
