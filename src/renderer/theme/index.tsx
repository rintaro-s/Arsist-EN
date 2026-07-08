/**
 * Arsist Engine — theme runtime (dark / light)
 *
 * Sets `data-theme` on <html>; the CSS-variable palettes in globals.css do the
 * rest. Persisted via electron-store ('theme'), default dark.
 */
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';

export type Theme = 'dark' | 'light';
const DEFAULT_THEME: Theme = 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const api: any = (window as any).electronAPI;
        const stored = await api?.store?.get?.('theme');
        const next: Theme = stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
        if (mounted) setThemeState(next);
        applyTheme(next);
      } catch {
        applyTheme(DEFAULT_THEME);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      const api: any = (window as any).electronAPI;
      api?.store?.set?.('theme', next);
    } catch { /* ignore */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        const api: any = (window as any).electronAPI;
        api?.store?.set?.('theme', next);
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return { theme: DEFAULT_THEME, setTheme: () => {}, toggleTheme: () => {} };
  }
  return ctx;
}
