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
exports.isImageModel = isImageModel;
function isImageModel(model) {
    return !!model && model.use === 'image' && !!model.task && !!model.input && !!model.output;
}
//# sourceMappingURL=types.js.map