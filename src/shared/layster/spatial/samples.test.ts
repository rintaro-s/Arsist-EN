import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { findBuiltinSpace } from './spaces';
import { solveAll, worldFromSpace } from './solver';
import { validateSpatialProject } from './validate';
import type { SpatialProject } from './types';

/**
 * samples/spatial/ のプロジェクトが、壊れておらず (問題の error が無い)、使うと宣言した空間のどれでも
 * 物が置けること。サンプルはエージェントが真似る見本なので、ここが崩れると見本ごと崩れる。
 */
const SAMPLES = path.resolve(__dirname, '../../../../samples/spatial');

const projects = fs.existsSync(SAMPLES)
  ? fs.readdirSync(SAMPLES)
    .map((dir) => path.join(SAMPLES, dir, 'project.spatial.json'))
    .filter((file) => fs.existsSync(file))
  : [];

describe('samples/spatial', () => {
  it('has samples', () => {
    expect(projects.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of projects) {
    const name = path.basename(path.dirname(file));
    const project = JSON.parse(fs.readFileSync(file, 'utf8')) as SpatialProject;

    it(`${name}: no errors`, () => {
      const errors = validateSpatialProject(project).filter((p) => p.level === 'error');
      expect(errors.map((e) => `${e.path}: ${e.message.en}`)).toEqual([]);
    });

    it(`${name}: places every thing in every space it uses`, () => {
      for (const id of project.spaces.use) {
        const space = findBuiltinSpace(id);
        expect(space, `space ${id}`).toBeDefined();
        const results = solveAll(project.things, worldFromSpace(space!));
        expect(results).toHaveLength(project.things.length);
        // 物が置けた場所が、床より下でないこと
        for (const r of results) {
          if (r.frame === 'world') expect(r.pose.at[1], `${id}/${r.thing}`).toBeGreaterThanOrEqual(0);
        }
      }
    });
  }
});
