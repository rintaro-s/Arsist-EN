/**
 * Layster.Spatial — 新しいプロジェクトと、足すときのひな形。
 *
 * エディタの「追加」ボタン・エージェントの道具・新規作成が同じひな形を使う
 * (画面ごとに既定値がずれると、エージェントが作ったものと人が作ったものの見た目が変わる)。
 */

import { LAYSTER_CURRENT } from '../version';
import { DEFAULT_SPACE_IDS } from './spaces';
import type {
  Body, Mind, MindProtocol, MindRole, Recording, Rule, SpatialProject, SpatialScript, Thing, ThingVisual,
} from './types';

export interface CreateSpatialOptions {
  id: string;
  name: string;
  targetDevice: string;
  now?: string;
}

export function packageNameFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `com.layster.${slug || 'app'}`;
}

export const DEFAULT_RECORDING: Recording = {
  enabled: false,
  streams: ['pose', 'hands', 'world', 'events', 'actions', 'minds'],
  hz: 10,
  consent: {
    text: 'この体験の動き (頭と手の位置・部屋の形・操作) を記録します。カメラの画は記録しません。よろしいですか？',
  },
};

/** 新しい Spatial のプロジェクト。最初から「机の上に札が 1 枚」ある (何も無いと、何をすればいいか分からない)。 */
export function createSpatialProject(options: CreateSpatialOptions): SpatialProject {
  const now = options.now ?? new Date().toISOString();
  const isQuest = /quest|meta/i.test(options.targetDevice);
  return {
    layster: { ...LAYSTER_CURRENT.spatial, profile: 'spatial' },
    id: options.id,
    name: options.name,
    version: '1.0.0',
    createdAt: now,
    updatedAt: now,
    targetDevice: options.targetDevice,
    app: {
      packageName: packageNameFor(options.name),
      versionCode: 1,
      minSdkVersion: isQuest ? 32 : 29,
      // Unity 同梱の Android SDK が持っている版 (ProjectManager.createProject と同じ理由)
      targetSdkVersion: 34,
    },
    presentation: { reality: 'passthrough', assumedEyeHeight: 1.5 },
    interaction: { controllers: true, hands: true, gazeDwellSeconds: 0 },
    things: [newThing('panel', 'hello')],
    minds: [],
    bodies: [],
    rules: [],
    scripts: [],
    memory: { persist: [] },
    recording: { ...DEFAULT_RECORDING, streams: [...DEFAULT_RECORDING.streams], consent: { ...DEFAULT_RECORDING.consent } },
    spaces: { use: [...DEFAULT_SPACE_IDS] },
    models: [],
    extensions: {},
  };
}

export type ThingTemplate = 'panel' | 'label' | 'shape' | 'model' | 'character' | 'marker' | 'hud';

/** 物のひな形。置き方は「よくある、どこでも解ける」形にしてある。 */
export function newThing(template: ThingTemplate, id: string): Thing {
  const visual: Record<ThingTemplate, ThingVisual> = {
    panel: {
      kind: 'panel', size: [0.4, 0.25], background: '#1E1E28E6', padding: 24,
      items: [
        { type: 'text', id: 'title', text: 'Hello, space', size: 40, align: 'center' },
        { type: 'button', id: 'ok', text: 'OK', size: 32 },
      ],
    },
    hud: {
      kind: 'panel', size: [0.5, 0.08], background: '#00000099', padding: 12,
      items: [{ type: 'text', id: 'status', text: '', size: 30, align: 'center' }],
    },
    label: { kind: 'label', text: 'Label', height: 0.04, color: '#FFFFFF' },
    shape: { kind: 'shape', shape: 'cube', size: [0.1, 0.1, 0.1], color: '#4EC9B0' },
    model: { kind: 'model', file: '', height: 0.3 },
    character: { kind: 'character', file: '', blink: true, breathe: true, lookAtUser: 'nearby', height: 1.5 },
    marker: { kind: 'marker' },
  };
  const place: Record<ThingTemplate, Thing['place']> = {
    // 机の上 → 何かの上 → 目の前
    panel: {
      on: { has: ['support'] }, distance: [0.3, 1.8], height: [0.4, 1.3], facing: 'user', prefer: 'closest',
      fallback: [{ at: { frame: 'user', at: [0, 1.1, 0.9] }, facing: 'user' }],
    },
    hud: { mode: 'head', at: { frame: 'head', at: [0, -0.28, 1.5] } },
    label: { near: { user: 'head' }, around: [1.0, 1.0], visible: true, facing: 'user' },
    shape: {
      on: { has: ['support'] }, distance: [0.3, 1.5], height: [0.4, 1.3],
      fallback: [{ at: { frame: 'user', at: [0, 1.0, 0.8] } }],
    },
    model: {
      on: { has: ['support'] }, distance: [0.3, 2.0],
      fallback: [{ at: { frame: 'user', at: [0, 1.0, 1.0] } }],
    },
    // キャラクターは床の上、ユーザーの斜め前 (真正面は視界を塞ぐ)
    character: {
      near: { user: 'feet' }, around: [1.0, 1.8], facing: 'user', prefer: 'inView',
      fallback: [{ near: { user: 'feet' }, around: [0.8, 2.5] }],
    },
    marker: { at: { frame: 'user', at: [0, 0, 1.0] } },
  };
  return { id, name: id, visual: visual[template], place: place[template] };
}

/** Mind のひな形。PC の Ollama につなぐ形が一番よく使うので既定。 */
export function newMind(id: string, protocol: MindProtocol = 'openai-chat', role: MindRole = 'decide'): Mind {
  if (protocol === 'layster') {
    return {
      id, role, where: 'edge', protocol: 'layster',
      endpoint: 'http://{edge}/mind',
      instructions: '',
      observe: { frame: 'user', world: { within: 4, max: 40 }, things: true, user: ['head', 'hands'], events: 10 },
      output: { actions: ['say', 'highlight', 'place', 'believe'], beliefs: true },
      run: { on: 'interval', everyMs: 2000, minGapMs: 500, timeoutMs: 5000 },
    };
  }
  return {
    id, role, where: 'edge', protocol: 'openai-chat',
    endpoint: 'http://{edge}/v1/chat/completions',
    model: 'qwen3.5:9b',
    instructions: 'You are a helpful presence in the user\'s room. Reply briefly.',
    observe: { frame: 'user', world: { within: 3, max: 20 }, things: true, user: ['head'], events: 5 },
    output: { actions: ['say', 'highlight'], beliefs: false },
    run: { on: 'manual', minGapMs: 1000, timeoutMs: 15000 },
    // 考えを書いてから答えるモデル (Qwen3 系) は、考えだけで上限を使い切って空を返すことがある
    extra: { reasoning_effort: 'none' },
  };
}

export function newBody(id: string, baseThing: string): Body {
  return {
    id, kind: 'arm',
    link: { protocol: 'layster-body', url: 'ws://{edge-host}:8766' },
    base: { thing: baseThing },
    workspace: { center: [0, 0.15, 0.2], size: [0.5, 0.4, 0.4] },
    commands: [
      { name: 'home', description: 'Move to the rest pose', confirm: 'never' },
      { name: 'pick', description: 'Pick up what is at the target', args: { target: 'target' }, confirm: 'always' },
      { name: 'stop', description: 'Stop now', confirm: 'never' },
    ],
    safety: { stopIfHandWithin: 0.25, maxPerSecond: 2 },
    twin: { showWorkspace: true },
  };
}

export function newRule(id: string): Rule {
  return { id, when: { start: true }, do: [], enabled: true };
}

export function newScript(id: string, name: string): SpatialScript {
  return {
    id, name, enabled: true,
    trigger: { type: 'onStart' },
    code: `// world.find({ is: ['table'] }) / world.user() / world.act({ do: 'say', text: '…' })\nlog('started');\n`,
  };
}

/** 足りない項目を補う (壊れた・古い・エージェントが途中まで書いたファイルを開けるように)。何を補ったかを返す。 */
export function repairSpatialProject(raw: Record<string, any>): string[] {
  const fixed: string[] = [];
  const ensureArray = (key: string) => {
    if (!Array.isArray(raw[key])) { raw[key] = []; fixed.push(key); }
  };
  for (const key of ['things', 'minds', 'bodies', 'rules', 'scripts', 'models']) ensureArray(key);
  if (!raw.extensions || typeof raw.extensions !== 'object' || Array.isArray(raw.extensions)) { raw.extensions = {}; fixed.push('extensions'); }
  if (!raw.memory || !Array.isArray(raw.memory.persist)) { raw.memory = { persist: [] }; fixed.push('memory'); }
  if (!raw.spaces || !Array.isArray(raw.spaces.use)) { raw.spaces = { use: [...DEFAULT_SPACE_IDS] }; fixed.push('spaces'); }
  if (!raw.recording || typeof raw.recording !== 'object') { raw.recording = { ...DEFAULT_RECORDING }; fixed.push('recording'); }
  if (!raw.presentation || typeof raw.presentation !== 'object') { raw.presentation = { reality: 'passthrough' }; fixed.push('presentation'); }
  if (!raw.interaction || typeof raw.interaction !== 'object') { raw.interaction = { controllers: true, hands: true }; fixed.push('interaction'); }
  if (!raw.app || typeof raw.app !== 'object') {
    raw.app = { packageName: packageNameFor(String(raw.name ?? 'app')), versionCode: 1, minSdkVersion: 29, targetSdkVersion: 34 };
    fixed.push('app');
  }
  for (const t of raw.things as any[]) {
    if (t && typeof t === 'object' && (!t.place || typeof t.place !== 'object')) {
      t.place = { at: { frame: 'user', at: [0, 1.1, 1.0] } };
      fixed.push(`things.${t.id}.place`);
    }
  }
  return fixed;
}
