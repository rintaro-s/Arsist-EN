/**
 * フォルダが Layster.Virtual / Layster.Spatial / どちらでもないかを見分ける (doc/19-layster.md §1.4)。
 *
 * project.spatial.json があれば Spatial、project.json があれば Virtual。両方あるフォルダは作らない約束だが、
 * あれば Spatial を優先する (Spatial のファイルは α のエディタが読まないので、そちらが新しく作られたもの)。
 */
import * as path from 'path';
import * as fs from 'fs-extra';
import {
  describeVirtualIrVersion, formatLayster, readLaysterHeader, SPATIAL_PROJECT_FILE, VIRTUAL_PROJECT_FILE,
} from '../../shared/layster/version';
import { readIrVersion } from '../../shared/irVersion';
import type { ProjectKindInfo } from '../../shared/layster/spatial/ipc';

async function readJsonQuiet(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse(await fs.readFile(file, 'utf8'));
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

export async function detectProjectKind(dir: string): Promise<ProjectKindInfo> {
  if (!dir || typeof dir !== 'string') return { kind: 'none' };
  const spatialFile = path.join(dir, SPATIAL_PROJECT_FILE);
  if (await fs.pathExists(spatialFile)) {
    const raw = await readJsonQuiet(spatialFile);
    const header = readLaysterHeader(raw);
    return {
      kind: 'spatial',
      label: header ? formatLayster(header) : 'Layster.Spatial',
      name: typeof raw?.name === 'string' ? raw.name : path.basename(dir),
      file: spatialFile,
    };
  }
  const virtualFile = path.join(dir, VIRTUAL_PROJECT_FILE);
  if (await fs.pathExists(virtualFile)) {
    const raw = await readJsonQuiet(virtualFile);
    const header = readLaysterHeader(raw);
    return {
      kind: 'virtual',
      label: header && header.profile === 'virtual'
        ? formatLayster(header)
        : `Layster.Virtual ${describeVirtualIrVersion(readIrVersion(raw))}`,
      name: typeof raw?.name === 'string' ? raw.name : path.basename(dir),
      file: virtualFile,
    };
  }
  return { kind: 'none' };
}
