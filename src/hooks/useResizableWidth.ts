/**
 * 可拖拽面板宽度 Hook
 * 管理左侧面板宽度（像素），持久化到 localStorage
 */

import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "gupiaofenxi.panelWidth";

function getInitialWidth(defaultWidth: number): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const w = parseInt(stored, 10);
      if (!isNaN(w) && w >= 200 && w <= 800) return w;
    }
  } catch {
    // localStorage 不可用
  }
  return defaultWidth;
}

export function useResizableWidth(defaultWidth: number) {
  const [width, setWidth] = useState(() => getInitialWidth(defaultWidth));
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return;
    const delta = e.clientX - startXRef.current;
    const newWidth = startWidthRef.current + delta;
    // 限制范围
    const clamped = Math.max(250, Math.min(800, newWidth));
    setWidth(clamped);
  }, []);

  const onMouseUp = useCallback(() => {
    if (draggingRef.current) {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // 保存到 localStorage
      setWidth((w) => {
        try {
          localStorage.setItem(STORAGE_KEY, String(w));
        } catch {
          // localStorage 不可用
        }
        return w;
      });
    }
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  return { width, onDragStart };
}
