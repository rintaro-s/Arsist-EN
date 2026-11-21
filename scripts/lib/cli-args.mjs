/**
 * `arsist` コマンド (scripts/arsist.mjs) の引数の読み方。依存なし・副作用なし (scripts/arsist.test.ts が直接試す)。
 *
 *   parseArgs(argv, { booleans, repeatable })
 *     --name value / --name=value   値つきの指定 (repeatable に入っている名前は何度でも書けて、配列になる)
 *     --flag                        booleans に入っている名前は値を取らない
 *     -h                            --help と同じ
 *     --                            これより後はすべて位置引数 (rest) として残す
 *   値を取るはずの指定が最後にあって値が無いときは UsageError。
 */

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** 全コマンド共通の、値を取らない指定。 */
export const GLOBAL_BOOLEANS = ['json', 'help', 'quiet', 'version'];

export function parseArgs(argv, { booleans = [], repeatable = [] } = {}) {
  const bools = new Set([...GLOBAL_BOOLEANS, ...booleans]);
  const repeat = new Set(repeatable);
  const positional = [];
  const options = {};
  const rest = [];
  const put = (name, value) => {
    if (repeat.has(name)) (options[name] ??= []).push(value);
    else options[name] = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a === '-h') {
      options.help = true;
      continue;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (bools.has(name)) {
        if (eq > 0) {
          const v = a.slice(eq + 1).toLowerCase();
          if (!['true', 'false', '1', '0', 'yes', 'no'].includes(v)) throw new UsageError(`--${name} does not take a value (got "${a.slice(eq + 1)}")`);
          options[name] = ['true', '1', 'yes'].includes(v);
        } else {
          options[name] = true;
        }
        continue;
      }
      if (eq > 0) {
        put(name, a.slice(eq + 1));
        continue;
      }
      if (i + 1 >= argv.length) throw new UsageError(`--${name} needs a value`);
      put(name, argv[++i]);
      continue;
    }
    positional.push(a);
  }
  return { positional, options, rest };
}

/** "a,b" と --x a --x b のどちらでも書けるリスト。 */
export function listOption(value) {
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean);
}

/** --json を除いた素の引数 (別のスクリプトにそのまま渡すとき)。 */
export function withoutFlag(argv, name) {
  return argv.filter((a) => a !== `--${name}`);
}
