/**
 * Layster.Spatial の語彙 — entity の「何か」(is) の言葉、同義語、できること、典型的な大きさ。
 *
 * これが唯一の元。ビルドは spatial.json にこの表を書き出し、ランタイム (C#) はそれを読む
 * (ランタイムに語彙を二重に持たせると、エディタと実機で「机」の意味がずれる)。
 * 言葉は Meta の MRUK・ARKit / ARCore の平面の分類・COCO の物の名前から、よく出るものを選んだ。
 * 表に無い言葉も使える (できることは無し、として扱う)。
 */

import type { Affordance, Entity, EntityQuery, Vec3 } from './types';

export interface Word {
  /** 正規の言葉 (小文字の英語) */
  word: string;
  /** 同じものを指す言葉 (MRUK の大文字の名前、日本語も) */
  synonyms: string[];
  has: Affordance[];
  /** 典型的な大きさ [幅, 高さ, 奥行き] (m)。仮に置くとき・検出の箱が無いときに使う */
  typicalSize: Vec3;
  /** 床・壁・天井のような部屋の面 */
  structural?: boolean;
  /** 縦の面 (壁・窓・扉・画面) */
  vertical?: boolean;
  label: { en: string; ja: string };
}

export const VOCABULARY: readonly Word[] = [
  // ---- 部屋の面 ----
  { word: 'floor', synonyms: ['FLOOR', 'ground', '床'], has: ['support', 'walk'], typicalSize: [4, 0, 4], structural: true, label: { en: 'Floor', ja: '床' } },
  { word: 'wall', synonyms: ['WALL_FACE', 'WALL_ART', 'INVISIBLE_WALL_FACE', '壁'], has: ['mount', 'obstacle'], typicalSize: [3, 2.4, 0], structural: true, vertical: true, label: { en: 'Wall', ja: '壁' } },
  { word: 'ceiling', synonyms: ['CEILING', '天井'], has: [], typicalSize: [4, 0, 4], structural: true, label: { en: 'Ceiling', ja: '天井' } },
  { word: 'door', synonyms: ['DOOR_FRAME', '扉', 'ドア'], has: ['obstacle'], typicalSize: [0.9, 2.0, 0], vertical: true, label: { en: 'Door', ja: '扉' } },
  { word: 'window', synonyms: ['WINDOW_FRAME', '窓'], has: [], typicalSize: [1.2, 1.2, 0], vertical: true, label: { en: 'Window', ja: '窓' } },
  // ---- 家具 ----
  { word: 'table', synonyms: ['TABLE', 'テーブル', '机', 'counter', 'COUNTER'], has: ['support', 'obstacle'], typicalSize: [1.2, 0.72, 0.7], label: { en: 'Table', ja: '机' } },
  { word: 'desk', synonyms: ['デスク', '勉強机'], has: ['support', 'obstacle'], typicalSize: [1.2, 0.72, 0.6], label: { en: 'Desk', ja: 'デスク' } },
  { word: 'chair', synonyms: ['椅子', 'いす'], has: ['sit', 'obstacle'], typicalSize: [0.5, 0.85, 0.5], label: { en: 'Chair', ja: '椅子' } },
  { word: 'couch', synonyms: ['COUCH', 'sofa', 'ソファ'], has: ['sit', 'support', 'obstacle'], typicalSize: [1.9, 0.8, 0.9], label: { en: 'Couch', ja: 'ソファ' } },
  { word: 'bed', synonyms: ['BED', 'ベッド'], has: ['sit', 'support', 'obstacle'], typicalSize: [1.4, 0.5, 2.0], label: { en: 'Bed', ja: 'ベッド' } },
  { word: 'shelf', synonyms: ['STORAGE', 'storage', 'cabinet', '棚', '本棚'], has: ['support', 'obstacle'], typicalSize: [0.8, 1.2, 0.35], label: { en: 'Shelf', ja: '棚' } },
  { word: 'screen', synonyms: ['SCREEN', 'tv', 'monitor', 'テレビ', 'モニター'], has: ['screen', 'obstacle'], typicalSize: [1.0, 0.6, 0.08], label: { en: 'Screen', ja: '画面' } },
  { word: 'lamp', synonyms: ['LAMP', 'ランプ', '照明'], has: ['obstacle'], typicalSize: [0.3, 1.4, 0.3], label: { en: 'Lamp', ja: 'ランプ' } },
  { word: 'plant', synonyms: ['PLANT', '植木', '観葉植物'], has: ['obstacle'], typicalSize: [0.4, 0.9, 0.4], label: { en: 'Plant', ja: '植木' } },
  // ---- 小さい物 ----
  { word: 'cup', synonyms: ['mug', 'コップ', 'カップ'], has: ['grasp'], typicalSize: [0.08, 0.1, 0.08], label: { en: 'Cup', ja: 'カップ' } },
  { word: 'bottle', synonyms: ['ボトル', 'ペットボトル'], has: ['grasp'], typicalSize: [0.07, 0.22, 0.07], label: { en: 'Bottle', ja: 'ボトル' } },
  { word: 'book', synonyms: ['notebook', '本', 'ノート'], has: ['grasp'], typicalSize: [0.18, 0.03, 0.25], label: { en: 'Book', ja: '本' } },
  { word: 'phone', synonyms: ['cell phone', 'スマホ'], has: ['grasp', 'screen'], typicalSize: [0.075, 0.01, 0.15], label: { en: 'Phone', ja: 'スマホ' } },
  { word: 'laptop', synonyms: ['ノートパソコン', 'PC'], has: ['screen'], typicalSize: [0.33, 0.02, 0.23], label: { en: 'Laptop', ja: 'ノートパソコン' } },
  { word: 'pen', synonyms: ['pencil', 'ペン', '鉛筆'], has: ['grasp'], typicalSize: [0.15, 0.01, 0.01], label: { en: 'Pen', ja: 'ペン' } },
  { word: 'box', synonyms: ['箱'], has: ['grasp', 'support'], typicalSize: [0.3, 0.2, 0.3], label: { en: 'Box', ja: '箱' } },
  // ---- 人と体 ----
  { word: 'person', synonyms: ['human', '人'], has: ['obstacle'], typicalSize: [0.5, 1.7, 0.3], label: { en: 'Person', ja: '人' } },
  { word: 'robot', synonyms: ['ロボット', 'arm'], has: ['obstacle'], typicalSize: [0.3, 0.4, 0.3], label: { en: 'Robot', ja: 'ロボット' } },
];

const INDEX: Map<string, Word> = (() => {
  const map = new Map<string, Word>();
  for (const w of VOCABULARY) {
    map.set(w.word.toLowerCase(), w);
    for (const s of w.synonyms) if (!map.has(s.toLowerCase())) map.set(s.toLowerCase(), w);
  }
  return map;
})();

/** 言葉を正規の言葉にする (表に無ければ小文字にしてそのまま)。 */
export function canonicalWord(word: string): string {
  const key = String(word ?? '').trim().toLowerCase();
  return INDEX.get(key)?.word ?? key;
}

export function lookupWord(word: string): Word | undefined {
  return INDEX.get(String(word ?? '').trim().toLowerCase());
}

/**
 * 言葉がもう一方に当たるか。同義語と「机 ⊃ デスク」の関係も見る。
 * (desk は table として探しても当たる。逆は当たらない)
 */
export function wordMatches(entityWord: string, wanted: string): boolean {
  const a = canonicalWord(entityWord);
  const b = canonicalWord(wanted);
  if (a === b) return true;
  return (BROADER[a] ?? []).includes(b);
}

/** 狭い言葉 → それを含む広い言葉。 */
const BROADER: Record<string, string[]> = {
  desk: ['table'],
  couch: ['seat'],
  chair: ['seat'],
  bed: ['seat'],
  laptop: ['screen'],
  phone: ['screen'],
};

/** entity ができること (has があればそれ、無ければ言葉から)。 */
export function affordancesOf(entity: Pick<Entity, 'is' | 'has' | 'size'>): Affordance[] {
  if (Array.isArray(entity.has) && entity.has.length > 0) return entity.has;
  const set = new Set<Affordance>();
  for (const w of entity.is ?? []) for (const a of lookupWord(w)?.has ?? []) set.add(a);
  return [...set];
}

export function isVertical(entity: Pick<Entity, 'is' | 'size'>): boolean {
  const w = entity.is?.[0] ? lookupWord(entity.is[0]) : undefined;
  if (w?.vertical) return true;
  // 語彙に無い物は形で決める: 薄くて背が高い箱は縦の面
  const [width, height, depth] = entity.size;
  return depth < 0.05 && height > 0.3 && height > depth * 4 && width > 0.1;
}

/** entity が query の言葉・できることに当たるか (位置の条件は solver が見る)。 */
export function matchesWords(entity: Pick<Entity, 'id' | 'is' | 'has' | 'size' | 'confidence'>, query: EntityQuery): boolean {
  if (query.id && entity.id !== query.id) return false;
  if (query.is && query.is.length > 0) {
    if (!query.is.some((wanted) => (entity.is ?? []).some((w) => wordMatches(w, wanted)))) return false;
  }
  if (query.not && query.not.length > 0) {
    if (query.not.some((unwanted) => (entity.is ?? []).some((w) => wordMatches(w, unwanted)))) return false;
  }
  if (query.has && query.has.length > 0) {
    const has = affordancesOf(entity);
    if (!query.has.every((a) => has.includes(a))) return false;
  }
  const minConfidence = query.minConfidence ?? 0.2;
  if ((entity.confidence ?? 0) < minConfidence) return false;
  return true;
}

/** ビルドが spatial.json に書き出す語彙の表 (ランタイムはこれだけを見る)。 */
export function vocabularyForRuntime(): Array<{ word: string; synonyms: string[]; has: Affordance[]; vertical: boolean; structural: boolean; broader: string[] }> {
  return VOCABULARY.map((w) => ({
    word: w.word,
    synonyms: w.synonyms,
    has: w.has,
    vertical: !!w.vertical,
    structural: !!w.structural,
    broader: BROADER[w.word] ?? [],
  }));
}
