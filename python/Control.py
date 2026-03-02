#!/usr/bin/env python3
"""
Arsist Control - Advanced Controller with Query API & Auto-Generation
================================================================================

前セッションでビルドされた Inspector メタデータ機能に対応した拡張コントローラ

使用例:
    # 1. VRM 能力を自動検出
    ctrl = ArsistControl("192.168.0.24")
    ctrl.connect()
    ids = ctrl.query("vrm", "getIds")
    capabilities = ctrl.query("vrm", "getCapabilities", avatar_id="avatar")
    
    # 2. VRM 能力に基づいたサンプルコード生成
    sample_code = ctrl.generate_sample_script("avatar", capabilities)
    
    # 3. アダプティブデモ実行
    ctrl.run_demo("avatar")
    
    ctrl.disconnect()
"""

import websocket
import json
import time
import threading
import uuid
from typing import Optional, Any, Dict, List
import argparse


class ArsistControl:
    """Arsist Remote Controller with Query API"""
    
    def __init__(self, device_ip: str, port: int = 8765, password: str = None, verbose: bool = False):
        self.url = f"ws://{device_ip}:{port}"
        self.password = password
        self.ws: Optional[websocket.WebSocket] = None
        self.connected = False
        self.verbose = verbose
        self.pending_responses: Dict[str, Any] = {}
        self.lock = threading.Lock()
        
    def connect(self, timeout: float = 5.0) -> bool:
        """Connect to Arsist device"""
        try:
            if self.verbose:
                print(f"[CONNECT] Connecting to {self.url}...")
            self.ws = websocket.create_connection(self.url, timeout=timeout)
            self.connected = True
            
            # Start response listening thread
            self._response_thread = threading.Thread(target=self._listen_responses, daemon=True)
            self._response_thread.start()
            
            if self.verbose:
                print("[CONNECT] ✓ Connected and listening")
            return True
        except Exception as e:
            if self.verbose:
                print(f"[CONNECT] ✗ Connection failed: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from device"""
        if self.ws:
            try:
                self.ws.close()
            except:
                pass
        self.connected = False
        if self.verbose:
            print("[DISCONNECT] Disconnected")
    
    def _listen_responses(self):
        """Listen for responses from server (threaded)"""
        while self.connected:
            try:
                if not self.ws:
                    break
                msg = self.ws.recv()
                if not msg:
                    continue
                    
                data = json.loads(msg)
                if "requestId" in data:
                    request_id = data["requestId"]
                    with self.lock:
                        self.pending_responses[request_id] = data
                        
                    if self.verbose:
                        print(f"[RESPONSE] {request_id[:8]}: {data.get('success', False)}")
                        
            except Exception as e:
                if self.verbose:
                    print(f"[LISTEN] Error: {e}")
                break
    
    def query(self, cmd_type: str, method: str, timeout: float = 10.0, **params) -> Any:
        """
        Send query command and wait for response
        
        Args:
            cmd_type: "vrm" | "scene" | "query"
            method: Command method name
            timeout: Response timeout in seconds
            **params: Command parameters
            
        Returns:
            Response data or None on error
        """
        if not self.connected or not self.ws:
            raise RuntimeError("Not connected to device")
        
        request_id = str(uuid.uuid4())
        cmd = {
            "type": cmd_type,
            "method": method,
            "requestId": request_id,
            "parameters": params
        }
        if self.password:
            cmd["authToken"] = self.password
        
        if self.verbose:
            print(f"[QUERY] {request_id[:8]}: {cmd_type}/{method}")
        
        self.ws.send(json.dumps(cmd))
        
        # Wait for response
        start_time = time.time()
        while time.time() - start_time < timeout:
            with self.lock:
                if request_id in self.pending_responses:
                    response = self.pending_responses.pop(request_id)
                    if response.get("success"):
                        return response.get("data")
                    else:
                        raise RuntimeError(f"Query failed: {response.get('error', 'Unknown error')}")
            time.sleep(0.05)
        
        raise TimeoutError(f"Query timeout after {timeout}s")
    
    def send_command(self, cmd_type: str, method: str, **params):
        """Send fire-and-forget command"""
        if not self.connected or not self.ws:
            return
        
        cmd = {
            "type": cmd_type,
            "method": method,
            "parameters": params
        }
        if self.password:
            cmd["authToken"] = self.password
        
        if self.verbose:
            print(f"[COMMAND] {cmd_type}/{method}")
        
        self.ws.send(json.dumps(cmd))
    
    # ========================================
    # Query API Methods
    # ========================================
    
    def get_ids(self) -> List[str]:
        """Get registered VRM IDs"""
        return self.query("query", "getIds")
    
    def get_capabilities(self, avatar_id: str) -> Dict[str, Any]:
        """Get VRM capabilities (expressions, bones, etc.)"""
        return self.query("query", "getCapabilities", avatar_id=avatar_id)
    
    def get_state(self, object_id: str) -> Dict[str, Any]:
        """Get object/VRM state"""
        return self.query("query", "getState", object_id=object_id)
    
    def ping(self) -> dict:
        """Ping device"""
        result = self.query("query", "ping", timeout=5.0)
        return result
    
    # ========================================
    # VRM Control (Fire-and-forget)
    # ========================================
    
    def set_expression(self, avatar_id: str, expression: str, value: float = 100.0):
        """Set expression"""
        self.send_command("vrm", "setExpression",
                         id=avatar_id,
                         expressionName=expression,
                         value=value)
    
    def set_bone_rotation(self, avatar_id: str, bone_name: str,
                         pitch: float, yaw: float, roll: float):
        """Set bone rotation"""
        self.send_command("vrm", "setBoneRotation",
                         id=avatar_id,
                         boneName=bone_name,
                         pitch=pitch,
                         yaw=yaw,
                         roll=roll)
    
    def set_position(self, object_id: str, x: float, y: float, z: float):
        """Set object position"""
        self.send_command("scene", "setPosition", id=object_id, x=x, y=y, z=z)
    
    def set_rotation(self, object_id: str, pitch: float, yaw: float, roll: float):
        """Set object rotation"""
        self.send_command("scene", "setRotation", id=object_id, pitch=pitch, yaw=yaw, roll=roll)
    
    def set_scale(self, object_id: str, x: float, y: float, z: float):
        """Set object scale"""
        self.send_command("scene", "setScale", id=object_id, x=x, y=y, z=z)
    
    def set_visible(self, object_id: str, visible: bool):
        """Set object visibility"""
        self.send_command("scene", "setVisible", id=object_id, visible=visible)
    
    def reset_expressions(self, avatar_id: str):
        """Reset all expressions"""
        self.send_command("vrm", "resetExpressions", id=avatar_id)
    
    def reset_pose(self, avatar_id: str):
        """Reset pose to T-pose"""
        bones = ["Head", "Neck", "RightUpperArm", "RightLowerArm", "RightHand",
                 "LeftUpperArm", "LeftLowerArm", "LeftHand", "Spine", "Hips"]
        for bone in bones:
            self.set_bone_rotation(avatar_id, bone, 0, 0, 0)
    
    # ========================================
    # Adaptive Demo & Sample Generation
    # ========================================
    
    def generate_sample_script(self, avatar_id: str, capabilities: Optional[Dict] = None) -> str:
        """
        Generate Python sample code based on VRM capabilities
        
        Returns:
            Executable Python script
        """
        if capabilities is None:
            try:
                capabilities = self.get_capabilities(avatar_id)
            except:
                capabilities = {}
        
        expressions = capabilities.get("expressions", [])
        bones = capabilities.get("humanoidBones", [])
        
        script = f'''#!/usr/bin/env python3
"""
Generated demo script for VRM: {avatar_id}
Auto-generated from capabilities
"""

from python.arsist_controller import ArsistControl
import time

def demo():
    ctrl = ArsistControl("192.168.0.24")
    if not ctrl.connect():
        return
    
    try:
        print("[Demo] Capability-based demo for {avatar_id}")
        
        # Available expressions ({len(expressions)} total)
        expressions_to_try = [
'''
        
        # Add sample expressions (up to 5)
        for expr in expressions[:5]:
            script += f'            "{expr}",\n'
        
        script += '''        ]
        
        for expr in expressions_to_try:
            print(f"  Setting expression: {{expr}}")
            ctrl.set_expression("''' + avatar_id + '''", expr, 100)
            time.sleep(1)
        
        # Available bones
        bones_to_demo = [
'''
        
        # Add sample bones (up to 3)
        for bone in bones[:3]:
            script += f'            "{bone}",\n'
        
        script += '''        ]
        
        for bone in bones_to_demo:
            print(f"  Rotating bone: {{bone}}")
            ctrl.set_bone_rotation("''' + avatar_id + '''", bone, 45, 45, 0)
            time.sleep(0.5)
        
        # Reset
        print("  Resetting pose and expressions...")
        ctrl.reset_expressions("''' + avatar_id + '''")
        ctrl.reset_pose("''' + avatar_id + '''")
        
        print("[Demo] Complete!")
        
    finally:
        ctrl.disconnect()

if __name__ == "__main__":
    demo()
'''
        
        return script
    
    def run_demo(self, avatar_id: str):
        """Run adaptive demo based on VRM capabilities"""
        print(f"\n{'='*60}")
        print(f"[DEMO] Adaptive demo for VRM: {avatar_id}")
        print(f"{'='*60}\n")
        
        try:
            # Step 1: Ping
            print("[1/6] Pinging device...")
            ping_result = self.ping()
            print(f"      ✓ {ping_result}\n")
            
            # Step 2: Get IDs
            print("[2/6] Getting registered VRMs...")
            ids = self.get_ids()
            print(f"      ✓ Found {len(ids)} VRMs: {ids}\n")
            
            # Step 3: Get capabilities
            print(f"[3/6] Querying capabilities for {avatar_id}...")
            caps = self.get_capabilities(avatar_id)
            expr_count = len(caps.get("expressions", []))
            bone_count = len(caps.get("humanoidBones", []))
            print(f"      ✓ Expressions: {expr_count}, Bones: {bone_count}\n")
            
            # Step 4: Set random expression
            expressions = caps.get("expressions", [])
            if expressions:
                expr = expressions[0]
                print(f"[4/6] Setting expression: {expr}...")
                self.set_expression(avatar_id, expr, 100)
                time.sleep(1)
                print(f"      ✓ Done\n")
            
            # Step 5: Rotate bone
            bones = caps.get("humanoidBones", [])
            if bones:
                bone = bones[0]
                print(f"[5/6] Rotating bone: {bone}...")
                self.set_bone_rotation(avatar_id, bone, 45, 0, 0)
                time.sleep(1)
                print(f"      ✓ Done\n")
            
            # Step 6: Reset
            print("[6/6] Resetting VRM...")
            self.reset_expressions(avatar_id)
            self.reset_pose(avatar_id)
            print(f"      ✓ Done\n")
            
            print(f"{'='*60}")
            print("[✓ Demo completed successfully]")
            print(f"{'='*60}\n")
            
        except Exception as e:
            print(f"\n[✗ Error during demo]: {e}\n")


def main():
    parser = argparse.ArgumentParser(description="Arsist Remote Control")
    parser.add_argument("--device", default="192.168.0.24", help="Device IP address")
    parser.add_argument("--demo", action="store_true", help="Run adaptive demo")
    parser.add_argument("--list-ids", action="store_true", help="List VRM IDs")
    parser.add_argument("--avatar-id", default="avatar", help="Target avatar ID")
    parser.add_argument("--generate-sample", action="store_true", help="Generate sample script")
    parser.add_argument("--password", default="0000", help="Authentication password (default: 0000)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    ctrl = ArsistControl(args.device, password=args.password, verbose=args.verbose)
    if not ctrl.connect():
        print("Failed to connect to device")
        return
    
    try:
        if args.list_ids:
            ids = ctrl.get_ids()
            print(f"Registered VRM IDs: {ids}")
            
        elif args.generate_sample:
            caps = ctrl.get_capabilities(args.avatar_id)
            script = ctrl.generate_sample_script(args.avatar_id, caps)
            print(script)
            
        elif args.demo:
            ctrl.run_demo(args.avatar_id)
            
        else:
            # Default: run demo
            ctrl.run_demo(args.avatar_id)
            
    finally:
        ctrl.disconnect()


if __name__ == "__main__":
    main()
