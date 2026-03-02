# VRM/シーンオブジェクト制御 - リファクタリング計画

## 現状の問題

### 1. 設計の根本的な欠陥
- **VRM専用実装** → 汎用性が完全にない
- WebSocketサーバーをエンジンに組み込み → 保守負担増加
- スクリプト機能との統合が不十分 → 競争状態とバグの温床

### 2. 実装上の問題
- ボーン回転でlocalRotationを直接設定 → 向き不一致
- BlendShape制御の信頼性が不確実
- メタデータ表示がエディタで実装されていない

### 3. ドキュメント問題
- 08_python_remote_control.mdが実装と大きく乖離
- Pythonサンプルが実装を反映していない

---

## 改善方針

### Phase 1: 汎用化（優先度：高）
```
目標: VRM専用制御 → 汎用SceneObject制御へ統一

現在:
  - scene.setPosition(id, x, y, z)
  - vrm.setExpression(id, name, value)
  - vrm.setBoneRotation(id, bone, p, y, r)

改善後:
  - scene.setPosition(id, x, y, z)           [汎用]
  - scene.setProperty(id, property, value)   [汎用]
  - vrm.setExpression(id, name, value)       [deprecated → scene経由で実現]
  - vrm.setBoneRotation → scene経由で実現
```

実装: PropertyControl system
- PropertyController コンポーネント (任意のGameObjectに付けられる)
- 表情・ボーン回転も "property" として扱う
- スクリプト + WebSocket の両方で汎用的にアクセス可能

### Phase 2: ボーン回転の修正（優先度：高）
```
問題:
  localRotationを直接設定
  → 親の回転と混在
  → アニメーションとぶつかる

解決:
  1. ボーンの状態を管理するコンポーネント (BoneController)
  2. weighting mechanism で Animation との合成を実装
  3. World座標 → Local座標の変換を正確に実装
```

### Phase 3: エディタUI（優先度：中）
```
実装: カスタムインスペクター拡張
  - VRM読込時にメタデータ表示
  - Inspector右パネル: 表情・ボーン一覧表示
  - 能力検出ボタン
```

### Phase 4: ドキュメント修正（優先度：中）
```
08_python_remote_control.md:
  - 実装の正確な仕様を記載
  - サンプルコード修正
  - 汎用scene制御の説明を中心に
```

---

## 実装スケジュール

### Week 1:
1. PropertySystem の基本設計と実装
2. SceneWrapper の汎用化
3. 既存 VRM 制御の PropertySystem への移植

### Week 2:
1. BoneController の実装
2. ボーン回転ロジックの修正
3. BlendShape 制御の信頼性改善

### Week 3:
1. エディタUI拡張
2. ドキュメント修正
3. テストと検証

---

## 後方互換性

- 既存の `vrm.*` API は deprecated として残す
- 内部的には PropertySystem へ委譲
- 段階的に scene.* への移行を推奨
