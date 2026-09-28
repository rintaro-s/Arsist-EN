/**
 * 実機から画を取り込む。
 *
 * 写真で組んだものが実機のカメラでも同じに見えるとは限らない (露出、色、解像度)。
 * 実機で動いているアプリから「いま処理した画」を取り込み、同じ画で調整する。
 * 接続先はライブ配置モードと同じ (ArsistWebSocketServer、arSettings.enableRemoteControl)。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Plug, RefreshCw, X } from 'lucide-react';
import { useT } from '../../i18n';
import { useLiveStore } from '../../live/liveStore';
import { decodeDeviceJpeg } from '../../vision/testMedia';
import { useVisionStore } from '../../vision/visionStore';

export function DevicePanel({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const t = useT();
  const { host, port, password, setHost, setPort, setPassword, connect, disconnect, client, connection, connectionDetail } = useLiveStore();
  const { appendFrame, deviceLive, setDeviceLive } = useVisionStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAge, setLastAge] = useState<number | null>(null);

  const grab = async () => {
    if (!client?.isConnected || !taskId) return;
    setBusy(true);
    setError(null);
    try {
      const snapshot = await client.request<{ width: number; height: number; ageSeconds: number; jpegBase64: string }>(
        'query', 'getPerceptionSnapshot', { taskId },
      );
      const frame = await decodeDeviceJpeg(snapshot.jpegBase64, `${host} ${new Date().toLocaleTimeString()}`);
      appendFrame(frame, host, true);
      setLastAge(snapshot.ageSeconds);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setDeviceLive(false);
    } finally {
      setBusy(false);
    }
  };

  // 1 秒ごとに取り込み続ける (実機を動かしながら調整するとき)
  useEffect(() => {
    if (!deviceLive || !client?.isConnected) return;
    const timer = window.setInterval(() => { void grab(); }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceLive, client, taskId]);

  const connected = connection === 'connected' && client?.isConnected;

  const dialog = (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 900 }}>
      <div className="modal max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header flex items-center gap-2">
          <Plug size={15} className="text-arsist-accent" />
          <span>{t('vision.device.title')}</span>
          <button className="btn-icon ml-auto" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body space-y-4">
          <p className="text-[11px] text-arsist-muted leading-relaxed">{t('vision.device.hint')}</p>

          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <input className="input text-xs py-1" placeholder="192.168.0.10" value={host} onChange={(e) => setHost(e.target.value)} disabled={Boolean(connected)} />
            <input className="input text-xs py-1" type="number" value={port} onChange={(e) => setPort(parseInt(e.target.value, 10) || 8765)} disabled={Boolean(connected)} />
            <input className="input text-xs py-1 col-span-2" type="password" placeholder={t('vision.device.password')} value={password} onChange={(e) => setPassword(e.target.value)} disabled={Boolean(connected)} />
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            {connected ? (
              <button className="btn btn-secondary text-xs" onClick={disconnect}>{t('vision.device.disconnect')}</button>
            ) : (
              <button className="btn btn-primary text-xs" disabled={connection === 'connecting'} onClick={() => { void connect(); }}>
                {connection === 'connecting' ? t('vision.device.connecting') : t('vision.device.connect')}
              </button>
            )}
            <span className={connection === 'error' ? 'text-arsist-error' : 'text-arsist-muted'}>
              {t(`vision.device.state.${connection}`)}{connectionDetail ? ` · ${connectionDetail}` : ''}
            </span>
          </div>

          {connected && (
            <div className="space-y-2">
              {!taskId && <p className="text-[11px] text-amber-400">{t('vision.device.noTask')}</p>}
              <div className="flex items-center gap-2">
                <button className="btn btn-primary text-xs" disabled={busy || !taskId} onClick={() => { void grab(); }}>
                  <Download size={13} /><span className="ml-1">{t('vision.device.grab')}</span>
                </button>
                <label className="flex items-center gap-1.5 text-[11px]">
                  <input type="checkbox" checked={deviceLive} disabled={!taskId} onChange={(e) => setDeviceLive(e.target.checked)} />
                  <RefreshCw size={12} className={deviceLive ? 'animate-spin text-arsist-accent' : 'text-arsist-muted'} />
                  {t('vision.device.live')}
                </label>
              </div>
              {lastAge !== null && <p className="text-[11px] text-arsist-muted">{t('vision.device.lastAge', { seconds: lastAge.toFixed(1) })}</p>}
              {error && <p className="text-[11px] text-arsist-error">{error}</p>}
              <p className="text-[10px] text-arsist-muted leading-relaxed">{t('vision.device.taskNote', { id: taskId ?? '' })}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
