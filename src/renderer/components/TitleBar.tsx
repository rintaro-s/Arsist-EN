import React from 'react';
import { Minus, Square, X, Sun, Moon } from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useTheme } from '../theme';
import { useT } from '../i18n';

export function TitleBar() {
  const { project, isDirty } = useProjectStore();
  const { theme, toggleTheme } = useTheme();
  const t = useT();

  const handleMinimize = () => {
    window.electronAPI?.window.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.window.maximize();
  };

  const handleClose = () => {
    window.electronAPI?.window.close();
  };

  return (
    <div className="h-10 bg-arsist-surface hairline-b flex items-center justify-between select-none"
         style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      {/* Left: App Logo and Title */}
      <div className="flex items-center gap-3 px-4">
        <div className="w-6 h-6 bg-arsist-accent rounded flex items-center justify-center">
          <span className="text-arsist-bg font-bold text-xs">AR</span>
        </div>
        <span className="text-sm font-medium text-arsist-text">
          Arsist Engine
          {project && (
            <span className="text-arsist-muted">
              {' '} - {project.name}{isDirty && ' *'}
            </span>
          )}
        </span>
      </div>

      {/* Right: Theme toggle + Window Controls */}
      <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? t('common.themeLight') : t('common.themeDark')}
          className="w-10 h-10 flex items-center justify-center hover:bg-arsist-hover transition-colors text-arsist-muted hover:text-arsist-text"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          onClick={handleMinimize}
          className="w-12 h-10 flex items-center justify-center hover:bg-arsist-hover transition-colors text-arsist-muted hover:text-arsist-text"
        >
          <Minus size={16} />
        </button>
        <button
          onClick={handleMaximize}
          className="w-12 h-10 flex items-center justify-center hover:bg-arsist-hover transition-colors text-arsist-muted hover:text-arsist-text"
        >
          <Square size={14} />
        </button>
        <button
          onClick={handleClose}
          className="w-12 h-10 flex items-center justify-center hover:bg-arsist-error transition-colors text-arsist-muted hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
