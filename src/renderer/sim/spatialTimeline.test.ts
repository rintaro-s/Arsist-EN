import { describe, expect, it } from 'vitest';
import type { Rule, SpatialProject, Thing } from '../../shared/layster/spatial/types';
import type { SolveResult } from '../../shared/layster/spatial/solver';
import { sayDuration, simulateAt } from './spatialTimeline';

const thing = (id: string, extra: Partial<Thing> = {}): Thing => ({
  id, visual: { kind: 'marker' }, place: {}, ...extra,
});
const placed = (id: string, rule: SolveResult['rule'] = 0): SolveResult => ({
  thing: id, mode: 'world', frame: 'world', pose: { at: [0, 0, 1], yaw: 0 }, rule, notes: [],
});
const project = (things: Thing[], rules: Rule[]) => ({ things, rules } as unknown as SpatialProject);

describe('spatial preview time model (approximate)', () => {
  it('runs start / placed / fallback at t=0 and say expires', () => {
    const p = project([thing('a'), thing('b')], [
      { id: 'start', when: { start: true }, do: [{ do: 'set', key: 'mode', value: 'ready' }] },
      { id: 'hello', when: { placed: 'a' }, do: [{ do: 'say', text: 'hi', seconds: 3 }] },
      { id: 'fb', when: { fallback: 'b' }, do: [{ do: 'hide', thing: 'b' }] },
    ]);
    const results = [placed('a'), placed('b', 1)];
    const t0 = simulateAt(p, results, undefined, 0);
    expect(t0.store).toMatchObject({ mode: 'ready', 'say.text': 'hi', 'say.thing': '' });
    expect(t0.visible.has('b')).toBe(false);
    expect(simulateAt(p, results, undefined, 2.9).store['say.text']).toBe('hi');
    expect(simulateAt(p, results, undefined, 3).store['say.text']).toBe('');
  });

  it('fires every N seconds, honours cooldown and conditions, and follows emit', () => {
    const p = project([thing('a', { visibleAtStart: false })], [
      { id: 'tick', when: { every: 1 }, do: [{ do: 'emit', event: 'beat' }] },
      { id: 'beat', when: { event: 'beat' }, cooldownMs: 1500, do: [{ do: 'show', thing: 'a' }, { do: 'set', key: 'n', value: 1 }] },
      { id: 'cond', when: { every: 2 }, if: [{ store: 'n', eq: 1 }], do: [{ do: 'highlight', target: { thing: 'a' }, label: 'look', seconds: 1 }] },
    ]);
    const s0 = simulateAt(p, [placed('a')], undefined, 0);
    expect(s0.visible.has('a')).toBe(false);
    const s2 = simulateAt(p, [placed('a')], undefined, 2);
    expect(s2.visible.has('a')).toBe(true);
    // beat at t=1 runs; at t=2 it is inside the 1.5 s cooldown
    expect(s2.log.filter((l) => l.rule === 'beat' && l.action === 'set')).toHaveLength(1);
    expect(s2.highlights).toHaveLength(1);
    expect(simulateAt(p, [placed('a')], undefined, 3.5).highlights).toHaveLength(0);
  });

  it('lists what it does not simulate', () => {
    const p = project([thing('a')], [
      { id: 'sel', when: { select: 'a.btn' }, do: [{ do: 'say', text: 'x' }] },
      { id: 's', when: { start: true }, do: [{ do: 'ask', mind: 'm' }] },
    ]);
    const s = simulateAt(p, [placed('a')], undefined, 1);
    expect(s.skipped).toEqual(['do:ask', 'when:select']);
    expect(s.store['say.text']).toBeUndefined();
  });

  it('uses the runtime default say duration', () => {
    expect(sayDuration('abcde')).toBeCloseTo(1.8);
    expect(sayDuration('x'.repeat(200))).toBe(12);
    expect(sayDuration('x', 4)).toBe(4);
  });
});
