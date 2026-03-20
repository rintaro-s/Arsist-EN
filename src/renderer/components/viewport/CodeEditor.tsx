import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { 
  FileCode, 
  Palette, 
  Code2,
  RefreshCw,
  ChevronRight,
  Eye,
  Copy,
  Check
} from 'lucide-react';

type FileType = 'html' | 'css' | 'js';

// Default template
const DEFAULT_HTML = `<!-- Arsist UI - HTML -->
<!-- Define the UI structure in this file -->
<div class="hud-container" data-arsist-root="true" data-arsist-type="Panel">
  <header class="hud-header">
    <h1 class="title" data-arsist-type="Text">AR Application</h1>
  </header>
  
  <main class="hud-main">
    <!-- Main content -->
    <div class="info-panel" data-arsist-type="Panel">
      <h2 data-arsist-type="Text">Information Panel</h2>
      <p data-arsist-type="Text">Display dynamic content here</p>
    </div>
  </main>
  
  <footer class="hud-footer">
    <button class="btn-action" data-arsist-type="Button" onclick="onAction()">Action</button>
    <button class="btn-secondary" data-arsist-type="Button" onclick="onSettings()">Settings</button>
  </footer>
</div>
`;

const DEFAULT_CSS = `/* Arsist UI - CSS */
/* Style definitions for AR glasses */

/* Base settings */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* HUD container */
.hud-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  font-family: 'Inter', system-ui, sans-serif;
  color: #ffffff;
  background: transparent;
}

/* Header */
.hud-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 40px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
}

.title {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

/* Main area */
.hud-main {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40px;
}

.info-panel {
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 24px;
  min-width: 300px;
}

.info-panel h2 {
  font-size: 18px;
  margin-bottom: 12px;
  color: #4ec9b0;
}

.info-panel p {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
}

/* Footer */
.hud-footer {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 20px 40px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(10px);
}

/* Buttons */
.btn-action {
  background: #4ec9b0;
  color: #1e1e1e;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-action:hover {
  background: #3db89f;
  transform: translateY(-2px);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.2);
}
`;

const DEFAULT_JS = `// Arsist UI - JavaScript
// Define UI logic

// Initialize
function init() {
  console.log('AR UI initialized');
}

// Action buttons
function onAction() {
  console.log('Action button clicked');
  // Implement custom action
  
  // Example: Send event to Unity/Arsist Engine
  if (window.ArsistBridge) {
    window.ArsistBridge.sendEvent('action', { type: 'click' });
  }
}

// Settings button
function onSettings() {
  console.log('Settings button clicked');
  // Display settings dialog
}

// Data binding helper
function bindData(selector, value) {
  const el = document.querySelector(selector);
  if (el) {
    el.textContent = value;
  }
}

// Receive data from Arsist Engine
window.onArsistData = function(data) {
  console.log('Received data from engine:', data);
  // Update UI based on data
};

// Initialize on startup
document.addEventListener('DOMContentLoaded', init);
`;

const DEFAULT_FULL_HTML = `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Arsist UI</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; }
      body { font-family: Inter, system-ui, sans-serif; background: transparent; color: #fff; }
      .hud { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
      .panel { background: rgba(0,0,0,0.45); padding: 24px; border-radius: 12px; }
      .title { font-size: 22px; font-weight: 600; margin-bottom: 8px; }
      .muted { color: rgba(255,255,255,0.75); font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="hud" data-arsist-root="true" data-arsist-type="Panel">
      <div class="panel" data-arsist-type="Panel">
        <div class="title" data-arsist-type="Text">AR Scene UI</div>
        <div class="muted" data-arsist-type="Text">Place UI in space</div>
      </div>
    </div>
    <script>
      console.log('Arsist UI loaded');
    </script>
  </body>
</html>
`;

export function CodeEditor() {
  const { project, setUICode, syncUIFromCode, syncCodeFromUI } = useProjectStore();
  const { addNotification, addConsoleLog } = useUIStore();
  const [activeFile, setActiveFile] = useState<FileType>('html');
  const [showPreview, setShowPreview] = useState(true);
  const [copied, setCopied] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  if (!project) {
    return (
      <div className="w-full h-full flex items-center justify-center text-arsist-muted text-sm">
        Please open a project
      </div>
    );
  }

  const uiCode = project.uiCode || {
    html: '',
    css: '',
    js: '',
  };

  const resolvedHtml = uiCode.html && uiCode.html.trim().length > 0
    ? uiCode.html
    : DEFAULT_HTML;
  const resolvedCss = uiCode.css && uiCode.css.trim().length > 0
    ? uiCode.css
    : DEFAULT_CSS;
  const resolvedJs = uiCode.js && uiCode.js.trim().length > 0
    ? uiCode.js
    : DEFAULT_JS;

  const activeContent = activeFile === 'html'
    ? resolvedHtml
    : activeFile === 'css'
      ? resolvedCss
      : resolvedJs;

  const fileTabs = [
    { name: 'ui.html', type: 'html' as const },
    { name: 'style.css', type: 'css' as const },
    { name: 'logic.js', type: 'js' as const },
  ];

  const handleContentChange = (content: string) => {
    const result = setUICode(activeFile, content);
    if (!result.success) {
      addNotification({ type: 'error', message: `Failed to sync GUI: ${result.error}` });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(activeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getFileIcon = (type: FileType) => {
    switch (type) {
      case 'html': return <FileCode size={14} className="text-orange-400" />;
      case 'css': return <Palette size={14} className="text-blue-400" />;
      case 'js': return <Code2 size={14} className="text-yellow-400" />;
    }
  };

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;

      if (data?.type === 'arsist-preview:error') {
        const msg = typeof data.message === 'string' ? data.message : 'Unknown error';
        const details = typeof data.details === 'string' ? data.details : '';
        const formatted = details ? `${msg}\n${details}` : msg;
        setPreviewError(formatted);
        addConsoleLog({
          type: 'error',
          message: `[Preview] ${formatted}`,
        });
      }

      if (data?.type === 'arsist-preview:ready') {
        setPreviewError(null);
      }

      if (data?.type === 'arsist-bridge:event') {
        const name = typeof data.name === 'string' ? data.name : 'unknown';
        const payload = data.payload;
        addConsoleLog({
          type: 'info',
          message: `[ArsistBridge.sendEvent] ${name} ${payload ? JSON.stringify(payload) : ''}`,
        });
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [addConsoleLog]);

  const previewHtml = useMemo(() => {
    const html = resolvedHtml || '';
    const css = resolvedCss || '';
    const js = resolvedJs || '';

    const hasHtmlDoc = /<html[\s>]/i.test(html) || /<!doctype/i.test(html);
    if (hasHtmlDoc) {
      return html;
    }

    // NOTE:
    // - Editor treats 'HTML fragment' as input.
    // - Wrap with <html> etc. for preview/Unity WebView execution.
    // - Execute JS with new Function and catch/display syntax errors.

    const cssSafe = css;
    const htmlSafe = html;

    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { height: 100%; }
      body { margin: 0; background: #1e1e1e; overflow: hidden; }
      ${cssSafe}
    </style>
  </head>
  <body>
    <div id="__arsist_mount__">${htmlSafe}</div>

    <script>
      (function () {
        function post(type, payload) {
          try { parent.postMessage(Object.assign({ type: type }, payload || {}), '*'); } catch (_) {}
        }

        function showErrorOverlay(text) {
          try {
            var el = document.getElementById('__arsist_preview_error__');
            if (!el) {
              el = document.createElement('pre');
              el.id = '__arsist_preview_error__';
              el.style.position = 'absolute';
              el.style.left = '12px';
              el.style.top = '12px';
              el.style.right = '12px';
              el.style.maxHeight = '45%';
              el.style.overflow = 'auto';
              el.style.padding = '12px';
              el.style.background = 'rgba(0,0,0,0.85)';
              el.style.border = '1px solid rgba(255,255,255,0.15)';
              el.style.borderRadius = '8px';
              el.style.color = '#ff6b6b';
              el.style.fontSize = '12px';
              el.style.whiteSpace = 'pre-wrap';
              el.style.zIndex = '9999';
              document.body.appendChild(el);
            }
            el.textContent = 'Preview not available\\n\\n' + text;
          } catch (_) {}
        }

        // ArsistBridge for preview (expected to be injected by native side on Unity device)
        if (!window.ArsistBridge) {
          var memory = {};
          window.ArsistBridge = {
            sendEvent: function (name, data) {
              post('arsist-bridge:event', { name: name, payload: data });
            },
            getData: function (key) {
              return memory[key];
            },
            setData: function (key, value) {
              memory[key] = value;
            },
            __simulateIncoming: function (data) {
              if (typeof window.onArsistData === 'function') {
                window.onArsistData(data);
              }
            }
          };
        }

        window.addEventListener('error', function (e) {
          var msg = (e && e.message) ? String(e.message) : 'Unknown error';
          var details = '';
          if (e && e.filename) details += e.filename;
          if (e && typeof e.lineno === 'number') details += ':' + e.lineno;
          if (e && typeof e.colno === 'number') details += ':' + e.colno;
          post('arsist-preview:error', { message: msg, details: details });
          showErrorOverlay(msg + (details ? ('\\n' + details) : ''));
        }, true);

        window.addEventListener('unhandledrejection', function (e) {
          var reason = e && e.reason ? e.reason : 'Unknown rejection';
          var msg = (reason && reason.message) ? reason.message : String(reason);
          post('arsist-preview:error', { message: 'UnhandledPromiseRejection', details: msg });
          showErrorOverlay('UnhandledPromiseRejection\\n' + msg);
        });

        // Execute user JS (catch syntax errors)
        try {
          var userJs = "\\n" + ${JSON.stringify(js)} + "\\n";
          (new Function(userJs))();
        } catch (err) {
          var msg = err && err.message ? err.message : String(err);
          post('arsist-preview:error', { message: 'JavaScript error', details: msg });
          showErrorOverlay('JavaScript error\\n' + msg);
        }

        post('arsist-preview:ready', {});
      })();
    </script>
  </body>
</html>`;
  }, [resolvedCss, resolvedHtml, resolvedJs]);

  return (
    <div className="w-full h-full flex flex-col bg-arsist-bg">
      {/* Header */}
      <div className="h-10 bg-arsist-surface border-b border-arsist-border flex items-center justify-between px-3">
        <div className="flex items-center gap-1">
          {/* File tabs */}
          {fileTabs.map(file => (
            <button
              key={file.type}
              onClick={() => setActiveFile(file.type)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${
                activeFile === file.type
                  ? 'bg-arsist-active text-arsist-text'
                  : 'text-arsist-muted hover:bg-arsist-hover hover:text-arsist-text'
              }`}
            >
              {getFileIcon(file.type)}
              <span>{file.name}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const result = syncUIFromCode();
              if (!result.success) {
                addNotification({ type: 'error', message: `Failed to sync GUI: ${result.error}` });
              } else {
                addNotification({ type: 'success', message: 'Reflected to GUI' });
              }
            }}
            className="btn-icon"
            title="Apply code to GUI"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => {
              syncCodeFromUI();
              addNotification({ type: 'success', message: 'Updated HTML from GUI' });
            }}
            className="btn-icon"
            title="Apply GUI to code"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={handleCopy}
            className="btn-icon"
            title="Copy"
          >
            {copied ? <Check size={16} className="text-arsist-success" /> : <Copy size={16} />}
          </button>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`btn-icon ${showPreview ? 'text-arsist-accent' : ''}`}
            title="Show preview"
          >
            <Eye size={16} />
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Code editor */}
        <div className={`${showPreview ? 'w-1/2' : 'w-full'} flex flex-col border-r border-arsist-border`}>
          {/* Editor toolbar */}
          <div className="h-8 bg-arsist-hover border-b border-arsist-border flex items-center justify-between px-3 text-xs text-arsist-muted">
            <span>
              {activeFile === 'html' && 'HTML - Define UI structure'}
              {activeFile === 'css' && 'CSS - Define styles'}
              {activeFile === 'js' && 'JavaScript - Define logic'}
            </span>
          </div>

          {/* Text area */}
          <div className="flex-1 overflow-hidden">
            <textarea
              value={activeContent}
              onChange={(e) => handleContentChange(e.target.value)}
              className="w-full h-full p-4 bg-arsist-bg text-arsist-text font-mono text-sm resize-none outline-none"
              spellCheck={false}
              style={{ 
                lineHeight: '1.6',
                tabSize: 2,
              }}
            />
          </div>

          {/* Status bar */}
          <div className="h-6 bg-arsist-hover border-t border-arsist-border flex items-center px-3 text-[10px] text-arsist-muted">
            <span>Lines: {activeContent.split('\n').length}</span>
            <span className="mx-2">|</span>
            <span>Characters: {activeContent.length}</span>
          </div>
        </div>

        {/* Preview */}
        {showPreview && (
          <div className="w-1/2 flex flex-col">
            <div className="h-8 bg-arsist-hover border-b border-arsist-border flex items-center px-3 text-xs text-arsist-muted">
              <Eye size={12} className="mr-2" />
              <span>Preview (1920x1080)</span>
            </div>
            <div className="flex-1 overflow-hidden bg-arsist-bg p-4">
              <div 
                className="w-full h-full border border-arsist-border rounded overflow-hidden relative"
                style={{ aspectRatio: '16/9', maxHeight: '100%' }}
              >
                <iframe
                  srcDoc={previewHtml}
                  className="w-full h-full border-0"
                  title="Preview"
                  sandbox="allow-scripts"
                />

                {previewError && (
                  <div className="absolute inset-0 p-4 pointer-events-none">
                    <div className="pointer-events-none bg-black/80 border border-arsist-border rounded p-3 text-xs text-red-300 whitespace-pre-wrap max-h-full overflow-auto">
                      <div className="font-medium mb-2">Preview not available</div>
                      {previewError}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
