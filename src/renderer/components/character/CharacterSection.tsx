/**
 * VRM のインスペクタの「キャラクター」。物の character (IR v5) を編集する。
 *
 *   最初の動き     Assets/Animations の FBX から選ぶ (▶ で 3D ビューで試せる)。FBX の取り込みもここから
 *   まばたき・呼吸・こちらを見る
 *
 * 動きの名前はファイル名 = スクリプトの vrm.playAnimation(id, name) の名前なので、一覧に呼び方も出す。
 */
import { useEffect, useState } from 'react';
import { Footprints, Play, Square, Upload, Sparkles, PersonStanding } from 'lucide-react';
import type { CharacterSettings, EmbodySettings, SceneObject } from '../../../shared/types';
import { CHARACTER_DEFAULTS, EMBODY_DEFAULTS } from '../../../shared/types';
import { allSceneObjects, embodySettingsOf, isEmbodied } from '../../../shared/media';
import { useT } from '../../i18n';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { previewAnimationFor, useCharacterStore } from './characterStore';

export function CharacterSection({ object }: { object: SceneObject }) {
  const t = useT();
  const projectPath = useProjectStore((s) => s.projectPath);
  const readOnly = useProjectStore((s) => s.readOnly);
  const updateObject = useProjectStore((s) => s.updateObject);
  const addConsoleLog = useUIStore((s) => s.addConsoleLog);
  const { animations, preview, reload, playPreview, stopPreview } = useCharacterStore();
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 選び直すたびに一覧を取り直す (エージェントが Assets/Animations に足したものも拾う)
  useEffect(() => { void reload(projectPath); }, [projectPath, reload, object.id]);

  const character = object.character;
  const set = (updates: Partial<CharacterSettings>) => {
    updateObject(object.id, { character: { ...(character ?? CHARACTER_DEFAULTS), ...updates } });
  };
  const playing = previewAnimationFor(preview, object.id, true, character?.animation);
  const id = object.assetId || object.name;

  const importFbx = async () => {
    if (!projectPath) return;
    const file = await window.electronAPI.fs.selectFile([{ name: 'FBX (humanoid)', extensions: ['fbx'] }]);
    if (!file) return;
    setImporting(true);
    setMessage(null);
    try {
      const r = await window.electronAPI.animations.import({ projectPath, sourcePath: file });
      if (!r.success || !r.name) {
        setMessage(t('character.importFailed', { error: r.error ?? '' }));
        return;
      }
      await reload(projectPath);
      addConsoleLog({ type: 'info', message: t('character.imported', { name: r.name }) });
      setMessage(t(r.existed ? 'character.importedSame' : 'character.imported', { name: r.name }));
      // 最初の動きがまだ無ければ、入れたものにする
      if (character && !character.animation) set({ animation: r.name });
      playPreview(object.id, r.name);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-3 rounded-lg bg-arsist-hover space-y-2.5">
      <div className="flex items-center gap-1.5">
        <Footprints size={14} className="text-arsist-accent" />
        <span className="text-xs font-semibold text-arsist-text flex-1">{t('character.title')}</span>
      </div>

      {!character ? (
        <>
          <p className="text-[10px] text-arsist-muted leading-snug">{t('character.notYet')}</p>
          <button className="btn btn-secondary text-xs py-1 w-full justify-center" disabled={readOnly}
            onClick={() => updateObject(object.id, { character: { ...CHARACTER_DEFAULTS } })}>
            <Sparkles size={12} />{t('character.makeCharacter')}
          </button>
        </>
      ) : (
        <>
          {/* 最初の動き */}
          <div>
            <label className="input-label">{t('character.animation')}</label>
            <div className="flex items-center gap-1">
              <select className="input text-xs flex-1" value={character.animation ?? ''} disabled={readOnly}
                onChange={(e) => {
                  set({ animation: e.target.value || undefined });
                  useCharacterStore.setState({ preview: null });
                }}>
                <option value="">{t('character.animationNone')}</option>
                {character.animation && !animations.some((a) => a.name === character.animation) && (
                  <option value={character.animation}>{t('character.animationMissing', { name: character.animation })}</option>
                )}
                {animations.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
              <button className="btn-icon" title={t('character.importFbx')} onClick={importFbx} disabled={importing || readOnly || !projectPath}>
                <Upload size={13} />
              </button>
            </div>
            <p className="text-[10px] text-arsist-muted leading-snug mt-1">{t('character.animationHelp')}</p>
          </div>

          {/* 動きの一覧 (▶ で試す) */}
          {animations.length > 0 ? (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-arsist-muted">{t('character.animationsInProject', { count: animations.length })}</span>
                {playing && (
                  <button className="text-[10px] text-arsist-muted hover:text-arsist-text flex items-center gap-1" onClick={() => stopPreview(object.id)}>
                    <Square size={10} />{t('character.stopPreview')}
                  </button>
                )}
              </div>
              {animations.map((a) => {
                const active = playing === a.name;
                return (
                  <div key={a.name} className={`flex items-center gap-1.5 rounded px-1.5 py-1 ${active ? 'bg-arsist-accent/15' : 'hover:bg-arsist-bg/50'}`}>
                    <button className={`shrink-0 ${active ? 'text-arsist-accent' : 'text-arsist-muted hover:text-arsist-text'}`}
                      title={active ? t('character.stopPreview') : t('character.playPreview')}
                      onClick={() => (active ? stopPreview(object.id) : playPreview(object.id, a.name))}>
                      {active ? <Square size={11} /> : <Play size={11} />}
                    </button>
                    <span className="text-[11px] text-arsist-text flex-1 truncate">{a.name}</span>
                    {character.animation === a.name && <span className="text-[9px] text-arsist-accent">{t('character.startTag')}</span>}
                  </div>
                );
              })}
              <p className="text-[10px] text-arsist-muted font-mono pt-1 break-all">vrm.playAnimation('{id}', '{animations[0].name}')</p>
            </div>
          ) : (
            <div className="rounded-md bg-arsist-bg/50 p-2 space-y-1">
              <p className="text-[10px] text-arsist-text leading-snug">{t('character.noAnimations')}</p>
              <p className="text-[10px] text-arsist-muted leading-snug">{t('character.mixamoHint')}</p>
            </div>
          )}
          {message && <p className="text-[10px] text-arsist-muted">{message}</p>}

          {/* まばたき・呼吸 */}
          <Toggle label={t('character.blink')} help={t('character.blinkHelp')} value={character.blink ?? false}
            disabled={readOnly} onChange={(v) => set({ blink: v })} />
          <Toggle label={t('character.breathe')} help={t('character.breatheHelp')} value={character.breathe ?? false}
            disabled={readOnly} onChange={(v) => set({ breathe: v })} />

          {/* こちらを見る */}
          <div>
            <label className="input-label">{t('character.lookAtUser')}</label>
            <select className="input text-xs" value={character.lookAtUser ?? 'off'} disabled={readOnly}
              onChange={(e) => set({ lookAtUser: e.target.value as CharacterSettings['lookAtUser'] })}>
              <option value="off">{t('character.lookOff')}</option>
              <option value="nearby">{t('character.lookNearby')}</option>
              <option value="always">{t('character.lookAlways')}</option>
            </select>
            <p className="text-[10px] text-arsist-muted leading-snug mt-1">{t('character.lookHelp')}</p>
          </div>

          <p className="text-[10px] text-arsist-muted leading-snug">{t('character.scriptHint')}</p>

          {/* 自分の体として動かす (character.embody、β1.1.0) */}
          <EmbodySection object={object} character={character} disabled={readOnly} onChange={(embody) => set({ embody })} />
        </>
      )}
    </div>
  );
}

/**
 * 「自分の体として動かす」(character.embody)。on にすると EMBODY_DEFAULTS が入る。off で embody ごと消す
 * (enabled: false で残すより、無い = 今までどおり の方が読みやすい)。
 */
function EmbodySection({ object, character, disabled, onChange }: {
  object: SceneObject; character: CharacterSettings; disabled?: boolean; onChange: (embody: EmbodySettings | undefined) => void;
}) {
  const t = useT();
  const project = useProjectStore((s) => s.project);
  const on = isEmbodied(object);
  const e = embodySettingsOf(character.embody);
  const set = (updates: Partial<EmbodySettings>) => onChange({ ...e, ...updates, enabled: true });
  const others = on && project ? allSceneObjects(project).filter((o) => o.id !== object.id && isEmbodied(o)) : [];
  const id = object.assetId || object.name;
  return (
    <div className="pt-2 space-y-2 hairline-t">
      <div className="flex items-start gap-2">
        <PersonStanding size={14} className="text-arsist-accent mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-arsist-text">{t('embody.title')}</div>
          <div className="text-[10px] text-arsist-muted leading-snug">{t('embody.help')}</div>
        </div>
        <button role="switch" aria-checked={on} aria-label={t('embody.title')} disabled={disabled}
          onClick={() => onChange(on ? undefined : { ...EMBODY_DEFAULTS })}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${on ? 'bg-arsist-accent' : 'bg-arsist-border'} ${disabled ? 'opacity-50' : ''}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
      </div>
      {on && (
        <>
          {others.length > 0 && (
            <p className="text-[10px] text-arsist-warning leading-snug">{t('embody.otherWarning', { name: others.map((o) => o.name).join(', ') })}</p>
          )}
          <div>
            <label className="input-label">{t('embody.hands')}</label>
            <select className="input text-xs" value={e.hands} disabled={disabled}
              onChange={(ev) => set({ hands: ev.target.value as EmbodySettings['hands'] })}>
              <option value="auto">{t('embody.handsAuto')}</option>
              <option value="controllers">{t('embody.handsControllers')}</option>
              <option value="hands">{t('embody.handsHands')}</option>
            </select>
          </div>
          <Toggle label={t('embody.lipSync')} help={t('embody.lipSyncHelp')} value={e.lipSync} disabled={disabled} onChange={(v) => set({ lipSync: v })} />
          <Toggle label={t('embody.hideFromSelf')} help={t('embody.hideFromSelfHelp')} value={e.hideFromSelf} disabled={disabled} onChange={(v) => set({ hideFromSelf: v })} />
          <Toggle label={t('embody.matchHeight')} help={t('embody.matchHeightHelp')} value={e.matchHeight} disabled={disabled} onChange={(v) => set({ matchHeight: v })} />
          <p className="text-[10px] text-arsist-muted font-mono break-all">vrm.embody('{id}', false) / vrm.calibrate('{id}')</p>
        </>
      )}
    </div>
  );
}

export function Toggle({ label, help, value, disabled, onChange }: {
  label: string; help: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-arsist-text">{label}</div>
        <div className="text-[10px] text-arsist-muted leading-snug">{help}</div>
      </div>
      <button role="switch" aria-checked={value} aria-label={label} disabled={disabled} onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${value ? 'bg-arsist-accent' : 'bg-arsist-border'} ${disabled ? 'opacity-50' : ''}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
