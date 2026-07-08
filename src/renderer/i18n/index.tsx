/**
 * Arsist Engine — i18n runtime (English / Japanese)
 *
 * Lightweight, dependency-free i18n. Wrap the app in <I18nProvider> and read text
 * with the useT() hook. Language is persisted via electron-store ('language') and
 * defaults to Japanese. Changing it also updates <html lang> and rebuilds the
 * native (main-process) menu through the exposed IPC bridge.
 */
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { STRINGS, type Lang } from './strings';

export type { Lang } from './strings';

const DEFAULT_LANG: Lang = 'ja';

export type TFunc = (key: string, params?: Record<string, string | number>) => string;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  let text = entry ? (entry[lang] ?? entry.en) : key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

/** Notify the main process so the native menu / dialogs follow the UI language. */
function syncMainProcessLanguage(lang: Lang) {
  try {
    const api: any = (window as any).electronAPI;
    api?.app?.setLanguage?.(lang);
  } catch {
    /* ignore — renderer still works without the bridge */
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // Load persisted language once on mount.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const api: any = (window as any).electronAPI;
        const stored = await api?.store?.get?.('language');
        const next: Lang = stored === 'en' || stored === 'ja' ? stored : DEFAULT_LANG;
        if (mounted) setLangState(next);
        document.documentElement.lang = next;
        syncMainProcessLanguage(next);
      } catch {
        document.documentElement.lang = DEFAULT_LANG;
      }
    })();
    return () => { mounted = false; };
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    document.documentElement.lang = next;
    try {
      const api: any = (window as any).electronAPI;
      api?.store?.set?.('language', next);
    } catch { /* ignore */ }
    syncMainProcessLanguage(next);
  }, []);

  const t = useCallback<TFunc>((key, params) => translate(lang, key, params), [lang]);

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback so components used outside the provider (e.g. isolated tests) still work.
    return {
      lang: DEFAULT_LANG,
      setLang: () => {},
      t: (key, params) => translate(DEFAULT_LANG, key, params),
    };
  }
  return ctx;
}

/** Convenience hook returning just the translate function. */
export function useT(): TFunc {
  return useI18n().t;
}
