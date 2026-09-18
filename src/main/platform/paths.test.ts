import { describe, it, expect } from 'vitest';
import {
  getConfigStorePath,
  getGradleCandidates,
  getUnitySearchRoots,
  getUnityLicenseCandidates,
  getAndroidSdkDefault,
  getUnityDirectCandidates,
  isWaylandSession,
  type PlatformContext,
} from './paths';

const linux = (env: NodeJS.ProcessEnv = {}): PlatformContext => ({ platform: 'linux', homedir: '/home/u', env });
const win = (env: NodeJS.ProcessEnv = {}): PlatformContext => ({ platform: 'win32', homedir: 'C:\\Users\\u', env });
const mac = (env: NodeJS.ProcessEnv = {}): PlatformContext => ({ platform: 'darwin', homedir: '/Users/u', env });

// The functions use path.join, which emits the HOST separator. When these tests
// run on Linux CI, win32-context outputs come back '/'-joined. Normalize so the
// assertions are host-agnostic (at runtime, host === platform, so it's correct).
const norm = (p: string) => p.replace(/\\/g, '/');

describe('getConfigStorePath', () => {
  it('linux uses ~/.config by default', () => {
    expect(getConfigStorePath(linux())).toBe('/home/u/.config/arsist-engine/config.json');
  });
  it('linux honors XDG_CONFIG_HOME', () => {
    expect(getConfigStorePath(linux({ XDG_CONFIG_HOME: '/tmp/cfg' }))).toBe('/tmp/cfg/arsist-engine/config.json');
  });
  it('windows uses APPDATA', () => {
    expect(norm(getConfigStorePath(win({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }))))
      .toBe('C:/Users/u/AppData/Roaming/arsist-engine/config.json');
  });
  it('macOS uses Application Support', () => {
    expect(getConfigStorePath(mac())).toBe('/Users/u/Library/Application Support/arsist-engine/config.json');
  });
});

describe('getUnitySearchRoots', () => {
  it('linux includes hub, /opt, xdg-data and flatpak roots', () => {
    const roots = getUnitySearchRoots(linux());
    expect(roots).toContain('/home/u/Unity/Hub/Editor');
    expect(roots).toContain('/home/u/.local/share/unity3d/Hub/Editor');
    expect(roots).toContain('/opt/Unity/Hub/Editor');
    expect(roots.some((r) => r.includes('com.unity.UnityHub'))).toBe(true);
  });
  it('linux honors XDG_DATA_HOME', () => {
    const roots = getUnitySearchRoots(linux({ XDG_DATA_HOME: '/data' }));
    expect(roots).toContain('/data/unity3d/Hub/Editor');
  });
  it('windows uses ProgramFiles roots', () => {
    const roots = getUnitySearchRoots(win({ ProgramFiles: 'C:\\Program Files' })).map(norm);
    expect(roots).toContain('C:/Program Files/Unity/Hub/Editor');
  });
});

describe('getUnityDirectCandidates', () => {
  it('honors UNITY_PATH and distro path on linux', () => {
    const c = getUnityDirectCandidates(linux({ UNITY_PATH: '/custom/Unity' }));
    expect(c).toContain('/custom/Unity');
    expect(c).toContain('/usr/bin/unity-editor');
  });
});

describe('getUnityLicenseCandidates', () => {
  it('provides windows candidates (regression: was linux-only)', () => {
    const c = getUnityLicenseCandidates(win({ ProgramData: 'C:\\ProgramData', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' })).map(norm);
    expect(c).toContain('C:/ProgramData/Unity/Unity_lic.ulf');
  });
  it('provides macOS candidates', () => {
    const c = getUnityLicenseCandidates(mac());
    expect(c.some((p) => p.includes('/Library/Application Support/Unity/Unity_lic.ulf'))).toBe(true);
  });
  it('linux candidates respect XDG_DATA_HOME', () => {
    const c = getUnityLicenseCandidates(linux({ XDG_DATA_HOME: '/data' }));
    expect(c).toContain('/data/unity3d/Unity/Unity_lic.ulf');
  });
});

describe('getAndroidSdkDefault', () => {
  it('per-OS defaults', () => {
    expect(getAndroidSdkDefault(linux())).toBe('/home/u/Android/Sdk');
    expect(norm(getAndroidSdkDefault(win({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' })))).toBe('C:/Users/u/AppData/Local/Android/Sdk');
    expect(getAndroidSdkDefault(mac())).toBe('/Users/u/Library/Android/sdk');
  });
});

describe('isWaylandSession', () => {
  it('true when XDG_SESSION_TYPE=wayland', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' })).toBe(true);
  });
  it('false when XDG_SESSION_TYPE=x11 even with WAYLAND_DISPLAY', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'wayland-0' })).toBe(false);
  });
  it('true when only WAYLAND_DISPLAY is set', () => {
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true);
  });
  it('false when nothing set', () => {
    expect(isWaylandSession({})).toBe(false);
  });
});

describe('getGradleCandidates', () => {
  const linux = { platform: 'linux' as const, homedir: '/home/u', env: { PATH: '/usr/bin:/opt/bin' } };

  it('puts Unity\'s bundled Gradle first, since that is what the Android build uses', () => {
    const candidates = getGradleCandidates(linux, '/home/u/Unity/Hub/Editor/6000.0.81f1/Editor/Unity');
    expect(candidates[0]).toBe(
      '/home/u/Unity/Hub/Editor/6000.0.81f1/Editor/Data/PlaybackEngines/AndroidPlayer/Tools/gradle',
    );
  });

  it('falls back to GRADLE_HOME and then PATH', () => {
    const ctx = { ...linux, env: { ...linux.env, GRADLE_HOME: '/usr/share/java/gradle' } };
    const candidates = getGradleCandidates(ctx, null);
    expect(candidates[0]).toBe('/usr/share/java/gradle/bin/gradle');
    expect(candidates).toContain('/usr/bin/gradle');
    expect(candidates).toContain('/opt/bin/gradle');
  });

  it('uses gradle.bat and ; separators on Windows', () => {
    const windows = {
      platform: 'win32' as const,
      homedir: 'C:\\Users\\u',
      env: { PATH: 'C:\\gradle\\bin;C:\\tools' },
    };
    const candidates = getGradleCandidates(windows, null);
    expect(candidates.some((c) => c.endsWith('gradle.bat'))).toBe(true);
    expect(candidates.some((c) => c.endsWith('/gradle') && !c.endsWith('.bat'))).toBe(false);
  });

  it('does not list the same place twice', () => {
    const ctx = { ...linux, env: { PATH: '/usr/bin:/usr/bin' } };
    const candidates = getGradleCandidates(ctx, null);
    expect(candidates.filter((c) => c === '/usr/bin/gradle')).toHaveLength(1);
  });
});
