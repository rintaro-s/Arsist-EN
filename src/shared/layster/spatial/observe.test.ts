import { describe, expect, it } from 'vitest';
import { buildMindRequest, pointToFrame } from './observe';
import { newMind } from './defaults';
import { findBuiltinSpace } from './spaces';
import { solveAll, worldFromSpace } from './solver';
import type { Body, Mind, Thing } from './types';

const THINGS: Thing[] = [
  { id: 'base', visual: { kind: 'marker' }, place: { at: { frame: 'user', at: [0.5, 0.75, 0.8] } } },
  { id: 'hud', visual: { kind: 'panel', size: [0.5, 0.1], items: [] }, place: { mode: 'head', at: { frame: 'head', at: [0, -0.25, 1.4] } } },
];
const BODY: Body = {
  id: 'arm', kind: 'arm', link: { protocol: 'layster-body', url: 'ws://x:1' }, base: { thing: 'base' },
  workspace: { center: [0, 0, 0], size: [1, 1, 1] }, commands: [],
};

function mind(patch: Partial<Mind['observe']>, extra: Partial<Mind> = {}): Mind {
  const m = newMind('m', 'layster');
  return { ...m, observe: { ...patch }, ...extra };
}

function setup(spaceId: string) {
  const world = worldFromSpace(findBuiltinSpace(spaceId)!);
  const placed = solveAll(THINGS, world);
  return { world, placed, project: { things: THINGS, bodies: [BODY] } };
}

describe('buildMindRequest', () => {
  it('filters entities by confidence, words and distance, nearest first, up to max', () => {
    const { world, placed, project } = setup('studio');
    const req = buildMindRequest({ project, world, placed, mind: mind({ world: { within: 2.5, max: 3 } }) });
    expect(req.world!.length).toBe(3);
    const d = req.world!.map((e) => Math.hypot(e.at[0], e.at[2]));
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    const desks = buildMindRequest({ project, world, placed, mind: mind({ world: { is: ['table'] } }) });
    // desk は table として探しても当たる
    expect(desks.world!.map((e) => e.id)).toEqual(['desk']);
    expect(desks.world![0].has).toContain('support');
  });

  it('writes positions in the user frame (yaw only)', () => {
    const { world, placed, project } = setup('desk-front');
    const turned = { ...world, user: { ...world.user, yaw: 90 } };
    const req = buildMindRequest({ project, world: turned, placed, mind: mind({ world: { is: ['desk'] }, user: ['head'] }) });
    // 机は world の +Z 0.8 m。右 (+X) を向いたユーザーから見ると左 (-X) 0.8 m
    expect(req.world![0].at[0]).toBeCloseTo(-0.8, 3);
    expect(req.world![0].at[2]).toBeCloseTo(0, 3);
    expect(req.user!.head!.forward).toEqual([0, 0, 1]);
    expect(req.user!.head!.at[1]).toBeCloseTo(1.2, 3);
  });

  it('resolves body frames from the base thing and falls back to user for unknown frames', () => {
    const { world, placed, project } = setup('studio');
    const req = buildMindRequest({ project, world, placed, mind: mind({ frame: 'body:arm', things: ['base'] }) });
    expect(req.frame).toBe('body:arm');
    expect(req.things![0].at).toEqual([0, 0, 0]);
    const unknown = buildMindRequest({ project, world, placed, mind: mind({ frame: 'body:nope' }) });
    expect(unknown.frame).toBe('user');
  });

  it('includes head-locked things converted to world first, plus events, store and goal', () => {
    const { world, placed, project } = setup('studio');
    const req = buildMindRequest({
      project, world, placed,
      mind: mind({ things: true, events: 2, store: ['study.'] }, { instructions: ' help ' }),
      events: [{ t: 1, name: 'a' }, { t: 2, name: 'b' }, { t: 3, name: 'c' }],
      store: { 'study.state': 'x', other: 1 },
    });
    const hud = req.things!.find((t) => t.id === 'hud')!;
    expect(hud.at[1]).toBeCloseTo(1.6 - 0.25, 3);
    expect(hud.at[2]).toBeCloseTo(1.4, 3);
    expect(req.events!.map((e) => e.name)).toEqual(['b', 'c']);
    expect(req.store).toEqual({ 'study.state': 'x' });
    expect(req.goal).toBe('help');
    expect(req.actions).toEqual(newMind('m', 'layster').output.actions);
  });

  it('pointToFrame is the inverse of the solver rotation', () => {
    expect(pointToFrame([1, 0, 0], { origin: [0, 0, 0], yaw: 90 }).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 1]);
  });
});
