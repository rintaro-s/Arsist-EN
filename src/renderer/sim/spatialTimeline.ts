/**
 * プレビュー シミュレータ (scripts/sim/preview.mjs) の時間の模型 — **おおよそ** (approximate)。
 *
 * 実機の規則エンジン (Runtime/Spatial/、doc/20 §7) のうち、PC だけで決まる小さな部分だけをなぞる:
 *   きっかけ: start (t=0) / placed (t=0、置けた物) / fallback (t=0、本来の置き方で置けなかった物) /
 *             every (t = N, 2N, …) / event (emit から)
 *   行動:     say (say.text / say.thing、seconds で消える) / show / hide / set / highlight / emit
 * それ以外 (select・gaze・near・seen・mind のきっかけ、move・look・animate・ask・command などの行動) は
 * 動かさず、skipped に名前を残す。Mind は呼ばない。結果は「その時刻に画面に何が出ているか」の目安。
 *
 * React / three に依存しない (vitest で確かめる)。
 */
import type { Action, Condition, Rule, SpatialProject, Target, When } from '../../shared/layster/spatial/types';
import { findEntities, type SolveResult, type SolveWorld } from '../../shared/layster/spatial/solver';

export interface SimHighlight {
  target: Target;
  label?: string;
  color?: string;
  until: number;
}

export interface SimLogEntry {
  t: number;
  rule: string;
  action: string;
  /** 動かしたか、飛ばしたか */
  status: 'done' | 'skipped';
  detail?: string;
}

export interface SimState {
  t: number;
  store: Record<string, unknown>;
  /** 見えている物の id */
  visible: Set<string>;
  highlights: SimHighlight[];
  log: SimLogEntry[];
  /** 動かさなかったきっかけ・行動の種類 (重複なし) */
  skipped: string[];
}

/** say の既定の表示時間 (doc/20 §7: 1.2 + 0.12 × 文字数、最大 12 秒)。 */
export function sayDuration(text: string, seconds?: number): number {
  if (typeof seconds === 'number' && seconds > 0) return seconds;
  return Math.min(12, 1.2 + 0.12 * [...text].length);
}

/** 'a.b.c' の store を平らなキーで持つ (実機の store も平らなキー)。 */
function evalCondition(c: Condition, store: Record<string, unknown>, world: SolveWorld | undefined): boolean {
  if ('not' in c) return !evalCondition(c.not, store, world);
  if ('has' in c) return world ? findEntities(c.has, world).length > 0 : false;
  const v = store[c.store];
  if (c.exists !== undefined && (v !== undefined && v !== null && v !== '') !== c.exists) return false;
  if ('eq' in c && c.eq !== undefined && v !== c.eq) return false;
  if ('ne' in c && c.ne !== undefined && v === c.ne) return false;
  if (c.gt !== undefined && !(typeof v === 'number' && v > c.gt)) return false;
  if (c.lt !== undefined && !(typeof v === 'number' && v < c.lt)) return false;
  return true;
}

interface Pending {
  t: number;
  /** 同じ時刻のものは入れた順 */
  seq: number;
  rule: Rule;
  /** event のきっかけの深さ (emit の連鎖を止める) */
  depth: number;
}

const MAX_EVENT_DEPTH = 8;
const MAX_STEPS = 5000;

function whenKind(w: When): string {
  return Object.keys(w)[0] ?? '?';
}

/**
 * 時刻 t までの規則を流し、その時刻の状態を返す。
 * @param results 置き方を解いた結果 (placed / fallback のきっかけに使う)
 */
export function simulateAt(project: SpatialProject, results: SolveResult[], world: SolveWorld | undefined, t: number): SimState {
  const store: Record<string, unknown> = {};
  const visible = new Set(project.things.filter((x) => x.visibleAtStart !== false).map((x) => x.id));
  const highlights: SimHighlight[] = [];
  const log: SimLogEntry[] = [];
  const skipped = new Set<string>();
  const lastFired = new Map<string, number>();
  // say.text を消す予定 (後の say に置き換わっていなければ)
  let sayToken = 0;
  const sayExpiry: Array<{ t: number; token: number }> = [];

  const rules = project.rules.filter((r) => r.enabled !== false);
  const queue: Pending[] = [];
  let seq = 0;
  const push = (time: number, rule: Rule, depth = 0) => queue.push({ t: time, seq: seq++, rule, depth });

  const byResult = new Map(results.map((r) => [r.thing, r]));
  for (const r of rules) {
    const w = r.when;
    if ('start' in w) push(0, r);
    else if ('placed' in w) {
      if (byResult.has(w.placed) && visible.has(w.placed)) push(0, r);
    } else if ('fallback' in w) {
      const res = byResult.get(w.fallback);
      if (res && res.rule !== 0) push(0, r);
    } else if ('every' in w) {
      const step = Number(w.every);
      if (step > 0) for (let k = 1; k * step <= t + 1e-9 && k < 1000; k++) push(k * step, r);
    } else if (!('event' in w)) {
      skipped.add(`when:${whenKind(w)}`);
    }
  }

  const fireEvent = (name: string, time: number, depth: number) => {
    if (depth >= MAX_EVENT_DEPTH) return;
    for (const r of rules) if ('event' in r.when && r.when.event === name) push(time, r, depth + 1);
  };

  const run = (a: Action, time: number, rule: Rule, depth: number) => {
    const entry = (status: SimLogEntry['status'], detail?: string) => log.push({ t: time, rule: rule.id, action: a.do, status, detail });
    switch (a.do) {
      case 'say': {
        store['say.text'] = a.text;
        store['say.thing'] = a.thing ?? '';
        const token = ++sayToken;
        sayExpiry.push({ t: time + sayDuration(a.text, a.seconds), token });
        entry('done', a.text);
        break;
      }
      case 'show': visible.add(a.thing); entry('done', a.thing); break;
      case 'hide': visible.delete(a.thing); entry('done', a.thing); break;
      case 'set': store[a.key] = a.value; entry('done', `${a.key} = ${JSON.stringify(a.value)}`); break;
      case 'highlight':
        highlights.push({ target: a.target, label: a.label, color: a.color, until: time + (a.seconds ?? 5) });
        entry('done', a.label);
        break;
      case 'emit': entry('done', a.event); fireEvent(a.event, time, depth); break;
      default:
        skipped.add(`do:${a.do}`);
        entry('skipped');
    }
  };

  let steps = 0;
  while (queue.length > 0 && steps++ < MAX_STEPS) {
    queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const next = queue.shift()!;
    if (next.t > t + 1e-9) break;
    // その時刻より前に消える say.text を消す
    for (const e of sayExpiry.splice(0)) {
      if (e.t <= next.t + 1e-9) { if (e.token === sayToken) store['say.text'] = ''; }
      else sayExpiry.push(e);
    }
    const r = next.rule;
    const last = lastFired.get(r.id);
    if (r.cooldownMs && last !== undefined && (next.t - last) * 1000 < r.cooldownMs) continue;
    if (r.if && !r.if.every((c) => evalCondition(c, store, world))) continue;
    lastFired.set(r.id, next.t);
    for (const a of r.do) run(a, next.t, r, next.depth);
  }
  for (const e of sayExpiry) if (e.t <= t + 1e-9 && e.token === sayToken) store['say.text'] = '';

  return {
    t,
    store,
    visible,
    highlights: highlights.filter((h) => h.until > t + 1e-9),
    log,
    skipped: [...skipped].sort(),
  };
}

