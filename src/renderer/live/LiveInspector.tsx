/**
 * Arsist Engine — ライブ配置モードのインスペクタ
 *
 * 実機接続中: 変更は即座に実機へ送られる（プロジェクトIRには触らない）。
 *             気に入った配置になったら「プロジェクトに反映」で初めてIRへ書き戻す。
 * シミュレーション中: 実機が無いので、変更は直接IRへ反映する。
 *
 * この2モードを分けているのは、実機で試している最中の一時的な位置が、
 * 意図せずプロジェクトに焼き込まれるのを避けるため。
 */
import { useMemo } from 'react';
import { Crosshair, RotateCcw, Save, Link2Off } from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useLiveStore } from './liveStore';
import { distanceBetween, normalizeEuler, runtimeToIr, type Vec3 } from './coords';
import type { PlacedObject, ViewerPose } from './useLiveScene';
import { useT } from '../i18n';

function NumberRow({
  label,
  value,
  onChange,
  step = 0.05,
  disabled,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  disabled?: boolean;
  unit?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-5 text-arsist-muted">{label}</span>
      <input
        type="number"
        className="input flex-1 text-xs py-1"
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
      {unit && <span className="text-arsist-muted w-4">{unit}</span>}
    </label>
  );
}

export function LiveInspector({
  selected,
  viewer,
}: {
  selected: PlacedObject | null;
  viewer: ViewerPose;
}) {
  const t = useT();
  const client = useLiveStore((s) => s.client);
  const connection = useLiveStore((s) => s.connection);
  const simulationOnly = useLiveStore((s) => s.simulationOnly);
  const updateObject = useProjectStore((s) => s.updateObject);

  const liveMode = !simulationOnly && connection === 'connected';

  const distance = useMemo(
    () => (selected ? distanceBetween(viewer.position, selected.position) : 0),
    [selected, viewer.position],
  );

  if (!selected) {
    return (
      <div className="p-4 text-xs text-arsist-muted">
        {t('live.selectObjectHint')}
      </div>
    );
  }

  /** 実機へ即反映（応答待ちしない。ドラッグ的な連続操作でも詰まらない） */
  const sendPosition = (p: Vec3) => {
    client?.send('scene', 'setPosition', { id: selected.runtimeId, x: p.x, y: p.y, z: p.z });
  };
  const sendRotation = (r: Vec3) => {
    client?.send('scene', 'setRotation', { id: selected.runtimeId, pitch: r.x, yaw: r.y, roll: r.z });
  };
  const sendScale = (s: Vec3) => {
    client?.send('scene', 'setScale', { id: selected.runtimeId, x: s.x, y: s.y, z: s.z });
  };

  /** IRへ書き戻す（Unityワールド座標 → IR座標へ変換して保存） */
  const writeToProject = (position: Vec3, rotation: Vec3, scale: Vec3) => {
    if (!selected.irId) return;
    const ir = runtimeToIr({ position, rotation });
    updateObject(selected.irId, {
      transform: {
        position: ir.position,
        rotation: normalizeEuler(ir.rotation),
        scale,
      },
    });
  };

  const applyPosition = (p: Vec3) => {
    if (liveMode) sendPosition(p);
    else writeToProject(p, selected.rotation, selected.scale);
  };
  const applyRotation = (r: Vec3) => {
    if (liveMode) sendRotation(r);
    else writeToProject(selected.position, r, selected.scale);
  };
  const applyScale = (s: Vec3) => {
    if (liveMode) sendScale(s);
    else writeToProject(selected.position, selected.rotation, s);
  };

  /** ユーザーの正面 distance[m] に置く */
  const placeInFront = (d: number) => {
    if (liveMode) {
      client?.send('viewer', 'placeInFront', { id: selected.runtimeId, distance: d, faceUser: true });
      return;
    }
    // シミュレーション: 同じ計算をこちらで行ってIRへ反映
    const f = viewer.forward;
    const len = Math.hypot(f.x, f.y, f.z) || 1;
    const position = {
      x: viewer.position.x + (f.x / len) * d,
      y: viewer.position.y + (f.y / len) * d,
      z: viewer.position.z + (f.z / len) * d,
    };
    // ユーザーに正対させる（Unity の World Space Canvas は +Z 側から読める向き）
    const yaw = (Math.atan2(f.x, f.z) * 180) / Math.PI;
    const pitch = (Math.asin(-f.y / len) * 180) / Math.PI;
    writeToProject(position, { x: pitch, y: yaw, z: 0 }, selected.scale);
  };

  const rot = normalizeEuler(selected.rotation);

  return (
    <div className="p-3 space-y-4 overflow-y-auto h-full">
      <div>
        <div className="text-sm font-semibold truncate">{selected.name}</div>
        <div className="text-[11px] text-arsist-muted font-mono truncate">{selected.runtimeId}</div>
        {selected.orphan && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-arsist-warning">
            <Link2Off size={12} />
            {t('live.orphanObject')}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-arsist-muted">
          {t('live.position')}
        </div>
        <NumberRow label="X" value={selected.position.x} onChange={(v) => applyPosition({ ...selected.position, x: v })} unit="m" />
        <NumberRow label="Y" value={selected.position.y} onChange={(v) => applyPosition({ ...selected.position, y: v })} unit="m" />
        <NumberRow label="Z" value={selected.position.z} onChange={(v) => applyPosition({ ...selected.position, z: v })} unit="m" />
      </div>

      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-arsist-muted">
          {t('live.rotation')}
        </div>
        <NumberRow label="X" value={rot.x} step={1} onChange={(v) => applyRotation({ ...rot, x: v })} unit="°" />
        <NumberRow label="Y" value={rot.y} step={1} onChange={(v) => applyRotation({ ...rot, y: v })} unit="°" />
        <NumberRow label="Z" value={rot.z} step={1} onChange={(v) => applyRotation({ ...rot, z: v })} unit="°" />
      </div>

      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-arsist-muted">
          {t('live.scale')}
        </div>
        <NumberRow label="X" value={selected.scale.x} onChange={(v) => applyScale({ ...selected.scale, x: v })} />
        <NumberRow label="Y" value={selected.scale.y} onChange={(v) => applyScale({ ...selected.scale, y: v })} />
        <NumberRow label="Z" value={selected.scale.z} onChange={(v) => applyScale({ ...selected.scale, z: v })} />
      </div>

      {/* ユーザーからの距離で置く */}
      <div className="space-y-2 pt-2 hairline-t">
        <div className="text-[11px] uppercase tracking-wide text-arsist-muted flex items-center gap-1">
          <Crosshair size={12} />
          {t('live.distanceFromUser')}
        </div>
        <div className="text-xs text-arsist-muted">
          {t('live.currentDistance', { d: distance.toFixed(2) })}
        </div>
        <input
          type="range"
          min={0.3}
          max={10}
          step={0.1}
          value={Math.min(10, Math.max(0.3, distance))}
          onChange={(e) => placeInFront(parseFloat(e.target.value))}
          className="w-full"
        />
        <div className="flex gap-1">
          {[0.5, 1, 1.5, 2, 3, 5].map((d) => (
            <button
              key={d}
              className="btn btn-ghost text-[11px] px-2 py-1"
              onClick={() => placeInFront(d)}
            >
              {d}m
            </button>
          ))}
        </div>
      </div>

      {/* IRへの反映 */}
      {liveMode && (
        <div className="pt-2 hairline-t space-y-2">
          <button
            className="btn btn-primary w-full text-xs"
            disabled={!selected.irId}
            onClick={() => writeToProject(selected.position, selected.rotation, selected.scale)}
          >
            <Save size={14} />
            {t('live.applyToProject')}
          </button>
          <p className="text-[11px] text-arsist-muted">
            {selected.irId ? t('live.applyToProjectHint') : t('live.applyToProjectUnavailable')}
          </p>
        </div>
      )}

      {!liveMode && (
        <div className="pt-2 hairline-t">
          <p className="text-[11px] text-arsist-muted flex items-start gap-1">
            <RotateCcw size={12} className="mt-0.5 shrink-0" />
            {t('live.simulationEditHint')}
          </p>
        </div>
      )}
    </div>
  );
}
