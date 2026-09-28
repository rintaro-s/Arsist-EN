import { useState, useEffect } from 'react';
import { X, FolderOpen, Glasses, Play, AlertCircle, CheckCircle, Eye, Cloud, Square, MousePointer2, Hand, Smartphone, RefreshCw, Download } from 'lucide-react';
import type { BackgroundMode, InteractionSettings, PhoneSettings } from '../../../shared/types';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { ErrorDialog } from './ErrorDialog';
import { useT } from '../../i18n';
import { generateBuildManifest } from '../../../bridge/UnityBridge';

interface BuildDialogProps {
  onClose: () => void;
}

interface DeviceOption {
  id: string;
  name: string;
  available: boolean;
}

/**
 * 背景モードを選べるのはビデオシースルー機だけ。
 * XREAL のような光学シースルー機は黒＝素通しなので、常にパススルー相当で固定される。
 */
function supportsBackgroundChoice(deviceId: string): boolean {
  const normalized = deviceId.toLowerCase();
  // スマホも背景を選べる: パススルー = 背面カメラの映像 (AR)、それ以外 = 映像なし (VR)
  return normalized.includes('quest') || normalized.includes('meta') || normalized.includes('phone');
}

function isPhone(deviceId: string): boolean {
  return deviceId.toLowerCase().includes('phone');
}

/**
 * ハンドトラッキングを選べるのは Quest だけ。
 * XREAL One 系にはハンドトラッキング用カメラが無いため、選んでも効果が無い。
 */
function supportsHandTracking(deviceId: string): boolean {
  const normalized = deviceId.toLowerCase();
  return normalized.includes('quest') || normalized.includes('meta');
}

const DEFAULT_INTERACTION: InteractionSettings = { controllerRay: true, handTracking: false };

const devices: DeviceOption[] = [
  { id: 'XREAL_One', name: 'XREAL One (Beam Pro)', available: true },
  { id: 'Meta_Quest', name: 'Meta Quest', available: true },
  { id: 'Android_Phone', name: 'Android スマホ (ジャイロ)', available: true },
  { id: 'XREAL_Air2', name: 'XREAL Air 2', available: false },
  { id: 'Rokid_Max', name: 'Rokid Max', available: false },
  { id: 'VITURE_One', name: 'VITURE One', available: false },
];

/** つながっている端末 (adb devices)。 */
interface ConnectedDevice {
  serial: string;
  state: string;
  label: string;
}

export function BuildDialog({ onClose }: BuildDialogProps) {
  const t = useT();
  const { project, projectPath, exportScriptBundle, saveProject, isDirty, updateARSettings } = useProjectStore();
  const { 
    isBuilding, 
    buildProgress, 
    buildMessage, 
    buildLogs,
    setIsBuilding,
    setBuildProgress,
    addBuildLog,
    clearBuildLogs,
    addNotification 
  } = useUIStore();
  
  const [selectedDevice, setSelectedDevice] = useState(project?.targetDevice || 'XREAL_One');
  // スマホ向けは Gradle さえあればビルドできる。無いと Unity を何分も回した末に落ちるので、
  // 選んだ時点で見せておく。undefined = 確認中、null = 見つからない。
  const [gradlePath, setGradlePath] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (selectedDevice !== 'Android_Phone') return;
    let cancelled = false;
    setGradlePath(undefined);
    window.electronAPI.unity.detectGradle?.()
      .then((found) => { if (!cancelled) setGradlePath(found ?? null); })
      .catch(() => { if (!cancelled) setGradlePath(null); });
    return () => { cancelled = true; };
  }, [selectedDevice]);
  const [outputPath, setOutputPath] = useState('');
  const [developmentBuild, setDevelopmentBuild] = useState(false);
  // 通常は差分ビルド（作業用Unityプロジェクトの Library/ を再利用）。
  // キャッシュ由来の不整合を疑うときだけ ON にする。
  const [cleanBuild, setCleanBuild] = useState(false);
  const [unityPath, setUnityPath] = useState('');
  const [unityValid, setUnityValid] = useState<boolean | null>(null);
  const [unityManualLicenseFile, setUnityManualLicenseFile] = useState('');
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  const [errorModal, setErrorModal] = useState<{ summary: string; details?: string } | null>(null);

  // 背景モードはプロジェクト設定 (arSettings) 側に持つ。ビルドごとの一時オプションにすると
  // 「前回どっちでビルドしたか」が失われて、出来上がったAPKの見た目が説明できなくなるため。
  const backgroundMode: BackgroundMode = project?.arSettings?.backgroundMode ?? 'passthrough';
  const backgroundColor = project?.arSettings?.backgroundColor ?? '#000000';
  const backgroundOptions: Array<{ id: BackgroundMode; label: string; desc: string }> = [
    { id: 'passthrough', label: t('build.bgPassthrough'), desc: t('build.bgPassthroughDesc') },
    { id: 'skybox', label: t('build.bgSkybox'), desc: t('build.bgSkyboxDesc') },
    { id: 'solidColor', label: t('build.bgSolidColor'), desc: t('build.bgSolidColorDesc') },
  ];

  // 操作方法（コントローラーレイ / ハンドトラッキング）。両方 OFF はビルド時にエラーになるため、
  // ここでも警告を出す（ビルドを押すまで気付けないのは不親切なため）。
  const interaction: InteractionSettings = project?.arSettings?.interaction ?? DEFAULT_INTERACTION;
  const phone: PhoneSettings = project?.arSettings?.phone ?? {};
  const updatePhone = (patch: Partial<PhoneSettings>) =>
    updateARSettings({ phone: { ...phone, ...patch } });
  const toggleInteraction = (patch: Partial<InteractionSettings>) => {
    updateARSettings({ interaction: { ...interaction, ...patch } });
  };
  const gazeDwell = interaction.gazeDwellSeconds ?? 0;
  const noInteractionEnabled = !interaction.controllerRay && !interaction.handTracking && gazeDwell <= 0;

  const buildHelpfulErrorSummary = (text: string, logs: string[]) => {
    const combined = [text, ...logs].join('\n');
    const isLicensing = /Licensing::Module/i.test(combined) || /Access token is unavailable/i.test(combined);
    if (!isLicensing) return null;

    const summary = t('build.licensingSummary');

    const guidance = [
      t('build.licensingGuidanceHeader'),
      t('build.licensingGuidance1'),
      t('build.licensingGuidance2'),
      t('build.licensingGuidance3'),
      t('build.licensingGuidance4'),
    ].join('\n');

    return { summary, guidance };
  };

  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return;
      
      const storedUnityPath = await window.electronAPI.unity.getPath();
      if (storedUnityPath) {
        setUnityPath(storedUnityPath);
        validateUnity();
      }

      const storedOutputPath = await window.electronAPI.store.get('defaultOutputPath');
      if (storedOutputPath) {
        setOutputPath(storedOutputPath);
      }

      const storedManualLicense = await window.electronAPI.store.get('unityManualLicenseFile');
      if (storedManualLicense) {
        setUnityManualLicenseFile(storedManualLicense);
      }
    };
    loadSettings();

    // Listen for build progress
    if (window.electronAPI) {
      const offProgress = window.electronAPI.unity.onBuildProgress((progress: any) => {
        setBuildProgress(progress.progress, progress.message);
      });

      const offLog = window.electronAPI.unity.onBuildLog((log: string) => {
        addBuildLog(log);
      });

      return () => {
        try {
          offProgress?.();
        } catch {
          // ignore
        }
        try {
          offLog?.();
        } catch {
          // ignore
        }
      };
    }
  }, []);

  const validateUnity = async () => {
    if (!window.electronAPI) return;
    
    const result = await window.electronAPI.unity.validate();
    setUnityValid(result.valid);
  };

  const handleSelectUnityPath = async () => {
    if (!window.electronAPI) return;
    
    const path = await window.electronAPI.fs.selectFile([
      { name: 'Unity', extensions: ['exe', 'app', ''] }
    ]);
    
    if (path) {
      setUnityPath(path);
      await window.electronAPI.unity.setPath(path);
      validateUnity();
    }
  };

  const handleSelectOutputPath = async () => {
    if (!window.electronAPI) return;
    
    const path = await window.electronAPI.fs.selectDirectory();
    if (path) {
      setOutputPath(path);
      await window.electronAPI.store.set('defaultOutputPath', path);
    }
  };

  // ---- つながっている端末 (adb) ----
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string>('');
  const [adbMissing, setAdbMissing] = useState(false);
  const [listingDevices, setListingDevices] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [lastApkPath, setLastApkPath] = useState<string | null>(null);

  const refreshDevices = async () => {
    if (!window.electronAPI?.device) return;
    setListingDevices(true);
    try {
      const result = await window.electronAPI.device.list();
      setAdbMissing(Boolean(result.adbMissing));
      const usable = (result.devices ?? []).map((d) => ({ serial: d.serial, state: d.state, label: d.label }));
      setConnectedDevices(usable);
      // 選んでいた端末が消えていたら、使える 1 台目に移す
      setSelectedSerial((current) => {
        if (current && usable.some((d) => d.serial === current && d.state === 'device')) return current;
        return usable.find((d) => d.state === 'device')?.serial ?? '';
      });
    } finally {
      setListingDevices(false);
    }
  };

  // 開いたときに 1 回見る。抜き差しは「更新」で拾う。
  useEffect(() => {
    void refreshDevices();
    if (!window.electronAPI?.device) return;
    return window.electronAPI.device.onInstallLog((line) => addBuildLog(line));
  }, []);

  /** ビルドした APK を、選んだ端末に入れる。 */
  const installToDevice = async (apkPath: string | null) => {
    if (!window.electronAPI?.device) return;
    const apk = apkPath ?? lastApkPath;
    if (!apk) {
      addNotification({ type: 'error', message: t('build.installNoApk') });
      return;
    }
    const device = connectedDevices.find((d) => d.serial === selectedSerial);
    if (!device) {
      addNotification({ type: 'error', message: t('build.installNoDevice') });
      return;
    }

    setInstalling(true);
    addBuildLog(t('build.logInstalling', { device: device.label }));
    try {
      const result = await window.electronAPI.device.install(device.serial, apk);
      if (result.success) {
        addBuildLog(t('build.logInstalled', { device: device.label }));
        addNotification({ type: 'success', message: t('build.installed', { device: device.label }) });
      } else {
        addBuildLog(t('build.logInstallFailed', { error: result.error ?? '' }));
        addNotification({ type: 'error', message: t('build.installFailed', { error: result.error ?? '' }) });
      }
    } finally {
      setInstalling(false);
    }
  };

  const executeBuild = async (installAfter = false) => {
    if (!window.electronAPI || !project) return;
    
    if (!unityPath || !outputPath) {
      addNotification({ type: 'error', message: t('build.setUnityAndOutput') });
      return;
    }

    await window.electronAPI.unity.setPath(unityPath);

    clearBuildLogs();
    setIsBuilding(true);

    const showBuildFailure = (errorText: string) => {
      addBuildLog(t('build.logBuildFailed', { error: errorText }));

      const logs = useUIStore.getState().buildLogs;
      const helpful = buildHelpfulErrorSummary(errorText, logs);
      const details = [
        ...(helpful ? [helpful.guidance, ''] : []),
        t('build.errorLabel', { error: errorText }),
        '',
        t('build.buildLogsHeader'),
        ...logs,
      ].join('\n');

      setErrorModal({
        summary: helpful?.summary || t('build.genericBuildError'),
        details,
      });

      addNotification({
        type: 'error',
        message: t('build.buildFailed', { error: errorText }),
      });
    };

    try {
      const unityWorkDir = `${outputPath}/TempUnityProject`;

      // マニフェストは共通の組み立てを使う (ここで手書きしない)。
      // 手書きにしていたせいで models / perception が抜け、エディタから作った APK には
      // モデルが 1 つも入っていなかった。UnityBridge.generateBuildManifest を参照。
      const manifestData = generateBuildManifest(project, { targetDevice: selectedDevice });

      // Start Unity build
      addBuildLog(t('build.logStarting'));
      const buildResult = await window.electronAPI.unity.build({
        projectPath: unityWorkDir,
        sourceProjectPath: projectPath,
        outputPath: outputPath,
        targetDevice: selectedDevice,
        buildTarget: 'Android',
        developmentBuild,
        cleanBuild,
        manualLicenseFile: unityManualLicenseFile || undefined,
        manifestData,
        scenesData: project.scenes,
        uiData: project.uiLayouts,
        scriptsData: exportScriptBundle(),
      });

      if (buildResult.success) {
        addBuildLog(t('build.logBuildSuccess', { path: buildResult.outputPath }));
        addNotification({
          type: 'success',
          message: t('build.buildCompleted', { path: buildResult.outputPath })
        });
        const apkPath = typeof buildResult.outputPath === 'string' ? buildResult.outputPath : null;
        setLastApkPath(apkPath);
        if (installAfter) {
          // ここからは端末側の作業。選んだ端末は押した時点のもの (ビルド中に抜かれていれば adb が言う)。
          setIsBuilding(false);
          await installToDevice(apkPath);
        }
      } else {
        const errorText = typeof buildResult.error === 'string' && buildResult.error
          ? buildResult.error
          : t('build.unknownError');
        showBuildFailure(errorText);
      }

    } catch (error) {
      const errorText = error instanceof Error ? (error.message || String(error)) : String(error);
      showBuildFailure(errorText);
    } finally {
      setIsBuilding(false);
    }
  };

  /** 保存を挟むことがあるので、「この後インストールするか」を覚えておく。 */
  const [installAfterBuild, setInstallAfterBuild] = useState(false);

  const handleBuild = async (installAfter = false) => {
    if (isBuilding) return;
    setInstallAfterBuild(installAfter);
    if (isDirty) {
      setShowUnsavedConfirm(true);
      return;
    }
    await executeBuild(installAfter);
  };

  const handleSaveAndBuild = async () => {
    await saveProject();
    if (useProjectStore.getState().isDirty) {
      addNotification({ type: 'error', message: t('build.saveFailedCannotBuild') });
      return;
    }
    setShowUnsavedConfirm(false);
    await executeBuild(installAfterBuild);
  };

  const handleBuildWithoutSave = async () => {
    setShowUnsavedConfirm(false);
    await executeBuild(installAfterBuild);
  };

  const handleCancelBuild = async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.unity.cancelBuild();
    if (result?.success) {
      addBuildLog(t('build.logCancelRequested'));
      addNotification({ type: 'info', message: t('build.cancelRequested') });
      return;
    }
    addNotification({ type: 'error', message: result?.error || t('build.cancelFailed') });
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal max-w-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header flex items-center justify-between">
          <span>{t('build.title')}</span>
          <button onClick={onClose} className="btn-icon" disabled={isBuilding}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="modal-body">
          {/* Unity Path */}
          <div className="mb-6">
            <label className="input-label flex items-center gap-2">
              {t('build.unityPath')}
              {unityValid === true && <CheckCircle size={14} className="text-green-500" />}
              {unityValid === false && <AlertCircle size={14} className="text-red-500" />}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={unityPath}
                onChange={(e) => setUnityPath(e.target.value)}
                className="input flex-1"
                placeholder={t('build.unityPathPlaceholder')}
                disabled={isBuilding}
              />
              <button 
                onClick={handleSelectUnityPath} 
                className="btn btn-secondary"
                disabled={isBuilding}
              >
                <FolderOpen size={18} />
              </button>
            </div>
            <p className="text-xs text-arsist-muted mt-1">
              {t('build.unityRecommended')}
            </p>
          </div>

          {/* Target Device */}
          <div className="mb-6">
            <label className="input-label">{t('build.targetDevice')}</label>
            <div className="grid grid-cols-2 gap-2">
              {devices.map(device => (
                <button
                  key={device.id}
                  onClick={() => device.available && setSelectedDevice(device.id)}
                  disabled={!device.available || isBuilding}
                  className={`p-3 rounded-lg border text-left text-sm ${
                    !device.available
                      ? 'border-arsist-primary/20 opacity-50 cursor-not-allowed'
                      : selectedDevice === device.id
                        ? 'border-arsist-accent bg-arsist-accent/10'
                        : 'border-arsist-primary/30 hover:border-arsist-primary'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Glasses size={18} />
                    <span>{device.name}</span>
                  </div>
                </button>
              ))}
            </div>
            {selectedDevice === 'Android_Phone' && (
              <p className={`text-[11px] mt-2 leading-snug ${gradlePath ? 'text-arsist-muted' : 'text-amber-400'}`}>
                {gradlePath === undefined
                  ? t('build.phoneGradleChecking')
                  : gradlePath
                    ? t('build.phoneGradleFound', { path: gradlePath })
                    : t('build.phoneGradleMissing')}
              </p>
            )}
          </div>

          {/* Background (video see-through devices only) */}
          <div className="mb-6">
            <label className="input-label">{t('build.background')}</label>
            {supportsBackgroundChoice(selectedDevice) ? (
              <>
                <div className="space-y-2">
                  {backgroundOptions.map(option => (
                    <button
                      key={option.id}
                      onClick={() => updateARSettings({ backgroundMode: option.id })}
                      disabled={isBuilding}
                      className={`w-full p-3 rounded-lg border text-left text-sm ${
                        backgroundMode === option.id
                          ? 'border-arsist-accent bg-arsist-accent/10'
                          : 'border-arsist-primary/30 hover:border-arsist-primary'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {option.id === 'passthrough' ? <Eye size={16} /> : option.id === 'skybox' ? <Cloud size={16} /> : <Square size={16} />}
                        <span>{option.label}</span>
                      </div>
                      <p className="text-xs text-arsist-muted mt-1">{option.desc}</p>
                    </button>
                  ))}
                </div>
                {backgroundMode === 'solidColor' && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-sm">{t('build.backgroundColorLabel')}</span>
                    <input
                      type="color"
                      value={backgroundColor}
                      onChange={(e) => updateARSettings({ backgroundColor: e.target.value })}
                      disabled={isBuilding}
                      className="h-8 w-14 rounded bg-transparent"
                    />
                    <code className="text-xs text-arsist-muted">{backgroundColor}</code>
                  </div>
                )}
                <p className="text-xs text-arsist-muted mt-2">
                  {isPhone(selectedDevice) ? t('build.backgroundHintPhone') : t('build.backgroundHint')}
                </p>
              </>
            ) : (
              <p className="text-xs text-arsist-muted">{t('build.backgroundOpticalNote')}</p>
            )}
          </div>

          {/* スマホ固有: 見回し方と画角 */}
          {isPhone(selectedDevice) && (
            <div className="mb-6 space-y-3">
              <label className="input-label">{t('build.phone')}</label>

              <div className="flex items-center gap-3">
                <span className="text-sm w-32 shrink-0">{t('build.phoneOrientation')}</span>
                <select
                  className="input text-sm"
                  value={phone.orientation ?? 'landscape'}
                  disabled={isBuilding}
                  onChange={(e) => updatePhone({ orientation: e.target.value as 'landscape' | 'portrait' })}
                >
                  <option value="landscape">{t('build.phoneLandscape')}</option>
                  <option value="portrait">{t('build.phonePortrait')}</option>
                </select>
              </div>

              {backgroundMode === 'passthrough' ? (
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm w-32 shrink-0">{t('build.phoneCameraFov')}</span>
                    <input
                      type="number"
                      className="input text-sm w-24"
                      min={20}
                      max={140}
                      step={1}
                      value={phone.cameraFov ?? 63}
                      disabled={isBuilding}
                      onChange={(e) => updatePhone({ cameraFov: Math.min(140, Math.max(20, Number(e.target.value) || 63)) })}
                    />
                    <span className="text-xs text-arsist-muted">&deg;</span>
                  </div>
                  <p className="text-xs text-arsist-muted mt-1">{t('build.phoneCameraFovHint')}</p>
                </div>
              ) : (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={phone.stereo === true}
                    disabled={isBuilding}
                    onChange={(e) => updatePhone({ stereo: e.target.checked })}
                  />
                  {t('build.phoneStereo')}
                </label>
              )}

              <p className="text-xs text-arsist-muted">{t('build.phoneLimits')}</p>
            </div>
          )}

          {/* Interaction (controller ray / hand tracking) */}
          <div className="mb-6">
            <label className="input-label">{t('build.interaction')}</label>
            <div className="space-y-2">
              <button
                onClick={() => toggleInteraction({ controllerRay: !interaction.controllerRay })}
                disabled={isBuilding}
                className={`w-full p-3 rounded-lg border text-left text-sm ${
                  interaction.controllerRay
                    ? 'border-arsist-accent bg-arsist-accent/10'
                    : 'border-arsist-primary/30 hover:border-arsist-primary'
                }`}
              >
                <div className="flex items-center gap-2">
                  <MousePointer2 size={16} />
                  <span>{t('build.interactionControllerRay')}</span>
                </div>
                <p className="text-xs text-arsist-muted mt-1">{t('build.interactionControllerRayDesc')}</p>
              </button>

              <button
                onClick={() => toggleInteraction({ handTracking: !interaction.handTracking })}
                disabled={isBuilding || !supportsHandTracking(selectedDevice)}
                className={`w-full p-3 rounded-lg border text-left text-sm ${
                  interaction.handTracking
                    ? 'border-arsist-accent bg-arsist-accent/10'
                    : 'border-arsist-primary/30 hover:border-arsist-primary'
                } ${!supportsHandTracking(selectedDevice) ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <Hand size={16} />
                  <span>{t('build.interactionHandTracking')}</span>
                </div>
                <p className="text-xs text-arsist-muted mt-1">
                  {supportsHandTracking(selectedDevice)
                    ? t('build.interactionHandTrackingDesc')
                    : t('build.interactionHandTrackingUnsupported')}
                </p>
              </button>

              <button
                onClick={() => toggleInteraction({ gazeDwellSeconds: gazeDwell > 0 ? 0 : 1.2 })}
                disabled={isBuilding}
                className={`w-full p-3 rounded-lg border text-left text-sm ${
                  gazeDwell > 0
                    ? 'border-arsist-accent bg-arsist-accent/10'
                    : 'border-arsist-primary/30 hover:border-arsist-primary'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Eye size={16} />
                  <span>{t('build.interactionGazeDwell')}</span>
                  {gazeDwell > 0 && <span className="ml-auto text-xs text-arsist-muted">{gazeDwell.toFixed(1)} s</span>}
                </div>
                <p className="text-xs text-arsist-muted mt-1">{t('build.interactionGazeDwellDesc')}</p>
              </button>
            </div>

            {gazeDwell > 0 && (
              <label className="flex items-center gap-2 text-xs mt-2">
                <span className="text-arsist-muted shrink-0">{t('build.interactionGazeDwellTime')}</span>
                <input
                  type="range"
                  className="flex-1"
                  min={0.4}
                  max={3}
                  step={0.1}
                  value={gazeDwell}
                  disabled={isBuilding}
                  onChange={(e) => toggleInteraction({ gazeDwellSeconds: parseFloat(e.target.value) })}
                />
                <span className="font-mono w-10">{gazeDwell.toFixed(1)} s</span>
              </label>
            )}

            {noInteractionEnabled && (
              <p className="text-xs text-arsist-muted mt-2 flex items-center gap-1">
                <Eye size={14} />
                {t('build.interactionNoneEnabledNote')}
              </p>
            )}

            {/* 文字入力で出すキーボード。端末のキーボードが「どこに出るか」はエンジンからは
                分からない (XREAL では手元のスマホ側に出る) ので、選べるようにしてある。 */}
            <label className="flex items-center gap-2 text-xs mt-3">
              <span className="text-arsist-muted shrink-0">{t('build.textInput')}</span>
              <select
                className="input flex-1 py-1"
                value={interaction.textInput ?? 'auto'}
                disabled={isBuilding}
                onChange={(e) => toggleInteraction({ textInput: e.target.value as 'auto' | 'device' | 'inApp' })}
              >
                <option value="auto">{t('build.textInputAuto')}</option>
                <option value="device">{t('build.textInputDevice')}</option>
                <option value="inApp">{t('build.textInputInApp')}</option>
              </select>
            </label>
            <p className="text-xs text-arsist-muted mt-1">
              {t(`build.textInputDesc.${interaction.textInput ?? 'auto'}`)}
            </p>
          </div>

          {/* Output Path */}
          <div className="mb-6">
            <label className="input-label">{t('build.outputDirectory')}</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                className="input flex-1"
                placeholder={t('build.outputPlaceholder')}
                disabled={isBuilding}
              />
              <button 
                onClick={handleSelectOutputPath} 
                className="btn btn-secondary"
                disabled={isBuilding}
              >
                <FolderOpen size={18} />
              </button>
            </div>
          </div>

          {/* Options */}
          <div className="mb-6">
            <label className="input-label">{t('build.options')}</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={developmentBuild}
                  onChange={(e) => setDevelopmentBuild(e.target.checked)}
                  className="rounded"
                  disabled={isBuilding}
                />
                <span className="text-sm">{t('build.developmentBuild')}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cleanBuild}
                  onChange={(e) => setCleanBuild(e.target.checked)}
                  className="rounded"
                  disabled={isBuilding}
                />
                <span className="text-sm">{t('build.cleanBuild')}</span>
              </label>
              <p className="text-xs text-arsist-muted">{t('build.cleanBuildHint')}</p>
            </div>
          </div>

          {/* Build Progress */}
          {isBuilding && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{t('build.buildProgress')}</span>
                <span className="text-sm text-arsist-muted">{buildProgress}%</span>
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-bar-fill" 
                  style={{ width: `${buildProgress}%` }} 
                />
              </div>
              <p className="text-xs text-arsist-muted mt-1">{buildMessage}</p>
            </div>
          )}

          {/* つながっている端末 (adb) */}
          <div className="mb-6">
            <label className="input-label flex items-center gap-2">
              <Smartphone size={14} />
              {t('build.deviceSection')}
              <button
                className="btn-icon ml-auto"
                title={t('build.refreshDevices')}
                disabled={listingDevices}
                onClick={() => { void refreshDevices(); }}
              >
                <RefreshCw size={14} className={listingDevices ? 'animate-spin' : ''} />
              </button>
            </label>

            {adbMissing ? (
              <p className="text-xs text-arsist-muted leading-relaxed">{t('build.adbMissing')}</p>
            ) : connectedDevices.length === 0 ? (
              <p className="text-xs text-arsist-muted leading-relaxed">{t('build.noDevices')}</p>
            ) : (
              <div className="space-y-1.5">
                {connectedDevices.map((device) => {
                  const usable = device.state === 'device';
                  return (
                    <label
                      key={device.serial}
                      className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
                        usable ? 'bg-arsist-bg cursor-pointer hover:bg-arsist-hover' : 'bg-arsist-bg/50 opacity-60'
                      }`}
                    >
                      <input
                        type="radio"
                        name="adb-device"
                        checked={selectedSerial === device.serial}
                        disabled={!usable}
                        onChange={() => setSelectedSerial(device.serial)}
                      />
                      <span className="flex-1 min-w-0 truncate">{device.label}</span>
                      {!usable && (
                        <span className="text-amber-400 shrink-0">
                          {/* 知らない状態 (recovery / sideload など) は、そのまま出す */}
                          {t(device.state === 'unauthorized' || device.state === 'offline'
                            ? `build.deviceState.${device.state}`
                            : 'build.deviceState.unknown', { state: device.state })}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Build Log */}
          {buildLogs.length > 0 && (
            <div>
              <label className="input-label">{t('build.buildLog')}</label>
              <div className="h-40 overflow-y-auto bg-arsist-bg rounded-lg p-2 font-mono text-xs">
                {buildLogs.map((log, i) => (
                  <div 
                    key={i}
                    className={`${
                      log.includes('✓') ? 'text-green-400' :
                      log.includes('✗') ? 'text-red-400' :
                      log.includes('[Arsist]') ? 'text-arsist-accent' :
                      'text-arsist-muted'
                    }`}
                  >
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {isBuilding ? (
            <button 
              onClick={handleCancelBuild}
              className="btn btn-danger"
            >
              {t('build.cancelBuild')}
            </button>
          ) : (
            <button 
              onClick={onClose}
              className="btn btn-ghost"
            >
              {t('common.close')}
            </button>
          )}
          {/* 端末があるときだけ: 入れるところまで一息で */}
          {lastApkPath && !isBuilding && (
            <button
              onClick={() => { void installToDevice(null); }}
              className="btn btn-secondary"
              disabled={installing || !selectedSerial}
              title={t('build.installOnlyHint')}
            >
              {installing ? <div className="spinner" /> : <Download size={18} />}
              {t('build.installOnly')}
            </button>
          )}
          <button
            onClick={() => { void handleBuild(true); }}
            className="btn btn-secondary"
            disabled={isBuilding || installing || !unityPath || !outputPath || !selectedSerial}
            title={selectedSerial ? t('build.buildAndInstallHint') : t('build.installNoDevice')}
          >
            <Download size={18} />
            {t('build.buildAndInstall')}
          </button>
          <button
            onClick={() => { void handleBuild(false); }}
            className="btn btn-primary"
            disabled={isBuilding || installing || !unityPath || !outputPath}
          >
            {isBuilding ? (
              <>
                <div className="spinner" />
                {t('build.building')}
              </>
            ) : (
              <>
                <Play size={18} />
                {t('build.startBuild')}
              </>
            )}
          </button>
        </div>
        </div>
      </div>

      {showUnsavedConfirm && (
        <div className="modal-overlay" style={{ zIndex: 1001 }}>
          <div className="modal max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header flex items-center justify-between">
              <span>{t('build.unsavedChanges')}</span>
              <button onClick={() => setShowUnsavedConfirm(false)} className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-sm text-arsist-muted">
                {t('build.saveBeforeBuilding')}
              </p>
            </div>
            <div className="modal-footer flex justify-end gap-2">
              <button onClick={() => setShowUnsavedConfirm(false)} className="btn btn-ghost">
                {t('common.cancel')}
              </button>
              <button onClick={handleBuildWithoutSave} className="btn btn-secondary">
                {t('build.buildWithoutSaving')}
              </button>
              <button onClick={handleSaveAndBuild} className="btn btn-primary">
                {t('build.saveAndBuild')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Render after BuildDialog overlay to appear at front */}
      {errorModal && (
        <ErrorDialog
          title={t('build.buildError')}
          summary={errorModal.summary}
          details={errorModal.details}
          onClose={() => setErrorModal(null)}
        />
      )}
    </>
  );
}
