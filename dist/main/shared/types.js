"use strict";
/**
 * Arsist Engine — 中間表現 (IR) 型定義
 *
 * 本システムの唯一の正 (Single Source of Truth)。
 * DataSource → DataStore → UI の3層宣言型アーキテクチャ。
 *
 * ユーザーは C# を一切書かない。
 * ユーザーが扱うのは「UI定義」と「データ定義」のみ。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHARACTER_DEFAULTS = void 0;
exports.isImageModel = isImageModel;
exports.isPersistedKey = isPersistedKey;
function isImageModel(model) {
    return !!model && model.use === 'image' && !!model.task && !!model.input && !!model.output;
}
/** エディタで新しく置いた VRM の既定。 */
exports.CHARACTER_DEFAULTS = {
    blink: true,
    breathe: true,
    lookAtUser: 'nearby',
};
/**
 * store のキーが persist の指定に当たるか。'memory.' は前方一致、それ以外は完全一致。
 * 大文字小文字は区別しない (実機の store がそうなので。ArsistPersistentStore と同じ規則)。
 */
function isPersistedKey(key, persist) {
    if (!persist)
        return false;
    const k = key.toLowerCase();
    return persist.some((raw) => {
        const p = raw.toLowerCase();
        return p.endsWith('.') ? k.startsWith(p) : k === p;
    });
}
//# sourceMappingURL=types.js.map