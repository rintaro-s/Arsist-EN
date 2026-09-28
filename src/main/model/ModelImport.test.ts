import { describe, it, expect } from 'vitest';
import { chatFormatFromTemplate, tokenizerJsonFromVocabMerges } from './ModelImport';
import { suggestTextTask, suggestUse } from './OnnxInspector';
import { unsupportedOnDevice } from '../../shared/unityOps';

describe('text model import', () => {
  it('tells image, text and tensor models apart from their inputs and outputs', () => {
    expect(suggestUse({ inputs: [{ name: 'images', dims: [1, 3, 640, 640], elemType: 'float32' }], outputs: [] })).toBe('image');
    expect(suggestUse({ inputs: [{ name: 'input_ids', dims: ['b', 's'], elemType: 'int64' }], outputs: [] })).toBe('text');
    // Unity の tiny-stories: 名前は input / output だが、整数の列を取り語彙ぶんの幅を出す
    expect(suggestUse({
      inputs: [{ name: 'input', dims: ['b', 'n'], elemType: 'int32' }],
      outputs: [{ name: 'output', dims: ['b', 'n', 50257], elemType: 'float32' }],
    })).toBe('text');
    expect(suggestUse({ inputs: [{ name: 'x', dims: [1, 10], elemType: 'float32' }, { name: 'k', dims: [1], elemType: 'int64' }], outputs: [] })).toBe('tensor');
  });

  it('guesses what a text model does', () => {
    const base = { inputs: [{ name: 'input_ids', dims: ['b', 's'] }] };
    expect(suggestTextTask({ ...base, inputs: [...base.inputs, { name: 'past_key_values.0.key', dims: [] }], outputs: [] })).toBe('generate');
    expect(suggestTextTask({ ...base, outputs: [{ name: 'last_hidden_state', dims: ['b', 's', 384] }] })).toBe('embed');
    expect(suggestTextTask({ ...base, outputs: [{ name: 'logits', dims: ['b', 2] }] })).toBe('classify');
  });

  it('recognises the common chat formats from the Jinja template or the vocabulary', () => {
    expect(chatFormatFromTemplate('{{ "<|im_start|>" + message.role }}', new Set())).toBe('chatml');
    expect(chatFormatFromTemplate(undefined, new Set(['<|start_header_id|>']))).toBe('llama3');
    expect(chatFormatFromTemplate('<start_of_turn>user', new Set())).toBe('gemma');
    expect(chatFormatFromTemplate('[INST] {{ message }} [/INST]', new Set())).toBe('mistral');
    expect(chatFormatFromTemplate(undefined, new Set(['hello']))).toBe('none');
  });

  it('builds a byte-level BPE tokenizer.json from vocab.json + merges.txt', () => {
    const json = JSON.parse(tokenizerJsonFromVocabMerges(
      JSON.stringify({ a: 0, b: 1, ab: 2, '<|endoftext|>': 3 }),
      '#version: 0.2\na b\n',
    ));
    expect(json.model.type).toBe('BPE');
    expect(json.model.merges).toEqual(['a b']);
    expect(json.pre_tokenizer.type).toBe('ByteLevel');
    expect(json.added_tokens).toEqual([expect.objectContaining({ id: 3, content: '<|endoftext|>', special: true })]);
  });

  it('names operators the device cannot import', () => {
    expect(unsupportedOnDevice(['MatMul', 'If', 'GroupQueryAttention', 'Add'])).toEqual(['If', 'GroupQueryAttention']);
    expect(unsupportedOnDevice(['Gather', 'MatMul', 'Softmax'])).toEqual([]);
  });
});
