/** 右のインスペクタ: 選んでいるものに合わせて中身を変える。 */
import { MousePointerClick } from 'lucide-react';
import { useT } from '../../i18n';
import { useSpatialStore } from '../store';
import { ThingInspector } from './ThingInspector';
import { MindInspector } from './MindInspector';
import { BodyInspector } from './BodyInspector';
import { RuleInspector } from './RuleInspector';
import { ScriptInspector } from './ScriptInspector';
import { RecordingInspector, SettingsInspector, SpacesInspector } from './ProjectInspectors';

export function Inspector() {
  const t = useT();
  const project = useSpatialStore((s) => s.project);
  const selection = useSpatialStore((s) => s.selection);
  if (!project) return null;

  let body: JSX.Element | null = null;
  switch (selection?.kind) {
    case 'thing': {
      const x = project.things.find((y) => y.id === selection.id);
      if (x) body = <ThingInspector key={x.id} project={project} thing={x} />;
      break;
    }
    case 'mind': {
      const x = project.minds.find((y) => y.id === selection.id);
      if (x) body = <MindInspector key={x.id} project={project} mind={x} />;
      break;
    }
    case 'body': {
      const x = project.bodies.find((y) => y.id === selection.id);
      if (x) body = <BodyInspector key={x.id} project={project} body={x} />;
      break;
    }
    case 'rule': {
      const x = project.rules.find((y) => y.id === selection.id);
      if (x) body = <RuleInspector key={x.id} project={project} rule={x} />;
      break;
    }
    case 'script': {
      const x = project.scripts.find((y) => y.id === selection.id);
      if (x) body = <ScriptInspector key={x.id} project={project} script={x} />;
      break;
    }
    case 'recording': body = <RecordingInspector project={project} />; break;
    case 'settings': body = <SettingsInspector project={project} />; break;
    case 'spaces': body = <SpacesInspector project={project} />; break;
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      {body ?? (
        <div className="h-full flex flex-col items-center justify-center text-center text-arsist-muted gap-2 px-4">
          <MousePointerClick size={28} className="opacity-30" />
          <div className="text-xs">{t('spatial.inspector.empty')}</div>
        </div>
      )}
    </div>
  );
}
