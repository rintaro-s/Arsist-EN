// ==============================================
// Arsist Extension: quest-hands — build hook
// samples/extensions/quest-hands/Editor/QuestHandsBuildHook.cs
//
// Meta の SDK のコントローラーの模型 (OVRControllerPrefab) を左右 1 つずつシーンに置く。
// 模型の切り替え (Quest 3 / Quest Pro / Quest 2 …) とボタンの動きは模型の OVRControllerHelper がする。
// 置き場所は実行時の HandVisualService がコントローラーの位置に合わせる (名前で探す)。
// 見え方が off、またはコントローラーを出さない設定なら置かない (前のビルドで置いたものは消す)。
// ==============================================

using Arsist.Builder.Extensions;
using UnityEditor;
using UnityEngine;

namespace Arsist.Extensions.QuestHands.Build
{
    public sealed class QuestHandsBuildHook : ArsistBuildExtension
    {
        private const string PrefabPath = "Packages/com.meta.xr.sdk.core/Prefabs/OVRControllerPrefab.prefab";
        private const string LeftName = "QuestHands Left Controller";
        private const string RightName = "QuestHands Right Controller";

        public override string ExtensionId => "quest-hands";

        public override void OnScene(ArsistBuildContext context)
        {
            var wanted = context.GetString("look", "virtual") != "off" && context.GetBool("controllers", true);
            // 前のビルドで置いたもの (非表示なので GameObject.Find では見つからない) を消してから置き直す
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                if (t != null && t.parent == null && (t.name == LeftName || t.name == RightName)) Object.DestroyImmediate(t.gameObject);
            }
            if (!wanted)
            {
                context.Log("controller models not placed (look off or controllers off)");
                return;
            }

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            if (prefab == null)
            {
                context.Warn($"{PrefabPath} not found; controllers will be drawn as simple shapes");
                return;
            }
            Place(prefab, LeftName, OVRInput.Controller.LTouch);
            Place(prefab, RightName, OVRInput.Controller.RTouch);
            context.Log("Meta controller models placed (left / right)");
        }

        private static void Place(GameObject prefab, string name, OVRInput.Controller controller)
        {
            var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            go.name = name;
            var helper = go.GetComponent<OVRControllerHelper>();
            if (helper != null)
            {
                helper.m_controller = controller;
                EditorUtility.SetDirty(helper);
            }
            // 実行時に HandVisualService が見つけて、追跡できたときだけ出す
            go.SetActive(false);
            EditorUtility.SetDirty(go);
        }
    }
}
