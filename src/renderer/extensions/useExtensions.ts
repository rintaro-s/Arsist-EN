/**
 * 拡張機能の一覧をエディタで使うためのフック。
 *
 * 一覧そのものは main が Extensions/ (と ユーザーデータ/extensions) から読む。
 * ここでは「今のプロジェクトのターゲット端末で、その拡張機能が入るか」をタグで判定する。
 * sdk:* は sdk/ に何を置いたかで決まるのでエディタ上では判断せず、「ビルド時に確認」として見せる。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ExtensionManifest, LocalizedText } from '../../shared/extensions';
import { matchTagQuery, type TagQueryResult } from '../../shared/tags';
import { projectFeatureTags } from '../../shared/engineFeatures';
import type { ArsistProject } from '../../shared/types';
import type { Lang } from '../i18n';

export interface ExtensionListItem {
  manifest: ExtensionManifest;
  source: 'repo' | 'bundled' | 'user';
  dir: string;
  overrides?: string;
}

export interface ExtensionListResult {
  success: boolean;
  error?: string;
  extensions: ExtensionListItem[];
  problems: string[];
  deviceTags: string[];
  userDir?: string | null;
}

/** main の extensions:import / extensions:install の返事 (src/main/extensions/packages.ts の InstallResult + source) */
export interface InstallReply {
  ok: boolean;
  canceled?: boolean;
  source?: string;
  id?: string;
  version?: string;
  replaced?: string;
  error?: string;
  problems?: string[];
  needsConfirm?: { id: string; installed: string; incoming: string; downgrade: boolean };
}

export function useExtensions(targetDevice: string | undefined): { data: ExtensionListResult | null; reload: () => void } {
  const [data, setData] = useState<ExtensionListResult | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI?.extensions;
    if (!api) {
      setData({ success: false, error: 'unavailable', extensions: [], problems: [], deviceTags: [] });
      return;
    }
    api.list(targetDevice)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => { if (!cancelled) setData({ success: false, error: String(e), extensions: [], problems: [], deviceTags: [] }); });
    return () => { cancelled = true; };
  }, [targetDevice, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, reload };
}

/** ターゲット端末 (とプロジェクトが使っている機能) でその拡張機能が入るか。 */
export function extensionFit(manifest: ExtensionManifest, deviceTags: string[], project: ArsistProject | null): TagQueryResult {
  const tags = [...deviceTags, ...(project ? projectFeatureTags(project) : [])];
  return matchTagQuery(manifest.requires, tags, { deferred: ['sdk'] });
}

export function localized(text: LocalizedText | undefined, lang: Lang): string {
  if (!text) return '';
  return text[lang] || text.en || '';
}
