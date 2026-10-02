/**
 * アダプタ (Adapters/<端末>/adapter.json) が名乗るタグ。
 *
 * 3 か所から集める:
 *   1. adapter.json の `tags` に書いたもの            (cap:camera-access など、表に無いこと)
 *   2. `id` と `build.platform`                          (device:meta-quest, platform:android)
 *   3. `capabilities` で true になっているもの          (handTracking → cap:hand-tracking)
 *
 * 3 があるので、既存の adapter.json は書き換えなくてもそれなりのタグを持つ。
 * 表 (capabilities) に無い性質だけを 1 に足せばよい。
 */
import { isKnownNamespace, isValidTag, normalizeTag, uniqueTags, type Tag } from './tags';

/** capabilities のキー → タグ。ここに無いキーは camelCase を kebab-case にして使う。 */
const CAPABILITY_ALIASES: Record<string, string> = {
  sixDofTracking: 'cap:6dof',
  threeDofTracking: 'cap:3dof',
};

function kebab(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

export function capabilityTag(key: string): Tag {
  return CAPABILITY_ALIASES[key] ?? `cap:${kebab(key)}`;
}

/** adapter.json (中身はそのまま) からタグを作る。 */
export function adapterTags(adapter: unknown): Tag[] {
  const tags: Tag[] = [];
  if (!adapter || typeof adapter !== 'object') return tags;
  const a = adapter as Record<string, any>;

  if (typeof a.id === 'string' && a.id.trim()) tags.push(`device:${kebab(a.id.trim())}`);
  const platform = a.build?.platform;
  if (typeof platform === 'string' && platform.trim()) tags.push(`platform:${kebab(platform.trim())}`);

  const caps = a.capabilities;
  if (caps && typeof caps === 'object') {
    for (const [key, value] of Object.entries(caps)) {
      if (value === true) tags.push(capabilityTag(key));
    }
  }

  if (Array.isArray(a.tags)) {
    for (const raw of a.tags) {
      if (typeof raw !== 'string') continue;
      const tag = normalizeTag(raw);
      if (isValidTag(tag)) tags.push(tag);
    }
  }

  return uniqueTags(tags);
}

/** adapter.json の `tags` の書き間違いを探す。 */
export function validateAdapterTags(adapter: unknown, where: string): string[] {
  const problems: string[] = [];
  const raw = (adapter as Record<string, any> | null)?.tags;
  if (raw === undefined) return problems;
  if (!Array.isArray(raw)) return [`${where}.tags: must be an array`];
  for (const t of raw) {
    const tag = typeof t === 'string' ? normalizeTag(t) : '';
    if (!isValidTag(tag)) problems.push(`${where}.tags: "${String(t)}" is not a tag (namespace:value)`);
    else if (!isKnownNamespace(tag)) problems.push(`${where}.tags: "${tag}" uses an unknown namespace`);
  }
  return problems;
}
