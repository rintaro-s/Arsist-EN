import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Server, Power, Copy, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';

interface MCPDialogProps {
  onClose: () => void;
}

interface MCPStatus {
  enabled: boolean;
  running: boolean;
  config?: {
    transport: string;
    projectPath: string;
    tools: number;
  };
}

interface MCPClientConfig {
  success: boolean;
  message?: string;
  config?: {
    description: string;
    json: any;
  };
}

export function MCPDialog({ onClose }: MCPDialogProps) {
  const { project } = useProjectStore();
  const [status, setStatus] = useState<MCPStatus>({ enabled: false, running: false });
  const [clientConfig, setClientConfig] = useState<MCPClientConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshStatus = async () => {
    if (!window.electronAPI?.mcp) return;
    try {
      const result = await window.electronAPI.mcp.getStatus();
      setStatus(result);

      if (result.enabled && result.running) {
        const configResult = await window.electronAPI.mcp.getClientConfig();
        setClientConfig(configResult);
      } else {
        setClientConfig(null);
      }
    } catch (error) {
      console.error('Failed to get MCP status:', error);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const handleStart = async () => {
    if (!window.electronAPI?.mcp || !project?.path) {
      setMessage({ type: 'error', text: 'プロジェクトが読み込まれていません' });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const result = await window.electronAPI.mcp.start(project.path);
      if (result.success) {
        setMessage({ type: 'success', text: 'MCPサーバーを起動しました' });
        await refreshStatus();
      } else {
        setMessage({ type: 'error', text: result.message || '起動に失敗しました' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `エラー: ${(error as Error).message}` });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!window.electronAPI?.mcp) return;

    setIsLoading(true);
    setMessage(null);

    try {
      const result = await window.electronAPI.mcp.stop();
      if (result.success) {
        setMessage({ type: 'success', text: 'MCPサーバーを停止しました' });
        await refreshStatus();
      } else {
        setMessage({ type: 'error', text: result.message || '停止に失敗しました' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `エラー: ${(error as Error).message}` });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyConfig = () => {
    if (!clientConfig?.config?.json) return;

    const configText = JSON.stringify(clientConfig.config.json, null, 2);
    navigator.clipboard.writeText(configText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const dialog = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-arsist-surface border border-arsist-border rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-arsist-border">
          <div className="flex items-center gap-2">
            <Server size={18} className="text-arsist-accent" />
            <h2 className="text-base font-semibold text-arsist-text">MCP サーバー設定</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-arsist-hover rounded transition-colors text-arsist-muted">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Status */}
          <div className="bg-arsist-bg border border-arsist-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-arsist-text">サーバー状態</h3>
              <div className={`flex items-center gap-2 text-xs font-medium px-2 py-1 rounded ${
                status.running ? 'bg-green-500/10 text-green-400' : 'bg-arsist-hover text-arsist-muted'
              }`}>
                <div className={`w-2 h-2 rounded-full ${status.running ? 'bg-green-400' : 'bg-arsist-muted'}`} />
                {status.running ? '起動中' : '停止中'}
              </div>
            </div>

            {status.config && (
              <div className="space-y-2 text-xs text-arsist-muted">
                <div className="flex items-center justify-between">
                  <span>Transport:</span>
                  <span className="text-arsist-text font-mono">{status.config.transport}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Tools:</span>
                  <span className="text-arsist-text font-mono">{status.config.tools}</span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex-shrink-0">Project:</span>
                  <span className="text-arsist-text font-mono text-right break-all">{status.config.projectPath}</span>
                </div>
              </div>
            )}

            {/* Control Buttons */}
            <div className="mt-4 flex gap-2">
              {!status.running ? (
                <button
                  onClick={handleStart}
                  disabled={isLoading || !project}
                  className="btn btn-success text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <Power size={14} />
                  起動
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  disabled={isLoading}
                  className="btn btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <Power size={14} />
                  停止
                </button>
              )}
            </div>

            {/* Message */}
            {message && (
              <div className={`mt-3 p-2 rounded-lg text-xs flex items-start gap-2 ${
                message.type === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
              }`}>
                {message.type === 'success' ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />}
                <span>{message.text}</span>
              </div>
            )}
          </div>

          {/* Client Configuration */}
          {status.running && clientConfig?.config && (
            <div className="bg-arsist-bg border border-arsist-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-arsist-text">クライアント設定</h3>
                <button
                  onClick={handleCopyConfig}
                  className="text-xs px-2 py-1 bg-arsist-hover hover:bg-arsist-active rounded transition-colors flex items-center gap-1.5 text-arsist-muted hover:text-arsist-text"
                >
                  {copied ? <CheckCircle2 size={12} className="text-green-400" /> : <Copy size={12} />}
                  {copied ? 'コピー済み' : 'コピー'}
                </button>
              </div>

              <p className="text-xs text-arsist-muted mb-3">{clientConfig.config.description}</p>

              <div className="bg-arsist-surface border border-arsist-border rounded p-3 font-mono text-xs text-arsist-text overflow-x-auto">
                <pre>{JSON.stringify(clientConfig.config.json, null, 2)}</pre>
              </div>
            </div>
          )}

          {/* Tools List */}
          {status.running && (
            <div className="bg-arsist-bg border border-arsist-border rounded-lg p-4">
              <h3 className="text-sm font-medium text-arsist-text mb-3">利用可能なツール (17)</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  'ir_get_project',
                  'ir_import_model_asset',
                  'ir_place_model',
                  'ir_list_scene_objects',
                  'ir_update_object_transform',
                  'ir_remove_scene_object',
                  'ir_add_canvas_object',
                  'ir_add_ui_element',
                  'ir_update_ui_element',
                  'ir_remove_ui_element',
                  'ir_list_ui_layouts',
                  'ir_add_datasource',
                  'ir_update_datasource',
                  'ir_remove_datasource',
                  'ir_add_transform',
                  'ir_update_transform',
                  'ir_remove_transform',
                ].map((tool) => (
                  <div key={tool} className="bg-arsist-surface border border-arsist-border rounded px-2 py-1 font-mono text-arsist-muted">
                    {tool}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
            <p className="font-medium mb-1">ℹ️ MCPサーバーについて</p>
            <p className="text-blue-200/80">
              AIエージェント（Claude Desktop等）がプロジェクトIRを直接編集できるようにするためのModel Context Protocol サーバーです。
              起動後、上記の設定をClaude Desktopの設定ファイルに追加することで、AIと会話しながらモデル配置・UI構築・DataFlow編集が可能になります。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-arsist-border px-4 py-3 flex justify-end">
          <button onClick={onClose} className="btn btn-secondary text-xs px-4 py-1.5">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
