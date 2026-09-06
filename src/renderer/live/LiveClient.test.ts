/**
 * LiveClient を、実機と同じプロトコルを喋るモックデバイス
 * (scripts/mock-device.mjs) に対して実際に接続して確認する。
 *
 * ここで見たいのは「WebSocket が繋がるか」ではなく、
 *   ・requestId のひも付けと応答の解決
 *   ・認証トークンの付与
 *   ・実機が返す PascalCase のフィールドを正しく読めるか
 * といった、実機に繋いで初めて壊れていることが分かる部分。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error — 開発用スクリプト（型定義なし）
import { startMockDevice } from '../../../scripts/mock-device.mjs';
import { LiveClient, parseObjectState, parseViewerPose } from './LiveClient';

let device: { port: number; close: () => Promise<void> };

beforeAll(async () => {
  device = await startMockDevice({ port: 0, log: false });
});

afterAll(async () => {
  await device.close();
});

async function connected(password?: string) {
  const client = new LiveClient({ host: '127.0.0.1', port: device.port, password, requestTimeoutMs: 3000 });
  await client.connect();
  return client;
}

describe('LiveClient', () => {
  it('接続して ping に応答が返る', async () => {
    const client = await connected();
    const res = await client.request<any>('query', 'ping');
    expect(res.pong).toBe(true);
    client.disconnect();
  });

  it('getScene で全オブジェクトの Transform が取れる', async () => {
    const client = await connected();
    const res = await client.request<any>('query', 'getScene');
    const objects = res.objects.map(parseObjectState);

    expect(objects.length).toBeGreaterThan(0);
    const panel = objects.find((o: any) => o.id === 'MainPanel');
    expect(panel).toBeTruthy();
    expect(panel.position).toHaveLength(3);
    expect(panel.scale).toEqual([1, 1, 1]);
    client.disconnect();
  });

  it('getHeadPose で視点姿勢が取れる（正面ベクトル付き）', async () => {
    const client = await connected();
    const pose = parseViewerPose(await client.request<any>('query', 'getHeadPose'));

    expect(pose).toBeTruthy();
    expect(pose!.available).toBe(true);
    expect(pose!.forward).toHaveLength(3);
    const len = Math.hypot(...pose!.forward);
    expect(len).toBeCloseTo(1, 3); // 正規化されている
    client.disconnect();
  });

  it('setPosition が実機側に反映される', async () => {
    const client = await connected();
    client.send('scene', 'setPosition', { id: 'SampleCube', x: 1.25, y: 0.5, z: 3 });

    // 投げっぱなし送信なので、次の往復で反映を確認する
    const res = await client.request<any>('query', 'getState', { id: 'SampleCube' });
    const state = parseObjectState(res);
    expect(state!.position).toEqual([1.25, 0.5, 3]);
    client.disconnect();
  });

  it('viewer.placeInFront でユーザーからの距離に置ける', async () => {
    const client = await connected();
    const before = parseViewerPose(await client.request<any>('query', 'getHeadPose'))!;

    await client.request('viewer', 'placeInFront', { id: 'MainPanel', distance: 2, faceUser: true });

    const state = parseObjectState(await client.request<any>('query', 'getState', { id: 'MainPanel' }))!;
    const dx = state.position[0] - before.position[0];
    const dy = state.position[1] - before.position[1];
    const dz = state.position[2] - before.position[2];
    // モックの頭は動き続けるので厳密一致はしない。距離が概ね2mになっていることを見る
    expect(Math.hypot(dx, dy, dz)).toBeGreaterThan(1.5);
    expect(Math.hypot(dx, dy, dz)).toBeLessThan(2.5);
    client.disconnect();
  });

  it('不明なコマンドはエラーとして reject される', async () => {
    const client = await connected();
    await expect(client.request('query', 'noSuchMethod')).rejects.toThrow(/Unknown query method/);
    client.disconnect();
  });

  it('接続していないときの request は reject される', async () => {
    const client = new LiveClient({ host: '127.0.0.1', port: device.port });
    await expect(client.request('query', 'ping')).rejects.toThrow(/not connected/);
  });
});

describe('LiveClient 認証', () => {
  let secured: { port: number; close: () => Promise<void> };

  beforeAll(async () => {
    secured = await startMockDevice({ port: 0, password: 'secret', log: false });
  });
  afterAll(async () => {
    await secured.close();
  });

  it('正しいパスワードなら通る', async () => {
    const client = new LiveClient({ host: '127.0.0.1', port: secured.port, password: 'secret', requestTimeoutMs: 3000 });
    await client.connect();
    const res = await client.request<any>('query', 'ping');
    expect(res.pong).toBe(true);
    client.disconnect();
  });

  it('パスワードが違うと認証エラーになる', async () => {
    const client = new LiveClient({ host: '127.0.0.1', port: secured.port, password: 'wrong', requestTimeoutMs: 3000 });
    await client.connect();
    await expect(client.request('query', 'ping')).rejects.toThrow(/Authentication failed/);
    client.disconnect();
  });
});
