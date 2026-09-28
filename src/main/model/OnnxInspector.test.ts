import { describe, it, expect } from 'vitest';
import { inspectOnnxBuffer, suggestDefinition } from './OnnxInspector';
import { buildChannelMeanModel } from './sampleModel';
import { ProtoWriter, readFields } from './protobuf';

describe('protobuf wire format', () => {
  it('round-trips varints, strings and nested messages', () => {
    const bytes = new ProtoWriter()
      .int(1, 300)
      .string(2, 'hello')
      .message(3, (w) => w.int(1, -1).packedInts(2, [1, 2, 3]))
      .finish();

    const fields = readFields(bytes);
    expect(fields.map((f) => f.num)).toEqual([1, 2, 3]);
    expect(fields[0].value).toBe(300);
    expect(new TextDecoder().decode(fields[1].value as Uint8Array)).toBe('hello');

    const inner = readFields(fields[2].value as Uint8Array);
    // -1 は 64bit の 2 の補数として 10 バイトになる
    expect(inner[0].value).toBe(2n ** 64n - 1n);
  });
});

describe('ONNX inspection', () => {
  it('reads inputs, outputs, opset and op types from the sample model', () => {
    const model = buildChannelMeanModel({ height: 48, width: 64, opset: 13 });
    const info = inspectOnnxBuffer(model);

    expect(info.irVersion).toBe(8);
    expect(info.producer).toBe('arsist');
    expect(info.opset).toBe(13);
    expect(info.inputs).toEqual([{ name: 'image', dims: [1, 3, 48, 64], elemType: 'float32' }]);
    expect(info.outputs).toEqual([{ name: 'channelMean', dims: [1, 3], elemType: 'float32' }]);
    expect(info.opTypes).toEqual(['ReduceMean']);
    expect(info.customDomains).toEqual([]);
    expect(info.warnings).toEqual([]);
  });

  it('rejects things that are not ONNX', () => {
    expect(() => inspectOnnxBuffer(new TextEncoder().encode('PK zip archive, not a model'))).toThrow(/not an ONNX/);
    expect(() => inspectOnnxBuffer(new Uint8Array([0x08, 0x08]))).toThrow(/no graph/);
  });

  it('flags opsets outside what the Unity engine reads', () => {
    expect(inspectOnnxBuffer(buildChannelMeanModel({ opset: 3 })).warnings).toContain('opset:3');
    expect(inspectOnnxBuffer(buildChannelMeanModel({ opset: 30 })).warnings).toContain('opset:30');
  });

  it('drafts a classification definition for a [1, C] output', () => {
    const info = inspectOnnxBuffer(buildChannelMeanModel({ height: 48, width: 64 }));
    const draft = suggestDefinition(info);

    expect(draft.task).toBe('classify');
    expect(draft.input).toMatchObject({ name: 'image', width: 64, height: 48, layout: 'NCHW', channels: 3, resize: 'stretch' });
    expect(draft.output.softmax).toBe(true);
  });

  it('drafts detection and segmentation definitions from output shapes', () => {
    const detect = suggestDefinition({
      inputs: [{ name: 'images', dims: [1, 3, 640, 640] }],
      outputs: [{ name: 'output0', dims: [1, 84, 8400] }],
      opTypes: ['Conv', 'Concat'],
    });
    expect(detect.task).toBe('detect');
    expect(detect.output.boxLayout).toBe('yolo');
    expect(detect.input.resize).toBe('letterbox');
    expect(detect.input.mean).toEqual([0, 0, 0]);

    const yolo5 = suggestDefinition({
      inputs: [{ name: 'images', dims: [1, 3, 640, 640] }],
      outputs: [{ name: 'output', dims: [1, 25200, 85] }],
      opTypes: ['Conv'],
    });
    expect(yolo5.output.boxLayout).toBe('yolo5');

    const nms = suggestDefinition({
      inputs: [{ name: 'images', dims: [1, 3, 640, 640] }],
      outputs: [{ name: 'output', dims: [1, 300, 6] }],
      opTypes: ['Conv', 'NonMaxSuppression'],
    });
    expect(nms.output.boxLayout).toBe('xyxyScoreClass');

    const segment = suggestDefinition({
      inputs: [{ name: 'input', dims: [1, 3, 'height', 'width'] }],
      outputs: [{ name: 'out', dims: [1, 21, 'height', 'width'] }],
      opTypes: ['Conv', 'Resize'],
    });
    expect(segment.task).toBe('segment');
    expect(segment.output.maskMode).toBe('argmax');
    expect(segment.input.width).toBe(224);

    const nhwc = suggestDefinition({
      inputs: [{ name: 'x', dims: [1, 96, 96, 1], elemType: 'uint8' }],
      outputs: [{ name: 'y', dims: [1, 10] }],
      opTypes: ['Conv', 'Softmax'],
    });
    expect(nhwc.input).toMatchObject({ layout: 'NHWC', channels: 1, width: 96, height: 96, scale: 1 });
    expect(nhwc.output.softmax).toBe(false);
  });
});
