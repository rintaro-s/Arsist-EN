import { describe, it, expect } from 'vitest';
import { animationNamesInScripts, characterAnimationIssues } from './characterChecks';

describe('character animation names', () => {
  it('finds names written in scripts', () => {
    expect(animationNamesInScripts(`vrm.playAnimation('Sis', "Wave", { then: 'Idle' }); vrm.walkTo('Sis', 1, 2, { walk: 'Stroll' });`).sort())
      .toEqual(['Idle', 'Stroll', 'Wave']);
    // 呼び出しの外の { idle: '…' } は動きではない
    expect(animationNamesInScripts(`var labels = { idle: '—', study: 'x' }; vrm.playAnimation(id, cond ? 'A' : 'B');`)).toEqual([]);
  });

  it("treats then: 'stand' as the relaxed standing pose, not an FBX name", () => {
    expect(animationNamesInScripts(`vrm.playAnimation('Sis', 'Writing', { then: 'stand' });`)).toEqual(['Writing']);
  });

  it('reports a starting animation or a script name that is not in Assets/Animations', () => {
    const project = {
      scenes: [{ id: 's', name: 'S', objects: [
        { id: 'v', name: 'Sis', type: 'vrm', character: { animation: 'Sitting' }, transform: {} },
        { id: 'w', name: 'Ok', type: 'vrm', character: { animation: 'Idle' }, transform: {} },
      ] }],
      scripts: [
        { id: 'a', name: 'talk', enabled: true, code: "vrm.playAnimation('Sis', 'Talk'); vrm.walkTo('Sis', 0, 1);", trigger: { type: 'onStart' } },
        { id: 'b', name: 'off', enabled: false, code: "vrm.playAnimation('Sis', 'Nope');", trigger: { type: 'onStart' } },
      ],
    } as any;
    const issues = characterAnimationIssues(project, ['Idle']);
    expect(issues).toHaveLength(3);
    expect(issues[0]).toMatch(/"Sis" starts with animation "Sitting"/);
    expect(issues[1]).toMatch(/script "talk" uses animation "Talk"/);
    expect(issues[2]).toMatch(/without a "Walk" animation/);
    expect(characterAnimationIssues(project, ['Idle', 'Sitting', 'Talk', 'Walk'])).toEqual([]);
  });
});
