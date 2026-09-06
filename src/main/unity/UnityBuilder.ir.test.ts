import { describe, it, expect, vi } from 'vitest';
import * as os from 'os';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() },
}));

import { UnityBuilder } from './UnityBuilder';

/**
 * Canvas ↔ UILayout の紐付けが切れていると、ビルドは成功するのに実機では
 * 何も出ない（旧実装ではプレースホルダだけ出る）。原因が追えないので
 * Unity を起動する前にビルドを失敗させる、その判定のテスト。
 */
type IrHarness = { findIrProblems(config: unknown): string[] };

const builder = () => new UnityBuilder('/nonexistent/unity') as unknown as IrHarness;

const config = (objects: unknown[], layouts: unknown[]) => ({
  scenesData: [{ name: 'MainScene', objects }],
  uiData: layouts,
});

const canvasLayout = { id: 'layout-1', name: 'Canvas_1', scope: 'canvas' };

describe('findIrProblems', () => {
  it('accepts a canvas bound to an existing layout', () => {
    const problems = builder().findIrProblems(
      config([{ type: 'canvas', name: 'Canvas', canvasSettings: { layoutId: 'layout-1' } }], [canvasLayout]),
    );
    expect(problems).toEqual([]);
  });

  it('rejects a canvas with no canvasSettings at all', () => {
    const problems = builder().findIrProblems(config([{ type: 'canvas', name: 'Canvas' }], [canvasLayout]));
    expect(problems[0]).toContain('MainScene / Canvas');
    expect(problems[0]).toContain('no UI layout assigned');
  });

  it('rejects a canvas whose layoutId is empty', () => {
    const problems = builder().findIrProblems(
      config([{ type: 'canvas', name: 'HUD', canvasSettings: { layoutId: '' } }], [canvasLayout]),
    );
    expect(problems[0]).toContain('MainScene / HUD');
    expect(problems[0]).toContain('no UI layout assigned');
  });

  it('rejects a canvas pointing at a deleted layout', () => {
    const problems = builder().findIrProblems(
      config([{ type: 'canvas', name: 'Canvas', canvasSettings: { layoutId: 'gone' } }], [canvasLayout]),
    );
    expect(problems[0]).toContain('unknown UI layout id "gone"');
  });

  it('lists the assignable canvas layouts on the offending line, so the fix is next to the cause', () => {
    const problems = builder().findIrProblems(
      config([{ type: 'canvas', name: 'Canvas' }], [canvasLayout, { id: 'l2', name: 'Canvas_2', scope: 'canvas' }]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Canvas_1, Canvas_2');
    expect(problems[0]).toContain('Canvas Settings');
  });

  it('tells the user to create a layout when none exists', () => {
    const problems = builder().findIrProblems(config([{ type: 'canvas', name: 'Canvas' }], []));
    expect(problems[0]).toContain('create a canvas-scope UI layout first');
  });

  it('rejects an Image whose asset is a format Unity cannot import (e.g. WebP)', () => {
    const problems = builder().findIrProblems({
      scenesData: [],
      uiData: [
        {
          id: 'l1',
          name: 'Canvas_1',
          scope: 'canvas',
          root: {
            type: 'Panel',
            children: [{ type: 'Image', assetPath: 'Assets/Textures/photo.webp' }],
          },
        },
      ],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Canvas_1 / Image');
    expect(problems[0]).toContain('photo.webp');
  });

  it('accepts image formats Unity supports', () => {
    for (const file of ['a.png', 'b.JPG', 'c.tga', 'd.gif', 'e.psd']) {
      const problems = builder().findIrProblems({
        scenesData: [],
        uiData: [{ id: 'l1', name: 'L', scope: 'canvas', root: { type: 'Image', assetPath: `Assets/Textures/${file}` } }],
      });
      expect(problems, file).toEqual([]);
    }
  });

  it('finds Images nested deep in the element tree', () => {
    const problems = builder().findIrProblems({
      scenesData: [],
      uiData: [
        {
          id: 'l1',
          name: 'L',
          scope: 'canvas',
          root: { type: 'Panel', children: [{ type: 'Panel', children: [{ type: 'Image', assetPath: 'x.webp' }] }] },
        },
      ],
    });
    expect(problems).toHaveLength(1);
  });

  it('ignores Images with no asset assigned yet', () => {
    const problems = builder().findIrProblems({
      scenesData: [],
      uiData: [{ id: 'l1', name: 'L', scope: 'canvas', root: { type: 'Image' } }],
    });
    expect(problems).toEqual([]);
  });

  it('ignores non-canvas objects', () => {
    const problems = builder().findIrProblems(
      config([{ type: 'primitive', name: 'Cube' }, { type: 'vrm', name: 'Avatar' }], []),
    );
    expect(problems).toEqual([]);
  });

  it('tolerates missing/!malformed scene and layout data', () => {
    expect(builder().findIrProblems({})).toEqual([]);
    expect(builder().findIrProblems({ scenesData: null, uiData: null })).toEqual([]);
    expect(builder().findIrProblems({ scenesData: [{}], uiData: [null] })).toEqual([]);
  });
});

/**
 * 背景モードは Quest の見た目そのものを変えるので、綴り間違いを黙って
 * passthrough に丸めると「なぜかVRにならない」という追いにくい壊れ方をする。
 */
describe('findIrProblems — background mode', () => {
  const withAr = (arSettings: unknown) => ({
    scenesData: [],
    uiData: [],
    manifestData: { arSettings },
  });

  it('accepts an unset background mode (defaults to passthrough)', () => {
    expect(builder().findIrProblems(withAr({}))).toEqual([]);
  });

  it.each(['passthrough', 'skybox', 'solidColor'])('accepts %s', (mode) => {
    expect(builder().findIrProblems(withAr({ backgroundMode: mode }))).toEqual([]);
  });

  it('rejects a misspelled background mode', () => {
    const problems = builder().findIrProblems(withAr({ backgroundMode: 'solid_color' }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('unknown background mode "solid_color"');
    expect(problems[0]).toContain('passthrough, skybox, solidColor');
  });

  it('rejects a background colour that is not #RRGGBB', () => {
    const problems = builder().findIrProblems(
      withAr({ backgroundMode: 'solidColor', backgroundColor: 'rgb(0,0,0)' }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('must be #RRGGBB');
  });

  it('accepts a valid background colour', () => {
    expect(
      builder().findIrProblems(withAr({ backgroundMode: 'solidColor', backgroundColor: '#1A2B3C' })),
    ).toEqual([]);
  });

  it('ignores the background colour when the mode is not solidColor', () => {
    expect(builder().findIrProblems(withAr({ backgroundMode: 'skybox', backgroundColor: 'nonsense' }))).toEqual([]);
  });
});
