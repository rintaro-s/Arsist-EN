import { useEffect, useState } from 'react';
import { X, FolderOpen } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
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
  const [defaultOutputPath, setDefaultOutputPath] = useState('');
  const [versionDetected, setVersionDetected] = useState<string | null>(null);
  const [unityCandidates, setUnityCandidates] = useState<string[]>([]);
  const [detectingUnity, setDetectingUnity] = useState(false);
  const [xrealSdkStatus, setXrealSdkStatus] = useState<{ exists: boolean; path?: string; version?: string; error?: string } | null>(null);

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

      const storedOutputPath = await window.electronAPI.store.get('defaultOutputPath');
      if (storedOutputPath) {
        setDefaultOutputPath(storedOutputPath);
      }

      const validation = await window.electronAPI.unity.validate();
      if (validation?.version) {
        setVersionDetected(validation.version);
      }

      // XREAL SDK状態（設定画面で見えるようにする）
      try {
        const api: any = window.electronAPI as any;
        if (api.sdk?.xrealStatus) {
          const s = await api.sdk.xrealStatus();
          setXrealSdkStatus(s);
        } else {
          setXrealSdkStatus({ exists: false, error: 'SDK検出APIが利用できません（Electronの再起動が必要な可能性があります）' });
        }
      } catch (e) {
        setXrealSdkStatus({ exists: false, error: String((e as any)?.message || e) });
      }
    };

    loadSettings();
  }, []);

  const guessUnityExeFromSelected = async (selectedPath: string): Promise<string> => {
    const api: any = window.electronAPI as any;
    // 既にファイルっぽいパスならそのまま
    if (selectedPath.endsWith('/Editor/Unity') || selectedPath.endsWith('Unity.exe') || selectedPath.includes('Unity.app')) {
      return selectedPath;
    }

    // ディレクトリ（例: ~/Unity/Hub/Editor/6000.0.61f1）を選んだ場合に補完
    const linuxCandidate = `${selectedPath}/Editor/Unity`;
    const winCandidate = `${selectedPath}\\Editor\\Unity.exe`;
    const macCandidate = `${selectedPath}/Unity.app/Contents/MacOS/Unity`;

    const hasExists = typeof api?.fs?.exists === 'function';
    if (!hasExists) {
      // preloadが古い等でexistsが無い場合でも落ちないようにする
      addNotification({
        type: 'warning',
        message: 'Unity実行ファイルの存在確認ができません（Electron側APIが古い可能性）。推測パスを入力しました。',
      });
      return linuxCandidate;
    }

    const exists = async (p: string) => {
      const r = await api.fs.exists(p);
      return !!r?.exists;
    };

    // Linux/Windows/MacOSの順で確認
    if (await exists(linuxCandidate)) return linuxCandidate;
    if (await exists(winCandidate)) return winCandidate;
    if (await exists(macCandidate)) return macCandidate;

    return selectedPath;
  };

  const parseUnityVersionFromPath = (p: string): string | null => {
    // HubのEditorディレクトリ名を拾う（例: 6000.0.61f1 / 2022.3.20f1）
    const m = p.match(/(\d+\.\d+\.\d+(?:f\d+)?)/);
    return m ? m[1] : null;
  };

  const handleSelectUnityPath = async () => {
    if (!window.electronAPI) return;

    // まず「バージョンフォルダ」を選べるようにディレクトリ選択（Linuxの実運用で分かりやすい）
    const pickedDir = await window.electronAPI.fs.selectDirectory();
    let picked = pickedDir;

    // ディレクトリがキャンセルされた場合はファイル選択にフォールバック
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
      // 手入力されていないなら自動で埋める
      if (!unityVersion.trim()) setUnityVersion(validation.version);
    } else {
      // validateが取れない場合はディレクトリ名から推測
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
        addNotification({ type: 'error', message: 'Unity自動検出APIが利用できません（Electronの再起動が必要な可能性があります）' });
        return;
      }

      const result = await api.unity.detectPaths();
      if (!result?.success) {
        addNotification({ type: 'error', message: result?.error || 'Unityパスの自動検出に失敗しました' });
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
        addNotification({ type: 'warning', message: 'Unityが見つかりませんでした。Unity HubのEditorインストールを確認してください。' });
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

  const handleSave = async () => {
    if (!window.electronAPI) return;

    if (unityPath) {
      await window.electronAPI.unity.setPath(unityPath);
    }
    await window.electronAPI.store.set('unityVersion', unityVersion.trim());
    await window.electronAPI.store.set('defaultOutputPath', defaultOutputPath);
    await window.electronAPI.store.set('layoutSettings', {
      leftPanelWidth,
      rightPanelWidth,
      bottomPanelHeight,
    });

    addNotification({ type: 'success', message: '設定を保存しました' });
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
          <span>設定</span>
          <button onClick={onClose} className="btn-icon">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body space-y-6">
          <section>
            <h3 className="text-xs font-medium text-arsist-accent mb-3">Unity設定</h3>
            <div className="space-y-3">
              <div>
                <label className="input-label">Unity パス</label>
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
                    自動検出
                  </button>
                </div>
                {versionDetected && (
                  <p className="text-xs text-arsist-success mt-1">検出: {versionDetected}</p>
                )}
                <p className="text-xs text-arsist-muted mt-1">
                  Linuxは通常 <span className="font-mono">.../Editor/Unity</span>、Windowsは <span className="font-mono">.../Editor/Unity.exe</span> を指定します
                </p>

                {unityCandidates.length > 0 && (
                  <div className="mt-2 p-2 bg-arsist-bg border border-arsist-border rounded">
                    <div className="text-[10px] text-arsist-muted mb-1">検出候補（クリックで設定）</div>
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
              </div>

              <div>
                <label className="input-label">必要なUnityバージョン</label>
                <input
                  type="text"
                  value={unityVersion}
                  onChange={(e) => setUnityVersion(e.target.value)}
                  className="input"
                  placeholder="2022.3.20f1"
                />
                <p className="text-xs text-arsist-muted mt-1">
                  指定したバージョン以上でビルドが実行されます
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-medium text-arsist-accent mb-3">SDK（XREAL）</h3>
            <div className="space-y-2 text-xs">
              <div className="text-arsist-muted">
                XREAL SDK（UPMパッケージ）はリポジトリ直下の
                <span className="font-mono"> sdk/com.xreal.xr/package </span>
                に配置してください。
              </div>
              <div className="p-2 bg-arsist-bg border border-arsist-border rounded">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-arsist-muted">検出状態</div>
                  <div className={xrealSdkStatus?.exists ? 'text-arsist-success' : 'text-arsist-error'}>
                    {xrealSdkStatus?.exists ? 'OK' : '未検出'}
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
                ※ XREAL向けビルド時は、SDKをUnityプロジェクトの <span className="font-mono">Packages/com.xreal.xr</span> に埋め込み、
                <span className="font-mono">Packages/manifest.json</span> を自動更新します。
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-medium text-arsist-primary mb-3">ビルド設定</h3>
            <div>
              <label className="input-label">既定の出力先</label>
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
            <h3 className="text-xs font-medium text-arsist-warning mb-3">レイアウト設定</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="input-label">左パネル幅</label>
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
                <label className="input-label">右パネル幅</label>
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
                <label className="input-label">下パネル高さ</label>
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
                レイアウトをリセット
              </button>
            </div>
          </section>
        </div>

        <div className="modal-footer flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">キャンセル</button>
          <button onClick={handleSave} className="btn btn-success">保存</button>
        </div>
      </div>
    </div>
  );
}
