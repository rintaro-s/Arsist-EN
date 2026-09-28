// ==============================================
// Arsist Engine - UI
// レイと UI の当たり判定
//
// これまで UI の当たり判定は、要素に貼った BoxCollider に任せていた。これは壊れやすい:
//   - コライダーの大きさはビルド時に決めるが、RectTransform の実寸はレイアウトが走るまで決まらない。
//     「幅 100%」のように後から決まる要素では、当たり判定だけ 0 のまま残る。
//   - ボタンやスライダーには貼るが、それ以外 (パネル、実行時に作ったキー) には無い。
// 実機では「レイは出ているのに、UI の上で止まらず素通りする」という形で出る。見た目では分からない。
//
// ここでは**長方形そのもの**に当てる。Canvas に登録されている Graphic (Image / Text …) のうち、
// raycastTarget が立っているものを取り、レイと面の交点が長方形の中かどうかを見る。
// uGUI が画面上のクリックを判定するのと同じ考え方を、ワールド空間のレイでやるだけ。
// コライダーは要らないので、大きさがいつ決まっても正しく当たる。
//
// 3D の物 (Physics のコライダー) は今までどおり Physics.Raycast で見て、近い方を採る。
// ==============================================

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Arsist.Runtime.UI
{
    public static class ArsistUiPointer
    {
        private static readonly List<Canvas> _canvases = new List<Canvas>();
        private static float _lastScanAt = -999f;

        /// <summary>シーンの Canvas を集め直す間隔 (秒)。毎フレーム探すほどのものではない。</summary>
        private const float RescanSeconds = 2f;

        /// <summary>同じ板の上とみなす距離の差 (m)。UI は同一平面に重なって並ぶ。</summary>
        private const float CoplanarEpsilon = 0.005f;

        /// <summary>
        /// ワールド空間のレイが当たった UI を返す。当たらなければ false。
        /// </summary>
        /// <param name="target">当たった要素 (押す相手を探すのは呼ぶ側)</param>
        /// <param name="point">当たった位置 (ワールド)</param>
        /// <param name="distance">レイの原点からの距離</param>
        public static bool Raycast(Ray ray, float maxDistance, out GameObject target, out Vector3 point, out float distance)
        {
            target = null;
            point = default;
            distance = float.MaxValue;
            int bestDepth = int.MinValue;

            RefreshCanvases();

            foreach (var canvas in _canvases)
            {
                if (canvas == null || !canvas.isActiveAndEnabled) continue;
                // 画面に貼り付く Canvas は、ワールドのレイの相手ではない
                if (canvas.renderMode != RenderMode.WorldSpace) continue;

                var graphics = GraphicRegistry.GetGraphicsForCanvas(canvas);
                if (graphics == null) continue;

                for (int i = 0; i < graphics.Count; i++)
                {
                    var graphic = graphics[i];
                    if (graphic == null || !graphic.raycastTarget || !graphic.isActiveAndEnabled) continue;

                    var rect = graphic.rectTransform;
                    if (rect == null) continue;

                    // 面との交点。裏からでも当たるように、向きの符号は見ない。
                    var normal = rect.forward;
                    float denominator = Vector3.Dot(normal, ray.direction);
                    if (Mathf.Abs(denominator) < 1e-6f) continue;

                    float hitDistance = Vector3.Dot(rect.position - ray.origin, normal) / denominator;
                    if (hitDistance < 0f || hitDistance > maxDistance) continue;

                    // 同じ板の上にある要素 (パネルとその上のキー) は距離が同じになる。
                    // 距離だけで決めると、先に見つかった親のパネルが勝ち、キーに当たらない。
                    // 実機では「輪は出るのにトリガーで何も起きない」という形で出る。
                    // 重なっているときは、後に描かれる方 (depth が大きい = 手前に見えている方) を採る。
                    bool sameSurface = Mathf.Abs(hitDistance - distance) <= CoplanarEpsilon;
                    if (sameSurface)
                    {
                        if (graphic.depth <= bestDepth) continue;
                    }
                    else if (hitDistance >= distance)
                    {
                        continue;
                    }

                    var world = ray.GetPoint(hitDistance);
                    var local = rect.InverseTransformPoint(world);
                    if (!rect.rect.Contains(local)) continue;

                    target = graphic.gameObject;
                    point = world;
                    distance = hitDistance;
                    bestDepth = graphic.depth;
                }
            }

            return target != null;
        }

        /// <summary>
        /// レイの当たり先 (3D の物 + UI)。近い方を採り、UI なら「押される相手」まで辿って返す。
        ///
        /// 視線・コントローラーのレイ・ハンドトラッキングは、どれも最後はここを通る。
        /// どれか 1 つだけを直すと、端末によって押せたり押せなかったりする
        /// (Quest はコントローラー、XREAL は視線、というように入り口が違うだけで、
        ///  当たり判定は同じであるべき)。
        /// </summary>
        public static bool RaycastScene(Ray ray, float maxDistance, out GameObject target, out Vector3 point)
        {
            target = null;
            point = ray.GetPoint(maxDistance);

            float best = float.MaxValue;
            if (Physics.Raycast(ray, out RaycastHit hit, maxDistance))
            {
                best = hit.distance;
                target = hit.collider.gameObject;
                point = hit.point;
            }

            if (Raycast(ray, maxDistance, out var uiTarget, out var uiPoint, out var uiDistance) && uiDistance < best)
            {
                target = ResolveInteractive(uiTarget);
                point = uiPoint;
            }

            return target != null;
        }

        /// <summary>
        /// 押す相手。当たった要素そのものか、その親で「押されたい」と言っているもの
        /// (ArsistGazeTarget / UiBindingRegistry を持つもの) を探す。
        /// キーの文字や、ボタンの中の装飾に当たっても、ちゃんとボタンが押される。
        /// </summary>
        public static GameObject ResolveInteractive(GameObject hit)
        {
            if (hit == null) return null;
            var current = hit.transform;
            while (current != null)
            {
                if (current.GetComponent<Arsist.Runtime.Input.ArsistGazeTarget>() != null) return current.gameObject;
                if (current.GetComponent<Arsist.Runtime.Scripting.UiBindingRegistry>() != null) return current.gameObject;
                if (current.GetComponent<Selectable>() != null) return current.gameObject;
                current = current.parent;
            }
            return hit;
        }

        private static void RefreshCanvases()
        {
            if (Time.realtimeSinceStartup - _lastScanAt < RescanSeconds && _canvases.Count > 0) return;
            _lastScanAt = Time.realtimeSinceStartup;
            _canvases.Clear();
#if UNITY_2023_1_OR_NEWER
            _canvases.AddRange(Object.FindObjectsByType<Canvas>(FindObjectsSortMode.None));
#else
            _canvases.AddRange(Object.FindObjectsOfType<Canvas>());
#endif
        }
    }
}
