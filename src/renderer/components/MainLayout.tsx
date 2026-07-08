import React, { useRef, useCallback, useEffect } from 'react';
import { LeftPanel } from './panels/LeftPanel';
import { RightPanel } from './panels/RightPanel';
import { BottomPanel } from './panels/BottomPanel';
import { Toolbar } from './Toolbar';
import { ViewportContainer } from './viewport/ViewportContainer';
import { useUIStore } from '../stores/uiStore';

export function MainLayout() {
  const { 
    leftPanelWidth, 
    rightPanelWidth, 
    bottomPanelHeight,
    setLeftPanelWidth,
    setRightPanelWidth,
    setBottomPanelHeight
  } = useUIStore();

  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);
  const isDraggingBottom = useRef(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loadLayout = async () => {
      if (!window.electronAPI) return;
      const layoutSettings = await window.electronAPI.store.get('layoutSettings');
      if (layoutSettings) {
        if (layoutSettings.leftPanelWidth) setLeftPanelWidth(layoutSettings.leftPanelWidth);
        if (layoutSettings.rightPanelWidth) setRightPanelWidth(layoutSettings.rightPanelWidth);
        if (layoutSettings.bottomPanelHeight) setBottomPanelHeight(layoutSettings.bottomPanelHeight);
      }
    };
    loadLayout();
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      window.electronAPI.store.set('layoutSettings', {
        leftPanelWidth,
        rightPanelWidth,
        bottomPanelHeight,
      });
    }, 300);
  }, [leftPanelWidth, rightPanelWidth, bottomPanelHeight]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDraggingLeft.current) {
      setLeftPanelWidth(e.clientX);
    }
    if (isDraggingRight.current) {
      setRightPanelWidth(window.innerWidth - e.clientX);
    }
    if (isDraggingBottom.current) {
      setBottomPanelHeight(window.innerHeight - e.clientY - 40); // 40 = titlebar height
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isDraggingLeft.current = false;
    isDraggingRight.current = false;
    isDraggingBottom.current = false;
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
  }, []);

  return (
    <div 
      className="flex-1 flex flex-col overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Toolbar */}
      <Toolbar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        <div style={{ width: leftPanelWidth }} className="flex-shrink-0 bg-arsist-surface">
          <LeftPanel />
        </div>

        {/* Left Resize Handle */}
        <div
          className="w-px cursor-col-resize hover:bg-arsist-accent/40 transition-colors hairline"
          style={{ backgroundColor: 'rgb(var(--arsist-divider) / var(--arsist-divider-alpha))' }}
          onMouseDown={() => {
            isDraggingLeft.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />

        {/* Center Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Viewport */}
          <div 
            className="flex-1 overflow-hidden"
            style={{ height: `calc(100% - ${bottomPanelHeight}px - 4px)` }}
          >
            <ViewportContainer />
          </div>

          {/* Bottom Resize Handle */}
          <div
            className="h-px cursor-row-resize hover:bg-arsist-accent/40 transition-colors"
            style={{ backgroundColor: 'rgb(var(--arsist-divider) / var(--arsist-divider-alpha))' }}
            onMouseDown={() => {
              isDraggingBottom.current = true;
              document.body.style.cursor = 'row-resize';
              document.body.style.userSelect = 'none';
            }}
          />

          {/* Bottom Panel */}
          <div
            style={{ height: bottomPanelHeight }}
            className="flex-shrink-0 bg-arsist-surface hairline-t"
          >
            <BottomPanel />
          </div>
        </div>

        {/* Right Resize Handle */}
        <div
          className="w-px cursor-col-resize hover:bg-arsist-accent/40 transition-colors"
          style={{ backgroundColor: 'rgb(var(--arsist-divider) / var(--arsist-divider-alpha))' }}
          onMouseDown={() => {
            isDraggingRight.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />

        {/* Right Panel */}
        <div style={{ width: rightPanelWidth }} className="flex-shrink-0 bg-arsist-surface">
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
