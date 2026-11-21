/**
 * ESLint 用の TypeScript パーサ (`npm run lint`、設定は .eslintrc.cjs)。
 *
 * @typescript-eslint/parser は入っていない (追加のパッケージを入れない方針)。代わりに、Vite の React プラグイン
 * 経由で既に node_modules にある @babel/parser (typescript + jsx + estree) で ESTree の木を作る。
 * 型の情報は使わないので、型を見る規則 (no-undef など) は .eslintrc.cjs で切ってある。型は tsc が見る。
 *
 * もう 1 つ: 入っていないプラグインの規則を名指しした eslint-disable コメント (react-hooks/…,
 * @typescript-eslint/…) は、ESLint 8 では「規則の定義が無い」というエラーになる。そのコメントは
 * ここで指示としては読まれない形に変える (行や位置は変えない)。プラグインを入れたら PLUGIN_PREFIXES から外す。
 */
'use strict';

const babel = require('@babel/parser');

/** 入っていないプラグイン。これで始まる規則だけを名指しした指示コメントを無効にする */
const PLUGIN_PREFIXES = ['react-hooks/', '@typescript-eslint/', 'react/', 'import/'];
const DIRECTIVE = /^(\s*)(eslint-disable(?:-next-line|-line)?|eslint-enable)(\s+)(.+?)(\s*(?:--.*)?)$/s;

function neutralizeDirective(comment) {
  const m = DIRECTIVE.exec(comment.value);
  if (!m) return;
  const rules = m[4].split(',').map((s) => s.trim()).filter(Boolean);
  if (rules.length === 0) return;
  if (!rules.every((r) => PLUGIN_PREFIXES.some((p) => r.startsWith(p)))) return;
  // 同じ長さのまま、指示ではないコメントにする ("eslint-disable" → "eslint_disable")
  comment.value = comment.value.replace(m[2], m[2].replace(/-/, '_'));
}

function parseForESLint(code, options = {}) {
  const filePath = options.filePath || '';
  const plugins = [
    'estree',
    ['typescript', { dts: filePath.endsWith('.d.ts') }],
    'decorators-legacy',
    'importAttributes',
  ];
  if (!filePath.endsWith('.ts') || filePath.endsWith('.tsx')) plugins.push('jsx');
  const file = babel.parse(code, {
    sourceType: 'module',
    sourceFilename: filePath,
    ranges: true,
    tokens: true,
    errorRecovery: false,
    attachComment: false,
    allowReturnOutsideFunction: false,
    plugins,
  });
  const ast = file.program;
  ast.type = 'Program';
  ast.comments = file.comments || [];
  ast.tokens = (file.tokens || []).filter((t) => t.type !== 'CommentLine' && t.type !== 'CommentBlock').map(toEsTreeToken);
  ast.range = [0, code.length];
  ast.loc = { start: { line: 1, column: 0 }, end: file.loc.end };
  for (const c of ast.comments) {
    c.type = c.type === 'CommentLine' ? 'Line' : c.type === 'CommentBlock' ? 'Block' : c.type;
    if (!c.range) c.range = [c.start, c.end];
    neutralizeDirective(c);
  }
  return { ast, services: {}, scopeManager: null, visitorKeys: null };
}

/** babel のトークンを ESLint (espree) の形に寄せる。規則が見るのは type / value / range / loc */
function toEsTreeToken(t) {
  const type = t.type;
  let kind = 'Punctuator';
  let value = t.value;
  if (typeof type === 'object' && type) {
    const label = type.label;
    if (label === 'name') kind = 'Identifier';
    else if (label === 'string') kind = 'String';
    else if (label === 'num' || label === 'bigint' || label === 'decimal') kind = 'Numeric';
    else if (label === 'regexp') kind = 'RegularExpression';
    else if (label === 'template' || label === '`' || label === '${') kind = 'Template';
    else if (label === 'jsxName') kind = 'JSXIdentifier';
    else if (label === 'jsxText') kind = 'JSXText';
    else if (type.keyword) kind = 'Keyword';
    else if (label === 'true' || label === 'false') kind = 'Boolean';
    else if (label === 'null') kind = 'Null';
    if (value === undefined) value = label;
  } else if (typeof type === 'string') {
    kind = type;
  }
  return {
    type: kind,
    value: value === undefined ? '' : String(typeof value === 'object' && value && 'value' in value ? value.value : value),
    start: t.start,
    end: t.end,
    range: [t.start, t.end],
    loc: t.loc,
  };
}

module.exports = {
  meta: { name: 'arsist-ts-babel-parser', version: '1.0.0' },
  parseForESLint,
  parse: (code, options) => parseForESLint(code, options).ast,
};
