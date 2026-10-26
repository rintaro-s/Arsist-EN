import { describe, it, expect } from 'vitest';
import { checkCameraSettings, checkMediaSource, mediaIssues, streamUrlLooksValid, cameraSettingsOf } from './media';
import { unityScenesData, unityUiData } from '../bridge/UnityBridge';
import { CAMERA_DEFAULTS, EMBODY_DEFAULTS } from './types';

const cam = (over: Record<string, unknown> = {}) => ({ id: 'c1', name: 'Cam', assetId: 'Cam', type: 'camera', transform: {}, ...over });
const vrm = (id: string, embody?: Record<string, unknown>) => ({ id, name: id, type: 'vrm', transform: {}, character: { blink: true, ...(embody ? { embody } : {}) } });
const image = (source: unknown, type = 'Image') => ({ id: 'img', bindingId: 'screen', type, style: {}, children: [], source });
const project = (objects: unknown[], root: unknown) => ({
  scenes: [{ id: 's', name: 'S', objects }],
  uiLayouts: [{ id: 'l', name: 'L', scope: 'canvas', resolution: { width: 100, height: 100 }, root: { id: 'r', type: 'Panel', style: {}, children: [root] } }],
}) as any;

describe('cameras, image sources, embody (doc/23)', () => {
  it('stream urls must be http(s) once {store:…} is filled in', () => {
    expect(streamUrlLooksValid('http://{store:pc.address}/stream/slides')).toBe(true);
    expect(streamUrlLooksValid('https://example.com/s')).toBe(true);
    expect(streamUrlLooksValid('{store:pc.url}')).toBe(true); // 全体が store の値: 確かめられない
    expect(streamUrlLooksValid('rtsp://x')).toBe(false);
    expect(streamUrlLooksValid('')).toBe(false);
  });

  it('reports a missing camera (error), a bad stream url and two embodied VRMs (warnings), and a bad resolution (error)', () => {
    const missing = mediaIssues(project([cam()], image({ kind: 'camera', camera: 'Other' })));
    expect(missing.problems).toHaveLength(1);
    expect(missing.problems[0]).toMatch(/camera "Other"/);
    expect(mediaIssues(project([cam()], image({ kind: 'camera', camera: 'c1' }))).problems).toEqual([]);
    expect(mediaIssues(project([cam()], image({ kind: 'camera', camera: 'Cam' }))).problems).toEqual([]);

    const stream = mediaIssues(project([], image({ kind: 'stream', url: 'ftp://x' })));
    expect(stream.problems).toEqual([]);
    expect(stream.warnings[0]).toMatch(/http:\/\//);

    const two = mediaIssues(project([vrm('A', { enabled: true }), vrm('B', {}), vrm('C', { enabled: false })], image(undefined)));
    expect(two.warnings).toHaveLength(1);
    expect(two.warnings[0]).toMatch(/2 VRMs/);

    const big = mediaIssues(project([cam({ camera: { resolution: [8000, 1080] } })], image(undefined)));
    expect(big.problems[0]).toMatch(/resolution/);
  });

  it('checks values coming from agents', () => {
    expect(checkCameraSettings({ fov: 60, resolution: [1280, 720] })).toBeNull();
    expect(checkCameraSettings({ resolution: [10, 720] })).toMatch(/resolution/);
    expect(checkCameraSettings({ zoom: 2 })).toMatch(/unknown key/);
    expect(checkMediaSource({ kind: 'camera', camera: 'Cam' }, project([cam()], image(undefined)))).toBeNull();
    expect(checkMediaSource({ kind: 'camera', camera: 'X' }, project([cam()], image(undefined)))).toMatch(/not a camera/);
    expect(checkMediaSource({ kind: 'video', url: 'x' })).toMatch(/kind/);
  });

  it('fills the defaults for Unity without touching the IR, and is idempotent', () => {
    const scenes = project([cam({ camera: { fov: 30 } }), cam({ id: 'c2', camera: undefined }), vrm('Me', { hands: 'hands' }), vrm('Other')], image({ kind: 'stream', url: 'http://x' }));
    const before = JSON.stringify(scenes);
    const out = unityScenesData(scenes.scenes);
    expect(out[0].objects[0].camera).toEqual({ ...CAMERA_DEFAULTS, fov: 30 });
    expect(out[0].objects[1].camera).toEqual(CAMERA_DEFAULTS);
    expect(out[0].objects[2].character!.embody).toEqual({ ...EMBODY_DEFAULTS, hands: 'hands' });
    expect('embody' in out[0].objects[3].character!).toBe(false);
    expect(unityScenesData(out)).toEqual(out);
    const ui = unityUiData(scenes.uiLayouts);
    expect(ui[0].root.children[0].source).toEqual({ kind: 'stream', url: 'http://x', mirror: false });
    expect(JSON.stringify(scenes)).toBe(before);
    expect(cameraSettingsOf({ resolution: 'big' as any }).resolution).toEqual([1920, 1080]);
  });
});
