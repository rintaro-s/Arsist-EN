# MCP Server - AI完全編集機能

## 概要

Arsist EngineのプロジェクトIRを完全にAIが編集可能にするModel Context Protocol (MCP) サーバーです。

## 利用可能なツール (17個)

### プロジェクト情報
- `ir_get_project` - プロジェクト概要取得

### モデル配置
- `ir_import_model_asset` - GLB/GLTFモデルインポート
- `ir_place_model` - シーンへのモデル配置
- `ir_list_scene_objects` - シーンオブジェクト一覧
- `ir_update_object_transform` - オブジェクト変形更新
- `ir_remove_scene_object` - オブジェクト削除
- `ir_add_canvas_object` - 3Dキャンバス配置

### UI編集
- `ir_add_ui_element` - UI要素追加
- `ir_update_ui_element` - UI要素更新
- `ir_remove_ui_element` - UI要素削除
- `ir_list_ui_layouts` - UIレイアウト一覧

### DataFlow編集
- `ir_add_datasource` - DataSource追加 (センサー/通信/時刻等)
- `ir_update_datasource` - DataSource更新
- `ir_remove_datasource` - DataSource削除
- `ir_add_transform` - Transform追加 (式計算/リマップ等)
- `ir_update_transform` - Transform更新
- `ir_remove_transform` - Transform削除

## 起動方法

### 1. GUI から起動 (推奨)

Arsist Editor のツールバーから「Server」アイコンをクリックして、MCPダイアログを開きます。
プロジェクトを開いた状態で「起動」ボタンをクリックするとMCPサーバーが起動します。

### 2. コマンドラインから起動

```bash
npm run mcp:ir
```

環境変数 `MCP_PROJECT_PATH` でプロジェクトパスを指定します。

## クライアント設定

### Claude Desktop の場合

MCPダイアログの「クライアント設定」セクションから設定JSONをコピーして、以下のファイルに追加します:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "arsist-ir": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["E:\\github\\Arsist\\scripts\\mcp-ir-server.mjs"],
      "env": {
        "MCP_PROJECT_PATH": "E:\\files\\ARs\\p2028a\\MyARApp"
      }
    }
  }
}
```

## 検証スクリプト

### 基本動作確認 (9ツール)

```bash
npm run verify:mcp -- "<project-path>" "<model-path>"
```

モデルのimport → 配置 → 更新 → 削除のCRUDサイクルを検証します。

### 完全機能テスト (17ツール)

```bash
npm run verify:mcp:full -- "<project-path>" "<model-path>"
```

全ツールの動作確認:
- DataSource/Transform の追加・更新・削除
- UI要素の追加・更新・削除
- モデル配置・変形・削除

## IR整合性チェック

```bash
npm run verify:ir -- "<project-path>"
```

project.json、scenes/*.json、UI/*.json の構造整合性を検証します。

## アーキテクチャ

- **Transport**: Stdio (標準入出力)
- **Protocol**: Model Context Protocol 1.0
- **IR Format**: JSON (project.json + scenes/*.json + UI/*.json)
- **データフロー**: DataSource → Transform → DataStore → UI

## セキュリティ

- プロジェクトパス外へのファイルアクセスは禁止
- Assets/* 以外への書き込みは制限
- IR構造の整合性を保証

## トラブルシューティング

### サーバーが起動しない

- Node.js 18以上がインストールされているか確認
- プロジェクトパスが正しく設定されているか確認
- `npm install` で依存関係をインストール

### Claude Desktop に表示されない

- claude_desktop_config.json の書式が正しいか確認 (JSON構文エラー)
- コマンドパスとargsが正しいか確認
- Claude Desktop を再起動

### ツールが実行できない

- `npm run verify:ir` でプロジェクトIRの整合性を確認
- stderr出力でエラーメッセージを確認
- project.json が破損していないか確認
