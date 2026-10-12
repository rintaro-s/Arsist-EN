/**
 * 人型の FBX (Mixamo など) の動きを、エディタの 3D ビューの VRM に流すための付け替え。
 *
 * 実機は Unity の Humanoid (Mecanim) が付け替える。エディタの見た目はその近似で、やり方は three-vrm の
 * 例 (loadMixamoAnimation) と同じ: 骨の名前を VRM の人型の骨に対応させ、各骨の回転を「動きの元の休み姿勢」
 * からの差として VRM の正規化した骨に掛け、腰の位置は腰の高さの比で縮める。
 *
 * 違うところ:
 *   - 読み込んだ FBX を何度も使うので、元のキーを書き換えない (例のコードはその場で書き換える)
 *   - Mixamo 以外の名前 (Blender の Hips / UpperArm.L、Unity の LeftUpperArm、VRM の leftUpperArm) も引ける
 *   - 腰の前後左右の移動は「最初と最後の差」を引いてその場に留める (実機も root motion を使わないのでその場で動く)。
 *     揺れは残る
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';

/** 名前を比べる形: 区切り (: | .) より前の接頭辞と mixamorig を落とし、記号を除いて小文字に */
function normalizeBoneName(raw: string): string {
  let name = raw;
  const colon = name.lastIndexOf(':');
  if (colon >= 0) name = name.slice(colon + 1);
  const pipe = name.lastIndexOf('|');
  if (pipe >= 0) name = name.slice(pipe + 1);
  name = name.replace(/^mixamorig/i, '');
  // Blender の .L / _L / .R / _R → left / right を前に
  const side = /[._ -]([lr])$/i.exec(name);
  if (side) name = (side[1].toLowerCase() === 'l' ? 'left' : 'right') + name.slice(0, side.index);
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

const SIDES = ['left', 'right'] as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** 正規化した名前 → VRM の人型の骨 */
const BONE_MAP: Record<string, VRMHumanBoneName> = (() => {
  const map: Record<string, VRMHumanBoneName> = {};
  const add = (bone: VRMHumanBoneName, ...names: string[]) => {
    for (const n of [bone, ...names]) map[n.replace(/[^a-z0-9]/gi, '').toLowerCase()] = bone;
  };
  add('hips', 'pelvis');
  add('spine');
  add('chest', 'spine1');
  add('upperChest', 'spine2');
  add('neck');
  add('head');
  for (const side of SIDES) {
    const S = cap(side);
    add(`${side}Shoulder` as VRMHumanBoneName, `${S}Shoulder`, `${side}clavicle`);
    add(`${side}UpperArm` as VRMHumanBoneName, `${S}Arm`, `${side}arm`);
    add(`${side}LowerArm` as VRMHumanBoneName, `${S}ForeArm`, `${side}forearm`);
    add(`${side}Hand` as VRMHumanBoneName);
    add(`${side}UpperLeg` as VRMHumanBoneName, `${S}UpLeg`, `${side}thigh`);
    add(`${side}LowerLeg` as VRMHumanBoneName, `${S}Leg`, `${side}shin`, `${side}calf`);
    add(`${side}Foot` as VRMHumanBoneName);
    add(`${side}Toes` as VRMHumanBoneName, `${S}ToeBase`);
    const fingers: Array<[string, string]> = [['Thumb', 'Thumb'], ['Index', 'Index'], ['Middle', 'Middle'], ['Ring', 'Ring'], ['Little', 'Pinky']];
    for (const [vrmFinger, mixFinger] of fingers) {
      const joints = vrmFinger === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
      joints.forEach((joint, i) => add(`${side}${vrmFinger}${joint}` as VRMHumanBoneName, `${S}Hand${mixFinger}${i + 1}`));
    }
  }
  return map;
})();

const assetCache = new Map<string, Promise<THREE.Group>>();

/** FBX を読む (URL ごとに 1 回)。失敗したものは覚えない。 */
export function loadAnimationAsset(url: string): Promise<THREE.Group> {
  const hit = assetCache.get(url);
  if (hit) return hit;
  const promise = new FBXLoader().loadAsync(url).then((group) => {
    if (!group.animations?.length) throw new Error('no animation in this FBX');
    group.updateMatrixWorld(true);
    return group;
  });
  promise.catch(() => { if (assetCache.get(url) === promise) assetCache.delete(url); });
  assetCache.set(url, promise);
  return promise;
}

/** ファイルを消した / 入れ直したとき */
export function forgetAnimationAsset(url: string): void {
  assetCache.delete(url);
}

const retargetCache = new WeakMap<VRM, Map<string, THREE.AnimationClip>>();

/** その VRM 用に付け替えた動き (VRM と URL ごとに 1 回作る)。 */
export async function retargetedClip(url: string, vrm: VRM): Promise<THREE.AnimationClip> {
  let perVrm = retargetCache.get(vrm);
  if (!perVrm) { perVrm = new Map(); retargetCache.set(vrm, perVrm); }
  const hit = perVrm.get(url);
  if (hit) return hit;
  const clip = retarget(await loadAnimationAsset(url), vrm);
  perVrm.set(url, clip);
  return clip;
}

function retarget(asset: THREE.Group, vrm: VRM): THREE.AnimationClip {
  const source = THREE.AnimationClip.findByName(asset.animations, 'mixamo.com') ?? asset.animations[0];
  const humanoid = vrm.humanoid;
  const isVrm0 = vrm.meta?.metaVersion === '0';

  // 名前 → ノード (FBXLoader は "mixamorig:Hips" を "mixamorigHips" にする)
  const nodeByTrackName = new Map<string, THREE.Object3D>();
  asset.traverse((o) => { if (o.name) nodeByTrackName.set(THREE.PropertyBinding.sanitizeNodeName(o.name), o); });

  // 腰の高さの比
  const v = new THREE.Vector3();
  let hipsNode: THREE.Object3D | undefined;
  for (const [name, node] of nodeByTrackName) {
    if (BONE_MAP[normalizeBoneName(name)] === 'hips') { hipsNode = node; break; }
  }
  const assetRootY = asset.getWorldPosition(v).y;
  const motionHipsHeight = hipsNode ? Math.abs(hipsNode.getWorldPosition(v).y - assetRootY) : 0;
  const vrmHipsNode = humanoid.getNormalizedBoneNode('hips');
  const vrmHipsHeight = vrmHipsNode
    ? Math.abs(vrmHipsNode.getWorldPosition(v).y - vrm.scene.getWorldPosition(new THREE.Vector3()).y)
    : 0.9;
  const hipsScale = motionHipsHeight > 1e-6 ? vrmHipsHeight / motionHipsHeight : 1;

  const tracks: THREE.KeyframeTrack[] = [];
  const restInverse = new THREE.Quaternion();
  const parentRest = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  const parentMatrix = new THREE.Matrix3();

  for (const track of source.tracks) {
    const dot = track.name.lastIndexOf('.');
    const nodeName = track.name.slice(0, dot);
    const property = track.name.slice(dot + 1);
    const bone = BONE_MAP[normalizeBoneName(nodeName)];
    const node = nodeByTrackName.get(nodeName);
    const vrmNode = bone ? humanoid.getNormalizedBoneNode(bone) : null;
    if (!bone || !node || !vrmNode) continue;

    if (property === 'quaternion' && track instanceof THREE.QuaternionKeyframeTrack) {
      node.getWorldQuaternion(restInverse).invert();
      if (node.parent) node.parent.getWorldQuaternion(parentRest); else parentRest.identity();
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < track.values.length; i += 4) {
        q.fromArray(track.values, i).premultiply(parentRest).multiply(restInverse);
        values[i] = isVrm0 ? -q.x : q.x;
        values[i + 1] = q.y;
        values[i + 2] = isVrm0 ? -q.z : q.z;
        values[i + 3] = q.w;
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${vrmNode.name}.quaternion`, Array.from(track.times), Array.from(values)));
    } else if (property === 'position' && bone === 'hips' && track instanceof THREE.VectorKeyframeTrack) {
      // 親の向きと大きさ (cm の FBX、Blender の軸) をワールドに直してから、腰の高さの比で縮める
      parentMatrix.setFromMatrix4(node.parent?.matrixWorld ?? new THREE.Matrix4());
      const n = track.values.length / 3;
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < n; i++) {
        v.fromArray(track.values, i * 3).applyMatrix3(parentMatrix).multiplyScalar(hipsScale);
        values[i * 3] = isVrm0 ? -v.x : v.x;
        values[i * 3 + 1] = v.y;
        values[i * 3 + 2] = isVrm0 ? -v.z : v.z;
      }
      // 前後左右の移動 (歩いて進む分) を引いて、その場で動かす
      if (n > 1) {
        const dx = values[(n - 1) * 3] - values[0];
        const dz = values[(n - 1) * 3 + 2] - values[2];
        const x0 = values[0];
        const z0 = values[2];
        const restX = vrmHipsNode?.position.x ?? 0;
        const restZ = vrmHipsNode?.position.z ?? 0;
        for (let i = 0; i < n; i++) {
          const f = i / (n - 1);
          values[i * 3] = values[i * 3] - x0 - dx * f + restX;
          values[i * 3 + 2] = values[i * 3 + 2] - z0 - dz * f + restZ;
        }
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${vrmNode.name}.position`, Array.from(track.times), Array.from(values)));
    }
  }
  if (tracks.length === 0) throw new Error('no humanoid bones found in this FBX');
  return new THREE.AnimationClip('arsistPreview', source.duration, tracks);
}
