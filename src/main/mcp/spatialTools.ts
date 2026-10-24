/**
 * Layster.Spatial のプロジェクト (project.spatial.json) を操作する道具 (spatial_*)。
 * MCP サーバーと内蔵エージェントの両方が、tools.ts の ARSIST_TOOLS を通してこれを使う。
 *
 * tools.ts からは型だけを読む (tools.ts がこのファイルを読むので、値を読むと読み込みが輪になる)。
 * 読み書きは SpatialProjectManager を通す (原子的に書く・同じプロジェクトへの書き込みは 1 つずつ・
 * 新しい版のファイルには書かない)。エディタは project.spatial.json の変化を見て読み直す。
 */
import { randomUUID } from 'crypto';
import type { ArsistTool, ToolSession } from './tools';
import {
  createSpatialProjectOnDisk, listProjectSpaces, readSpatialProject, SpatialFormatError, withSpatialWrite,
} from '../layster/SpatialProjectManager';
import { formatLayster } from '../../shared/layster/version';
import { BUILTIN_SPACES } from '../../shared/layster/spatial/spaces';
import { solveAll, worldFromSpace } from '../../shared/layster/spatial/solver';
import { validateSpatialProject, type SpatialProblem } from '../../shared/layster/spatial/validate';
import { ACTION_SHAPES } from '../../shared/layster/spatial/mindProtocol';
import { SPATIAL_SCRIPT_API, SPATIAL_SCRIPT_RULES_TEXT } from '../../shared/layster/spatial/scriptApi';
import { renderScriptApiText } from '../../shared/scriptApi';
import { VOCABULARY } from '../../shared/layster/spatial/vocabulary';
import { ACTION_KINDS, AFFORDANCES } from '../../shared/layster/spatial/types';
import type { SpaceFixture, SpatialProject } from '../../shared/layster/spatial/types';

type Args = Record<string, any>;

const projectPathProp = { projectPath: { type: 'string', description: 'Layster.Spatial project folder (contains project.spatial.json). Optional after arsist_open_project / spatial_create_project.' } };
const schema = (properties: Record<string, any>, required: string[] = []) => ({
  type: 'object',
  properties: { ...projectPathProp, ...properties },
  ...(required.length ? { required } : {}),
});

type ItemKind = 'thing' | 'mind' | 'body' | 'rule' | 'script';
const LIST_KEY: Record<ItemKind, 'things' | 'minds' | 'bodies' | 'rules' | 'scripts'> = {
  thing: 'things', mind: 'minds', body: 'bodies', rule: 'rules', script: 'scripts',
};

function dirOf(session: ToolSession, args: Args): string {
  return session.resolve(args);
}

async function readSpatial(session: ToolSession, args: Args): Promise<{ dir: string; project: SpatialProject; notices: string[] }> {
  const dir = dirOf(session, args);
  try {
    const { project, notices } = await readSpatialProject(dir);
    return { dir, project, notices };
  } catch (e) {
    if (e instanceof SpatialFormatError && e.code === 'notFound') {
      throw new Error(`${e.message}. This is not a Layster.Spatial project; for a Layster.Virtual project (project.json) use the ir_* tools`);
    }
    throw e;
  }
}

/** その項目に関係する問題だけ (path が `<list>[<id>]` で始まるもの)。 */
function problemsFor(project: SpatialProject, kind: ItemKind, id: string): SpatialProblem[] {
  const prefix = `${LIST_KEY[kind]}[${id}]`;
  return validateSpatialProject(project).filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`));
}

function compactProblems(list: SpatialProblem[]) {
  return list.map((p) => `${p.level}: ${p.path}: ${p.message.en}`);
}

function upsertTool(kind: ItemKind, description: string, check: (item: Args) => string | null): ArsistTool {
  return {
    name: `spatial_set_${kind}`,
    description,
    inputSchema: schema({ [kind]: { type: 'object', description: `The whole ${kind} as JSON (replaces the one with the same id, or is added)` } }, [kind]),
    readOnly: false,
    async run(args, session) {
      const item = args[kind];
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`pass "${kind}" as a JSON object`);
      if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(item.id)) throw new Error(`${kind}.id must be letters, digits, "-" and "_"`);
      const bad = check(item);
      if (bad) throw new Error(bad);
      const dir = dirOf(session, args);
      const result = await withSpatialWrite(dir, (project) => {
        const list = project[LIST_KEY[kind]] as Args[];
        const at = list.findIndex((x) => x?.id === item.id);
        if (at >= 0) list[at] = item;
        else list.push(item);
        return { action: at >= 0 ? 'replaced' : 'added', problems: compactProblems(problemsFor(project, kind, item.id)) };
      });
      session.changed = true;
      return { success: true, id: item.id, ...result };
    },
  };
}

function spacesFor(project: SpatialProject, projectSpaces: SpaceFixture[], wanted?: string[]): { spaces: SpaceFixture[]; unknown: string[] } {
  const ids = wanted && wanted.length > 0 ? wanted : project.spaces?.use ?? [];
  const spaces: SpaceFixture[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const s = projectSpaces.find((x) => x.id === id) ?? BUILTIN_SPACES.find((x) => x.id === id);
    if (s) spaces.push(s);
    else unknown.push(id);
  }
  return { spaces, unknown };
}

export function spatialReferenceText(): string {
  const vocab = VOCABULARY.map((w) => `  ${w.word}${w.synonyms.length ? ` (= ${w.synonyms.join(', ')})` : ''}: ${w.has.join(', ') || '-'}`).join('\n');
  return `Layster.Spatial — the space-describing project format (doc/19-layster.md). File: project.spatial.json.
It is NOT compatible with Layster.Virtual (project.json); never convert between them.

COORDINATES
  metres / degrees / seconds; axes x = right, y = up, z = forward (Unity's). yaw is clockwise seen from above (+z turns toward +x).
  Frames: "world" (the user's feet at app start, +z = where they faced), "user" (the user's feet now, head yaw), "head",
  "hand.left" / "hand.right", "thing:<id>", "entity:<id>", "body:<id>". Every offset is { frame, at: [x,y,z], yaw? }.
  You do NOT know the room. Never place things by world coordinates; describe WHERE with conditions and let the solver find the spot.

ENTITIES (the world state: room scan, detected objects, mind beliefs, test spaces)
  { id, is: ["table"], at: [x,y,z] (box centre, world), yaw, size: [w,h,d], has?: affordances, confidence 0..1, seenAt?, source }
  Affordances: ${AFFORDANCES.join(', ')}
  Vocabulary (word (= synonyms): default affordances). "desk" also matches "table"; chair/couch/bed match "seat":
${vocab}

THINGS (what the app shows): { id, name?, visual, place, visibleAtStart?, occlusion?, grabbable?, tags?, ext? }
  visual: { kind: "shape", shape: cube|sphere|cylinder|capsule|quad, size: [w,h,d], color, opacity? }
          { kind: "model", file: "Assets/Models/x.glb", height? }
          { kind: "character", file: "Assets/Characters/x.vrm", animation?, blink?, breathe?, lookAtUser?: off|always|nearby, height? }
          { kind: "panel", size: [w,h] metres, items: [...], ppm? (px per metre, default 1000 → 1 px = 1 mm), background?, padding? }
             items: { type: "text", id?, text, size? (px), color?, align?, bind? (store key), reveal? (chars/s) }
                    { type: "button", id, text, size?, color?, background?, event? }  → fires "<thing id>.<item id>" (or event)
                    { type: "input", id, bind, placeholder? }  { type: "image", file, height }  { type: "row", items, gap? }  { type: "space", height }
          { kind: "label", text, height? (m, default 0.04), color? }   { kind: "marker" } (invisible reference point)
  place (Placement) — conditions, tried in order with fallbacks; something is ALWAYS placed (last resort: in front of the user):
    mode: world (default, stays) | body (follows the user lazily) | head (locked to view; use "at" in frame "head") | hand
    on: { is?: [...words], has?: [...affordances], minSize?: [w,d], within?: metres, minConfidence? }  — on top of (or on the face of a wall)
    near: { thing } | { entity: query } | { frame, at? } | { user: head|feet|hand.left|hand.right }   around: [min,max] ring radius
    at: { frame, at, yaw? }  — used when there is no on/near (or for head/hand modes)
    distance: [min,max] horizontal metres from the user · height: [min,max] metres of the thing's bottom above the floor
    facing: user (default) | away | surface | keep · visible: true | half-angle deg · clearance: [w,d] free area on the host
    avoid: [thing ids or words] (≥ 0.3 m apart) · prefer: closest (default) | farthest | largest | center | inView
    fallback: [Placement, ...] · keep: none | session (default) | forever (spatial anchor, same spot next launch)
  Good default for a panel: { on: { has: ["support"] }, distance: [0.3, 1.8], height: [0.4, 1.3], fallback: [{ at: { frame: "user", at: [0, 1.1, 0.9] } }] }.
  Check placements with spatial_solve: it runs the same solver as the device in several different rooms.

ACTIONS (one vocabulary for rules, minds and scripts): ${ACTION_KINDS.join(', ')}
${ACTION_KINDS.map((k) => `  ${ACTION_SHAPES[k]}`).join('\n')}
  Targets: { thing } | { entity: query } | { frame, at? } | { user: head|feet|hand.left|hand.right }

RULES: { id, when, if?: [conditions], do: [actions], cooldownMs?, enabled? }
  when: { start: true } | { every: ms } | { select: "<thing>.<item>" } | { gaze: thing, seconds? } | { near: thing|"user", to: target, within }
        | { seen: query } | { lost: query } | { event: name } | { mind: id } | { placed: thing } | { fallback: thing }
  if: { store: key, eq?|ne?|gt?|lt?|exists? } | { has: query } | { not: condition }

MINDS (AI: world models, VLAs, decision models, LLMs/VLMs):
  { id, role: decide|converse|perceive|predict|act, where: device|edge|cloud, protocol: layster|openai-chat, endpoint (http; "{edge}" = the PC address
    kept on the device, "{edge-host}" = its host), model?, auth?: { secret: "<key name>", header?, scheme? }, instructions?,
    observe: { frame?, world?: { is?, within?, max?, minConfidence? }, things?, user?: [head|hands|gaze], camera?: { width }, events?, store? },
    output: { actions?: [allowed kinds], beliefs?: bool, text?: store key }, run: { on: interval|change|event|manual, everyMs?, event?, minGapMs?, timeoutMs? },
    extra? (merged into the request, e.g. { "reasoning_effort": "none" } for thinking models), onFail?: { use?: mind id, say? } }
  layster protocol: POST { protocol: "layster.mind/1", mind, tick, time, frame, world: [entities], things, user, camera?, events, store, actions: [allowed], goal }
                    reply { actions?: [...], beliefs?: [entities], text?, nextInMs? }. Beliefs enter the world state as source "mind:<id>".
  openai-chat: the observation is sent as JSON text (+ the camera image); the reply's JSON object is read as above.
  Keys never go into the project: name them in auth.secret; the value lives in .layster/secrets.local.json (set in the editor).
  Only actions listed in output.actions are executed.

BODIES (physical AI: robot arms, mobile robots, devices):
  { id, kind: arm|mobile|humanoid|device|other, link: { protocol: layster-body|rosbridge, url: "ws://{edge-host}:8766" }, base: { thing: <marker thing> },
    workspace: { center: [x,y,z], size: [w,h,d] } (body frame), commands: [{ name, description?, args?: { name: number|string|boolean|pose|target }, confirm?: never|always, ros?: { topic, type } }],
    safety?: { stopIfHandWithin? (m, default 0.25), maxPerSecond? (default 2) }, twin?: { showWorkspace? }, store? }
  SAFETY GATE (every command): outside the workspace → not sent; the user's hand within stopIfHandWithin of the target → not sent;
  confirm: "always" → the user approves in the headset first; rate limited. Blocked commands fire "body:<id>:blocked".

RECORDING: { enabled, streams: [pose|hands|world|events|actions|minds|camera], hz?, camera?: { width, everyMs }, maxMinutes?, consent: { text }, send?: { url } }
  Nothing is recorded until the user accepts the consent text. Format layster.episode/1 (episode.jsonl lines { t, kind, data }).

SCRIPTS: { id, name, trigger: { type: onStart|onUpdate|interval|event, value? }, code, enabled }
${renderScriptApiText(SPATIAL_SCRIPT_API)}
${SPATIAL_SCRIPT_RULES_TEXT}

WORKFLOW: spatial_get_project → spatial_set_thing / _mind / _rule … → spatial_solve (does it land well in every room?) → spatial_validate → build in the editor.`;
}

export const SPATIAL_TOOLS: ArsistTool[] = [
  {
    name: 'spatial_reference',
    description: 'How Layster.Spatial projects work: coordinates and frames, the entity vocabulary and affordances, placement conditions, the action vocabulary, minds (AI) and their protocol, bodies (robots) and the safety gate, recording, rules and the world.* script API. Read this before editing a Layster.Spatial project.',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    async run() {
      return spatialReferenceText();
    },
  },
  {
    name: 'spatial_create_project',
    description: 'Create a new Layster.Spatial project (a space-describing MR app: things placed by conditions in any room, AI minds, robot bodies) in <parentDir>/<name>, and open it for later calls.',
    inputSchema: {
      type: 'object',
      properties: {
        parentDir: { type: 'string', description: 'Folder to create the project folder in' },
        name: { type: 'string' },
        targetDevice: { type: 'string', description: 'Device to build for (Adapters/ folder name, e.g. Meta_Quest, XREAL_One, Android_Phone). Default Meta_Quest' },
      },
      required: ['parentDir', 'name'],
    },
    readOnly: false,
    async run(args, session) {
      const { project, path: dir } = await createSpatialProjectOnDisk(
        { parentDir: String(args.parentDir), name: String(args.name), targetDevice: String(args.targetDevice || 'Meta_Quest') },
        randomUUID(),
      );
      session.projectPath = dir;
      session.changed = true;
      return { created: dir, name: project.name, format: formatLayster(project.layster), next: 'call spatial_reference, then spatial_set_thing' };
    },
  },
  {
    name: 'spatial_get_project',
    description: 'Summary of a Layster.Spatial project: format, device, every thing (with how it is placed), mind, body, rule, script, the test spaces and the number of problems.',
    inputSchema: schema({}),
    readOnly: true,
    async run(args, session) {
      const { dir, project, notices } = await readSpatial(session, args);
      const problems = validateSpatialProject(project);
      return {
        path: dir,
        format: formatLayster(project.layster),
        name: project.name,
        targetDevice: project.targetDevice,
        app: project.app,
        presentation: project.presentation,
        interaction: project.interaction,
        things: project.things.map((t) => ({
          id: t.id, kind: t.visual?.kind,
          place: t.place?.mode && t.place.mode !== 'world' ? t.place.mode
            : t.place?.on ? `on ${JSON.stringify(t.place.on)}` : t.place?.near ? `near ${JSON.stringify(t.place.near)}` : t.place?.at ? `at ${t.place.at.frame}` : '?',
          fallbacks: t.place?.fallback?.length ?? 0,
        })),
        minds: project.minds.map((m) => ({ id: m.id, role: m.role, where: m.where, protocol: m.protocol, run: m.run?.on, actions: m.output?.actions ?? [] })),
        bodies: project.bodies.map((b) => ({ id: b.id, kind: b.kind, protocol: b.link?.protocol, commands: (b.commands ?? []).map((c) => c.name) })),
        rules: project.rules.map((r) => ({ id: r.id, when: Object.keys(r.when ?? {})[0], actions: (r.do ?? []).map((a) => a.do), enabled: r.enabled !== false })),
        scripts: project.scripts.map((s) => ({ id: s.id, name: s.name, trigger: s.trigger, enabled: s.enabled })),
        memory: project.memory,
        recording: { enabled: project.recording?.enabled, streams: project.recording?.streams },
        spaces: project.spaces?.use ?? [],
        extensions: Object.entries(project.extensions ?? {}).filter(([, st]) => st?.enabled).map(([id]) => id),
        problems: { errors: problems.filter((p) => p.level === 'error').length, warnings: problems.filter((p) => p.level === 'warning').length },
        ...(notices.length ? { notices } : {}),
      };
    },
  },
  {
    name: 'spatial_get',
    description: 'One item of a Layster.Spatial project as full JSON: kind thing | mind | body | rule | script (by id), or "settings" (app, presentation, interaction, recording, memory, spaces, targetDevice).',
    inputSchema: schema({ kind: { type: 'string', enum: ['thing', 'mind', 'body', 'rule', 'script', 'settings'] }, id: { type: 'string' } }, ['kind']),
    readOnly: true,
    async run(args, session) {
      const { project } = await readSpatial(session, args);
      if (args.kind === 'settings') {
        const { app, presentation, interaction, recording, memory, spaces, targetDevice, name, version } = project;
        return { name, version, targetDevice, app, presentation, interaction, recording, memory, spaces };
      }
      const key = LIST_KEY[args.kind as ItemKind];
      if (!key) throw new Error(`unknown kind: ${args.kind}`);
      const item = (project[key] as Args[]).find((x) => x?.id === args.id);
      if (!item) throw new Error(`${args.kind} not found: ${args.id} (have: ${(project[key] as Args[]).map((x) => x?.id).join(', ') || 'none'})`);
      return item;
    },
  },
  upsertTool('thing',
    'Add or replace a thing (something the app shows: panel, label, character, model, shape, marker). Describe WHERE with conditions in "place" (on a table, near the user, visible, distance range) plus fallbacks — never raw world coordinates, the room is unknown. See spatial_reference; check with spatial_solve.',
    (t) => (!t.visual || typeof t.visual !== 'object' ? 'thing.visual is required' : !t.place || typeof t.place !== 'object' ? 'thing.place is required' : null)),
  upsertTool('mind',
    'Add or replace a mind (an AI connected to the space: world model, VLA, decision model, LLM/VLM) — what it observes, which actions it may return, where it runs and how often. Keys go in auth.secret by name only.',
    (m) => (!m.endpoint ? 'mind.endpoint is required' : !m.observe || !m.output || !m.run ? 'mind.observe, mind.output and mind.run are required' : null)),
  upsertTool('body',
    'Add or replace a body (a physical robot or device): its link, the marker thing that is its base, its workspace box, commands and safety settings. Every command passes the safety gate.',
    (b) => (!b.link || !b.base || !b.workspace ? 'body.link, body.base and body.workspace are required' : null)),
  upsertTool('rule',
    'Add or replace a rule: when (a trigger) → if (conditions) → do (actions). Prefer rules to scripts for simple behaviour.',
    (r) => (!r.when ? 'rule.when is required' : !Array.isArray(r.do) ? 'rule.do must be an array of actions' : null)),
  upsertTool('script',
    'Add or replace a JavaScript script (world.* plus log/store/ui/audio/api/model…). Use it for logic rules and minds cannot express.',
    (s) => (typeof s.code !== 'string' ? 'script.code must be a string' : !s.trigger ? 'script.trigger is required' : null)),
  {
    name: 'spatial_remove',
    description: 'Remove a thing, mind, body, rule or script by id. Returns the problems this leaves (e.g. rules that still name it).',
    inputSchema: schema({ kind: { type: 'string', enum: ['thing', 'mind', 'body', 'rule', 'script'] }, id: { type: 'string' } }, ['kind', 'id']),
    readOnly: false,
    async run(args, session) {
      const key = LIST_KEY[args.kind as ItemKind];
      if (!key) throw new Error(`unknown kind: ${args.kind}`);
      const result = await withSpatialWrite(dirOf(session, args), (project) => {
        const list = project[key] as Args[];
        const at = list.findIndex((x) => x?.id === args.id);
        if (at < 0) throw new Error(`${args.kind} not found: ${args.id}`);
        list.splice(at, 1);
        return { problems: compactProblems(validateSpatialProject(project).filter((p) => p.level === 'error')) };
      });
      session.changed = true;
      return { success: true, removed: `${args.kind}:${args.id}`, ...result };
    },
  },
  {
    name: 'spatial_set_settings',
    description: 'Change project settings. Each given object is merged into the current one: app (packageName, versionCode, minSdkVersion, targetSdkVersion, edge = default PC address "host:port"), presentation (reality: passthrough | virtual-room, assumedEyeHeight), interaction (controllers, hands, gazeDwellSeconds), recording, memory ({ persist: [store keys, "memory." = prefix] }), spaces ({ use: [space ids] }); targetDevice, name and version are replaced.',
    inputSchema: schema({
      app: { type: 'object' }, presentation: { type: 'object' }, interaction: { type: 'object' }, recording: { type: 'object' },
      memory: { type: 'object' }, spaces: { type: 'object' }, targetDevice: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' },
    }),
    readOnly: false,
    async run(args, session) {
      const changed: string[] = [];
      const problems = await withSpatialWrite(dirOf(session, args), (project) => {
        const p = project as unknown as Args;
        for (const key of ['app', 'presentation', 'interaction', 'recording', 'memory', 'spaces']) {
          if (args[key] && typeof args[key] === 'object') {
            p[key] = { ...(p[key] ?? {}), ...args[key] };
            changed.push(key);
          }
        }
        for (const key of ['targetDevice', 'name', 'version']) {
          if (typeof args[key] === 'string' && args[key]) { p[key] = args[key]; changed.push(key); }
        }
        return compactProblems(validateSpatialProject(project).filter((x) => x.level === 'error'));
      });
      session.changed = changed.length > 0;
      return { success: true, changed, problems };
    },
  },
  {
    name: 'spatial_validate',
    description: 'Check a Layster.Spatial project: broken references, invalid placements, minds without endpoints, bodies without a base, unsafe settings, recording without consent text. Errors stop the build.',
    inputSchema: schema({}),
    readOnly: true,
    async run(args, session) {
      const { project, notices } = await readSpatial(session, args);
      const problems = validateSpatialProject(project);
      return {
        ok: !problems.some((p) => p.level === 'error'),
        errors: compactProblems(problems.filter((p) => p.level === 'error')),
        warnings: compactProblems(problems.filter((p) => p.level === 'warning')),
        ...(notices.length ? { notices } : {}),
      };
    },
  },
  {
    name: 'spatial_solve',
    description: 'Run the placement solver (the same one the device runs) for every thing in several test rooms (the project\'s spaces, or the ones you name) and report where each thing lands: which rule placed it (0 = its own, 1.. = a fallback, "default" = none fit, in front of the user), on what, and why other rules failed. Use it to make a placement work in any room.',
    inputSchema: schema({
      spaces: { type: 'array', items: { type: 'string' }, description: 'Space ids (see spatial_list_spaces). Default: the project\'s spaces.use' },
      things: { type: 'array', items: { type: 'string' }, description: 'Only report these thing ids' },
    }),
    readOnly: true,
    async run(args, session) {
      const { dir, project } = await readSpatial(session, args);
      const { spaces, unknown } = spacesFor(project, await listProjectSpaces(dir), args.spaces);
      const only: string[] | undefined = Array.isArray(args.things) && args.things.length ? args.things : undefined;
      const rows: Args[] = [];
      const summary: Record<string, { own: number; fallback: number; default: number }> = {};
      for (const space of spaces) {
        for (const r of solveAll(project.things, worldFromSpace(space))) {
          if (only && !only.includes(r.thing)) continue;
          const s = (summary[r.thing] ??= { own: 0, fallback: 0, default: 0 });
          if (r.rule === 0) s.own++; else if (r.rule === 'default') s.default++; else s.fallback++;
          rows.push({
            space: space.id, thing: r.thing, rule: r.rule, host: r.host ?? null, frame: r.frame, at: r.pose.at, yaw: r.pose.yaw,
            ...(r.notes.length ? { notes: r.notes } : {}),
          });
        }
      }
      return {
        spaces: spaces.map((s) => s.id),
        ...(unknown.length ? { unknownSpaces: unknown } : {}),
        summary,
        results: rows,
        legend: 'rule 0 = placed by its own conditions; 1.. = by that fallback; "default" = nothing fit (in front of the user). at = [x right, y up, z forward] metres in the world frame (user at the origin facing +z).',
      };
    },
  },
  {
    name: 'spatial_list_spaces',
    description: 'Test spaces (rooms) the solver can use: built-in ones (studio, desk-front, living, classroom, open-floor, tiny, no-scan) and the project\'s spaces/*.json, with what each contains.',
    inputSchema: schema({}),
    readOnly: true,
    async run(args, session) {
      let projectSpaces: SpaceFixture[] = [];
      let used: string[] = [];
      try {
        const { dir, project } = await readSpatial(session, args);
        projectSpaces = await listProjectSpaces(dir);
        used = project.spaces?.use ?? [];
      } catch {
        // プロジェクトが無くても組み込みの空間は見せる
      }
      const describe = (s: SpaceFixture, origin: string) => ({
        id: s.id, origin, used: used.includes(s.id), name: s.name.en, description: s.description?.en,
        eyeHeight: s.user.eyeHeight, knows: s.knows,
        entities: s.entities.map((e) => `${e.id}: ${e.is.join('/')}`),
      });
      return [...BUILTIN_SPACES.map((s) => describe(s, 'builtin')), ...projectSpaces.map((s) => describe(s, 'project'))];
    },
  },
];
