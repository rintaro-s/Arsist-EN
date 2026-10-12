import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readVrmSpec, vrmSpecFromGlb } from './vrmInfo';

function glb(json: object): Buffer {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const body = Buffer.from(text, 'utf8');
  const head = Buffer.alloc(20);
  head.write('glTF', 0, 'ascii');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + body.length, 8);
  head.writeUInt32LE(body.length, 12);
  head.write('JSON', 16, 'ascii');
  return Buffer.concat([head, body]);
}

describe('VRM version', () => {
  it('tells VRM 1.0 from 0.x by the glTF extensions', async () => {
    expect(vrmSpecFromGlb(glb({ extensions: { VRMC_vrm: {} } }))).toBe('1.0');
    expect(vrmSpecFromGlb(glb({ extensions: { VRM: {} } }))).toBe('0.x');
    expect(vrmSpecFromGlb(glb({}))).toBe('unknown');
    expect(vrmSpecFromGlb(Buffer.from('not a glb at all, really'))).toBe('unknown');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vrm-')), 'a.vrm');
    fs.writeFileSync(file, Buffer.concat([glb({ extensions: { VRMC_vrm: { specVersion: '1.0' } } }), Buffer.alloc(64)]));
    expect(await readVrmSpec(file)).toBe('1.0');
    expect(await readVrmSpec(file + '.missing')).toBe('unknown');
  });
});
