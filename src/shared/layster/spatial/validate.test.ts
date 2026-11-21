import { describe, expect, it } from 'vitest';
import { createSpatialProject, newThing } from './defaults';
import { checkSpatialAnimations, validateSpatialProject } from './validate';
import { virtualRoomPart } from './virtualRoom';
import type { SpatialProject } from './types';

function base(): SpatialProject {
  return createSpatialProject({ id: 'p', name: 'Test', targetDevice: 'Meta_Quest', now: '2026-10-24T00:00:00.000Z' });
}

describe('checkSpatialAnimations', () => {
  it('reports character animations, animate clips and script names missing from Assets/Animations', () => {
    const p = base();
    const buddy = newThing('character', 'buddy');
    if (buddy.visual.kind === 'character') { buddy.visual.file = 'Assets/Characters/b.vrm'; buddy.visual.animation = 'Idle'; }
    p.things.push(buddy);
    p.rules.push({ id: 'wave', when: { start: true }, do: [{ do: 'animate', thing: 'buddy', clip: 'Wave', then: 'stand' }, { do: 'animate', thing: 'buddy', clip: 'Idle', then: 'Dance' }] });
    p.scripts.push({ id: 's', name: 's', enabled: true, trigger: { type: 'onStart' }, code: "vrm.playAnimation('buddy', 'Jump');" });
    const problems = checkSpatialAnimations(p, ['Idle']);
    expect(problems.map((x) => x.path)).toEqual(['rules[wave].do[0].clip', 'rules[wave].do[1].then', 'scripts[s]']);
    expect(problems.every((x) => x.level === 'warning')).toBe(true);
    expect(checkSpatialAnimations(p, ['Idle', 'Wave', 'Dance', 'Jump'])).toEqual([]);
  });
});

describe('validateSpatialProject — settings', () => {
  it('warns while the log relay is on and checks its port', () => {
    const p = base();
    expect(validateSpatialProject(p).some((x) => x.path === 'app.logRelay' && x.level === 'warning')).toBe(true);
    p.app.logRelay = { enabled: false };
    expect(validateSpatialProject(p).some((x) => x.path === 'app.logRelay')).toBe(false);
    p.app.logRelay = { enabled: true, port: 70000 };
    expect(validateSpatialProject(p).some((x) => x.path === 'app.logRelay.port' && x.level === 'error')).toBe(true);
  });

  it('warns that grabbable does nothing on head / hand things', () => {
    const p = base();
    const hud = newThing('hud', 'hud');
    hud.grabbable = true;
    p.things.push(hud);
    expect(validateSpatialProject(p).some((x) => x.path === 'things[hud].grabbable')).toBe(true);
  });
});

describe('virtualRoomPart', () => {
  it('draws floors, walls and furniture from lasting sources only', () => {
    expect(virtualRoomPart({ is: ['floor'], size: [4, 0, 4], source: 'scan' })).toBe('floor');
    expect(virtualRoomPart({ is: ['WALL_FACE'], size: [3, 2.4, 0], source: 'scan' })).toBe('wall');
    expect(virtualRoomPart({ is: ['table'], size: [1, 0.7, 0.6], source: 'space' })).toBe('furniture');
    expect(virtualRoomPart({ is: ['ceiling'], size: [4, 0, 4], source: 'scan' })).toBeNull();
    expect(virtualRoomPart({ is: ['cup'], size: [0.1, 0.1, 0.1], source: 'detector:yolo' })).toBeNull();
    expect(virtualRoomPart({ is: ['cup'], size: [0.1, 0.1, 0.1], source: 'mind:helper' })).toBeNull();
  });
});
