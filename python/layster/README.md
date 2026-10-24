# python/layster — Layster.Spatial の見本のサーバー

どちらも Python 3.8 以上の**標準ライブラリだけ**で動く (pip install は要らない)。端末 (Quest など) と同じ LAN の PC で動かす。

| ファイル | 何 | 動かし方 | 端末側の指定 |
|---|---|---|---|
| `mind_server.py` | Layster Mind Protocol (`layster.mind/1`) の Mind | `python3 python/layster/mind_server.py --port 8765` | Mind の `protocol: "layster"`、`endpoint: "http://{edge}/mind"` |
| `body_bridge.py` | Layster Body Protocol (`layster.body/1`) の橋渡し + 動きを真似る腕 | `python3 python/layster/body_bridge.py --port 8766` | 体の `link: { protocol: "layster-body", url: "ws://{edge-host}:8766" }` |

`{edge}` は端末に保存した PC のアドレス (`world.setEdge("192.168.0.23:8765")`、無ければプロジェクトの `app.edge`)、
`{edge-host}` はその host だけ。どちらも `--host` (既定 `0.0.0.0`) と `--port` を受け取る。

## mind_server.py

届いた観測 (`MindRequest`) に、素朴な決まりで返事 (`MindReply`) を返す:

- 観測の frame が `body:<id>` で `command` を返してよい → 物 `target` (無ければ一番近い手で持てる entity) を
  `pick` する命令を 1 つ (`--command` / `--target` で変えられる)。`samples/spatial/robot-helper` + `body_bridge.py` で端から端まで動く
- それ以外 → 一番近い物を `highlight`、その少し奥に「隠れていそうな箱」の belief (確かさ 0.4)、`say` してよければ見えている数

届いた観測は `mind_requests.jsonl` に 1 行ずつ残る (カメラの画そのものは除く)。自分のモデル
(World Model・VLA・判断モデル) を包むときは `decide(req, args)` を書き換える。返事の位置は**観測と同じ frame** で書く。

## body_bridge.py

端末からの `command` を受け、道具の先を目標 (体の根元の frame、メートル) へ `--seconds` (既定 1.5 秒) かけて動かしたことにして、
`state` (`busy: true` の間 0.1 秒ごと) と `result` を返す。`stop` が来たら止めて `result { ok: false, error: "stopped" }`。
本物の腕につなぐときは `SimArm.run` を書き換える。安全の門 (動ける範囲・ユーザーの手との距離・確認) は**端末側**で
通してから送られてくるが、腕の側でも自分の限界 (関節の範囲・速度) は必ず見ること。

やりとりの形は `doc/20-spatial-runtime.md` §5 (体) と §6 (Mind)。
