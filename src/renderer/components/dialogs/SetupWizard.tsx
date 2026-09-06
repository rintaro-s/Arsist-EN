import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import {
  X,
  ChevronRight,
  ChevronLeft,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  Info,
  Glasses,
  Cpu,
  Package,
  HardDrive,
  Rocket,
  Search,
  ExternalLink,
  Copy,
} from 'lucide-react';

interface SetupWizardProps {
  onClose: () => void;
}

type StepId = 'welcome' | 'unity' | 'sdk-dir' | 'sdk-packages' | 'complete';

interface Step {
  id: StepId;
  label: string;
  icon: React.ReactNode;
}

const STEPS: Step[] = [
  { id: 'welcome',      label: 'setup.stepWelcome',      icon: <Glasses size={14} /> },
  { id: 'unity',        label: 'setup.stepUnity',        icon: <Cpu size={14} /> },
  { id: 'sdk-dir',      label: 'setup.stepSdkFolder',    icon: <HardDrive size={14} /> },
  { id: 'sdk-packages', label: 'setup.stepSdkPackages',  icon: <Package size={14} /> },
  { id: 'complete',     label: 'setup.stepComplete',     icon: <Rocket size={14} /> },
];

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

function StepBar({ current }: { current: StepId }) {
  const t = useT();
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0 px-6 py-4 border-b border-arsist-border bg-arsist-bg">
      {STEPS.map((step, i) => (
        <div key={step.id} className="flex items-center">
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-colors
              ${i === idx
                ? 'bg-arsist-accent/20 text-arsist-accent border border-arsist-accent/40'
                : i < idx
                  ? 'text-arsist-success'
                  : 'text-arsist-muted'}`}
          >
            {i < idx ? <CheckCircle2 size={13} /> : step.icon}
            <span className="hidden sm:inline">{t(step.label)}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-6 h-px mx-1 ${i < idx ? 'bg-arsist-success' : 'bg-arsist-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function InfoBox({ children, type = 'info' }: { children: React.ReactNode; type?: 'info' | 'warn' | 'ok' }) {
  const colors = {
    info: 'border-arsist-primary/30 bg-arsist-primary/5 text-arsist-primary',
    warn: 'border-arsist-warning/30 bg-arsist-warning/5 text-arsist-warning',
    ok:   'border-arsist-success/30 bg-arsist-success/5 text-arsist-success',
  };
  const Icon = type === 'ok' ? CheckCircle2 : type === 'warn' ? AlertCircle : Info;
  return (
    <div className={`flex gap-2 p-3 rounded-lg border text-xs ${colors[type]}`}>
      <Icon size={14} className="shrink-0 mt-0.5" />
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

function CodePath({ path }: { path: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(path).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-arsist-bg border border-arsist-border rounded px-2 py-0.5 text-arsist-text">
      {path}
      <button onClick={copy} className="text-arsist-muted hover:text-arsist-text ml-1 shrink-0" title={t('common.copy')}>
        {copied ? <CheckCircle2 size={11} className="text-arsist-success" /> : <Copy size={11} />}
      </button>
    </span>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${ok ? 'text-arsist-success' : 'text-arsist-error'}`}>
      {ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
      {label}
    </span>
  );
}

// ────────────────────────────────────────────────────────────
// Step content components
// ────────────────────────────────────────────────────────────

function StepWelcome() {
  const t = useT();
  return (
    <div className="space-y-5">
      <div className="text-center py-4">
        <div className="w-16 h-16 bg-arsist-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-arsist-accent/30">
          <Glasses size={32} className="text-arsist-accent" />
        </div>
        <h2 className="text-xl font-bold text-arsist-text mb-1">{t('setup.title')}</h2>
        <p className="text-xs text-arsist-muted">{t('setup.welcomeSubtitle')}</p>
      </div>

      <InfoBox type="info">
        {t('setup.welcomeConfigIntro')}<br />
        <ul className="mt-1.5 space-y-1 list-disc list-inside">
          <li><strong>{t('setup.unityEditorPath')}</strong> — {t('setup.welcomeUnityPathDesc')}</li>
          <li><strong>{t('setup.stepSdkFolder')}</strong> — {t('setup.welcomeSdkFolderDesc')}</li>
          <li><strong>{t('setup.stepSdkPackages')}</strong> — {t('setup.welcomeSdkPackagesDesc')}</li>
        </ul>
      </InfoBox>

      <div className="p-3 bg-arsist-surface border border-arsist-border rounded-lg">
        <h4 className="text-xs font-medium text-arsist-text mb-2">{t('setup.welcomeNeedTitle')}</h4>
        <div className="space-y-2 text-xs text-arsist-muted">
          <div className="flex gap-2">
            <Cpu size={13} className="text-arsist-primary shrink-0 mt-0.5" />
            <span><strong className="text-arsist-text">{t('setup.welcomeUnityHubLabel')}</strong><br />
              {t('setup.welcomeUnityHubDesc')}</span>
          </div>
          <div className="flex gap-2">
            <HardDrive size={13} className="text-arsist-accent shrink-0 mt-0.5" />
            <span><strong className="text-arsist-text">{t('setup.stepSdkFolder')}</strong><br />
              {t('setup.welcomeSdkFolderDesc2')}</span>
          </div>
          <div className="flex gap-2">
            <Package size={13} className="text-arsist-warning shrink-0 mt-0.5" />
            <span><strong className="text-arsist-text">{t('setup.welcomeOptionalSdkLabel')}</strong><br />
              {t('setup.welcomeOptionalSdkDesc')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StepUnityProps {
  unityPath: string;
  setUnityPath: (v: string) => void;
  detected: string | null;
  setDetected: (v: string | null) => void;
  candidates: string[];
  setCandidates: (v: string[]) => void;
  detecting: boolean;
  setDetecting: (v: boolean) => void;
}

function StepUnity({
  unityPath, setUnityPath,
  detected, setDetected,
  candidates, setCandidates,
  detecting, setDetecting,
}: StepUnityProps) {
  const t = useT();
  const api = (window as any).electronAPI as any;

  const guessExe = async (p: string): Promise<string> => {
    if (p.endsWith('/Editor/Unity') || p.endsWith('Unity.exe') || p.includes('Unity.app')) return p;
    const linux = `${p}/Editor/Unity`;
    const win   = `${p}\\Editor\\Unity.exe`;
    const mac   = `${p}/Unity.app/Contents/MacOS/Unity`;
    const exists = async (x: string) => {
      try { const r = await api.fs.exists(x); return !!r?.exists; } catch { return false; }
    };
    if (await exists(linux)) return linux;
    if (await exists(win))   return win;
    if (await exists(mac))   return mac;
    return p;
  };

  const applyPath = async (p: string) => {
    setUnityPath(p);
    await api.unity.setPath(p);
    try {
      const v = await api.unity.validate();
      setDetected(v?.version ?? null);
    } catch { setDetected(null); }
  };

  const handleBrowse = async () => {
    const dir = await api.fs.selectDirectory();
    if (dir) { const resolved = await guessExe(dir); await applyPath(resolved); }
    else {
      const file = await api.fs.selectFile([{ name: 'Unity', extensions: ['exe', 'app', 'Unity', '*'] }]);
      if (file) await applyPath(file);
    }
  };

  const handleAutoDetect = async () => {
    setDetecting(true);
    try {
      const result = await api.unity.detectPaths();
      const list: string[] = (result?.details ?? []).map((d: any) => d.path).concat(result?.candidates ?? []);
      const unique = [...new Set<string>(list)];
      setCandidates(unique);
      if (unique.length > 0) await applyPath(unique[0]);
    } finally { setDetecting(false); }
  };

  const platformExamples: Record<string, string> = {
    Windows: 'C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.20f1\\Editor\\Unity.exe',
    macOS:   '/Applications/Unity/Hub/Editor/2022.3.20f1/Unity.app/Contents/MacOS/Unity',
    Linux:   '/home/<user>/Unity/Hub/Editor/2022.3.20f1/Editor/Unity',
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-arsist-text mb-1">{t('setup.unityEditorPath')}</h3>
        <p className="text-xs text-arsist-muted">
          {t('setup.unityHeadlessDesc')}
        </p>
      </div>

      <InfoBox type="info">
        <strong>{t('setup.whyNeeded')}</strong><br />
        {t('setup.unityWhyDesc')}
      </InfoBox>

      <div className="space-y-2">
        <label className="input-label">{t('setup.unityExecutablePath')}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={unityPath}
            onChange={(e) => setUnityPath(e.target.value)}
            className="input flex-1 text-xs"
            placeholder={t('setup.unityPathPlaceholder')}
          />
          <button onClick={handleBrowse} className="btn btn-secondary text-xs">
            <FolderOpen size={14} />
            {t('setup.browse')}
          </button>
          <button onClick={handleAutoDetect} className="btn btn-secondary text-xs" disabled={detecting}>
            <Search size={14} />
            {detecting ? t('setup.searching') : t('setup.autoDetect')}
          </button>
        </div>

        {detected && (
          <div className="flex items-center gap-2">
            <StatusBadge ok label={t('setup.versionVerified', { version: detected })} />
          </div>
        )}
        {unityPath && !detected && (
          <StatusBadge ok={false} label={t('setup.versionNotVerified')} />
        )}
      </div>

      {candidates.length > 0 && (
        <div className="p-2 bg-arsist-bg border border-arsist-border rounded-lg">
          <p className="text-[10px] text-arsist-muted mb-1.5">{t('setup.detectedCandidates')}</p>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {candidates.map((c) => (
              <button
                key={c}
                onClick={() => applyPath(c)}
                className={`w-full text-left text-[11px] px-2 py-1 rounded hover:bg-arsist-hover transition-colors font-mono truncate
                  ${unityPath === c ? 'text-arsist-accent' : 'text-arsist-text'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg space-y-2">
        <p className="text-[10px] font-medium text-arsist-muted uppercase tracking-wide">{t('setup.platformExamples')}</p>
        {Object.entries(platformExamples).map(([os, ex]) => (
          <div key={os}>
            <p className="text-[10px] text-arsist-muted mb-0.5">{os}</p>
            <CodePath path={ex} />
          </div>
        ))}
      </div>

      <InfoBox type="warn">
        <strong>{t('setup.androidReqTitle')}</strong><br />
        {t('setup.androidReqDesc')}
      </InfoBox>
    </div>
  );
}

interface StepSdkDirProps {
  sdkDir: string;
  setSdkDir: (v: string) => void;
  sdkDirStatus: 'unknown' | 'ok' | 'empty' | 'missing';
  setSdkDirStatus: (v: 'unknown' | 'ok' | 'empty' | 'missing') => void;
}

function StepSdkDir({ sdkDir, setSdkDir, sdkDirStatus, setSdkDirStatus }: StepSdkDirProps) {
  const t = useT();
  const api = (window as any).electronAPI as any;

  const checkDir = async (p: string) => {
    if (!p) { setSdkDirStatus('unknown'); return; }
    try {
      const r = await api.fs.exists(p);
      if (!r?.exists) { setSdkDirStatus('missing'); return; }
      setSdkDirStatus('ok');
    } catch { setSdkDirStatus('unknown'); }
  };

  const handleBrowse = async () => {
    const picked = await api.fs.selectDirectory();
    if (picked) {
      setSdkDir(picked);
      await checkDir(picked);
      if (typeof api.sdk?.setDir === 'function') await api.sdk.setDir(picked);
    }
  };

  const handleClear = () => { setSdkDir(''); setSdkDirStatus('unknown'); };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-arsist-text mb-1">{t('setup.sdkFolderConfigTitle')}</h3>
        <p className="text-xs text-arsist-muted">
          {t('setup.sdkFolderConfigDesc')}
        </p>
      </div>

      <InfoBox type="info">
        <strong>{t('setup.whyNeeded')}</strong><br />
        {t('setup.sdkWhyDesc')}
      </InfoBox>

      {/* Expected structure */}
      <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg">
        <p className="text-[10px] font-medium text-arsist-muted uppercase tracking-wide mb-2">{t('setup.sdkStructureTitle')}</p>
        <pre className="text-[11px] text-arsist-text font-mono leading-relaxed whitespace-pre-wrap">{t('setup.sdkStructure')}
        </pre>
      </div>

      <InfoBox type="warn">
        <strong>{t('setup.sdkReceivedTitle')}</strong><br />
        {t('setup.sdkReceivedDesc')}
      </InfoBox>

      <div className="space-y-2">
        <label className="input-label">{t('setup.sdkRootFolder')}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={sdkDir}
            onChange={(e) => { setSdkDir(e.target.value); setSdkDirStatus('unknown'); }}
            className="input flex-1 text-xs"
            placeholder={t('setup.sdkDirPlaceholder')}
          />
          <button onClick={handleBrowse} className="btn btn-secondary text-xs">
            <FolderOpen size={14} />
            {t('setup.browse')}
          </button>
          {sdkDir && (
            <button onClick={handleClear} className="btn btn-ghost text-xs">{t('setup.clear')}</button>
          )}
        </div>
        {!sdkDir && (
          <p className="text-[11px] text-arsist-muted">
            {t('setup.sdkBlankHint')}
          </p>
        )}
        {sdkDir && sdkDirStatus === 'ok' && <StatusBadge ok label={t('setup.folderVerified')} />}
        {sdkDir && sdkDirStatus === 'missing' && <StatusBadge ok={false} label={t('setup.folderNotFound')} />}
      </div>
    </div>
  );
}

interface SdkStatusResult {
  xreal: { exists: boolean; path?: string; version?: string; error?: string } | null;
  quest: { exists: boolean; path?: string; corePackage?: string; mrukPackage?: string; error?: string } | null;
  bundled: Array<{ name: string; path: string; exists: boolean; description: string }>;
}

interface StepSdkPackagesProps {
  sdkStatus: SdkStatusResult;
  loading: boolean;
  onRefresh: () => void;
}

function StepSdkPackages({ sdkStatus, loading, onRefresh }: StepSdkPackagesProps) {
  const t = useT();
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-arsist-text mb-1">{t('setup.sdkPackagesTitle')}</h3>
        <p className="text-xs text-arsist-muted">
          {t('setup.sdkPackagesDesc')}
        </p>
      </div>

      <div className="flex justify-end">
        <button onClick={onRefresh} className="btn btn-secondary text-xs" disabled={loading}>
          <Search size={13} />
          {loading ? t('setup.checking') : t('setup.recheck')}
        </button>
      </div>

      {/* XREAL SDK */}
      <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-arsist-text">{t('setup.xrealSdkTitle')}</p>
            <p className="text-[10px] text-arsist-muted mt-0.5">{t('setup.upmFormat')}</p>
          </div>
          {sdkStatus.xreal !== null && (
            <StatusBadge ok={sdkStatus.xreal.exists} label={sdkStatus.xreal.exists ? t('setup.ok') : t('setup.notFound')} />
          )}
        </div>

        <div className="text-[10px] space-y-1">
          <p className="text-arsist-muted">{t('setup.requiredFileStructure')}</p>
          <CodePath path="sdk/com.xreal.xr/package/package.json" />
          {sdkStatus.xreal?.version && (
            <p className="text-arsist-success">{t('setup.sdkVersion', { version: sdkStatus.xreal.version })}</p>
          )}
          {sdkStatus.xreal?.error && (
            <p className="text-arsist-error whitespace-pre-wrap">{sdkStatus.xreal.error}</p>
          )}
        </div>

        <InfoBox type="info">
          <strong>{t('setup.howToGet')}</strong> {t('setup.xrealHowToDesc')}
        </InfoBox>
      </div>

      {/* Quest SDK */}
      <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-arsist-text">{t('setup.questSdkTitle')}</p>
            <p className="text-[10px] text-arsist-muted mt-0.5">{t('setup.tgzFormat')}</p>
          </div>
          {sdkStatus.quest !== null && (
            <StatusBadge ok={sdkStatus.quest.exists} label={sdkStatus.quest.exists ? t('setup.ok') : t('setup.notFound')} />
          )}
        </div>

        <div className="text-[10px] space-y-1">
          <p className="text-arsist-muted">{t('setup.requiredFileStructure')}</p>
          <CodePath path="sdk/quest/com.meta.xr.sdk.core-*.tgz" />
          <p className="text-arsist-muted mt-1">{t('setup.optionalMruk')}</p>
          <CodePath path="sdk/quest/com.meta.xr.mrutilitykit-*.tgz" />
          {sdkStatus.quest?.corePackage && (
            <p className="text-arsist-success">{t('setup.questCore', { pkg: sdkStatus.quest.corePackage })}</p>
          )}
          {sdkStatus.quest?.mrukPackage && (
            <p className="text-arsist-success">{t('setup.questMruk', { pkg: sdkStatus.quest.mrukPackage })}</p>
          )}
          {sdkStatus.quest?.error && (
            <p className="text-arsist-error whitespace-pre-wrap">{sdkStatus.quest.error}</p>
          )}
        </div>

        <InfoBox type="info">
          <strong>{t('setup.howToGet')}</strong> {t('setup.questHowToBefore')}
          {' '}<a
            href="https://developer.oculus.com/downloads/"
            target="_blank"
            rel="noreferrer"
            className="text-arsist-accent underline inline-flex items-center gap-0.5"
          >
            {t('setup.questHowToLink')} <ExternalLink size={10} />
          </a>{' '}
          {t('setup.questHowToAfter')}
        </InfoBox>
      </div>

      {/* Bundled deps */}
      {sdkStatus.bundled.length > 0 && (
        <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg space-y-2">
          <p className="text-xs font-medium text-arsist-text">{t('setup.bundledDepsTitle')}</p>
          <p className="text-[10px] text-arsist-muted">
            {t('setup.bundledDepsDesc')}
          </p>
          <div className="space-y-1">
            {sdkStatus.bundled.map((dep) => (
              <div key={dep.name} className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-arsist-text font-medium">{dep.name}</span>
                  <span className="text-[10px] text-arsist-muted ml-2">{dep.description}</span>
                </div>
                <StatusBadge ok={dep.exists} label={dep.exists ? t('setup.ok') : t('setup.autoDl')} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface StepCompleteProps {
  unityPath: string;
  detected: string | null;
  sdkDir: string;
  sdkStatus: SdkStatusResult;
}

function StepComplete({ unityPath, detected, sdkDir, sdkStatus }: StepCompleteProps) {
  const t = useT();
  const unityOk = !!unityPath;
  const xrealOk = sdkStatus.xreal?.exists ?? false;
  const questOk = sdkStatus.quest?.exists ?? false;

  return (
    <div className="space-y-5">
      <div className="text-center py-3">
        <div className="w-14 h-14 bg-arsist-success/20 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-arsist-success/30">
          <Rocket size={28} className="text-arsist-success" />
        </div>
        <h2 className="text-lg font-bold text-arsist-text mb-1">{t('setup.completeTitle')}</h2>
        <p className="text-xs text-arsist-muted">{t('setup.completeSubtitle')}</p>
      </div>

      <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg space-y-3">
        <p className="text-[10px] font-medium text-arsist-muted uppercase tracking-wide">{t('setup.configSummary')}</p>

        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-arsist-muted">{t('setup.unityEditor')}</p>
              <p className="text-[11px] font-mono text-arsist-text truncate">{unityPath || t('setup.notSet')}</p>
              {detected && <p className="text-[10px] text-arsist-success">{t('setup.versionLabel', { version: detected })}</p>}
            </div>
            <StatusBadge ok={unityOk} label={unityOk ? t('setup.ok') : t('setup.notSet')} />
          </div>

          <div className="h-px bg-arsist-border" />

          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-arsist-muted">{t('setup.stepSdkFolder')}</p>
              <p className="text-[11px] font-mono text-arsist-text truncate">{sdkDir || t('setup.usingBundledSdk')}</p>
            </div>
            <StatusBadge ok label={t('setup.configured')} />
          </div>

          <div className="h-px bg-arsist-border" />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-arsist-muted mb-0.5">{t('setup.xrealSdk')}</p>
              <StatusBadge ok={xrealOk} label={xrealOk ? t('setup.present') : t('setup.notFound')} />
            </div>
            <div>
              <p className="text-[10px] text-arsist-muted mb-0.5">{t('setup.questSdk')}</p>
              <StatusBadge ok={questOk} label={questOk ? t('setup.present') : t('setup.notFound')} />
            </div>
          </div>
        </div>
      </div>

      {!unityOk && (
        <InfoBox type="warn">
          {t('setup.unityNotSetWarn')}
        </InfoBox>
      )}

      {!xrealOk && !questOk && (
        <InfoBox type="info">
          {t('setup.noSdkInfo')}
        </InfoBox>
      )}

      <InfoBox type="ok">
        {t('setup.completeSettingsHint')}<strong>Ctrl+,</strong>{t('setup.completeSettingsHintTail')}<br />
        {t('setup.completeGetStarted')}
      </InfoBox>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Main Wizard component
// ────────────────────────────────────────────────────────────

export function SetupWizard({ onClose }: SetupWizardProps) {
  const t = useT();
  const stepIds = STEPS.map((s) => s.id);
  const [stepIdx, setStepIdx] = useState(0);
  const currentStep = stepIds[stepIdx];

  // Unity step state
  const [unityPath, setUnityPath] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);

  // SDK dir step state
  const [sdkDir, setSdkDir] = useState('');
  const [sdkDirStatus, setSdkDirStatus] = useState<'unknown' | 'ok' | 'empty' | 'missing'>('unknown');

  // SDK packages step state
  const [sdkStatus, setSdkStatus] = useState<SdkStatusResult>({ xreal: null, quest: null, bundled: [] });
  const [sdkLoading, setSdkLoading] = useState(false);

  const api = (window as any).electronAPI as any;

  // Load existing settings on mount
  useEffect(() => {
    (async () => {
      if (!api) return;
      try {
        const p = await api.unity.getPath();
        if (p) {
          setUnityPath(p);
          const v = await api.unity.validate();
          if (v?.version) setDetected(v.version);
        }
      } catch { /* ignore */ }
      try {
        if (typeof api.sdk?.getDir === 'function') {
          const d = await api.sdk.getDir();
          if (d) setSdkDir(d);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // Fetch SDK status when on sdk-packages step
  useEffect(() => {
    if (currentStep === 'sdk-packages') fetchSdkStatus();
  }, [currentStep]);

  const fetchSdkStatus = async () => {
    setSdkLoading(true);
    const result: SdkStatusResult = { xreal: null, quest: null, bundled: [] };
    try {
      if (typeof api?.sdk?.xrealStatus === 'function') result.xreal = await api.sdk.xrealStatus();
    } catch { /* ignore */ }
    try {
      if (typeof api?.sdk?.questStatus === 'function') result.quest = await api.sdk.questStatus();
    } catch { /* ignore */ }
    try {
      if (typeof api?.sdk?.bundledDeps === 'function') {
        const r = await api.sdk.bundledDeps();
        if (r?.deps) result.bundled = r.deps;
      }
    } catch { /* ignore */ }
    setSdkStatus(result);
    setSdkLoading(false);
  };

  const handleNext = async () => {
    // Save SDK dir when leaving sdk-dir step
    if (currentStep === 'sdk-dir' && sdkDir.trim()) {
      try {
        if (typeof api?.sdk?.setDir === 'function') await api.sdk.setDir(sdkDir.trim());
      } catch { /* ignore */ }
    }
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
  };

  const handleBack = () => {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  };

  const handleFinish = async () => {
    // Persist all settings
    try {
      if (unityPath) await api.unity.setPath(unityPath);
      if (sdkDir.trim() && typeof api?.sdk?.setDir === 'function') await api.sdk.setDir(sdkDir.trim());
      await api.store.set('setupWizardCompleted', true);
    } catch { /* ignore */ }
    onClose();
  };

  const isLast = stepIdx === STEPS.length - 1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="bg-arsist-surface rounded-xl shadow-2xl border border-arsist-border w-full max-w-2xl mx-4 overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-arsist-border bg-arsist-hover">
          <span className="text-sm font-semibold text-arsist-text">{t('setup.title')}</span>
          <button onClick={onClose} className="btn-icon">
            <X size={16} />
          </button>
        </div>

        {/* Step bar */}
        <StepBar current={currentStep} />

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {currentStep === 'welcome' && <StepWelcome />}

          {currentStep === 'unity' && (
            <StepUnity
              unityPath={unityPath}
              setUnityPath={setUnityPath}
              detected={detected}
              setDetected={setDetected}
              candidates={candidates}
              setCandidates={setCandidates}
              detecting={detecting}
              setDetecting={setDetecting}
            />
          )}

          {currentStep === 'sdk-dir' && (
            <StepSdkDir
              sdkDir={sdkDir}
              setSdkDir={setSdkDir}
              sdkDirStatus={sdkDirStatus}
              setSdkDirStatus={setSdkDirStatus}
            />
          )}

          {currentStep === 'sdk-packages' && (
            <StepSdkPackages
              sdkStatus={sdkStatus}
              loading={sdkLoading}
              onRefresh={fetchSdkStatus}
            />
          )}

          {currentStep === 'complete' && (
            <StepComplete
              unityPath={unityPath}
              detected={detected}
              sdkDir={sdkDir}
              sdkStatus={sdkStatus}
            />
          )}
        </div>

        {/* Footer navigation */}
        <div className="px-6 py-4 border-t border-arsist-border bg-arsist-hover flex items-center justify-between">
          <button
            onClick={handleBack}
            disabled={stepIdx === 0}
            className="btn btn-ghost text-xs"
          >
            <ChevronLeft size={14} />
            {t('setup.back')}
          </button>

          <span className="text-[11px] text-arsist-muted">
            {stepIdx + 1} / {STEPS.length}
          </span>

          {isLast ? (
            <button onClick={handleFinish} className="btn btn-success text-xs">
              <CheckCircle2 size={14} />
              {t('setup.finish')}
            </button>
          ) : (
            <button onClick={handleNext} className="btn btn-primary text-xs">
              {t('setup.next')}
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
