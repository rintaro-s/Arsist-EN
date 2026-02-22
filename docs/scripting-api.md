# Arsist スクリプティング API リファレンス

Arsist スクリプトは **Jint** (JavaScript インタープリタ) 上で実行されます。
IL2CPP (Quest / XREAL One) 環境でも完全に動作します。

---

## グローバル関数

| 関数 | シグネチャ | 説明 |
|---|---|---|
| `log` | `log(message: any): void` | Unity コンソールにデバッグログを出力 |
| `error` | `error(message: any): void` | Unity コンソールにエラーログを出力 |
| `JSON.parse` | `JSON.parse(text: string): object` | JSON 文字列をオブジェクトに変換 |
| `JSON.stringify` | `JSON.stringify(obj: object): string` | オブジェクトを JSON 文字列に変換 |
| `Math.*` | 標準 JS Math | `Math.round`, `Math.floor`, `Math.abs` など |
| `parseInt` / `parseFloat` | 標準 JS | 文字列を数値に変換 |
| `String` / `Number` / `Boolean` | 標準 JS | 型変換 |

---

## api — HTTP リクエスト

### `api.get(url, callback)`

HTTP GET リクエストを送信します。

```typescript
api.get(url: string, callback: (responseText: string) => void): void
```

**パラメータ:**
- `url` — リクエスト先 URL
- `callback` — レスポンステキストを受け取るコールバック関数。失敗時は `null` が渡される

**例:**
```javascript
api.get('https://jsonplaceholder.typicode.com/todos/1', function(res) {
  if (res === null) { error('取得失敗'); return; }
  var todo = JSON.parse(res);
  ui.setText('titleLabel', todo.title);
});
```

---

### `api.post(url, bodyJson, callback)`

HTTP POST リクエストを送信します。Content-Type は `application/json` 固定。

```typescript
api.post(url: string, bodyJson: string, callback: (responseText: string) => void): void
```

**パラメータ:**
- `url` — リクエスト先 URL
- `bodyJson` — JSON 形式のリクエストボディ文字列
- `callback` — レスポンステキストを受け取るコールバック

**例:**
```javascript
var body = JSON.stringify({ userId: 1, title: 'New Task', completed: false });
api.post('https://jsonplaceholder.typicode.com/todos', body, function(res) {
  var created = JSON.parse(res);
  log('作成: ID=' + created.id);
});
```

---

## ui — UI 操作

> UI 要素は Arsist UI エディタで設定した **Binding ID** で識別されます。

### `ui.setText(id, text)`

TextMeshPro または uGUI Text のテキストを変更します。

```typescript
ui.setText(elementId: string, text: string): void
```

**例:**
```javascript
ui.setText('statusLabel', 'データ読込中...');
ui.setText('counterDisplay', String(count));
```

---

### `ui.setVisibility(id, isVisible)`

GameObject の表示/非表示を切り替えます (`SetActive`)。

```typescript
ui.setVisibility(elementId: string, isVisible: boolean): void
```

**例:**
```javascript
ui.setVisibility('loadingSpinner', true);
ui.setVisibility('mainPanel', false);
```

---

### `ui.setColor(id, hexColor)`

テキストまたはグラフィックの色を変更します。

```typescript
ui.setColor(elementId: string, hexColor: string): void
```

**パラメータ:**
- `hexColor` — `#RRGGBB` または `#RRGGBBAA` 形式の色文字列

**例:**
```javascript
ui.setColor('alertText', '#FF0000');    // 赤
ui.setColor('okText', '#00FF00');       // 緑
ui.setColor('dimPanel', '#FFFFFF80');   // 半透明白
```

---

### `ui.setAlpha(id, alpha)`

透明度を設定します。CanvasGroup があればそちらを優先、なければグラフィックの alpha を変更。

```typescript
ui.setAlpha(elementId: string, alpha: number): void
```

**パラメータ:**
- `alpha` — `0.0`（完全透明）〜 `1.0`（不透明）

**例:**
```javascript
ui.setAlpha('overlay', 0.5);  // 半透明
ui.setAlpha('overlay', 0.0);  // 完全非表示 (setVisibility より滑らかな制御に)
```

---

### `ui.setText3D(id, text)`

3D 空間に配置された TextMeshPro オブジェクトのテキストを変更します。

```typescript
ui.setText3D(elementId: string, text: string): void
```

**例:**
```javascript
ui.setText3D('worldLabel', '現在地: 東京');
```

---

## event — イベント通信

### `event.emit(eventName, payload?)`

ArsistEventBus にイベントを発火します。

```typescript
event.emit(eventName: string, payload?: object | string): void
```

**例:**
```javascript
event.emit('refresh_requested');
event.emit('score_updated', { score: 1500, player: 'Taro' });
```

---

### `event.on(eventName, callback)`

イベントを購読します。同じイベント名に対して呼ぶと上書きされます。

```typescript
event.on(eventName: string, callback: (payloadJson: string) => void): void
```

**注意:** コールバックの引数は **JSON 文字列** です。`JSON.parse()` で変換してください。

**例:**
```javascript
event.on('score_updated', function(payloadJson) {
  var data = JSON.parse(payloadJson);
  ui.setText('scoreDisplay', String(data.score));
});
```

---

### `event.off(eventName)`

イベント購読を解除します。

```typescript
event.off(eventName: string): void
```

**例:**
```javascript
event.off('score_updated');
```

---

## store — 永続データ

データはアプリ再起動後も `Application.persistentDataPath` に保持されます。

### `store.get(key)`

保存済みデータを取得します。キーが存在しない場合は `null` を返します。

```typescript
store.get(key: string): any
```

**例:**
```javascript
var highScore = store.get('highScore');
if (highScore === null) highScore = 0;
ui.setText('highScoreDisplay', String(highScore));
```

---

### `store.set(key, value)`

データを保存します。文字列、数値、真偽値を保存できます。

```typescript
store.set(key: string, value: string | number | boolean): void
```

**例:**
```javascript
store.set('highScore', 2500);
store.set('playerName', 'Hanako');
store.set('soundEnabled', true);
```

---

### `store.has(key)`

キーが存在するか確認します。

```typescript
store.has(key: string): boolean
```

**例:**
```javascript
if (!store.has('initialized')) {
  store.set('initialized', true);
  log('初回起動');
}
```

---

### `store.remove(key)`

指定したキーを削除します。

```typescript
store.remove(key: string): void
```

**例:**
```javascript
store.remove('tempSession');
```

---

## JSON IR フォーマット

Arsist はスクリプトを以下の JSON 形式 (`scripts.json`) として Unity に渡します。
ビルド時に `StreamingAssets/scripts.json` として配置されます。

```json
{
  "version": "1.0",
  "scripts": [
    {
      "id": "uuid-string",
      "trigger": {
        "type": "onStart | onUpdate | interval | event",
        "value": 5000
      },
      "code": "log('Hello Arsist!');",
      "enabled": true
    }
  ]
}
```

### trigger.value の型

| trigger.type | value の型 | 説明 |
|---|---|---|
| `onStart` | (未使用) | 起動時 1 回実行 |
| `onUpdate` | (未使用) | 毎フレーム実行 |
| `interval` | `number` (ms) | 例: `5000` = 5 秒ごと |
| `event` | `string` | 購読するイベント名 |

---

## サンドボックス制限

| 制限項目 | XREAL One | Meta Quest |
|---|---|---|
| メモリ上限 | 8 MB | 16 MB |
| 再帰深度 | 20 | 20 |
| 実行タイムアウト | 3 秒 | 3 秒 |
| .NET クラス直接アクセス | ❌ 不可 | ❌ 不可 |
| `async` / `await` | ❌ 不可 | ❌ 不可 |
| `Promise` | ❌ 不可 | ❌ 不可 |

---

## エラーハンドリング

| エラー種別 | 発生条件 | Unity ログ |
|---|---|---|
| `JavaScriptException` | JS 実行時エラー (未定義変数等) | `[ArsistScript:id] JS Runtime Error at line N: ...` |
| `StatementsCountOverflowException` | タイムアウト (3 秒超) | `[ArsistScript:id] タイムアウト: ...` |
| `MemoryLimitExceededException` | メモリ上限超過 | `[ArsistScript:id] メモリ制限超過: ...` |
| パースエラー | 不正な JSON bundle | `[ScriptTriggerManager] JSON パースエラー: ...` |
