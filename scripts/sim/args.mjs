/**
 * scripts/sim/preview.mjs の引数。純粋な関数だけ (src/renderer/sim/previewArgs.test.ts が確かめる)。
 *
 *   <project dir> --out <dir> [--space <id>|all] [--scene <id>|all] [--device <adapter>] [--times 0,2,5]
 *   [--width 1280 --height 720] [--view first-person|overview] [--overlays] [--lang en|ja] [--json]
 *   [--timeout <sec>]
 */

export const VIEWS = ['first-person', 'overview'];

export const USAGE = `usage: node scripts/sim/preview.mjs <project dir> --out <dir>
  [--space <id>|all]        Spatial: test space(s) to render (default: every space in spaces.use)
  [--scene <id>|all]        Virtual: scene(s) to render (default: the first scene)
  [--device <adapter>]      adapter folder for the field of view (default: the project's targetDevice)
  [--times 0,2,5]           seconds; Spatial re-runs start/every/placed rules up to each time (approximate)
  [--width 1280 --height 720]
  [--view first-person|overview]
  [--overlays]              placement rule colours, entity names, notes
  [--lang en|ja]            language of names in overlays (default en)
  [--timeout <sec>]         give up after this long (default 90)
  [--json]                  print result.json to stdout instead of a summary`;

/** '0,2,5' → [0, 2, 5]。数でないもの・負の数は捨て、重複を除いて並べる。空なら [0]。 */
export function parseTimes(text) {
  if (text === undefined || text === null || text === '') return [0];
  const out = new Set();
  for (const raw of String(text).split(',')) {
    const part = raw.trim();
    if (part === '') continue;
    const v = Number(part);
    if (Number.isFinite(v) && v >= 0) out.add(Math.round(v * 1000) / 1000);
  }
  return out.size ? [...out].sort((a, b) => a - b) : [0];
}

/** 2.5 → 't2.5'、0 → 't0'。 */
export function timeTag(t) {
  return `t${Number.isInteger(t) ? t : String(t)}`;
}

/** ファイル名に使える形 (英数字・-・_ 以外は _)。 */
export function safeName(s) {
  return String(s).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

/**
 * @returns {{ ok: true, opts: object } | { ok: false, error: string }}
 */
export function parseArgs(argv) {
  const opts = {
    project: null, out: null, space: null, scene: null, device: null, times: [0],
    width: 1280, height: 720, view: 'first-person', overlays: false, lang: 'en', json: false, timeout: 90, help: false,
  };
  const valueFlags = new Set(['--out', '--space', '--scene', '--device', '--times', '--width', '--height', '--view', '--lang', '--timeout']);
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let value;
    if (a.startsWith('--') && a.includes('=')) {
      value = a.slice(a.indexOf('=') + 1);
      a = a.slice(0, a.indexOf('='));
    }
    if (valueFlags.has(a)) {
      if (value === undefined) {
        value = argv[++i];
        if (value === undefined) return { ok: false, error: `${a} needs a value` };
      }
      switch (a) {
        case '--out': opts.out = value; break;
        case '--space': opts.space = value; break;
        case '--scene': opts.scene = value; break;
        case '--device': opts.device = value; break;
        case '--times': opts.times = parseTimes(value); break;
        case '--width':
        case '--height': {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 64 || n > 8192) return { ok: false, error: `${a} must be an integer between 64 and 8192` };
          opts[a.slice(2)] = n;
          break;
        }
        case '--view':
          if (!VIEWS.includes(value)) return { ok: false, error: `--view must be one of ${VIEWS.join(', ')}` };
          opts.view = value;
          break;
        case '--lang':
          if (value !== 'en' && value !== 'ja') return { ok: false, error: '--lang must be en or ja' };
          opts.lang = value;
          break;
        case '--timeout': {
          const n = Number(value);
          if (!(n > 0)) return { ok: false, error: '--timeout must be a positive number of seconds' };
          opts.timeout = n;
          break;
        }
      }
      continue;
    }
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--overlays') { opts.overlays = true; continue; }
    if (a === '-h' || a === '--help') { opts.help = true; continue; }
    if (a.startsWith('-')) return { ok: false, error: `unknown option ${a}` };
    if (opts.project) return { ok: false, error: `unexpected argument ${a}` };
    opts.project = a;
  }
  if (opts.help) return { ok: true, opts };
  if (!opts.project) return { ok: false, error: 'missing <project dir>' };
  if (!opts.out) return { ok: false, error: 'missing --out <dir>' };
  return { ok: true, opts };
}
