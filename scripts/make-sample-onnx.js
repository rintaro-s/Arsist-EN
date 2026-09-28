// 依存無しで作れる小さな ONNX (ReduceMean) を tools/model-samples/ に書く。
// ネットからモデルを落とさずに、取り込み → プレビュー → 実機までの道を確かめるためのもの。
//
//   npm run build:main && node scripts/make-sample-onnx.js
const fs = require('fs');
const path = require('path');

const { buildChannelMeanModel } = require(path.join('..', 'dist', 'main', 'main', 'model', 'sampleModel'));

const outDir = path.join(__dirname, '..', 'tools', 'model-samples');
fs.mkdirSync(outDir, { recursive: true });

const model = buildChannelMeanModel({ height: 32, width: 32, opset: 13 });
const modelPath = path.join(outDir, 'channel-mean.onnx');
fs.writeFileSync(modelPath, Buffer.from(model));
fs.writeFileSync(path.join(outDir, 'channel-mean.labels.txt'), 'red\ngreen\nblue\n');
console.log(`[Arsist] wrote ${modelPath} (${model.length} bytes) and channel-mean.labels.txt`);
