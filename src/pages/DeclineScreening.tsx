/**
 * 连续9日下跌独立页面
 * 展示筛选进度、结果列表、往期入选清单
 * 点击股票在页面内展示K线图+分时图，ESC关闭
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  TrendingDown,
  Loader2,
  RefreshCw,
  History,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  fetchScreeningStatus,
  fetchRealtimeQuote,
  saveDeclineHistory,
  fetchDeclineHistory,
  type HistoryStock,
  type HistoryRecord,
} from "@/api/stockApi";
import { useStockStore } from "@/store/stockStore";
import type { ScreeningItem, StockItem } from "../../shared/types";
import KlineChart from "@/components/KlineChart";
import RealtimeChart from "@/components/RealtimeChart";
import Splitter from "@/components/Splitter";
import { useResizableWidth } from "@/hooks/useResizableWidth";

export default function DeclineScreening() {
  const navigate = useNavigate();
  const { screeningTaskStatus, screeningProgress, screeningScanned, screeningTotal,
    screeningMatched, screeningResults, startScreeningTask, selectStock: storeSelectStock,
    selectedStock } = useStockStore();

  const [localResults, setLocalResults] = useState<ScreeningItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [currentPrices, setCurrentPrices] = useState<Record<string, { price: number; change: number; changePct: number }>>({});

  // 页面内详情视图是否打开
  const [detailOpen, setDetailOpen] = useState(false);
  const { width, onDragStart } = useResizableWidth(420);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef(false);
  const autoStartedRef = useRef(false);

  // 轮询筛选状态
  const pollStatus = useCallback(async () => {
    try {
      const resp = await fetchScreeningStatus();
      const d = resp.data;
      useStockStore.setState({
        screeningTaskStatus: d.status,
        screeningProgress: d.progress,
        screeningScanned: d.scannedCount,
        screeningTotal: d.totalCount,
        screeningMatched: d.matchedCount,
        screeningResults: d.results,
      });
      setLocalResults(d.results);

      // 筛选完成时自动保存历史记录
      if (d.status === "done" && !savedRef.current && d.results.length > 0) {
        savedRef.current = true;
        const stocks: HistoryStock[] = d.results.map((r: ScreeningItem) => ({
          code: r.code,
          name: r.name,
          market: r.market,
          price: r.price,
        }));
        saveDeclineHistory(stocks).catch(() => {});
      }

      if (d.status === "running" || d.status === "pending") {
        pollTimer.current = setTimeout(pollStatus, 2000);
      }
    } catch {
      pollTimer.current = setTimeout(pollStatus, 3000);
    }
  }, []);

  // 页面加载时：检查状态，如果没扫描过则自动启动
  useEffect(() => {
    const init = async () => {
      try {
        const resp = await fetchScreeningStatus();
        const d = resp.data;
        useStockStore.setState({
          screeningTaskStatus: d.status,
          screeningProgress: d.progress,
          screeningScanned: d.scannedCount,
          screeningTotal: d.totalCount,
          screeningMatched: d.matchedCount,
          screeningResults: d.results,
        });
        setLocalResults(d.results);

        // 如果从未启动过或已失败，自动启动扫描
        if ((d.status === "pending" || d.status === "failed") && !autoStartedRef.current) {
          autoStartedRef.current = true;
          await startScreeningTask();
        }

        // 开始轮询
        if (d.status === "running" || d.status === "pending") {
          pollTimer.current = setTimeout(pollStatus, 2000);
        }
      } catch {
        // 获取状态失败，尝试自动启动
        if (!autoStartedRef.current) {
          autoStartedRef.current = true;
          await startScreeningTask();
          pollTimer.current = setTimeout(pollStatus, 2000);
        }
      }
    };
    init();

    return () => {
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [pollStatus, startScreeningTask]);

  // ESC 键关闭详情视图
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && detailOpen) {
        setDetailOpen(false);
        useStockStore.setState({ selectedStock: null });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailOpen]);

  // 重新扫描
  const handleStart = async () => {
    setLoading(true);
    savedRef.current = false;
    setDetailOpen(false);
    useStockStore.setState({ selectedStock: null });
    await startScreeningTask();
    setLoading(false);
    pollStatus();
  };

  // 点击股票 → 在页面内展示详情
  const handleSelectStock = (item: ScreeningItem) => {
    const stock: StockItem = {
      code: item.code,
      name: item.name,
      market: item.market,
      price: item.price,
      changePercent: item.changePercent,
      changeAmount: item.changeAmount,
      volume: item.volume,
      amount: item.amount,
    };
    storeSelectStock(stock);
    setDetailOpen(true);
  };

  // 关闭详情
  const closeDetail = () => {
    setDetailOpen(false);
    useStockStore.setState({ selectedStock: null });
  };

  // 往期入选
  const handleShowHistory = useCallback(async () => {
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const resp = await fetchDeclineHistory();
      setHistoryRecords(resp.data);

      const allStocks = resp.data.flatMap((r: HistoryRecord) => r.stocks);
      const uniqueStocks = Array.from(new Map(allStocks.map((s: HistoryStock) => [s.code, s])).values());
      const priceMap: Record<string, { price: number; change: number; changePct: number }> = {};
      await Promise.all(
        uniqueStocks.map(async (s: HistoryStock) => {
          try {
            const rt = await fetchRealtimeQuote(s.code, s.market);
            priceMap[s.code] = {
              price: rt.data.price,
              change: rt.data.changeAmount,
              changePct: rt.data.changePercent,
            };
          } catch {
            // 静默失败
          }
        })
      );
      setCurrentPrices(priceMap);
    } catch {
      // 静默失败
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const displayTotal = screeningTotal > 0 ? screeningTotal : 5536;
  const isRunning = screeningTaskStatus === "running";
  const isDone = screeningTaskStatus === "done";
  const isPending = screeningTaskStatus === "pending";
  const isFailed = screeningTaskStatus === "failed";

  return (
    <div className="flex h-screen flex-col bg-base-900">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between border-b border-base-500 bg-base-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="rounded p-1.5 text-text-muted hover:bg-base-600 hover:text-text-primary"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-text-primary">
              <TrendingDown className="h-5 w-5 text-rise-bright" />
              连续9日下跌
            </h1>
            <p className="text-xs text-text-muted">扫描全部A股，筛选连续9个交易日收盘价下跌的股票</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* 往期入选 */}
          <button
            onClick={handleShowHistory}
            className="flex items-center gap-1.5 rounded border border-accent-gold/30 bg-accent-gold/10 px-3 py-1.5 text-xs font-medium text-accent-gold transition hover:bg-accent-gold/20"
            title="查看往期入选记录"
          >
            <History className="h-3.5 w-3.5" />
            往期入选
          </button>
          {/* 刷新 */}
          <button
            onClick={handleStart}
            disabled={isRunning || loading}
            className="flex items-center gap-1.5 rounded bg-accent-gold/20 px-3 py-1.5 text-xs font-medium text-accent-gold transition hover:bg-accent-gold/30 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
            重新扫描
          </button>
        </div>
      </div>

      {/* 主体内容区 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：列表/进度 */}
        <div
          className="flex flex-col overflow-hidden"
          style={detailOpen && selectedStock ? { width } : { flex: 1 }}
        >
          {/* 进度区域 */}
          {(isRunning || isPending) && (
            <div className="flex flex-1 flex-col items-center justify-center py-16">
              <Loader2 className="mb-4 h-10 w-10 animate-spin text-accent-gold" />
              <div className="text-sm text-text-primary">
                {isPending ? "等待启动..." : `正在扫描 ${screeningScanned}/${displayTotal}`}
              </div>
              <div className="mt-2 text-xs text-text-muted">
                已找到 {screeningMatched} 只连续9日下跌股票 · {screeningProgress}%
              </div>
              <div className="mt-4 h-2 w-96 overflow-hidden rounded-full bg-base-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-gold to-accent-amber transition-all duration-500"
                  style={{ width: `${screeningProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* 失败提示 */}
          {isFailed && (
            <div className="flex flex-1 flex-col items-center justify-center py-16">
              <AlertCircle className="mb-4 h-10 w-10 text-rise/50" />
              <div className="text-sm text-text-primary">扫描失败</div>
              <button
                onClick={handleStart}
                className="mt-4 rounded bg-accent-gold/20 px-4 py-2 text-xs font-medium text-accent-gold hover:bg-accent-gold/30"
              >
                点击重试
              </button>
            </div>
          )}

          {/* 结果列表 */}
          {isDone && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="border-b border-base-600 bg-base-800 px-4 py-2 flex items-center justify-between">
                <span className="text-xs text-text-muted">
                  共找到 <span className="font-bold text-rise-bright">{localResults.length}</span> 只连续9日下跌股票
                </span>
                {detailOpen && selectedStock && (
                  <span className="text-[10px] text-accent-gold">ESC 关闭详情</span>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                {localResults.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-text-muted">
                    <CheckCircle2 className="mb-3 h-10 w-10 text-fall-bright" />
                    <span className="text-sm">当前没有连续9日下跌的股票</span>
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-base-800 text-text-muted">
                      <tr className="border-b border-base-600">
                        <th className="px-3 py-2 text-left font-medium">代码/名称</th>
                        <th className="px-3 py-2 text-right font-medium">现价</th>
                        <th className="px-3 py-2 text-right font-medium">涨跌幅</th>
                        <th className="px-3 py-2 text-center font-medium">连续下跌</th>
                      </tr>
                    </thead>
                    <tbody>
                      {localResults.map((item) => (
                        <tr
                          key={item.code}
                          className={`cursor-pointer border-b border-base-700/50 transition hover:bg-base-700/30 ${
                            selectedStock?.code === item.code ? "bg-accent-gold/10" : ""
                          }`}
                          onClick={() => handleSelectStock(item)}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1 font-mono-num text-accent-gold">
                              {item.market.toUpperCase()}{item.code}
                            </div>
                            <div className="text-text-primary">{item.name}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono-num text-text-primary">
                            {item.price.toFixed(2)}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono-num ${
                            item.changePercent >= 0 ? "text-rise-bright" : "text-fall-bright"
                          }`}>
                            {item.changePercent >= 0 ? "+" : ""}{item.changePercent.toFixed(2)}%
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-flex items-center gap-0.5 rounded bg-rise/15 px-1.5 py-0.5 text-[10px] font-bold text-rise-bright">
                              {item.consecutiveFallDays}天
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 可拖拽分隔线 */}
        {detailOpen && selectedStock && <Splitter onDragStart={onDragStart} />}

        {/* 右侧：K线图 + 分时图（选中股票时显示） */}
        {detailOpen && selectedStock && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* 股票信息头 */}
            <div className="flex items-center justify-between border-b border-base-600 bg-base-800 px-4 py-2">
              <div className="flex items-center gap-3">
                <span className="font-mono-num text-sm font-bold text-text-primary">
                  {selectedStock.market.toUpperCase()}{selectedStock.code}
                </span>
                <span className="text-sm text-text-secondary">{selectedStock.name}</span>
                <span className={`font-mono-num text-sm font-bold ${
                  selectedStock.changePercent >= 0 ? "text-rise-bright" : "text-fall-bright"
                }`}>
                  {selectedStock.price.toFixed(2)}
                  <span className="ml-1 text-xs">
                    {selectedStock.changePercent >= 0 ? "+" : ""}{selectedStock.changePercent.toFixed(2)}%
                  </span>
                </span>
              </div>
              <button
                onClick={closeDetail}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted transition hover:bg-base-600 hover:text-text-primary"
                title="关闭详情 (ESC)"
              >
                <X className="h-3.5 w-3.5" />
                关闭
              </button>
            </div>
            {/* K线图 */}
            <div className="flex-[7] overflow-hidden border-b border-base-500">
              <KlineChart key={selectedStock.code} />
            </div>
            {/* 分时图 */}
            <div className="flex-[3] overflow-hidden bg-base-800">
              <RealtimeChart key={selectedStock.code} />
            </div>
          </div>
        )}
      </div>

      {/* 底部说明 */}
      <div className="border-t border-base-500 bg-base-800 px-4 py-2 text-[10px] text-text-muted">
        <span>判定规则：连续9个交易日收盘价低于前一日收盘价 · 沪深主板/创业板/科创板全覆盖</span>
      </div>

      {/* 往期入选侧边面板 */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setShowHistory(false)}>
          <div
            className="flex h-full w-[480px] flex-col border-l border-base-500 bg-base-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-base-500 px-4 py-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-accent-gold" />
                <span className="text-sm font-semibold text-text-primary">往期9日下跌清单</span>
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="rounded p-1 text-text-muted hover:bg-base-600 hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto">
              {historyLoading ? (
                <div className="flex h-full items-center justify-center text-text-muted">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  <span className="text-sm">加载中...</span>
                </div>
              ) : historyRecords.length === 0 ? (
                <div className="flex h-full items-center justify-center text-text-muted">
                  <span className="text-sm">暂无历史记录</span>
                </div>
              ) : (
                <div className="space-y-3 p-3">
                  {historyRecords.map((record) => (
                    <div key={record.date} className="rounded border border-base-600 bg-base-800">
                      <div className="flex items-center justify-between border-b border-base-600 px-3 py-2">
                        <span className="text-xs font-semibold text-accent-gold">{record.date}</span>
                        <span className="text-[10px] text-text-muted">{record.stocks.length} 只</span>
                      </div>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-text-muted">
                            <th className="px-2 py-1 text-left font-medium">代码/名称</th>
                            <th className="px-2 py-1 text-right font-medium">入选价</th>
                            <th className="px-2 py-1 text-right font-medium">现价</th>
                            <th className="px-2 py-1 text-right font-medium">涨跌</th>
                            <th className="px-2 py-1 text-center font-medium">天数</th>
                          </tr>
                        </thead>
                        <tbody>
                          {record.stocks.map((stock) => {
                            const cp = currentPrices[stock.code];
                            const change = cp ? cp.price - stock.price : 0;
                            const changePct = stock.price > 0 ? (change / stock.price) * 100 : 0;
                            const isUp = change >= 0;
                            const selectedDays = historyRecords.filter(
                              (r) => r.stocks.some((s) => s.code === stock.code)
                            ).length;
                            return (
                              <tr
                                key={stock.code}
                                className="cursor-pointer border-t border-base-700/50 hover:bg-base-700/30"
                                onClick={() => {
                                  setShowHistory(false);
                                  const si: StockItem = {
                                    code: stock.code,
                                    name: stock.name,
                                    market: stock.market,
                                    price: stock.price,
                                    changePercent: cp?.changePct ?? 0,
                                    changeAmount: cp?.change ?? 0,
                                    volume: 0,
                                    amount: 0,
                                  };
                                  storeSelectStock(si);
                                  setDetailOpen(true);
                                }}
                              >
                                <td className="px-2 py-1.5">
                                  <div className="font-mono-num text-text-secondary">{stock.market.toUpperCase()}{stock.code}</div>
                                  <div className="text-text-primary">{stock.name}</div>
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono-num text-text-muted">
                                  {stock.price.toFixed(2)}
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono-num text-text-primary">
                                  {cp ? cp.price.toFixed(2) : "-"}
                                </td>
                                <td className={`px-2 py-1.5 text-right font-mono-num ${isUp ? "text-rise-bright" : "text-fall-bright"}`}>
                                  {cp ? `${isUp ? "+" : ""}${change.toFixed(2)}` : "-"}
                                  <span className="text-[10px]">
                                    {cp ? ` (${isUp ? "+" : ""}${changePct.toFixed(1)}%)` : ""}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                  <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                    selectedDays >= 3 ? "bg-accent-gold/20 text-accent-gold" : "bg-base-600 text-text-muted"
                                  }`}>
                                    {selectedDays}天
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
