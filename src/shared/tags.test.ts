import { describe, it, expect } from 'vitest';
import { describeTagQuery, isValidTag, matchTagQuery, tagMatches, uniqueTags, validateTagQuery } from './tags';

describe('tags', () => {
  it('accepts namespace:value and rejects anything else', () => {
    expect(isValidTag('cap:hand-tracking')).toBe(true);
    expect(isValidTag('device:meta-quest')).toBe(true);
    expect(isValidTag('cap:6dof')).toBe(true);
    expect(isValidTag('Cap:Hand')).toBe(false); // 正規化前の大文字は通さない
    expect(isValidTag('hand-tracking')).toBe(false);
    expect(isValidTag('cap:*')).toBe(false);
    expect(isValidTag('cap:*', { wildcard: true })).toBe(true);
  });

  it('matches a namespace wildcard', () => {
    expect(tagMatches('device:*', 'device:meta-quest')).toBe(true);
    expect(tagMatches('device:*', 'cap:meta-quest')).toBe(false);
    expect(tagMatches('cap:passthrough', 'CAP:Passthrough')).toBe(true);
  });

  it('evaluates all / any / none', () => {
    const quest = ['device:meta-quest', 'cap:hand-tracking', 'cap:passthrough'];
    expect(matchTagQuery({ all: ['device:meta-quest'] }, quest).ok).toBe(true);

    const noHands = matchTagQuery({ all: ['cap:hand-tracking'] }, ['device:xreal-one']);
    expect(noHands.ok).toBe(false);
    expect(noHands.missing).toEqual(['cap:hand-tracking']);

    const any = matchTagQuery({ any: ['cap:passthrough', 'cap:optical-see-through'] }, ['cap:optical-see-through']);
    expect(any.ok).toBe(true);
    const anyMiss = matchTagQuery({ any: ['cap:passthrough', 'cap:optical-see-through'] }, []);
    expect(anyMiss.ok).toBe(false);
    expect(anyMiss.missingAny).toHaveLength(2);

    const blocked = matchTagQuery({ none: ['platform:android'] }, ['platform:android']);
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toEqual(['platform:android']);

    expect(matchTagQuery(undefined, []).ok).toBe(true);
  });

  it('defers namespaces that are only known at build time', () => {
    const r = matchTagQuery({ all: ['device:meta-quest', 'sdk:meta-mruk'] }, ['device:meta-quest'], { deferred: ['sdk'] });
    expect(r.ok).toBe(true);
    expect(r.deferred).toEqual(['sdk:meta-mruk']);

    // ビルド時 (deferred なし) には本当に足りないものとして扱う
    const atBuild = matchTagQuery({ all: ['device:meta-quest', 'sdk:meta-mruk'] }, ['device:meta-quest']);
    expect(atBuild.ok).toBe(false);
    expect(atBuild.missing).toEqual(['sdk:meta-mruk']);
  });

  it('reports malformed queries', () => {
    expect(validateTagQuery({ all: ['device:meta-quest'] }, 'requires')).toEqual([]);
    expect(validateTagQuery({ all: 'device:meta-quest' }, 'requires')).toHaveLength(1);
    expect(validateTagQuery({ every: [] }, 'requires')[0]).toMatch(/unknown key/);
    expect(validateTagQuery({ all: ['quest'] }, 'requires')[0]).toMatch(/not a tag/);
    expect(validateTagQuery({ all: ['vendor:meta'] }, 'requires')[0]).toMatch(/unknown namespace/);
  });

  it('sorts and de-duplicates, and describes a query for logs', () => {
    expect(uniqueTags(['cap:b', 'CAP:a', 'cap:b', ' '])).toEqual(['cap:a', 'cap:b']);
    expect(describeTagQuery({ all: ['device:meta-quest'], any: ['sdk:a', 'sdk:b'] })).toBe('device:meta-quest, one of sdk:a / sdk:b');
  });
});
