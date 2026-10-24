import { afterEach, describe, expect, it } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { ProjectManager } from './ProjectManager';

let dir: string | null = null;
afterEach(async () => {
  if (dir) await fs.remove(dir);
  dir = null;
});

describe('ProjectManager.exportProject', () => {
  it('writes the same files as the build transfer, manifest included, for format unity', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arsist-export-'));
    const pm = new ProjectManager();
    const created = await pm.createProject({ name: 'Exp', path: dir, template: '3d_ar_scene', targetDevice: 'XREAL_One' });
    expect(created.success).toBe(true);
    const out = path.join(dir, 'out');
    const res = await pm.exportProject({ format: 'unity', outputPath: out, includeAssets: false });
    expect(res.success).toBe(true);
    for (const f of ['manifest.json', 'scenes.json', 'ui_layouts.json', 'dataflow.json', 'scripts.json']) {
      expect(await fs.pathExists(path.join(out, f))).toBe(true);
    }
    const manifest = await fs.readJSON(path.join(out, 'manifest.json'));
    expect(manifest.projectName).toBe('Exp');
    expect(manifest.targetDevice).toBe('XREAL_One');
    expect(Array.isArray(manifest.models)).toBe(true);
    expect(manifest.scriptBundle).toBeTruthy();
    const scripts = await fs.readJSON(path.join(out, 'scripts.json'));
    expect(scripts.storage).toEqual({ persist: [] });
  });
});
