/**
 * 拡張機能が置き換えられるエンジンの部品。
 *
 * エンジンのファイルを丸ごと差し替える unity.overrides は、エンジンが更新されるたびに直しが要る
 * (元のファイルの SHA-256 が合わなくなるとビルドが止まる)。ここに並べた部品は、エンジンが
 * 決まった形 (C# のインターフェース) で使っているので、拡張機能はその形の実装を 1 つ渡すだけで
 * 置き換えられ、エンジンの中が変わっても壊れない。
 *
 *   extension.json   "replaces": ["vrm-loader"]               何を置き換えるか (宣言しないと実機で断られる)
 *   入口の C#        ReplaceEngineParts(parts, context) {
 *                      parts.Replace<IArsistVrmLoader>("vrm-loader", new MyLoader());
 *                    }
 *
 * 組み込みのスクリプトの名前 (`audio` など) も "script:audio" と書けば置き換えられる
 * (入口の RegisterScriptGlobals で script.Set("audio", …))。
 *
 * 1 つの部品を置き換えられるのは 1 つの拡張機能だけ (2 つが名乗るとビルドが止まる)。
 * 実機側の一覧は Runtime/Extensions/ArsistEngineParts.cs (テストで照合している)。
 * 部品を足すときは: インターフェースを作り、エンジンの使う場所で ArsistEngineParts.Get を通し、
 * ここと ArsistEngineParts.cs の両方に 1 行足す。doc/17-extensions.md §2.6。
 */
import type { LocalizedText } from './extensions';

export interface EnginePart {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  /** 拡張機能が実装する C# のインターフェース (完全名) */
  csInterface: string;
  /**
   * 置き換えるとビルドが入れなくなるもの。例えば VRM の読み込みを置き換えると、エンジンの
   * UniVRM 0.x (sdk/UniVRM-*.unitypackage) は作業用の Unity プロジェクトから外れる
   * (拡張機能が自分の UniVRM を持ってくるため。同じ UniGLTF の版違いがぶつからないように)。
   */
  dropsFromBuild?: LocalizedText;
}

export const ENGINE_PARTS: readonly EnginePart[] = [
  {
    id: 'vrm-loader',
    name: { en: 'VRM loading', ja: 'VRM の読み込み' },
    description: {
      en: 'Turns a .vrm file into a model on the device. The engine\'s own loader is UniVRM 0.x and reads VRM 0.x only.',
      ja: '.vrm を実機でモデルにする部分。エンジン標準は UniVRM 0.x で、VRM 0.x だけを読める。',
    },
    csInterface: 'Arsist.Runtime.VRM.IArsistVrmLoader',
    dropsFromBuild: {
      en: 'the engine\'s UniVRM 0.x (sdk/UniVRM-*.unitypackage) is left out of the build',
      ja: 'エンジンの UniVRM 0.x (sdk/UniVRM-*.unitypackage) はビルドに入らなくなる',
    },
  },
  {
    id: 'storage-backend',
    name: { en: 'Saved values', ja: '端末に保存する値の置き場' },
    description: {
      en: 'Where project.storage.persist keeps its values. The engine writes one file on the device.',
      ja: 'project.storage.persist の値を書く先。エンジン標準は端末の中のファイル 1 つ。',
    },
    csInterface: 'Arsist.Runtime.Data.IArsistStorageBackend',
  },
];

/** "script:<名前>" で置き換えられる組み込みのスクリプトの名前 (API でない内部の名前は除く)。 */
export const REPLACEABLE_SCRIPT_GLOBALS = [
  'api', 'ui', 'store', 'scene', 'vrm', 'remote', 'viewer', 'perception', 'model', 'log', 'error',
  'audio', 'camera', 'storage', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
] as const;

export const SCRIPT_PART_PREFIX = 'script:';

export function enginePart(id: string): EnginePart | undefined {
  return ENGINE_PARTS.find((p) => p.id === id);
}

/** replaces に書ける名前か。だめなら理由。 */
export function checkReplaceable(id: unknown): string | null {
  if (typeof id !== 'string' || id.trim() === '') return 'must be a part name';
  if (id.startsWith(SCRIPT_PART_PREFIX)) {
    const name = id.slice(SCRIPT_PART_PREFIX.length);
    return (REPLACEABLE_SCRIPT_GLOBALS as readonly string[]).includes(name)
      ? null
      : `"${name}" is not a built-in script name that can be replaced (${REPLACEABLE_SCRIPT_GLOBALS.join(', ')})`;
  }
  return enginePart(id) ? null : `unknown engine part (known: ${ENGINE_PARTS.map((p) => p.id).join(', ')}, or script:<name>)`;
}

/** 画面・ログ用の名前。 */
export function enginePartLabel(id: string, lang: 'en' | 'ja'): string {
  if (id.startsWith(SCRIPT_PART_PREFIX)) {
    const name = id.slice(SCRIPT_PART_PREFIX.length);
    return lang === 'ja' ? `スクリプトの ${name}` : `script ${name}`;
  }
  return enginePart(id)?.name[lang] ?? id;
}

/**
 * 有効な拡張機能のうち、どれがどの部品を置き換えるか。同じ部品を 2 つ以上が名乗っていれば conflicts。
 */
export function planReplacements(manifests: Array<{ id: string; replaces?: string[] }>): {
  owners: Record<string, string>;
  conflicts: Array<{ part: string; ids: string[] }>;
} {
  const claims = new Map<string, string[]>();
  for (const m of manifests) {
    for (const part of new Set(m.replaces ?? [])) claims.set(part, [...(claims.get(part) ?? []), m.id]);
  }
  const owners: Record<string, string> = {};
  const conflicts: Array<{ part: string; ids: string[] }> = [];
  for (const [part, ids] of [...claims].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.length > 1) conflicts.push({ part, ids: [...ids].sort() });
    else owners[part] = ids[0];
  }
  return { owners, conflicts };
}
