import { describe, it, expect } from 'vitest';
import { analyseFiles, parseRepoId } from './HuggingFace';

describe('Hugging Face repositories', () => {
  it('takes a name, a URL or a page address', () => {
    expect(parseRepoId('onnx-community/Qwen3.5-0.8B-Text-ONNX')).toBe('onnx-community/Qwen3.5-0.8B-Text-ONNX');
    expect(parseRepoId('https://huggingface.co/onnx-community/Qwen3.5-0.8B-Text-ONNX')).toBe('onnx-community/Qwen3.5-0.8B-Text-ONNX');
    expect(parseRepoId('  https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/main  ')).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('groups the same model by precision and counts the separate weight files', () => {
    const { groups, hasTokenizer, sideFiles, notes } = analyseFiles([
      { path: 'onnx/model.onnx', size: 400_000 },
      { path: 'onnx/model.onnx_data', size: 2_000_000_000 },
      { path: 'onnx/model.onnx_data_1', size: 950_000_000 },
      { path: 'onnx/model_q4.onnx', size: 500_000 },
      { path: 'onnx/model_q4.onnx_data', size: 550_000_000 },
      { path: 'onnx/model_fp16.onnx', size: 500_000 },
      { path: 'tokenizer.json', size: 19_000_000 },
      { path: 'chat_template.jinja', size: 7_000 },
      { path: 'model.safetensors', size: 1_400_000_000 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants.map((v) => v.precision)).toEqual(['fp32', 'fp16', 'q4']);
    const fp32 = groups[0].variants[0];
    expect(fp32.externalData).toEqual(['onnx/model.onnx_data', 'onnx/model.onnx_data_1']);
    expect(fp32.totalSize).toBe(400_000 + 2_000_000_000 + 950_000_000);
    expect(fp32.quantized).toBe(false);
    expect(groups[0].variants[2].quantized).toBe(true);
    expect(hasTokenizer).toBe(true);
    expect(sideFiles).toContain('chat_template.jinja');
    expect(notes).toEqual([]);
  });

  it('warns about models split into several ONNX files, and about a missing tokenizer', () => {
    const { notes } = analyseFiles([
      { path: 'onnx/decoder_model_merged_q4.onnx', size: 1000 },
      { path: 'onnx/embed_tokens_q4.onnx', size: 1000 },
      { path: 'onnx/vision_encoder_q4.onnx', size: 1000 },
    ]);
    expect(notes).toContain('multiPart');
    expect(notes).toContain('noTokenizer');
  });

  it('says when a repository has no ONNX at all', () => {
    expect(analyseFiles([{ path: 'model.safetensors', size: 10 }]).notes).toContain('noOnnx');
  });
});
