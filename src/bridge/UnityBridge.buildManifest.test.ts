// ビルドに渡すマニフェストの検証。
//
// 画面のビルドがここを通らず自前で組んでいたせいで、`models` と `perception` が
// 丸ごと抜け、エディタから作った APK にモデルが 1 つも入っていなかった (2026-09)。
// 実機では「モデルが同梱されていません」としか分からない。ここで固定する。
import { describe, it, expect } from 'vitest';
import { generateBuildManifest } from './UnityBridge';
import type { ArsistProject, ModelDefinition } from '../shared/types';
import { CURRENT_IR_VERSION } from '../shared/irVersion';

const model = (over: Partial<ModelDefinition> = {}): ModelDefinition => ({
  id: 'm1',
  name: 'Qwen',
  file: 'Assets/Models/qwen/model.onnx',
  format: 'onnx',
  backend: 'auto',
  use: 'text',
  includeInBuild: true,
  ...over,
} as ModelDefinition);

const project = (over: Partial<ArsistProject> = {}): ArsistProject => ({
  id: 'p1',
  name: 'MyARApp',
  version: '1.0.0',
  irVersion: CURRENT_IR_VERSION,
  appType: 'ar',
  targetDevice: 'XREAL_One',
  arSettings: { trackingMode: '6dof', presentationMode: 'world', worldScale: 1, defaultDepth: 2 },
  designSystem: { defaultFont: 'Noto', primaryColor: '#fff', secondaryColor: '#000', backgroundColor: '#000', textColor: '#fff' },
  dataFlow: { nodes: [], connections: [] },
  scenes: [],
  uiLayouts: [],
  scripts: [],
  models: [model()],
  buildSettings: {
    packageName: 'com.arsist.myarapp',
    version: '1.0.0',
    versionCode: 1,
    minSdkVersion: 29,
    targetSdkVersion: 34,
  },
  ...over,
} as unknown as ArsistProject);

describe('generateBuildManifest', () => {
  it('ships the project models (this is what the editor build was missing)', () => {
    const manifest = generateBuildManifest(project()) as any;
    expect(manifest.models).toHaveLength(1);
    expect(manifest.models[0].id).toBe('m1');
  });

  it('leaves out models that are marked as not shipped', () => {
    const manifest = generateBuildManifest(project({ models: [model({ includeInBuild: false })] })) as any;
    expect(manifest.models).toEqual([]);
  });

  it('carries the IR version and the script bundle', () => {
    const manifest = generateBuildManifest(project()) as any;
    expect(manifest.irVersion).toBe(CURRENT_IR_VERSION);
    expect(manifest.scriptBundle).toBeDefined();
  });

  it('the device picked in the build screen wins over the one in the project', () => {
    const manifest = generateBuildManifest(project(), { targetDevice: 'Meta_Quest' }) as any;
    expect(manifest.targetDevice).toBe('Meta_Quest');
  });

  it('keeps what the Unity side reads from build settings', () => {
    const manifest = generateBuildManifest(project()) as any;
    expect(manifest.build.packageName).toBe('com.arsist.myarapp');
    expect(manifest.build.minSdkVersion).toBe(29);
    expect(manifest.projectName).toBe('MyARApp');
    expect(manifest.arSettings).toBeDefined();
  });
});
