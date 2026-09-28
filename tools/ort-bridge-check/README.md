# ONNX Runtime ブリッジの通し確認 (デスクトップ JVM)

実機に積む Java ブリッジ (`UnityBackend/.../Editor/AndroidPlugins/ArsistOnnxRuntime.java.txt`) は、
**Android でしか動かない道**なので、ふつうは何も検証されない。壊れていても実機で
「理由の無いエラー」が出るだけで、原因を追うのに時間がかかる (2026-09 に実際にそうなった)。

ここでは同じ Java を**デスクトップの JVM** で動かし、C# (`ArsistOrtRunner`) がしているのと
同じ順番で呼んで確かめる。`android.util.Log` だけ最小の差し替えを置く。

```bash
# 1) 実機と同じ版の ONNX Runtime (デスクトップ用) を取る
curl -sSLo /tmp/ort.jar \
  https://repo1.maven.org/maven2/com/microsoft/onnxruntime/onnxruntime/1.30.0/onnxruntime-1.30.0.jar

# 2) 動かす (モデルは任意の ONNX。文章のモデルなら通しの生成まで見る)
node tools/ort-bridge-check/run.js /tmp/ort.jar <model.onnx>
```

見るもの:

- `open` / `describe` … セッションが開き、入出力の JSON が C# の読み方と合っているか
- `createLong` / `createFloat` … 形と値の数が合っていること。**要素 0 の入力は正しい**
  (最初の一歩の KV キャッシュは長さ 0 で渡す)
- 形と値の数が食い違うときに、**理由が付いたエラー**になること

**これが通っても、実機で動くとは限らない。** JNI は「つないでいないスレッドからは何も呼べない」
という制約があり、そこは実機でしか出ない (`ArsistOrtRunner` が別スレッドで
`AndroidJNI.AttachCurrentThread()` するのはこのため)。
