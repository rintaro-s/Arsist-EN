#!/usr/bin/env python3
"""
Arsist Remote Controller
デバイス上の VRM アバターや 3D オブジェクトをリモート制御するための Python クライアント

使用例:
    controller = ArsistRemoteController("192.168.1.100")
    controller.connect()
    controller.set_expression("avatar", "Joy", 100)
    controller.disconnect()
"""

import websocket
import json
import time
import threading
from typing import Optional, Callable


class ArsistRemoteController:
    """Arsist デバイスをリモート制御するクライアント"""
    
    def __init__(self, device_ip: str, port: int = 8765, password: str = None):
        """
        Args:
            device_ip: デバイスの IP アドレス (例: "192.168.1.100")
            port: WebSocket ポート (デフォルト: 8765)
            password: 認証パスワード。None なら認証なし
        """
        self.url = f"ws://{device_ip}:{port}"
        self.password = password
        self.ws: Optional[websocket.WebSocket] = None
        self.connected = False
        
    def connect(self, timeout: float = 5.0) -> bool:
        """
        デバイスに接続
        
        Args:
            timeout: 接続タイムアウト（秒）
            
        Returns:
            接続成功時 True
        """
        try:
            print(f"Connecting to {self.url}...")
            self.ws = websocket.create_connection(self.url, timeout=timeout)
            self.connected = True
            print("Connected!")
            return True
        except Exception as e:
            print(f"Connection failed: {e}")
            self.connected = False
            return False
        
    def disconnect(self):
        """接続を切断"""
        if self.ws:
            self.ws.close()
            self.connected = False
            print("Disconnected")
    
    def send_command(self, cmd_type: str, method: str, **params):
        """
        コマンドを送信
        
        Args:
            cmd_type: "scene", "vrm", または "script"
            method: メソッド名
            **params: パラメータ
            
        Raises:
            RuntimeError: 未接続の場合
        """
        if not self.connected or not self.ws:
            raise RuntimeError("Not connected to device")
        
        command = {
            "type": cmd_type,
            "method": method,
            "parameters": params
        }
        if self.password:
            command["authToken"] = self.password
        
        try:
            self.ws.send(json.dumps(command))
        except Exception as e:
            print(f"Send error: {e}")
            self.connected = False
            raise
    
    # ========================================
    # VRM 制御
    # ========================================
    
    def set_expression(self, avatar_id: str, expression: str, value: float):
        """
        表情を設定
        
        Args:
            avatar_id: VRM の Asset ID
            expression: 表情名 ("Joy", "Angry", "Sorrow", "Fun", "Blink" など)
            value: 0.0 ~ 100.0
        """
        self.send_command("vrm", "setExpression",
                         id=avatar_id,
                         expressionName=expression,
                         value=value)
    
    def set_bone_rotation(self, avatar_id: str, bone_name: str, 
                         pitch: float, yaw: float, roll: float):
        """
        ボーンの回転を設定
        
        Args:
            avatar_id: VRM の Asset ID
            bone_name: ボーン名 ("Head", "RightUpperArm", "LeftHand" など)
            pitch: X軸回転（度数法）
            yaw: Y軸回転（度数法）
            roll: Z軸回転（度数法）
        """
        self.send_command("vrm", "setBoneRotation",
                         id=avatar_id,
                         boneName=bone_name,
                         pitch=pitch,
                         yaw=yaw,
                         roll=roll)
    
    def rotate_bone(self, avatar_id: str, bone_name: str,
                   pitch: float, yaw: float, roll: float):
        """
        ボーンを相対回転
        
        Args:
            avatar_id: VRM の Asset ID
            bone_name: ボーン名
            pitch, yaw, roll: 回転角度（度数法）
        """
        self.send_command("vrm", "rotateBone",
                         id=avatar_id,
                         boneName=bone_name,
                         pitch=pitch,
                         yaw=yaw,
                         roll=roll)
    
    def reset_expressions(self, avatar_id: str):
        """すべての表情をリセット"""
        self.send_command("vrm", "resetExpressions", id=avatar_id)
    
    def look_at(self, avatar_id: str, x: float, y: float, z: float):
        """
        視線を向ける
        
        Args:
            avatar_id: VRM の Asset ID
            x, y, z: 視線ターゲットの座標（メートル）
        """
        self.send_command("vrm", "lookAt",
                         id=avatar_id,
                         x=x, y=y, z=z)
    
    def play_vrm_animation(self, avatar_id: str, anim_name: str):
        """VRM アニメーションを再生"""
        self.send_command("vrm", "playAnimation",
                         id=avatar_id,
                         animName=anim_name)
    
    # ========================================
    # 3D オブジェクト制御
    # ========================================
    
    def set_position(self, object_id: str, x: float, y: float, z: float):
        """
        オブジェクトの位置を設定
        
        Args:
            object_id: オブジェクトの Asset ID
            x, y, z: 座標（メートル）
        """
        self.send_command("scene", "setPosition",
                         id=object_id,
                         x=x, y=y, z=z)
    
    def move(self, object_id: str, dx: float, dy: float, dz: float):
        """
        オブジェクトを相対移動
        
        Args:
            object_id: オブジェクトの Asset ID
            dx, dy, dz: 移動量（メートル）
        """
        self.send_command("scene", "move",
                         id=object_id,
                         x=dx, y=dy, z=dz)
    
    def set_rotation(self, object_id: str, pitch: float, yaw: float, roll: float):
        """
        オブジェクトの回転を設定
        
        Args:
            object_id: オブジェクトの Asset ID
            pitch, yaw, roll: 回転角度（度数法）
        """
        self.send_command("scene", "setRotation",
                         id=object_id,
                         pitch=pitch,
                         yaw=yaw,
                         roll=roll)
    
    def rotate(self, object_id: str, pitch: float, yaw: float, roll: float):
        """オブジェクトを相対回転"""
        self.send_command("scene", "rotate",
                         id=object_id,
                         pitch=pitch,
                         yaw=yaw,
                         roll=roll)
    
    def set_scale(self, object_id: str, x: float, y: float, z: float):
        """
        オブジェクトのスケールを設定
        
        Args:
            object_id: オブジェクトの Asset ID
            x, y, z: スケール倍率
        """
        self.send_command("scene", "setScale",
                         id=object_id,
                         x=x, y=y, z=z)
    
    def play_animation(self, object_id: str, anim_name: str):
        """
        アニメーションを再生
        
        Args:
            object_id: オブジェクトの Asset ID
            anim_name: アニメーション名
        """
        self.send_command("scene", "playAnimation",
                         id=object_id,
                         animName=anim_name)
    
    def stop_animation(self, object_id: str):
        """アニメーションを停止"""
        self.send_command("scene", "stopAnimation",
                         id=object_id)
    
    def set_visible(self, object_id: str, visible: bool):
        """
        オブジェクトの表示/非表示を設定
        
        Args:
            object_id: オブジェクトの Asset ID
            visible: True で表示、False で非表示
        """
        self.send_command("scene", "setVisible",
                         id=object_id,
                         visible=visible)
    
    # ========================================
    # スクリプト実行
    # ========================================
    
    def execute_script(self, code: str):
        """
        JavaScript コードを実行
        
        Args:
            code: 実行する JavaScript コード
        """
        self.send_command("script", "execute",
                         code=code)
    
    # ========================================
    # ヘルパーメソッド
    # ========================================
    
    def wave_hand(self, avatar_id: str, right: bool = True):
        """
        手を振るポーズ
        
        Args:
            avatar_id: VRM の Asset ID
            right: True で右手、False で左手
        """
        if right:
            self.set_bone_rotation(avatar_id, "RightUpperArm", 0, 0, -90)
            self.set_bone_rotation(avatar_id, "RightLowerArm", -30, 0, 0)
        else:
            self.set_bone_rotation(avatar_id, "LeftUpperArm", 0, 0, 90)
            self.set_bone_rotation(avatar_id, "LeftLowerArm", -30, 0, 0)
    
    def reset_pose(self, avatar_id: str):
        """ポーズをリセット（T-pose）"""
        bones = [
            "RightUpperArm", "RightLowerArm", "RightHand",
            "LeftUpperArm", "LeftLowerArm", "LeftHand",
            "Head", "Neck", "Spine", "Hips"
        ]
        for bone in bones:
            self.set_bone_rotation(avatar_id, bone, 0, 0, 0)
    
    def set_emotion(self, avatar_id: str, emotion: str):
        """
        感情に応じた表情とポーズを設定
        
        Args:
            avatar_id: VRM の Asset ID
            emotion: "happy", "sad", "angry", "neutral"
        """
        self.reset_expressions(avatar_id)
        
        if emotion == "happy":
            self.set_expression(avatar_id, "Joy", 100)
            # 両手を上げる
            self.set_bone_rotation(avatar_id, "RightUpperArm", 0, 0, -120)
            self.set_bone_rotation(avatar_id, "LeftUpperArm", 0, 0, 120)
            
        elif emotion == "sad":
            self.set_expression(avatar_id, "Sorrow", 100)
            # 下を向く
            self.set_bone_rotation(avatar_id, "Head", 20, 0, 0)
            
        elif emotion == "angry":
            self.set_expression(avatar_id, "Angry", 100)
            # 腕を組む
            self.set_bone_rotation(avatar_id, "RightUpperArm", 0, -45, -90)
            self.set_bone_rotation(avatar_id, "LeftUpperArm", 0, 45, 90)
            
        else:  # neutral
            self.set_expression(avatar_id, "Joy", 30)
            self.reset_pose(avatar_id)


# ========================================
# 使用例
# ========================================

def example_basic():
    """基本的な使用例"""
    controller = ArsistRemoteController("192.168.1.100")
    
    try:
        if not controller.connect():
            return
        
        # 表情を変える
        print("Setting expression to Joy...")
        controller.set_expression("avatar", "Joy", 100)
        time.sleep(2)
        
        # 手を振る
        print("Waving hand...")
        controller.wave_hand("avatar", right=True)
        time.sleep(2)
        
        # ポーズをリセット
        print("Resetting pose...")
        controller.reset_pose("avatar")
        controller.reset_expressions("avatar")
        
    finally:
        controller.disconnect()


def example_emotions():
    """感情表現の例"""
    controller = ArsistRemoteController("192.168.1.100")
    
    try:
        if not controller.connect():
            return
        
        emotions = ["happy", "sad", "angry", "neutral"]
        
        for emotion in emotions:
            print(f"Setting emotion: {emotion}")
            controller.set_emotion("avatar", emotion)
            time.sleep(3)
        
    finally:
        controller.disconnect()


def example_animation_loop():
    """アニメーションループの例"""
    controller = ArsistRemoteController("192.168.1.100")
    
    try:
        if not controller.connect():
            return
        
        # 回転アニメーション
        for i in range(360):
            angle = i * 2
            controller.set_bone_rotation("avatar", "RightHand", 0, angle, 0)
            time.sleep(0.01)
        
    finally:
        controller.disconnect()


if __name__ == "__main__":
    # 基本的な使用例を実行
    example_basic()
