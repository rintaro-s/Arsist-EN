import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
}));

import { UnityBuilder } from './UnityBuilder';
import type { ExtensionManifest, ResolvedExtension } from '../../shared/extensions';

/**
 * 拡張機能によるエンジンの改変と Unity パッケージの出し入れ (UnityBuilder の private)。
 * 作業用の Unity プロジェクトのファイルを書き換え・消すので、ここで固定しておく。
 */
type Harness = {
  unityTemplatePath: string;
  stageEngineOverrides(project: string, active: Array<ResolvedExtension & { dir: string }>): Promise<void>;
  stageExtensionPackages(project: string, active: Array<ResolvedExtension & { dir: string }>): Promise<void>;
};

let root: string;
let template: string;
let workspace: string;
let builder: Harness;

const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

function ext(id: string, dir: string, unity: ExtensionManifest['unity']): ResolvedExtension & { dir: string } {
  return {
    manifest: { id, version: '1.0.0', name: { en: id, ja: id }, description: { en: id, ja: id }, unity },
    settings: {}, dataVersion: 1, deferred: [], dir,
  };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'arsist-ext-stage-'));
  template = path.join(root, 'template');
  workspace = path.join(root, 'workspace');
  await fs.outputFile(path.join(template, 'Assets', 'Arsist', 'Runtime', 'A.cs'), 'original A');
  await fs.outputFile(path.join(workspace, 'Assets', 'Arsist', 'Runtime', 'A.cs'), 'original A');
  await fs.outputJSON(path.join(workspace, 'Packages', 'manifest.json'), { dependencies: { 'com.unity.xr.hands': '1.9.0' } });
  builder = new UnityBuilder('/nonexistent/Unity') as unknown as Harness;
  builder.unityTemplatePath = template;
});

afterEach(async () => {
  await fs.remove(root);
});

describe('engine overrides from extensions', () => {
  it('replaces the engine file while the extension is in the build, and restores it after', async () => {
    const dir = path.join(root, 'ext');
    await fs.outputFile(path.join(dir, 'Overrides', 'Runtime', 'A.cs'), 'patched A');
    await fs.outputFile(path.join(dir, 'Overrides', 'Runtime', 'New.cs'), 'new file');
    const e = ext('patcher', dir, { overrides: [{ path: 'Runtime/A.cs', replaces: sha('original A') }, { path: 'Runtime/New.cs' }] });

    await builder.stageEngineOverrides(workspace, [e]);
    expect(await fs.readFile(path.join(workspace, 'Assets', 'Arsist', 'Runtime', 'A.cs'), 'utf8')).toBe('patched A');
    expect(await fs.readFile(path.join(workspace, 'Assets', 'Arsist', 'Runtime', 'New.cs'), 'utf8')).toBe('new file');

    await builder.stageEngineOverrides(workspace, []);
    expect(await fs.readFile(path.join(workspace, 'Assets', 'Arsist', 'Runtime', 'A.cs'), 'utf8')).toBe('original A');
    expect(await fs.pathExists(path.join(workspace, 'Assets', 'Arsist', 'Runtime', 'New.cs'))).toBe(false);
    expect(await fs.pathExists(path.join(workspace, 'Assets', '.arsist-overrides.json'))).toBe(false);
  });

  it('refuses when the engine file changed since the extension was made', async () => {
    const dir = path.join(root, 'ext');
    await fs.outputFile(path.join(dir, 'Overrides', 'Runtime', 'A.cs'), 'patched A');
    const stale = ext('patcher', dir, { overrides: [{ path: 'Runtime/A.cs', replaces: sha('an older A') }] });
    await expect(builder.stageEngineOverrides(workspace, [stale])).rejects.toThrow(/has changed since the extension was made/);
    // 何も書き換えていない
    expect(await fs.readFile(path.join(workspace, 'Assets', 'Arsist', 'Runtime', 'A.cs'), 'utf8')).toBe('original A');
  });

  it('refuses to overwrite an engine file without saying what it replaces, and refuses two extensions on one file', async () => {
    const dir = path.join(root, 'ext');
    await fs.outputFile(path.join(dir, 'Overrides', 'Runtime', 'A.cs'), 'patched A');
    await expect(builder.stageEngineOverrides(workspace, [ext('sloppy', dir, { overrides: [{ path: 'Runtime/A.cs' }] })]))
      .rejects.toThrow(/must declare "replaces"/);
    const one = ext('one', dir, { overrides: [{ path: 'Runtime/A.cs', replaces: sha('original A') }] });
    const two = ext('two', dir, { overrides: [{ path: 'Runtime/A.cs', replaces: sha('original A') }] });
    await expect(builder.stageEngineOverrides(workspace, [one, two])).rejects.toThrow(/both replace/);
  });
});

describe('Unity packages from extensions', () => {
  it('adds a bundled package while the extension is in the build and removes it after, never touching the engine\'s', async () => {
    const dir = path.join(root, 'ext');
    await fs.outputJSON(path.join(dir, 'Packages', 'com.vendor.sdk', 'package.json'), { name: 'com.vendor.sdk', version: '1.0.0' });
    const e = ext('vendor', dir, {
      packages: { 'com.vendor.sdk': 'Packages/com.vendor.sdk', 'com.vendor.remote': '2.0.0', 'com.unity.xr.hands': '0.1.0' },
    });

    await builder.stageExtensionPackages(workspace, [e]);
    let deps = (await fs.readJSON(path.join(workspace, 'Packages', 'manifest.json'))).dependencies;
    expect(deps['com.vendor.sdk']).toBe('file:arsist-ext-vendor/com.vendor.sdk');
    expect(deps['com.vendor.remote']).toBe('2.0.0');
    expect(deps['com.unity.xr.hands']).toBe('1.9.0'); // エンジンのものは上書きしない
    expect(await fs.pathExists(path.join(workspace, 'Packages', 'arsist-ext-vendor', 'com.vendor.sdk', 'package.json'))).toBe(true);

    await builder.stageExtensionPackages(workspace, []);
    deps = (await fs.readJSON(path.join(workspace, 'Packages', 'manifest.json'))).dependencies;
    expect(deps).toEqual({ 'com.unity.xr.hands': '1.9.0' });
    expect(await fs.pathExists(path.join(workspace, 'Packages', 'arsist-ext-vendor'))).toBe(false);
  });
});
