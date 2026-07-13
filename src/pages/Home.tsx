/**
 * 主页：三栏式看盘布局
 * 顶部搜索栏 + 左侧股票列表 + 右侧K线图 + 实时股价图
 */

import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Header from "@/components/Header";
import StockList from "@/components/StockList";
import KlineChart from "@/components/KlineChart";
import RealtimeChart from "@/components/RealtimeChart";
import Splitter from "@/components/Splitter";
import { useResizableWidth } from "@/hooks/useResizableWidth";
import { useStockStore } from "@/store/stockStore";
import type { StockItem } from "../../shared/types";

export default function Home() {
  const [searchParams] = useSearchParams();
  const { loadStockList, error, clearError, selectedStock, loadApiSource, selectStock, stockList } = useStockStore();
  const { width, onDragStart } = useResizableWidth(480);

  // 初始化：加载股票列表 + 同步数据源设置
  useEffect(() => {
    loadStockList(true);
    loadApiSource();
  }, [loadStockList, loadApiSource]);

  // 从URL参数自动选股（从量化分析页面跳转过来时）
  useEffect(() => {
    const code = searchParams.get("code");
    const market = searchParams.get("market") as "sh" | "sz" | null;
    if (code && market) {
      // 如果还没有选中股票，或选中的不是这只，则选中
      if (selectedStock?.code !== code) {
        // 先检查当前列表是否有这只股票
        const found = stockList.find((s) => s.code === code);
        if (found) {
          selectStock(found);
        } else {
          // 列表中没有，构造一个StockItem
          const stock: StockItem = {
            code,
            name: searchParams.get("name") || code,
            market,
            price: 0,
            changePercent: 0,
            changeAmount: 0,
            volume: 0,
            amount: 0,
          };
          selectStock(stock);
        }
      }
    }
  }, [searchParams, stockList, selectedStock?.code, selectStock]);

  return (
    <div className="flex h-screen flex-col bg-base-900">
      {/* 顶部栏 */}
      <Header />

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center justify-between bg-rise/15 px-4 py-2 text-sm text-rise-bright">
          <span>{error}</span>
          <button
            onClick={clearError}
            className="rounded px-2 py-0.5 text-xs hover:bg-rise/20"
          >
            关闭
          </button>
        </div>
      )}

      {/* 主体三栏 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：股票列表 */}
        <aside className="overflow-hidden" style={{ width }}>
          <StockList />
        </aside>

        {/* 可拖拽分隔线 */}
        <Splitter onDragStart={onDragStart} />

        {/* 右侧：K线图（上）+ 实时股价图（下） */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* K线图占70% */}
          <div className="flex-[7] overflow-hidden border-b border-base-500">
            <KlineChart key={selectedStock?.code} />
          </div>
          {/* 实时股价图占30% */}
          <div className="flex-[3] overflow-hidden bg-base-800">
            <RealtimeChart key={selectedStock?.code} />
          </div>
        </main>
      </div>

      {/* 底部状态栏 */}
      <footer className="flex h-6 items-center justify-between border-t border-base-500 bg-base-900 px-4 text-[10px] text-text-muted">
        <span>数据来源：东方财富 · 仅供参考</span>
        <span>红涨绿跌 · 前复权</span>
      </footer>
    </div>
  );
}
