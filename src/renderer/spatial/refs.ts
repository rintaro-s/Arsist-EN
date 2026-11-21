/**
 * id を変えたときに、プロジェクトの中のその id への参照も一緒に直す
 * (置き方の near / at、規則のきっかけと行動、体の根元、Mind の観測 …)。
 * 直さないと、名前を変えただけで「物がありません」の問題が並ぶ。
 */
import type { SpatialProject } from '../../shared/layster/spatial/types';

type Kind = 'thing' | 'mind' | 'body';

const KEYS: Record<Kind, string[]> = {
  thing: ['thing', 'gaze', 'placed', 'fallback'],
  mind: ['mind', 'use'],
  body: ['body'],
};

export function renameRefs(project: SpatialProject, kind: Kind, from: string, to: string): void {
  if (from === to) return;
  const visit = (node: unknown, key: string | null, parentKey: string | null): unknown => {
    if (typeof node === 'string') {
      if (KEYS[kind].includes(key ?? '') && node === from) return to;
      if (node === `${kind}:${from}`) return `${kind}:${to}`;
      if (kind === 'thing' && key === 'select' && (node === from || node.startsWith(`${from}.`))) return to + node.slice(from.length);
      if (kind === 'thing' && key === 'near' && parentKey !== null && node === from) return to;
      return node;
    }
    if (Array.isArray(node)) {
      // avoid: ['quiz'] / observe.things: ['quiz']
      if (kind === 'thing' && (key === 'avoid' || key === 'things')) return node.map((x) => (x === from ? to : visit(x, null, key)));
      return node.map((x) => visit(x, null, key));
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) (node as Record<string, unknown>)[k] = visit(v, k, key);
      return node;
    }
    return node;
  };
  for (const section of ['things', 'minds', 'bodies', 'rules'] as const) visit(project[section], section, null);
}
