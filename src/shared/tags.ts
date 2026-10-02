/**
 * タグ — エンジンの機能・端末 (アダプタ)・拡張機能を「名前」ではなく「性質」で結ぶための語彙。
 *
 * 以前は「Quest なら」「XREAL なら」をコードのあちこちで名前比較していた。
 * それだと端末や機能を 1 つ足すたびに、比較している場所を全部探して直すことになる。
 * タグにしておくと、
 *   - アダプタは「自分は何ができるか」をタグで名乗る        (Adapters/<端末>/adapter.json の tags)
 *   - エンジンの機能は「何が要るか」をタグで書く            (src/shared/engineFeatures.ts)
 *   - 拡張機能は「どこで動くか」をタグの条件で書く          (Extensions/<id>/extension.json の requires)
 * だけで噛み合う。新しい端末が `cap:hand-tracking` を名乗れば、手の操作を要る機能も拡張も
 * そのまま有効になる。
 *
 * 形は `名前空間:値`。小文字・数字・`-`・`.` だけ。
 *
 *   device:<id>     端末そのもの            device:meta-quest
 *   platform:<id>   OS / 実行環境           platform:android
 *   cap:<id>        端末ができること        cap:hand-tracking, cap:passthrough, cap:scene-understanding
 *   sdk:<id>        ビルドに入る SDK        sdk:meta-mruk   (ビルド時に sdk/ を見て決まる)
 *   feature:<id>    エンジンの機能          feature:vision, feature:text-input
 *   ext:<id>        拡張機能                ext:quest-room
 *
 * 条件 (TagQuery) は all / any / none の組み合わせ。値に `*` を書くと「その名前空間の何か」。
 */

export type Tag = string;

export interface TagQuery {
  /** すべて持っていること */
  all?: Tag[];
  /** どれか 1 つを持っていること (空なら条件なし) */
  any?: Tag[];
  /** どれも持っていないこと */
  none?: Tag[];
}

/** 名前空間ごとの意味。エディタの表示と検証に使う。 */
export const TAG_NAMESPACES = ['device', 'platform', 'cap', 'sdk', 'feature', 'ext'] as const;
export type TagNamespace = (typeof TAG_NAMESPACES)[number];

const TAG_RE = /^([a-z][a-z0-9-]*):([a-z0-9][a-z0-9.-]*)$/;
const PATTERN_RE = /^([a-z][a-z0-9-]*):(\*|[a-z0-9][a-z0-9.-]*)$/;

/** 前後の空白を落として小文字にする。形は検証しない。 */
export function normalizeTag(raw: string): Tag {
  return String(raw ?? '').trim().toLowerCase();
}

/** `名前空間:値` の形になっているか。wildcard が真なら `ns:*` も許す。 */
export function isValidTag(tag: string, options: { wildcard?: boolean } = {}): boolean {
  return (options.wildcard ? PATTERN_RE : TAG_RE).test(tag);
}

/** 知っている名前空間か (知らない名前空間は書き間違いのことが多い)。 */
export function isKnownNamespace(tag: string): boolean {
  return (TAG_NAMESPACES as readonly string[]).includes(tagNamespace(tag));
}

export function tagNamespace(tag: Tag): string {
  const i = tag.indexOf(':');
  return i < 0 ? '' : tag.slice(0, i);
}

export function tagValue(tag: Tag): string {
  const i = tag.indexOf(':');
  return i < 0 ? tag : tag.slice(i + 1);
}

/** 1 つの条件 (`ns:*` を含む) が 1 つのタグに当たるか。 */
export function tagMatches(pattern: Tag, tag: Tag): boolean {
  const p = normalizeTag(pattern);
  const t = normalizeTag(tag);
  if (p.endsWith(':*')) return tagNamespace(t) === p.slice(0, -2);
  return p === t;
}

export function hasTag(tags: Iterable<Tag>, pattern: Tag): boolean {
  for (const tag of tags) if (tagMatches(pattern, tag)) return true;
  return false;
}

/** 重複を落として並べる (表示とログが毎回同じ順になるように)。 */
export function uniqueTags(tags: Iterable<Tag>): Tag[] {
  return [...new Set([...tags].map(normalizeTag).filter((t) => t.length > 0))].sort();
}

export interface TagQueryResult {
  ok: boolean;
  /** all のうち持っていないもの */
  missing: Tag[];
  /** any が 1 つも当たらなかったとき、その候補 */
  missingAny: Tag[];
  /** none に書かれていて、持っているもの */
  blocked: Tag[];
  /** deferred の名前空間なので、ここでは判断しなかったもの */
  deferred: Tag[];
}

/**
 * 条件を満たすか。
 *
 * deferred に名前空間を渡すと、その名前空間の条件は「満たしている」とみなして
 * deferred に積む。例えば `sdk:*` は sdk/ に何が置いてあるかで決まるので、エディタ上では
 * 判断できず、ビルド時にもう一度確かめる。
 */
export function matchTagQuery(
  query: TagQuery | undefined,
  tags: Iterable<Tag>,
  options: { deferred?: string[] } = {},
): TagQueryResult {
  const have = [...tags].map(normalizeTag);
  const deferredNs = new Set(options.deferred ?? []);
  const result: TagQueryResult = { ok: true, missing: [], missingAny: [], blocked: [], deferred: [] };
  if (!query) return result;

  const isDeferred = (pattern: Tag) => deferredNs.has(tagNamespace(normalizeTag(pattern)));

  for (const pattern of query.all ?? []) {
    if (hasTag(have, pattern)) continue;
    if (isDeferred(pattern)) result.deferred.push(normalizeTag(pattern));
    else result.missing.push(normalizeTag(pattern));
  }

  const any = query.any ?? [];
  if (any.length > 0 && !any.some((pattern) => hasTag(have, pattern))) {
    if (any.every(isDeferred)) result.deferred.push(...any.map(normalizeTag));
    else result.missingAny.push(...any.map(normalizeTag));
  }

  for (const pattern of query.none ?? []) {
    if (hasTag(have, pattern)) result.blocked.push(normalizeTag(pattern));
  }

  result.ok = result.missing.length === 0 && result.missingAny.length === 0 && result.blocked.length === 0;
  return result;
}

/** 条件の中に、形の崩れたタグや知らない名前空間が無いか。問題の説明を返す。 */
export function validateTagQuery(query: unknown, where: string): string[] {
  const problems: string[] = [];
  if (query === undefined) return problems;
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return [`${where}: must be an object with all / any / none`];
  }
  for (const [key, list] of Object.entries(query as Record<string, unknown>)) {
    if (key !== 'all' && key !== 'any' && key !== 'none') {
      problems.push(`${where}: unknown key "${key}" (use all / any / none)`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`${where}.${key}: must be an array of tags`);
      continue;
    }
    for (const tag of list) {
      if (typeof tag !== 'string' || !isValidTag(normalizeTag(tag), { wildcard: true })) {
        problems.push(`${where}.${key}: "${String(tag)}" is not a tag (namespace:value)`);
      } else if (!isKnownNamespace(normalizeTag(tag))) {
        problems.push(`${where}.${key}: "${tag}" uses an unknown namespace (${TAG_NAMESPACES.join(', ')})`);
      }
    }
  }
  return problems;
}

/** 人に見せる 1 行の説明 (ログ用)。 */
export function describeTagQuery(query: TagQuery | undefined): string {
  if (!query) return '(anywhere)';
  const parts: string[] = [];
  if (query.all?.length) parts.push(query.all.join(' + '));
  if (query.any?.length) parts.push(`one of ${query.any.join(' / ')}`);
  if (query.none?.length) parts.push(`not ${query.none.join(' / ')}`);
  return parts.length ? parts.join(', ') : '(anywhere)';
}
