/**
 * Layster.Spatial のスクリプトで使える名前の一覧。**ここが唯一の元** (Virtual の src/shared/scriptApi.ts と同じ役目)。
 *
 * 読む側: Spatial のエディタのスクリプトの早見表、エージェントの spatial_reference。
 * 中身は Runtime/Spatial/Unity/WorldWrapper.cs (world) と、Virtual と共有のラッパー (log / store / audio …)。
 * WorldWrapper にメソッドを足したら、ここにも足す。
 */

import { ENGINE_SCRIPT_API, type ScriptApiSection } from '../../scriptApi';

/** Virtual と同じものがそのまま使える名前。scene / vrm / viewer / perception / remote は Spatial では使わない (world で書く)。 */
const SHARED = ['log', 'timers', 'store', 'storage', 'ui', 'audio', 'camera', 'api', 'model'];

export const WORLD_SCRIPT_API: ScriptApiSection = {
  name: 'world',
  color: '#4ec9b0',
  en: 'The space — entities (room, found objects, beliefs), the user, your things, minds, bodies, recording',
  ja: '空間 — entity (部屋・見つけた物・推測)、ユーザー、アプリの物、Mind、体、記録',
  entries: [
    { sig: 'world.find({ is: ["table"], within: 2 })', en: 'The nearest entity matching the query, or null. Positions are in world (metres, x right / y up / z forward)', ja: '条件に合う一番近い entity (無ければ null)。位置は world (m、x 右・y 上・z 前)' },
    { sig: 'world.entities({ has: ["support"] })', en: 'Every matching entity (array). world.entities() = all', ja: '条件に合う entity すべて (配列)。world.entities() で全部' },
    { sig: 'world.get(id)', en: 'One entity by id, or null', ja: 'id で entity を 1 つ (無ければ null)' },
    { sig: 'world.believe({ id, is, at, size, confidence })', en: 'Add or update an entity (source "script"). Its confidence fades over time unless seen again', ja: 'entity を足す・更新する (出どころ "script")。また見なければ確かさは時間で下がる' },
    { sig: 'world.forget(id)', en: 'Remove an entity', ja: 'entity を消す' },
    { sig: 'world.user()', en: '{ head: { at, forward }, feet, yaw, hands: { left, right }, gaze: { thing, entity, point } }', ja: '{ head: { at, forward }, feet, yaw, hands: { left, right }, gaze: { thing, entity, point } }' },
    { sig: 'world.thing(id)', en: '{ at, yaw, placed, visible, rule, host } — where a thing is and which placement rule placed it', ja: '{ at, yaw, placed, visible, rule, host } — 物の場所と、どの置き方で置かれたか' },
    { sig: 'world.place(id) / world.place(id, { on: { is: ["wall"] } })', en: 'Solve the thing\'s placement again (optionally with another placement). Returns the result', ja: '物の置き場所を解き直す (別の置き方も渡せる)。結果を返す' },
    { sig: 'world.act({ do: "say", thing: "buddy", text: "Hi" })', en: 'Run an action (or an array of actions) — the same vocabulary as rules and minds', ja: '行動を 1 つ (配列なら順に) 実行する。規則・Mind と同じ語彙' },
    { sig: 'world.ask("helper", { text: "…" }, function (reply) { … })', en: 'Run a mind now. reply = { actions, beliefs, text, ok, error }. Its allowed actions run automatically', ja: 'Mind を今すぐ走らせる。reply = { actions, beliefs, text, ok, error }。許された行動は自動で実行される' },
    { sig: 'world.on("placed", function (e) { … })', en: 'Listen: "placed" "fallback" "seen" "lost" "mind" "select" "blocked" "action:<custom>" "body:<id>"', ja: '受ける: "placed" "fallback" "seen" "lost" "mind" "select" "blocked" "action:<名前>" "body:<id>"' },
    { sig: 'world.command("arm", "pick", { target: { thing: "cup-marker" } }, function (r) { … })', en: 'Send a command to a body through the safety gate. r = { ok, blocked, reason }', ja: '体に命令する (安全の門を通る)。r = { ok, blocked, reason }' },
    { sig: 'world.snapshot("user")', en: 'The observation a mind would get, as an object (frame: "user" / "world" / …)', ja: 'Mind が受け取るのと同じ観測をオブジェクトで (frame は "user" / "world" …)' },
    { sig: 'world.record.start() / stop() / mark("label") / active()', en: 'Recording (asks for consent first; see the project\'s recording settings)', ja: '記録 (先に同意を聞く。プロジェクトの記録の設定に従う)' },
    { sig: 'world.edge() / world.setEdge("192.168.0.23:8000")', en: 'The PC address that {edge} in minds/bodies points to (kept on the device)', ja: 'Mind・体の {edge} が指す PC のアドレス (端末に残る)' },
  ],
};

export const SPATIAL_SCRIPT_API: ScriptApiSection[] = [
  WORLD_SCRIPT_API,
  ...ENGINE_SCRIPT_API.filter((s) => SHARED.includes(s.name)),
];

export const SPATIAL_SCRIPT_RULES_TEXT = `Spatial scripts:
- Prefer placements, rules and minds in the project; use a script for logic they cannot express.
- Positions are metres in the "world" frame (origin = the user's feet at start, +z = where they faced). Never assume a room size.
- An entity may vanish or move (confidence, seenAt). Check for null from world.find.
- Panel buttons fire "<thing id>.<item id>" (also world.on("select")). ui.setText("<thing id>.<item id>", text) changes panel text.`;
