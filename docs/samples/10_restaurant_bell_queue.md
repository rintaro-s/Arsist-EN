# サンプル 10: レストランベルサイト + 呼び出し一覧 - 修正版

レストラン想定で、客向けのベルサイトを Python でホストし、別ポートで状態API を公開します。

## Python スクリプト（改良版・ベルサイト + API）

`restaurant_bell_server.py`:

```python
#!/usr/bin/env python3
import sys
import threading
import socket
from datetime import datetime
from flask import Flask, request, jsonify, make_response

try:
    from flask import Flask
except ImportError:
    print('[ERROR] flask not installed. Run: pip install flask')
    sys.exit(1)

try:
    HOST_IP = socket.gethostbyname(socket.gethostname())
except:
    HOST_IP = '127.0.0.1'

next_number = 1
customers = {}  # number -> { raised: bool, ts: str }

HTML = """<!doctype html>
<html>
<head><meta charset="utf-8"><title>Restaurant Bell</title>
<style>body{font-family:sans-serif;padding:20px;text-align:center}
h1{color:#333}button{padding:10px 20px;font-size:16px;margin:5px;cursor:pointer}
#num{font-size:48px;color:#FF6B6B;font-weight:bold}
.raised{background:#28a745}.not-raised{background:#007bff}</style></head>
<body>
<h1>レストラン呼び出しベル</h1>
<p>あなたの番号: <b id='num'>-</b></p>
<button class='raised' onclick='setRaised(true)'>手を挙げる (呼び出し)</button>
<button class='not-raised' onclick='setRaised(false)'>手を下ろす (解除)</button>
<p><small id='status'>-</small></p>
<script>
async function init(){
  let r=await fetch('/register',{method:'POST',credentials:'include'});
  let j=await r.json();
  document.getElementById('num').textContent=j.number;
  document.getElementById('status').textContent='登録完了: '+j.number;
}
async function setRaised(v){
  let r=await fetch('/raise',{
    method:'POST',credentials:'include',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({raised:v})
  });
  let j=await r.json();
  if(j.ok) document.getElementById('status').textContent=(v?'呼び出し中':'待機中');
}
init();
</script>
</body>
</html>
"""

site_app = Flask('bell_site')
api_app = Flask('bell_api')

# ベルサイト (8088)
@site_app.route('/', methods=['GET'])
def index():
    return HTML

@site_app.route('/register', methods=['POST'])
def register():
    global next_number
    num = request.cookies.get('guestNumber')
    if num is None:
        num = str(next_number)
        next_number += 1
    num_int = int(num)
    if num_int not in customers:
        customers[num_int] = {'raised': False, 'ts': datetime.now().isoformat()}
    res = make_response(jsonify({'number': num_int, 'ok': True}))
    res.set_cookie('guestNumber', num, max_age=3600)
    print(f'[Register] Customer #{num_int}')
    return res

@site_app.route('/raise', methods=['POST'])
def raise_hand():
    num = request.cookies.get('guestNumber')
    if num is None:
        return jsonify({'ok': False, 'error': 'not registered'}), 400
    num_int = int(num)
    data = request.get_json(silent=True) or {}
    raised = bool(data.get('raised', False))
    customers[num_int] = {'raised': raised, 'ts': datetime.now().isoformat()}
    print(f'[Raise] Customer #{num_int}: raised={raised}')
    return jsonify({'ok': True})

# 状態API (8089)
@api_app.route('/status', methods=['GET'])
def status():
    try:
        rows = [
            {'number': num, 'raised': data['raised'], 'ts': data['ts']}
            for num, data in sorted(customers.items())
        ]
        return jsonify({'rows': rows})
    except Exception as e:
        print(f'[API ERROR] /status: {e}')
        return jsonify({'error': str(e), 'rows': []}), 500

if __name__ == '__main__':
    print('[Init] Restaurant Bell Server')
    print(f'[Init] Local IP: {HOST_IP}')
    print(f'[Init] Bell Site: http://{HOST_IP}:8088')
    print(f'[Init] API Server: http://{HOST_IP}:8089')
    
    def run_site():
        print('[Site] Starting on :8088...')
        try:
            site_app.run(host='0.0.0.0', port=8088, debug=False, use_reloader=False)
        except Exception as e:
            print(f'[Site ERROR] {e}')
    
    def run_api():
        print('[API] Starting on :8089...')
        try:
            api_app.run(host='0.0.0.0', port=8089, debug=False, use_reloader=False)
        except Exception as e:
            print(f'[API ERROR] {e}')
    
    threading.Thread(target=run_site, daemon=True).start()
    threading.Thread(target=run_api, daemon=True).start()
    
    try:
        import time
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print('[Init] Shutdown')
```

---

## Jint スクリプト (Arsist 内)

### トリガー設定

| 項目 | 値 |
|---|---|
| トリガー | `interval` |
| 間隔 (ms) | `1000` (1秒) |
| スクリプト名 | `RestaurantQueuePoll` |

### コード

```javascript
// 1秒ごとにステータスAPI をポーリング

// *** 重要: 以下の endpoint をPython出力のIPに合わせて変更 ***
var endpoint = 'http://192.168.0.64:8089/status';  // ← ローカルIPに変更してください

// 初期化
if (!store.get('restaurant_initialized')) {
  ui.setText('restaurant_queue_text', '接続中... (サーバーを確認中)');
  store.set('restaurant_initialized', true);
  log('[Restaurant] Initialized');
}

api.get(endpoint, function(res) {
  // === ネットワークエラー ===
  if (res === null) {
    ui.setText('restaurant_queue_text', 
      'サーバー接続失敗\n' +
      'API: ' + endpoint + '\n' +
      'IPアドレスを確認してください');
    log('[Restaurant ERR] API null');
    return;
  }
  
  var data = null;
  try {
    data = JSON.parse(res);
  } catch (e) {
    ui.setText('restaurant_queue_text', 'JSON解析エラー: ' + String(e));
    log('[Restaurant ERR] Parse: ' + String(e));
    return;
  }
  
  if (data.error) {
    ui.setText('restaurant_queue_text', 'サーバーエラー: ' + data.error);
    log('[Restaurant ERR] Server: ' + data.error);
    return;
  }
  
  var rows = data.rows || [];
  
  if (rows.length === 0) {
    ui.setText('restaurant_queue_text', '現在の呼び出しはありません\n(客がベルサイトにアクセスしてから操作)');
    return;
  }
  
  // === 更新チェック ===
  var currentJson = JSON.stringify(rows.map(function(x) { return x.number + ':' + (x.raised ? '1' : '0'); }));
  var lastJson = store.get('restaurant_last_status');
  
  if (currentJson === lastJson) {
    return;
  }
  
  // === UI 更新 ===
  var lines = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var state = row.raised ? '🔔 呼び出し中' : '待機中';
    lines.push('#' + row.number + '  ' + state);
  }
  ui.setText('restaurant_queue_text', lines.join('\n'));
  store.set('restaurant_last_status', currentJson);
  
  log('[Restaurant] Updated ' + rows.length + ' customers');
});
```

---

## 実行手順

### 1) Python サーバー起動

```powershell
python restaurant_bell_server.py
```

**確認点：** コンソール出力を見て
```
[Init] Local IP: 192.168.0.64       ← このIPをメモ
[Init] API Server: http://192.168.0.64:8089
```

### 2) ブラウザでテスト

`http://192.168.0.64:8088` をブラウザで開く
- 番号が自動割り当て
- 「手を挙げる」ボタンで呼び出し状態に変更

### 3) Arsist エディタで設定

1. UI に `restaurant_queue_text` (Text 要素) を配置
2. Script で上記の Jint コードを作成  
3. **endpoint を Python 出力の IP に変更**:
   ```javascript
   var endpoint = 'http://192.168.0.64:8089/status';
   ```
4. ビルド・デプロイ

### 4) 動作確認

1. ブラウザでベルサイト ( `http://192.168.0.64:8088` ) にアクセス
2. 客が「手を挙げる」をクリック  
3. グラス上の queue_text に呼び出し状態が表示される
