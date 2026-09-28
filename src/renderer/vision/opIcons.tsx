/**
 * 一手ごとのアイコン。名前を読まなくても、絵コンテの中でどの手か見分けられるように。
 */
import {
  Activity, BellRing, Box, Boxes, Brush, Contrast, Cpu, Crosshair, Filter, Grid2x2, Hash, Image as ImageIcon,
  Layers2, ListFilter, Maximize, MoveHorizontal, Palette, PenLine, Radar, ScanLine, Scissors, Shapes, Sigma,
  SlidersHorizontal, Sparkles, Square, Sun, Target, Waves, Wind,
} from 'lucide-react';
import type { VisionOpType } from '../../shared/types';

const ICONS: Record<VisionOpType, (size: number) => JSX.Element> = {
  grayscale: (s) => <Contrast size={s} />,
  blur: (s) => <Wind size={s} />,
  sobel: (s) => <Waves size={s} />,
  canny: (s) => <PenLine size={s} />,
  edgeScan: (s) => <ScanLine size={s} />,
  maskSide: (s) => <Scissors size={s} />,
  hsvRange: (s) => <Palette size={s} />,
  threshold: (s) => <Sun size={s} />,
  morphology: (s) => <Maximize size={s} />,
  maskCombine: (s) => <Layers2 size={s} />,
  largestBlob: (s) => <Square size={s} />,
  blobs: (s) => <Boxes size={s} />,
  contours: (s) => <Shapes size={s} />,
  stats: (s) => <Sigma size={s} />,
  gate: (s) => <Filter size={s} />,
  recolor: (s) => <Brush size={s} />,
  dominantColor: (s) => <Palette size={s} />,
  templateMatch: (s) => <Crosshair size={s} />,
  infer: (s) => <Cpu size={s} />,
  select: (s) => <ListFilter size={s} />,
  countItems: (s) => <Hash size={s} />,
  track: (s) => <Radar size={s} />,
  annotate: (s) => <Box size={s} />,
  boxMask: (s) => <Grid2x2 size={s} />,
  stabilize: (s) => <SlidersHorizontal size={s} />,
  motion: (s) => <Activity size={s} />,
  event: (s) => <BellRing size={s} />,
  quads: (s) => <Target size={s} />,
  rectify: (s) => <MoveHorizontal size={s} />,
};

export function OpIcon({ op, size = 14 }: { op: VisionOpType; size?: number }) {
  const make = ICONS[op];
  return make ? make(size) : <Sparkles size={size} />;
}

export function SourceIcon({ size = 14 }: { size?: number }) {
  return <ImageIcon size={size} />;
}
