/**
 * 左侧股票列表
 */

import { useEffect, useRef } from "react";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { useStockStore } from "@/store/stockStore";
import {
  formatPrice,
  formatPercent,
  changeColor,
} from "@/utils/format";
import type { StockItem, ScreeningItem } from "../../shared/types";

export default function StockList() {
  const {
    stockList,
    listLoading,
    listTotal,
    page,
    pageSize,
    selectedStock,
    screeningMode,
    screeningResults,
    selectStock,
    setPage,
  } = useStockStore();

  const listRef = useRef<HTMLDivElement>(null);

  // 选中后滚动到顶部
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [page, screeningMode]);

  const displayList: (StockItem | ScreeningItem)[] = screeningMode
    ? screeningResults
    : stockList;

  // 筛选模式下数据已缓存，不需要loading
  const isLoading = screeningMode ? false : listLoading;

  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));

  return (
    <div className="flex h-full flex-col bg-base-800">
      {/* 表头 */}
      <div className="grid grid-cols-[1fr_90px_90px_70px] gap-2 border-b border-base-500 px-3 py-2 text-xs font-medium text-text-secondary">
        <span>名称/代码</span>
        <span className="text-right">最新价</span>
        <span className="text-right">涨跌幅</span>
        {screeningMode ? (
          <span className="text-center">连跌</span>
        ) : (
          <span className="text-center">市场</span>
        )}
      </div>

      {/* 列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载中...
          </div>
        ) : displayList.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-text-muted">
            {screeningMode ? "暂无连续9天下跌的股票" : "暂无数据"}
          </div>
        ) : (
          displayList.map((stock) => {
            const isSelected =
              selectedStock?.code === stock.code;
            const item = stock as ScreeningItem;
            return (
              <button
                key={`${stock.market}-${stock.code}`}
                onClick={() => selectStock(stock)}
                className={`grid w-full grid-cols-[1fr_90px_90px_70px] items-center gap-2 border-b border-base-800/60 px-3 py-2 text-left transition hover:bg-base-600/60 ${
                  isSelected ? "row-selected" : ""
                }`}
              >
                {/* 名称/代码 */}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text-primary">
                    {stock.name}
                  </div>
                  <div className="font-mono-num text-xs text-text-muted">
                    {stock.code}
                  </div>
                </div>

                {/* 最新价 */}
                <div
                  className={`text-right font-mono-num text-sm ${changeColor(
                    stock.changeAmount
                  )}`}
                >
                  {formatPrice(stock.price)}
                </div>

                {/* 涨跌幅 */}
                <div
                  className={`text-right font-mono-num text-sm ${changeColor(
                    stock.changePercent
                  )}`}
                >
                  {formatPercent(stock.changePercent)}
                </div>

                {/* 连跌天数 / 市场 */}
                <div className="text-center">
                  {screeningMode ? (
                    <span className="inline-flex min-w-[28px] justify-center rounded bg-rise/15 px-1.5 py-0.5 font-mono-num text-xs font-bold text-rise-bright">
                      {item.consecutiveFallDays}
                    </span>
                  ) : (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        stock.market === "sh"
                          ? "bg-base-600 text-text-secondary"
                          : "bg-base-600 text-text-secondary"
                      }`}
                    >
                      {stock.market === "sh" ? "沪" : "深"}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* 分页 - 仅普通列表模式显示 */}
      {!screeningMode && (
        <div className="flex items-center justify-between border-t border-base-500 px-3 py-2 text-xs text-text-secondary">
          <span>
            共 <span className="font-mono-num text-text-primary">{listTotal}</span> 只
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded p-1 hover:bg-base-600 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-mono-num">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="rounded p-1 hover:bg-base-600 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* 筛选模式统计 */}
      {screeningMode && (
        <div className="border-t border-base-500 px-3 py-2 text-xs text-text-secondary">
          筛选出{" "}
          <span className="font-mono-num text-rise-bright">
            {screeningResults.length}
          </span>{" "}
          只连续9天下跌股票
        </div>
      )}
    </div>
  );
}
