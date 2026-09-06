import { useEffect, useState } from 'react';
import { X, FolderOpen, Sun, Moon } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../i18n';
import { useTheme } from '../../theme';
import type { Lang } from '../../i18n';

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const {
    leftPanelWidth,
    rightPanelWidth,
    bottomPanelHeight,
    setLeftPanelWidth,
    setRightPanelWidth,
    setBottomPanelHeight,
    addNotification,
  } = useUIStore();

  const [unityPath, setUnityPath] = useState('');
  const [unityVersion, setUnityVersion] = useState('');
  const [unityManualLicenseFile, setUnityManualLicenseFile] = useState('');
  const [defaultOutputPath, setDefaultOutputPath] = useState('');
  const [sdkDir, setSdkDir] = useState('');
  const [versionDetected, setVersionDetected] = useState<string | null>(null);
  const [unityCandidates, setUnityCandidates] = useState<string[]>([]);
  const [detectingUnity, setDetectingUnity] = useState(false);
  const [xrealSdkStatus, setXrealSdkStatus] = useState<{ exists: boolean; path?: string; version?: string; error?: string } | null>(null);
  const [questSdkStatus, setQuestSdkStatus] = useState<{ exists: boolean; path?: string; corePackage?: string; mrukPackage?: string; error?: string } | null>(null);
  const [bundledDeps, setBundledDeps] = useState<Array<{ name: string; path: string; exists: boolean; description: string }>>([]);

  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return;

      const storedUnityPath = await window.electronAPI.unity.getPath();
      if (storedUnityPath) {
        setUnityPath(storedUnityPath);
      }

      const storedUnityVersion = await window.electronAPI.store.get('unityVersion');
      if (storedUnityVersion) {
        setUnityVersion(storedUnityVersion);
      }

      const storedManualLicense = await window.electronAPI.store.get('unityManualLicenseFile');
      if (storedManualLicense) {
        setUnityManualLicenseFile(storedManualLicense);
      }

      const storedOutputPath = await window.electronAPI.store.get('defaultOutputPath');
      if (storedOutputPath) {
        setDefaultOutputPath(storedOutputPath);
      }

      const api: any = window.electronAPI as any;
      if (typeof api?.sdk?.getDir === 'function') {
        const storedSdkDir = await api.sdk.getDir();
        if (storedSdkDir) setSdkDir(storedSdkDir);
      }

      const validation = await window.electronAPI.unity.validate();
      if (validation?.version) {
        setVersionDetected(validation.version);
      }

      // XREAL SDK status (visible on settings screen)
      try {
        if (api.sdk?.xrealStatus) {
          const s = await api.sdk.xrealStatus();
          setXrealSdkStatus(s);
        } else {
          setXrealSdkStatus({ exists: false, error: 'SDK detection API unavailable (Electron restart may be required)' });
        }
      } catch (e) {
        setXrealSdkStatus({ exists: false, error: String((e as any)?.message || e) });
      }

      // Quest SDK status
      try {
        if (api.sdk?.questStatus) {
          const s = await api.sdk.questStatus();
          setQuestSdkStatus(s);
        } else {
          setQuestSdkStatus({ exists: false, error: 'SDK detection API unavailable (Electron restart may be required)' });
        }
      } catch (e) {
        setQuestSdkStatus({ exists: false, error: String((e as any)?.message || e) });
      }

      // Bundled dependencies
      try {
        if (api.sdk?.bundledDeps) {
          const result = await api.sdk.bundledDeps();
          if (result?.deps) setBundledDeps(result.deps);
        }
      } catch (_e) {
        // ignore
      }
    };

    loadSettings();
  }, []);

  const guessUnityExeFromSelected = async (selectedPath: string): Promise<string> => {
    const api: any = window.electronAPI as any;
    // If it's already a file-like path, keep it as is
    if (selectedPath.endsWith('/Editor/Unity') || selectedPath.endsWith('Unity.exe') || selectedPath.includes('Unity.app')) {
      return selectedPath;
    }

    // Complete if directory (e.g., ~/Unity/Hub/Editor/6000.0.61f1) was selected
    const linuxCandidate = `${selectedPath}/Editor/Unity`;
    const winCandidate = `${selectedPath}\\Editor\\Unity.exe`;
    const macCandidate = `${selectedPath}/Unity.app/Contents/MacOS/Unity`;

    const hasExists = typeof api?.fs?.exists === 'function';
    if (!hasExists) {
      // Fail gracefully if preload is old and exists is not available
      addNotification({
        type: 'warning',
        message: 'Cannot verify Unity executable (Electron API may be outdated). Guessed path entered.',
      });
      return linuxCandidate;
    }

    const exists = async (p: string) => {
      const r = await api.fs.exists(p);
      return !!r?.exists;
    };

    // Check in order: Linux/Windows/macOS
    if (await exists(linuxCandidate)) return linuxCandidate;
    if (await exists(winCandidate)) return winCandidate;
    if (await exists(macCandidate)) return macCandidate;

    return selectedPath;
  };

  const parseUnityVersionFromPath = (p: string): string | null => {
    // Extract Hub Editor directory name (e.g., 6000.0.61f1 / 2022.3.20f1)
    const m = p.match(/(\d+\.\d+\.\d+(?:f\d+)?)/);
    return m ? m[1] : null;
  };

  const handleSelectUnityPath = async () => {
    if (!window.electronAPI) return;

    // First allow selecting 'version folder' via directory selection (clearer for Linux operations)
    const pickedDir = await window.electronAPI.fs.selectDirectory();
    let picked = pickedDir;

    // Fall back to file selection if directory is cancelled
    if (!picked) {
      const file = await window.electronAPI.fs.selectFile([
        { name: 'Unity', extensions: ['exe', 'app', 'Unity'] },
      ]);
      picked = file || null;
    }

    if (!picked) return;

    const resolved = await guessUnityExeFromSelected(picked);
    setUnityPath(resolved);
    await window.electronAPI.unity.setPath(resolved);
    const validation = await window.electronAPI.unity.validate();
    if (validation?.version) {
      setVersionDetected(validation.version);
      // Auto-fill if not manually entered
      if (!unityVersion.trim()) setUnityVersion(validation.version);
    } else {
      // Infer from directory name if validate is not available
      const v = parseUnityVersionFromPath(resolved);
      if (v && !unityVersion.trim()) setUnityVersion(v);
    }
  };

  const handleDetectUnityPath = async () => {
    if (!window.electronAPI) return;
    setDetectingUnity(true);
    try {
      const api: any = window.electronAPI as any;
      if (typeof api?.unity?.detectPaths !== 'function') {
        addNotification({ type: 'error', message: 'Unity auto-detection API unavailable (Electron restart may be required)' });
        return;
      }

      const result = await api.unity.detectPaths();
      if (!result?.success) {
        addNotification({ type: 'error', message: result?.error || 'Failed to auto-detect Unity path' });
        return;
      }
      const details = (result as any).details as Array<{ path: string; version?: string }> | undefined;
      const candidates = (details && details.length > 0)
        ? details.map((d) => d.path)
        : (result.candidates || []);
      setUnityCandidates(candidates);

      if (candidates.length > 0) {
        const p = candidates[0];
        setUnityPath(p);
        await window.electronAPI.unity.setPath(p);
        const validation = await window.electronAPI.unity.validate();
        if (validation?.version) {
          setVersionDetected(validation.version);
          if (!unityVersion.trim()) setUnityVersion(validation.version);
        } else {
          const v = p.match(/(\d+\.\d+\.\d+(?:f\d+)?)/)?.[1];
          if (v && !unityVersion.trim()) setUnityVersion(v);
        }
      } else {
        addNotification({ type: 'warning', message: 'Unity not found. Please check Unity Hub Editor installation.' });
      }
    } finally {
      setDetectingUnity(false);
    }
  };

  const handleSelectOutputPath = async () => {
    if (!window.electronAPI) return;

    const path = await window.electronAPI.fs.selectDirectory();
    if (path) {
      setDefaultOutputPath(path);
      await window.electronAPI.store.set('defaultOutputPath', path);
    }
  };

  const handleSelectSdkDir = async () => {
    if (!window.electronAPI) return;
    const picked = await window.electronAPI.fs.selectDirectory();
    if (picked) {
      setSdkDir(picked);
    }
  };

  const handleSelectManualLicenseFile = async () => {
    if (!window.electronAPI) return;
    const file = await window.electronAPI.fs.selectFile([
      { name: 'Unity License', extensions: ['ulf'] },
      { name: 'All', extensions: ['*'] },
    ]);
    if (file) setUnityManualLicenseFile(file);
  };

  const handleSave = async () => {
    if (!window.electronAPI) return;

    if (unityPath) {
      await window.electronAPI.unity.setPath(unityPath);
    }
    await window.electronAPI.store.set('unityVersion', unityVersion.trim());
    await window.electronAPI.store.set('unityManualLicenseFile', unityManualLicenseFile.trim());
    await window.electronAPI.store.set('defaultOutputPath', defaultOutputPath);
    const sdkApi: any = window.electronAPI as any;
    if (typeof sdkApi?.sdk?.setDir === 'function') {
      await sdkApi.sdk.setDir(sdkDir.trim());
    }
    await window.electronAPI.store.set('layoutSettings', {
      leftPanelWidth,
      rightPanelWidth,
      bottomPanelHeight,
    });

    addNotification({ type: 'success', message: 'Settings saved' });
    onClose();
  };

  const handleResetLayout = () => {
    setLeftPanelWidth(280);
    setRightPanelWidth(320);
    setBottomPanelHeight(200);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header flex items-center justify-between">
          <span>{t('common.settings')}</span>
          <button onClick={onClose} className="btn-icon">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body overflow-y-auto max-h-[70vh] space-y-6">
          {/* Appearance: language + theme */}
          <section>
            <h3 className="text-xs font-medium text-arsist-accent mb-3">{t('settings.appearance')}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="input-label">{t('common.language')}</label>
                <div className="flex gap-1 bg-arsist-hover rounded-md p-0.5">
                  {(['ja', 'en'] as Lang[]).map((l) => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`flex-1 px-3 py-1.5 rounded text-sm transition-colors ${
                        lang === l ? 'bg-arsist-active text-arsist-accent' : 'text-arsist-muted hover:text-arsist-text'
                      }`}
                    >
                      {l === 'ja' ? '日本語' : 'English'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="input-label">{t('common.theme')}</label>
                <div className="flex gap-1 bg-arsist-hover rounded-md p-0.5">
                  <button
                    onClick={() => setTheme('dark')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                      theme === 'dark' ? 'bg-arsist-active text-arsist-accent' : 'text-arsist-muted hover:text-arsist-text'
                    }`}
                  >
                    <Moon size={14} /> {t('common.themeDark')}
                  </button>
                  <button
                    onClick={() => setTheme('light')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                      theme === 'light' ? 'bg-arsist-active text-arsist-accent' : 'text-arsist-muted hover:text-arsist-text'
                    }`}
                  >
                    <Sun size={14} /> {t('common.themeLight')}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-medium text-arsist-accent mb-3">{t('settings.unitySettings')}</h3>
            <div className="space-y-3">
              <div>
                <label className="input-label">{t('settings.unityPath')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={unityPath}
                    onChange={(e) => setUnityPath(e.target.value)}
                    className="input flex-1"
                    placeholder="Linux: /home/<user>/Unity/Hub/Editor/<ver>/Editor/Unity"
                  />
                  <button onClick={handleSelectUnityPath} className="btn btn-secondary">
                    <FolderOpen size={16} />
                  </button>
                  <button onClick={handleDetectUnityPath} className="btn btn-secondary" disabled={detectingUnity}>
                    {t('settings.autoDetect')}
                  </button>
                </div>
                {versionDetected && (
                  <p className="text-xs text-arsist-success mt-1">{t('settings.detected', { version: versionDetected })}</p>
                )}
                <p className="text-xs text-arsist-muted mt-1">
                  Linux: typically <span className="font-mono">.../Editor/Unity</span>, Windows: <span className="font-mono">.../Editor/Unity.exe</span>
                </p>

                {unityCandidates.length > 0 && (
                  <div className="mt-2 p-2 bg-arsist-hover rounded-md">
                    <div className="text-[10px] text-arsist-muted mb-1">{t('settings.candidates')}</div>
                    <div className="space-y-1">
                      {unityCandidates.map((p) => (
                        <button
                          key={p}
                          className="w-full text-left text-[10px] text-arsist-text hover:text-arsist-accent truncate"
                          onClick={async () => {
                            setUnityPath(p);
                            await window.electronAPI.unity.setPath(p);
                            const validation = await window.electronAPI.unity.validate();
                            if (validation?.version) {
                              setVersionDetected(validation.version);
                              if (!unityVersion.trim()) setUnityVersion(validation.version);
                            } else {
                              const v = p.match(/(\d+\.\d+\.\d+(?:f\d+)?)/)?.[1];
                              if (v && !unityVersion.trim()) setUnityVersion(v);
                            }
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="input-label">{t('settings.licenseFile')}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={unityManualLicenseFile}
                      onChange={(e) => setUnityManualLicenseFile(e.target.value)}
                      className="input flex-1"
                      placeholder="Example: /home/<user>/.local/share/unity3d/Unity/Unity_lic.ulf"
                    />
                    <button onClick={handleSelectManualLicenseFile} className="btn btn-secondary">
                      <FolderOpen size={16} />
                    </button>
                  </div>
                  <p className="text-xs text-arsist-muted mt-1">
                    If specified, builds will use <span className="font-mono">-manualLicenseFile</span> flag
                  </p>
                </div>
              </div>

              <div>
                <label className="input-label">{t('settings.requiredUnityVersion')}</label>
                <input
                  type="text"
                  value={unityVersion}
                  onChange={(e) => setUnityVersion(e.target.value)}
                  className="input"
                  placeholder="2022.3.20f1"
                />
                <p className="text-xs text-arsist-muted mt-1">
                  {t('settings.versionHint')}
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-medium text-arsist-accent mb-3">{t('settings.sdkDirectory')}</h3>
            <div className="space-y-2 text-xs">
              <div className="text-arsist-muted">
                Root directory containing SDK files (<span className="font-mono">com.xreal.xr/</span>, <span className="font-mono">quest/</span>, <span className="font-mono">nupkg/</span>, etc.).
                Leave blank to use the default <span className="font-mono">sdk/</span> folder next to the app.
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={sdkDir}
                  onChange={(e) => setSdkDir(e.target.value)}
                  className="input flex-1"
                  placeholder="(default: sdk/ next to app)"
                />
                <button onClick={handleSelectSdkDir} className="btn btn-secondary">
                  <FolderOpen size={16} />
                </button>
                {sdkDir && (
                  <button onClick={() => setSdkDir('')} className="btn btn-ghost text-xs">
                    {t('common.clear')}
                  </button>
                )}
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-medium text-arsist-accent mb-3">{t('settings.sdkXreal')}</h3>
            <div className="space-y-2 text-xs">
              <div className="text-arsist-muted">
                Place XREAL SDK (UPM package) at
                <span className="font-mono"> sdk/com.xreal.xr/package </span>
                in repository root.
              </div>
              <div className="p-2 bg-arsist-hover rounded-md">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-arsist-muted">{t('settings.detectionStatus')}</div>
                  <div className={xrealSdkStatus?.exists ? 'text-arsist-success' : 'text-arsist-error'}>
                    {xrealSdkStatus?.exists ? t('settings.ok') : t('settings.notFound')}
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-arsist-muted">package.json</div>
                <div className="font-mono text-[10px] text-arsist-text break-all">
                  {xrealSdkStatus?.path || 'sdk/com.xreal.xr/package/package.json'}
                </div>
                {xrealSdkStatus?.version && (
                  <div className="mt-1 text-[10px] text-arsist-muted">
                    SDK version: <span className="text-arsist-text">{xrealSdkStatus.version}</span>
                  </div>
                )}
                {xrealSdkStatus?.error && (
                  <div className="mt-1 text-[10px] text-arsist-error whitespace-pre-wrap">{xrealSdkStatus.error}</div>
                )}
              </div>
              <div className="text-[10px] text-arsist-muted">
                ※ For XREAL builds, SDK is embedded to <span className="font-mono">Packages/com.xreal.xr</span> and
                <span className="font-mono">Packages/manifest.json</span> is auto-updated.
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-medium text-arsist-accent mb-3">{t('settings.sdkQuest')}</h3>
            <div className="space-y-2 text-xs">
              <div className="text-arsist-muted">
                Place Quest SDK at
                <span className="font-mono"> sdk/quest </span>
                directory.
              </div>
              <div className="p-2 bg-arsist-hover rounded-md">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-arsist-muted">{t('settings.detectionStatusCore')}</div>
                  <div className={questSdkStatus?.exists ? 'text-arsist-success' : 'text-arsist-error'}>
                    {questSdkStatus?.exists ? t('settings.ok') : t('settings.notFound')}
                  </div>
                </div>
                <div className="mt-1 text-[10px] text-arsist-muted">SDK Location</div>
                <div className="font-mono text-[10px] text-arsist-text break-all">
                  {questSdkStatus?.path || 'sdk/quest'}
                </div>
                <div className="mt-1 text-[10px] text-arsist-muted">Core package</div>
                <div className="font-mono text-[10px] text-arsist-text break-all">
                  {questSdkStatus?.corePackage || 'com.meta.xr.sdk.core-*.tgz'}
                </div>
                <div className="mt-1 text-[10px] text-arsist-muted">MR Utility Kit (Optional)</div>
                <div className="font-mono text-[10px] text-arsist-text break-all">
                  {questSdkStatus?.mrukPackage || 'com.meta.xr.mrutilitykit-*.tgz'}
                </div>
                {questSdkStatus?.error && (
                  <div className="mt-1 text-[10px] text-arsist-error whitespace-pre-wrap">{questSdkStatus.error}</div>
                )}
              </div>
              <div className="text-[10px] text-arsist-muted">
                ※ For Quest builds, .tgz files from <span className="font-mono">sdk/quest</span> are embedded to
                <span className="font-mono">Packages</span> and
                <span className="font-mono">Packages/manifest.json</span> is auto-updated.
              </div>
            </div>
          </section>

          {bundledDeps.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-arsist-accent mb-3">{t('settings.bundledDeps')}</h3>
              <div className="space-y-1">
                {bundledDeps.map((dep) => (
                  <div key={dep.name} className="p-2 bg-arsist-hover rounded-md flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-[11px] text-arsist-text font-medium">{dep.name}</div>
                      <div className="text-[10px] text-arsist-muted">{dep.description}</div>
                      <div className="font-mono text-[10px] text-arsist-muted truncate">{dep.path}</div>
                    </div>
                    <div className={`text-[10px] shrink-0 ml-2 ${dep.exists ? 'text-arsist-success' : 'text-arsist-error'}`}>
                      {dep.exists ? t('settings.ok') : t('settings.notFound')}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="text-xs font-medium text-arsist-primary mb-3">{t('settings.buildSettings')}</h3>
            <div>
              <label className="input-label">{t('settings.defaultOutputDir')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={defaultOutputPath}
                  onChange={(e) => setDefaultOutputPath(e.target.value)}
                  className="input flex-1"
                  placeholder="/path/to/output"
                />
                <button onClick={handleSelectOutputPath} className="btn btn-secondary">
                  <FolderOpen size={16} />
                </button>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-medium text-arsist-warning mb-3">{t('settings.layoutSettings')}</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="input-label">{t('settings.leftPanelWidth')}</label>
                <input
                  type="number"
                  value={leftPanelWidth}
                  onChange={(e) => setLeftPanelWidth(Number(e.target.value))}
                  className="input"
                  min={200}
                  max={500}
                />
              </div>
              <div>
                <label className="input-label">{t('settings.rightPanelWidth')}</label>
                <input
                  type="number"
                  value={rightPanelWidth}
                  onChange={(e) => setRightPanelWidth(Number(e.target.value))}
                  className="input"
                  min={250}
                  max={500}
                />
              </div>
              <div>
                <label className="input-label">{t('settings.bottomPanelHeight')}</label>
                <input
                  type="number"
                  value={bottomPanelHeight}
                  onChange={(e) => setBottomPanelHeight(Number(e.target.value))}
                  className="input"
                  min={100}
                  max={400}
                />
              </div>
            </div>
            <div className="mt-3">
              <button onClick={handleResetLayout} className="btn btn-ghost text-xs">
                {t('settings.resetLayout')}
              </button>
            </div>
          </section>
        </div>

        <div className="modal-footer flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">{t('common.cancel')}</button>
          <button onClick={handleSave} className="btn btn-success">{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
