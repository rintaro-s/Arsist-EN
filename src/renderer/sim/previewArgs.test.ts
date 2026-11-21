import { describe, expect, it } from 'vitest';
import { parseArgs, parseTimes, safeName, timeTag } from '../../../scripts/sim/args.mjs';

describe('preview simulator arguments (scripts/sim/args.mjs)', () => {
  it('parses the full contract', () => {
    const r = parseArgs(['proj', '--out', 'o', '--space', 'all', '--device', 'XREAL_One', '--times', '0,2,5',
      '--width', '800', '--height', '600', '--view', 'overview', '--overlays', '--json']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.opts).toMatchObject({
      project: 'proj', out: 'o', space: 'all', device: 'XREAL_One', times: [0, 2, 5],
      width: 800, height: 600, view: 'overview', overlays: true, json: true,
    });
  });

  it('has defaults and accepts --flag=value', () => {
    const r = parseArgs(['p', '--out=x', '--times=1.5']);
    expect(r.ok && r.opts).toMatchObject({ width: 1280, height: 720, view: 'first-person', times: [1.5], space: null, lang: 'en' });
  });

  it('rejects bad input', () => {
    expect(parseArgs(['--out', 'o']).ok).toBe(false);
    expect(parseArgs(['p']).ok).toBe(false);
    expect(parseArgs(['p', '--out', 'o', '--view', 'side']).ok).toBe(false);
    expect(parseArgs(['p', '--out', 'o', '--width', '12']).ok).toBe(false);
    expect(parseArgs(['p', '--out', 'o', '--bogus']).ok).toBe(false);
    expect(parseArgs(['p', '--out']).ok).toBe(false);
    expect(parseArgs(['p', 'q', '--out', 'o']).ok).toBe(false);
  });

  it('normalizes times and names', () => {
    expect(parseTimes('5, 0,2,2,-1,x')).toEqual([0, 2, 5]);
    expect(parseTimes('')).toEqual([0]);
    expect(parseTimes(undefined)).toEqual([0]);
    expect(timeTag(0)).toBe('t0');
    expect(timeTag(2.5)).toBe('t2.5');
    expect(safeName('desk front/1')).toBe('desk_front_1');
  });
});
