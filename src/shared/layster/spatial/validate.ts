/**
 * Layster.Spatial — プロジェクトの問題を見つける。
 *
 * エディタの「問題」・エージェントの spatial_validate・ビルドの前の確認が同じ一覧を使う。
 * error はビルドを止める (実機で必ず失敗するもの)。warning は止めない。
 */

import { compareLayster, formatLayster, LAYSTER_CURRENT } from '../version';
import { ACTION_KINDS, AFFORDANCES } from './types';
import type { Action, Condition, Mind, PanelItem, Placement, SpatialProject, Target, Thing, When } from './types';

export interface SpatialProblem {
  level: 'error' | 'warning';
  /** 'things[quiz].place.near' のような場所 */
  path: string;
  message: { en: string; ja: string };
}

const ID_RE = /^[A-Za-z0-9_-]+$/;

export function validateSpatialProject(project: SpatialProject): SpatialProblem[] {
  const out: SpatialProblem[] = [];
  const err = (path: string, en: string, ja: string) => out.push({ level: 'error', path, message: { en, ja } });
  const warn = (path: string, en: string, ja: string) => out.push({ level: 'warning', path, message: { en, ja } });

  // ---- 見出し ----
  const h = project.layster;
  if (!h || h.profile !== 'spatial') {
    err('layster', 'This is not a Layster.Spatial file (layster.profile must be "spatial").', 'Layster.Spatial のファイルではありません (layster.profile が "spatial" ではない)。');
  } else if (compareLayster(h, LAYSTER_CURRENT.spatial) > 0) {
    err('layster', `Made with a newer Arsist (${formatLayster(h)}).`, `新しい Arsist で作られています (${formatLayster(h)})。`);
  }

  // ---- id ----
  const things = new Map<string, Thing>();
  const minds = new Map<string, Mind>();
  const bodies = new Set<string>();
  const checkIds = (list: Array<{ id: string }>, kind: string, sink: (id: string) => void) => {
    const seen = new Set<string>();
    list.forEach((item, i) => {
      const at = `${kind}[${item?.id ?? i}]`;
      if (!item || typeof item.id !== 'string' || !ID_RE.test(item.id)) {
        err(at, `${kind}: the id "${item?.id}" may use only letters, digits, "-" and "_".`, `${kind}: id「${item?.id}」には英数字と - _ だけが使えます。`);
        return;
      }
      if (seen.has(item.id)) err(at, `${kind}: the id "${item.id}" is used twice.`, `${kind}: id「${item.id}」が 2 回使われています。`);
      seen.add(item.id);
      sink(item.id);
    });
  };
  checkIds(project.things ?? [], 'things', (id) => things.set(id, project.things.find((t) => t.id === id)!));
  checkIds(project.minds ?? [], 'minds', (id) => minds.set(id, project.minds.find((m) => m.id === id)!));
  checkIds(project.bodies ?? [], 'bodies', (id) => bodies.add(id));
  checkIds(project.rules ?? [], 'rules', () => {});
  checkIds(project.scripts ?? [], 'scripts', () => {});

  // ---- 参照 ----
  const checkTarget = (path: string, target: Target | undefined) => {
    if (!target) return;
    if ('thing' in target && !things.has(target.thing)) err(path, `No thing "${target.thing}".`, `物「${target.thing}」がありません。`);
    if ('frame' in target) checkFrame(path, target.frame);
  };
  const checkFrame = (path: string, frame: string) => {
    if (frame.startsWith('thing:') && !things.has(frame.slice(6))) err(path, `No thing "${frame.slice(6)}".`, `物「${frame.slice(6)}」がありません。`);
    if (frame.startsWith('body:') && !bodies.has(frame.slice(5))) err(path, `No body "${frame.slice(5)}".`, `体「${frame.slice(5)}」がありません。`);
  };
  const checkPlacement = (path: string, place: Placement | undefined, thingId?: string, depth = 0) => {
    if (!place || typeof place !== 'object') { err(path, 'Missing placement.', '置き方がありません。'); return; }
    const mode = place.mode ?? 'world';
    if ((mode === 'head' || mode === 'hand') && !place.at) warn(path, `mode "${mode}" without "at" uses a default offset.`, `mode「${mode}」で at が無いので、既定のずれを使います。`);
    if (mode !== 'head' && mode !== 'hand' && !place.on && !place.near && !place.at) {
      warn(path, 'No on / near / at: it always lands at the default spot in front of the user.', 'on / near / at が無いので、いつもユーザーの前 (既定の場所) に置かれます。');
    }
    if (place.near && 'thing' in place.near && place.near.thing === thingId) err(`${path}.near`, 'A thing cannot be placed near itself.', '物を自分自身の近くには置けません。');
    checkTarget(`${path}.near`, place.near);
    if (place.at) checkFrame(`${path}.at`, place.at.frame);
    if (place.at?.frame === `thing:${thingId}`) err(`${path}.at`, 'A thing cannot be placed relative to itself.', '物を自分自身からのずれでは置けません。');
    for (const a of place.on?.has ?? []) {
      if (!AFFORDANCES.includes(a)) err(`${path}.on.has`, `Unknown affordance "${a}".`, `できること「${a}」は使えません (${AFFORDANCES.join(' / ')})。`);
    }
    const range = (name: 'distance' | 'height' | 'around') => {
      const r = place[name];
      if (r && (!Array.isArray(r) || r.length !== 2 || !(r[0] <= r[1]))) err(`${path}.${name}`, `${name} must be [min, max].`, `${name} は [最小, 最大] で書きます。`);
    };
    range('distance'); range('height'); range('around');
    if (place.keep === 'forever' && mode !== 'world') warn(`${path}.keep`, '"forever" only applies to things that stay in the world.', '"forever" は world に置く物にだけ効きます。');
    if (depth > 0 && place.fallback?.length) warn(`${path}.fallback`, 'A fallback inside a fallback is ignored.', 'fallback の中の fallback は使われません。');
    (place.fallback ?? []).forEach((f, i) => checkPlacement(`${path}.fallback[${i}]`, f, thingId, depth + 1));
  };
  const checkPanelItems = (path: string, items: PanelItem[], ids: Set<string>) => {
    for (const item of items ?? []) {
      if ((item.type === 'button' || item.type === 'input') && !item.id) err(path, `A ${item.type} needs an id.`, `${item.type} には id が要ります。`);
      const id = (item as { id?: string }).id;
      if (id) {
        if (ids.has(id)) err(path, `Panel item id "${id}" is used twice.`, `パネルの項目の id「${id}」が 2 回使われています。`);
        ids.add(id);
      }
      if (item.type === 'row') checkPanelItems(path, item.items, ids);
    }
  };

  for (const t of project.things ?? []) {
    const at = `things[${t.id}]`;
    checkPlacement(`${at}.place`, t.place, t.id);
    const v = t.visual;
    if (!v) { err(`${at}.visual`, 'Missing visual.', '見た目がありません。'); continue; }
    if ((v.kind === 'model' || v.kind === 'character') && !v.file) err(`${at}.visual.file`, `Pick a ${v.kind === 'model' ? 'model (.glb/.gltf)' : 'VRM'} file.`, `${v.kind === 'model' ? 'モデル (.glb / .gltf)' : 'VRM'} のファイルを選んでください。`);
    if (v.kind === 'panel') checkPanelItems(`${at}.visual.items`, v.items, new Set());
  }

  const checkAction = (path: string, a: Action, allowedFromMind?: Mind) => {
    if (!a || !ACTION_KINDS.includes(a.do)) { err(path, `Unknown action "${(a as { do?: string })?.do}".`, `行動「${(a as { do?: string })?.do}」はありません。`); return; }
    if ('thing' in a && a.thing !== undefined && !things.has(a.thing)) err(path, `No thing "${a.thing}".`, `物「${a.thing}」がありません。`);
    if (a.do === 'ask' && !minds.has(a.mind)) err(path, `No mind "${a.mind}".`, `Mind「${a.mind}」がありません。`);
    if (a.do === 'command') {
      const body = (project.bodies ?? []).find((b) => b.id === a.body);
      if (!body) err(path, `No body "${a.body}".`, `体「${a.body}」がありません。`);
      else if (!body.commands.some((c) => c.name === a.name)) err(path, `Body "${a.body}" has no command "${a.name}".`, `体「${a.body}」に命令「${a.name}」がありません。`);
    }
    if (a.do === 'move') checkTarget(`${path}.to`, a.to);
    if (a.do === 'look') checkTarget(`${path}.at`, a.at);
    if (a.do === 'highlight') checkTarget(`${path}.target`, a.target);
    if (a.do === 'place' && a.place) checkPlacement(`${path}.place`, a.place, a.thing);
    if (allowedFromMind && !(allowedFromMind.output.actions ?? []).includes(a.do)) {
      warn(path, `Mind "${allowedFromMind.id}" may not return "${a.do}".`, `Mind「${allowedFromMind.id}」は「${a.do}」を返せません。`);
    }
  };

  for (const m of project.minds ?? []) {
    const at = `minds[${m.id}]`;
    if (!m.endpoint) err(`${at}.endpoint`, 'Missing endpoint URL.', '接続先 (URL) がありません。');
    else if (!/^https?:\/\//.test(m.endpoint)) err(`${at}.endpoint`, 'The endpoint must start with http:// or https://.', '接続先は http:// か https:// で始めます。');
    if (m.protocol === 'openai-chat' && !m.model) warn(`${at}.model`, 'No model name; the server default is used.', 'モデル名がありません (サーバーの既定を使います)。');
    for (const k of m.output?.actions ?? []) {
      if (!ACTION_KINDS.includes(k)) err(`${at}.output.actions`, `Unknown action "${k}".`, `行動「${k}」はありません。`);
    }
    if (m.run?.on === 'interval' && !(m.run.everyMs && m.run.everyMs >= 200)) err(`${at}.run.everyMs`, 'interval needs everyMs (200 or more).', 'interval には everyMs (200 以上) が要ります。');
    if (m.run?.on === 'event' && !m.run.event) err(`${at}.run.event`, 'event needs an event name.', 'event にはイベントの名前が要ります。');
    if (m.onFail?.use && !minds.has(m.onFail.use)) err(`${at}.onFail.use`, `No mind "${m.onFail.use}".`, `Mind「${m.onFail.use}」がありません。`);
    if (m.onFail?.use === m.id) err(`${at}.onFail.use`, 'A mind cannot fall back to itself.', 'Mind の代わりに自分自身は使えません。');
    if (m.observe?.camera && m.observe.camera.width > 1280) warn(`${at}.observe.camera`, 'Camera images wider than 1280 px are slow to send.', '幅 1280 px を超えるカメラの画は送るのが遅くなります。');
    if (m.where === 'cloud' && m.observe?.camera) warn(`${at}.observe.camera`, 'Camera images go to a cloud service. Tell the user (recording consent / a notice).', 'カメラの画がクラウドに送られます。ユーザーに知らせてください。');
  }

  for (const b of project.bodies ?? []) {
    const at = `bodies[${b.id}]`;
    if (!things.has(b.base?.thing)) err(`${at}.base.thing`, `No thing "${b.base?.thing}" for the body's base.`, `体の根元にする物「${b.base?.thing}」がありません。`);
    if (!b.link?.url || !/^wss?:\/\//.test(b.link.url)) err(`${at}.link.url`, 'The link must be a ws:// or wss:// URL.', '接続先は ws:// か wss:// の URL にします。');
    if (!b.workspace || b.workspace.size.some((n) => !(n > 0))) err(`${at}.workspace`, 'The workspace needs a positive size.', '動ける範囲の大きさが 0 です。');
    const names = new Set<string>();
    for (const c of b.commands ?? []) {
      if (names.has(c.name)) err(`${at}.commands`, `Command "${c.name}" is defined twice.`, `命令「${c.name}」が 2 回あります。`);
      names.add(c.name);
      if (b.link?.protocol === 'rosbridge' && !c.ros) err(`${at}.commands[${c.name}]`, 'rosbridge needs ros.topic and ros.type for every command.', 'rosbridge では命令ごとに ros.topic と ros.type が要ります。');
    }
    if ((b.safety?.stopIfHandWithin ?? 0.25) < 0.1) warn(`${at}.safety`, 'stopIfHandWithin below 0.1 m leaves almost no margin for the user\'s hand.', 'stopIfHandWithin が 0.1 m 未満だと、手との間がほとんどありません。');
  }

  const checkWhen = (path: string, w: When) => {
    if ('select' in w && !things.has(w.select.split('.')[0])) err(path, `No thing "${w.select.split('.')[0]}".`, `物「${w.select.split('.')[0]}」がありません。`);
    if ('gaze' in w && !things.has(w.gaze)) err(path, `No thing "${w.gaze}".`, `物「${w.gaze}」がありません。`);
    if ('mind' in w && !minds.has(w.mind)) err(path, `No mind "${w.mind}".`, `Mind「${w.mind}」がありません。`);
    if ('placed' in w && !things.has(w.placed)) err(path, `No thing "${w.placed}".`, `物「${w.placed}」がありません。`);
    if ('fallback' in w && !things.has(w.fallback)) err(path, `No thing "${w.fallback}".`, `物「${w.fallback}」がありません。`);
    if ('every' in w && !(w.every >= 100)) err(path, 'every must be 100 ms or more.', 'every は 100 ms 以上にします。');
    if ('near' in w) { checkTarget(path, w.to); if (w.near !== 'user' && !things.has(w.near)) err(path, `No thing "${w.near}".`, `物「${w.near}」がありません。`); }
  };
  const checkCondition = (path: string, c: Condition) => {
    if ('not' in c) checkCondition(`${path}.not`, c.not);
  };
  for (const r of project.rules ?? []) {
    const at = `rules[${r.id}]`;
    if (!r.when) err(`${at}.when`, 'A rule needs "when".', '規則には when が要ります。');
    else checkWhen(`${at}.when`, r.when);
    (r.if ?? []).forEach((c, i) => checkCondition(`${at}.if[${i}]`, c));
    if (!Array.isArray(r.do) || r.do.length === 0) warn(`${at}.do`, 'The rule does nothing.', '規則が何もしません。');
    (r.do ?? []).forEach((a, i) => checkAction(`${at}.do[${i}]`, a));
  }

  if (project.recording?.enabled) {
    if (!project.recording.consent?.text?.trim()) err('recording.consent', 'Recording needs a consent text shown to the user.', '記録には、ユーザーに見せる同意の文が要ります。');
    if (project.recording.streams?.includes('camera') && !project.recording.camera) warn('recording.camera', 'Camera recording without camera settings uses 320 px every second.', 'camera の設定が無いので、320 px・1 秒ごとで記録します。');
  }
  if (!project.app?.packageName || !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(project.app.packageName)) {
    err('app.packageName', 'The package name must look like com.example.app.', 'パッケージ名は com.example.app の形にします。');
  }
  if ((project.things ?? []).length === 0) warn('things', 'Nothing to show yet.', 'まだ何も出しません。');
  return out;
}

/** Mind の返事の行動を、その Mind が返してよいものだけにする (ランタイムと同じ規則)。 */
export function filterMindActions(mind: Mind, actions: Action[]): { kept: Action[]; dropped: Action[] } {
  const allowed = new Set(mind.output.actions ?? []);
  const kept: Action[] = [];
  const dropped: Action[] = [];
  for (const a of actions ?? []) (a && allowed.has(a.do) ? kept : dropped).push(a);
  return { kept, dropped };
}
