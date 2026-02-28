// ==============================================
// Arsist Engine - Coroutine Runner
// Assets/Arsist/Runtime/Scripting/CoroutineRunner.cs
// ==============================================
using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// MonoBehaviour を継承しないクラス（ApiWrapper 等）が
    /// Unity コルーチンを実行できるようにするシングルトン。
    /// </summary>
    [UnityEngine.Scripting.Preserve]
    public class CoroutineRunner : MonoBehaviour
    {
        public static CoroutineRunner Instance { get; private set; }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }
    }
}
