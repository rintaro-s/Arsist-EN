import React, { useState, useRef, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { UIElement } from '../../../shared/types';
import { useDataValue } from '../../stores/dataStoreContext';
import { 
  Type, 
  Square, 
  Image, 
  ToggleLeft, 
  TextCursor,
  MousePointer
} from 'lucide-react';

export function UICanvas() {
  const { 
    project, 
    projectPath,
    currentUILayoutId, 
    selectedUIElementId, 
    selectUIElement,
    updateUIElement,
    addUIElement 
  } = useProjectStore();
  
  const currentLayout = project?.uiLayouts.find(l => l.id === currentUILayoutId);
  const presentationMode = project?.arSettings?.presentationMode || 'world_anchored';
  const floating = project?.arSettings?.floatingScreen;
  const layoutScope = currentLayout?.scope || 'uhd';
  const modeLabel = presentationMode === 'head_locked_hud'
    ? 'Head-Locked HUD'
    : presentationMode === 'floating_screen'
      ? 'Floating Screen'
      : 'World Anchored UI';
  const canvasSize = layoutScope === 'surface'
    ? { width: 1024, height: 1024 }
    : { width: 1920, height: 1080 };
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.1, Math.min(2, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (e.target === canvasRef.current) {
      selectUIElement(null);
    }
  }, [selectUIElement]);

  // Add element for toolbar
  const handleAddElement = (type: UIElement['type']) => {
    addUIElement(selectedUIElementId, { type });
  };

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* UI Toolbar */}
      <div className="h-10 bg-arsist-surface border-b border-arsist-border flex items-center px-4 gap-2">
        <span className="text-xs text-arsist-muted mr-2">Add element:</span>
        <ToolButton icon={<Square size={16} />} label="Panel" onClick={() => handleAddElement('Panel')} />
        <ToolButton icon={<Type size={16} />} label="Text" onClick={() => handleAddElement('Text')} />
        <ToolButton icon={<MousePointer size={16} />} label="Button" onClick={() => handleAddElement('Button')} />
        <ToolButton icon={<Image size={16} />} label="Image" onClick={() => handleAddElement('Image')} />
        <ToolButton icon={<TextCursor size={16} />} label="Input" onClick={() => handleAddElement('Input')} />
        <ToolButton icon={<ToggleLeft size={16} />} label="Slider" onClick={() => handleAddElement('Slider')} />
        
        <div className="ml-auto flex items-center gap-2 text-xs text-arsist-muted">
          <span>Zoom: {Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {/* Canvas Area */}
      <div 
        ref={canvasRef}
        className="flex-1 overflow-hidden bg-arsist-bg viewport-grid cursor-default"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleCanvasClick}
      >
        <div 
          className="w-full h-full flex items-center justify-center"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          {/* UHD / Surface Canvas */}
          <div 
            className="relative bg-black rounded-lg shadow-2xl overflow-hidden"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            {/* Device frame */}
            <div className="absolute inset-0 border-2 border-arsist-border rounded-lg pointer-events-none z-10" />
            
            {/* Resolution label */}
            <div className="absolute top-2 left-2 text-xs text-arsist-muted bg-arsist-bg/80 px-2 py-1 rounded z-10">
              {canvasSize.width} × {canvasSize.height} ({layoutScope === 'surface' ? 'Dynamic Surface' : 'UHD'}) · {modeLabel}
              {presentationMode === 'floating_screen' && floating && (
                <span> · {floating.width}m × {floating.height}m / {floating.distance}m</span>
              )}
            </div>

            {/* UI Content */}
            {currentLayout && (
                <UIElementRenderer
                  element={currentLayout.root}
                  selectedId={selectedUIElementId}
                  onSelect={selectUIElement}
                  onUpdate={updateUIElement}
                  projectPath={projectPath || undefined}
                />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function ToolButton({ icon, label, onClick }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded hover:bg-arsist-hover text-xs text-arsist-muted hover:text-arsist-text transition-colors"
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface UIElementRendererProps {
  element: UIElement;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<UIElement>) => void;
  projectPath?: string;
  depth?: number;
}

export function UIElementRenderer({ 
  element, 
  selectedId, 
  onSelect, 
  onUpdate,
  projectPath,
  depth = 0 
}: UIElementRendererProps) {
  const isSelected = element.id === selectedId;
  const boundValue = useDataValue(element.bind?.key || '');
  
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
  
  const getDisplayContent = (originalContent: string | undefined): string => {
    if (element.bind?.key && boundValue !== undefined && boundValue !== null) {
      let text = String(boundValue);
      if (element.bind.format) {
        text = element.bind.format.replace('{value}', text);
      }
      return text;
    }
    return originalContent || '';
  };

  const getContainerStyle = (): React.CSSProperties => {
    const style: React.CSSProperties = {
      position: element.style.anchor ? 'absolute' : 'relative',
      backgroundColor: element.style.backgroundColor || 'transparent',
      borderRadius: element.style.borderRadius || 0,
      padding: element.style.padding 
        ? `${element.style.padding.top}px ${element.style.padding.right}px ${element.style.padding.bottom}px ${element.style.padding.left}px`
        : undefined,
      margin: element.style.margin
        ? `${element.style.margin.top}px ${element.style.margin.right}px ${element.style.margin.bottom}px ${element.style.margin.left}px`
        : undefined,
      width: element.style.width,
      height: element.style.height,
      opacity: element.style.opacity ?? 1,
      display: 'flex',
      flexDirection: element.layout === 'FlexRow' ? 'row' : 'column',
      justifyContent: element.style.justifyContent || 'flex-start',
      alignItems: element.style.alignItems || 'stretch',
      gap: element.style.gap || 0,
      outline: isSelected ? '2px solid #4ec9b0' : undefined,
      outlineOffset: 2,
      cursor: 'pointer',
      transition: 'outline 0.15s',
    };

    // Blur effect (Glassmorphism)
    if (element.style.blur) {
      style.backdropFilter = `blur(${element.style.blur}px)`;
      style.WebkitBackdropFilter = `blur(${element.style.blur}px)`;
    }

    // Shadow
    if (element.style.shadow) {
      style.boxShadow = `${element.style.shadow.offsetX}px ${element.style.shadow.offsetY}px ${element.style.shadow.blur}px ${element.style.shadow.color}`;
    }

    // Absolute positioning
    if (element.style.top !== undefined) style.top = element.style.top;
    if (element.style.right !== undefined) style.right = element.style.right;
    if (element.style.bottom !== undefined) style.bottom = element.style.bottom;
    if (element.style.left !== undefined) style.left = element.style.left;

    return style;
  };

  const getTextStyle = (): React.CSSProperties => ({
    color: element.style.color || '#FFFFFF',
    fontSize: element.style.fontSize || 16,
    fontWeight: element.style.fontWeight || 'normal',
    textAlign: element.style.textAlign || 'left',
  });

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(element.id);
  };

  const renderContent = () => {
    switch (element.type) {
      case 'Text':
        return (
          <span style={getTextStyle()}>
            {getDisplayContent(element.content)}
          </span>
        );
      
      case 'Button':
        return (
          <div 
            className="px-4 py-2 bg-arsist-accent rounded hover:bg-arsist-accent/80 transition-colors"
            style={{ fontSize: element.style.fontSize || 14 }}
          >
            {getDisplayContent(element.content)}
          </div>
        );
      
      case 'Image':
        if (element.assetPath && projectPath) {
          const url = toArsistFileUrl(projectPath, element.assetPath);
          return (
            <img src={url} className="w-full h-full object-contain" />
          );
        }
        return (
          <div className="w-full h-full bg-arsist-primary/30 flex items-center justify-center">
            <Image size={32} className="text-arsist-muted" />
          </div>
        );
      
      case 'Input':
        return (
          <input
            type="text"
            placeholder="Input field"
            className="w-full px-3 py-2 bg-arsist-bg/50 border border-arsist-primary/50 rounded text-white"
            style={{ fontSize: element.style.fontSize || 14 }}
            readOnly
          />
        );
      
      case 'Slider':
        return (
          <input
            type="range"
            className="w-full"
            disabled
          />
        );
      
      default:
        return null;
    }
  };

  if (element.type === 'Panel') {
    return (
      <div style={getContainerStyle()} onClick={handleClick}>
        {element.children?.map(child => (
          <UIElementRenderer
            key={child.id}
            element={child}
            selectedId={selectedId}
            onSelect={onSelect}
            onUpdate={onUpdate}
            projectPath={projectPath}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={getContainerStyle()} onClick={handleClick}>
      {renderContent()}
    </div>
  );
}
