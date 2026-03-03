# サンプル 09: Discord Bot チャンネル表示（最大10件）- 修正版

Discord Bot を起動し、指定チャンネルに投稿されたメッセージを Arsist 側で表示するサンプルです。

## 重要なトラブルシューティング

**表示されない場合:**
1. **Python スクリプトが起動しているか確認** → cmd/PowerShell でコンソール出力を確認
2. **ローカルIP アドレスを確認** → Python 起動時に `[Init] Starting HTTP server on 192.168.x.x:8781` と表示される
3. **Jint スクリプト内の endpoint を変更** → 上記IP に変更する必要があります
4. **Binding ID `discord_feed_text` が UI に存在するか確認**
5. **デバイスのコンソールログを確認** → `[Discord]` で始まるログが出ているか

---

## Python スクリプト（改良版・エラー出力付き）

`discord_bridge.py`:

```python
#!/usr/bin/env python3
import os
import sys
import threading
import socket
from collections import deque
from flask import Flask, jsonify

try:
    import discord
except ImportError:
    print('[ERROR] discord.py not installed. Run: pip install discord.py flask')
    sys.exit(1)

# 環境変数確認
try:
    DISCORD_TOKEN = os.environ['DISCORD_BOT_TOKEN']
    CHANNEL_ID = int(os.environ['DISCORD_CHANNEL_ID'])
except KeyError as e:
    print(f'[ERROR] Missing env variable: {e}')
    print('Set: DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID')
    sys.exit(1)

HTTP_PORT = int(os.environ.get('DISCORD_BRIDGE_PORT', '8781'))
try:
    HOST_IP = socket.gethostbyname(socket.gethostname())
except:
    HOST_IP = '127.0.0.1'

messages = deque(maxlen=10)

class DiscordBot(discord.Client):
    async def on_ready(self):
        print(f'[Discord] Logged in as {self.user}')
        ch = self.get_channel(CHANNEL_ID)
        if ch:
            print(f'[Discord] Listening to channel: {ch.name} (ID: {ch.id})')
        else:
            print(f'[Discord] ERROR: Channel {CHANNEL_ID} not found!')

    async def on_message(self, msg: discord.Message):
        if msg.author.bot or msg.channel.id != CHANNEL_ID:
            return
        try:
            messages.appendleft({
                'id': str(msg.id),
                'author': msg.author.display_name,
                'content': msg.content[:100],  # 100文字制限
                'ts': msg.created_at.isoformat(),
            })
            print(f'[Message] {msg.author.display_name}: {msg.content[:50]}...')
        except Exception as e:
            print(f'[Message ERROR] {e}')

app = Flask(__name__)

@app.get('/messages')
def get_messages():
    try:
        return jsonify({'items': list(messages), 'count': len(messages)})
    except Exception as e:
        print(f'[HTTP ERROR] /messages: {e}')
        return jsonify({'error': str(e), 'items': []}), 500

def run_http():
    print(f'[HTTP] Server on http://{HOST_IP}:{HTTP_PORT}')
    try:
        app.run(host='0.0.0.0', port=HTTP_PORT, debug=False, use_reloader=False, threaded=True)
    except Exception as e:
        print(f'[HTTP ERROR] {e}')

if __name__ == '__main__':
    print('[Init] Discord Bot Bridge')
    print(f'[Init] Token: {DISCORD_TOKEN[:20]}...')
    print(f'[Init] Channel: {CHANNEL_ID}')
    print(f'[Init] Local IP: {HOST_IP}')
    
    threading.Thread(target=run_http, daemon=True).start()

    try:
        intents = discord.Intents.default()
        intents.message_content = True
        client = DiscordBot(intents=intents)
        print('[Discord] Connecting...')
        client.run(DISCORD_TOKEN)
    except Exception as e:
        print(f'[Discord ERROR] {e}')
        sys.exit(1)
```

---

## Jint スクリプト (Arsist 内)

### トリガー設定

| 項目 | 値 |
|---|---|
| トリガー | `interval` |
| 間隔 (ms) | `1000` (1秒) |
| スクリプト名 | `DiscordFeed` |

### コード

```javascript
// 1秒ごとに Discord API をポーリング

// *** 重要: 以下の endpoint をPython出力のIPに合わせて変更 ***
var endpoint = 'http://192.168.0.64:8781/messages';  // ← ローカルIPに変更してください

// 初期化チェック
if (!store.get('discord_initialized')) {
  ui.setText('discord_feed_text', '初期化中... (APIサーバーを確認中)');
  store.set('discord_initialized', true);
  log('[Jint] Discord initialized, waiting for API...');
}

api.get(endpoint, function(res) {
  // === ネットワークエラー検出 ===
  if (res === null) {
    var msg = 'サーバー接続失敗!\n' +
              'endpoint: ' + endpoint + '\n' +
              'IPアドレスを確認してください';
    ui.setText('discord_feed_text', msg);
    log('[Jint ERR] API null - server not reachable: ' + endpoint);
    return;
  }
  
  // === JSON パースエラー検出 ===
  var data = null;
  try {
    data = JSON.parse(res);
  } catch (e) {
    ui.setText('discord_feed_text', 'JSON解析エラー: ' + String(e));
    log('[Jint ERR] Parse failed: ' + String(e));
    return;
  }
  
  // === サーバー側エラー検出 ===
  if (data.error) {
    ui.setText('discord_feed_text', 'サーバーエラー: ' + data.error);
    log('[Jint ERR] Server error: ' + data.error);
    return;
  }
  
  var items = data.items || [];
  
  // === メッセージなし ===
  if (items.length === 0) {
    ui.setText('discord_feed_text', 'メッセージなし\n(チャンネルで発言すると表示されます)');
    return;
  }
  
  // === 更新チェック（前回との差分で判定） ===
  var currentJson = JSON.stringify(items.map(function(x) { return x.id; }));
  var lastJson = store.get('discord_last_ids');
  
  if (currentJson === lastJson) {
    return;  // 更新なし
  }
  
  // === UI 更新 ===
  var lines = [];
  for (var i = 0; i < items.length; i++) {
    lines.push(items[i].author + ': ' + items[i].content);
  }
  ui.setText('discord_feed_text', lines.join('\n'));
  store.set('discord_last_ids', currentJson);
  
  log('[Jint] Updated ' + items.length + ' messages');
});
```

---

## 実行手順

### 1) Python サーバー起動

```powershell
# 環境変数設定 (Power Shell)
$env:DISCORD_BOT_TOKEN="your_token_here"
$env:DISCORD_CHANNEL_ID="1234567890123456789"

# 実行
python discord_bridge.py
```

**確認点：** コンソール出力を見て
```
[Init] Local IP: 192.168.0.64           ← このIPをメモ
[HTTP] Server on http://192.168.0.64:8781
[Discord] Logged in as YourBot#1234
```

### 2) Arsist エディタで設定

1. UI に `discord_feed_text` (Text 要素) を配置
2. Script で上記の Jint コードを作成
3. **endpoint を Python の IP に変更**:
   ```javascript
   var endpoint = 'http://192.168.0.64:8781/messages';
   ```
4. トリガー設定:
   - トリガー: `interval`
   - 間隔: `1000` (ms)
5. ビルド・デプロイ

### 3) 動作確認

1. デバイス起動後、コンソール に `[Jint] Discord initialized` または `[Jint ERR]` ログが見える
2. Discord チャンネルにメッセージ投稿
3. グラス上に表示される（1～2秒遅延）

---

## トラブルシューティング

| 現象 | 原因 | 対処 |
|---|---|---|
| 一切表示されない | endpoint IP が異なる | Python出力のIPを確認し、Jint側で変更 |
| 「サーバー接続失敗」 と表示 | Python起動していない/ファイアウォール | Python起動確認、ローカルネットワーク確認 |
| 「JSON解析エラー」 | APIレスポンス形式ミス | Python `print()` の `[HTTP ERROR]` ログ確認 |
| コンソール に `Message` ログがない | Channel ID が異なる | Discordサーバーでチャンネル ID を再確認 |
