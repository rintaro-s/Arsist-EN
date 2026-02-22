# サンプル 01: Hello World

最もシンプルなスクリプト。起動時にログを出力し、UI テキストを更新します。

## 設定

| 項目 | 値 |
|---|---|
| トリガー | `onStart` |
| スクリプト名 | `HelloWorld` |

## コード

```javascript
// アプリ起動時に 1 回実行される

log('Hello Arsist!');

// UI テキストを更新 (UI エディタで ID "welcomeText" を設定した Text 要素が必要)
ui.setText('welcomeText', 'AR アプリへようこそ！');
ui.setColor('welcomeText', '#4EC9B0');
```

## 事前準備

1. UI エディタで `Text` 要素を作成
2. 右パネルの **Binding ID** に `welcomeText` を入力
3. スクリプトを保存してビルド
