/**
 * 全局股票状态管理 - zustand
 */

import { create } from "zustand";
import type {
  StockItem,
  KlineItem,
  KlinePeriod,
  ScreeningItem,
  ScreeningTaskStatus,
} from "../../shared/types";
import {
  fetchStockList,
  fetchKline,
  fetchScreeningStatus,
  startScreening,
  fetchApiSource,
  setApiSource,
} from "@/api/stockApi";

interface StockState {
  // 股票列表
  stockList: StockItem[];
  listLoading: boolean;
  listTotal: number;
  page: number;
  pageSize: number;
  keyword: string;

  // 选中的股票
  selectedStock: StockItem | null;

  // K线
  klineData: KlineItem[];
  klineLoading: boolean;
  klinePeriod: KlinePeriod;
  klineName: string;

  // 筛选 - 后台任务状态
  screeningTaskStatus: ScreeningTaskStatus; // pending/running/done/failed
  screeningProgress: number; // 0~100
  screeningScanned: number; // 已扫描数量
  screeningTotal: number; // 总数量
  screeningMatched: number; // 已找到符合条件的数量
  screeningResults: ScreeningItem[]; // 缓存的结果
  screeningMode: boolean; // 是否处于筛选展示模式（用户点击按钮后）

  // 数据源
  apiSource: "sina" | "tencent"; // 当前数据源

  // 错误信息
  error: string | null;

  // actions
  loadStockList: (reset?: boolean) => Promise<void>;
  setKeyword: (kw: string) => void;
  setPage: (p: number) => void;
  selectStock: (stock: StockItem) => void;
  loadKline: (period?: KlinePeriod) => Promise<void>;
  setKlinePeriod: (p: KlinePeriod) => void;

  // 筛选 actions
  initScreeningPolling: () => void;
  stopScreeningPolling: () => void;
  startScreeningTask: () => Promise<void>;
  toggleScreeningMode: () => void;
  exitScreening: () => void;

  // 数据源 actions
  loadApiSource: () => Promise<void>;
  changeApiSource: (source: "sina" | "tencent") => Promise<void>;

  clearError: () => void;
}

// 轮询定时器（模块级，不放入 store 避免序列化）
let pollingTimer: ReturnType<typeof setTimeout> | null = null;

// K线请求计数器（用于丢弃快速切换时的过期响应，防止竞态）
let klineRequestId = 0;

export const useStockStore = create<StockState>((set, get) => ({
  stockList: [],
  listLoading: false,
  listTotal: 0,
  page: 1,
  pageSize: 50,
  keyword: "",

  selectedStock: null,

  klineData: [],
  klineLoading: false,
  klinePeriod: "daily",
  klineName: "",

  screeningTaskStatus: "pending",
  screeningProgress: 0,
  screeningScanned: 0,
  screeningTotal: 0,
  screeningMatched: 0,
  screeningResults: [],
  screeningMode: false,

  apiSource: "tencent",

  error: null,

  loadStockList: async (reset?: boolean) => {
    const { page, pageSize, keyword } = get();
    set({
      listLoading: true,
      page: reset ? 1 : page,
      error: null,
    });
    try {
      const resp = await fetchStockList({
        page: reset ? 1 : page,
        pageSize,
        keyword: keyword || undefined,
      });
      set({
        stockList: resp.data,
        listTotal: resp.total,
        listLoading: false,
      });
    } catch {
      set({
        listLoading: false,
        error: "加载股票列表失败，请检查网络或后端服务",
      });
    }
  },

  setKeyword: (kw: string) => set({ keyword: kw }),

  setPage: (p: number) => {
    set({ page: p });
    get().loadStockList();
  },

  selectStock: (stock: StockItem) => {
    set({ selectedStock: stock });
    get().loadKline();
  },

  loadKline: async (period?: KlinePeriod) => {
    const { selectedStock, klinePeriod } = get();
    const p = period || klinePeriod;
    if (!selectedStock) return;
    // 每次请求递增 ID，用于丢弃过期响应
    const requestId = ++klineRequestId;
    set({ klineLoading: true, klinePeriod: p, error: null });
    try {
      const resp = await fetchKline({
        code: selectedStock.code,
        market: selectedStock.market,
        period: p,
      });
      // 如果在等待期间又发起了新请求，丢弃本次响应
      if (requestId !== klineRequestId) return;
      set({
        klineData: resp.data.klines,
        klineName: resp.data.name,
        klineLoading: false,
      });
    } catch {
      if (requestId !== klineRequestId) return;
      set({
        klineLoading: false,
        error: "加载K线数据失败",
      });
    }
  },

  setKlinePeriod: (p: KlinePeriod) => {
    set({ klinePeriod: p });
    get().loadKline(p);
  },

  // ============ 筛选：后台任务轮询 ============
  initScreeningPolling: () => {
    // 避免重复启动
    if (pollingTimer) return;

    const poll = async () => {
      try {
        const resp = await fetchScreeningStatus();
        const d = resp.data;
        set({
          screeningTaskStatus: d.status,
          screeningProgress: d.progress,
          screeningScanned: d.scannedCount,
          screeningTotal: d.totalCount,
          screeningMatched: d.matchedCount,
          screeningResults: d.results,
        });

        // 如果任务还在进行中，继续轮询
        if (d.status === "running" || d.status === "pending") {
          pollingTimer = setTimeout(poll, 2000);
        } else {
          // done 或 failed，停止轮询
          pollingTimer = null;
        }
      } catch {
        // 网络错误，3秒后重试
        pollingTimer = setTimeout(poll, 3000);
      }
    };

    poll();
  },

  stopScreeningPolling: () => {
    if (pollingTimer) {
      clearTimeout(pollingTimer);
      pollingTimer = null;
    }
  },

  // 用户点击按钮启动筛选任务
  startScreeningTask: async () => {
    const { screeningTaskStatus } = get();
    // 如果正在运行，不重复启动
    if (screeningTaskStatus === "running") return;

    // 调用后端启动筛选
    try {
      await startScreening();
      // 启动轮询跟踪进度
      get().initScreeningPolling();
    } catch {
      set({ error: "启动筛选任务失败" });
    }
  },

  // 用户点击筛选按钮
  toggleScreeningMode: () => {
    const { screeningTaskStatus, screeningMode, screeningResults } = get();
    // 只有任务完成后才能查看结果
    if (screeningTaskStatus !== "done") return;

    if (screeningMode) {
      // 退出筛选模式
      set({ screeningMode: false });
      get().loadStockList(true);
    } else {
      // 进入筛选模式，展示缓存结果
      if (screeningResults.length === 0) {
        set({ error: "当前没有连续9天下跌的股票" });
        return;
      }
      set({ screeningMode: true });
    }
  },

  exitScreening: () => {
    set({ screeningMode: false });
    get().loadStockList(true);
  },

  // ============ 数据源切换 ============
  loadApiSource: async () => {
    try {
      const resp = await fetchApiSource();
      set({ apiSource: resp.data.source });
    } catch {
      // 静默失败，使用默认值
    }
  },

  changeApiSource: async (source: "sina" | "tencent") => {
    const { apiSource: current } = get();
    if (current === source) return;
    try {
      await setApiSource(source);
      set({ apiSource: source });
      // 刷新股票列表和K线
      get().loadStockList(true);
      if (get().selectedStock) {
        get().loadKline();
      }
    } catch {
      set({ error: "切换数据源失败" });
    }
  },

  clearError: () => set({ error: null }),
}));
