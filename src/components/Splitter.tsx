/**
 * 可拖拽分隔线组件
 * 渲染一条竖线，鼠标按住可拖拽改变左侧面板宽度
 */

interface SplitterProps {
  onDragStart: (e: React.MouseEvent) => void;
}

export default function Splitter({ onDragStart }: SplitterProps) {
  return (
    <div
      onMouseDown={onDragStart}
      className="group relative w-1 shrink-0 cursor-col-resize bg-base-500 transition-colors hover:bg-accent-gold/50"
      title="拖拽调整宽度"
    >
      {/* 拖拽手柄（更宽的命中区域） */}
      <div className="absolute inset-y-0 -left-1 -right-1" />
      {/* 中间圆点指示器 */}
      <div className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-base-400 group-hover:bg-accent-gold transition-colors" />
    </div>
  );
}
