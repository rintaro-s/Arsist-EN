/**
 * RegionEditor — 参照写真の上に枠を描く。
 *
 * 「指定の枠の中を読む」の枠を、作者が写真を見ながら直接引けるようにする。
 * ここで引いた枠は配置の基準にも、OCR で読む範囲にもなる。
 *
 * 座標の注意: IR の rect は原点が写真の左下 (y は上向き。ランタイムの画像規約に合わせてある)。
 * CSS は左上原点なので、描画と入力の境界で y を反転する。
 */
import { useCallback, useRef, useState } from 'react';
import type { PerceptionRegion } from '../../../shared/types';
import { useT } from '../../i18n';

type Rect = PerceptionRegion['rect'];

/** これより小さい枠は誤ドラッグとみなして捨てる（写真に対する割合）。 */
const MIN_SIZE = 0.03;

interface RegionEditorProps {
  imageUrl: string | null;
  regions: PerceptionRegion[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (rect: Rect) => void;
  onChange: (id: string, rect: Rect) => void;
}

interface DragState {
  mode: 'create' | 'move' | 'resize';
  id?: string;
  originX: number;
  originY: number;
  startRect: Rect;
}

export function RegionEditor({
  imageUrl, regions, selectedId, onSelect, onCreate, onChange,
}: RegionEditorProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [tooSmall, setTooSmall] = useState(false);

  /** ポインタ位置を写真基準の正規化座標 (原点は左下) に直す。 */
  const toNormalised = useCallback((clientX: number, clientY: number) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((clientX - box.left) / box.width),
      y: clamp01(1 - (clientY - box.top) / box.height),
    };
  }, []);

  const beginCreate = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const at = toNormalised(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setTooSmall(false);
    onSelect(null);
    setDrag({ mode: 'create', originX: at.x, originY: at.y, startRect: { x: at.x, y: at.y, width: 0, height: 0 } });
    setDraft({ x: at.x, y: at.y, width: 0, height: 0 });
  };

  const beginMove = (e: React.PointerEvent, region: PerceptionRegion) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const at = toNormalised(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelect(region.id);
    setDrag({ mode: 'move', id: region.id, originX: at.x, originY: at.y, startRect: region.rect });
  };

  const beginResize = (e: React.PointerEvent, region: PerceptionRegion) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const at = toNormalised(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelect(region.id);
    setDrag({ mode: 'resize', id: region.id, originX: at.x, originY: at.y, startRect: region.rect });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const at = toNormalised(e.clientX, e.clientY);

    if (drag.mode === 'create') {
      setDraft(normaliseRect(drag.originX, drag.originY, at.x, at.y));
      return;
    }

    const dx = at.x - drag.originX;
    const dy = at.y - drag.originY;

    if (drag.mode === 'move') {
      const width = drag.startRect.width;
      const height = drag.startRect.height;
      onChange(drag.id!, {
        x: clamp(drag.startRect.x + dx, 0, 1 - width),
        y: clamp(drag.startRect.y + dy, 0, 1 - height),
        width,
        height,
      });
      return;
    }

    // resize: 左下を固定して右上を動かす
    onChange(drag.id!, {
      x: drag.startRect.x,
      y: clamp(drag.startRect.y + dy, 0, drag.startRect.y + drag.startRect.height - MIN_SIZE),
      width: clamp(drag.startRect.width + dx, MIN_SIZE, 1 - drag.startRect.x),
      height: clamp(drag.startRect.height - dy, MIN_SIZE, drag.startRect.y + drag.startRect.height),
    });
  };

  const onPointerUp = () => {
    if (drag?.mode === 'create' && draft) {
      if (draft.width >= MIN_SIZE && draft.height >= MIN_SIZE) {
        onCreate(draft);
      } else {
        // 単なるクリックと、小さすぎる枠を区別して伝える
        setTooSmall(draft.width > 0.001 || draft.height > 0.001);
      }
    }
    setDrag(null);
    setDraft(null);
  };

  return (
    <div className="space-y-1">
      <div
        ref={containerRef}
        className="relative w-full select-none rounded-lg overflow-hidden bg-arsist-hover cursor-crosshair"
        onPointerDown={beginCreate}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {imageUrl
          ? <img src={imageUrl} alt="" className="w-full block pointer-events-none" draggable={false} />
          : <div className="w-full aspect-video" />}

        {regions.map((region) => {
          const selected = region.id === selectedId;
          return (
            <div
              key={region.id}
              onPointerDown={(e) => beginMove(e, region)}
              className={`absolute cursor-move ${selected ? 'ring-2 ring-emerald-400' : 'ring-1 ring-emerald-400/50'}`}
              style={{ ...toCss(region.rect), backgroundColor: selected ? 'rgba(78,201,176,0.18)' : 'rgba(78,201,176,0.08)' }}
            >
              <span className="absolute -top-4 left-0 text-[9px] text-emerald-300 whitespace-nowrap pointer-events-none">
                {region.name}
              </span>
              {selected && (
                <div
                  onPointerDown={(e) => beginResize(e, region)}
                  className="absolute -right-1 -top-1 w-3 h-3 rounded-sm bg-emerald-400 cursor-nesw-resize"
                />
              )}
            </div>
          );
        })}

        {draft && (
          <div
            className="absolute ring-1 ring-emerald-300 pointer-events-none"
            style={{ ...toCss(draft), backgroundColor: 'rgba(78,201,176,0.15)' }}
          />
        )}
      </div>

      {tooSmall && <p className="text-[9px] text-arsist-error">{t('perception.regionTooSmall')}</p>}
      <p className="text-[9px] text-arsist-muted leading-tight">{t('perception.regionsHint')}</p>
    </div>
  );
}

/** IR の矩形 (左下原点) を CSS の位置 (左上原点) に直す。 */
function toCss(rect: Rect): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${(1 - rect.y - rect.height) * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

function normaliseRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
