// ==============================================
// Arsist Engine - 端末に保存する値 (project.storage.persist)
//
// ストア (ArsistDataStore) の値のうち、指定したキーをアプリを閉じても残す。
//   読む: scripts.json を読んだ直後、スクリプトの onStart より前 (ScriptEngineManager.LoadScriptsAsync)
//   書く: 指定に当たるキーが変わってから約 1 秒後 (まとめて 1 回)、アプリが裏に回ったとき、終わるとき
// ファイルは Application.persistentDataPath/arsist-storage.json。一時ファイルに書いてから差し替えるので、
// 書いている途中で電源が落ちても前の内容は残る。規則とファイル形式は PersistentValues。
//
// 保存するのは「その時点のストアの中身のうち、指定に当たるもの全部」。store.remove / storage.forget で
// 消した値は次の保存でファイルからも消える。
// ==============================================

using System;
using System.Collections.Generic;
using System.IO;
using Arsist.Runtime.DataFlow;
using UnityEngine;

namespace Arsist.Runtime.Data
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ArsistPersistentStore : MonoBehaviour
    {
        public const string FileName = "arsist-storage.json";
        private const float SaveDelaySeconds = 1f;

        public static ArsistPersistentStore Instance { get; private set; }

        private readonly List<string> _rules = new List<string>();
        private bool _loading;
        private bool _dirty;
        private float _saveAt;
        private bool _subscribed;

        public IReadOnlyList<string> Rules => _rules;
        public bool Enabled => _rules.Count > 0;

        public static string FilePath => Path.Combine(Application.persistentDataPath, FileName);

        private IArsistStorageBackend _backend;

        /// <summary>書く先。拡張機能が "storage-backend" を置き換えていればそれ、無ければ端末のファイル。</summary>
        private IArsistStorageBackend Backend =>
            _backend ??= Arsist.Runtime.Extensions.ArsistEngineParts.Get<IArsistStorageBackend>(Arsist.Runtime.Extensions.ArsistEngineParts.StorageBackend)
                         ?? new ArsistFileStorageBackend(FilePath);

        public static ArsistPersistentStore Ensure(GameObject owner)
        {
            if (Instance == null) Instance = owner.AddComponent<ArsistPersistentStore>();
            return Instance;
        }

        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(this); return; }
            Instance = this;
        }

        /// <summary>どのキーを残すか (scripts.json の storage.persist)。読み込みもここで行う。</summary>
        public void Configure(IEnumerable<string> rules)
        {
            _rules.Clear();
            if (rules != null)
                foreach (var rule in rules)
                    if (!string.IsNullOrWhiteSpace(rule) && !_rules.Contains(rule.Trim())) _rules.Add(rule.Trim());

            if (!_subscribed)
            {
                ArsistDataStore.Instance.OnValueChanged += HandleValueChanged;
                _subscribed = true;
            }

            if (_rules.Count == 0)
            {
                Debug.Log("[Arsist] storage: nothing is kept on the device (project.storage.persist is empty)");
                return;
            }
            Load();
        }

        private void Load()
        {
            var backend = Backend;
            string text;
            try
            {
                text = backend.Read();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] storage: reading {backend.Name} failed: {e.Message}");
                return;
            }
            if (text == null)
            {
                Debug.Log($"[Arsist] storage: no saved values yet ({string.Join(", ", _rules)})");
                return;
            }

            var values = PersistentValues.Deserialize(text, out var error);
            if (values == null)
            {
                // 壊れた中身は消さずに脇へ置く (後で調べられるように)
                Debug.LogWarning($"[Arsist] storage: {backend.Name} could not be read ({error}); starting empty. Kept aside as unreadable");
                backend.KeepUnreadable(text);
                return;
            }

            int restored = 0, skipped = 0;
            _loading = true;
            try
            {
                foreach (var pair in values)
                {
                    // 指定から外したキーは戻さない (次の保存でファイルからも消える)
                    if (!PersistentValues.IsPersisted(pair.Key, _rules)) { skipped++; continue; }
                    ArsistDataStore.Instance.SetValue(pair.Key, pair.Value);
                    restored++;
                }
            }
            finally
            {
                _loading = false;
            }
            Debug.Log($"[Arsist] storage: restored {restored} value(s){(skipped > 0 ? $", ignored {skipped} no longer listed" : "")}");
        }

        private void HandleValueChanged(string key, object value)
        {
            if (_loading || _rules.Count == 0) return;
            if (!PersistentValues.IsPersisted(key, _rules)) return;
            if (!_dirty) _saveAt = Time.unscaledTime + SaveDelaySeconds;
            _dirty = true;
        }

        private void Update()
        {
            if (_dirty && Time.unscaledTime >= _saveAt) Save();
        }

        /// <summary>今すぐ書き出す。指定が空なら何もしない。</summary>
        public bool Save()
        {
            _dirty = false;
            if (_rules.Count == 0) return false;
            try
            {
                var picked = PersistentValues.Select(ArsistDataStore.Instance.GetSnapshot(), _rules);
                Backend.Write(PersistentValues.Serialize(picked, DateTime.UtcNow));
                return true;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Arsist] storage: saving failed: {e.Message}");
                return false;
            }
        }

        public bool IsPersisted(string key) => PersistentValues.IsPersisted(key, _rules);

        /// <summary>今ストアにある、残す指定のキー (名前順)。</summary>
        public List<string> SavedKeys(string prefix)
        {
            var keys = new List<string>(PersistentValues.Select(ArsistDataStore.Instance.GetSnapshot(), _rules).Keys);
            if (!string.IsNullOrEmpty(prefix)) keys.RemoveAll(k => !k.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
            return keys;
        }

        /// <summary>ストアから消して、すぐ書き出す。消した数を返す。</summary>
        public int Forget(string keyOrPrefix)
        {
            if (string.IsNullOrEmpty(keyOrPrefix)) return 0;
            int removed = 0;
            foreach (var key in ArsistDataStore.Instance.GetSnapshot().Keys)
            {
                if (!PersistentValues.MatchesForget(key, keyOrPrefix)) continue;
                ArsistDataStore.Instance.RemoveValue(key);
                removed++;
            }
            Save();
            return removed;
        }

        private void OnApplicationPause(bool paused)
        {
            if (paused && _dirty) Save();
        }

        private void OnApplicationQuit()
        {
            if (_dirty) Save();
        }

        private void OnDestroy()
        {
            if (_dirty) Save();
            if (_subscribed) ArsistDataStore.Instance.OnValueChanged -= HandleValueChanged;
            if (Instance == this) Instance = null;
        }
    }
}
