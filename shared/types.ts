// 共享类型定义 - 前后端通用

export type Market = "sh" | "sz";

export type KlinePeriod = "daily" | "weekly" | "monthly";

export interface StockItem {
  code: string; // 股票代码
  name: string; // 股票名称
  market: Market; // 市场
  price: number; // 最新价
  changePercent: number; // 涨跌幅 %
  changeAmount: number; // 涨跌额
  volume: number; // 成交量（手）
  amount: number; // 成交额（元）
}

export interface StockListResponse {
  code: number;
  data: StockItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface KlineItem {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
}

export interface KlineResponse {
  code: number;
  data: {
    klines: KlineItem[];
    name: string;
    code: string;
  };
}

export interface ScreeningItem extends StockItem {
  consecutiveFallDays: number; // 连续下跌天数
}

export interface ScreeningResponse {
  code: number;
  data: ScreeningItem[];
  total: number;
}

/** 筛选任务状态 */
export type ScreeningTaskStatus = "pending" | "running" | "done" | "failed";

export interface ScreeningStatusResponse {
  code: number;
  data: {
    status: ScreeningTaskStatus;
    progress: number; // 0~100
    scannedCount: number; // 已扫描数量
    totalCount: number; // 总数量
    matchedCount: number; // 符合条件的数量
    results: ScreeningItem[]; // 实时结果（完成时为全量）
    startedAt: number; // 开始时间戳
    finishedAt?: number; // 完成时间戳
    duration?: number; // 耗时(ms)
    error?: string;
  };
}

/** 量化分析单只股票结果 */
export interface QuantItem {
  code: string;
  name: string;
  market: Market;
  price: number; // 实时价格
  ma5: number; // 5日均线
  dayCount: number; // 日K数量
  min15Count: number; // 15分K数量
  last15Price: number; // 上一根15分钟收盘价
  conditions: {
    ztOk: boolean; // 最近5日有涨停（Python中已注释，不参与最终判定）
    ma5Ok: boolean; // 价格在MA5上方
    macdCross: boolean; // MACD金叉
    difCrossDea: boolean; // DIF上穿DEA
    difNearZero: boolean; // DIF在零轴附近
    difAboveDea: boolean; // DIF在DEA上方
  };
  passed: boolean; // 是否全部通过
}

/** 量化分析响应 */
export interface QuantResponse {
  code: number;
  data: {
    results: QuantItem[];
    total: number;
    passedCount: number;
    scannedCount: number;
    duration: number; // 耗时(ms)
  };
}
