# Arsist スクリプティング入門ガイド

Arsist のスクリプティングシステムを使うと、AR/VR アプリに **動的な動作** を追加できます。
REST API からデータ取得、UI のリアルタイム更新、ボタンイベント処理などが JavaScript で記述できます。

---

## 1. スクリプトの作成

1. Arsist エディタを開き、ツールバーの **「Script」** タブをクリック
2. 左パネルの **「+」** ボタンをクリック → スクリプト名を入力して Enter
3. 中央のコードエディタにコードを記述
4. **Ctrl+S** または「保存」ボタンで保存
5. ビルドすると自動的にアプリに組み込まれます

---

## 2. トリガーの設定

スクリプトは右パネルの **「トリガー」** 設定で実行タイミングを制御します。

| トリガー | 実行タイミング | 主な用途 |
|---|---|---|
| `onStart` | アプリ起動時に 1 回 | 初期化処理、データ取得 |
| `onUpdate` | 毎フレーム (60fps) | 常時監視、アニメーション制御 |
| `interval` | 指定ミリ秒ごと | ポーリング、定期更新 |
| `event` | イベント発火時 | ボタンクリック、外部トリガー |

### interval の設定例
右パネルで「interval」を選択し、「間隔 (ミリ秒)」に `5000` と入力 → 5 秒ごとに実行。

### event の設定例
右パネルで「event」を選択し、「イベント名」に `btn_refresh` と入力。
UI のボタン要素の ID と一致させることで、ボタンクリック時に起動します。

---

## 3. 利用可能な API

### `api` — HTTP リクエスト

```javascript
// GET リクエスト
api.get('https://api.example.com/data', function(responseText) {
  var data = JSON.parse(responseText);
  ui.setText('myLabel', data.value);
});

// POST リクエスト
api.post('https://api.example.com/submit', JSON.stringify({ name: 'Taro' }), function(responseText) {
  log('送信完了: ' + responseText);
});
```

### `ui` — UI 操作

```javascript
ui.setText('elementId', 'Hello AR!');       // テキスト変更
ui.setVisibility('panelId', false);          // 非表示
ui.setColor('labelId', '#FF5733');           // 文字色変更 (#RRGGBB)
ui.setAlpha('panelId', 0.5);                 // 透明度 (0.0 〜 1.0)
ui.setText3D('worldTextId', 'World Label');  // 3D テキスト変更
```

> **elementId** は UI エディタで各要素に設定した「Binding ID」と一致させてください。

### `event` — イベント通信

```javascript
// イベントを発火 (他のスクリプトやシステムに通知)
event.emit('data_updated', { value: 42 });

// イベントを購読
event.on('sensor_triggered', function(payloadJson) {
  var payload = JSON.parse(payloadJson);
  log('センサー値: ' + payload.value);
});

// 購読解除
event.off('sensor_triggered');
```

### `store` — 永続データ

```javascript
// 保存 (アプリ再起動後も保持)
store.set('highScore', 1500);
store.set('playerName', 'Taro');

// 取得
var score = store.get('highScore');
var name = store.get('playerName');

// 存在確認
if (store.has('firstLaunch')) {
  log('初回起動済み');
}

// 削除
store.remove('tempData');
```

### `log` / `error` — デバッグログ

```javascript
log('デバッグメッセージ');       // Unity コンソールに Info として出力
error('エラーメッセージ');        // Unity コンソールに Error として出力
```

---

## 4. UI 要素と Binding ID の連携

1. **UI エディタ** でテキストや Image 要素を選択
2. 右パネルの **「Binding ID」** フィールドに ID を入力 (例: `tempDisplay`)
3. スクリプトから `ui.setText('tempDisplay', '25.3°C')` で操作

```javascript
// 例: 気温を表示する
api.get('https://api.openweathermap.org/data/2.5/weather?q=Tokyo&appid=YOUR_KEY', function(res) {
  var data = JSON.parse(res);
  var temp = Math.round(data.main.temp - 273.15); // K → ℃
  ui.setText('tempDisplay', temp + '°C');
  ui.setText('cityDisplay', data.name);
});
```

---

## 5. イベントとボタンの連携

1. UI エディタでボタン要素を作成、ID を `btn_refresh` に設定
2. スクリプトのトリガーを `event`、イベント名を `btn_refresh` に設定
3. ユーザーがボタンをタップするとスクリプトが実行される

```javascript
// ボタン押下時に実行されるスクリプト (トリガー: event, イベント名: btn_refresh)
log('ボタンが押されました');
ui.setColor('btn_refresh', '#FF0000');  // ボタンを赤くハイライト

api.get('https://api.example.com/refresh', function(res) {
  var data = JSON.parse(res);
  ui.setText('statusText', data.status);
  ui.setColor('btn_refresh', '#FFFFFF');  // ボタンを元に戻す
});
```

---

## 6. 複数スクリプトの組み合わせ

複数スクリプトは独立して動作し、`event` を通じて連携できます。

```javascript
// Script 1: データ取得 (interval: 10000ms)
api.get('https://api.example.com/sensor', function(res) {
  var data = JSON.parse(res);
  event.emit('sensor_updated', { value: data.value });
});

// Script 2: UI 更新 (event: sensor_updated)
event.on('sensor_updated', function(payloadJson) {
  var payload = JSON.parse(payloadJson);
  ui.setText('sensorValue', payload.value.toString());
  if (payload.value > 80) {
    ui.setColor('sensorValue', '#FF0000');  // 危険: 赤
  } else {
    ui.setColor('sensorValue', '#00FF00');  // 正常: 緑
  }
});
```

---

## 7. セキュリティとサンドボックス

Arsist のスクリプトは **Jint** (C# 製 JS インタープリタ) 上で安全に実行されます。

- `.NET` / `UnityEngine` クラスへの直接アクセスは **不可**
- メモリ上限: **8MB** (Quest: 16MB)
- 再帰上限: **20 段**
- 実行タイムアウト: **3 秒** (無限ループは自動停止)

### タイムアウトが発生する例 (NG)

```javascript
// ❌ 無限ループ — 3 秒後に自動停止される
while (true) {
  // 無限に実行...
}
```

代わりに `interval` トリガーを使ってください。

---

## 8. ビルドと動作確認

1. ツールバーの **「ビルド」** をクリック
2. ターゲットデバイス (XREAL One / Meta Quest) を選択
3. スクリプトバンドルは `StreamingAssets/scripts.json` として自動生成・組み込まれます
4. Unity 上でのビルドは **バックグラウンドで自動実行** されます (手動操作不要)

### デバッグ方法

- **Unity コンソール**: `log()` / `error()` の出力はビルド後の Unity コンソールで確認
- **エラーログ**: スクリプト実行エラーは `[ArsistScript:スクリプトID]` プレフィックスで出力
- **Arsist コンソール**: エディタ下部のコンソールパネルでも基本ログを確認可能

---

## 9. よくある質問

**Q: `async/await` や `Promise` は使えますか？**
A: Jint は同期インタープリタのため、`Promise` のネイティブサポートはありません。非同期処理には `api.get()` のコールバックパターンを使用してください。

**Q: `fetch()` は使えますか？**
A: Arsist は `api.get()` / `api.post()` を提供しています。ブラウザの `fetch()` は使えません。

**Q: `console.log()` は使えますか？**
A: Arsist では `log()` 関数を使ってください。

**Q: 複数のスクリプトが同じ `event` を購読できますか？**
A: はい、複数スクリプトが同じイベント名を購読できます。

**Q: XREAL One と Meta Quest で動作に違いはありますか？**
A: Jint ベースのスクリプティング API は両プラットフォームで同一です。メモリ上限のみ異なります (XREAL: 8MB、Quest: 16MB)。
