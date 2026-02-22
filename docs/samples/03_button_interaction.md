# サンプル 03: ボタンインタラクション

ボタンを押すと API からデータを取得してUIを更新する例。
複数スクリプトをイベントで連携させます。

## スクリプト構成

| スクリプト名 | トリガー | 役割 |
|---|---|---|
| `InitUI` | `onStart` | 初期 UI セットアップ |
| `FetchOnRefresh` | `event: btn_refresh` | ボタン押下時データ取得 |

---

## Script 1: InitUI (onStart)

```javascript
// アプリ起動時の初期化

ui.setText('statusText', '準備完了');
ui.setText('dataDisplay', '--- データなし ---');
ui.setColor('statusText', '#4EC9B0');

// 前回のスコアを永続データから復元
var lastData = store.get('lastFetchedData');
if (lastData !== null) {
  ui.setText('dataDisplay', lastData);
  ui.setText('statusText', '前回データを復元');
}

log('InitUI 完了');
```

---

## Script 2: FetchOnRefresh (event: btn_refresh)

```javascript
// "btn_refresh" イベント発火時 (ボタン押下) に実行

ui.setText('statusText', '取得中...');
ui.setColor('statusText', '#FFC300');
ui.setAlpha('refreshBtn', 0.5);  // ボタンをグレーアウト

api.get('https://jsonplaceholder.typicode.com/posts/1', function(res) {
  ui.setAlpha('refreshBtn', 1.0);  // ボタンを元に戻す

  if (res === null) {
    ui.setText('statusText', '取得失敗 ❌');
    ui.setColor('statusText', '#FF0000');
    return;
  }

  var post = JSON.parse(res);
  var displayText = post.title;

  ui.setText('dataDisplay', displayText);
  ui.setText('statusText', '更新完了 ✓');
  ui.setColor('statusText', '#4EC9B0');

  // 永続データに保存
  store.set('lastFetchedData', displayText);

  log('データ取得成功: ' + post.title);
});
```

---

## UI 設定

| Binding ID | 要素 | 説明 |
|---|---|---|
| `statusText` | Text | ステータス表示 |
| `dataDisplay` | Text | 取得データ表示 |
| `refreshBtn` | Button | 更新ボタン (イベント ID: `btn_refresh`) |

## ボタンとイベントの連携方法

1. UI エディタでボタンを作成
2. 右パネルの **「Binding ID」** に `refreshBtn` を設定
3. ボタンの **「クリックイベント名」** に `btn_refresh` を設定
4. Script 2 のトリガーを `event`、イベント名を `btn_refresh` に設定
