import { useEffect, useState } from 'react';
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
  { id: 'welcome',      label: 'Welcome',        icon: <Glasses size={14} /> },
  { id: 'unity',        label: 'Unity',          icon: <Cpu size={14} /> },
  { id: 'sdk-dir',      label: 'SDK Folder',     icon: <HardDrive size={14} /> },
  { id: 'sdk-packages', label: 'SDK Packages',   icon: <Package size={14} /> },
  { id: 'complete',     label: 'Complete',       icon: <Rocket size={14} /> },
];

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

function StepBar({ current }: { current: StepId }) {
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
            <span className="hidden sm:inline">{step.label}</span>
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
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(path).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-arsist-bg border border-arsist-border rounded px-2 py-0.5 text-arsist-text">
      {path}
      <button onClick={copy} className="text-arsist-muted hover:text-arsist-text ml-1 shrink-0" title="コピー">
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
  return (
    <div className="space-y-5">
      <div className="text-center py-4">
        <div className="w-16 h-16 bg-arsist-accent/20 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-arsist-accent/30">
          <Glasses size={32} className="text-arsist-accent" />
        </div>
        <h2 className="text-xl font-bold text-arsist-text mb-1">Setup Wizard</h2>
        <p className="text-xs text-arsist-muted">Configure Arsist Engine for AR development with guided setup.</p>
      </div>

      <InfoBox type="info">
        This wizard will help you configure:<br />
        <ul className="mt-1.5 space-y-1 list-disc list-inside">
          <li><strong>Unity Editor Path</strong> — Location of Unity executable for builds</li>
          <li><strong>SDK Folder</strong> — Root directory for device SDKs (XREAL, Quest, etc.)</li>
          <li><strong>SDK Packages</strong> — Verify required SDK files are present</li>
        </ul>
      </InfoBox>

      <div className="p-3 bg-arsist-surface border border-arsist-border rounded-lg">
        <h4 className="text-xs font-medium text-arsist-text mb-2">What You'll Need</h4>
        <div className="space-y-2 text-xs text-arsist-muted">
          <div className="flex gap-2">
            <Cpu size={13} className="text-arsist-primary shrink-0 mt-0.5" />
            <span><strong className="text-arsist-text">Unity Hub + Unity Editor</strong><br />
              Version 2022.3 LTS or later recommended. Android Build Support module required.</span>
          </div>
          <div className="flex gap-2">
            <HardDrive size={13} className="text-arsist-accent shrink-0 mt-0.5" />
            <span><strong className="text-arsist-text">SDK Folder</strong><br />
              Root directory containing device SDKs (XREAL, Quest, etc.) for your target platforms.</span>
          </div>
          <div className="flex gap-2">
            <Package size={13} className="text-arsist-warning shrink-0 mt-0.5" />
            <span><strong className="text-arsist-text">(Optional) Device SDK Packages</strong><br />
              Specific SDK files from device manufacturers. Required only for those platforms.</span>
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
        <h3 className="text-sm font-semibold text-arsist-text mb-1">Unity Editor Path</h3>
        <p className="text-xs text-arsist-muted">
          Arsist launches Unity in <strong>headless mode</strong> during builds.
          Specify the path to your Unity Editor executable installed via Unity Hub.
        </p>
      </div>

      <InfoBox type="info">
        <strong>Why is this needed?</strong><br />
        AR app builds use Unity's compiler and Android build pipeline.
        Arsist directly invokes the Unity executable to automate the build process.
      </InfoBox>

      <div className="space-y-2">
        <label className="input-label">Unity Executable Path</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={unityPath}
            onChange={(e) => setUnityPath(e.target.value)}
            className="input flex-1 text-xs"
            placeholder="Auto-detect or browse for folder..."
          />
          <button onClick={handleBrowse} className="btn btn-secondary text-xs">
            <FolderOpen size={14} />
            Browse
          </button>
          <button onClick={handleAutoDetect} className="btn btn-secondary text-xs" disabled={detecting}>
            <Search size={14} />
            {detecting ? 'Searching...' : 'Auto-Detect'}
          </button>
        </div>

        {detected && (
          <div className="flex items-center gap-2">
            <StatusBadge ok label={`Version verified: ${detected}`} />
          </div>
        )}
        {unityPath && !detected && (
          <StatusBadge ok={false} label="Version not verified (path will be used as-is)" />
        )}
      </div>

      {candidates.length > 0 && (
        <div className="p-2 bg-arsist-bg border border-arsist-border rounded-lg">
          <p className="text-[10px] text-arsist-muted mb-1.5">Detected candidates (click to select)</p>
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
        <p className="text-[10px] font-medium text-arsist-muted uppercase tracking-wide">Platform Examples</p>
        {Object.entries(platformExamples).map(([os, ex]) => (
          <div key={os}>
            <p className="text-[10px] text-arsist-muted mb-0.5">{os}</p>
            <CodePath path={ex} />
          </div>
        ))}
      </div>

      <InfoBox type="warn">
        <strong>Android Build Requirements:</strong><br />
        In Unity Hub, install the following modules for your editor version:
        "Android Build Support", "OpenJDK", and "Android SDK &amp; NDK Tools".
        Check via Unity Hub → Editor Settings → Add Modules.
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
        <h3 className="text-sm font-semibold text-arsist-text mb-1">SDK Folder Configuration</h3>
        <p className="text-xs text-arsist-muted">
          The SDK folder is the root directory containing device-specific SDK packages (XREAL, Quest, etc.).
        </p>
      </div>

      <InfoBox type="info">
        <strong>Why is this needed?</strong><br />
        During builds, Arsist automatically copies SDK files from this folder into your Unity project.
        If you received an SDK folder, specify it directly or reorganize it to match the structure below.
      </InfoBox>

      {/* Expected structure */}
      <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg">
        <p className="text-[10px] font-medium text-arsist-muted uppercase tracking-wide mb-2">Recommended SDK Folder Structure</p>
        <pre className="text-[11px] text-arsist-text font-mono leading-relaxed whitespace-pre-wrap">{`sdk/                          ← Specify this folder
  com.xreal.xr/
    package/
      package.json             ← XREAL SDK (UPM)
      ...
  quest/
    com.meta.xr.sdk.core-*.tgz   ← Quest Core SDK
    com.meta.xr.mrutilitykit-*.tgz  (optional)
  nupkg/
    jint.4.x.x.nupkg           ← Script engine
    acornima.1.x.x.nupkg`}
        </pre>
      </div>

      <InfoBox type="warn">
        <strong>If you received an SDK folder:</strong><br />
        If the received folder already matches the structure above, specify it directly via "Browse".
        If the structure differs, reorganize the files to match the above layout first.
      </InfoBox>

      <div className="space-y-2">
        <label className="input-label">SDK Root Folder</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={sdkDir}
            onChange={(e) => { setSdkDir(e.target.value); setSdkDirStatus('unknown'); }}
            className="input flex-1 text-xs"
            placeholder="Leave blank to use bundled sdk/ folder"
          />
          <button onClick={handleBrowse} className="btn btn-secondary text-xs">
            <FolderOpen size={14} />
            Browse
          </button>
          {sdkDir && (
            <button onClick={handleClear} className="btn btn-ghost text-xs">Clear</button>
          )}
        </div>
        {!sdkDir && (
          <p className="text-[11px] text-arsist-muted">
            If left blank, the bundled <code className="font-mono">sdk/</code> folder will be used.
          </p>
        )}
        {sdkDir && sdkDirStatus === 'ok' && <StatusBadge ok label="Folder verified" />}
        {sdkDir && sdkDirStatus === 'missing' && <StatusBadge ok={false} label="Folder not found" />}
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
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-arsist-text mb-1">SDK Packages Verification</h3>
        <p className="text-xs text-arsist-muted">
          Verify that device-specific SDKs are correctly placed in the SDK folder.
          Missing SDKs only affect builds for those specific devices.
        </p>
      </div>

      <div className="flex justify-end">
        <button onClick={onRefresh} className="btn btn-secondary text-xs" disabled={loading}>
          <Search size={13} />
          {loading ? 'Checking...' : 'Re-Check'}
        </button>
      </div>

      {/* XREAL SDK */}
      <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-arsist-text">XREAL SDK (XREAL One / Air 2)</p>
            <p className="text-[10px] text-arsist-muted mt-0.5">UPM Package Format</p>
          </div>
          {sdkStatus.xreal !== null && (
            <StatusBadge ok={sdkStatus.xreal.exists} label={sdkStatus.xreal.exists ? 'OK' : 'Not Found'} />
          )}
        </div>

        <div className="text-[10px] space-y-1">
          <p className="text-arsist-muted">Required file structure:</p>
          <CodePath path="sdk/com.xreal.xr/package/package.json" />
          {sdkStatus.xreal?.version && (
            <p className="text-arsist-success">SDK Version: {sdkStatus.xreal.version}</p>
          )}
          {sdkStatus.xreal?.error && (
            <p className="text-arsist-error whitespace-pre-wrap">{sdkStatus.xreal.error}</p>
          )}
        </div>

        <InfoBox type="info">
          <strong>How to get:</strong> Download "NRSDK" from the XREAL Developer Portal.
          Place the <code className="font-mono">com.xreal.xr/</code> folder (containing UPM
          <code className="font-mono"> package.json</code>) under <code className="font-mono">sdk/</code>.
        </InfoBox>
      </div>

      {/* Quest SDK */}
      <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-arsist-text">Meta Quest SDK (Quest 3 / 3S)</p>
            <p className="text-[10px] text-arsist-muted mt-0.5">.tgz Package Format</p>
          </div>
          {sdkStatus.quest !== null && (
            <StatusBadge ok={sdkStatus.quest.exists} label={sdkStatus.quest.exists ? 'OK' : 'Not Found'} />
          )}
        </div>

        <div className="text-[10px] space-y-1">
          <p className="text-arsist-muted">Required file structure:</p>
          <CodePath path="sdk/quest/com.meta.xr.sdk.core-*.tgz" />
          <p className="text-arsist-muted mt-1">Optional (MRUK):</p>
          <CodePath path="sdk/quest/com.meta.xr.mrutilitykit-*.tgz" />
          {sdkStatus.quest?.corePackage && (
            <p className="text-arsist-success">Core: {sdkStatus.quest.corePackage}</p>
          )}
          {sdkStatus.quest?.mrukPackage && (
            <p className="text-arsist-success">MRUK: {sdkStatus.quest.mrukPackage}</p>
          )}
          {sdkStatus.quest?.error && (
            <p className="text-arsist-error whitespace-pre-wrap">{sdkStatus.quest.error}</p>
          )}
        </div>

        <InfoBox type="info">
          <strong>How to get:</strong> Download "Meta XR SDK" .tgz files from Meta's
          {' '}<a
            href="https://developer.oculus.com/downloads/"
            target="_blank"
            rel="noreferrer"
            className="text-arsist-accent underline inline-flex items-center gap-0.5"
          >
            Developer Download Center <ExternalLink size={10} />
          </a>{' '}
          and place them in <code className="font-mono">sdk/quest/</code>.
        </InfoBox>
      </div>

      {/* Bundled deps */}
      {sdkStatus.bundled.length > 0 && (
        <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg space-y-2">
          <p className="text-xs font-medium text-arsist-text">Bundled Dependencies (sdk/nupkg/)</p>
          <p className="text-[10px] text-arsist-muted">
            .nupkg files required for script functionality (Jint).
            If missing, they will be auto-downloaded from NuGet during builds.
          </p>
          <div className="space-y-1">
            {sdkStatus.bundled.map((dep) => (
              <div key={dep.name} className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-arsist-text font-medium">{dep.name}</span>
                  <span className="text-[10px] text-arsist-muted ml-2">{dep.description}</span>
                </div>
                <StatusBadge ok={dep.exists} label={dep.exists ? 'OK' : 'Auto-DL'} />
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
  const unityOk = !!unityPath;
  const xrealOk = sdkStatus.xreal?.exists ?? false;
  const questOk = sdkStatus.quest?.exists ?? false;

  return (
    <div className="space-y-5">
      <div className="text-center py-3">
        <div className="w-14 h-14 bg-arsist-success/20 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-arsist-success/30">
          <Rocket size={28} className="text-arsist-success" />
        </div>
        <h2 className="text-lg font-bold text-arsist-text mb-1">Setup Complete!</h2>
        <p className="text-xs text-arsist-muted">Review your settings and get started building.</p>
      </div>

      <div className="p-3 bg-arsist-bg border border-arsist-border rounded-lg space-y-3">
        <p className="text-[10px] font-medium text-arsist-muted uppercase tracking-wide">Configuration Summary</p>

        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-arsist-muted">Unity Editor</p>
              <p className="text-[11px] font-mono text-arsist-text truncate">{unityPath || 'Not Set'}</p>
              {detected && <p className="text-[10px] text-arsist-success">Version: {detected}</p>}
            </div>
            <StatusBadge ok={unityOk} label={unityOk ? 'OK' : 'Not Set'} />
          </div>

          <div className="h-px bg-arsist-border" />

          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-arsist-muted">SDK Folder</p>
              <p className="text-[11px] font-mono text-arsist-text truncate">{sdkDir || 'Using bundled sdk/'}</p>
            </div>
            <StatusBadge ok label="Configured" />
          </div>

          <div className="h-px bg-arsist-border" />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-arsist-muted mb-0.5">XREAL SDK</p>
              <StatusBadge ok={xrealOk} label={xrealOk ? 'Present' : 'Not Found'} />
            </div>
            <div>
              <p className="text-[10px] text-arsist-muted mb-0.5">Quest SDK</p>
              <StatusBadge ok={questOk} label={questOk ? 'Present' : 'Not Found'} />
            </div>
          </div>
        </div>
      </div>

      {!unityOk && (
        <InfoBox type="warn">
          Unity path is not set. You can configure it later via Settings → Unity Settings.
        </InfoBox>
      )}

      {!xrealOk && !questOk && (
        <InfoBox type="info">
          No SDK packages were found. If you plan to build for XREAL or Quest, place the SDKs
          in the SDK folder as described in the previous step. Jint script functionality works without SDKs.
        </InfoBox>
      )}

      <InfoBox type="ok">
        You can change these settings anytime via <strong>Ctrl+,</strong> (Settings dialog).<br />
        Create a new project and try building to get started!
      </InfoBox>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Main Wizard component
// ────────────────────────────────────────────────────────────

export function SetupWizard({ onClose }: SetupWizardProps) {
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
          <span className="text-sm font-semibold text-arsist-text">Setup Wizard</span>
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
            Back
          </button>

          <span className="text-[11px] text-arsist-muted">
            {stepIdx + 1} / {STEPS.length}
          </span>

          {isLast ? (
            <button onClick={handleFinish} className="btn btn-success text-xs">
              <CheckCircle2 size={14} />
              Finish
            </button>
          ) : (
            <button onClick={handleNext} className="btn btn-primary text-xs">
              Next
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
