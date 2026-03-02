import time
from Control import ArsistRemoteController

ctrl = ArsistRemoteController("127.0.0.1", port=8765, password="0000")
ctrl.connect()
time.sleep(2)  # ランタイム初期化待ち

# ID自動検出（avatar2 優先、なければ最初のVRMを使う）
ids = ctrl.get_ids()
vrm_ids = ids.get("vrmIds", [])
if not vrm_ids:
	raise RuntimeError("VRMが登録されていません。Asset IDとVRM配置を確認してください。")

avatar_id = "avatar2" if "avatar2" in vrm_ids else vrm_ids[0]
info = ctrl.get_info(avatar_id)
exprs = info.get("Expressions", [])
bones = info.get("HumanoidBones", [])

# ── 絶対座標・向きで配置 ──────────────────────────
ctrl.set_position(avatar_id, 0.14, -0.62, 0.09)
ctrl.set_rotation(avatar_id, 0, 0, 0)   # 正面を向かせる (yaw=0)
ctrl.set_uniform_scale(avatar_id, 1.0)
time.sleep(0.5)

# ── 表情制御  (能力検出ベース) ─────────────────────
preferred_expr = ["Joy", "happy", "A", "aa", "Blink"]
to_try = [e for e in preferred_expr if e in exprs]
if not to_try and exprs:
	to_try = exprs[:2]

for expr in to_try[:2]:
	ctrl.set_expression(avatar_id, expr, 80)
	time.sleep(1.0)
	ctrl.reset_expressions(avatar_id)
	time.sleep(0.3)

# ── ボーン制御  (能力検出ベース) ─────────────────────
right_arm = "RightUpperArm" if "RightUpperArm" in bones else None
left_arm = "LeftUpperArm" if "LeftUpperArm" in bones else None
if right_arm and left_arm:
	ctrl.set_bone_rotation(avatar_id, right_arm, 0, 0, -60)
	ctrl.set_bone_rotation(avatar_id, left_arm,  0, 0,  60)
	time.sleep(1.5)
	ctrl.set_bone_rotation(avatar_id, right_arm, 0, 0, 0)
	ctrl.set_bone_rotation(avatar_id, left_arm,  0, 0, 0)
	time.sleep(0.5)

# ── 位置移動デモ ─────────────────────────────────
ctrl.move(avatar_id,  0.5, 0, 0)   # 右へ 0.5m
time.sleep(0.8)
ctrl.move(avatar_id, -0.5, 0, 0)   # 元に戻す
time.sleep(0.5)

ctrl.disconnect()