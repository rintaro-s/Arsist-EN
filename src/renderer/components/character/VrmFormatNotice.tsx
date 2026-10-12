/**
 * VRM のインスペクタの、モデルの形式についての知らせ。
 *
 * エディタの 3D ビュー (three-vrm) は VRM 1.0 も表示できるが、エンジン標準の実機の読み込み (UniVRM 0.x) は
 * VRM 0.x しか読めない。そのまま出すと「エディタでは見えるのに実機では出ない」になるので、ここで言い、
 * VRM の読み込みを置き換える拡張機能 ("replaces": ["vrm-loader"]) があればその場で有効にできるようにする。
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { SceneObject } from '../../../shared/types';
import { useI18n, useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { localized, useExtensions } from '../../extensions/useExtensions';

const VRM_LOADER = 'vrm-loader';

export function VrmFormatNotice({ object }: { object: SceneObject }) {
  const t = useT();
  const { lang } = useI18n();
  const project = useProjectStore((s) => s.project);
  const projectPath = useProjectStore((s) => s.projectPath);
  const readOnly = useProjectStore((s) => s.readOnly);
  const setExtensionEnabled = useProjectStore((s) => s.setExtensionEnabled);
  const { data } = useExtensions(project?.targetDevice);
  const [spec, setSpec] = useState<string | null>(null);
  const modelPath = object.modelPath;

  useEffect(() => {
    let alive = true;
    setSpec(null);
    if (!projectPath || !modelPath) return;
    void window.electronAPI?.animations?.vrmSpec({ projectPath, modelPath })
      .then((r) => { if (alive) setSpec(r?.success ? r.spec : null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectPath, modelPath]);

  if (spec !== '1.0') return null;

  const loaders = (data?.extensions ?? []).filter((e) => (e.manifest.replaces ?? []).includes(VRM_LOADER));
  const active = loaders.find((e) => project?.extensions?.[e.manifest.id]?.enabled);

  if (active) {
    return (
      <p className="px-3 text-[11px] text-arsist-muted flex items-center gap-1.5">
        <Check size={12} className="text-arsist-success shrink-0" />
        {t('vrmFormat.loadedBy', { name: localized(active.manifest.name, lang) })}
      </p>
    );
  }

  return (
    <div className="p-3 rounded-lg bg-arsist-warning/10 space-y-2">
      <p className="text-xs text-arsist-warning flex items-start gap-1.5">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />{t('vrmFormat.is10')}
      </p>
      {loaders.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {loaders.map((e) => (
            <button key={e.manifest.id} className="btn btn-secondary text-xs py-1" disabled={readOnly}
              onClick={() => setExtensionEnabled(e.manifest, true)}>
              {t('vrmFormat.enable', { name: localized(e.manifest.name, lang) })}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-arsist-muted leading-snug">{t('vrmFormat.noExtension')}</p>
      )}
    </div>
  );
}
