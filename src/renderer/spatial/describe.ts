/** 画面に出す短い説明 (置き方の規則・行動など)。文字はすべて spatialStrings.ts。 */
import type { TFunc } from '../i18n';
import type { SolveResult } from '../../shared/layster/spatial/solver';
import type { Action, Target, When } from '../../shared/layster/spatial/types';

export function describeRule(t: TFunc, rule: SolveResult['rule']): string {
  if (rule === 0) return t('spatial.rule.intended');
  if (rule === 'default') return t('spatial.rule.default');
  return t('spatial.rule.fallback', { n: rule });
}

export function describeTarget(t: TFunc, target: Target | undefined): string {
  if (!target) return '—';
  if ('thing' in target) return t('spatial.target.thingShort', { id: target.thing });
  if ('entity' in target) {
    const q = target.entity;
    return q.id ? q.id : (q.is ?? q.has ?? []).join(', ') || t('spatial.target.anyEntity');
  }
  if ('frame' in target) return `${target.frame}${target.at ? ` [${target.at.join(', ')}]` : ''}`;
  return t(`spatial.target.user.${target.user}`);
}

export function describeAction(t: TFunc, a: Action): string {
  switch (a.do) {
    case 'say': return `${t('spatial.action.say')}: “${a.text}”`;
    case 'place': return `${t('spatial.action.place')}: ${a.thing}`;
    case 'move': return `${t('spatial.action.move')}: ${a.thing} → ${describeTarget(t, a.to)}`;
    case 'look': return `${t('spatial.action.look')}: ${a.thing} → ${describeTarget(t, a.at)}`;
    case 'animate': return `${t('spatial.action.animate')}: ${a.thing} ${a.clip}`;
    case 'show': return `${t('spatial.action.show')}: ${a.thing}`;
    case 'hide': return `${t('spatial.action.hide')}: ${a.thing}`;
    case 'highlight': return `${t('spatial.action.highlight')}: ${describeTarget(t, a.target)}${a.label ? ` “${a.label}”` : ''}`;
    case 'set': return `${t('spatial.action.set')}: ${a.key} = ${JSON.stringify(a.value)}`;
    case 'emit': return `${t('spatial.action.emit')}: ${a.event}`;
    case 'believe': return `${t('spatial.action.believe')}: ${a.entity?.id}`;
    case 'forget': return `${t('spatial.action.forget')}: ${a.entity}`;
    case 'ask': return `${t('spatial.action.ask')}: ${a.mind}`;
    case 'command': return `${t('spatial.action.command')}: ${a.body}.${a.name}`;
  }
}

export function whenKind(w: When): string {
  return Object.keys(w)[0] ?? 'start';
}

export function describeWhen(t: TFunc, w: When): string {
  const k = whenKind(w);
  const v = (w as Record<string, unknown>)[k];
  const detail = k === 'start' ? '' : k === 'seen' || k === 'lost'
    ? ` ${((v as { is?: string[] })?.is ?? []).join(', ')}`
    : typeof v === 'string' || typeof v === 'number' ? ` ${v}` : '';
  return `${t(`spatial.when.${k}`)}${detail}`;
}
