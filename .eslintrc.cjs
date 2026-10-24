/**
 * ESLint (8.x, eslintrc 形式。package.json の `eslint src --ext .ts,.tsx` のまま動く)。
 *
 * TypeScript の構文は tools/eslint/ts-parser.cjs が読む (@typescript-eslint は入っていない)。
 * 型と未使用の変数は tsc (build:main / renderer の型検査) が見るので、ここでは型に頼る規則を切り、
 * 書き間違いを拾う規則だけを残す。今のコードで error が出ない状態を保つこと。
 */
module.exports = {
  root: true,
  parser: require.resolve('./tools/eslint/ts-parser.cjs'),
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  env: { es2022: true, browser: true, node: true },
  extends: ['eslint:recommended'],
  reportUnusedDisableDirectives: false,
  ignorePatterns: ['dist/', 'node_modules/', '**/*.d.ts'],
  rules: {
    // 型・宣言は tsc が見る (型だけの名前・interface・enum・オーバーロードを ESLint の scope は知らない)
    'no-undef': 'off',
    'no-unused-vars': 'off',
    'no-redeclare': 'off',
    'no-dupe-class-members': 'off',
    // 今のコードに多い書き方。直すなら少しずつ
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-useless-escape': 'warn',
    'no-case-declarations': 'warn',
    'no-control-regex': 'off',
    'no-constant-condition': ['warn', { checkLoops: false }],
    'no-prototype-builtins': 'warn',
    'no-inner-declarations': 'off',
    'no-async-promise-executor': 'warn',
    'no-cond-assign': ['warn', 'except-parens'],
    'no-fallthrough': 'warn',
    'prefer-const': 'warn',
  },
};
