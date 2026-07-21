/**
 * 股票数据 API 客户端
 */

import axios from "axios";
import type {
  StockListResponse,
  KlineResponse,
  KlinePeriod,
  ScreeningResponse,
  ScreeningStatusResponse,
  QuantResponse,
} from "../../shared/types";

const client = axios.create({
  baseURL: "/api/stocks",
  timeout: 15000,
});

export async function fetchStockList(params: {
  page: number;
  pageSize: number;
  keyword?: string;
}): Promise<StockListResponse> {
  const { data } = await client.get<StockListResponse>("/list", { params });
  return data;
}

export async function fetchKline(params: {
  code: string;
  market: "sh" | "sz";
  period: KlinePeriod;
}): Promise<KlineResponse> {
  const { data } = await client.get<KlineResponse>("/kline", { params });
  return data;
}

/** 查询后台筛选任务进度 */
export async function fetchScreeningStatus(): Promise<ScreeningStatusResponse> {
  const { data } = await client.get<ScreeningStatusResponse>("/screening/status");
  return data;
}

/** 获取缓存的筛选结果（任务完成后才有数据） */
export async function fetchScreening(): Promise<ScreeningResponse> {
  const { data } = await client.get<ScreeningResponse>("/screening");
  return data;
}

/** 启动/重新启动后台筛选任务（用户点击按钮触发） */
export async function startScreening(): Promise<{ code: number; data: { message: string } }> {
  const { data } = await client.post("/screening/restart");
  return data;
}

/** 量化分析 */
export async function fetchQuantAnalysis(force?: boolean): Promise<QuantResponse> {
  const { data } = await client.get<QuantResponse>("/quant", {
    params: force ? { force: "1" } : {},
    timeout: 60000,
  });
  return data;
}

/** 获取当前数据源 */
export async function fetchApiSource(): Promise<{ code: number; data: { source: "sina" | "tencent" } }> {
  const { data } = await client.get("/api-source");
  return data;
}

/** 切换数据源 */
export async function setApiSource(source: "sina" | "tencent"): Promise<{ code: number; data: { source: string } }> {
  const { data } = await client.post("/api-source", { source });
  return data;
}

/** 实时行情（单只股票） */
export interface RealtimeQuote {
  code: string;
  name: string;
  price: number;
  open: number;
  prevClose: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  changeAmount: number;
  changePercent: number;
  time: string;
}

export async function fetchRealtimeQuote(code: string, market: "sh" | "sz"): Promise<{ code: number; data: RealtimeQuote }> {
  const { data } = await client.get(`/realtime`, { params: { code, market }, timeout: 8000 });
  return data;
}

/** 分时数据（当日1分钟K线） */
export interface IntradayPoint {
  time: string;  // HH:mm
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

export interface IntradayData {
  code: string;
  name: string;
  prevClose: number;
  points: IntradayPoint[];
}

export async function fetchIntraday(code: string, market: "sh" | "sz"): Promise<{ code: number; data: IntradayData }> {
  const { data } = await client.get(`/intraday`, { params: { code, market }, timeout: 10000 });
  return data;
}

/** 量化入选历史记录 */
export interface HistoryStock {
  code: string;
  name: string;
  market: "sh" | "sz";
  price: number; // 入选时价格
}

export interface HistoryRecord {
  date: string;
  stocks: HistoryStock[];
}

/** 保存今天入选的股票 */
export async function saveQuantHistory(stocks: HistoryStock[]): Promise<{ code: number; data: { date: string; count: number } }> {
  const { data } = await client.post("/quant/history", { stocks });
  return data;
}

/** 获取所有往期入选记录 */
export async function fetchQuantHistory(): Promise<{ code: number; data: HistoryRecord[] }> {
  const { data } = await client.get("/quant/history");
  return data;
}

/** 保存9日下跌入选股票 */
export async function saveDeclineHistory(stocks: HistoryStock[]): Promise<{ code: number; data: { date: string; count: number } }> {
  const { data } = await client.post("/screening/history", { stocks });
  return data;
}

/** 获取9日下跌往期入选记录 */
export async function fetchDeclineHistory(): Promise<{ code: number; data: HistoryRecord[] }> {
  const { data } = await client.get("/screening/history");
  return data;
}

// ============ 股票池管理 ============

export interface PoolStock {
  code: string;
  name: string;
  market: "sh" | "sz";
}

/** 获取当前股票池 */
export async function fetchStockPool(): Promise<{ code: number; data: { stocks: PoolStock[]; count: number } }> {
  const { data } = await client.get("/quant/pool");
  return data;
}

/** 批量更新股票池（替换全部）— 支持数组或换行/逗号分隔的字符串 */
export async function updateStockPool(stocks: string[] | string): Promise<{ code: number; data: { count: number } }> {
  const { data } = await client.post("/quant/pool", { stocks });
  return data;
}

/** 从股票池删除单只股票 */
export async function removeStockFromPool(code: string): Promise<{ code: number; data: { count: number } }> {
  const { data } = await client.delete(`/quant/pool/${code}`);
  return data;
}
