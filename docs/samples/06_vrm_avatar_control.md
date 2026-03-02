# サンプル 06: VRMアバター制御

このサンプルでは、`vrm` APIを使ってVRMモデルの表情やボーンを制御する方法を示します。

## 概要

- VRMモデルを配置
- 表情（BlendShape）を変更
- ボーンを操作してポーズを作る
- 視線制御

---

## 手順

### 1. VRMモデルを配置

1. エディタの「シーン」タブを開く
2. VRMファイル（.vrm）をインポート
3. シーンに配置
4. プロパティパネルで **Asset ID** を `avatar` に設定

### 2. スクリプトを作成

#### スクリプト1: 起動時に配置とポーズ設定

**トリガー:** `onStart`

```javascript
// アバターを目の前に配置
scene.setPosition('avatar', 0, 0, 2);
scene.setRotation('avatar', 0, 180, 0); // こちらを向かせる

// 初期表情を設定
vrm.resetExpressions('avatar');
vrm.setExpression('avatar', 'Joy', 50); // 少し笑顔

log('VRMアバターを配置しました');
```

#### スクリプト2: 手を振るポーズ

**トリガー:** `event` (イベント名: `wave_hand`)

```javascript
// 右腕を上げて手を振るポーズ
vrm.setBoneRotation('avatar', 'RightUpperArm', 0, 0, -90);
vrm.setBoneRotation('avatar', 'RightLowerArm', -30, 0, 0);

// 笑顔にする
vrm.setExpression('avatar', 'Joy', 100);

log('手を振りました');
```

#### スクリプト3: 表情を変える

**トリガー:** `event` (イベント名: `change_expression`)

```javascript
// ランダムに表情を変える
var expressions = ['Joy', 'Angry', 'Sorrow', 'Fun'];
var randomIndex = Math.floor(Math.random() * expressions.length);
var expr = expressions[randomIndex];

vrm.resetExpressions('avatar');
vrm.setExpression('avatar', expr, 100);

log('表情を変更: ' + expr);
```

#### スクリプト4: まばたきアニメーション

**トリガー:** `onUpdate`

```javascript
// Jint で動く実装（setTimeout/store を使わない）
if (!window._blinkState) {
  window._blinkState = {
    isClosing: false,
    lastBlinkAt: 0,
    closeAt: 0,
    intervalMs: 5000,
    closeMs: 200
  };
}

var now = Date.now();
var s = window._blinkState;

if (!s.isClosing && (now - s.lastBlinkAt) >= s.intervalMs) {
  vrm.setExpression('avatar', 'Blink', 100);
  s.isClosing = true;
  s.closeAt = now;
}

if (s.isClosing && (now - s.closeAt) >= s.closeMs) {
  vrm.setExpression('avatar', 'Blink', 0);
  s.isClosing = false;
  s.lastBlinkAt = now;
}
```

#### スクリプト5: 視線追従

**トリガー:** `onUpdate`

```javascript
// カメラ位置を見る（簡易実装）
// 実際のカメラ位置は取得できないため、固定位置を見る
vrm.lookAt('avatar', 0, 1.6, 0);
```

---

## UIボタンを追加

1. 「UI」タブでボタンを3つ追加
2. それぞれのイベント名を設定:
   - ボタン1: `wave_hand` (テキスト: "手を振る")
   - ボタン2: `change_expression` (テキスト: "表情変更")

---

## 実行結果

- アプリ起動時、VRMアバターが目の前に表示される
- 「手を振る」ボタンで手を振るポーズになる
- 「表情変更」ボタンでランダムに表情が変わる
- 5秒ごとに自動でまばたきする

---

## 応用例

### 複数の表情を組み合わせる

```javascript
// 笑顔で口を開ける
vrm.setExpression('avatar', 'Joy', 80);
vrm.setExpression('avatar', 'A', 50);
```

### ダンスモーション

```javascript
// interval: 100ms で実行
var time = Date.now() / 1000;

// 腕を上下に動かす
var armAngle = Math.sin(time * 3) * 45;
vrm.setBoneRotation('avatar', 'RightUpperArm', 0, 0, armAngle);
vrm.setBoneRotation('avatar', 'LeftUpperArm', 0, 0, -armAngle);

// 体を左右に揺らす
var spineAngle = Math.sin(time * 2) * 10;
vrm.setBoneRotation('avatar', 'Spine', 0, spineAngle, 0);
```

### 感情に応じた表情とポーズ

```javascript
// 外部イベントなどで window._emotion = 'happy' のように設定しておく
var emotion = window._emotion || 'neutral';

if (emotion === 'happy') {
  vrm.setExpression('avatar', 'Joy', 100);
  vrm.setBoneRotation('avatar', 'RightUpperArm', 0, 0, -90);
  vrm.setBoneRotation('avatar', 'LeftUpperArm', 0, 0, 90);
} else if (emotion === 'sad') {
  vrm.setExpression('avatar', 'Sorrow', 100);
  vrm.setBoneRotation('avatar', 'Head', 20, 0, 0); // 下を向く
}
```

---

## VRM標準表情一覧

VRM 0.x / 1.0 で一般的にサポートされている表情：

- **Joy** — 喜び
- **Angry** — 怒り
- **Sorrow** — 悲しみ
- **Fun** — 楽しい
- **Blink** — まばたき
- **Blink_L** — 左目まばたき
- **Blink_R** — 右目まばたき
- **A**, **I**, **U**, **E**, **O** — 口の形（あいうえお）

**注意:** モデルによって実装されている表情は異なります。
