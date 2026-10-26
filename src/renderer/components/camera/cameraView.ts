/**
 * 仮想カメラ (type 'camera'、doc/23) の「何が写るか」を three で再現する小道具。
 * エディタの 3D ビューの小窓 (CameraPreview) とプレビューのシミュレーター (VirtualSim) が使う。
 *
 * 座標: IR をそのまま three に置く (エディタと同じ)。カメラの前は物のローカル +Z、three のカメラは -Z を見るので
 * Y まわりに 180° 回して合わせる。
 *
 * 写さないもの (実機と同じ):
 *   - userData.arsistEditorOnly … エディタの補助 (グリッド・軸・視点の印) とカメラの形 (実機はレイヤー ArsistCameraGizmo)
 *   - TransformControls (エディタの掴み手)
 *   - userData.arsistEmbodied … 自分の体の VRM。showSelf が false のときだけ
 */
import * as THREE from 'three';
import type { CameraSettings, SceneObject } from '../../../shared/types';
import { cameraSettingsOf } from '../../../shared/media';

const DEG = Math.PI / 180;
const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/** カメラの物の姿勢と設定を three のカメラに写す。aspect は解像度から */
export function applyCameraObject(cam: THREE.PerspectiveCamera, obj: SceneObject, parent?: THREE.Matrix4): Required<CameraSettings> {
  const s = cameraSettingsOf(obj.camera);
  const t = obj.transform;
  cam.position.set(t.position.x, t.position.y, t.position.z);
  cam.quaternion.setFromEuler(new THREE.Euler(t.rotation.x * DEG, t.rotation.y * DEG, t.rotation.z * DEG)).multiply(FLIP_Y);
  if (parent) {
    cam.matrix.compose(cam.position, cam.quaternion, new THREE.Vector3(1, 1, 1)).premultiply(parent);
    cam.matrix.decompose(cam.position, cam.quaternion, new THREE.Vector3());
  }
  cam.fov = s.fov;
  cam.aspect = s.resolution[0] / s.resolution[1];
  cam.near = s.near;
  cam.far = s.far;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return s;
}

/**
 * カメラに写さないものを隠し、戻す関数を返す。自分の体 (arsistEmbodied) は showSelf に従う:
 * プレビューのシミュレーターでは自分の目から隠してある (visible = false) ので、showSelf なら写す間だけ出す。
 */
export function hideForCameraView(scene: THREE.Scene, showSelf: boolean): () => void {
  const hidden: THREE.Object3D[] = [];
  const shown: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const anyO = o as THREE.Object3D & { isTransformControls?: boolean };
    if (o.userData?.arsistEmbodied) {
      if (showSelf && !o.visible) { o.visible = true; shown.push(o); }
      else if (!showSelf && o.visible) { o.visible = false; hidden.push(o); }
      return;
    }
    // arsistHeadLocked: 頭に固定した板 (常時表示の UI)。ユーザーの目の前にあるだけで、カメラには写らない
    if (o.visible && (o.userData?.arsistEditorOnly || o.userData?.arsistHeadLocked || anyO.isTransformControls)) {
      o.visible = false;
      hidden.push(o);
    }
  });
  return () => {
    for (const o of hidden) o.visible = true;
    for (const o of shown) o.visible = false;
  };
}

/** 小窓の大きさ (CSS px)。長い方の辺を max に収める */
export function previewBox(settings: CameraSettings | undefined, max = 240): { width: number; height: number } {
  const s = cameraSettingsOf(settings);
  const aspect = s.resolution[0] / s.resolution[1];
  return aspect >= 1
    ? { width: max, height: Math.round(max / aspect) }
    : { width: Math.round(max * aspect), height: max };
}

/**
 * 新しく置くカメラ。ユーザーの 2 m 先・目の少し下から、ユーザー (原点) の方を向く (自分の体を撮る使い方が多い)。
 * assetId は Camera, Camera2, … (スクリプトと画像の source が使う名前)
 */
export function newCameraObject(name: string, existing: SceneObject[]): Partial<SceneObject> {
  const taken = new Set(existing.flatMap((o) => [o.assetId, o.name]).filter(Boolean));
  let n = 1;
  let assetId = 'Camera';
  while (taken.has(assetId)) assetId = `Camera${++n}`;
  return {
    name: n === 1 ? name : `${name} ${n}`,
    type: 'camera',
    assetId,
    transform: { position: { x: 0, y: -0.1, z: 2 }, rotation: { x: 0, y: 180, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  };
}

/**
 * カメラから見た画を 1 枚撮って data URL (PNG) で返す (プレビューのシミュレーター用)。長い辺は maxSide px まで。
 * 画像の source が camera の UI に貼る。WebGL から読み戻すので、毎フレームは呼ばない。
 */
export function shootCamera(gl: THREE.WebGLRenderer, scene: THREE.Scene, obj: SceneObject, maxSide = 640): string {
  const cam = new THREE.PerspectiveCamera();
  const s = applyCameraObject(cam, obj);
  const k = Math.min(1, maxSide / Math.max(s.resolution[0], s.resolution[1]));
  const w = Math.max(16, Math.round(s.resolution[0] * k));
  const h = Math.max(16, Math.round(s.resolution[1] * k));
  const target = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace });
  const restore = hideForCameraView(scene, s.showSelf);
  const prevBackground = scene.background;
  scene.background = new THREE.Color(s.backgroundColor);
  const prevTarget = gl.getRenderTarget();
  const pixels = new Uint8Array(w * h * 4);
  try {
    gl.setRenderTarget(target);
    gl.clear(true, true, true);
    gl.render(scene, cam);
    gl.readRenderTargetPixels(target, 0, 0, w, h, pixels);
  } finally {
    gl.setRenderTarget(prevTarget);
    scene.background = prevBackground;
    restore();
    target.dispose();
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return '';
  const image = g.createImageData(w, h);
  // WebGL は下の行から並ぶ
  for (let y = 0; y < h; y++) image.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  g.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
