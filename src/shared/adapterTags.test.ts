import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { adapterTags, capabilityTag, validateAdapterTags } from './adapterTags';
import { isKnownNamespace, isValidTag } from './tags';

const ADAPTERS = path.resolve(__dirname, '../../Adapters');

function readAdapter(folder: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(ADAPTERS, folder, 'adapter.json'), 'utf8'));
}

describe('adapter tags', () => {
  it('derives capability tags from camelCase keys', () => {
    expect(capabilityTag('handTracking')).toBe('cap:hand-tracking');
    expect(capabilityTag('sixDofTracking')).toBe('cap:6dof');
    expect(capabilityTag('passthrough')).toBe('cap:passthrough');
  });

  it('every adapter in the repo has well-formed tags', () => {
    for (const folder of fs.readdirSync(ADAPTERS)) {
      if (!fs.existsSync(path.join(ADAPTERS, folder, 'adapter.json'))) continue;
      const adapter = readAdapter(folder);
      expect(validateAdapterTags(adapter, folder)).toEqual([]);
      const tags = adapterTags(adapter);
      expect(tags.some((t) => t.startsWith('device:'))).toBe(true);
      expect(tags).toContain('platform:android');
      for (const t of tags) {
        expect(isValidTag(t), t).toBe(true);
        expect(isKnownNamespace(t), t).toBe(true);
      }
    }
  });

  it('describes Quest, XREAL and phones the way the engine relies on', () => {
    const quest = adapterTags(readAdapter('Meta_Quest'));
    expect(quest).toEqual(expect.arrayContaining([
      'device:meta-quest', 'cap:hand-tracking', 'cap:passthrough', 'cap:scene-understanding', 'cap:spatial-anchors', 'cap:camera-access',
    ]));

    const xreal = adapterTags(readAdapter('XREAL_One'));
    expect(xreal).toContain('device:xreal-one');
    expect(xreal).toContain('cap:optical-see-through');
    expect(xreal).not.toContain('cap:hand-tracking');
    expect(xreal).not.toContain('cap:scene-understanding');

    const phone = adapterTags(readAdapter('Android_Phone'));
    expect(phone).toContain('device:android-phone');
    expect(phone).toContain('cap:3dof');
    expect(phone).not.toContain('cap:6dof');
  });

  it('ignores junk and reports it', () => {
    const adapter = { id: 'x', tags: ['cap:ok', 'bad tag', 5] };
    expect(adapterTags(adapter)).toEqual(['cap:ok', 'device:x']);
    expect(validateAdapterTags(adapter, 'x')).toHaveLength(2);
  });
});
