# 3Dアセット動的制御ロジック 設計ドキュメント

## 1. 概要
本ドキュメントは、Arsistプロジェクトにおいて、Reactフロントエンドで定義したロジック（JavaScript）を用いて、Unity空間上の3Dアセット（GLBモデル、空間Canvas、VRMモデルなど）を動的に操作するための実装方法とAPI設計を定義します。

既存のJint統合（`script.md`）をベースとし、**「確実かつ単純に実装できる方法」**として、ステートレスなIDベースのAPI呼び出しを採用します。

---

## 2. 基本アプローチ（確実・単純な実装）

JavaScript（Jint）側で複雑なオブジェクトのインスタンス（クラスや参照）を持たせず、**フラットな関数呼び出し（ステートレスAPI）**と**文字列IDによる対象指定**を採用します。

これにより、JintとUnity（C#）間のオブジェクトのマーシャリング（変換）コストや、ガベージコレクションの複雑さを排除し、IL2CPP環境でも安全かつ確実に動作します。

### 仕組み
1. **IDの付与**: エディタ（React）上で配置した3Dオブジェクト（GLB, Canvas等）に一意の文字列ID（例: `enemy_01`, `main_menu`）を付与する。
2. **APIの公開**: Unity側で `SceneWrapper` クラスを作成し、Jintエンジンに `scene` オブジェクトとして登録する。
3. **操作の実行**: JSから `scene.setPosition("enemy_01", 1, 0, 2)` のように呼び出し、Unity側でIDに紐づくGameObjectのTransformを更新する。

---

## 3. API設計 (Jintに公開するラッパー)

### 3.1 Transform操作 (位置・回転・スケール)
すべての3Dオブジェクト（GLB、Canvas、空のノードなど）に共通する基本的な空間操作です。

```javascript
// 位置の指定 (ワールド座標系)
scene.setPosition(id, x, y, z);
// 現在位置からの相対移動
scene.move(id, deltaX, deltaY, deltaZ);

// 回転の指定 (オイラー角: 度数法)
scene.setRotation(id, pitch, yaw, roll);
// 現在の回転からの相対回転
scene.rotate(id, deltaPitch, deltaYaw, deltaRoll);

// スケールの指定
scene.setScale(id, x, y, z);
```

### 3.2 アニメーション制御 (GLB等)
GLBファイルなどに含まれるビルトインのアニメーションクリップ（AnimationClip）の再生制御です。

```javascript
// アニメーションの再生 (ループ設定などはUnity側のインポート設定に依存、または引数で指定)
scene.playAnimation(id, "Walk");
// アニメーションの停止
scene.stopAnimation(id);
// アニメーションの再生速度変更
scene.setAnimationSpeed(id, 1.5);
```

### 3.3 空間Canvas (3D UI) の制御
空間に配置されたCanvas自体は、通常の3Dオブジェクトと同様に `scene.setPosition` 等で移動可能です。
Canvas内のUI要素（テキストや画像）の操作は、既存の `ui` APIを拡張して、階層パス（または要素ID）で指定します。

```javascript
// 空間Canvas自体の移動
scene.setPosition("main_canvas", 0, 1.5, 2.0);

// Canvas内のテキスト更新 (ID: "main_canvas" の中の "score_text")
ui.setText("main_canvas/score_text", "Score: 100");
// Canvas内の画像カラー変更
ui.setColor("main_canvas/bg_panel", "#FF0000");
```

---

## 4. Unity側の実装イメージ (C#)

Unity側では、シーン内の動的オブジェクトをDictionaryで管理し、Jintからの呼び出しを中継するラッパークラスを実装します。

```csharp
using UnityEngine;
using System.Collections.Generic;

// Jintに "scene" として登録されるクラス
public class SceneWrapper 
{
    // IDとGameObjectの紐付け辞書
    private Dictionary<string, GameObject> _dynamicObjects = new Dictionary<string, GameObject>();

    // シーンロード時などにオブジェクトを登録する
    public void RegisterObject(string id, GameObject obj) 
    {
        _dynamicObjects[id] = obj;
    }

    // JSから呼ばれる位置設定メソッド
    public void setPosition(string id, float x, float y, float z) 
    {
        if (_dynamicObjects.TryGetValue(id, out var obj)) 
        {
            obj.transform.position = new Vector3(x, y, z);
        }
        else 
        {
            Debug.LogWarning($"Object with ID '{id}' not found.");
        }
    }

    // JSから呼ばれるアニメーション再生メソッド
    public void playAnimation(string id, string animName) 
    {
        if (_dynamicObjects.TryGetValue(id, out var obj)) 
        {
            var animator = obj.GetComponent<Animator>();
            if (animator != null) 
            {
                animator.Play(animName);
            }
        }
    }
    
    // ... 他のメソッドも同様に実装
}
```

---

## 5. VRMモデルの制御について (将来拡張 / Advanced)

VRMモデルのボーン単位の制御や表情（BlendShape）の制御は、非常に複雑になる可能性があるため初期実装からは除外可能ですが、APIとしては以下のようにシンプルに設計できます。

Unityの `Animator.GetBoneTransform(HumanBodyBones)` を利用することで、VRMのHumanoidボーンを直接操作します。

```javascript
// VRM専用のAPIラッパー "vrm" を想定

// ボーンの回転 (例: 右腕を上げる)
// ボーン名はUnityのHumanBodyBones列挙型に準拠した文字列
vrm.setBoneRotation(id, "RightUpperArm", pitch, yaw, roll);

// 表情(BlendShape/Expression)の制御 (0.0 ~ 1.0)
vrm.setExpression(id, "Joy", 1.0);
vrm.setExpression(id, "Sorrow", 0.0);
```

**Unity側の実装イメージ (VRMボーン制御):**
```csharp
public void setBoneRotation(string id, string boneName, float pitch, float yaw, float roll) 
{
    if (_dynamicObjects.TryGetValue(id, out var obj)) 
    {
        var animator = obj.GetComponent<Animator>();
        if (animator != null && System.Enum.TryParse<HumanBodyBones>(boneName, out var bone)) 
        {
            Transform boneTransform = animator.GetBoneTransform(bone);
            if (boneTransform != null) 
            {
                // LateUpdate等で上書きされるアニメーションとの競合に注意が必要
                boneTransform.localRotation = Quaternion.Euler(pitch, yaw, roll);
            }
        }
    }
}
```
*※注意: ボーンを直接操作する場合、Animatorによる既存のアニメーション再生と競合するため、Unity側で `LateUpdate` のタイミングで適用するなどの工夫が必要になります。*

---

## 6. フロントエンド (React) でのオーサリングフロー

1. **配置**: ユーザーがエディタのビューポート上でGLBモデルやCanvasを配置する。
2. **ID設定**: プロパティパネルで、そのオブジェクトに一意の「ID」を設定する（例: `player_model`）。
3. **ロジック記述**: ロジックエディタ（JS）で、トリガー（例: 毎フレーム更新、ボタンクリック）に対して以下のように記述する。
   ```javascript
   // 毎フレーム呼ばれるUpdate関数などの想定
   scene.move('player_model', 0, 0, 0.1); // 前進させる
   ```
4. **エクスポート**: JSON IRとして出力され、Unity側でパース・実行される。
