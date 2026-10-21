/**
 * キャラクターの動きの名前の食い違いを、ビルドの前に見つける。
 *
 * 動きは Assets/Animations/<名前>.fbx。名前を間違えても実機では「動かない」だけで何も言わないので、
 * ここで物の character.animation と、スクリプトに書かれた vrm.playAnimation('名前') を突き合わせる。
 * MCP の ir_validate_project とビルド (UnityBuilder) のログが使う。
 */
import type { ArsistProject, SceneObject } from './types';

function allObjects(project: Pick<ArsistProject, 'scenes'>): SceneObject[] {
  const out: SceneObject[] = [];
  const visit = (objects: SceneObject[] | undefined) => {
    for (const obj of objects ?? []) {
      out.push(obj);
      visit(obj.children);
    }
  };
  for (const scene of project.scenes ?? []) visit(scene.objects);
  return out;
}

/**
 * スクリプトに文字列で書かれた動きの名前: vrm.playAnimation(id, 'Name', { then: 'Name' }) と
 * vrm.walkTo(…, { walk: 'Name', idle: 'Name' })。オプションはその呼び出しの中だけを見る
 * (よその { idle: '…' } を動きの名前と取り違えないように)。
 */
export function animationNamesInScripts(code: string): string[] {
  const names = new Set<string>();
  const call = /\bvrm\s*\.\s*(playAnimation|walkTo)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(code))) {
    // 呼び出しの閉じかっこまで (かっこの深さを数える。文字列の中のかっこは気にしない程度の簡易さ)
    let depth = 1;
    let end = call.lastIndex;
    while (end < code.length && depth > 0) {
      const c = code[end++];
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    const args = code.slice(call.lastIndex, end - 1);
    if (m[1] === 'playAnimation') {
      const name = /^[^,]+,\s*(['"])([^'"]+)\1/.exec(args);
      if (name) names.add(name[2]);
    }
    const option = m[1] === 'playAnimation' ? /\bthen\s*:\s*(['"])([^'"]+)\1/g : /\b(?:walk|idle)\s*:\s*(['"])([^'"]+)\1/g;
    let o: RegExpExecArray | null;
    // then: 'stand' は FBX ではなく「力を抜いた立ち姿に戻る」(ArsistCharacter.StandName)
    while ((o = option.exec(args))) if (!(m[1] === 'playAnimation' && o[2] === 'stand')) names.add(o[2]);
  }
  return [...names];
}

export function characterAnimationIssues(
  project: Pick<ArsistProject, 'scenes' | 'scripts'>,
  available: readonly string[],
): string[] {
  const known = new Set(available);
  const issues: string[] = [];
  const list = available.length ? available.join(', ') : 'none — import humanoid FBX files into Assets/Animations';
  for (const obj of allObjects(project)) {
    const name = obj.type === 'vrm' ? obj.character?.animation : undefined;
    if (name && !known.has(name)) issues.push(`"${obj.name}" starts with animation "${name}", which is not in Assets/Animations (have: ${list})`);
  }
  for (const script of project.scripts ?? []) {
    if (!script.enabled) continue;
    const code = script.code ?? '';
    // ビルドが渡す scripts.json には名前が無い (id だけ)
    const label = script.name ?? script.id;
    for (const name of animationNamesInScripts(code)) {
      if (!known.has(name)) issues.push(`script "${label}" uses animation "${name}", which is not in Assets/Animations (have: ${list})`);
    }
    if (/\bvrm\s*\.\s*walkTo\s*\(/.test(code) && !/\bwalk\s*:/.test(code) && !known.has('Walk')) {
      issues.push(`script "${label}" calls vrm.walkTo without a "Walk" animation: the character will glide (import one named Walk, downloaded "In Place")`);
    }
  }
  return issues;
}
