// ==============================================
// Arsist Engine - Cross-platform path & environment helpers
// src/main/platform/paths.ts
//
// Single home for OS-dependent path/tool detection so Linux and Windows behave
// identically and "same OS, slightly different environment" cases stay portable.
//
// Every function is pure and takes its environment via `PlatformContext` so the
// logic can be unit-tested per OS without touching the real machine.
// ==============================================

import * as path from 'path';

export type NodePlatform = NodeJS.Platform;

export interface PlatformContext {
  platform: NodePlatform;
  homedir: string;
  env: NodeJS.ProcessEnv;
}

/** Build a context from the live process (default for runtime callers). */
export function liveContext(homedir: string): PlatformContext {
  return { platform: process.platform, homedir, env: process.env };
}

// ------------------------------------------------------------------
// Config store location (electron-store `config.json`)
// Mirrors electron-store's default `userData` layout so standalone scripts and
// the main process resolve the SAME file, while respecting XDG_CONFIG_HOME /
// %APPDATA% overrides (portable installs, custom config homes).
// appName defaults to 'arsist-engine' (see electron-store config in main.ts).
// ------------------------------------------------------------------
export function getConfigStorePath(ctx: PlatformContext, appName = 'arsist-engine'): string {
  return path.join(getConfigDir(ctx, appName), 'config.json');
}

export function getConfigDir(ctx: PlatformContext, appName = 'arsist-engine'): string {
  const { platform, homedir, env } = ctx;
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    return path.join(appData, appName);
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', appName);
  }
  // linux / others: honor XDG_CONFIG_HOME
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME : path.join(homedir, '.config');
  return path.join(xdg, appName);
}

// ------------------------------------------------------------------
// Unity editor search roots (Unity Hub installs a version-named dir under these)
// Each returned root is expected to contain `<version>/Editor/<unityExe>`.
// ------------------------------------------------------------------
export function getUnitySearchRoots(ctx: PlatformContext): string[] {
  const { platform, homedir, env } = ctx;
  const roots: string[] = [];

  if (platform === 'win32') {
    roots.push(path.join(env['ProgramFiles'] || 'C:\\Program Files', 'Unity', 'Hub', 'Editor'));
    roots.push(path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Unity', 'Hub', 'Editor'));
  } else if (platform === 'darwin') {
    roots.push(path.join('/Applications', 'Unity', 'Hub', 'Editor'));
    roots.push(path.join(homedir, 'Applications', 'Unity', 'Hub', 'Editor'));
  } else {
    // linux: cover Hub default, XDG data dir, /opt, and Snap/Flatpak layouts.
    roots.push(path.join(homedir, 'Unity', 'Hub', 'Editor'));
    const xdgData = env.XDG_DATA_HOME && env.XDG_DATA_HOME.trim() ? env.XDG_DATA_HOME : path.join(homedir, '.local', 'share');
    roots.push(path.join(xdgData, 'unity3d', 'Hub', 'Editor'));
    roots.push(path.join(xdgData, 'UnityHub', 'Editor'));
    roots.push(path.join('/opt', 'Unity', 'Hub', 'Editor'));
    roots.push(path.join('/opt', 'unityhub', 'Editor'));
    // Flatpak (com.unity.UnityHub) redirects HOME; still under the user's home.
    roots.push(path.join(homedir, '.var', 'app', 'com.unity.UnityHub', 'data', 'unity3d', 'Hub', 'Editor'));
  }

  return dedupe(roots);
}

/** The Unity editor executable name per platform (relative to `<root>/<version>/Editor/`). */
export function getUnityExeRelative(ctx: PlatformContext): string {
  if (ctx.platform === 'win32') return 'Unity.exe';
  if (ctx.platform === 'darwin') return path.join('..', 'Unity.app', 'Contents', 'MacOS', 'Unity');
  return 'Unity';
}

/**
 * Explicit override + well-known single-file locations that are NOT under a
 * Hub version dir (e.g. distro package, `UNITY_PATH` env, `/usr/bin`).
 */
export function getUnityDirectCandidates(ctx: PlatformContext): string[] {
  const { platform, env } = ctx;
  const out: string[] = [];
  for (const key of ['ARSIST_UNITY_PATH', 'UNITY_PATH', 'UNITY_EDITOR_PATH']) {
    if (env[key]) out.push(env[key] as string);
  }
  if (platform === 'linux') {
    out.push('/usr/bin/unity-editor');
    out.push('/usr/local/bin/unity-editor');
  }
  return dedupe(out);
}

// ------------------------------------------------------------------
// Unity manual license (.ulf) candidates — needed when headless token refresh
// fails. Previously Linux-only; now all three desktop OSes.
// ------------------------------------------------------------------
export function getUnityLicenseCandidates(ctx: PlatformContext): string[] {
  const { platform, homedir, env } = ctx;
  const out: string[] = [];

  if (env.ARSIST_UNITY_LICENSE) out.push(env.ARSIST_UNITY_LICENSE);
  if (env.UNITY_LICENSE_FILE) out.push(env.UNITY_LICENSE_FILE);

  if (platform === 'win32') {
    const programData = env.ProgramData || 'C:\\ProgramData';
    const appData = env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    out.push(path.join(programData, 'Unity', 'Unity_lic.ulf'));
    out.push(path.join(appData, 'Unity', 'Unity_lic.ulf'));
  } else if (platform === 'darwin') {
    out.push(path.join('/Library', 'Application Support', 'Unity', 'Unity_lic.ulf'));
    out.push(path.join(homedir, 'Library', 'Application Support', 'Unity', 'Unity_lic.ulf'));
  } else {
    const xdgData = env.XDG_DATA_HOME && env.XDG_DATA_HOME.trim() ? env.XDG_DATA_HOME : path.join(homedir, '.local', 'share');
    const xdgConfig = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME : path.join(homedir, '.config');
    out.push(path.join(xdgData, 'unity3d', 'Unity', 'Unity_lic.ulf'));
    out.push(path.join(xdgConfig, 'unity3d', 'Unity', 'Unity_lic.ulf'));
    out.push(path.join(xdgData, 'unity3d', 'Unity', 'Unity_lic.ulf.bak'));
  }

  return dedupe(out);
}

// ------------------------------------------------------------------
// Android SDK default location (used as a fallback when env vars are unset).
// ------------------------------------------------------------------
export function getAndroidSdkDefault(ctx: PlatformContext): string {
  const { platform, homedir, env } = ctx;
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');
    return path.join(localAppData, 'Android', 'Sdk');
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Android', 'sdk');
  }
  return path.join(homedir, 'Android', 'Sdk');
}

// ------------------------------------------------------------------
// Linux windowing: detect a real Wayland session so we DON'T force X11 there.
// Forcing ozone-platform-hint=x11 on a pure-Wayland box (no XWayland) can break
// window creation. We only default to X11 when we are clearly NOT on Wayland.
// ------------------------------------------------------------------
export function isWaylandSession(env: NodeJS.ProcessEnv): boolean {
  const sessionType = (env.XDG_SESSION_TYPE || '').toLowerCase();
  if (sessionType === 'wayland') return true;
  if (sessionType === 'x11') return false;
  // Fall back to the presence of a Wayland display socket.
  return !!(env.WAYLAND_DISPLAY && env.WAYLAND_DISPLAY.trim());
}

// ------------------------------------------------------------------
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!it) continue;
    const key = it.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
