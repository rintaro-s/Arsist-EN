// ==============================================
// Arsist Engine - Inference
// 実機のモデル一覧 (Resources/ArsistModels/models.json) と分割器
//
// ビルド時に ArsistBuildPipeline.CopyModelsToProject が
//   <id>/model.onnx      重み (Inference Engine の ModelAsset として取り込まれる。重みが別ファイルなら隣に)
//   <id>/tokenizer.json  文章のモデルの分割器
//   models.json          IR の ModelDefinition 一式
// を置く。ここはそれを読んで InferenceService を 1 つ作るだけ。
// ==============================================

using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Arsist.Runtime.Scripting;
using UnityEngine;

namespace Arsist.Runtime.Inference
{
    public static class ArsistModelCatalog
    {
        /// <summary>ArsistBuildPipeline の CatalogName / TokenizerFileName と揃えること。</summary>
        public const string CatalogName = "models";
        public const string TokenizerFileName = "tokenizer";

        private static InferenceService _service;
        private static ArsistModelExecutor _serviceExecutor;
        private static ArsistOrtRunner _ort;
        /// <summary>ONNX Runtime で動かすモデルの、端末側に写し終わったフォルダ。</summary>
        private static readonly Dictionary<string, string> _ortReady = new Dictionary<string, string>(StringComparer.Ordinal);
        private static readonly HashSet<string> _ortCopying = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// 推論の口。モデルが 1 つも無いビルド、または推論器がシーンに無いときは null。
        /// 推論器が作り直されたら (シーンの再読み込み) こちらも作り直す。
        /// </summary>
        public static InferenceService Service
        {
            get
            {
                var executor = ArsistModelExecutor.Instance;
                if (executor == null) return null;
                if (_service != null && _serviceExecutor == executor) return _service;

                _serviceExecutor = executor;
                _ort = _ort ?? new ArsistOrtRunner();
                var entries = LoadEntries();
                _service = new InferenceService(RunnerFor, entries, ReadTokenizer);

                // Unity のエンジンを通さないモデルは、APK の中では開けない。使う前に端末側へ写しておく。
                foreach (var entry in entries)
                {
                    if (entry.Runtime == "onnxruntime") StartCopy(entry);
                }
                return _service;
            }
        }

        private static List<ModelEntry> LoadEntries()
        {
            var entries = new List<ModelEntry>();
            var asset = Resources.Load<TextAsset>(ArsistModelExecutor.ResourcesFolder + "/" + CatalogName);
            if (asset == null || string.IsNullOrEmpty(asset.text))
            {
                Debug.LogWarning("[Arsist] No model catalog in Resources; model.* has nothing to run.");
                return entries;
            }
            try
            {
                var root = MiniJson.ParseObject(asset.text);
                foreach (var raw in MiniJson.List(root, "models") ?? new List<object>())
                {
                    var entry = ModelEntry.FromPlain(raw as Dictionary<string, object>);
                    if (entry != null) entries.Add(entry);
                }
                Debug.Log($"[Arsist] Model catalog: {entries.Count} model(s) " +
                          $"({string.Join(", ", entries.ConvertAll(e => $"{e.Name ?? e.Id} [{e.Use}]"))}).");
            }
            catch (Exception e)
            {
                Debug.LogError($"[Arsist] Model catalog unreadable: {e.Message}");
            }
            return entries;
        }

        /// <summary>そのモデルを実機で動かすもの。Unity が読めない書き出しは同梱の ONNX Runtime へ。</summary>
        private static IModelRunner RunnerFor(ModelEntry entry)
        {
            if (entry != null && entry.Runtime == "onnxruntime")
            {
                // 写し終わるまでは動かせない (理由がはっきり出るよう、待たずに断る)
                if (_ortReady.TryGetValue(entry.Id, out var folder))
                {
                    entry.File = Path.Combine(folder, ArsistModelExecutor.ModelFileName + ".onnx");
                    return _ort;
                }
                StartCopy(entry);
                return null;
            }
            return _serviceExecutor;
        }

        /// <summary>StreamingAssets (APK の中) から端末の書き込める場所へ写す。初回だけ。</summary>
        private static void StartCopy(ModelEntry entry)
        {
            if (entry == null || _ortReady.ContainsKey(entry.Id) || _ortCopying.Contains(entry.Id)) return;
            var runner = CoroutineRunner.Instance;
            if (runner == null) return;

            _ortCopying.Add(entry.Id);
            runner.StartCoroutine(Copy(entry));
        }

        private static IEnumerator Copy(ModelEntry entry)
        {
            var started = Time.realtimeSinceStartup;
            yield return ArsistOrtRunner.EnsureOnDisk(entry.Id, entry.Files, folder =>
            {
                _ortCopying.Remove(entry.Id);
                if (folder == null)
                {
                    Debug.LogError($"[Arsist] Model '{entry.Name ?? entry.Id}' could not be unpacked; it will not run.");
                    return;
                }
                _ortReady[entry.Id] = folder;
                entry.File = Path.Combine(folder, ArsistModelExecutor.ModelFileName + ".onnx");
                Debug.Log($"[Arsist] Model '{entry.Name ?? entry.Id}' ready for ONNX Runtime " +
                          $"({Time.realtimeSinceStartup - started:F1} s to unpack).");
            });
        }

        private static string ReadTokenizer(ModelEntry entry)
        {
            if (entry.Runtime == "onnxruntime")
            {
                // StreamingAssets から写した分割器を読む
                if (_ortReady.TryGetValue(entry.Id, out var folder))
                {
                    var path = Path.Combine(folder, TokenizerFileName + ".json");
                    if (File.Exists(path)) return File.ReadAllText(path);
                }
                return null;
            }
            var asset = Resources.Load<TextAsset>(ArsistModelExecutor.ResourcesFolder + "/" + entry.Id + "/" + TokenizerFileName);
            return asset != null ? asset.text : null;
        }
    }
}
