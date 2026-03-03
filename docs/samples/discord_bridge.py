import os
import sys
import threading
import socket
from collections import deque
from flask import Flask, jsonify, request

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

@app.before_request
def request_logger():
    print(f"[HTTP] {request.method} {request.path} from {request.remote_addr}")

@app.get('/health')
def health():
    return jsonify({'ok': True, 'service': 'discord_bridge'})

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