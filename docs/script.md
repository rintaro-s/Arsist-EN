# Arsist 動的スクリプティングシステム (Jint統合) テクニカルデザインドキュメント

## 1. 概要とアーキテクチャ
本システムは、Reactフロントエンドでユーザーが定義したJavaScriptコードをJSONの中間表現（IR）としてパッケージ化し、Unity（Quest/IL2CPP環境）上で安全に解釈・実行する仕組みです。
C#製のJavaScriptインタプリタである**Jint**を採用することで、プラットフォームの制限を回避しつつ、APIリクエスト、ポーリング、UI更新などの動的な振る舞いを実現します。

### アーキテクチャフロー
1. **React (Frontend):** ユーザーがJSコードを記述し、トリガー条件（起動時、クリック時、定期実行など）を設定。JSON IRとしてエクスポート。
2. **Bridge:** JSON IRをUnity側に送信（またはファイルとして保存しUnityが読み込む）。
3. **Unity (Backend):** JSONをパースし、Jintエンジンを初期化。安全なラッパーAPI（`api`, `ui`など）をJint環境に注入。
4. **Execution:** トリガーに応じてJintがJSコードを評価。非同期処理はC#のコルーチンに委譲され、コールバックを通じてJSに結果を返す。

---

## 2. 安全性とIL2CPP (Quest) 互換性について

### なぜJintなのか？（IL2CPP互換性）
Quest向けのビルドでは**IL2CPP**（AOTコンパイル）が必須であり、実行時の動的なコード生成（`System.Reflection.Emit`など）が禁止されています。Jintはコードをコンパイルするのではなく、抽象構文木（AST）を構築して解釈する純粋なインタプリタであるため、**IL2CPP環境でも完全に動作します**。

### セキュリティとサンドボックス化（Safety）
ユーザーが記述したスクリプトがシステムを破壊したり、無限ループでフリーズさせたりするのを防ぐため、以下の対策を講じます。
1. **.NETクラスの隠蔽:** Jintのデフォルト設定では、JSから.NETのクラス（`System.IO`や`UnityEngine`など）にはアクセスできません。明示的に許可したラッパークラスのみを公開します。
2. **リソース制限:** Jintの機能を用いて、メモリ使用量、再帰の深さ、実行時間のタイムアウトを設定し、無限ループやメモリリークによるクラッシュを防ぎます。
3. **コードストリッピング対策:** IL2CPPのビルド時に、Jintからリフレクションで呼び出されるC#のメソッドが削除されないよう、`link.xml`または`[Preserve]`属性を使用します。

---

## 3. フロントエンド実装 (React) - JSON IRの生成

React側では、スクリプトのメタデータとコード本体を構造化してJSONとして出力します。

**JSON IRの構造例:**
```json
{
  "version": "1.0",
  "scripts": [
    {
      "id": "fetch_weather_data",
      "trigger": {
        "type": "interval",
        "value": 5000 // 5秒ごとに実行
      },
      "code": "api.get('https://api.weather.com/current', function(res) { ui.setText('tempText', res.temperature + '°C'); });"
    },
    {
      "id": "on_button_click",
      "trigger": {
        "type": "event",
        "value": "btn_refresh"
      },
      "code": "ui.setColor('bgPanel', '#FF0000');"
    }
  ]
}
```

---

## 4. バックエンド実装 (Unity/C#)

### 4.1 Jintの初期化とサンドボックス設定
Unity側でJintエンジンをインスタンス化し、制限を設けます。

```csharp
using Jint;
using UnityEngine;

public class ScriptEngineManager : MonoBehaviour
{
    private Engine _engine;

    void Start()
    {
        // サンドボックス化されたエンジンの初期化
        _engine = new Engine(cfg => cfg
            .LimitMemory(4_000_000) // メモリ制限 (例: 4MB)
            .LimitRecursion(10)     // 再帰の深さ制限
            .TimeoutInterval(System.TimeSpan.FromSeconds(2)) // 実行タイムアウト(無限ループ対策)
        );

        // 安全なAPIラッパーのみをJS環境に公開
        _engine.SetValue("api", new ApiWrapper());
        _engine.SetValue("ui", new UiWrapper());
        _engine.SetValue("log", new System.Action<string>(Debug.Log));
    }

    public void ExecuteScript(string jsCode)
    {
        try
        {
            _engine.Execute(jsCode);
        }
        catch (Jint.Runtime.JavaScriptException ex)
        {
            Debug.LogError($"JS Runtime Error: {ex.Message} at line {ex.Location.Start.Line}");
        }
        catch (System.Exception ex)
        {
            Debug.LogError($"Script Execution Error: {ex.Message}");
        }
    }
}
```

### 4.2 非同期APIリクエストの処理 (UnityWebRequest)
Jint自体は同期的に動作するため、非同期処理（`async/await`や`Promise`）の完全なサポートは複雑です。最も安全で確実な方法は、**コールバック関数**を使用し、実際の非同期処理はUnityのコルーチンで行うことです。

```csharp
using Jint.Native;
using UnityEngine.Networking;
using System.Collections;
using UnityEngine;

[UnityEngine.Scripting.Preserve] // IL2CPPのストリッピング防止
public class ApiWrapper
{
    // JSから api.get(url, callback) として呼ばれる
    public void get(string url, JsValue callback)
    {
        // Unityのメインスレッドでコルーチンを開始
        CoroutineRunner.Instance.StartCoroutine(GetRequestCoroutine(url, callback));
    }

    private IEnumerator GetRequestCoroutine(string url, JsValue callback)
    {
        using (UnityWebRequest webRequest = UnityWebRequest.Get(url))
        {
            yield return webRequest.SendWebRequest();

            if (webRequest.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError("API Error: " + webRequest.error);
                // 必要に応じてエラーコールバックを実装
            }
            else
            {
                // JSのコールバック関数を実行 (メインスレッドで安全に実行される)
                if (callback.IsObject() && callback.AsObject().Class == "Function")
                {
                    // JSON文字列をパースしてJSオブジェクトとして渡すことも可能
                    callback.Invoke(webRequest.downloadHandler.text);
                }
            }
        }
    }
}
```
*(※ `CoroutineRunner` は `MonoBehaviour` を継承したシングルトンクラスを用意し、非MonoBehaviourクラスからコルーチンを起動できるようにします)*

### 4.3 UI要素へのバインディング
スクリプトからUnityのUIを操作するためのラッパーです。直接GameObjectを触らせず、IDベースで管理します。

```csharp
[UnityEngine.Scripting.Preserve]
public class UiWrapper
{
    public void setText(string elementId, string text)
    {
        // IDに基づいてUI要素を検索し、テキストを更新する処理
        // 例: UIManager.Instance.UpdateText(elementId, text);
    }

    public void setVisibility(string elementId, bool isVisible)
    {
        // UIの表示/非表示切り替え
    }
}
```

---

## 5. ステップバイステップ実装計画

エラーを最小限に抑えるため、以下のフェーズに分けて実装を進めます。

### Phase 1: 基礎検証 (Proof of Concept)
1. UnityプロジェクトにJintのDLL（またはNuGetパッケージ）を導入する。
2. 空のシーンで `ScriptEngineManager` を作成し、`log('Hello World');` がUnityコンソールに出力されるか確認する。
3. **Quest実機ビルド検証:** この時点で一度Quest向けにIL2CPPビルドを行い、Jintが正常に動作するか（AOTエラーが出ないか）を必ず確認する。

### Phase 2: APIと非同期処理の実装
1. `ApiWrapper` と `CoroutineRunner` を実装する。
2. JSコードから `api.get` を呼び出し、ダミーのREST API（JSONPlaceholderなど）からデータを取得してコールバックでログ出力できるか確認する。
3. `link.xml` を設定し、`ApiWrapper` のメソッドがビルド時に削除されないようにする。

### Phase 3: UIバインディングとJSON IRパーサー
1. `UiWrapper` を実装し、シーン上の特定のTextMeshPro等のテキストをJSから変更できるようにする。
2. React側でJSON IRを生成するロジックを作成する。
3. Unity側で `Newtonsoft.Json` 等を用いてJSON IRをパースし、`trigger` の条件（起動時、インターバルなど）に従ってスクリプトを登録・実行するマネージャー（`ScriptTriggerManager`）を実装する。

### Phase 4: エラーハンドリングとセキュリティ強化
1. Jintの初期化設定で `LimitMemory` と `TimeoutInterval` を厳格に設定する。
2. 意図的に無限ループするJSコード（`while(true){}`）を実行させ、Unityがフリーズせずにタイムアウト例外をキャッチして安全に停止することを確認する。
3. React側のUIに、スクリプトのエラーログを表示するデバッグパネルを実装する。

---

## 6. エラーハンドリングとデバッグ戦略

* **JS構文エラー:** Jintの `Execute()` 時に `Jint.Parser.ParserException` がスローされます。これをキャッチし、React側のUI（またはUnityのデバッグUI）に「何行目で構文エラーが発生したか」をフィードバックします。
* **実行時エラー:** 未定義の変数へのアクセスなどは `Jint.Runtime.JavaScriptException` としてキャッチされます。
* **タイムアウト:** `TimeoutInterval` を超えた場合、`Jint.Runtime.StatementsCountOverflowException` 等が発生します。これによりメインスレッドのフリーズを完全に防ぎます。
* **デバッグログの提供:** JS側に `log(message)` や `error(message)` 関数を提供し、ユーザーが自身のスクリプト内で `console.log` のようにデバッグできるようにします。これらのログはUnityのコンソールだけでなく、アプリ内のデバッグウィンドウにもルーティングするとUXが向上します。
