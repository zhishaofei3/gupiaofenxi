/**
 * 实时股价分时图组件
 * 展示当前交易日 9:30-15:00 的分时价格走势
 * 初始加载全日1分钟K线，之后每5秒轮询实时价格更新最后一个点
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import type EChartsReact from "echarts-for-react";
import { Loader2, Radio } from "lucide-react";
import { fetchIntraday, fetchRealtimeQuote, type IntradayPoint } from "@/api/stockApi";
import { useStockStore } from "@/store/stockStore";

const POLL_INTERVAL = 5000; // 5秒轮询

// 完整交易日时间轴（5分钟间隔）：9:30-11:30, 13:00-15:00
const FULL_TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  // 上午 9:30 - 11:30（每5分钟一个点，不含9:30起点，新浪5分K标记为结束时间）
  for (let h = 9, m = 35; h < 11 || (h === 11 && m <= 30); ) {
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 5;
    if (m >= 60) { h += 1; m -= 60; }
  }
  // 下午 13:00 - 15:00
  for (let h = 13, m = 5; h < 15 || (h === 15 && m <= 0); ) {
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    m += 5;
    if (m >= 60) { h += 1; m -= 60; }
  }
  return slots;
})();

interface ChartPoint {
  time: string;
  price: number;
}

export default function RealtimeChart() {
  const { selectedStock } = useStockStore();
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [prevClose, setPrevClose] = useState(0);
  const [latestPrice, setLatestPrice] = useState(0);
  const [latestChange, setLatestChange] = useState(0);
  const [latestChangePct, setLatestChangePct] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const chartRef = useRef<EChartsReact>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeRef = useRef<string>("");

  // 加载分时数据
  const loadIntraday = useCallback(async () => {
    if (!selectedStock) return;
    setLoading(true);
    setError("");
    try {
      const resp = await fetchIntraday(selectedStock.code, selectedStock.market);
      const d = resp.data;
      setPrevClose(d.prevClose);
      const chartPoints: ChartPoint[] = d.points.map((p: IntradayPoint) => ({
        time: p.time,
        price: p.price,
      }));
      setPoints(chartPoints);
      if (chartPoints.length > 0) {
        const last = chartPoints[chartPoints.length - 1];
        setLatestPrice(last.price);
        const change = d.prevClose > 0 ? last.price - d.prevClose : 0;
        setLatestChange(change);
        setLatestChangePct(d.prevClose > 0 ? (change / d.prevClose) * 100 : 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载分时数据失败");
    } finally {
      setLoading(false);
    }
  }, [selectedStock]);

  // 切换股票时重新加载
  useEffect(() => {
    if (!selectedStock) return;
    codeRef.current = selectedStock.code;
    setPoints([]);
    setLatestPrice(0);
    loadIntraday();
  }, [selectedStock?.code, selectedStock?.market, loadIntraday]);

  // 轮询实时价格，更新最后一个点
  useEffect(() => {
    if (!selectedStock || points.length === 0) return;

    const poll = async () => {
      try {
        const resp = await fetchRealtimeQuote(
          selectedStock.code,
          selectedStock.market
        );
        const q = resp.data;
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const timeStr = `${hh}:${mm}`;
        const price = q.price;

        setLatestPrice(price);
        const change = q.prevClose > 0 ? price - q.prevClose : 0;
        setLatestChange(change);
        setLatestChangePct(q.changePercent);

        // 更新最后一个点或追加新点
        setPoints((prev) => {
          const next = [...prev];
          const lastIdx = next.length - 1;
          if (lastIdx >= 0 && next[lastIdx].time === timeStr) {
            // 同一分钟，更新价格
            next[lastIdx] = { time: timeStr, price };
          } else if (timeStr >= "09:30" && timeStr <= "15:00") {
            // 新分钟，追加
            next.push({ time: timeStr, price });
          }
          return next;
        });

        // 动态更新图表（不重建整个option）
        const chart = chartRef.current?.getEchartsInstance();
        if (chart) {
          const allTimes = buildTimeAxis(points.map((p) => p.time));
          const allPrices = buildPriceArray(allTimes, points, prevClose);
          // 追加最新价格点
          const lastTime = timeStr;
          const lastIdx = allTimes.indexOf(lastTime);
          if (lastIdx >= 0) {
            allPrices[lastIdx] = price;
          }
          chart.setOption({
            series: [{ data: allPrices }],
          });
        }
      } catch {
        // 静默失败
      }
    };

    timerRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [selectedStock?.code, selectedStock?.market, points, prevClose]);

  // 构建完整时间轴（包含上午和下午）
  const buildTimeAxis = (existingTimes: string[]): string[] => {
    // 使用完整交易日时间轴，确保 9:30-15:00 全覆盖
    if (existingTimes.length === 0) return FULL_TIME_SLOTS;
    // 找到已有数据的最大时间，之后用 FULL_TIME_SLOTS 填充
    const lastExisting = existingTimes[existingTimes.length - 1];
    const lastIdx = FULL_TIME_SLOTS.indexOf(lastExisting);
    if (lastIdx >= 0 && lastIdx < FULL_TIME_SLOTS.length - 1) {
      // 返回从第一个已有时间到最后一个时间的完整范围
      const firstExisting = existingTimes[0];
      const firstIdx = FULL_TIME_SLOTS.indexOf(firstExisting);
      if (firstIdx >= 0) {
        return FULL_TIME_SLOTS.slice(firstIdx);
      }
    }
    return existingTimes;
  };

  // 构建价格数组（与时间轴对齐，无数据的位置用 null 填充）
  const buildPriceArray = (times: string[], pts: ChartPoint[], pClose: number): (number | null)[] => {
    const priceMap = new Map<string, number>();
    pts.forEach((p) => priceMap.set(p.time, p.price));
    return times.map((t) => {
      if (priceMap.has(t)) return priceMap.get(t)!;
      // 在交易时段内但无数据：如果是最后一个有数据点之后，用最后一个价格延伸
      return null;
    });
  };

  // ECharts option
  const option = useMemo(() => {
    if (points.length === 0) return null;

    const timeAxis = buildTimeAxis(points.map((p) => p.time));
    const priceData = buildPriceArray(timeAxis, points, prevClose);

    // 涨跌颜色
    const lineColor =
      prevClose > 0 && latestPrice >= prevClose ? "#ef4444" : "#10b981";

    // 计算Y轴范围：以昨收为中轴
    let minPrice = prevClose;
    let maxPrice = prevClose;
    points.forEach((p) => {
      if (p.price < minPrice) minPrice = p.price;
      if (p.price > maxPrice) maxPrice = p.price;
    });
    // 上下留 1% 余量
    const range = Math.max(maxPrice - minPrice, prevClose * 0.005);
    const yMin = prevClose - range * 1.1;
    const yMax = prevClose + range * 1.1;

    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(13, 17, 23, 0.95)",
        borderColor: "#242d3d",
        borderWidth: 1,
        textStyle: { color: "#e6edf3", fontSize: 12 },
        formatter: (params: Array<Record<string, unknown>>) => {
          if (!params || !params.length) return "";
          const p = params[0];
          const idx = p.dataIndex as number;
          const time = timeAxis[idx];
          const price = p.data as number | null;
          if (price === null || price === undefined) {
            return `<div style="font-size:12px"><span style="color:#8b949e">${time}</span><br/><span style="color:#6e7681">无数据</span></div>`;
          }
          const change = prevClose > 0 ? price - prevClose : 0;
          const changePct = prevClose > 0 ? ((change / prevClose) * 100).toFixed(2) : "0.00";
          const color = change >= 0 ? "#ef4444" : "#10b981";
          return `
            <div style="font-size:12px;line-height:1.6">
              <div style="color:#8b949e;margin-bottom:4px">${time}</div>
              <div>现价 <span style="color:${color};font-family:monospace">${price.toFixed(2)}</span></div>
              <div>涨跌 <span style="color:${color};font-family:monospace">${change >= 0 ? "+" : ""}${change.toFixed(2)} (${change >= 0 ? "+" : ""}${changePct}%)</span></div>
            </div>
          `;
        },
      },
      grid: { left: 55, right: 20, top: 10, bottom: 25 },
      xAxis: {
        type: "category",
        data: timeAxis,
        axisLine: { lineStyle: { color: "#242d3d" } },
        axisLabel: {
          color: "#6e7681",
          fontSize: 10,
          // 只显示关键时间点
          interval: (index: number) => {
            const t = timeAxis[index];
            return t === "09:35" || t === "10:00" || t === "10:30" || t === "11:30" || t === "13:30" || t === "14:00" || t === "15:00";
          },
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: yMin,
        max: yMax,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#1c2330", type: "dashed" } },
        axisLabel: {
          color: "#6e7681",
          fontSize: 10,
          formatter: (v: number) => v.toFixed(2),
        },
      },
      series: [
        {
          name: "价格",
          type: "line",
          data: priceData,
          smooth: false,
          symbol: "none",
          lineStyle: { color: lineColor, width: 1.5 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: lineColor + "30" },
                { offset: 1, color: lineColor + "00" },
              ],
            },
          },
          // 昨收参考线
          markLine:
            prevClose > 0
              ? {
                  silent: true,
                  symbol: "none",
                  lineStyle: { color: "#6e7681", type: "dashed", width: 1 },
                  data: [
                    {
                      yAxis: prevClose,
                      label: {
                        formatter: `昨收 ${prevClose.toFixed(2)}`,
                        color: "#6e7681",
                        fontSize: 10,
                        position: "insideEndTop",
                      },
                    },
                  ],
                }
              : undefined,
        },
      ],
    };
  }, [points, prevClose, latestPrice]);

  if (!selectedStock) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        <span className="text-xs">选择股票后显示分时图</span>
      </div>
    );
  }

  const changeColorClass =
    prevClose > 0
      ? latestPrice >= prevClose
        ? "text-rise-bright"
        : "text-fall-bright"
      : "text-text-primary";

  return (
    <div className="flex h-full flex-col">
      {/* 实时价格头 */}
      <div className="flex items-center justify-between border-b border-base-600 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Radio className="h-3.5 w-3.5 text-rise-bright" />
          <span className="text-xs font-medium text-text-primary">分时图</span>
          <span className="text-[10px] text-text-muted">9:30-15:00 · 5秒刷新</span>
        </div>
        {latestPrice > 0 && (
          <div className="flex items-center gap-3">
            <span className={`font-mono-num text-sm font-bold ${changeColorClass}`}>
              {latestPrice.toFixed(2)}
            </span>
            <span className={`font-mono-num text-[11px] ${changeColorClass}`}>
              {latestChange >= 0 ? "+" : ""}
              {latestChange.toFixed(2)}
              {" "}
              ({latestChangePct >= 0 ? "+" : ""}{latestChangePct.toFixed(2)}%)
            </span>
          </div>
        )}
      </div>

      {/* 图表 */}
      <div className="relative flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            <span className="text-xs">加载分时数据...</span>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-fall-bright">
            <span className="text-xs">{error}</span>
          </div>
        ) : option ? (
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
            notMerge={true}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-text-muted">
            暂无数据
          </div>
        )}
      </div>
    </div>
  );
}
