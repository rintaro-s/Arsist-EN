/**
 * UIEditor — Material Design-style UI Design Editor
 *
 * - Canvas has fixed resolution
 * - Zoom only changes display scale (elements and frames scaled proportionally)
 * - Drag/resize operations work in canvas coordinates
 * - Images imported to project Assets
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useDataValue } from '../../stores/dataStoreContext';
import type { UIElement, UIElementType } from '../../../shared/types';
import {
  MousePointer2,
  Hand,
  Type,
  Square,
  Image as ImageIcon,
  Gauge as GaugeIcon,
  TrendingUp,
  ZoomIn,
  ZoomOut,
  Upload,
} from 'lucide-react';

type Tool = 'select' | 'pan' | UIElementType;

const GRID_SIZE = 16;

const TOOLBAR_ELEMENTS: Array<{ type: UIElementType; label: string; icon: React.ReactNode }> = [
  { type: 'Panel', label: 'Panel', icon: <Square size={18} /> },
  { type: 'Text', label: 'Text', icon: <Type size={18} /> },
  { type: 'Image', label: 'Image', icon: <ImageIcon size={18} /> },
  { type: 'Gauge', label: 'Gauge', icon: <GaugeIcon size={18} /> },
  { type: 'Graph', label: 'Graph', icon: <TrendingUp size={18} /> },
];

export function UIEditor() {
  const {
    project,
    projectPath,
    currentUILayoutId,
    selectedUIElementId,
    selectUIElement,
    updateUIElement,
    addUIElement,
  } = useProjectStore();

  const layout = project?.uiLayouts.find((l) => l.id === currentUILayoutId);
  const resolution = layout?.resolution || { width: 1920, height: 1080 };
  const scopeLabel = layout?.scope === 'canvas' ? 'Canvas Surface' : 'UHD Overlay';

  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const fitCanvasToViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container || !layout) return;

    const padding = 32;
    const availableWidth = Math.max(1, container.clientWidth - padding * 2);
    const availableHeight = Math.max(1, container.clientHeight - padding * 2);
    const fitZoom = Math.min(
      availableWidth / resolution.width,
      availableHeight / resolution.height,
      1,
    );

    setZoom(Math.max(0.1, Math.min(3, fitZoom)));
    setPan({ x: 0, y: 0 });
  }, [layout, resolution.width, resolution.height]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spacePressed) {
        setSpacePressed(true);
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [spacePressed]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.1, Math.min(3, z * factor)));
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (!layout) return;

    fitCanvasToViewport();

    const handleResize = () => fitCanvasToViewport();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [layout?.id, resolution.width, resolution.height, fitCanvasToViewport]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (tool === 'pan' || spacePressed || e.button === 1) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        e.preventDefault();
      }
    },
    [tool, spacePressed, pan],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      }
    },
    [isPanning, panStart],
  );

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === containerRef.current || (e.target as HTMLElement).dataset?.canvasBg) {
        selectUIElement(null);
      }
    },
    [selectUIElement],
  );

  const handleAddElement = useCallback(
    (type: UIElementType) => {
      if (!layout) return;

      const defaults: Record<UIElementType, Partial<UIElement>> = {
        Panel: {
          style: {
            position: 'absolute',
            top: 100,
            left: 100,
            width: 240,
            height: 160,
            backgroundColor: 'rgba(255,255,255,0.08)',
            padding: { top: 12, right: 12, bottom: 12, left: 12 },
          },
        },
        Text: {
          content: 'New Text',
          style: {
            position: 'absolute',
            top: 100,
            left: 100,
            width: 'auto',
            height: 'auto',
            color: '#ffffff',
            fontSize: 16,
          },
        },
        Button: {
          content: 'Button',
          style: {
            position: 'absolute',
            top: 100,
            left: 100,
            width: 140,
            height: 40,
            backgroundColor: '#2196F3',
            color: '#ffffff',
            fontSize: 14,
            padding: { top: 8, right: 16, bottom: 8, left: 16 },
          },
        },
        Image: {
          style: {
            position: 'absolute',
            top: 100,
            left: 100,
            width: 240,
            height: 160,
            backgroundColor: 'rgba(255,255,255,0.05)',
          },
        },
        Input: {
          style: {
            position: 'absolute',
            top: 100,
            left: 100,
            width: 220,
            height: 36,
            backgroundColor: 'rgba(255,255,255,0.08)',
            color: '#ffffff',
            fontSize: 14,
            padding: { top: 6, right: 10, bottom: 6, left: 10 },
          },
        },
        Slider: {
          style: {
            position: 'absolute',
            top: 100,
            left: 100,
            width: 220,
            height: 36,
          },
        },
        Gauge: {
          style: {
            position: 'absolute',
            top: 100,
            left: 100,
            width: 220,
            height: 60,
          },
        },
        Graph: {
          style: {
            position: 'absolute',
            top: 100,
            left: 100,
            width: 320,
            height: 160,
          },
        },
      };

      addUIElement(layout.root.id, { type, ...defaults[type] });
      setTool('select');
    },
    [layout, addUIElement],
  );

  const resetView = useCallback(() => {
    fitCanvasToViewport();
  }, [fitCanvasToViewport]);

  if (!layout) {
    return (
      <div className="w-full h-full flex items-center justify-center text-arsist-muted text-sm bg-[#121212]">
        Select a UI layout from the left panel
      </div>
    );
  }

  const cursor = isPanning ? 'grabbing' : tool === 'pan' || spacePressed ? 'grab' : 'default';

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-[#121212]">
      <div className="h-14 bg-[#1e1e1e] border-b border-[#2d2d2d] flex items-center px-4 gap-3 shrink-0">
        <div className="flex items-center gap-1 bg-[#2d2d2d] rounded-lg p-1">
          <ToolButton icon={<MousePointer2 size={18} />} label="Select" active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolButton icon={<Hand size={18} />} label="Pan" active={tool === 'pan'} onClick={() => setTool('pan')} />
        </div>

        <div className="w-px h-8 bg-[#2d2d2d]" />

        <div className="flex items-center gap-1">
          {TOOLBAR_ELEMENTS.map((item) => (
            <AddButton key={item.type} icon={item.icon} label={item.label} onClick={() => handleAddElement(item.type)} />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}
            className="w-8 h-8 rounded-lg bg-[#2d2d2d] hover:bg-[#3d3d3d] flex items-center justify-center text-[#e0e0e0] transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <div className="text-sm text-[#e0e0e0] font-mono w-14 text-center">
            {Math.round(zoom * 100)}%
          </div>
          <button
            onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
            className="w-8 h-8 rounded-lg bg-[#2d2d2d] hover:bg-[#3d3d3d] flex items-center justify-center text-[#e0e0e0] transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={resetView}
            className="ml-2 px-3 h-8 rounded-lg bg-[#2d2d2d] hover:bg-[#3d3d3d] text-xs text-[#e0e0e0] transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ background: '#0a0a0a', cursor }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleCanvasClick}
      >
        <div
          className="relative w-full h-full"
          data-canvas-bg="true"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: resolution.width,
              height: resolution.height,
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '50% 50%',
              borderRadius: 8,
              overflow: 'hidden',
              backgroundColor: '#000000',
              border: '2px solid #424242',
              boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
            }}
          >
            <div
              className="absolute -top-7 left-0 text-[11px] font-mono px-3 py-1 rounded-t"
              style={{ backgroundColor: '#1e1e1e', color: '#9e9e9e' }}
            >
              {layout.name} — {resolution.width}×{resolution.height} ({scopeLabel})
            </div>

            <div
              className="absolute inset-0"
              style={{
                backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)',
                backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
              }}
            />

            <div className="absolute inset-0">
              <CanvasRenderer
                element={layout.root}
                selectedId={selectedUIElementId}
                onSelect={selectUIElement}
                onUpdate={updateUIElement}
                projectPath={projectPath ?? undefined}
                tool={tool}
                zoom={zoom}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Tool Button
   ════════════════════════════════════════ */
interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function ToolButton({ icon, label, active, onClick }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      className="px-3 h-8 rounded-md flex items-center gap-2 text-sm transition-colors"
      style={{
        backgroundColor: active ? '#2196F3' : 'transparent',
        color: active ? '#ffffff' : '#e0e0e0',
      }}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface AddButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function AddButton({ icon, label, onClick }: AddButtonProps) {
  return (
    <button
      onClick={onClick}
      className="px-3 h-8 rounded-lg bg-[#2d2d2d] hover:bg-[#3d3d3d] flex items-center gap-2 text-sm text-[#e0e0e0] transition-colors"
      title={`Add ${label}`}
    >
      {icon}
      <span className="text-xs">{label}</span>
    </button>
  );
}

/* ════════════════════════════════════════
   Canvas Renderer
   ════════════════════════════════════════ */
interface CanvasRendererProps {
  element: UIElement;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<UIElement>) => void;
  projectPath?: string;
  tool: Tool;
  zoom: number;
}

function CanvasRenderer({ element, selectedId, onSelect, onUpdate, projectPath, tool, zoom }: CanvasRendererProps) {
  return (
    <ElementRenderer
      element={element}
      selectedId={selectedId}
      onSelect={onSelect}
      onUpdate={onUpdate}
      projectPath={projectPath}
      tool={tool}
      zoom={zoom}
    />
  );
}

/* ════════════════════════════════════════
   Element Renderer
   ════════════════════════════════════════ */
interface ElementRendererProps {
  element: UIElement;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<UIElement>) => void;
  projectPath?: string;
  tool: Tool;
  zoom: number;
}

function ElementRenderer({
  element,
  selectedId,
  onSelect,
  onUpdate,
  projectPath,
  tool,
  zoom,
}: ElementRendererProps) {
  const isSelected = element.id === selectedId;
  const boundValue = useDataValue(element.bind?.key || '');
  const elementRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [startRect, setStartRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

  // ── Display text ──
  const displayText = (): string => {
    if (element.bind?.key && boundValue != null) {
      const raw = String(boundValue);
      return element.bind.format ? element.bind.format.replace('{value}', raw) : raw;
    }
    return element.content || '';
  };

  // ── Style calculation ──
  const containerStyle = (): React.CSSProperties => {
    const s = element.style;
    const css: React.CSSProperties = {
      position: s.position === 'absolute' ? 'absolute' : 'relative',
      width: s.width,
      height: s.height,
      minWidth: s.minWidth,
      minHeight: s.minHeight,
      backgroundColor: s.backgroundColor || 'transparent',
      borderRadius: s.borderRadius ?? 0,
      opacity: s.opacity ?? 1,
      display: 'flex',
      flexDirection: element.layout === 'FlexRow' ? 'row' : 'column',
      justifyContent: s.justifyContent || 'flex-start',
      alignItems: s.alignItems || 'stretch',
      gap: s.gap ?? 0,
      color: s.color || '#ffffff',
      fontSize: s.fontSize ?? 14,
      fontWeight: (s.fontWeight as React.CSSProperties['fontWeight']) || 'normal',
      textAlign: s.textAlign || 'left',
      cursor: tool === 'select' ? 'move' : 'default',
      userSelect: 'none',
    };

    if (s.padding) css.padding = `${s.padding.top}px ${s.padding.right}px ${s.padding.bottom}px ${s.padding.left}px`;
    if (s.margin) css.margin = `${s.margin.top}px ${s.margin.right}px ${s.margin.bottom}px ${s.margin.left}px`;
    if (s.borderWidth) {
      css.borderWidth = s.borderWidth;
      css.borderStyle = 'solid';
      css.borderColor = s.borderColor || '#424242';
    }

    if (s.position === 'absolute') {
      if (s.top != null) css.top = s.top;
      if (s.left != null) css.left = s.left;
      if (s.right != null) css.right = s.right;
      if (s.bottom != null) css.bottom = s.bottom;
    }

    return css;
  };

  // ── Click selection ──
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(element.id);
  };

  // ── Drag move ──
  const handleMouseDown = (e: React.MouseEvent) => {
    if (tool !== 'select' || element.style.position !== 'absolute') return;
    if ((e.target as HTMLElement).dataset?.resizeHandle) return;

    e.stopPropagation();
    e.preventDefault();

    if (!isSelected) onSelect(element.id);

    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setStartRect({
      left: typeof element.style.left === 'number' ? element.style.left : 0,
      top: typeof element.style.top === 'number' ? element.style.top : 0,
      width: typeof element.style.width === 'number' ? element.style.width : 100,
      height: typeof element.style.height === 'number' ? element.style.height : 100,
    });
  };

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = (e.clientX - dragStart.x) / zoom;
        const dy = (e.clientY - dragStart.y) / zoom;

        const newLeft = Math.round((startRect.left + dx) / 1) * 1;
        const newTop = Math.round((startRect.top + dy) / 1) * 1;

        onUpdate(element.id, {
          style: {
            ...element.style,
            left: newLeft,
            top: newTop,
          },
        });
      }

      if (isResizing && resizeHandle) {
        const dx = (e.clientX - dragStart.x) / zoom;
        const dy = (e.clientY - dragStart.y) / zoom;

        let newWidth = startRect.width;
        let newHeight = startRect.height;
        let newLeft = startRect.left;
        let newTop = startRect.top;

        if (resizeHandle.includes('e')) newWidth = Math.max(20, startRect.width + dx);
        if (resizeHandle.includes('w')) {
          newWidth = Math.max(20, startRect.width - dx);
          newLeft = startRect.left + dx;
        }
        if (resizeHandle.includes('s')) newHeight = Math.max(20, startRect.height + dy);
        if (resizeHandle.includes('n')) {
          newHeight = Math.max(20, startRect.height - dy);
          newTop = startRect.top + dy;
        }

        onUpdate(element.id, {
          style: {
            ...element.style,
            width: Math.round(newWidth),
            height: Math.round(newHeight),
            left: Math.round(newLeft),
            top: Math.round(newTop),
          },
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setResizeHandle(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, resizeHandle, dragStart, startRect, element, onUpdate, zoom]);

  // ── Resize handles ──
  const handleResizeMouseDown = (e: React.MouseEvent, handle: string) => {
    e.stopPropagation();
    e.preventDefault();

    const s = element.style;
    setIsResizing(true);
    setResizeHandle(handle);
    setDragStart({ x: e.clientX, y: e.clientY });
    setStartRect({
      width: typeof s.width === 'number' ? s.width : 100,
      height: typeof s.height === 'number' ? s.height : 100,
      top: typeof s.top === 'number' ? s.top : 0,
      left: typeof s.left === 'number' ? s.left : 0,
    });
  };

  const toArsistFileUrl = (projectPath: string, assetPath: string) => {
    // Build absolute path (unify backslashes to forward slashes)
    const absPath = `${projectPath}/${assetPath}`.replace(/\\/g, '/');
    // For Windows drive letter (C: etc.), use arsist-file://C:/... format
    if (/^[A-Za-z]:/.test(absPath)) {
      return `arsist-file://${absPath}`;
    }
    // Unix path is arsist-file:///... format
    return `arsist-file:///${absPath}`;
  };

  const importImage = async () => {
    if (!projectPath || !window.electronAPI) return;

    const selected = await window.electronAPI.fs.selectFile([
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
    ]);
    if (!selected) return;

    const res = await window.electronAPI.assets.import({
      projectPath,
      sourcePath: selected,
      kind: 'texture',
    });

    if (res?.success && res.assetPath) {
      onUpdate(element.id, { assetPath: res.assetPath });
    }
  };

  // ── Element content ──
  const renderContent = () => {
    switch (element.type) {
      case 'Text':
        return <span style={{ pointerEvents: 'none' }}>{displayText()}</span>;

      case 'Button':
        return (
          <div
            className="px-4 py-2 rounded font-medium text-center"
            style={{
              backgroundColor: '#2196F3',
              color: '#ffffff',
              pointerEvents: 'none',
            }}
          >
            {displayText()}
          </div>
        );

      case 'Image':
        return (
          <div className="w-full h-full flex items-center justify-center relative group">
            {element.assetPath && projectPath ? (
              <img
                src={toArsistFileUrl(projectPath, element.assetPath)}
                className="w-full h-full object-contain"
                draggable={false}
                style={{ pointerEvents: 'none' }}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <ImageIcon size={32} style={{ color: '#616161' }} />
                <span className="text-xs" style={{ color: '#9e9e9e' }}>
                  {isSelected ? 'Click to import image' : 'No image'}
                </span>
              </div>
            )}
            {isSelected && (
              <button
                onClick={importImage}
                className="absolute bottom-2 right-2 p-2 rounded-lg bg-[#2196F3] hover:bg-[#1976D2] text-white transition-colors opacity-0 group-hover:opacity-100"
                style={{ pointerEvents: 'auto' }}
              >
                <Upload size={16} />
              </button>
            )}
          </div>
        );

      case 'Input':
        return (
          <input
            type="text"
            placeholder="Input field"
            className="w-full px-3 py-2 rounded text-sm"
            style={{
              backgroundColor: 'rgba(255,255,255,0.08)',
              border: '1px solid #424242',
              color: '#ffffff',
              pointerEvents: 'none',
            }}
            readOnly
          />
        );

      case 'Slider':
        return (
          <div className="w-full px-2 flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}>
              <div className="h-full rounded-full" style={{ width: '50%', backgroundColor: '#2196F3' }} />
            </div>
            <span style={{ color: '#9e9e9e', fontSize: 12 }}>50</span>
          </div>
        );

      case 'Gauge':
        const gaugeValue = boundValue != null ? Math.min(100, Math.max(0, Number(boundValue))) : 60;
        return (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-full h-full max-h-6 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${gaugeValue}%`,
                  backgroundColor: '#4CAF50',
                }}
              />
            </div>
          </div>
        );

      case 'Graph':
        return (
          <div className="w-full h-full flex items-end gap-1 p-2" style={{ border: '1px solid #424242', borderRadius: 4 }}>
            {[40, 65, 30, 80, 55, 70, 45].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t"
                style={{ height: `${h}%`, backgroundColor: '#2196F3' }}
              />
            ))}
          </div>
        );

      default:
        return null;
    }
  };

  // ── Panel renders children ──
  if (element.type === 'Panel') {
    return (
      <div ref={elementRef} style={containerStyle()} onClick={handleClick} onMouseDown={handleMouseDown} className="relative">
        {element.children.map((child) => (
          <ElementRenderer
            key={child.id}
            element={child}
            selectedId={selectedId}
            onSelect={onSelect}
            onUpdate={onUpdate}
            projectPath={projectPath}
            tool={tool}
            zoom={zoom}
          />
        ))}
        {isSelected && <SelectionOverlay onResizeStart={handleResizeMouseDown} />}
      </div>
    );
  }

  return (
    <div ref={elementRef} style={containerStyle()} onClick={handleClick} onMouseDown={handleMouseDown} className="relative">
      {renderContent()}
      {isSelected && <SelectionOverlay onResizeStart={handleResizeMouseDown} />}
    </div>
  );
}

/* ════════════════════════════════════════
   Selection overlay
   ════════════════════════════════════════ */
interface SelectionOverlayProps {
  onResizeStart: (e: React.MouseEvent, handle: string) => void;
}

function SelectionOverlay({ onResizeStart }: SelectionOverlayProps) {
  const handles = [
    { pos: 'nw', cursor: 'nw-resize', style: { top: -4, left: -4 } },
    { pos: 'n', cursor: 'n-resize', style: { top: -4, left: '50%', marginLeft: -4 } },
    { pos: 'ne', cursor: 'ne-resize', style: { top: -4, right: -4 } },
    { pos: 'e', cursor: 'e-resize', style: { top: '50%', right: -4, marginTop: -4 } },
    { pos: 'se', cursor: 'se-resize', style: { bottom: -4, right: -4 } },
    { pos: 's', cursor: 's-resize', style: { bottom: -4, left: '50%', marginLeft: -4 } },
    { pos: 'sw', cursor: 'sw-resize', style: { bottom: -4, left: -4 } },
    { pos: 'w', cursor: 'w-resize', style: { top: '50%', left: -4, marginTop: -4 } },
  ];

  return (
    <>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          outline: '2px solid #2196F3',
          outlineOffset: -1,
          borderRadius: 'inherit',
        }}
      />
      {handles.map((h) => (
        <div
          key={h.pos}
          data-resize-handle={h.pos}
          className="absolute w-2 h-2 rounded-full"
          style={{
            ...h.style,
            backgroundColor: '#2196F3',
            border: '1px solid #ffffff',
            cursor: h.cursor,
            zIndex: 999,
          }}
          onMouseDown={(e) => onResizeStart(e, h.pos)}
        />
      ))}
    </>
  );
}
