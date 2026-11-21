# Layster.Spatial のサンプル

`project.spatial.json` 1 つで書かれた、空間のアプリの見本 (doc/19-layster.md)。エディタの「プロジェクトを開く」でフォルダを
選ぶと、Spatial のエディタで開く。エージェントは `spatial_*` の道具で読み書きできる。

| サンプル | 見どころ |
|---|---|
| [desk-buddy](desk-buddy/README.md) | 机の上にカード、そのそばにキャラクター。机が無い部屋では別の置き方に落ちる。PC の LLM (OpenAI 互換) と話す |
| [world-model-lab](world-model-lab/README.md) | World Model を `layster.mind/1` でつなぐ。推測 (belief) が世界の状態に入り、規則が反応する。学習用の記録 |
| [robot-helper](robot-helper/README.md) | 卓上アームを body としてつなぐ。動ける範囲・手が近いと止まる・承諾してから動く |

どのサンプルも、使う空間 (`spaces.use`) すべてで物が置けることを `src/shared/layster/spatial/samples.test.ts` が確かめている。
