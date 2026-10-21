/**
 * targetDevice (プロジェクトの「端末」) と、アダプタのフォルダ名の照合。
 *
 * 規則は昔から UnityBuilder.resolveAdapterDir にあったものと同じ:
 *   1. 完全一致
 *   2. 大文字小文字・`-`・空白・`_` の違いを無視して一致
 *   3. 型番まで書かれていても拾う ("Meta_Quest3" → Meta_Quest)。複数当たったら長い方
 * アダプタは Adapters/ (エンジン同梱) と、拡張機能の Adapters/ の両方から来る。
 * どちらも同じ規則で探すため、ここに 1 つだけ置く。
 */

function normalize(name: string): string {
  return String(name ?? '').replace(/[-\s]/g, '_').toLowerCase();
}

/** 当たったアダプタ名 (names の中の表記のまま)。無ければ null。 */
export function matchAdapterName(names: Iterable<string>, targetDevice: string): string | null {
  const list = [...names];
  if (!targetDevice) return null;
  if (list.includes(targetDevice)) return targetDevice;

  const target = normalize(targetDevice);
  const normalized = list.map((name) => ({ name, n: normalize(name) }));
  const exact = normalized.find((e) => e.n === target);
  if (exact) return exact.name;

  const prefix = normalized
    .filter((e) => e.n.length > 0 && target.startsWith(e.n))
    .sort((a, b) => b.n.length - a.n.length);
  return prefix.length > 0 ? prefix[0].name : null;
}
