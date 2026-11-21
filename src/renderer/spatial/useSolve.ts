/**
 * Space Lab の計算: 試す空間ごとに置き方を解く (solver.ts、実機と同じ計算)。
 * 物の置き方・空間が変わったときだけ解き直す (Space Lab と空間の一覧の両方が使う)。
 */
import { useMemo } from 'react';
import { solveAll, worldFromSpace, type SolveResult, type SolveWorld } from '../../shared/layster/spatial/solver';
import type { SpaceFixture, SpatialProject } from '../../shared/layster/spatial/types';
import { findSpace, useSpatialStore } from './store';

export interface SpaceSolve {
  space: SpaceFixture;
  world: SolveWorld;
  results: SolveResult[];
  summary: SpaceSummary;
}

export interface SpaceSummary {
  total: number;
  intended: number;
  fallback: number;
  atDefault: number;
}

export function summarize(results: SolveResult[]): SpaceSummary {
  let intended = 0;
  let fallback = 0;
  let atDefault = 0;
  for (const r of results) {
    if (r.rule === 0) intended++;
    else if (r.rule === 'default') atDefault++;
    else fallback++;
  }
  return { total: results.length, intended, fallback, atDefault };
}

export function solveSpace(project: SpatialProject, space: SpaceFixture, extra: SpaceFixture['entities'] = []): SpaceSolve {
  const base = worldFromSpace(space);
  const world: SolveWorld = extra.length > 0 ? { ...base, entities: [...base.entities, ...extra] } : base;
  const results = solveAll(project.things, world);
  return { space, world, results, summary: summarize(results) };
}

/** プロジェクトが使う空間すべて (見つからない id は飛ばす)。 */
export function useSpacesInUse(): SpaceFixture[] {
  const project = useSpatialStore((s) => s.project);
  const projectSpaces = useSpatialStore((s) => s.projectSpaces);
  return useMemo(() => {
    if (!project) return [];
    return project.spaces.use.map((id) => findSpace(id, projectSpaces)).filter((s): s is SpaceFixture => !!s);
  }, [project?.spaces.use, projectSpaces]);
}

export function useAllSolves(): SpaceSolve[] {
  const project = useSpatialStore((s) => s.project);
  const spaces = useSpacesInUse();
  const things = project?.things;
  return useMemo(() => (project ? spaces.map((s) => solveSpace(project, s)) : []),
    // things が変わったときだけ解き直す (Mind や規則の編集では解き直さない)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [things, spaces]);
}

/** 今の空間 (Mind の推測を足したもの)。 */
export function useActiveSolve(): SpaceSolve | undefined {
  const project = useSpatialStore((s) => s.project);
  const activeSpace = useSpatialStore((s) => s.activeSpace);
  const projectSpaces = useSpatialStore((s) => s.projectSpaces);
  const beliefs = useSpatialStore((s) => s.previewBeliefs);
  const things = project?.things;
  return useMemo(() => {
    if (!project) return undefined;
    const space = findSpace(activeSpace, projectSpaces) ?? findSpace(project.spaces.use[0] ?? 'studio', projectSpaces);
    return space ? solveSpace(project, space, beliefs) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [things, activeSpace, projectSpaces, beliefs]);
}
