# サンプル 08: Python リモートコントロール - 正訂版

**注意**: このドキュメントは2026-03-02版です。最新の実装に基づいています。

## 重要な変更事項（2026-03-02）

1. **汎用化**: VRM専用ではなく、すべてのシーンオブジェクトを `scene.*` API で統一制御
2. **PropertySystem**: ボーン回転と表情制御がPropertyController経由で実装
3. **エディタUI**: VRM読込時にInspectorに能力情報を表示

---

## セットアップ

### 1. エンジン設定

Arsist エディタで以下を有効化：
- **プロジェクト設定 → リモートコントロール有効化**: ✅
- **WebSocketポート**: 8765
- **認証パスワード**: 任意

### 2. VRM メタデータ検出

VRMを選択 → Inspector右パネル → 「🔍 Detect Capabilities」

これにより、利用可能な表情・ボーン一覧が表示されます。

---

## 実装（Control.py参照）

本リポジトリの `python/Control.py` に完全な実装があります。以下は簡略版：

```python
from Control import ArsistRemoteController

# 接続
ctrl = ArsistRemoteController("192.168.1.100", port=8765, password="pass")
ctrl.connect()

# VRM操作（汎用scene API経由）
ctrl.set_expression("avatar", "Joy", 100)
ctrl.set_bone_rotation("avatar", "RightUpperArm", 0, 0, -90)

# 位置移動（汎用API）
ctrl.set_position("avatar", 0, 1.5, 0)

ctrl.disconnect()
```

---

## 実装の仕組み

```
Python Client
    ↓ WebSocket
Arsist Engine
    ↓
SceneWrapper (汎用scene.* API)
    ↓
PropertyController (任意のGameObject)
    ├→ BlendShapeProperty (表情)
    └→ BoneProperty (ボーン回転)
```

VRM、3Dオブジェクト、UIなど、すべてのオブジェクトに同じAPIでアクセス可能です。

---

## API リファレンス

### scene.* （汎用制御）

- `setPosition(id, x, y, z)` - 位置設定
- `move(id, dx, dy, dz)` - 相対移動
- `setRotation(id, pitch, yaw, roll)` - 回転設定
- `setBoneRotation(id, bone, pitch, yaw, roll)` - ボーン回転
- `setBlendShapeWeight(id, name, value)` - 表情設定

### vrm.* （VRM互換API）

- `setExpression(id, name, value)` - 表情設定
- `setBoneRotation(id, bone, pitch, yaw, roll)` - ボーン回転
- `resetExpressions(id)` - 表情リセット

### query.* （情報取得）

- `getIds()` - 登録ID一覧
- `getInfo(id)` - VRM能力情報
- `getState(id)` - Transform状態
- `ping()` - 通信確認

---

## 詳細な例

[Control.py](../Control.py) を参照してください。
