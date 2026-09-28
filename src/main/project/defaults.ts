/**
 * 新規プロジェクトと移行の両方が使う既定値。
 *
 * ProjectManager (作成) と migrations (古いプロジェクトの補完) が同じ既定値を
 * 見るようにここに置く。片方だけ直すと、新規と移行後で設定が食い違う。
 */
import type { ARSettings, DataFlowDefinition, ProjectTemplate } from '../../shared/types';

export function createARSettings(template: ProjectTemplate): ARSettings {
  const common = {
    worldScale: 1,
    enableRemoteControl: false,
    remoteControlPort: 8765,
    remoteControlPassword: '',
    interaction: { controllerRay: true, handTracking: false },
  };
  switch (template) {
    case '2d_floating_screen':
      return {
        ...common,
        trackingMode: '3dof',
        presentationMode: 'floating_screen',
        defaultDepth: 2,
        floatingScreen: { width: 1.6, height: 0.9, distance: 2, lockToGaze: true },
      };
    case 'head_locked_hud':
      return {
        ...common,
        trackingMode: 'head_locked',
        presentationMode: 'head_locked_hud',
        defaultDepth: 1,
      };
    case '3d_ar_scene':
    default:
      return {
        ...common,
        trackingMode: '6dof',
        presentationMode: 'world_anchored',
        defaultDepth: 2,
      };
  }
}

export function createInitialDataFlow(): DataFlowDefinition {
  return { dataSources: [], transforms: [] };
}

/** 旧テンプレート名を新名に変換（後方互換） */
export function migrateAppType(oldType: string): ProjectTemplate {
  switch (oldType) {
    case '3D_AR':
      return '3d_ar_scene';
    case '2D_Floating':
      return '2d_floating_screen';
    case '2D_HeadLocked':
      return 'head_locked_hud';
    default:
      return '3d_ar_scene';
  }
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = ['3d_ar_scene', '2d_floating_screen', 'head_locked_hud'];
