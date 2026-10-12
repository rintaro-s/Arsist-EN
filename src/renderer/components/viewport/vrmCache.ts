/**
 * 読み込んだ VRM を、オブジェクトごとに覚えておく。
 *
 * VRM は読み込み (数 MB の解析とテクスチャの転送) が重い。3D ビューを作り直したとき
 * (ライブ配置モードから戻る、プロジェクトを読み直す) に毎回読み直すと、アバターが一度消えて出直す。
 * 1 つの VRM のシーンは同時に 1 か所にしか置けないので、キーは「オブジェクト id + URL」。
 * プロジェクトから消えたオブジェクトのものは pruneVrmCache で捨てる (GPU のメモリも返す)。
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';

interface Entry {
  promise: Promise<VRM>;
  vrm?: VRM;
}

const cache = new Map<string, Entry>();

export const vrmKey = (objectId: string, url: string) => `${objectId}|${url}`;

/** 読み込み済みならその VRM (同期で欲しいとき: 作り直した直後に一瞬でも空にしないため) */
export function peekVrm(objectId: string, url: string): VRM | undefined {
  return cache.get(vrmKey(objectId, url))?.vrm;
}

export function loadVrm(objectId: string, url: string): Promise<VRM> {
  const key = vrmKey(objectId, url);
  const hit = cache.get(key);
  if (hit) return hit.promise;

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const entry: Entry = {
    promise: loader.loadAsync(url).then((gltf) => {
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) throw new Error('VRM data not found in file');
      // Adjust model orientation using VRMUtils.rotateVRM0 (一度だけ。覚えておいた VRM にはもう掛かっている)
      VRMUtils.rotateVRM0(vrm);
      entry.vrm = vrm;
      return vrm;
    }),
  };
  // 失敗したものは覚えない (ファイルを直したら読み直せるように)
  entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  cache.set(key, entry);
  return entry.promise;
}

/** keep に無いものを捨てる。 */
export function pruneVrmCache(keep: Set<string>): void {
  for (const [key, entry] of cache) {
    if (keep.has(key)) continue;
    cache.delete(key);
    if (entry.vrm) VRMUtils.deepDispose(entry.vrm.scene);
  }
}
