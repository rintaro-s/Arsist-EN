# World Model Lab (Layster.Spatial)

World Model を XR アプリにつなぐ見本。PC で動く Mind が、端末の観測 (部屋・見つけた物・頭と手・小さなカメラの画・出来事) を
1 秒ごとに受け取り、**見えていない物の推測 (belief)** を返す。推測は `source: "mind:predictor"` の entity として
世界の状態に入り、スキャンした物と同じように規則・他の Mind・スクリプトから使える。

## 動かす

1. PC で見本の Mind を起動する (標準ライブラリだけで動く):

   ```
   python3 python/layster/mind_server.py --port 8765
   ```

   中身を自分の World Model に置き換えるときは、`/mind` が `layster.mind/1` の要求を受けて返事を返せばよい (doc/19 §3.5)
2. `app.edge` を PC のアドレス (`192.168.0.23:8765`) にする
3. 起動すると記録の同意を聞かれる。承諾すると `layster/episodes/<開始時刻>/` に記録する (`layster.episode/1`、doc/20)

## 中身

- Mind `predictor` (predict・edge・layster): frame は world、確かさ 0.1 以上の物まで渡す。返してよいのは `highlight` `say` `set` と belief
- 規則: 「予測する」で今すぐ聞く / カップ (確かさ 0.5 以上) が見えたら光らせる / 返事が来たら状態を書く
- スクリプト `lab`: 「記録」で記録の入り切り、「消す」で Mind の推測だけを消す (`world.forget`)
- 記録: 頭・手・世界・出来事・行動・Mind・1 秒に 1 枚のカメラ (320 px)。最長 20 分
