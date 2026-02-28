
1. エディタ（Electron）起動とプロジェクト管理  
   - `src/main/main.ts` が Electron メインプロセス。メニュー操作や IPC を通じて UI にイベントを送る。  
   - `ProjectManager` (`src/main/project/ProjectManager.ts`) がプロジェクトの生成/読込/保存/エクスポートを担当。ファイル構造は DataSource→DataStore→UI の三層で、Scenes/UI/DataFlow を個別 JSON に保持する。  
   - `AdapterManager` (`src/main/adapters/AdapterManager.ts`) は Adapters ディレクトリ配下のデバイスごとパッチ（Manifest/EditorScripts/Packages 等）を列挙し、ビルド時に Unity プロジェクトへ適用できる。  

2. ビルドワークフロー  
   - `ipcMain.handle('unity:build', …)` でレンダラからビルド要求を受け、`UnityBuilder` (`src/main/unity/UnityBuilder.ts`) を呼出。  
   - Unity パス検証→データ転送 (`transferProjectData` で manifest/scenes/ui/dataflow/Assets を `Assets/ArsistGenerated` などへコピー)→ターゲットデバイス向けパッチ適用 (`applyDevicePatch` で AndroidManifest や Editor script を差し替え)→SDK 統合→Unity CLI ビルド→ output 検証という段階的パイプラインになっている。ライセンスまわりのリトライや GUI fallback まで実装済み。  
   - エクスポート時には DataFlow/Scripts/Assets もまとめて JSON や Unity 用フォルダに出力され、Unity 側でそのまま参照できるように整備される。  

3. Unity ランタイムロジック  
   - Unity プロジェクト (`UnityBackend/ArsistBuilder`) 内の `ArsistDataFlowEngine` (`Assets/Arsist/Runtime/DataFlow/ArsistDataFlowEngine.cs`) が `Resources/ArsistManifest` などから manifest を読み込み、`dataFlow` セクションを解析。  
   - `dataSources` エントリごとにランナーを生成・起動し、`transforms` はコルーチンで処理。これにより Electron 側で設計した DataFlow 定義がランタイムで有効になり、外部データ取得→変換→UI 反映といった処理を Unity 上で実行する。  

4. 補助構造  
   - 共通型は `src/shared/types.ts` に集約され、DataFlow 定義や AR 設定などの構造体を Electron/Renderer/Unity 間で共有。  
   - [CanvasInitializer](cci:2://file:///e:/GITS/Arsist/UnityBackend/ArsistBuilder/Assets/Arsist/Runtime/UI/CanvasInitializer.cs:16:4-347:5) 等の Unity Runtime UI コンポーネントが、ビルド済み Canvas の Camera 割当・TMP フォント準備などを自動処理し、XR カメラとの整合性を保つ。  

この一連の流れで「Electron でプロジェクトを作成→JSON/Asset を Unity 用フォーマットへ整備→デバイス別アダプターを適用→Unity でビルド→ランタイムで DataFlow/Canvas を初期化」というワークフローが成立しています。