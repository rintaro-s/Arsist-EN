import { describe, it, expect } from 'vitest';
import { applyIrOps, parseIrPath, validateIrOps, type IrOp } from './irOps';

function project(): Record<string, any> {
  return {
    appType: '3D_AR',
    arSettings: { trackingMode: '6dof' },
    scenes: [
      { id: 's1', objects: [{ id: 'a', oldName: 1 }, { id: 'b' }] },
      { id: 's2', objects: [{ id: 'c', oldName: 2, newName: 9 }] },
    ],
    extensions: { x: { settings: { mode: 'old' } }, y: { settings: { mode: 'keep' } } },
  };
}

describe('IR ops', () => {
  it('parses paths with array and wildcard segments', () => {
    expect(parseIrPath('scenes[].objects[].x')).toEqual([{ key: 'scenes', each: true }, { key: 'objects', each: true }, { key: 'x' }]);
    expect(parseIrPath('extensions.*.settings')).toEqual([{ key: 'extensions' }, { wildcard: true }, { key: 'settings' }]);
    expect(() => parseIrPath('')).toThrow();
    expect(() => parseIrPath('a..b')).toThrow();
  });

  it('default fills only what is missing, creating parents', () => {
    const p = project();
    const changes = applyIrOps(p, [
      { op: 'default', path: 'arSettings.interaction.textInput', value: 'auto' },
      { op: 'default', path: 'arSettings.trackingMode', value: '3dof' },
      { op: 'default', path: 'scenes[].objects[].visible', value: true },
    ]);
    expect(p.arSettings.interaction.textInput).toBe('auto');
    expect(p.arSettings.trackingMode).toBe('6dof');
    expect(p.scenes[1].objects[0].visible).toBe(true);
    expect(changes).toEqual(['arSettings.interaction.textInput', 'scenes[].objects[].visible']);
  });

  it('rename moves values inside arrays and prefers an existing new key', () => {
    const p = project();
    applyIrOps(p, [{ op: 'rename', path: 'scenes[].objects[].oldName', to: 'newName' }]);
    expect(p.scenes[0].objects[0]).toEqual({ id: 'a', newName: 1 });
    expect(p.scenes[0].objects[1]).toEqual({ id: 'b' });
    // 途中まで移行済み (新しい名前が既にある) なら新しい方を残す
    expect(p.scenes[1].objects[0]).toEqual({ id: 'c', newName: 9 });
  });

  it('remove and map', () => {
    const p = project();
    const changes = applyIrOps(p, [
      { op: 'map', path: 'appType', values: { '3D_AR': '3d_ar_scene' } },
      { op: 'map', path: 'extensions.*.settings.mode', values: { old: 'new' } },
      { op: 'remove', path: 'arSettings.trackingMode' },
    ]);
    expect(p.appType).toBe('3d_ar_scene');
    expect(p.extensions.x.settings.mode).toBe('new');
    expect(p.extensions.y.settings.mode).toBe('keep');
    expect('trackingMode' in p.arSettings).toBe(false);
    expect(changes).toHaveLength(3);
  });

  it('every op is idempotent', () => {
    const ops: IrOp[] = [
      { op: 'default', path: 'extensions', value: {} },
      { op: 'set', path: 'arSettings.worldScale', value: 1 },
      { op: 'rename', path: 'scenes[].objects[].oldName', to: 'newName' },
      { op: 'remove', path: 'logicGraphs' },
      { op: 'map', path: 'appType', values: { '3D_AR': '3d_ar_scene' } },
    ];
    const p = project();
    applyIrOps(p, ops);
    const snapshot = JSON.stringify(p);
    expect(applyIrOps(p, ops)).toEqual([]);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it('does not share default values between slots', () => {
    const p = project();
    applyIrOps(p, [{ op: 'default', path: 'scenes[].meta', value: { tags: [] } }]);
    p.scenes[0].meta.tags.push('x');
    expect(p.scenes[1].meta.tags).toEqual([]);
  });

  it('validates op lists from extension manifests', () => {
    expect(validateIrOps([{ op: 'default', path: 'a', value: 1 }], 'm')).toEqual([]);
    expect(validateIrOps([{ op: 'default', path: 'a' }], 'm')[0]).toMatch(/needs a value/);
    expect(validateIrOps([{ op: 'rename', path: 'a', to: 'b.c' }], 'm')[0]).toMatch(/single key/);
    expect(validateIrOps([{ op: 'explode', path: 'a' }], 'm')[0]).toMatch(/unknown op/);
    expect(validateIrOps('nope', 'm')).toHaveLength(1);
  });
});
