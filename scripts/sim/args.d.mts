// args.mjs の型 (src/renderer/sim/previewArgs.test.ts が読む)
export const VIEWS: string[];
export const USAGE: string;
export function parseTimes(text: string | undefined | null): number[];
export function timeTag(t: number): string;
export function safeName(s: string): string;
export interface PreviewOptions {
  project: string | null; out: string | null; space: string | null; scene: string | null; device: string | null;
  times: number[]; width: number; height: number; view: 'first-person' | 'overview'; overlays: boolean;
  lang: 'en' | 'ja'; json: boolean; timeout: number; help: boolean;
}
export function parseArgs(argv: string[]): { ok: true; opts: PreviewOptions } | { ok: false; error: string };
