/**
 * Space Lab — 選んだ試す空間の 3D と、物が「どの置き方で」置かれたか。
 * 計算は solver.ts (実機と同じ)。ここは見せるだけで、IR は書き換えない。
 */
import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import { Box, Hand, Info } from 'lucide-react';
import { useT, useI18n } from '../../i18n';
import { useTheme } from '../../theme';
import { useSpatialStore } from '../store';
import { useActiveSolve } from '../useSolve';
import { EntityBoxes, entityName } from './EntityBoxes';
import { ThingMeshes, ruleColor } from './ThingMeshes';
import { UserRig } from './UserRig';
import { BodyWorkspaces } from './BodyWorkspaces';
import { SpaceStrip } from './SpaceStrip';
import { describeRule } from '../describe';

export function SpaceLab() {
  const t = useT();
  const { lang } = useI18n();
  const { theme } = useTheme();
  const project = useSpatialStore((s) => s.project);
  const selection = useSpatialStore((s) => s.selection);
  const selectedEntity = useSpatialStore((s) => s.selectedEntity);
  const setSelection = useSpatialStore((s) => s.setSelection);
  const setSelectedEntity = useSpatialStore((s) => s.setSelectedEntity);
  const setBottomTab = useSpatialStore((s) => s.setBottomTab);
  const solve = useActiveSolve();
  if (!project) return null;

  const selectedThing = selection?.kind === 'thing' ? selection.id : null;
  const selectedBody = selection?.kind === 'body' ? selection.id : null;
  const highlightThing = selectedThing ?? (selectedBody ? project.bodies.find((b) => b.id === selectedBody)?.base.thing ?? null : null);
  const result = solve?.results.find((r) => r.thing === selectedThing);
  const hostEntity = result?.host ? solve?.world.entities.find((e) => e.id === result.host) : undefined;
  const bg = theme === 'light' ? '#e9ecef' : '#1b1d21';

  return (
    <div className="w-full h-full flex flex-col">
      <SpaceStrip />
      <div className="relative flex-1 min-h-0">
        {solve ? (
          <Canvas
            camera={{ position: [1.9, 2.6, 2.3], fov: 50, near: 0.02, far: 100 }}
            onPointerMissed={() => setSelectedEntity(null)}
            style={{ background: bg }}
          >
            <ambientLight intensity={0.7} />
            <directionalLight position={[3, 6, 2]} intensity={0.8} />
            <Suspense fallback={null}>
              <Grid
                args={[20, 20]} cellSize={0.25} sectionSize={1} position={[0, -0.001, 0]}
                cellColor={theme === 'light' ? '#c5cad1' : '#2e3238'} sectionColor={theme === 'light' ? '#a3aab4' : '#3d434b'}
                fadeDistance={14} infiniteGrid
              />
              <EntityBoxes
                entities={solve.world.entities}
                selected={selectedEntity ?? result?.host ?? null}
                onPick={(id) => { setSelectedEntity(id); setBottomTab('world'); }}
              />
              <UserRig world={solve.world} />
              <ThingMeshes
                things={project.things}
                results={solve.results}
                world={solve.world}
                selected={highlightThing}
                onPick={(id) => setSelection({ kind: 'thing', id })}
              />
              <BodyWorkspaces bodies={project.bodies} results={solve.results} world={solve.world} selected={selectedBody} />
            </Suspense>
            <OrbitControls target={[0, 0.8, -1.0]} makeDefault enableDamping={false} />
          </Canvas>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-arsist-muted">{t('spatial.lab.noSpace')}</div>
        )}

        {/* 空間の説明 */}
        {solve && (
          <div className="absolute top-2 left-2 max-w-[60%] px-3 py-2 rounded-md bg-arsist-surface/90 text-xs pointer-events-none">
            <div className="font-medium text-arsist-text flex items-center gap-1.5">
              <Box size={12} className="text-arsist-accent" />
              {solve.space.name[lang]}
              {!solve.space.knows.includes('scan') && (
                <span className="text-[10px] px-1 rounded bg-arsist-warning/20 text-arsist-warning">{t('spatial.lab.noScan')}</span>
              )}
              {!solve.space.knows.includes('hands') && <span title={t('spatial.lab.noHands')}><Hand size={11} className="text-arsist-muted opacity-50" /></span>}
            </div>
            {solve.space.description && <div className="text-arsist-muted mt-0.5">{solve.space.description[lang]}</div>}
          </div>
        )}

        {/* 凡例 */}
        <div className="absolute top-2 right-2 px-2 py-1.5 rounded-md bg-arsist-surface/90 text-[10px] text-arsist-muted space-y-0.5 pointer-events-none">
          <Legend color={ruleColor(0)} label={t('spatial.lab.legendIntended')} />
          <Legend color={ruleColor(1)} label={t('spatial.lab.legendFallback')} />
          <Legend color={ruleColor('default')} label={t('spatial.lab.legendDefault')} />
          <Legend color="#569cd6" label={t('spatial.lab.legendUser')} />
        </div>

        {/* 選んだ物がどう置かれたか */}
        {result && (
          <div className="absolute bottom-2 left-2 max-w-[70%] px-3 py-2 rounded-md bg-arsist-surface/95 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: ruleColor(result.rule) }} />
              <span className="font-medium text-arsist-text">{describeRule(t, result.rule)}</span>
              {hostEntity && <span className="text-arsist-muted">· {t('spatial.lab.onHost', { host: entityName(hostEntity, lang) })}</span>}
              {result.frame !== 'world' && <span className="text-arsist-muted">· {t('spatial.lab.attached', { frame: result.frame })}</span>}
            </div>
            {result.notes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-arsist-muted font-mono">
                {result.notes.map((n, i) => <li key={i} className="flex gap-1"><Info size={10} className="mt-0.5 shrink-0" />{n}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
      {label}
    </div>
  );
}
