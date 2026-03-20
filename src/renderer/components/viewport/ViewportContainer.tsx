import { useUIStore } from '../../stores/uiStore';
import { SceneViewport } from './SceneViewport';
import { UIEditor } from './UIEditor';
import { ScriptEditor } from './ScriptEditor';

export function ViewportContainer() {
  const { currentView } = useUIStore();

  return (
    <div className="w-full h-full bg-arsist-bg">
      {currentView === 'scene' && <SceneViewport />}
      {currentView === 'ui' && <UIEditor />}
      {currentView === 'script' && <ScriptEditor />}
    </div>
  );
}
