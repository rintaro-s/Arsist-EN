// ==============================================
// Arsist Engine - UI
// 実行時に作った UI のレイヤー合わせ
//
// 常時表示の UI (UHD) は、専用レイヤー "ArsistHUD" + 専用カメラで描いている:
//   メインカメラ  … ArsistHUD を**描かない**
//   UI カメラ     … ArsistHUD **だけ**を描く。depth=100 で後から、深度を消して描く (常に手前)
// ビルド時に作る要素は Canvas ごとこのレイヤーに揃えてある (SetLayerRecursively)。
//
// ところが `new GameObject()` で作ったものは、**親のレイヤーを継がない** (必ず Default になる)。
// そのため実行時に作った UI (キーボードのキーなど) はメインカメラ側に描かれ、
// そのあと UI カメラが深度を消して HUD を描くので、**上から塗り潰されて見えなくなる**。
// 当たり判定はレイヤーを見ないので「押せるのに見えない」という、実機でしか分からない形で出る
// (2026-09 に踏んだ: キーボードが出ない)。
//
// 実行時に UI を作るときは、必ずここを通して親のレイヤーに合わせる。
// ==============================================

using UnityEngine;

namespace Arsist.Runtime.UI
{
    public static class ArsistUiLayers
    {
        /// <summary>親と同じレイヤーに置く。子も全部そろえる。</summary>
        public static void MatchParent(GameObject target, Transform parent)
        {
            if (target == null || parent == null) return;
            ApplyRecursively(target, parent.gameObject.layer);
        }

        /// <summary>親の下に、レイヤーまで合わせた UI 用の GameObject を作る。</summary>
        public static GameObject CreateChild(string name, Transform parent)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            if (parent != null) go.layer = parent.gameObject.layer;
            return go;
        }

        public static void ApplyRecursively(GameObject target, int layer)
        {
            if (target == null) return;
            target.layer = layer;
            foreach (Transform child in target.transform)
            {
                ApplyRecursively(child.gameObject, layer);
            }
        }
    }
}
