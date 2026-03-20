/**
 * BottomPanel — Console Monitor
 */
import { useUIStore } from '../../stores/uiStore';
import { Trash2 } from 'lucide-react';

export function BottomPanel() {
  const { bottomTab, setBottomTab, consoleLogs, clearConsoleLogs, buildLogs } = useUIStore();

  return (
    <div className="h-full flex flex-col overflow-hidden bg-arsist-surface">
      {/* Tabs */}
      <div className="h-7 flex items-center border-b border-arsist-border px-2 gap-1 shrink-0">
        <TabBtn label="Console" active={bottomTab === 'console'} onClick={() => setBottomTab('console')} />

        {bottomTab === 'console' && (
          <button onClick={clearConsoleLogs} className="ml-auto btn-icon p-0.5" title="Clear">
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto font-mono text-[11px]">
        {bottomTab === 'console' && <ConsoleView logs={consoleLogs} buildLogs={buildLogs} />}
      </div>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
        active ? 'bg-arsist-active text-arsist-accent' : 'text-arsist-muted hover:bg-arsist-hover'
      }`}
    >
      {label}
    </button>
  );
}

function ConsoleView({ logs, buildLogs }: { logs: { type: string; message: string; time: string }[]; buildLogs: string[] }) {
  const allLogs = [
    ...logs.map((l) => ({ ...l, source: 'app' })),
    ...buildLogs.map((msg) => ({ type: 'info', message: msg, time: '', source: 'build' })),
  ];

  return (
    <div className="p-2 space-y-0.5">
      {allLogs.map((log, i) => (
        <div key={i} className={`flex items-start gap-2 py-0.5 ${
          log.type === 'error' ? 'text-arsist-error' :
          log.type === 'warning' ? 'text-arsist-warning' :
          'text-arsist-muted'
        }`}>
          {log.time && <span className="text-arsist-muted shrink-0">{log.time}</span>}
          <span className="break-all">{log.message}</span>
        </div>
      ))}
      {allLogs.length === 0 && (
        <div className="text-arsist-muted text-center py-3">No logs</div>
      )}
    </div>
  );
}
