import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectWatcher } from './projectWatcher';
import { atomicWriteJson } from './projectIO';

let dir: string;
let watcher: ProjectWatcher | null = null;
afterEach(() => { watcher?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('project watcher', () => {
  it('reports changes made outside the editor, not the editor\'s own saves', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arsist-watch-'));
    fs.mkdirSync(path.join(dir, 'Scenes'));
    fs.writeFileSync(path.join(dir, 'project.json'), '{}');
    const seen: string[][] = [];
    watcher = new ProjectWatcher((_p, files) => seen.push(files), 200);
    watcher.watch(dir);
    await wait(500);

    // エディタの保存
    const own = await atomicWriteJson(path.join(dir, 'project.json'), { name: 'mine' });
    watcher.recordOwnWrite(path.join(dir, 'project.json'), own);
    await wait(900);
    expect(seen).toEqual([]);

    // 外 (エージェント) の変更
    await atomicWriteJson(path.join(dir, 'Scenes', 's1.json'), { id: 's1' });
    await atomicWriteJson(path.join(dir, 'project.json'), { name: 'agent' });
    await wait(1200);
    expect(seen).toEqual([['Scenes/s1.json', 'project.json']]);
  }, 10000);
});
