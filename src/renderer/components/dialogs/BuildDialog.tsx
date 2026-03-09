import { useState, useEffect } from 'react';
import { X, FolderOpen, Glasses, Play, AlertCircle, CheckCircle } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { ErrorDialog } from './ErrorDialog';

interface BuildDialogProps {
  onClose: () => void;
}

interface DeviceOption {
  id: string;
  name: string;
  available: boolean;
}

const devices: DeviceOption[] = [
  { id: 'XREAL_One', name: 'XREAL One (Beam Pro)', available: true },
  { id: 'Meta_Quest', name: 'Meta Quest', available: true },
  { id: 'XREAL_Air2', name: 'XREAL Air 2', available: false },
  { id: 'Rokid_Max', name: 'Rokid Max', available: false },
  { id: 'VITURE_One', name: 'VITURE One', available: false },
];

export function BuildDialog({ onClose }: BuildDialogProps) {
  const { project, projectPath, exportScriptBundle, saveProject, isDirty } = useProjectStore();
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
  const [outputPath, setOutputPath] = useState('');
  const [developmentBuild, setDevelopmentBuild] = useState(false);
  const [unityPath, setUnityPath] = useState('');
  const [unityValid, setUnityValid] = useState<boolean | null>(null);
  const [unityManualLicenseFile, setUnityManualLicenseFile] = useState('');
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  const [errorModal, setErrorModal] = useState<{ summary: string; details?: string } | null>(null);

  const buildHelpfulErrorSummary = (text: string, logs: string[]) => {
    const combined = [text, ...logs].join('\n');
    const isLicensing = /Licensing::Module/i.test(combined) || /Access token is unavailable/i.test(combined);
    if (!isLicensing) return null;

    const summary =
      'Build stopped due to Unity licensing. Please sign in to Unity Hub and activate license, then rebuild.';

    const guidance = [
      '--- Suggested Fix (Unity Licensing) ---',
      '1) Launch Unity Hub and sign in',
      '2) In Hub Licenses, activate Unity for this PC',
      '3) Launch Unity Editor GUI once (for initial auth/consent), then rebuild from Arsist',
      '4) If using proxy/corporate network, verify access to Unity auth servers',
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

  const executeBuild = async () => {
    if (!window.electronAPI || !project) return;
    
    if (!unityPath || !outputPath) {
      addNotification({ type: 'error', message: 'Please set Unity path and output directory' });
      return;
    }

    await window.electronAPI.unity.setPath(unityPath);

    clearBuildLogs();
    setIsBuilding(true);

    const showBuildFailure = (errorText: string) => {
      addBuildLog(`[Arsist] ✗ Build failed: ${errorText}`);

      const logs = useUIStore.getState().buildLogs;
      const helpful = buildHelpfulErrorSummary(errorText, logs);
      const details = [
        ...(helpful ? [helpful.guidance, ''] : []),
        `Error: ${errorText}`,
        '',
        '--- Build Logs ---',
        ...logs,
      ].join('\n');

      setErrorModal({
        summary: helpful?.summary || 'Unity build stopped with error. You can copy details to share.',
        details,
      });

      addNotification({
        type: 'error',
        message: `Build failed: ${errorText}`,
      });
    };

    try {
      const unityWorkDir = `${outputPath}/TempUnityProject`;

      const { remoteInput, ...androidBuild } = (project.buildSettings as any) || {};
      const manifestData = {
        projectId: project.id,
        projectName: project.name,
        version: project.version,
        appType: project.appType,
        targetDevice: selectedDevice,
        arSettings: project.arSettings,
        designSystem: project.designSystem,
        build: androidBuild,
        buildSettings: project.buildSettings,
        remoteInput,
        scenes: project.scenes,
        exportedAt: new Date().toISOString(),
      };

      // Start Unity build
      addBuildLog('[Arsist] Starting Unity build...');
      const buildResult = await window.electronAPI.unity.build({
        projectPath: unityWorkDir,
        sourceProjectPath: projectPath,
        outputPath: outputPath,
        targetDevice: selectedDevice,
        buildTarget: 'Android',
        developmentBuild,
        manualLicenseFile: unityManualLicenseFile || undefined,
        manifestData,
        scenesData: project.scenes,
        uiData: project.uiLayouts,
        scriptsData: exportScriptBundle(),
      });

      if (buildResult.success) {
        addBuildLog(`[Arsist] ✓ Build successful: ${buildResult.outputPath}`);
        addNotification({ 
          type: 'success', 
          message: `Build completed: ${buildResult.outputPath}` 
        });
      } else {
        const errorText = typeof buildResult.error === 'string' && buildResult.error
          ? buildResult.error
          : 'Unknown build error';
        showBuildFailure(errorText);
      }

    } catch (error) {
      const errorText = error instanceof Error ? (error.message || String(error)) : String(error);
      showBuildFailure(errorText);
    } finally {
      setIsBuilding(false);
    }
  };

  const handleBuild = async () => {
    if (isBuilding) return;
    if (isDirty) {
      setShowUnsavedConfirm(true);
      return;
    }
    await executeBuild();
  };

  const handleSaveAndBuild = async () => {
    await saveProject();
    if (useProjectStore.getState().isDirty) {
      addNotification({ type: 'error', message: 'Failed to save, cannot start build' });
      return;
    }
    setShowUnsavedConfirm(false);
    await executeBuild();
  };

  const handleBuildWithoutSave = async () => {
    setShowUnsavedConfirm(false);
    await executeBuild();
  };

  const handleCancelBuild = async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.unity.cancelBuild();
    if (result?.success) {
      addBuildLog('[Arsist] Build cancel requested');
      addNotification({ type: 'info', message: 'Build cancellation requested' });
      return;
    }
    addNotification({ type: 'error', message: result?.error || 'Failed to cancel build' });
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal max-w-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header flex items-center justify-between">
          <span>Build Settings</span>
          <button onClick={onClose} className="btn-icon" disabled={isBuilding}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="modal-body">
          {/* Unity Path */}
          <div className="mb-6">
            <label className="input-label flex items-center gap-2">
              Unity Path
              {unityValid === true && <CheckCircle size={14} className="text-green-500" />}
              {unityValid === false && <AlertCircle size={14} className="text-red-500" />}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={unityPath}
                onChange={(e) => setUnityPath(e.target.value)}
                className="input flex-1"
                placeholder="/path/to/Unity"
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
              Unity 2022.3.20f1 LTS 以上を推奨
            </p>
          </div>

          {/* Target Device */}
          <div className="mb-6">
            <label className="input-label">Target Device</label>
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
          </div>

          {/* Output Path */}
          <div className="mb-6">
            <label className="input-label">Output Directory</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                className="input flex-1"
                placeholder="/path/to/output"
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
            <label className="input-label">Options</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={developmentBuild}
                  onChange={(e) => setDevelopmentBuild(e.target.checked)}
                  className="rounded"
                  disabled={isBuilding}
                />
                <span className="text-sm">Development Build</span>
              </label>
            </div>
          </div>

          {/* Build Progress */}
          {isBuilding && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Build Progress</span>
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

          {/* Build Log */}
          {buildLogs.length > 0 && (
            <div>
              <label className="input-label">Build Log</label>
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
              Cancel Build
            </button>
          ) : (
            <button 
              onClick={onClose}
              className="btn btn-ghost"
            >
              Close
            </button>
          )}
          <button
            onClick={handleBuild}
            className="btn btn-primary"
            disabled={isBuilding || !unityPath || !outputPath}
          >
            {isBuilding ? (
              <>
                <div className="spinner" />
                Building...
              </>
            ) : (
              <>
                <Play size={18} />
                Start Build
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
              <span>Unsaved Changes</span>
              <button onClick={() => setShowUnsavedConfirm(false)} className="btn-icon">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p className="text-sm text-arsist-muted">
                Save before building?
              </p>
            </div>
            <div className="modal-footer flex justify-end gap-2">
              <button onClick={() => setShowUnsavedConfirm(false)} className="btn btn-ghost">
                Cancel
              </button>
              <button onClick={handleBuildWithoutSave} className="btn btn-secondary">
                Build Without Saving
              </button>
              <button onClick={handleSaveAndBuild} className="btn btn-primary">
                Save and Build
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BuildDialogのオーバーレイより後に描画して最前面に出す */}
      {errorModal && (
        <ErrorDialog
          title="Build Error"
          summary={errorModal.summary}
          details={errorModal.details}
          onClose={() => setErrorModal(null)}
        />
      )}
    </>
  );
}
