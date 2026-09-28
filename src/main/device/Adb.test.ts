import { describe, it, expect } from 'vitest';
import { parseDeviceLine } from './Adb';

describe('adb devices', () => {
  it('reads a usable device with its model name', () => {
    const device = parseDeviceLine('1WMHH815Z1234A         device product:eureka model:Quest_3 device:eureka transport_id:3');
    expect(device).toEqual({ serial: '1WMHH815Z1234A', state: 'device', model: 'Quest 3', label: 'Quest 3 (1WMHH815Z1234A)' });
  });

  it('keeps devices that are not ready, so the reason can be shown', () => {
    expect(parseDeviceLine('abc123   unauthorized')).toMatchObject({ serial: 'abc123', state: 'unauthorized', label: 'abc123' });
    expect(parseDeviceLine('192.168.1.5:5555   offline')).toMatchObject({ state: 'offline' });
  });

  it('skips the header and daemon chatter', () => {
    expect(parseDeviceLine('List of devices attached')).toBeNull();
    expect(parseDeviceLine('* daemon started successfully')).toBeNull();
    expect(parseDeviceLine('')).toBeNull();
  });

  it('falls back to the device code when there is no model', () => {
    expect(parseDeviceLine('serial7 device device:xr_hmd')).toMatchObject({ label: 'serial7' });
  });
});
