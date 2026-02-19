# Arsist Engine

ArsistはARグラス向けのクロスプラットフォーム開発エンジンです。ElectronとReactで構築されたエディタにより、シーン、UI、ロジックを統合的に編集し、Unityのバッチビルドを通じて実機向けアプリを生成します。

## ドキュメント

- [docs/authoring.md](docs/authoring.md): UI/ロジックの作り方（複数手段）と“ビルドに何が効くか”
- [docs/engine_requirements.md](docs/engine_requirements.md): 「Unity/UEの上澄み」を取るために必要な要件（優先度つき）

## 特徴

- 3Dシーン編集、2D UI編集、ビジュアルロジックの統合
- Unity CLIによる自動ビルド
- デバイスアダプターによる拡張可能なSDKパッチ機構
- `sdk/quest` のMeta XR SDK（.tgz）を使ったQuest向けビルド
- レイアウトやUnityバージョン指定などの詳細設定

## 開発環境

- Node.js 18以上
- Unity 2022.3.20f1 LTS 以上を推奨
- XREAL SDK 3.1.0
- Meta Quest SDK（`sdk/quest` 配下の `com.meta.xr.sdk.core-*.tgz`）

## 起動方法

```bash
npm install
npm run dev
```

## VS Codeで開く

このリポジトリ直下で:

```bash
code .
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

### 2. レイアウト設定

設定ダイアログから以下を調整できます。

- 左パネル幅
- 右パネル幅
- 下パネル高さ

変更は自動保存され、次回起動時に復元されます。

### 3. 出力先の既定値

ビルドの出力先を設定で保存できます。

## Unityビルドの安定化

Unityビルダーは以下を行います。

- Unity実行ファイルとプロジェクト構成の検証
- ビルド中の重複実行の防止
- タイムアウト処理
- Unityログのエラー解析
- ビルド成果物の検出

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

## ライセンス

MIT License
