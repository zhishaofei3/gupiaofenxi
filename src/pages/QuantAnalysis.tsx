/**
 * 量化交易分析页面
 * 严格按照 stock_requests.py 的选股逻辑：
 * - MA5支撑 + MACD金叉 + DIF上穿DEA + DIF零轴附近 + DIF>DEA
 * - 涨停检测(zt_ok)已计算展示但不参与最终判定（与Python一致）
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  RefreshCw,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Activity,
  Clock,
  Database,
  ExternalLink,
  History,
  X,
} from "lucide-react";
import { fetchQuantAnalysis, saveQuantHistory, fetchQuantHistory, fetchRealtimeQuote, type HistoryRecord, type HistoryStock } from "@/api/stockApi";
import { useStockStore } from "@/store/stockStore";
import type { QuantItem } from "../../shared/types";

const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5分钟

export default function QuantAnalysis() {
  const navigate = useNavigate();
  const { apiSource, changeApiSource } = useStockStore();
  const [results, setResults] = useState<QuantItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [scannedCount, setScannedCount] = useState(0);
  const [filterPassed, setFilterPassed] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [nextRefreshIn, setNextRefreshIn] = useState(AUTO_REFRESH_INTERVAL);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);

  // 往期入选
  const [showHistory, setShowHistory] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [currentPrices, setCurrentPrices] = useState<Record<string, { price: number; change: number; changePct: number }>>({});

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingRef = useRef(false);

  const loadAnalysis = useCallback(async (force?: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const resp = await fetchQuantAnalysis(force);
      setResults(resp.data.results);
      setDuration(resp.data.duration);
      setScannedCount(resp.data.scannedCount);
      setLastUpdateTime(new Date());

      // 保存今天入选的股票到历史记录
      const passedStocks: HistoryStock[] = resp.data.results
        .filter((r) => r.passed)
        .map((r) => ({
          code: r.code,
          name: r.name,
          market: r.market,
          price: r.price,
        }));
      if (passedStocks.length > 0) {
        saveQuantHistory(passedStocks).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, []);

  // 切换数据源后强制刷新
  const handleSourceChange = useCallback(async (source: "sina" | "tencent") => {
    await changeApiSource(source);
    loadAnalysis(true);
  }, [changeApiSource, loadAnalysis]);

  // 初始加载
  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  // 自动刷新定时器
  useEffect(() => {
    if (autoRefresh) {
      setNextRefreshIn(AUTO_REFRESH_INTERVAL);
      timerRef.current = setInterval(() => {
        setNextRefreshIn((prev) => {
          const next = prev - 1000;
          if (next <= 0) {
            loadAnalysis(true);
            return AUTO_REFRESH_INTERVAL;
          }
          return next;
        });
      }, 1000);
      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }
  }, [autoRefresh, loadAnalysis]);

  const passedCount = useMemo(
    () => results.filter((r) => r.passed).length,
    [results]
  );

  const ztCount = useMemo(
    () => results.filter((r) => r.conditions.ztOk).length,
    [results]
  );

  const displayedResults = useMemo(
    () => (filterPassed ? results.filter((r) => r.passed) : results),
    [results, filterPassed]
  );

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatCountdown = (ms: number) => {
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  };

  const formatTime = (date: Date | null) => {
    if (!date) return "-";
    return date.toLocaleTimeString("zh-CN", { hour12: false });
  };

  // 跳转到首页并选中该股票
  const goToStock = (item: QuantItem) => {
    navigate(`/?code=${item.code}&market=${item.market}&name=${encodeURIComponent(item.name)}`);
  };

  // 打开往期入选面板
  const handleShowHistory = useCallback(async () => {
    setShowHistory(true);
    setHistoryLoading(true);
    try {
      const resp = await fetchQuantHistory();
      setHistoryRecords(resp.data);

      // 获取所有历史入选股票的当前价格
      const allStocks = resp.data.flatMap((r) => r.stocks);
      const uniqueStocks = Array.from(new Map(allStocks.map((s) => [s.code, s])).values());
      const priceMap: Record<string, { price: number; change: number; changePct: number }> = {};
      await Promise.all(
        uniqueStocks.map(async (s) => {
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

  return (
    <div className="flex h-screen flex-col bg-base-900">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between border-b border-base-500 bg-base-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.history.back()}
            className="rounded p-1.5 text-text-muted hover:bg-base-600 hover:text-text-primary"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-text-primary">
              <Activity className="h-5 w-5 text-accent-gold" />
              量化交易分析
            </h1>
            <p className="text-xs text-text-muted">
              MA5支撑 · MACD金叉 · DIF上穿DEA · 零轴附近 · DIF&gt;DEA
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* 数据源切换 */}
          <div className="flex items-center gap-1.5 rounded border border-base-500 bg-base-700 px-2 py-1.5">
            <Database className="h-3.5 w-3.5 text-text-muted" />
            <select
              value={apiSource}
              onChange={(e) => handleSourceChange(e.target.value as "sina" | "tencent")}
              className="bg-transparent text-xs text-text-primary focus:outline-none cursor-pointer"
              title="切换数据源"
            >
              <option value="tencent" className="bg-base-800">腾讯</option>
              <option value="sina" className="bg-base-800">新浪</option>
            </select>
          </div>
          {/* 自动刷新开关 */}
          <label className="flex cursor-pointer items-center gap-2 rounded bg-base-600 px-3 py-1.5 text-xs text-text-secondary transition hover:text-text-primary">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-3 w-3 accent-accent-gold"
            />
            <Clock className="h-3.5 w-3.5" />
            <span>5分钟自动刷新</span>
            {autoRefresh && (
              <span className="font-mono-num text-accent-gold">
                {formatCountdown(nextRefreshIn)}
              </span>
            )}
          </label>
          <button
            onClick={() => setFilterPassed(!filterPassed)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition ${
              filterPassed
                ? "bg-rise/20 text-rise-bright"
                : "bg-base-600 text-text-secondary hover:text-text-primary"
            }`}
          >
            {filterPassed ? "✓ 仅看入选" : "显示全部"}
          </button>
          <button
            onClick={handleShowHistory}
            className="flex items-center gap-1.5 rounded border border-accent-gold/30 bg-accent-gold/10 px-3 py-1.5 text-xs font-medium text-accent-gold transition hover:bg-accent-gold/20"
            title="查看往期入选记录"
          >
            <History className="h-3.5 w-3.5" />
            往期入选
          </button>
          <button
            onClick={() => loadAnalysis(true)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded bg-accent-gold/20 px-3 py-1.5 text-xs font-medium text-accent-gold transition hover:bg-accent-gold/30 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {loading ? "分析中..." : "刷新"}
          </button>
        </div>
      </div>

      {/* 统计栏 */}
      <div className="flex items-center gap-6 border-b border-base-500 bg-base-800/50 px-4 py-2 text-xs">
        <span className="text-text-muted">
          股票池：<span className="font-mono-num text-text-primary">{results.length}</span>
        </span>
        <span className="text-text-muted">
          已扫描：<span className="font-mono-num text-text-primary">{scannedCount}</span>
        </span>
        <span className="text-text-muted">
          入选：<span className="font-mono-num text-rise-bright">{passedCount}</span>
        </span>
        <span className="text-text-muted">
          近5日涨停：<span className="font-mono-num text-accent-gold">{ztCount}</span>
        </span>
        <span className="text-text-muted">
          耗时：<span className="font-mono-num text-text-primary">{formatDuration(duration)}</span>
        </span>
        <span className="text-text-muted">
          最后更新：<span className="font-mono-num text-text-primary">{formatTime(lastUpdateTime)}</span>
        </span>
        {loading && (
          <span className="flex items-center gap-1 text-accent-gold">
            <Loader2 className="h-3 w-3 animate-spin" />
            实时分析中...
          </span>
        )}
        {autoRefresh && !loading && (
          <span className="flex items-center gap-1 text-accent-gold">
            <Clock className="h-3 w-3" />
            下次刷新：{formatCountdown(nextRefreshIn)}
          </span>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="border-b border-rise/20 bg-rise/10 px-4 py-2 text-sm text-rise-bright">
          {error}
        </div>
      )}

      {/* 表格 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-base-800 text-text-muted">
            <tr className="border-b border-base-500">
              <th className="px-3 py-2 text-left font-medium">代码</th>
              <th className="px-3 py-2 text-left font-medium">名称</th>
              <th className="px-3 py-2 text-right font-medium">现价</th>
              <th className="px-3 py-2 text-right font-medium">MA5</th>
              <th className="px-3 py-2 text-center font-medium" title="近5日有涨停（不参与最终判定）">涨停*</th>
              <th className="px-3 py-2 text-center font-medium">MA5支撑</th>
              <th className="px-3 py-2 text-center font-medium">MACD金叉</th>
              <th className="px-3 py-2 text-center font-medium">DIF上穿DEA</th>
              <th className="px-3 py-2 text-center font-medium">DIF零轴附近</th>
              <th className="px-3 py-2 text-center font-medium">DIF&gt;DEA</th>
              <th className="px-3 py-2 text-right font-medium">日K数</th>
              <th className="px-3 py-2 text-right font-medium">15分K数</th>
              <th className="px-3 py-2 text-right font-medium">上根15分价</th>
              <th className="px-3 py-2 text-center font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {displayedResults.map((item) => (
              <tr
                key={item.code}
                className={`border-b border-base-700/50 transition hover:bg-base-700/30 ${
                  item.passed ? "bg-rise/5" : ""
                }`}
              >
                <td className="px-3 py-2 font-mono-num">
                  <button
                    onClick={() => goToStock(item)}
                    className="flex items-center gap-1 text-accent-gold hover:underline"
                    title="跳转到首页查看K线和实时图"
                  >
                    {item.market.toUpperCase()}{item.code}
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => goToStock(item)}
                    className="text-text-primary hover:text-accent-gold hover:underline"
                    title="跳转到首页查看"
                  >
                    {item.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-mono-num text-text-primary">
                  {item.price.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right font-mono-num text-text-muted">
                  {item.ma5 > 0 ? item.ma5.toFixed(2) : "-"}
                </td>
                <td className="px-3 py-2 text-center">
                  <ConditionIcon ok={item.conditions.ztOk} dim />
                </td>
                <td className="px-3 py-2 text-center">
                  <ConditionIcon ok={item.conditions.ma5Ok} />
                </td>
                <td className="px-3 py-2 text-center">
                  <ConditionIcon ok={item.conditions.macdCross} />
                </td>
                <td className="px-3 py-2 text-center">
                  <ConditionIcon ok={item.conditions.difCrossDea} />
                </td>
                <td className="px-3 py-2 text-center">
                  <ConditionIcon ok={item.conditions.difNearZero} />
                </td>
                <td className="px-3 py-2 text-center">
                  <ConditionIcon ok={item.conditions.difAboveDea} />
                </td>
                <td className="px-3 py-2 text-right font-mono-num text-text-muted">
                  {item.dayCount}
                </td>
                <td className="px-3 py-2 text-right font-mono-num text-text-muted">
                  {item.min15Count}
                </td>
                <td className="px-3 py-2 text-right font-mono-num text-text-muted">
                  {item.last15Price > 0 ? item.last15Price.toFixed(2) : "-"}
                </td>
                <td className="px-3 py-2 text-center">
                  {item.passed ? (
                    <span className="inline-flex items-center gap-1 rounded bg-rise/15 px-2 py-0.5 text-rise-bright">
                      <TrendingUp className="h-3 w-3" />
                      入选
                    </span>
                  ) : (
                    <span className="text-text-muted">-</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && displayedResults.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-12 text-center text-text-muted">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 底部说明 */}
      <div className="border-t border-base-500 bg-base-800 px-4 py-2 text-[10px] text-text-muted">
        <div className="flex items-center justify-between">
          <span>数据来源：腾讯财经 · 新浪财经 · 仅供参考</span>
          <span>* 涨停条件在Python脚本中已注释，不参与最终判定 · 最终条件：MA5支撑 + MACD金叉 + DIF上穿DEA + DIF零轴附近 + DIF&gt;DEA</span>
        </div>
      </div>

      {/* 往期入选侧边面板 */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setShowHistory(false)}>
          <div
            className="flex h-full w-[480px] flex-col border-l border-base-500 bg-base-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 面板头 */}
            <div className="flex items-center justify-between border-b border-base-500 px-4 py-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-accent-gold" />
                <span className="text-sm font-semibold text-text-primary">往期入选清单</span>
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="rounded p-1 text-text-muted hover:bg-base-600 hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 面板内容 */}
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
                      {/* 日期头 */}
                      <div className="flex items-center justify-between border-b border-base-600 px-3 py-2">
                        <span className="text-xs font-semibold text-accent-gold">{record.date}</span>
                        <span className="text-[10px] text-text-muted">{record.stocks.length} 只入选</span>
                      </div>
                      {/* 股票列表 */}
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-text-muted">
                            <th className="px-2 py-1 text-left font-medium">代码/名称</th>
                            <th className="px-2 py-1 text-right font-medium">入选价</th>
                            <th className="px-2 py-1 text-right font-medium">现价</th>
                            <th className="px-2 py-1 text-right font-medium">涨跌</th>
                            <th className="px-2 py-1 text-center font-medium">入选天数</th>
                          </tr>
                        </thead>
                        <tbody>
                          {record.stocks.map((stock) => {
                            const cp = currentPrices[stock.code];
                            const change = cp ? cp.price - stock.price : 0;
                            const changePct = stock.price > 0 ? (change / stock.price) * 100 : 0;
                            const isUp = change >= 0;
                            // 计算入选天数：在所有历史记录中出现的次数
                            const selectedDays = historyRecords.filter(
                              (r) => r.stocks.some((s) => s.code === stock.code)
                            ).length;
                            return (
                              <tr
                                key={stock.code}
                                className="border-t border-base-700/50 hover:bg-base-700/30 cursor-pointer"
                                onClick={() => {
                                  navigate(`/?code=${stock.code}&market=${stock.market}&name=${encodeURIComponent(stock.name)}`);
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

/** 条件状态图标 */
function ConditionIcon({ ok, dim }: { ok: boolean; dim?: boolean }) {
  if (ok) {
    return (
      <CheckCircle2
        className={`mx-auto h-3.5 w-3.5 ${dim ? "text-accent-gold/60" : "text-rise-bright"}`}
      />
    );
  }
  return <XCircle className="mx-auto h-3.5 w-3.5 text-base-500" />;
}
