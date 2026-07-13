/**
 * 右侧 K线图组件
 * 使用 ECharts 渲染：蜡烛图 + MA均线 + 成交量
 */

import { useMemo, useRef, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import type EChartsReact from "echarts-for-react";
import { Loader2, CandlestickChart } from "lucide-react";
import { useStockStore } from "@/store/stockStore";
import {
  formatPrice,
  formatPercent,
  formatVolume,
  changeColor,
} from "@/utils/format";
import type { KlinePeriod } from "../../shared/types";

// 计算 MA 均线
function calcMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[i - j];
      result.push(Number((sum / period).toFixed(2)));
    }
  }
  return result;
}

const PERIOD_LABELS: { value: KlinePeriod; label: string }[] = [
  { value: "daily", label: "日K" },
  { value: "weekly", label: "周K" },
  { value: "monthly", label: "月K" },
];

export default function KlineChart() {
  const {
    selectedStock,
    klineData,
    klineLoading,
    klinePeriod,
    klineName,
    setKlinePeriod,
  } = useStockStore();

  // 计算 ECharts option
  const option = useMemo(() => {
    if (!klineData.length) return null;

    const dates = klineData.map((k) => k.date);
    const closes = klineData.map((k) => k.close);
    // ECharts 蜡烛图数据: [open, close, low, high]
    const ohlc = klineData.map((k) => [k.open, k.close, k.low, k.high]);
    const volumes = klineData.map((k, i) => ({
      value: k.volume,
      // 上涨红色，下跌绿色
      itemStyle: {
        color: k.close >= k.open ? "#ef4444" : "#10b981",
        opacity: 0.8,
      },
      _index: i,
    }));

    const ma5 = calcMA(closes, 5);
    const ma10 = calcMA(closes, 10);
    const ma20 = calcMA(closes, 20);

    // 初始 markPoint：基于默认 dataZoom 窗口 [60%, 100%]
    const initStart = Math.floor(klineData.length * 0.6);
    const initEnd = klineData.length;
    const initVisible = klineData.slice(initStart, initEnd);
    let iMaxIdx = 0;
    let iMinIdx = 0;
    initVisible.forEach((k, i) => {
      if (k.high > initVisible[iMaxIdx].high) iMaxIdx = i;
      if (k.low < initVisible[iMinIdx].low) iMinIdx = i;
    });
    const initMaxPoint = initVisible[iMaxIdx];
    const initMinPoint = initVisible[iMinIdx];

    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          lineStyle: { color: "#ffd60a", width: 1, type: "dashed" },
          label: { backgroundColor: "#242d3d" },
        },
        backgroundColor: "rgba(13, 17, 23, 0.95)",
        borderColor: "#242d3d",
        borderWidth: 1,
        textStyle: { color: "#e6edf3", fontSize: 12 },
        formatter: (params: Array<Record<string, unknown>>) => {
          if (!params || !params.length) return "";
          const idx = (params[0].dataIndex as number) ?? 0;
          const k = klineData[idx];
          if (!k) return "";
          const change = k.close - k.open;
          const changePct = k.open ? ((change / k.open) * 100).toFixed(2) : "0.00";
          const color = change >= 0 ? "#ef4444" : "#10b981";
          return `
            <div style="font-size:12px;line-height:1.6">
              <div style="color:#8b949e;margin-bottom:4px">${k.date}</div>
              <div>开盘 <span style="color:${color};font-family:monospace">${k.open.toFixed(2)}</span></div>
              <div>收盘 <span style="color:${color};font-family:monospace">${k.close.toFixed(2)}</span></div>
              <div>最高 <span style="color:#ef4444;font-family:monospace">${k.high.toFixed(2)}</span></div>
              <div>最低 <span style="color:#10b981;font-family:monospace">${k.low.toFixed(2)}</span></div>
              <div>涨跌 <span style="color:${color};font-family:monospace">${change >= 0 ? "+" : ""}${change.toFixed(2)} (${change >= 0 ? "+" : ""}${changePct}%)</span></div>
              <div>成交量 <span style="color:#e6edf3;font-family:monospace">${formatVolume(k.volume)}</span></div>
            </div>
          `;
        },
      },
      axisPointer: {
        link: [{ xAxisIndex: "all" }],
      },
      grid: [
        { left: 60, right: 60, top: 30, height: "55%" },
        { left: 60, right: 60, top: "72%", height: "20%" },
      ],
      xAxis: [
        {
          type: "category",
          data: dates,
          scale: true,
          boundaryGap: false,
          splitLine: { show: false },
          axisLine: { lineStyle: { color: "#242d3d" } },
          axisLabel: { color: "#6e7681", fontSize: 10 },
          min: "dataMin",
          max: "dataMax",
        },
        {
          type: "category",
          gridIndex: 1,
          data: dates,
          scale: true,
          boundaryGap: false,
          splitLine: { show: false },
          axisLine: { lineStyle: { color: "#242d3d" } },
          axisLabel: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          splitLine: { lineStyle: { color: "#1c2330", type: "dashed" } },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: "#6e7681",
            fontSize: 10,
            formatter: (v: number) => v.toFixed(2),
          },
        },
        {
          scale: true,
          gridIndex: 1,
          splitNumber: 2,
          splitLine: { lineStyle: { color: "#1c2330", type: "dashed" } },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: "#6e7681",
            fontSize: 10,
            formatter: (v: number) => formatVolume(v),
          },
        },
      ],
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: [0, 1],
          start: 60,
          end: 100,
        },
        {
          type: "slider",
          xAxisIndex: [0, 1],
          start: 60,
          end: 100,
          height: 18,
          bottom: 8,
          borderColor: "transparent",
          backgroundColor: "#0d1117",
          fillerColor: "rgba(255, 214, 10, 0.1)",
          handleStyle: { color: "#ffd60a" },
          textStyle: { color: "#6e7681", fontSize: 10 },
        },
      ],
      series: [
        {
          name: "K线",
          type: "candlestick",
          data: ohlc,
          itemStyle: {
            color: "#ef4444", // 阳线
            color0: "#10b981", // 阴线
            borderColor: "#ef4444",
            borderColor0: "#10b981",
          },
          markPoint: {
            symbol: "triangle",
            symbolSize: 12,
            label: {
              show: true,
              fontSize: 11,
              fontWeight: "bold",
              fontFamily: "monospace",
              formatter: (p: { data: { value: number } }) => p.data.value.toFixed(2),
            },
            data: [
              {
                name: "最高",
                coord: [initMaxPoint.date, initMaxPoint.high],
                value: initMaxPoint.high,
                symbolRotate: 0,
                symbolOffset: [0, -16],
                itemStyle: { color: "#ef4444" },
                label: {
                  color: "#ef4444",
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                  padding: [2, 4],
                  borderRadius: 2,
                  position: "top",
                },
              },
              {
                name: "最低",
                coord: [initMinPoint.date, initMinPoint.low],
                value: initMinPoint.low,
                symbolRotate: 180,
                symbolOffset: [0, 16],
                itemStyle: { color: "#10b981" },
                label: {
                  color: "#10b981",
                  backgroundColor: "rgba(16, 185, 129, 0.1)",
                  padding: [2, 4],
                  borderRadius: 2,
                  position: "bottom",
                },
              },
            ],
          },
        },
        {
          name: "MA5",
          type: "line",
          data: ma5,
          smooth: false,
          symbol: "none",
          lineStyle: { color: "#ffd60a", width: 1 },
          z: 5,
        },
        {
          name: "MA10",
          type: "line",
          data: ma10,
          smooth: false,
          symbol: "none",
          lineStyle: { color: "#a78bfa", width: 1 },
          z: 5,
        },
        {
          name: "MA20",
          type: "line",
          data: ma20,
          smooth: false,
          symbol: "none",
          lineStyle: { color: "#38bdf8", width: 1 },
          z: 5,
        },
        {
          name: "成交量",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes,
        },
      ],
    };
  }, [klineData]);

  const chartRef = useRef<EChartsReact>(null);

  // 根据可见窗口范围更新最高/最低点 markPoint
  const updateMarkPoint = useCallback(
    (start: number, end: number) => {
      const chart = chartRef.current?.getEchartsInstance();
      if (!chart || !klineData.length) return;

      // 将百分比转换为索引
      const total = klineData.length;
      const startIdx = Math.max(0, Math.floor((start / 100) * total));
      const endIdx = Math.min(total, Math.ceil((end / 100) * total));
      const visible = klineData.slice(startIdx, endIdx);
      if (visible.length === 0) return;

      let vMaxIdx = 0;
      let vMinIdx = 0;
      visible.forEach((k, i) => {
        if (k.high > visible[vMaxIdx].high) vMaxIdx = i;
        if (k.low < visible[vMinIdx].low) vMinIdx = i;
      });
      const maxPoint = visible[vMaxIdx];
      const minPoint = visible[vMinIdx];

      chart.setOption({
        series: [
          {
            name: "K线",
            markPoint: {
              symbol: "triangle",
              symbolSize: 12,
              label: {
                show: true,
                fontSize: 11,
                fontWeight: "bold",
                fontFamily: "monospace",
                formatter: (p: { data: { value: number } }) =>
                  p.data.value.toFixed(2),
              },
              data: [
                {
                  name: "最高",
                  coord: [maxPoint.date, maxPoint.high],
                  value: maxPoint.high,
                  symbolRotate: 0,
                  symbolOffset: [0, -16],
                  itemStyle: { color: "#ef4444" },
                  label: {
                    color: "#ef4444",
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    padding: [2, 4],
                    borderRadius: 2,
                    position: "top",
                  },
                },
                {
                  name: "最低",
                  coord: [minPoint.date, minPoint.low],
                  value: minPoint.low,
                  symbolRotate: 180,
                  symbolOffset: [0, 16],
                  itemStyle: { color: "#10b981" },
                  label: {
                    color: "#10b981",
                    backgroundColor: "rgba(16, 185, 129, 0.1)",
                    padding: [2, 4],
                    borderRadius: 2,
                    position: "bottom",
                  },
                },
              ],
            },
          },
        ],
      });
    },
    [klineData]
  );

  // dataZoom 事件处理
  const onEvents = useMemo(
    () => ({
      datazoom: (params: { batch?: Array<{ start: number; end: number }>; start?: number; end?: number }) => {
        // inside 滚轮缩放会触发 batch，slider 拖拽直接带 start/end
        let s: number | undefined;
        let e: number | undefined;
        if (params.batch && params.batch.length > 0) {
          s = params.batch[0].start;
          e = params.batch[0].end;
        } else if (typeof params.start === "number" && typeof params.end === "number") {
          s = params.start;
          e = params.end;
        }
        if (s !== undefined && e !== undefined) {
          updateMarkPoint(s, e);
        }
      },
    }),
    [updateMarkPoint]
  );

  // 空状态
  if (!selectedStock) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-base-800 text-text-muted">
        <CandlestickChart className="mb-3 h-12 w-12 opacity-30" />
        <p className="text-sm">点击左侧股票查看K线图</p>
        <p className="mt-1 text-xs">或输入代码搜索</p>
      </div>
    );
  }

  const changeColorClass = changeColor(selectedStock.changePercent);

  return (
    <div className="flex h-full flex-col bg-base-800">
      {/* 股票信息头 */}
      <div className="border-b border-base-500 px-4 py-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-text-primary">
                {klineName || selectedStock.name}
              </span>
              <span className="font-mono-num text-sm text-text-muted">
                {selectedStock.market.toUpperCase()}{selectedStock.code}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div
              className={`font-mono-num text-2xl font-bold ${changeColorClass}`}
            >
              {formatPrice(selectedStock.price)}
            </div>
            <div className={`font-mono-num text-sm ${changeColorClass}`}>
              {selectedStock.changeAmount >= 0 ? "+" : ""}
              {formatPrice(selectedStock.changeAmount)}{" "}
              {formatPercent(selectedStock.changePercent)}
            </div>
          </div>
        </div>

        {/* 周期切换 */}
        <div className="mt-3 flex items-center gap-1">
          {PERIOD_LABELS.map((p) => (
            <button
              key={p.value}
              onClick={() => setKlinePeriod(p.value)}
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                klinePeriod === p.value
                  ? "bg-accent-gold/20 text-accent-gold shadow-glow"
                  : "text-text-secondary hover:bg-base-600 hover:text-text-primary"
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="ml-3 flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 bg-accent-gold" />
              <span className="text-text-muted">MA5</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 bg-[#a78bfa]" />
              <span className="text-text-muted">MA10</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 bg-[#38bdf8]" />
              <span className="text-text-muted">MA20</span>
            </span>
          </div>
        </div>
      </div>

      {/* 图表 */}
      <div className="relative flex-1">
        {klineLoading ? (
          <div className="flex h-full items-center justify-center text-text-muted">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            加载K线数据...
          </div>
        ) : option ? (
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
            notMerge={true}
            onEvents={onEvents}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            暂无K线数据
          </div>
        )}
      </div>
    </div>
  );
}
