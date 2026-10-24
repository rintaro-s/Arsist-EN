/**
 * 開いている Spatial のプロジェクトが、エディタの外 (エージェント・手) で変わったことを知らせる。
 * 考え方は ProjectWatcher (src/main/project/projectWatcher.ts) と同じ:
 *   - ファイルではなくフォルダを見る (保存は「一時ファイル → rename」なので、ファイルを見ると見張りが外れる)
 *   - 自分で書いた中身を覚えておき、同じ中身への変化は知らせない (時刻で無視すると外の変更を取りこぼす)
 * 見るのは project.spatial.json と spaces/*.json。
 */
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs-extra';
import chokidar from 'chokidar';
import { SPATIAL_PROJECT_FILE } from '../../shared/layster/version';
import { SPACES_DIR } from './SpatialProjectManager';

const digest = (text: string | Buffer) => crypto.createHash('sha1').update(text).digest('hex');

export class SpatialWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private root: string | null = null;
  private readonly ownWrites = new Map<string, string>();
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly onExternalChange: (projectPath: string, files: string[]) => void, private readonly debounceMs = 250) {}

  isWatching(projectPath: string): boolean {
    return this.watcher !== null && this.root !== null && path.resolve(this.root) === path.resolve(projectPath);
  }

  watch(projectPath: string): void {
    if (this.isWatching(projectPath)) return;
    this.close();
    this.root = projectPath;
    const root = path.resolve(projectPath);
    const wanted = (p: string) => {
      const rel = path.relative(root, path.resolve(p));
      if (rel === '') return true;
      const [top, ...rest] = rel.split(path.sep);
      if (rest.length === 0) return top === SPATIAL_PROJECT_FILE || top === SPACES_DIR;
      return top === SPACES_DIR && rest.length === 1;
    };
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      depth: 1,
      ignored: (p: string) => p.includes('.tmp-') || !wanted(p),
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    const handle = (file: string) => { void this.consider(file); };
    this.watcher.on('add', handle).on('change', handle).on('unlink', handle);
  }

  recordOwnWrite(file: string, text: string): void {
    this.ownWrites.set(path.resolve(file), digest(text));
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    void this.watcher?.close();
    this.watcher = null;
    this.root = null;
  }

  private async consider(file: string): Promise<void> {
    if (!file.endsWith('.json')) return;
    const key = path.resolve(file);
    const own = this.ownWrites.get(key);
    if (own) {
      const now = await fs.readFile(key).catch(() => null);
      if (now && digest(now) === own) return;
    }
    this.pending.add(path.relative(this.root ?? '', key));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const files = [...this.pending].sort();
      this.pending.clear();
      this.timer = null;
      if (this.root && files.length > 0) this.onExternalChange(this.root, files);
    }, this.debounceMs);
  }
}
