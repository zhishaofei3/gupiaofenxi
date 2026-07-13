/**
 * 顶部栏：Logo + 搜索 + 功能按钮（紧凑排列）
 * 接口切换 · 9日下跌 · 量化分析
 */

import { Search, TrendingDown, X, Activity, Database } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useStockStore } from "@/store/stockStore";

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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入股票代码或名称，如 600519 或 贵州茅台"
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
    </header>
  );
}
