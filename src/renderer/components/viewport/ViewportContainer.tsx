import { useEffect, useState } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { SceneViewport } from './SceneViewport';
import { UIEditor } from './UIEditor';
import { ScriptEditor } from './ScriptEditor';
import { VisionEditor } from './VisionEditor';
import { ModelsWorkspace } from '../models/ModelsWorkspace';
import { ExtensionsWorkspace } from '../extensions/ExtensionsWorkspace';

/**
 * 3D ビューは、一度開いたら他のタブのあいだも残しておく (見えなくして、描画だけ止める)。
 * 作り直すと WebGL の文脈ごと捨てることになり、アバターやモデルの読み直しと、視点の初期化が起きる。
 */
export function ViewportContainer() {
  const { currentView } = useUIStore();
  const sceneActive = currentView === 'scene';
  const [sceneMounted, setSceneMounted] = useState(sceneActive);
  useEffect(() => { if (sceneActive) setSceneMounted(true); }, [sceneActive]);

  return (
    <div className="w-full h-full bg-arsist-bg relative">
      {(sceneMounted || sceneActive) && (
        <div className={`absolute inset-0 ${sceneActive ? '' : 'invisible pointer-events-none'}`} aria-hidden={!sceneActive}>
          <SceneViewport active={sceneActive} />
        </div>
      )}
      {!sceneActive && (
        <div className="absolute inset-0">
          {currentView === 'ui' && <UIEditor />}
          {currentView === 'script' && <ScriptEditor />}
          {currentView === 'vision' && <VisionEditor />}
          {currentView === 'models' && <ModelsWorkspace />}
          {currentView === 'extensions' && <ExtensionsWorkspace />}
        </div>
      )}
    </div>
  );
}
