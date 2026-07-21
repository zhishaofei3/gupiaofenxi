/**
 * 顶部栏：Logo + 搜索 + 功能按钮（紧凑排列）
 * 接口切换 · 9日下跌 · 量化分析
 */

import { Search, TrendingDown, X, Activity, Database, ListChecks } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useStockStore } from "@/store/stockStore";
import StockPoolPanel from "@/components/StockPoolPanel";

export default function Header() {
  const navigate = useNavigate();
  const {
    keyword,
    setKeyword,
    loadStockList,
    apiSource,
    changeApiSource,
  } = useStockStore();

  const [input, setInput] = useState(keyword);
  const inputRef = useRef<HTMLInputElement>(null);
  const [poolOpen, setPoolOpen] = useState(false);

  useEffect(() => {
    setInput(keyword);
  }, [keyword]);

  const handleSearch = useCallback(() => {
    setKeyword(input.trim());
    loadStockList(true);
  }, [input, setKeyword, loadStockList]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleClear = () => {
    setInput("");
    setKeyword("");
    loadStockList(true);
  };

  // 全局键盘监听：在主界面任意位置按数字/字母键自动聚焦搜索框
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable;

      // 已在搜索框中：Escape 失焦
      if (document.activeElement === inputRef.current) {
        if (e.key === "Escape") inputRef.current?.blur();
        return;
      }

      // 已在其他输入控件中：不拦截
      if (isEditable) return;

      // Cmd/Ctrl+V：聚焦搜索框，让粘贴事件落到输入框
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
        inputRef.current?.focus();
        return;
      }

      // 其他组合键（Cmd+R 等）不拦截
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // 数字或字母：聚焦搜索框，字符由浏览器自然插入
      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        inputRef.current?.focus();
      }
    };

    const onGlobalPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (isEditable) return;

      // 在非输入区域粘贴：填入搜索框并立即搜索
      const text = e.clipboardData?.getData("text") || "";
      if (text) {
        e.preventDefault();
        const trimmed = text.trim();
        inputRef.current?.focus();
        setInput(trimmed);
        setKeyword(trimmed);
        loadStockList(true);
      }
    };

    document.addEventListener("keydown", onGlobalKeyDown);
    document.addEventListener("paste", onGlobalPaste);
    return () => {
      document.removeEventListener("keydown", onGlobalKeyDown);
      document.removeEventListener("paste", onGlobalPaste);
    };
  }, [setKeyword, loadStockList]);

  return (
    <header className="flex h-14 items-center justify-between border-b border-base-500 bg-base-900 px-4">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-gradient-to-br from-accent-gold to-accent-amber shadow-glow">
          <Activity className="h-5 w-5 text-base-900" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-mono text-lg font-bold tracking-tight text-text-primary">
            股析
          </span>
          <span className="text-[10px] text-text-muted">A股看盘</span>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="relative mx-6 flex-1 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入股票代码或名称（支持直接键盘输入或粘贴）"
          className="h-9 w-full rounded border border-base-500 bg-base-800 pl-9 pr-9 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-gold focus:outline-none focus:ring-1 focus:ring-accent-gold/40 transition"
        />
        {input && (
          <button
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text-primary"
            aria-label="清除"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 右侧操作区：紧凑功能按钮 */}
      <div className="flex items-center gap-1.5">
        {/* 数据源切换 */}
        <div className="flex items-center gap-1 rounded border border-base-500 bg-base-800 px-2 py-1">
          <Database className="h-3 w-3 text-text-muted" />
          <select
            value={apiSource}
            onChange={(e) => changeApiSource(e.target.value as "sina" | "tencent")}
            className="bg-transparent text-xs text-text-primary focus:outline-none cursor-pointer"
            title="切换数据源"
          >
            <option value="tencent" className="bg-base-800">腾讯</option>
            <option value="sina" className="bg-base-800">新浪</option>
          </select>
        </div>

        {/* 股票池管理 */}
        <button
          onClick={() => setPoolOpen(true)}
          className="flex items-center gap-1 rounded border border-base-500 bg-base-800 px-2.5 py-1 text-xs font-medium text-text-secondary transition hover:text-accent-gold hover:border-accent-gold/50"
          title="管理量化分析股票池"
        >
          <ListChecks className="h-3 w-3" />
          股票池
        </button>

        {/* 9日下跌 */}
        <button
          onClick={() => navigate("/decline")}
          className="flex items-center gap-1 rounded border border-accent-gold/50 bg-accent-gold/15 px-2.5 py-1 text-xs font-medium text-accent-gold transition hover:bg-accent-gold/25"
          title="连续9日下跌筛选"
        >
          <TrendingDown className="h-3 w-3" />
          9日下跌
        </button>

        {/* 量化分析 */}
        <button
          onClick={() => navigate("/quant")}
          className="flex items-center gap-1 rounded border border-accent-gold/50 bg-accent-gold/15 px-2.5 py-1 text-xs font-medium text-accent-gold transition hover:bg-accent-gold/25"
          title="量化交易分析"
        >
          <Activity className="h-3 w-3" />
          量化分析
        </button>
      </div>

      {/* 股票池管理面板 */}
      <StockPoolPanel open={poolOpen} onClose={() => setPoolOpen(false)} />
    </header>
  );
}
