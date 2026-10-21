// ==============================================
// Arsist Extension: quest-hands — script API (handVisuals)
// samples/extensions/quest-hands/Runtime/HandVisualsApi.cs
// ==============================================

using System;
using UnityEngine;

namespace Arsist.Extensions.QuestHands
{
    [UnityEngine.Scripting.Preserve]
    public sealed class HandVisualsApi
    {
        private readonly Func<HandVisualService> _service;

        public HandVisualsApi(Func<HandVisualService> service)
        {
            _service = service;
        }

        /// <summary>今の見え方: "virtual" / "real" / "off"。</summary>
        [UnityEngine.Scripting.Preserve]
        public string look() => _service()?.Look ?? "off";

        /// <summary>見え方を変える。</summary>
        [UnityEngine.Scripting.Preserve]
        public bool look(string mode)
        {
            var s = _service();
            if (s == null) return false;
            if (!s.SetLook(mode))
            {
                Debug.LogWarning($"[Arsist:quest-hands] handVisuals.look('{mode}'): use virtual / real / off");
                return false;
            }
            return true;
        }

        /// <summary>手を出す / 出さない。</summary>
        [UnityEngine.Scripting.Preserve]
        public void showHands(bool show) => _service()?.SetParts(show, null);

        /// <summary>コントローラーを出す / 出さない。</summary>
        [UnityEngine.Scripting.Preserve]
        public void showControllers(bool show) => _service()?.SetParts(null, show);
    }
}
