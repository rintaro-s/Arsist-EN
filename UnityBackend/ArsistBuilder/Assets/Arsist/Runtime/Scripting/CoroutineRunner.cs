using UnityEngine;

namespace Arsist.Runtime.Scripting
{
    /// <summary>
    /// MonoBehaviour を継承しないクラスからコルーチンを実行するためのシングルトン。
    /// ApiWrapper など非 MonoBehaviour クラスが非同期処理を行う際に使用する。
    /// </summary>
    public class CoroutineRunner : MonoBehaviour
    {
        private static CoroutineRunner _instance;

        public static CoroutineRunner Instance
        {
            get
            {
                if (_instance == null)
                {
                    var go = new GameObject("[ArsistCoroutineRunner]");
                    DontDestroyOnLoad(go);
                    _instance = go.AddComponent<CoroutineRunner>();
                }
                return _instance;
            }
        }

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }
            _instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private void OnDestroy()
        {
            if (_instance == this) _instance = null;
        }
    }
}
