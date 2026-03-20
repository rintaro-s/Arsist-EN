import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, CheckCircle, AlertCircle } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';

interface ErrorDialogProps {
  title?: string;
  summary: string;
  details?: string;
  onClose: () => void;
}

export function ErrorDialog({ title = 'Error', summary, details, onClose }: ErrorDialogProps) {
  const { addNotification } = useUIStore();
  const [copied, setCopied] = useState(false);

  const textToCopy = [
    `# ${title}`,
    '',
    summary,
    details ? `\n---\n${details}` : '',
  ].join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      addNotification({ type: 'success', message: 'Error details copied to clipboard' });
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      addNotification({ type: 'error', message: `Failed to copy: ${String(e)}` });
    }
  };

  const dialog = (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div className="modal max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-arsist-error" />
            <span>{title}</span>
          </div>
          <button onClick={onClose} className="btn-icon">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <div className="rounded-lg border border-arsist-primary/20 bg-arsist-bg/50 p-3">
            <div className="text-sm whitespace-pre-wrap break-words">{summary}</div>
          </div>

          {details && (
            <div>
              <div className="text-xs text-arsist-muted mb-2">Details (copy target)</div>
              <textarea
                readOnly
                className="input w-full h-48 font-mono text-xs"
                value={details}
              />
            </div>
          )}
        </div>

        <div className="modal-footer flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={handleCopy}>
            {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
            <span className="ml-2">Copy</span>
          </button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
