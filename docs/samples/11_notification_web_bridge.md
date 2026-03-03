# サンプル 11: 通知 Web ブリッジ（PC → Arsist AR） - 修正版

PC 上の Python サーバー経由で、HTTP リクエストで AR 画面に通知を表示します。

## Python スクリプト（改良版）

`notification_bridge_server.py`:

```python
#!/usr/bin/env python3
import sys
import socket
from datetime import datetime
from collections import deque
from flask import Flask, request, jsonify

try:
    from flask import Flask
except ImportError:
    print('[ERROR] flask not installed. Run: pip install flask')
    sys.exit(1)

try:
    HOST_IP = socket.gethostbyname(socket.gethostname())
except:
    HOST_IP = '127.0.0.1'

notifications = deque(maxlen=20)  # 最新20件

app = Flask(__name__)

@app.route('/notify', methods=['POST'])
def add_notify():
    try:
        data = request.get_json(silent=True) or {}
        msg = str(data.get('message', 'メッセージなし'))
        title = str(data.get('title', '通知'))
        color = str(data.get('color', '#FF6B6B'))
        
        notification = {
            'title': title,
            'message': msg,
            'color': color,
            'ts': datetime.now().isoformat(),
            'id': len(notifications)
        }
        notifications.append(notification)
        print(f'[Notify] {title}: {msg}')
        return jsonify({'ok': True, 'id': notification['id']})
    except Exception as e:
        print(f'[Notify ERROR] {e}')
        return jsonify({'ok': False, 'error': str(e)}), 400

@app.route('/notifications', methods=['GET'])
def get_notifications():
    try:
        return jsonify({'items': list(notifications), 'count': len(notifications)})
    except Exception as e:
        print(f'[Notifications ERROR] {e}')
        return jsonify({'error': str(e), 'items': []}), 500

@app.route('/clear', methods=['POST'])
def clear_notes():
    try:
        notifications.clear()
        print('[Notifications] Cleared')
        return jsonify({'ok': True})
    except Exception as e:
        print(f'[Clear ERROR] {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500

if __name__ == '__main__':
    print('[Init] Notification Bridge Server')
    print(f'[Init] Local IP: {HOST_IP}')
    print(f'[Init] API: http://{HOST_IP}:8790')
    print('[Init] Endpoints:')
    print(f'  POST http://{HOST_IP}:8790/notify  (message, title, color)')
    print(f'  GET  http://{HOST_IP}:8790/notifications')
    print(f'  POST http://{HOST_IP}:8790/clear')
    
    try:
        app.run(host='0.0.0.0', port=8790, debug=False, use_reloader=False)
    except Exception as e:
        print(f'[ERROR] Server failed: {e}')
        sys.exit(1)
```

---

## Jint スクリプト (Arsist 内)

### スクリプト 1: NotificationPoll - ポーリング

トリガー設定:
| 項目 | 値 |
|---|---|
| トリガー | `interval` |
| 間隔 (ms) | `500` |
| スクリプト名 | `NotificationPoll` |

コード:

```javascript
// *** 重要: endpoint を Python 出力のIPに合わせて変更 ***
var endpoint = 'http://192.168.0.64:8790/notifications';  // ← ローカルIPに変更

// 初期化
if (!store.get('notif_initialized')) {
  ui.setText('notification_text', '');
  store.set('notif_initialized', true);
  store.set('notif_last_count', 0);
  log('[NotificationPoll] Initialized');
}

api.get(endpoint, function(res) {
  // === ネットワークエラー ===
  if (res === null) {
    log('[NotificationPoll ERR] Cannot reach server: ' + endpoint);
    return;
  }
  
  var data = null;
  try {
    data = JSON.parse(res);
  } catch (e) {
    log('[NotificationPoll ERR] Parse failed: ' + String(e));
    return;
  }
  
  if (data.error) {
    log('[NotificationPoll ERR] Server: ' + data.error);
    return;
  }
  
  var count = data.count || 0;
  var lastCount = parseInt(store.get('notif_last_count') || '0');
  
  // === 新しい通知がある場合のみ更新 ===
  if (count > lastCount) {
    var items = data.items || [];
    if (items.length > 0) {
      var latest = items[items.length - 1];
      var displayText = (latest.title || '') + '\n' + (latest.message || '');
      ui.setText('notification_text', displayText);
      
      if (latest.color) {
        ui.setColor('notification_text', latest.color);
      }
      
      log('[NotificationPoll] New notification: ' + latest.title);
    }
    store.set('notif_last_count', String(count));
  }
});
```

### スクリプト 2: NotificationHide - 自動非表示 (オプション)

トリガー設定:
| 項目 | 値 |
|---|---|
| トリガー | `event` |
| イベント名 | `on_hide_notification` |
| スクリプト名 | `NotificationHide` |

コード:

```javascript
// 通知を5秒で自動非表示にする例

var displayTime = parseInt(store.get('notification_display_time') || '0');
var now = Math.floor(Date.now() / 1000);

// 初回表示時刻を記録
if (displayTime === 0) {
  store.set('notification_display_time', String(now));
  log('[NotificationHide] Display time set');
  return;
}

// 5秒経過したら非表示
if ((now - displayTime) > 5) {
  ui.setText('notification_text', '');
  store.set('notification_display_time', '0');
  log('[NotificationHide] Notification cleared');
}
```

---

## 実行手順

### 1) Python サーバー起動

```powershell
python notification_bridge_server.py
```

**確認点：** コンソール出力
```
[Init] Local IP: 192.168.0.64
[Init] API: http://192.168.0.64:8790
```

### 2) テスト通知送信

```powershell
$body = @{title="テスト通知"; message="HelloW World"; color="#00ff00"} | ConvertTo-Json
Invoke-WebRequest -Uri "http://192.168.0.64:8790/notify" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
```

### 3) Arsist エディタで設定

1. UI に `notification_text` (Text 要素) を配置
2. NotificationPoll スクリプトを create  
3. **endpoint を Python IP に変更**:
   ```javascript
   var endpoint = 'http://192.168.0.64:8790/notifications';
   ```
4. (オプション) NotificationHide スクリプトも create
5. ビルド・デプロイ

### 4) 動作確認

1. PowerShell で test 通知を POST
2. グラス上の notification_text に表示されることを確認

---

## トラブルシューティング

| 現象 | 原因 | 対処 |
|---|---|---|
| 何も表示されない | Python が起動していない / IPが不一致 | `notification_bridge_server.py` 実行、IP 確認 |
| 「ネットワークエラー」ログ | endpoint が到達不可 | Python ファイアウォール許可、endpoint IP 変更 |
| 通知が1回だけ表示される | count チェック機能が未初期化 | store.set() 処理を確認、console log で count 追跡 |

---

## PowerShell テストコード例

```powershell
$ip = "192.168.0.64"
$port = "8790"
$url = "http://${ip}:${port}/notify"

$body = @{
    title = "重要な通知"
    message = "これはテスト通知です"
    color = "#FF6B6B"
} | ConvertTo-Json

Invoke-WebRequest -Uri $url -Method POST -Body $body -ContentType "application/json" -UseBasicParsing

Write-Host "通知を送信しました！"
```

---

## 高度な使用例

### External App からの通知送信

他のアプリケーション（例：監視ツール、IoT デバイス）から以下のコマンドで通知を送信可能：

```bash
# Linux/Mac/Python
import requests
requests.post('http://192.168.0.64:8790/notify', json={
    'title': 'アラート',
    'message': 'CPU 温度が 80℃ を超えました',
    'color': '#FF0000'
})

# curl
curl -X POST http://192.168.0.64:8790/notify \
  -H "Content-Type: application/json" \
  -d '{"title":"Alert","message":"System warning","color":"#FF0000"}'
```
