// ==============================================
// Arsist Extension: quest-room — build hook
// Extensions/quest-room/Editor/QuestRoomBuildHook.cs
//
// シーンに Meta の MRUK を 1 つ置く。部屋の読み込みは MRUK 任せにせず (LoadSceneOnStartup = false)、
// QuestRoomService が「許可 → 読み込み → 結果」を順にログに残しながら行う。
//
// World Lock は切る。MRUK のワールドロックは OVRCameraRig の TrackingSpace を動かす仕組みで、
// Arsist は XR Origin を使うため対象が無い (有効のままだと何もしないか、別の物を動かす)。
// ==============================================

using Arsist.Builder.Extensions;
using Meta.XR.MRUtilityKit;
using UnityEditor;
using UnityEngine;

namespace Arsist.Extensions.QuestRoom.Build
{
    public sealed class QuestRoomBuildHook : ArsistBuildExtension
    {
        public override string ExtensionId => "quest-room";

        public override void OnScene(ArsistBuildContext context)
        {
            var mruk = Object.FindAnyObjectByType<MRUK>(FindObjectsInactive.Include);
            if (mruk == null)
            {
                var go = new GameObject("[MRUK]");
                mruk = go.AddComponent<MRUK>();
            }

            if (mruk.SceneSettings == null) mruk.SceneSettings = new MRUK.MRUKSettings();
            mruk.SceneSettings.DataSource = MRUK.SceneDataSource.Device;
            mruk.SceneSettings.LoadSceneOnStartup = false;
            mruk.SceneSettings.EnableHighFidelityScene = context.GetBool("highFidelity", false);
            mruk.EnableWorldLock = false;
            EditorUtility.SetDirty(mruk);

            int snapping = 0;
            foreach (var obj in context.ObjectsWithData())
            {
                var data = obj.DataFor(context.ExtensionId);
                if (data.TryGetValue("snapTo", out var snap) && snap is string s && s != "none") snapping++;
            }

            context.Log($"MRUK placed (load on start by quest-room: {context.GetBool("loadRoom", true)}, " +
                        $"high fidelity: {mruk.SceneSettings.EnableHighFidelityScene}); {snapping} object(s) will snap to real surfaces");
        }
    }
}
