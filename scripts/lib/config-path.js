// Resolve the electron-store config.json path for standalone scripts, reusing
// the SAME logic as the Electron main process so the two never drift.
// Falls back to an inline implementation if dist/ hasn't been built yet.
const path = require('path');
const os = require('os');

function inlineConfigStorePath(appName) {
  const platform = process.platform;
  const home = os.homedir();
  const env = process.env;
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, appName, 'config.json');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appName, 'config.json');
  }
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  return path.join(xdg, appName, 'config.json');
}

function getConfigStorePath(appName = 'arsist-engine') {
  try {
    // Prefer the compiled main-process helper (single source of truth).
    const mod = require(path.join(__dirname, '..', '..', 'dist', 'main', 'main', 'platform', 'paths'));
    if (mod && typeof mod.getConfigStorePath === 'function') {
      return mod.getConfigStorePath(mod.liveContext(os.homedir()), appName);
    }
  } catch {
    // dist not built yet — use the inline fallback below.
  }
  return inlineConfigStorePath(appName);
}

module.exports = { getConfigStorePath };
