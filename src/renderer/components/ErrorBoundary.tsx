import React from 'react';
import { STRINGS } from '../i18n/strings';

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Top-level error boundary so a render error in one view doesn't blank the whole
 * editor. Uses the raw string table (not the hook) because the language context
 * may itself be unavailable when this catches. Defaults to Japanese.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the console for diagnostics; the UI shows a friendly fallback.
    console.error('[Arsist] Uncaught render error:', error, info.componentStack);
  }

  private tr(key: string): string {
    const lang = (document.documentElement.lang as 'en' | 'ja') || 'ja';
    const entry = STRINGS[key];
    return entry ? (entry[lang] ?? entry.en) : key;
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-arsist-bg text-arsist-text p-8">
        <div className="max-w-lg w-full bg-arsist-surface rounded-xl p-6" style={{ boxShadow: 'var(--arsist-modal-shadow)' }}>
          <h1 className="text-lg font-semibold text-arsist-error mb-2">{this.tr('error.boundaryTitle')}</h1>
          <p className="text-sm text-arsist-muted mb-4">{this.tr('error.boundaryBody')}</p>
          {this.state.error && (
            <pre className="text-xs font-mono bg-arsist-hover rounded-md p-3 mb-4 max-h-40 overflow-auto whitespace-pre-wrap break-words">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              {this.tr('error.reload')}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
