# Arsist Engine

ArsistはARグラス向けのクロスプラットフォーム開発エンジンです。ElectronとReactで構築されたエディタにより、シーン、UI、ロジックを統合的に編集し、Unityのバッチビルドを通じて実機向けアプリを生成します。


要件

## 開発環境

- Node.js 18以上
- XREAL SDK 3.1.0
- Meta Quest SDK（`sdk/quest` 配下の `com.meta.xr.sdk.core-*.tgz`）
- UniVRM

## 起動方法


```bash
npm install
npm run dev
```


## ビルド手順

1. 設定画面でUnityパスと必要バージョンを設定
2. プロジェクトを作成/開く
3. ビルドダイアログから出力先とデバイスを指定して実行

## 設定とカスタマイズ

### 1. Unity設定

設定ダイアログで以下を指定できます。

- Unityパス
- 必要なUnityバージョン

指定したUnityバージョン以上でのみビルドが実行されます。

## デバイスアダプター

アダプターは `Adapters/` 配下に配置されます。XREAL Oneのアダプター例:

```
Adapters/XREAL_One/
├── adapter.json
├── AndroidManifest.xml
├── XrealBuildPatcher.cs
└── README.md
```

## プロジェクト構成

```
Arsist/
├── src/
│   ├── main/          # Electronメインプロセス
│   ├── renderer/      # React UI
│   ├── bridge/        # Unity変換層
│   └── shared/        # 共有型定義
├── UnityBackend/      # Unityビルド用プロジェクト
└── Adapters/          # デバイスアダプター
```

## 想定SDK配下
```ps
(.venv) PS E:\GITS\Arsist> ls sdk

    Directory: E:\GITS\Arsist\sdk

Mode                 LastWriteTime         Length Name
----                 -------------         ------ ----
d----          2026/02/23    22:57                com.xreal.xr
d----          2026/02/27    20:21                nupkg
d----          2026/02/23    22:57                quest
-a---          2026/02/28    10:48        1863320 JKG-M_3.ttf
-a---          2026/02/28    15:21        1128378 JKG-M3.unitypackage
-a---          2026/03/01    12:39        6613914 UniVRM-0.131.0_3b99.unitypackage

```