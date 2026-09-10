import { describe, it, expect } from 'vitest';
import { generateUnityManifest } from './UnityBridge';
import type { ArsistProject, PerceptionTarget, PerceptionTask } from '../shared/types';

function project(perception?: { targets: PerceptionTarget[]; tasks?: PerceptionTask[] }): ArsistProject {
  return {
    id: 'p1',
    name: 'Test',
    version: '1.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    appType: '3d_ar_scene',
    targetDevice: 'Meta_Quest',
    arSettings: {
      trackingMode: '6dof',
      presentationMode: 'world_anchored',
      worldScale: 1,
      defaultDepth: 2,
    },
    designSystem: {
      defaultFont: 'Noto Sans JP',
      primaryColor: '#4ec9b0',
      secondaryColor: '#569cd6',
      backgroundColor: '#000000',
      textColor: '#ffffff',
    },
    dataFlow: { dataSources: [], transforms: [] },
    scenes: [],
    uiLayouts: [],
    buildSettings: {
      packageName: 'com.test.app',
      version: '1.0.0',
      versionCode: 1,
      minSdkVersion: 29,
      targetSdkVersion: 32,
    },
    perception,
  };
}

const target: PerceptionTarget = {
  id: 'panel',
  name: 'Control Panel',
  type: 'image',
  imagePath: 'Assets/Textures/panel.png',
  physicalWidth: 0.25,
};

describe('generateUnityManifest — perception', () => {
  it('omits perception entirely when no targets exist', () => {
    // Unity 側は perception が無いと Perception 一式をスキップするので、
    // 空配列ではなく undefined であることが重要。
    expect((generateUnityManifest(project()) as any).perception).toBeUndefined();
    expect((generateUnityManifest(project({ targets: [] })) as any).perception).toBeUndefined();
  });

  it('emits every field the Unity pipeline reads', () => {
    const manifest = generateUnityManifest(project({ targets: [target] })) as any;
    expect(manifest.perception.targets).toHaveLength(1);
    expect(manifest.perception.targets[0]).toEqual({
      id: 'panel',
      name: 'Control Panel',
      type: 'image',
      imagePath: 'Assets/Textures/panel.png',
      physicalWidth: 0.25,
      physicalHeight: undefined,
      holdMs: 2000,
      regions: [],
    });
  });

  it('keeps an explicit holdMs and physical height', () => {
    const manifest = generateUnityManifest(
      project({ targets: [{ ...target, physicalHeight: 0.18, holdMs: 500 }] }),
    ) as any;
    expect(manifest.perception.targets[0].physicalHeight).toBe(0.18);
    expect(manifest.perception.targets[0].holdMs).toBe(500);
  });

  it('does not leak editor-only fields such as the quality score', () => {
    const manifest = generateUnityManifest(
      project({ targets: [{ ...target, quality: 72 }] }),
    ) as any;
    expect(manifest.perception.targets[0]).not.toHaveProperty('quality');
  });
});

describe('generateUnityManifest — regions and tasks', () => {
  const region = { id: 'roi', name: 'Display', rect: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 } };
  const withRegion = { ...target, regions: [region] };

  const ocrTask = {
    id: 'scan',
    name: 'Scan display',
    type: 'ocr' as const,
    source: { kind: 'region' as const, targetId: 'panel', regionId: 'roi' },
    trigger: { type: 'event' as const, value: 'btn_scan' },
    storeAs: 'panelValue',
  };

  it('emits regions verbatim', () => {
    const manifest = generateUnityManifest(project({ targets: [withRegion] })) as any;
    expect(manifest.perception.targets[0].regions).toEqual([region]);
  });

  it('emits a task and defaults its engine to on-device ML Kit', () => {
    const manifest = generateUnityManifest(
      project({ targets: [withRegion], tasks: [ocrTask] }),
    ) as any;
    expect(manifest.perception.tasks).toHaveLength(1);
    expect(manifest.perception.tasks[0].engine).toEqual({ kind: 'mlkit', script: 'japanese' });
    expect(manifest.perception.tasks[0].trigger).toEqual({ type: 'event', value: 'btn_scan' });
  });

  it('keeps an explicit engine choice', () => {
    const manifest = generateUnityManifest(
      project({ targets: [withRegion], tasks: [{ ...ocrTask, engine: { kind: 'mock' as const, mockText: 'hello' } }] }),
    ) as any;
    expect(manifest.perception.tasks[0].engine).toEqual({ kind: 'mock', mockText: 'hello' });
  });

  it('drops a task whose region was deleted', () => {
    // 参照先が消えたタスクを APK に入れると、実行時に必ず失敗するだけの荷物になる
    const manifest = generateUnityManifest(
      project({ targets: [target], tasks: [ocrTask] }),
    ) as any;
    expect(manifest.perception.tasks).toEqual([]);
  });

  it('drops a task whose target was deleted', () => {
    const manifest = generateUnityManifest(
      project({ targets: [withRegion], tasks: [{ ...ocrTask, source: { kind: 'region', targetId: 'gone', regionId: 'roi' } }] }),
    ) as any;
    expect(manifest.perception.tasks).toEqual([]);
  });

  it('keeps a viewport task, which needs no target at all', () => {
    const viewportTask = {
      ...ocrTask,
      source: { kind: 'viewport' as const, rect: { x: 0.25, y: 0.4, width: 0.5, height: 0.2 } },
    };
    const manifest = generateUnityManifest(
      project({ targets: [target], tasks: [viewportTask] }),
    ) as any;
    expect(manifest.perception.tasks).toHaveLength(1);
    expect(manifest.perception.tasks[0].source.kind).toBe('viewport');
  });

  it('drops a task with no storeAs, which could not report anything', () => {
    const manifest = generateUnityManifest(
      project({ targets: [withRegion], tasks: [{ ...ocrTask, storeAs: '' }] }),
    ) as any;
    expect(manifest.perception.tasks).toEqual([]);
  });
});

describe('generateUnityManifest — a project with tasks but no image targets', () => {
  // viewport ソースは「カメラ画像の矩形」を読むので追跡対象を必要としない。
  // ここで perception ごと落とすと、タスクが APK に入らず、実行時に無言で何も起きない。
  const viewportTask = {
    id: 'aim',
    name: 'Aim and read',
    type: 'ocr' as const,
    source: { kind: 'viewport' as const, rect: { x: 0.2, y: 0.3, width: 0.6, height: 0.4 } },
    trigger: { type: 'manual' as const },
    storeAs: 'aimed',
  };

  it('still emits the task', () => {
    const manifest = generateUnityManifest(project({ targets: [], tasks: [viewportTask] })) as any;
    expect(manifest.perception.targets).toEqual([]);
    expect(manifest.perception.tasks).toHaveLength(1);
  });

  it('emits nothing when there are neither targets nor tasks', () => {
    expect((generateUnityManifest(project({ targets: [], tasks: [] })) as any).perception).toBeUndefined();
  });
});

describe('generateUnityManifest — 古典的な画像処理タスク', () => {
  // analyze は端末内で完結するので、OCR と違って ML Kit も追跡対象も要らない。
  // ここを落とすと、エディタで設定できるのに APK では何も起きない、という
  // 一番気付きにくい壊れ方をする。
  const skyTask = {
    id: 'sky',
    name: 'Look at the sky',
    type: 'analyze' as const,
    source: { kind: 'viewport' as const, rect: { x: 0, y: 0.35, width: 1, height: 0.65 } },
    trigger: { type: 'interval' as const, value: 2000 },
    storeAs: 'sky',
    analysis: { kind: 'sky' as const, previewBindingId: 'skyView', repaintStrength: 1 },
  };

  it('carries the analysis config through', () => {
    const manifest = generateUnityManifest(project({ targets: [], tasks: [skyTask] })) as any;
    expect(manifest.perception.tasks).toHaveLength(1);
    expect(manifest.perception.tasks[0].analysis).toEqual({
      kind: 'sky',
      // 既定は現実に重ねる。AR なので Canvas に映すのは確認用の方。
      display: 'world',
      previewBindingId: 'skyView',
      repaintStrength: 1,
    });
  });

  it('defaults an analyze task with no config to the dominant colour', () => {
    const { analysis, ...withoutAnalysis } = skyTask;
    const manifest = generateUnityManifest(project({ targets: [], tasks: [withoutAnalysis] })) as any;
    // display は空の塗り替え先なので、他の kind には付けない。
    expect(manifest.perception.tasks[0].analysis).toEqual({ kind: 'color' });
  });

  it('keeps an explicit display choice', () => {
    const inCanvas = { ...skyTask, analysis: { ...skyTask.analysis, display: 'image' as const } };
    const manifest = generateUnityManifest(project({ targets: [], tasks: [inCanvas] })) as any;
    expect(manifest.perception.tasks[0].analysis.display).toBe('image');
  });

  it('leaves analysis off for OCR tasks so the runtime does not branch on it', () => {
    const ocr = { ...skyTask, id: 'ocr', type: 'ocr' as const };
    const manifest = generateUnityManifest(project({ targets: [], tasks: [ocr] })) as any;
    expect(manifest.perception.tasks[0].analysis).toBeUndefined();
  });
});
