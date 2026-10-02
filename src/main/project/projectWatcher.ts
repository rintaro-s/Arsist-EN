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

const digest = (text: string | Buffer) => crypto.createHash('sha1').update(text).digest('hex');

export class ProjectWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private root: string | null = null;
  private readonly ownWrites = new Map<string, string>();
  private pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly onExternalChange: (projectPath: string, files: string[]) => void, private readonly debounceMs = 400) {}

  watch(projectPath: string): void {
    this.close();
    this.root = projectPath;
    const targets = ['project.json', 'Scenes', 'UI'].map((p) => path.join(projectPath, p));
    this.watcher = chokidar.watch(targets, {
      ignoreInitial: true,
      depth: 1,
      ignored: (p: string) => p.includes('.tmp-') || p.includes('.arsist-'),
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    });
    const handle = (file: string) => { void this.consider(file); };
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
