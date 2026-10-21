import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { checkReplaceable, ENGINE_PARTS, enginePartLabel, planReplacements, REPLACEABLE_SCRIPT_GLOBALS } from './engineParts';
import { BUILTIN_SCRIPT_GLOBALS } from './extensions';

const ROOT = path.resolve(__dirname, '../..');
const CS = path.join(ROOT, 'UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/Extensions/ArsistEngineParts.cs');

describe('engine parts an extension may replace', () => {
  it('accepts the listed parts and built-in script names, nothing else', () => {
    expect(checkReplaceable('vrm-loader')).toBeNull();
    expect(checkReplaceable('storage-backend')).toBeNull();
    expect(checkReplaceable('script:audio')).toBeNull();
    expect(checkReplaceable('script:room')).toMatch(/not a built-in/);
    expect(checkReplaceable('script:console')).toMatch(/not a built-in/);
    expect(checkReplaceable('renderer')).toMatch(/unknown engine part/);
    expect(checkReplaceable(3)).toMatch(/part name/);
    // 置き換えられるスクリプトの名前は、どれも組み込みの名前
    for (const name of REPLACEABLE_SCRIPT_GLOBALS) expect(BUILTIN_SCRIPT_GLOBALS).toContain(name);
  });

  it('lets one extension own a part and reports two that claim the same one', () => {
    const plan = planReplacements([
      { id: 'vrm10', replaces: ['vrm-loader'] },
      { id: 'cloud-save', replaces: ['storage-backend', 'storage-backend'] },
      { id: 'other-vrm', replaces: ['vrm-loader'] },
      { id: 'plain' },
    ]);
    expect(plan.owners).toEqual({ 'storage-backend': 'cloud-save' });
    expect(plan.conflicts).toEqual([{ part: 'vrm-loader', ids: ['other-vrm', 'vrm10'] }]);
  });

  it('names parts for people', () => {
    expect(enginePartLabel('vrm-loader', 'ja')).toBe('VRM の読み込み');
    expect(enginePartLabel('script:audio', 'en')).toBe('script audio');
  });

  it('matches the runtime table (ArsistEngineParts.cs): same ids, same interfaces, and the interfaces exist', () => {
    const src = fs.readFileSync(CS, 'utf8');
    const constants = Object.fromEntries([...src.matchAll(/public const string (\w+) = "([a-z-]+)";/g)].map((m) => [m[1], m[2]]));
    const table = [...src.matchAll(/\{\s*(\w+),\s*typeof\(([\w.]+)\)\s*\}/g)].map((m) => ({ id: constants[m[1]], csInterface: m[2] }));
    expect(table).toEqual(ENGINE_PARTS.map((p) => ({ id: p.id, csInterface: p.csInterface })));
    for (const p of ENGINE_PARTS) {
      const name = p.csInterface.split('.').pop()!;
      const found = execGrep(path.join(ROOT, 'UnityBackend/ArsistBuilder/Assets/Arsist/Runtime'), new RegExp(`interface\\s+${name}\\b`));
      expect(found, `${p.csInterface} is declared in the runtime`).toBe(true);
    }
  });
});

function execGrep(dir: string, re: RegExp): boolean {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (execGrep(p, re)) return true; }
    else if (entry.name.endsWith('.cs') && re.test(fs.readFileSync(p, 'utf8'))) return true;
  }
  return false;
}
