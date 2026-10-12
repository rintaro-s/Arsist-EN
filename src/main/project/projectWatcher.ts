/**
 * 開いているプロジェクトのファイルが、エディタの外 (MCP のエージェント・内蔵エージェント・別のエディタ・手) で
 * 変わったことを知らせる。エディタは知らせを受けて読み直す (未保存の変更があれば訊く)。
 *
 * エディタ自身の保存を「外の変更」と取り違えないよう、ProjectManager が書いた中身を覚えておき、
 * 同じ中身への変化は無視する (時刻で無視すると、保存と同時に来た外の変更を取りこぼす)。
 */
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs-extra';
import chokidar from 'chokidar';

// ARSIST_DEBUG_WATCH=1 で、変化を見てから知らせるまでの時刻を出す (取りこぼし・遅れの調査用)
const debug = process.env.ARSIST_DEBUG_WATCH === '1'
  ? (...a: unknown[]) => console.log(`[watch ${Date.now()}]`, ...a)
  : () => {};

const digest = (text: string | Buffer) => crypto.createHash('sha1').update(text).digest('hex');

export class ProjectWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private root: string | null = null;
  private readonly ownWrites = new Map<string, string>();
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly onExternalChange: (projectPath: string, files: string[]) => void, private readonly debounceMs = 250) {}

  /** もう見ているか (読み直しのたびに見張りを作り直すと、その間に来た書き込みを取りこぼす) */
  isWatching(projectPath: string): boolean {
    return this.watcher !== null && this.root !== null && path.resolve(this.root) === path.resolve(projectPath);
  }

  watch(projectPath: string): void {
    if (this.isWatching(projectPath)) return;
    this.close();
    this.root = projectPath;
    const root = path.resolve(projectPath);
    // ファイルではなくフォルダを見る。保存は「一時ファイル → rename」なので、ファイルそのものを見ていると
    // 置き換わるたびに見張りが外れ、付け直すまで (数秒) 変更を取りこぼす
    const wanted = (p: string) => {
      const rel = path.relative(root, path.resolve(p));
      if (rel === '') return true;
      const [top, ...rest] = rel.split(path.sep);
      if (rest.length === 0) return top === 'project.json' || top === 'Scenes' || top === 'UI';
      return (top === 'Scenes' || top === 'UI') && rest.length === 1;
    };
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      depth: 1,
      ignored: (p: string) => p.includes('.tmp-') || p.includes('.arsist-') || !wanted(p),
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    });
    const handle = (file: string) => { debug('event', file); void this.consider(file); };
    this.watcher.on('add', handle).on('change', handle).on('unlink', handle);
  }

  /** エディタ自身が書いた (ProjectManager の保存)。この中身への変化は知らせない。 */
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
      if (now && digest(now) === own) { debug('own write', key); return; }
    }
    this.pending.add(path.relative(this.root ?? '', key));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const files = [...this.pending].sort();
      this.pending.clear();
      this.timer = null;
      debug('notify', files);
      if (this.root && files.length > 0) this.onExternalChange(this.root, files);
    }, this.debounceMs);
  }
}
