/**
 * Arsist Engine — ライブ配置モード（通常の編集画面とは完全に別のUI）
 *
 * 2つの使い方が1画面に同居する:
 *   1. シミュレーション: 実機不要。プロジェクトの内容がデバイスでどう見えるかをPC上で確認する
 *   2. 実機接続:        動いているアプリに繋ぎ、視点を見ながらオブジェクトの配置を直接動かす
 *
 * どちらも「ユーザー視点から見た画面」と「それを外から見た3Dビュー」を並べて表示する。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Crosshair,
  Link,
  Link2Off,
  Loader2,
  Monitor,
  MousePointer2,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { useLiveStore } from './liveStore';
import { useDevicePolling, useLiveScene } from './useLiveScene';
import { useSimulationControls } from './useSimulationControls';
import { WorldView } from './WorldView';
import { FirstPersonView } from './FirstPersonView';
import { LiveInspector } from './LiveInspector';
import { useDeviceFov } from '../utils/deviceFov';
import { useT } from '../i18n';
import type { BackgroundMode } from '../../shared/types';

function ConnectionBar() {
  const t = useT();
  const {
    host, port, password, setHost, setPort, setPassword,
    connection, connectionDetail, connect, disconnect,
    simulationOnly, setSimulationOnly, client,
  } = useLiveStore();
  const [error, setError] = useState<string | null>(null);
  const project = useProjectStore((s) => s.project);

  // 接続先ポートはプロジェクト設定（arSettings.remoteControlPort）を初期値にする
  useEffect(() => {
    const p = project?.arSettings?.remoteControlPort;
    if (p && p !== port) setPort(p);
    const pw = project?.arSettings?.remoteControlPassword;
    if (pw && !password) setPassword(pw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const isConnected = connection === 'connected';
  const isConnecting = connection === 'connecting';

  const handleConnect = async () => {
    setError(null);
    try {
      await connect();
      setSimulationOnly(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRecenter = () => {
    client?.send('viewer', 'recenter', {});
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        <input
          className="input text-xs py-1 w-36"
          value={host}
          disabled={isConnected}
          placeholder="192.168.0.10"
          onChange={(e) => setHost(e.target.value)}
        />
        <span className="text-arsist-muted text-xs">:</span>
        <input
          className="input text-xs py-1 w-20"
          type="number"
          value={port}
          disabled={isConnected}
          onChange={(e) => setPort(parseInt(e.target.value) || 8765)}
        />
        <input
          className="input text-xs py-1 w-28"
          type="password"
          value={password}
          disabled={isConnected}
          placeholder={t('live.passwordPlaceholder')}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {isConnected ? (
        <button className="btn btn-ghost text-xs" onClick={disconnect}>
          <WifiOff size={14} />
          {t('live.disconnect')}
        </button>
      ) : (
        <button className="btn btn-primary text-xs" onClick={handleConnect} disabled={isConnecting}>
          {isConnecting ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
          {t('live.connect')}
        </button>
      )}

      {/* シミュレーション / 実機 の切り替え */}
      <div className="flex items-center rounded-lg overflow-hidden hairline">
        <button
          className={`text-xs px-3 py-1.5 flex items-center gap-1 ${
            simulationOnly ? 'bg-arsist-accent/20 text-arsist-accent' : 'text-arsist-muted'
          }`}
          onClick={() => setSimulationOnly(true)}
        >
          <Monitor size={13} />
          {t('live.modeSimulation')}
        </button>
        <button
          className={`text-xs px-3 py-1.5 flex items-center gap-1 ${
            !simulationOnly ? 'bg-arsist-accent/20 text-arsist-accent' : 'text-arsist-muted'
          }`}
          disabled={!isConnected}
          title={!isConnected ? t('live.modeDeviceNeedsConnection') : undefined}
          onClick={() => setSimulationOnly(false)}
        >
          {isConnected ? <Link size={13} /> : <Link2Off size={13} />}
          {t('live.modeDevice')}
        </button>
      </div>

      {isConnected && !simulationOnly && (
        <button className="btn btn-ghost text-xs" onClick={handleRecenter} title={t('live.recenterHint')}>
          <Crosshair size={14} />
          {t('live.recenter')}
        </button>
      )}

      {error && <span className="text-xs text-arsist-error">{error}</span>}
      {!error && connection === 'error' && (
        <span className="text-xs text-arsist-error">{connectionDetail || t('live.connectionLost')}</span>
      )}
    </div>
  );
}

export function LiveLayoutMode() {
  const t = useT();
  const setAppMode = useUIStore((s) => s.setAppMode);
  const project = useProjectStore((s) => s.project);

  const simulationOnly = useLiveStore((s) => s.simulationOnly);
  const connection = useLiveStore((s) => s.connection);
  const selectedId = useLiveStore((s) => s.selectedId);
  const select = useLiveStore((s) => s.select);
  const lastSyncAt = useLiveStore((s) => s.lastSyncAt);
  const syncError = useLiveStore((s) => s.syncError);
  const resetSimulatedPose = useLiveStore((s) => s.resetSimulatedPose);
  const disconnect = useLiveStore((s) => s.disconnect);

  useDevicePolling();
  const { objects, viewer } = useLiveScene();
  const fov = useDeviceFov(project?.targetDevice);

  const fpvRef = useRef<HTMLDivElement>(null);
  const isSimulating = simulationOnly || connection !== 'connected';
  useSimulationControls(fpvRef, isSimulating);

  // モードを離れるときは接続を切る（実機に繋ぎっぱなしで放置しない）
  useEffect(() => () => disconnect(), [disconnect]);

  const selected = useMemo(
    () => objects.find((o) => o.runtimeId === selectedId) ?? null,
    [objects, selectedId],
  );

  const backgroundMode: BackgroundMode = project?.arSettings?.backgroundMode ?? 'passthrough';
  const backgroundColor = project?.arSettings?.backgroundColor ?? '#000000';
  const defaultDepth = project?.arSettings?.defaultDepth && project.arSettings.defaultDepth > 0
    ? project.arSettings.defaultDepth
    : 2;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-arsist-bg">
      {/* ヘッダ: 通常モードと視覚的にはっきり分ける */}
      <div className="flex items-center gap-3 px-3 py-2 bg-arsist-surface hairline-b">
        <button className="btn btn-ghost text-xs" onClick={() => setAppMode('editor')}>
          <ArrowLeft size={14} />
          {t('live.backToEditor')}
        </button>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-arsist-accent/20 text-arsist-accent text-xs font-semibold">
            {t('live.title')}
          </span>
          <span className="text-xs text-arsist-muted">{project?.name}</span>
        </div>
        <div className="flex-1" />
        <ConnectionBar />
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 左: オブジェクト一覧 */}
        <div className="w-56 shrink-0 bg-arsist-surface overflow-y-auto">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-arsist-muted flex items-center justify-between">
            <span>{t('live.objects')}</span>
            <span className="font-mono">{objects.length}</span>
          </div>
          {objects.length === 0 && (
            <div className="px-3 py-2 text-xs text-arsist-muted">{t('live.noObjects')}</div>
          )}
          {objects.map((obj) => (
            <button
              key={obj.runtimeId}
              onClick={() => select(obj.runtimeId)}
              className={`w-full text-left px-3 py-1.5 text-xs truncate ${
                obj.runtimeId === selectedId
                  ? 'bg-arsist-accent/20 text-arsist-accent'
                  : 'hover:bg-arsist-bg/60'
              }`}
              title={obj.runtimeId}
            >
              <span className="truncate">{obj.name}</span>
              {obj.orphan && <span className="ml-1 text-arsist-warning">*</span>}
            </button>
          ))}

          <div className="px-3 py-3 mt-2 hairline-t space-y-1 text-[11px] text-arsist-muted">
            <div className="flex items-center gap-1">
              <MousePointer2 size={11} />
              {t('live.sourceLabel')}:{' '}
              <span className={isSimulating ? 'text-arsist-accent' : 'text-arsist-success'}>
                {isSimulating ? t('live.sourceSimulated') : t('live.sourceDevice')}
              </span>
            </div>
            {!isSimulating && (
              <div>
                {t('live.lastSync')}:{' '}
                {lastSyncAt ? `${((Date.now() - lastSyncAt) / 1000).toFixed(1)}s` : '-'}
              </div>
            )}
            {!isSimulating && !viewer.tracking && (
              <div className="text-arsist-warning">{t('live.notTracking')}</div>
            )}
            {syncError && <div className="text-arsist-error break-words">{syncError}</div>}
          </div>
        </div>

        {/* 中央: 3D俯瞰 + ユーザー視点 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 relative min-h-0">
            <WorldView
              objects={objects}
              viewer={viewer}
              fov={fov}
              selectedId={selectedId}
              onSelect={(id) => select(id || null)}
              frustumDistance={defaultDepth}
              viewerLabel={isSimulating ? t('live.viewerSimulated') : t('live.viewerDevice')}
            />
            <div className="absolute top-2 left-2 px-2 py-1 rounded bg-arsist-bg/80 text-[11px] text-arsist-muted pointer-events-none">
              {t('live.worldViewLabel')}
            </div>
          </div>

          <div className="h-px" style={{ backgroundColor: 'rgb(var(--arsist-divider) / var(--arsist-divider-alpha))' }} />

          <div className="h-[45%] min-h-[180px] relative bg-arsist-bg" ref={fpvRef}>
            <FirstPersonView
              objects={objects}
              viewer={viewer}
              fov={fov}
              backgroundMode={backgroundMode}
              backgroundColor={backgroundColor}
              selectedId={selectedId}
              onSelect={(id) => select(id)}
              className="w-full h-full"
            />
            <div className="absolute top-2 left-2 px-2 py-1 rounded bg-arsist-bg/80 text-[11px] text-arsist-muted pointer-events-none">
              {t('live.firstPersonLabel')}
              {!fov && ` · ${t('live.fovUnknown')}`}
            </div>
            {isSimulating && (
              <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 pointer-events-none">
                <span className="px-2 py-1 rounded bg-arsist-bg/80 text-[11px] text-arsist-muted">
                  {t('live.simulationControls')}
                </span>
                <button
                  className="btn btn-ghost text-[11px] px-2 py-1 pointer-events-auto"
                  onClick={resetSimulatedPose}
                >
                  <RefreshCw size={11} />
                  {t('live.resetViewpoint')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 右: インスペクタ */}
        <div className="w-64 shrink-0 bg-arsist-surface overflow-hidden">
          <LiveInspector selected={selected} viewer={viewer} />
        </div>
      </div>
    </div>
  );
}
