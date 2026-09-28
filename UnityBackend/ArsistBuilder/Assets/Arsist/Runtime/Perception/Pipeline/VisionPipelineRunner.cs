// ==============================================
// Arsist Engine - Perception / Pipeline
// パイプラインを流す
//
// エンジンが持つのは「一手」だけで、その並べ方はプロジェクト側にある。
// 「曇り空を青空にする」も「赤いランプを数える」も、ここから見れば同じ、
// ただの op の列でしかない。
//
// UnityEngine に依存しない。カメラも描画も外に置いてあるので、
// tools/perception-check でパイプラインまるごと数値検証できる。
// ==============================================

using System;
using System.Collections.Generic;
using Arsist.Runtime.Perception.Models;
using Arsist.Runtime.Perception.Vision;
using Arsist.Runtime.Perception.Vision.Classic;

namespace Arsist.Runtime.Perception.Pipeline
{
    /// <summary>op から見える周辺情報。名前で他の値を引いたり、途中経過を残したりする。</summary>
    public sealed class VisionContext
    {
        private readonly Dictionary<string, VisionValue> _values;

        /// <summary>入力画の大きさ。マスクを作る op が使う。</summary>
        public int Width;
        public int Height;

        /// <summary>op が残した補足値。stats がまとめて拾って DataStore に流す。</summary>
        public readonly Dictionary<string, object> Notes = new Dictionary<string, object>();

        /// <summary>門が閉じた理由。null でなければ以降の op は流さない。</summary>
        public string StopReason { get; private set; }

        /// <summary>テンプレート画像を名前で引く。実機では StreamingAssets から。</summary>
        public Func<string, GrayImage> TemplateLoader;

        /// <summary>`infer` op が参照するモデル定義 (id → 定義)。</summary>
        public IReadOnlyDictionary<string, ModelSpec> Models;

        /// <summary>推論エンジン。null なら `infer` op は失敗する。</summary>
        public IVisionModelRunner ModelRunner;

        /// <summary>
        /// 実行をまたいで残る状態 (track / stabilize / motion / event が使う)。
        /// タスクごとにひとつ。op は自分の Id をキーにして読み書きする。
        /// </summary>
        public VisionState State = new VisionState();

        /// <summary>このフレームの時刻 (秒)。速度や冷却時間の計算に使う。</summary>
        public double TimeSeconds;

        /// <summary>このフレームで発火するイベント (event op が積む)。ランタイムが順に発火する。</summary>
        public readonly List<string> Events = new List<string>();

        public void Emit(string eventName)
        {
            if (!string.IsNullOrEmpty(eventName) && !Events.Contains(eventName)) Events.Add(eventName);
        }

        public VisionContext(Dictionary<string, VisionValue> values)
        {
            _values = values;
        }

        public bool TryGet(string name, out VisionValue value) => _values.TryGetValue(name, out value);

        public void Note(string key, object value) => Notes[key] = value;

        public void Stop(string reason) => StopReason = reason;

        public GrayImage LoadTemplate(string name)
        {
            if (string.IsNullOrEmpty(name) || TemplateLoader == null) return null;
            return TemplateLoader(name);
        }
    }

    /// <summary>実行をまたいで残る、op ごとの状態。中身は op が決める。</summary>
    public sealed class VisionState
    {
        private readonly Dictionary<string, object> _slots = new Dictionary<string, object>(StringComparer.Ordinal);

        public T Get<T>(string key) where T : class
        {
            return _slots.TryGetValue(key, out var raw) ? raw as T : null;
        }

        public void Set(string key, object value) => _slots[key] = value;

        public void Clear() => _slots.Clear();
    }

    public sealed class VisionPipelineResult
    {
        public bool Ok;
        public string Error = string.Empty;
        /// <summary>DataStore に入れる値。</summary>
        public Dictionary<string, object> Values = new Dictionary<string, object>();
        /// <summary>名前つきの中間結果。出力先の解決に使う。</summary>
        public Dictionary<string, VisionValue> Named = new Dictionary<string, VisionValue>();
        /// <summary>
        /// 描く出力 (world / image) ごとの、アルファ付き RGBA。
        /// 作るのに数 ms かかるので、ワーカーで先に作っておき、メインスレッドは転送だけにする。
        /// キーは Outputs の添字。
        /// </summary>
        public Dictionary<int, byte[]> PreparedRgba = new Dictionary<int, byte[]>();

        /// <summary>門が閉じたか。「見つからなかった」は失敗ではない。</summary>
        public bool Gated;
        public string GateReason = string.Empty;

        /// <summary>event op が発火を求めたイベント名。</summary>
        public List<string> Events = new List<string>();

        public static VisionPipelineResult Failure(string error) =>
            new VisionPipelineResult { Ok = false, Error = error };
    }

    public sealed class VisionPipelineSpec
    {
        public string Id;
        public string Name;
        public int MaxWidth = 480;
        public List<VisionOpSpec> Ops = new List<VisionOpSpec>();
        public List<VisionOutputSpec> Outputs = new List<VisionOutputSpec>();
    }

    public sealed class VisionOutputSpec
    {
        public string Kind = "store";
        public string Value;
        public string Alpha;
        public string StoreAs;
        public string BindingId;

        // anchor 出力: 見つけた物の位置に置く
        /// <summary>置く距離 (m)。深度が分からない端末では、この距離の球面上に置く。</summary>
        public double Distance = 2.0;
        /// <summary>ラベルとして出す項目名 ("label" / "score" / "id" / "" = 出さない)。</summary>
        public string Label = "label";
        /// <summary>最初の項目の位置へ動かすシーンオブジェクトの assetId (省略可)。</summary>
        public string ObjectId;
        public int MaxItems = 8;
    }

    public static class VisionPipelineRunner
    {
        /// <summary>入力画に与えられる名前。パイプラインはここから始まる。</summary>
        public const string SourceName = "source";

        /// <summary>
        /// 繋ぎ方が正しいかを見る。実行前に落とせる間違いは実行前に落とす。
        /// 返すのは人が読める問題の一覧で、空なら問題なし。
        /// </summary>
        public static List<string> Validate(
            VisionPipelineSpec pipeline, IReadOnlyDictionary<string, ModelSpec> models = null)
        {
            var problems = new List<string>();
            if (pipeline == null)
            {
                problems.Add("pipeline is missing");
                return problems;
            }
            if (pipeline.Ops == null || pipeline.Ops.Count == 0)
            {
                problems.Add("pipeline has no operations");
                return problems;
            }

            // 名前 → その時点での型。source は必ず色で始まる。
            var types = new Dictionary<string, VisionValueKind>(StringComparer.Ordinal)
            {
                [SourceName] = VisionValueKind.Color,
            };
            string previous = SourceName;

            foreach (var op in pipeline.Ops)
            {
                if (string.IsNullOrEmpty(op.Out))
                {
                    problems.Add($"op '{op.Id ?? op.Op}' has no output name");
                    continue;
                }
                if (!VisionOps.Signatures.TryGetValue(op.Op ?? "", out var signature))
                {
                    problems.Add($"op '{op.Id ?? "?"}' uses an unknown operation '{op.Op}'");
                    continue;
                }

                var inputs = (op.In != null && op.In.Length > 0) ? op.In : new[] { previous };
                if (inputs.Length < signature.Inputs.Length)
                {
                    problems.Add(
                        $"op '{op.Id ?? op.Op}' needs {signature.Inputs.Length} input(s) but got {inputs.Length}");
                    continue;
                }

                bool wired = true;
                for (int i = 0; i < signature.Inputs.Length; i++)
                {
                    if (!types.TryGetValue(inputs[i], out var actual))
                    {
                        problems.Add($"op '{op.Id ?? op.Op}' reads '{inputs[i]}', which nothing produces");
                        wired = false;
                        break;
                    }
                    if (actual != signature.Inputs[i])
                    {
                        problems.Add(
                            $"op '{op.Id ?? op.Op}' input {i + 1} wants {signature.Inputs[i]} but '{inputs[i]}' is {actual}");
                        wired = false;
                        break;
                    }
                }
                if (!wired) continue;

                if (string.Equals(op.Op, "infer", StringComparison.OrdinalIgnoreCase))
                {
                    // モデルの参照は結線と同じくらい壊れやすい (消したモデルを指したまま残る)。
                    // 型だけは登録しておく。しないと後ろの op まで「作っている一手が無い」と
                    // 連鎖して、本当の原因 (モデルの参照) が埋もれる。
                    var modelId = op.Text("model", null);
                    if (modelId == null)
                    {
                        problems.Add($"op '{op.Id ?? op.Op}' has no model selected");
                    }
                    else if (models != null && !models.ContainsKey(modelId))
                    {
                        problems.Add($"op '{op.Id ?? op.Op}' uses model '{modelId}', which is not defined");
                    }
                    else if (models != null && models[modelId].Use != "image")
                    {
                        // 文章・テンソルのモデルに画を流しても意味が無い (スクリプトの model.* で使うもの)
                        problems.Add($"op '{op.Id ?? op.Op}' uses model '{modelId}', which is a {models[modelId].Use} model, not an image model");
                    }
                }

                if (op.Disabled && !VisionOps.CanBypass(op, models))
                {
                    problems.Add($"op '{op.Id ?? op.Op}' is disabled but cannot be bypassed (its output type differs from its input)");
                }

                // 外した op は素通し: 出力は最初の入力そのもの
                types[op.Out] = op.Disabled && VisionOps.CanBypass(op, models) ? types[inputs[0]] : VisionOps.OutputKindOf(op, models);
                previous = op.Out;
            }

            foreach (var output in pipeline.Outputs ?? new List<VisionOutputSpec>())
            {
                if (string.IsNullOrEmpty(output.Value))
                {
                    problems.Add("an output has no value name");
                    continue;
                }
                if (!types.TryGetValue(output.Value, out var kind))
                {
                    problems.Add($"output reads '{output.Value}', which nothing produces");
                    continue;
                }

                switch (output.Kind)
                {
                    case "anchor":
                        if (kind != VisionValueKind.Blobs && kind != VisionValueKind.Quads)
                        {
                            problems.Add($"output '{output.Value}' must be a list of found things (blobs / quads) to be anchored, but it is {kind}");
                        }
                        break;

                    case "world":
                    case "image":
                        if (kind != VisionValueKind.Color)
                        {
                            problems.Add($"output '{output.Value}' must be a colour image to be drawn, but it is {kind}");
                        }
                        if (!string.IsNullOrEmpty(output.Alpha))
                        {
                            if (!types.TryGetValue(output.Alpha, out var alphaKind))
                            {
                                problems.Add($"output alpha '{output.Alpha}' is not produced by anything");
                            }
                            else if (alphaKind != VisionValueKind.Mask)
                            {
                                problems.Add($"output alpha '{output.Alpha}' must be a mask but is {alphaKind}");
                            }
                        }
                        if (output.Kind == "image" && string.IsNullOrEmpty(output.BindingId))
                        {
                            problems.Add("an image output has no binding id");
                        }
                        break;

                    default:
                        if (string.IsNullOrEmpty(output.StoreAs))
                        {
                            problems.Add($"store output for '{output.Value}' has no key");
                        }
                        break;
                }
            }

            return problems;
        }

        /// <summary>パイプラインを流す。</summary>
        /// <param name="state">前回までの状態。null なら毎回まっさら (追跡や平滑化は効かない)。</param>
        /// <param name="timeSeconds">このフレームの時刻。</param>
        public static VisionPipelineResult Run(
            VisionPipelineSpec pipeline, ColorImage source, Func<string, GrayImage> templateLoader = null,
            IReadOnlyDictionary<string, ModelSpec> models = null, IVisionModelRunner modelRunner = null,
            VisionState state = null, double timeSeconds = 0)
        {
            if (source == null || source.Width < 8 || source.Height < 8)
                return VisionPipelineResult.Failure("noImage");

            var problems = Validate(pipeline, models);
            if (problems.Count > 0)
                return VisionPipelineResult.Failure(problems[0]);

            var work = pipeline.MaxWidth > 0 ? source.ScaledToWidth(pipeline.MaxWidth) : source;

            var values = new Dictionary<string, VisionValue>(StringComparer.Ordinal)
            {
                [SourceName] = VisionValue.OfColor(work),
            };
            var context = new VisionContext(values)
            {
                Width = work.Width,
                Height = work.Height,
                TemplateLoader = templateLoader,
                Models = models,
                ModelRunner = modelRunner,
                State = state ?? new VisionState(),
                TimeSeconds = timeSeconds,
            };

            var result = new VisionPipelineResult { Ok = true };
            string previous = SourceName;

            foreach (var op in pipeline.Ops)
            {
                var inputNames = (op.In != null && op.In.Length > 0) ? op.In : new[] { previous };
                var signature = VisionOps.Signatures[op.Op];

                var inputs = new VisionValue[signature.Inputs.Length];
                for (int i = 0; i < inputs.Length; i++) inputs[i] = values[inputNames[i]];

                VisionValue produced;
                if (op.Disabled)
                {
                    // 外した op: 最初の入力をそのまま出力に (Validate が型の一致を確かめている)
                    produced = inputs[0];
                }
                else
                {
                    try
                    {
                        produced = VisionOps.Apply(op, inputs, context);
                    }
                    catch (Exception e)
                    {
                        return VisionPipelineResult.Failure($"{op.Id ?? op.Op}: {e.Message}");
                    }
                }

                values[op.Out] = produced;
                previous = op.Out;

                // 門が閉じたらそこで止める。以降の op を流しても意味が無いうえ、
                // 「見つからなかった」ことを結果として返したい。
                if (context.StopReason != null)
                {
                    result.Gated = true;
                    result.GateReason = context.StopReason;
                    break;
                }
            }

            result.Named = values;
            result.Events = new List<string>(context.Events);
            CollectOutputs(pipeline, values, result);
            if (!result.Gated) PrepareDrawings(pipeline, values, result);
            return result;
        }

        /// <summary>描く出力の RGBA を作っておく。境界は 3 回ぼかして階段状に見えないようにする。</summary>
        private static void PrepareDrawings(
            VisionPipelineSpec pipeline, Dictionary<string, VisionValue> values, VisionPipelineResult result)
        {
            var outputs = pipeline.Outputs ?? new List<VisionOutputSpec>();
            for (int i = 0; i < outputs.Count; i++)
            {
                var output = outputs[i];
                if (output.Kind != "world" && output.Kind != "image") continue;
                if (!values.TryGetValue(output.Value ?? "", out var painted) || painted.Color == null) continue;

                MaskImage alpha = null;
                if (!string.IsNullOrEmpty(output.Alpha) && values.TryGetValue(output.Alpha, out var alphaValue))
                {
                    alpha = alphaValue.Mask;
                }

                var rgba = Composite.ToRgba(painted.Color, alpha, 3);
                if (rgba != null) result.PreparedRgba[i] = rgba;
            }
        }

        private static void CollectOutputs(
            VisionPipelineSpec pipeline, Dictionary<string, VisionValue> values, VisionPipelineResult result)
        {
            foreach (var output in pipeline.Outputs ?? new List<VisionOutputSpec>())
            {
                if (output.Kind != "store") continue;
                if (!values.TryGetValue(output.Value, out var value)) continue;

                object payload;
                switch (value.Kind)
                {
                    case VisionValueKind.Record: payload = value.Record; break;
                    case VisionValueKind.Blobs:
                    case VisionValueKind.Contours:
                    case VisionValueKind.Quads: payload = value.Items; break;
                    default:
                        // 画そのものは DataStore に入れても意味が無いので、大きさだけ残す。
                        payload = new Dictionary<string, object>
                        {
                            ["width"] = value.Width,
                            ["height"] = value.Height,
                        };
                        break;
                }

                if (string.IsNullOrEmpty(output.StoreAs)) continue;
                result.Values[output.StoreAs] = payload;
            }
        }
    }
}
