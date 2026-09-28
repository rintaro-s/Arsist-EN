// ==============================================
// Arsist Engine - Inference
// 型つきのテンソル、モデルの入出力の形、推論器との契約
//
// 画像認識の `infer` op は「画 1 枚 → float の出力」で足りたが、文章のモデル (LLM や埋め込み)
// は整数の入力 (トークン番号) を何本も取り、KV キャッシュを出し入れする。そこでモデルを
// 「名前つきのテンソルの辞書 → 名前つきのテンソルの辞書」として扱う汎用の口をここに置く。
// 画像認識 (IVisionModelRunner) もスクリプトも、実機では同じ推論器を通る。
//
//   実機:     ArsistModelExecutor (Unity Inference Engine、GPU compute か CPU)
//   エディタ: tools/vision-preview の OnnxModelRunner (ONNX Runtime)
//   検証:     tools/perception-check の偽物
//
// 大きさ 0 の軸を許す (KV キャッシュの最初の一歩は「過去の長さ 0」)。
// UnityEngine に依存しない。
// ==============================================

using System;
using System.Collections.Generic;
using System.Globalization;

namespace Arsist.Runtime.Inference
{
    /// <summary>
    /// 要素の型。ONNX の float16 は Float として持つ (推論器が出し入れの際に変換する)。
    /// 整数と真偽値は long で持つ。
    /// </summary>
    public enum TensorKind { Float, Int64, Int32, Bool }

    public sealed class ModelTensor
    {
        public readonly TensorKind Kind;
        public readonly int[] Shape;

        private float[] _floats;
        private long[] _longs;
        private readonly Func<ModelTensor, float[]> _fetchFloats;

        /// <summary>
        /// 推論器がそのまま持っている実体 (実機の ONNX Runtime の OnnxTensor など)。
        ///
        /// LLM の KV キャッシュは 1 歩ごとに数 MB あり、出すたびに値を運ぶと、そこだけで時間が溶ける。
        /// 出力をそのまま次の一歩の入力に渡せるよう、値ではなく「あちら側の持ち物」として運ぶ。
        /// 値が要るとき (logits を読むとき) だけ、Floats / Longs が取りに行く。
        /// </summary>
        public readonly object Handle;

        /// <summary>Kind が Float のときの値。あちら側にあるなら、ここで初めて運ぶ。</summary>
        public float[] Floats
        {
            get
            {
                if (_floats == null && _fetchFloats != null) _floats = _fetchFloats(this);
                return _floats;
            }
        }

        /// <summary>Kind が整数か真偽値のときの値。</summary>
        public long[] Longs => _longs;

        private ModelTensor(TensorKind kind, int[] shape, float[] floats, long[] longs,
            object handle = null, Func<ModelTensor, float[]> fetchFloats = null)
        {
            if (shape == null) throw new ArgumentException("tensor needs a shape");
            if (handle == null && fetchFloats == null)
            {
                long expected = Count(shape);
                long actual = floats != null ? floats.Length : longs?.Length ?? 0;
                if (actual != expected)
                    throw new ArgumentException($"tensor has {actual} values but the shape [{string.Join(",", shape)}] needs {expected}");
            }
            Kind = kind;
            Shape = shape;
            _floats = floats;
            _longs = longs;
            Handle = handle;
            _fetchFloats = fetchFloats;
        }

        /// <summary>推論器の中にある出力を、値を運ばずに包む。</summary>
        public static ModelTensor Device(TensorKind kind, int[] shape, object handle, Func<ModelTensor, float[]> fetchFloats = null) =>
            new ModelTensor(kind, shape, null, null, handle, fetchFloats);

        /// <summary>値を運ばずに次の一歩へ渡せるか。</summary>
        public bool IsDeviceHeld => Handle != null;

        public static ModelTensor Float(int[] shape, float[] data) => new ModelTensor(TensorKind.Float, shape, data ?? Array.Empty<float>(), null);
        public static ModelTensor Int64(int[] shape, long[] data) => new ModelTensor(TensorKind.Int64, shape, null, data ?? Array.Empty<long>());
        public static ModelTensor Int32(int[] shape, long[] data) => new ModelTensor(TensorKind.Int32, shape, null, data ?? Array.Empty<long>());
        public static ModelTensor Bool(int[] shape, long[] data) => new ModelTensor(TensorKind.Bool, shape, null, data ?? Array.Empty<long>());

        public static ModelTensor Of(TensorKind kind, int[] shape, double[] values)
        {
            if (kind == TensorKind.Float)
            {
                var f = new float[values.Length];
                for (int i = 0; i < f.Length; i++) f[i] = (float)values[i];
                return Float(shape, f);
            }
            var l = new long[values.Length];
            for (int i = 0; i < l.Length; i++) l[i] = (long)Math.Round(values[i]);
            return new ModelTensor(kind, shape, null, l);
        }

        /// <summary>同じ値で埋めたテンソル。</summary>
        public static ModelTensor Filled(TensorKind kind, int[] shape, double value)
        {
            long n = Count(shape);
            if (kind == TensorKind.Float)
            {
                var f = new float[n];
                if (value != 0) for (long i = 0; i < n; i++) f[i] = (float)value;
                return Float(shape, f);
            }
            var l = new long[n];
            if (value != 0) for (long i = 0; i < n; i++) l[i] = (long)Math.Round(value);
            return new ModelTensor(kind, shape, null, l);
        }

        public bool IsFloat => Kind == TensorKind.Float;
        public int Rank => Shape.Length;
        /// <summary>値の数。あちら側にあるものは、形から数える (値は運ばない)。</summary>
        public int Length => _floats != null ? _floats.Length : _longs != null ? _longs.Length : (int)Count(Shape);

        /// <summary>添字 i の大きさ。範囲外なら 1。</summary>
        public int Dim(int i) => i >= 0 && i < Shape.Length ? Shape[i] : 1;

        public float FloatAt(int i) => _longs != null ? _longs[i] : Floats[i];
        public long LongAt(int i) => _longs != null ? _longs[i] : (long)Math.Round(Floats[i]);

        public float[] ToFloats()
        {
            if (_longs == null) return Floats;
            var f = new float[_longs.Length];
            for (int i = 0; i < f.Length; i++) f[i] = _longs[i];
            return f;
        }

        public long[] ToLongs()
        {
            if (_longs != null) return _longs;
            var floats = Floats;
            var l = new long[floats.Length];
            for (int i = 0; i < l.Length; i++) l[i] = (long)Math.Round(floats[i]);
            return l;
        }

        /// <summary>要素の型を変える (モデルが int32 を取るのに int64 で渡された、など)。</summary>
        public ModelTensor As(TensorKind kind)
        {
            if (kind == Kind) return this;
            // あちら側が持っているものは、型が同じなら触らない。違うなら値を運んでから作り直す。
            if (kind == TensorKind.Float) return Float(Shape, ToFloats());
            return new ModelTensor(kind, Shape, null, ToLongs());
        }

        public string ShapeText() => "[" + string.Join(",", Shape) + "]";

        public static long Count(int[] shape)
        {
            long n = 1;
            foreach (var d in shape)
            {
                if (d < 0) throw new ArgumentException("tensor dimensions must not be negative");
                n *= d;
            }
            return n;
        }

        public static bool TryParseKind(string text, out TensorKind kind)
        {
            switch ((text ?? "").Trim().ToLowerInvariant())
            {
                case "float": case "float32": case "float16": case "half": case "double": case "number":
                    kind = TensorKind.Float; return true;
                case "int64": case "long": case "int": case "integer":
                    kind = TensorKind.Int64; return true;
                case "int32":
                    kind = TensorKind.Int32; return true;
                case "bool": case "boolean":
                    kind = TensorKind.Bool; return true;
                default:
                    kind = TensorKind.Float; return false;
            }
        }

        public static string KindName(TensorKind kind)
        {
            switch (kind)
            {
                case TensorKind.Int64: return "int64";
                case TensorKind.Int32: return "int32";
                case TensorKind.Bool: return "bool";
                default: return "float";
            }
        }

        // ---- 素の木と行き来する (スクリプト・ツールとのやり取り用) ----

        /// <summary>{ type, shape, data } に。data は数の配列 (真偽値も 0/1)。</summary>
        public Dictionary<string, object> ToPlain(int maxValues = int.MaxValue)
        {
            int n = Math.Min(Length, Math.Max(0, maxValues));
            var data = new List<object>(n);
            var floats = _longs == null ? Floats : null;
            for (int i = 0; i < n; i++) data.Add(floats != null ? (double)floats[i] : (double)_longs[i]);
            var shape = new List<object>(Shape.Length);
            foreach (var d in Shape) shape.Add((double)d);
            var plain = new Dictionary<string, object>
            {
                ["type"] = KindName(Kind),
                ["shape"] = shape,
                ["data"] = data,
            };
            if (n < Length) plain["truncated"] = true;
            return plain;
        }

        /// <summary>
        /// { type?, shape?, data } か、ただの数の配列から作る。
        /// 型や形が無ければ、モデルの入力の定義 (info) から補う。形の -1 はデータの長さから決める。
        /// </summary>
        public static ModelTensor FromPlain(object raw, TensorInfo info, out string error)
        {
            error = null;
            List<object> dataList;
            List<object> shapeList = null;
            string typeText = null;

            if (raw is List<object> bare)
            {
                dataList = bare;
            }
            else if (raw is Dictionary<string, object> map)
            {
                dataList = MiniJson.List(map, "data");
                shapeList = MiniJson.List(map, "shape");
                typeText = MiniJson.Text(map, "type");
                if (dataList == null) { error = "noData"; return null; }
            }
            else if (raw is double single)
            {
                dataList = new List<object> { single };
                shapeList = new List<object>();
            }
            else
            {
                error = "badTensor";
                return null;
            }

            var values = new List<double>(dataList.Count);
            Flatten(dataList, values);

            TensorKind kind = info?.Kind ?? TensorKind.Float;
            if (typeText != null && !TryParseKind(typeText, out kind)) { error = "badType:" + typeText; return null; }

            int[] shape;
            if (shapeList != null)
            {
                shape = new int[shapeList.Count];
                for (int i = 0; i < shape.Length; i++)
                    shape[i] = (int)Math.Round(Convert.ToDouble(shapeList[i] ?? -1, CultureInfo.InvariantCulture));
            }
            else if (info != null && info.Shape != null && info.Shape.Length > 0)
            {
                shape = (int[])info.Shape.Clone();
            }
            else
            {
                shape = new[] { values.Count };
            }

            if (!ResolveShape(shape, values.Count, out error)) return null;
            return Of(kind, shape, values.ToArray());
        }

        private static void Flatten(List<object> list, List<double> into)
        {
            foreach (var item in list)
            {
                switch (item)
                {
                    case List<object> nested: Flatten(nested, into); break;
                    case bool b: into.Add(b ? 1 : 0); break;
                    case null: into.Add(0); break;
                    default: into.Add(Convert.ToDouble(item, CultureInfo.InvariantCulture)); break;
                }
            }
        }

        /// <summary>
        /// 形の未定の軸 (-1) をデータの長さから決める。未定が 2 つ以上なら、最初を 1 (バッチ) にする。
        /// </summary>
        public static bool ResolveShape(int[] shape, int count, out string error)
        {
            error = null;
            var unknown = new List<int>();
            long known = 1;
            for (int i = 0; i < shape.Length; i++)
            {
                if (shape[i] < 0) unknown.Add(i);
                else known *= shape[i];
            }
            while (unknown.Count > 1)
            {
                shape[unknown[0]] = 1;
                unknown.RemoveAt(0);
            }
            if (unknown.Count == 1)
            {
                if (known == 0 || count % known != 0) { error = $"shapeMismatch:{count}"; return false; }
                shape[unknown[0]] = (int)(count / known);
                return true;
            }
            if (known != count) { error = $"shapeMismatch:{count}"; return false; }
            return true;
        }
    }

    /// <summary>モデルの入力 / 出力 1 本の定義。形の -1 は実行時に決まる軸。</summary>
    public sealed class TensorInfo
    {
        public string Name;
        public TensorKind Kind = TensorKind.Float;
        /// <summary>null は階数も分からない。</summary>
        public int[] Shape;

        public Dictionary<string, object> ToPlain()
        {
            var shape = new List<object>();
            if (Shape != null) foreach (var d in Shape) shape.Add((double)d);
            return new Dictionary<string, object> { ["name"] = Name, ["type"] = ModelTensor.KindName(Kind), ["shape"] = shape };
        }
    }

    public sealed class ModelSignature
    {
        public readonly List<TensorInfo> Inputs = new List<TensorInfo>();
        public readonly List<TensorInfo> Outputs = new List<TensorInfo>();

        public TensorInfo Input(string name) => Inputs.Find(i => string.Equals(i.Name, name, StringComparison.Ordinal));
        public TensorInfo Output(string name) => Outputs.Find(o => string.Equals(o.Name, name, StringComparison.Ordinal));
        public bool HasInput(string name) => Input(name) != null;

        public Dictionary<string, object> ToPlain()
        {
            var inputs = new List<object>();
            foreach (var i in Inputs) inputs.Add(i.ToPlain());
            var outputs = new List<object>();
            foreach (var o in Outputs) outputs.Add(o.ToPlain());
            return new Dictionary<string, object> { ["inputs"] = inputs, ["outputs"] = outputs };
        }
    }

    /// <summary>どのモデルを動かすか。</summary>
    public sealed class ModelRef
    {
        public string Id;
        /// <summary>ONNX のパス (エディタのツールだけが使う。実機は Id で Resources から読む)。</summary>
        public string File;
        /// <summary>"auto" / "gpu" / "cpu"</summary>
        public string Backend = "auto";
    }

    public sealed class ModelRunResult
    {
        public bool Ok;
        public string Error;
        public Dictionary<string, ModelTensor> Outputs;
        public double Ms;

        public static ModelRunResult Fail(string error) => new ModelRunResult { Ok = false, Error = error };
    }

    /// <summary>
    /// 推論器との汎用の契約。
    ///
    /// Run の完了 (done) は、実機ではメインスレッドの後のフレームで、ツールでは呼んだその場で呼ばれる。
    /// 呼ぶ側はどちらでも動くように書く (TextGenerationDriver 参照)。
    /// </summary>
    public interface IModelRunner
    {
        /// <summary>入出力の名前・型・形。実機ではメインスレッドから呼ぶ (モデルを読む)。</summary>
        bool TryDescribe(ModelRef model, out ModelSignature signature, out string error);

        void Run(ModelRef model, Dictionary<string, ModelTensor> inputs, Action<ModelRunResult> done);
    }
}
