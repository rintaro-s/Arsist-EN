# サンプル 04: スコアカウンター (永続データ活用)

ゲーム的なスコアカウンターを実装します。永続データでハイスコアを保持します。

## スクリプト構成

| スクリプト名 | トリガー | 役割 |
|---|---|---|
| `ScoreInit` | `onStart` | スコア初期化・ハイスコア復元 |
| `ScoreIncrement` | `event: btn_score` | スコア加算ボタン |
| `ScoreReset` | `event: btn_reset` | スコアリセットボタン |

---

## Script 1: ScoreInit (onStart)

```javascript
// スコアをリセットして初期化、ハイスコアを復元

store.set('currentScore', 0);
ui.setText('scoreDisplay', '0');

var hi = store.get('highScore');
if (hi === null) hi = 0;
ui.setText('highScoreDisplay', 'HI: ' + String(hi));

log('ScoreInit 完了 (ハイスコア: ' + hi + ')');
```

---

## Script 2: ScoreIncrement (event: btn_score)

```javascript
// スコアを +10 して表示更新

var current = store.get('currentScore');
if (current === null) current = 0;

current = current + 10;
store.set('currentScore', current);
ui.setText('scoreDisplay', String(current));

// ハイスコア更新チェック
var hi = store.get('highScore');
if (hi === null) hi = 0;

if (current > hi) {
  store.set('highScore', current);
  ui.setText('highScoreDisplay', 'HI: ' + String(current));
  ui.setColor('highScoreDisplay', '#FFD700');  // 新記録: ゴールド
  event.emit('new_highscore', { score: current });
  log('新ハイスコア！ ' + current);
} else {
  ui.setColor('highScoreDisplay', '#FFFFFF');
}
```

---

## Script 3: ScoreReset (event: btn_reset)

```javascript
// スコアをリセット

store.set('currentScore', 0);
ui.setText('scoreDisplay', '0');
ui.setColor('scoreDisplay', '#FFFFFF');
log('スコアリセット');
```

---

## UI 設定

| Binding ID | 要素 | 説明 |
|---|---|---|
| `scoreDisplay` | Text | 現在のスコア |
| `highScoreDisplay` | Text | ハイスコア |
| `btn_score` | Button | +10 ボタン (イベント: `btn_score`) |
| `btn_reset` | Button | リセットボタン (イベント: `btn_reset`) |
