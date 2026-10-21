/**
 * 端末の選択肢 = エンジン同梱の端末 (画面ごとの固定の表) + 入っている拡張機能が足した端末。
 *
 * 拡張機能の端末 (Extensions/<id>/Adapters/<名前>/) は main の adapters:list に出てくるので、
 * 固定の表に無いものを後ろに足す。拡張機能を入れたり消したりしたら、画面を開き直せば反映される。
 */
import { useEffect, useState } from 'react';

export interface DeviceOption {
  id: string;
  name: string;
  available: boolean;
  /** 拡張機能が足した端末なら、その拡張機能の id */
  extensionId?: string;
}

interface ListedAdapter {
  folder?: string;
  source?: 'builtin' | 'extension';
  extensionId?: string;
  name?: string;
  device?: { displayName?: string };
}

export function useDeviceOptions(base: DeviceOption[]): DeviceOption[] {
  const [extra, setExtra] = useState<DeviceOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI?.adapters;
    if (!api) return;
    api.list()
      .then((list: ListedAdapter[]) => {
        if (cancelled || !Array.isArray(list)) return;
        const known = new Set(base.map((d) => d.id));
        setExtra(list
          .filter((a) => a.source === 'extension' && a.folder && !known.has(a.folder))
          .map((a) => ({
            id: a.folder!,
            name: a.device?.displayName || a.name || a.folder!,
            available: true,
            extensionId: a.extensionId,
          })));
      })
      .catch(() => { /* 一覧が取れなくても、固定の表はそのまま使える */ });
    return () => { cancelled = true; };
    // base は画面ごとの定数
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 使える端末 → 拡張機能の端末 → 準備中、の順
  return [...base.filter((d) => d.available), ...extra, ...base.filter((d) => !d.available)];
}
