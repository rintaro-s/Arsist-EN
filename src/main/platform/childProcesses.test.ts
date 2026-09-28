import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { trackChild, trackedCount, trackedLabels, longRunningOptions } from './childProcesses';

/** spawn の戻り値の代わり。pid と終了イベントだけあればよい。 */
function fakeChild(pid: number): ChildProcess {
  const emitter = new EventEmitter() as unknown as ChildProcess;
  Object.defineProperty(emitter, 'pid', { value: pid });
  return emitter;
}

describe('childProcesses', () => {
  it('覚えたプロセスは終了したら自動で外れる', () => {
    const before = trackedCount();
    const child = fakeChild(4242);
    trackChild(child, 'test job');

    expect(trackedCount()).toBe(before + 1);
    expect(trackedLabels()).toContain('test job');

    (child as unknown as EventEmitter).emit('exit', 0);
    expect(trackedCount()).toBe(before);
  });

  it('pid の無いプロセス (起動に失敗) は覚えない', () => {
    const before = trackedCount();
    const emitter = new EventEmitter() as unknown as ChildProcess;
    trackChild(emitter, 'never started');
    expect(trackedCount()).toBe(before);
  });

  it('長く走るプロセスは Windows 以外でプロセスグループの長にする', () => {
    const options = longRunningOptions({ cwd: '/tmp' });
    expect(options.cwd).toBe('/tmp');
    expect(options.detached).toBe(process.platform !== 'win32');
  });
});
