/**
 * 股票数据相关路由
 * - 股票目录：东方财富 datacenter API（可靠，启动时缓存全量5536只A股）
 * - 实时行情：腾讯财经 qt.gtimg.cn（批量查询，可靠）
 * - K线数据：腾讯财经 web.ifzq.gtimg.cn（日/周/月K，前复权，可靠）
 */

import { Router, type Request, type Response } from "express";
import axios, { type AxiosResponse } from "axios";
import fs from "fs";
import path from "path";
import type {
  StockItem,
  StockListResponse,
  KlineResponse,
  KlinePeriod,
  ScreeningResponse,
  ScreeningStatusResponse,
  ScreeningItem,
  ScreeningTaskStatus,
  Market,
} from "../../shared/types.js";

const router = Router();

// ============ 数据源切换 ============
export type ApiSource = "sina" | "tencent";
export const apiConfig: { source: ApiSource } = { source: "tencent" };

// ============ 全量股票目录缓存 ============
interface DirEntry {
  code: string;
  name: string;
  market: Market;
}
let stockDirectory: DirEntry[] = [];
let directoryLoaded = false;
let directoryLoading: Promise<void> | null = null;

/**
 * 带重试的 HTTP GET
 */
async function fetchWithRetry(
  url: string,
  params: Record<string, unknown>,
  retries = 2,
  timeout = 8000,
  responseType?: "json" | "text"
): Promise<AxiosResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await axios.get(url, {
        params,
        timeout,
        responseType: responseType as "json" | "text" | undefined,
      });
      return resp;
    } catch (err) {
      lastErr = err;
      const e = err as { code?: string; message?: string };
      const retryable =
        e.code === "ECONNRESET" ||
        e.code === "ETIMEDOUT" ||
        e.code === "ECONNABORTED" ||
        (e.message?.includes("socket hang up") ?? false) ||
        (e.message?.includes("502") ?? false);
      if (!retryable || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function marketFromSecucode(secucode: string): Market {
  return secucode.endsWith(".SH") ? "sh" : "sz";
}

function marketFromCode(code: string): Market {
  return /^(6|9|5)/.test(code) ? "sh" : "sz";
}

/** 腾讯格式 symbol: sh600519 / sz000001 */
function tencentSymbol(code: string, market?: Market): string {
  const m = market || marketFromCode(code);
  return `${m}${code}`;
}

/**
 * 加载全量A股目录
 */
async function loadDirectory(): Promise<void> {
  const url = "https://datacenter-web.eastmoney.com/api/data/v1/get";
  const baseParams = {
    sortColumns: "SECURITY_CODE",
    sortTypes: "1",
    pageSize: "500",
    reportName: "RPT_LICO_FN_CPD",
    columns: "SECURITY_CODE,SECURITY_NAME_ABBR,SECUCODE",
    filter: '(SECURITY_TYPE="A股")(ISNEW="1")',
  };

  const firstResp = await fetchWithRetry(
    url,
    { ...baseParams, pageNumber: "1" },
    3,
    10000
  );
  const firstBody = firstResp.data;
  if (!firstBody?.success || !firstBody?.result?.data) {
    throw new Error("datacenter 返回异常");
  }

  const total: number = firstBody.result.count;
  const pages: number = firstBody.result.pages;
  const allData: DirEntry[] = firstBody.result.data.map(
    (item: { SECURITY_CODE: string; SECURITY_NAME_ABBR: string; SECUCODE: string }) => ({
      code: item.SECURITY_CODE,
      name: item.SECURITY_NAME_ABBR,
      market: marketFromSecucode(item.SECUCODE),
    })
  );

  if (pages > 1) {
    const remainingPages = Array.from({ length: pages - 1 }, (_, i) => i + 2);
    const batchSize = 5;
    for (let i = 0; i < remainingPages.length; i += batchSize) {
      const batch = remainingPages.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (pn) => {
          try {
            const resp = await fetchWithRetry(
              url,
              { ...baseParams, pageNumber: String(pn) },
              2,
              10000
            );
            return (resp.data?.result?.data || []).map(
              (item: { SECURITY_CODE: string; SECURITY_NAME_ABBR: string; SECUCODE: string }) => ({
                code: item.SECURITY_CODE,
                name: item.SECURITY_NAME_ABBR,
                market: marketFromSecucode(item.SECUCODE),
              })
            );
          } catch {
            return [];
          }
        })
      );
      results.forEach((r) => allData.push(...r));
    }
  }

  stockDirectory = allData;
  directoryLoaded = true;
  console.log(`[stocks] 目录加载完成: ${stockDirectory.length} 只股票 (共${total})`);
}

async function ensureDirectory(): Promise<void> {
  if (directoryLoaded) return;
  if (!directoryLoading) {
    directoryLoading = loadDirectory()
      .then(() => {})
      .catch((err) => {
        console.error("[stocks] 目录加载失败:", err.message);
        directoryLoading = null;
        throw err;
      });
  }
  await directoryLoading;
}

// 启动时仅预加载股票目录，不再自动启动筛选
// 筛选任务改为用户点击按钮时通过 POST /screening/restart 触发
ensureDirectory().catch(() => {});

// ============ 后台筛选任务管理器 ============
const SCREENING_DAYS = 9;
interface ScreeningState {
  status: ScreeningTaskStatus;
  progress: number;
  scannedCount: number;
  totalCount: number;
  matchedCount: number;
  results: ScreeningItem[];
  startedAt: number;
  finishedAt?: number;
  duration?: number;
  error?: string;
}

let screeningState: ScreeningState = {
  status: "pending", // pending = 未启动（等待用户点击按钮触发）
  progress: 0,
  scannedCount: 0,
  totalCount: 0,
  matchedCount: 0,
  results: [],
  startedAt: 0,
};

/**
 * 启动后台全量筛选任务
 * 扫描全部A股（上证主板、深证主板、科创板、创业板），计算连续9天下跌
 */
async function startBackgroundScreening(consecutiveDays: number): Promise<void> {
  if (screeningState.status === "running") return;
  if (stockDirectory.length === 0) return;

  screeningState = {
    status: "running",
    progress: 0,
    scannedCount: 0,
    totalCount: stockDirectory.length,
    matchedCount: 0,
    results: [],
    startedAt: Date.now(),
  };

  console.log(`[screening] 开始后台全量筛选: ${stockDirectory.length} 只股票, 连跌≥${consecutiveDays}天`);

  const need = consecutiveDays + 2;
  const CONCURRENCY = 8;
  const candidates = [...stockDirectory];

  try {
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      // 检查是否已被取消（通过 status 判断）
      if (screeningState.status !== "running") {
        console.log("[screening] 任务已中止");
        return;
      }

      const batch = candidates.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (stock) => {
          try {
            const klines = await fetchSinaKline(stock.code, stock.market, need + 5);
            if (klines.length < consecutiveDays) return null;

            const recent = klines.slice(-need);
            let fallDays = 0;
            for (let j = recent.length - 1; j > 0; j--) {
              if (recent[j].close < recent[j - 1].close) {
                fallDays++;
              } else {
                break;
              }
            }

            if (fallDays >= consecutiveDays) {
              const last = klines[klines.length - 1];
              const prev = klines[klines.length - 2] || last;
              const changeAmount = last.close - prev.close;
              const changePercent = prev.close ? (changeAmount / prev.close) * 100 : 0;
              return {
                code: stock.code,
                name: stock.name,
                market: stock.market,
                price: last.close,
                changePercent,
                changeAmount,
                volume: last.volume,
                amount: 0,
                consecutiveFallDays: fallDays,
              } as ScreeningItem;
            }
            return null;
          } catch {
            return null;
          }
        })
      );

      const valid = batchResults.filter(Boolean) as ScreeningItem[];
      screeningState.results.push(...valid);
      screeningState.scannedCount += batch.length;
      screeningState.matchedCount = screeningState.results.length;
      screeningState.progress = Math.round((screeningState.scannedCount / screeningState.totalCount) * 100);

      // 每200只打印一次进度
      if (screeningState.scannedCount % 200 < CONCURRENCY) {
        console.log(`[screening] 进度: ${screeningState.scannedCount}/${screeningState.totalCount} (${screeningState.progress}%) 已找到${screeningState.matchedCount}只`);
      }
    }

    // 结果排序
    screeningState.results.sort((a, b) => b.consecutiveFallDays - a.consecutiveFallDays);
    screeningState.status = "done";
    screeningState.finishedAt = Date.now();
    screeningState.duration = screeningState.finishedAt - screeningState.startedAt;
    console.log(`[screening] 全量筛选完成: 扫描${screeningState.scannedCount}只, 找到${screeningState.matchedCount}只连跌≥${consecutiveDays}天, 耗时${screeningState.duration}ms`);
  } catch (err) {
    screeningState.status = "failed";
    screeningState.error = (err as Error).message;
    screeningState.finishedAt = Date.now();
    console.error("[screening] 筛选失败:", screeningState.error);
  }
}

/**
 * 腾讯批量实时行情
 * 返回格式: v_sh600519="1~贵州茅台~600519~1204.98~1182.19~..."
 * 字段索引: [3]=现价 [4]=昨收 [5]=开盘 [6]=成交量(手) [30]=涨跌额 [31]=涨跌幅%
 */
async function batchFetchQuotes(
  stocks: DirEntry[]
): Promise<Map<string, { price: number; changePercent: number; changeAmount: number; volume: number; amount: number }>> {
  const result = new Map<string, { price: number; changePercent: number; changeAmount: number; volume: number; amount: number }>();
  if (stocks.length === 0) return result;

  // 腾讯支持批量查询，每批最多约 50 只
  const BATCH_SIZE = 40;
  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);
    const symbols = batch.map((s) => tencentSymbol(s.code, s.market)).join(",");
    try {
      const resp = await fetchWithRetry(
        "http://qt.gtimg.cn/q=" + symbols,
        {},
        2,
        6000,
        "text"
      );
      const text: string = resp.data;
      // 解析每行: v_sh600519="...";
      const lines = text.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        const match = line.match(/v_(\w+?)="(.+?)"/);
        if (!match) continue;
        const sym = match[1];
        const fields = match[2].split("~");
        // 提取代码（去掉 sh/sz 前缀）
        const code = sym.replace(/^(sh|sz)/, "");
        if (fields.length >= 32) {
          const price = parseFloat(fields[3]) || 0;
          const prevClose = parseFloat(fields[4]) || 0;
          const volume = parseFloat(fields[6]) || 0; // 手
          const changeAmount = parseFloat(fields[30]) || 0;
          const changePercent = parseFloat(fields[31]) || 0;
          // 成交额：从 fields[37] 中提取 "price/volume/amount" 格式
          let amount = 0;
          const amountStr = fields[37] || "";
          const amountParts = amountStr.split("/");
          if (amountParts.length >= 3) {
            amount = parseFloat(amountParts[2]) || 0;
          }
          result.set(code, { price, changePercent, changeAmount, volume, amount });
        }
      }
    } catch {
      // 静默失败
    }
  }
  return result;
}

/**
 * 新浪批量实时行情
 * URL: http://hq.sinajs.cn/list=sh600519,sz000001
 * 需 Referer: https://finance.sina.com
 * 返回格式: var hq_str_sh600519="名称,开盘,昨收,现价,最高,最低,...,成交量(股),成交额(元),...";
 * 字段索引: [1]=开盘 [2]=昨收 [3]=现价 [4]=最高 [5]=最低 [8]=成交量(股) [9]=成交额(元)
 */
async function batchFetchQuotesSina(
  stocks: DirEntry[]
): Promise<Map<string, { price: number; changePercent: number; changeAmount: number; volume: number; amount: number }>> {
  const result = new Map<string, { price: number; changePercent: number; changeAmount: number; volume: number; amount: number }>();
  if (stocks.length === 0) return result;

  const BATCH_SIZE = 40;
  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);
    const symbols = batch.map((s) => tencentSymbol(s.code, s.market)).join(",");
    try {
      const resp = await axios.get(`http://hq.sinajs.cn/list=${symbols}`, {
        headers: { Referer: "https://finance.sina.com" },
        timeout: 6000,
        responseType: "text",
      });
      const lines: string[] = resp.data.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        const match = line.match(/hq_str_(\w+?)="(.+?)"/);
        if (!match) continue;
        const sym = match[1];
        const code = sym.replace(/^(sh|sz)/, "");
        const fields = match[2].split(",");
        if (fields.length >= 10) {
          const price = parseFloat(fields[3]) || 0;
          const prevClose = parseFloat(fields[2]) || 0;
          const volume = (parseFloat(fields[8]) || 0) / 100; // 股转手
          const amount = parseFloat(fields[9]) || 0;
          const changeAmount = price - prevClose;
          const changePercent = prevClose ? (changeAmount / prevClose) * 100 : 0;
          result.set(code, { price, changePercent, changeAmount, volume, amount });
        }
      }
    } catch {
      // 静默失败
    }
  }
  return result;
}

/**
 * 腾讯K线数据
 * URL: https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,200,qfq
 * 返回: data[sh600519].qfqday = [[date, open, close, high, low, volume], ...]
 */
async function fetchTencentKline(
  code: string,
  market: Market,
  period: KlinePeriod,
  count = 200
): Promise<{ klines: Array<{ date: string; open: number; close: number; high: number; low: number; volume: number; amount: number }>; name: string }> {
  const sym = tencentSymbol(code, market);
  const periodStr = period === "daily" ? "day" : period === "weekly" ? "week" : "month";
  const key = `qfq${periodStr}`;

  // 注意：必须把 param 直接拼到 URL 里，否则 axios 会把逗号 URL 编码为 %2C，
  // 腾讯 API 会返回 "param error"
  // 格式: symbol,period,start,end,count,fq （start和end为空，需要3个逗号）
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},${periodStr},,,${count},qfq`;
  const resp = await fetchWithRetry(url, {}, 3, 10000);

  // 腾讯 API 可能返回字符串而非已解析的 JSON
  let body = resp.data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      console.error("[kline] JSON parse failed, raw:", String(body).slice(0, 200));
      return { klines: [], name: "" };
    }
  }

  if (!body || body.code !== 0 || !body.data || !body.data[sym]) {
    console.error("[kline] unexpected response:", JSON.stringify(body).slice(0, 300));
    return { klines: [], name: "" };
  }

  const stockData = body.data[sym];
  const rawKlines: unknown[] = stockData[key] || stockData[periodStr] || [];

  const klines = rawKlines.map((item: unknown) => {
    const arr = item as (string | number | object)[];
    return {
      date: String(arr[0]),
      open: parseFloat(String(arr[1])) || 0,
      close: parseFloat(String(arr[2])) || 0,
      high: parseFloat(String(arr[3])) || 0,
      low: parseFloat(String(arr[4])) || 0,
      volume: parseFloat(String(arr[5])) || 0,
      amount: 0,
    };
  });

  return { klines, name: "" };
}

/**
 * 新浪财经K线数据（用于筛选和腾讯降级备用）
 * URL: https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sh600519&scale=240&ma=no&datalen=15
 * scale: 240=日K 1680=周K 7200=月K
 * 返回: [{day,open,high,low,close,volume}, ...]
 */
async function fetchSinaKline(
  code: string,
  market: Market,
  dataLen: number,
  period: KlinePeriod = "daily"
): Promise<Array<{ date: string; open: number; close: number; high: number; low: number; volume: number; amount: number }>> {
  const sym = tencentSymbol(code, market);
  const scale = period === "daily" ? 240 : period === "weekly" ? 1680 : 7200;
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=${scale}&ma=no&datalen=${dataLen}`;
  const resp = await fetchWithRetry(url, {}, 2, 8000, "text");
  let raw: string = resp.data;
  raw = raw.trim();
  if (!raw || raw === "null" || raw === "[]") return [];
  try {
    const arr = JSON.parse(raw) as Array<{ day: string; open: string; high: string; low: string; close: string; volume: string }>;
    return arr.map((item) => ({
      date: item.day,
      open: parseFloat(item.open) || 0,
      close: parseFloat(item.close) || 0,
      high: parseFloat(item.high) || 0,
      low: parseFloat(item.low) || 0,
      volume: parseFloat(item.volume) || 0,
      amount: 0,
    }));
  } catch {
    return [];
  }
}

/**
 * GET /api/stocks/list
 */
router.get("/list", async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureDirectory();

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;
    const keyword = (req.query.keyword as string)?.trim();

    let filtered = stockDirectory;
    if (keyword) {
      const kw = keyword.toLowerCase();
      filtered = stockDirectory.filter(
        (s) => s.code.includes(kw) || s.name.toLowerCase().includes(kw)
      );
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const pageData = filtered.slice(start, start + pageSize);

    if (pageData.length === 0) {
      res.json({ code: 0, data: [], total, page, pageSize } as StockListResponse);
      return;
    }

    const quotes = apiConfig.source === "sina"
      ? await batchFetchQuotesSina(pageData)
      : await batchFetchQuotes(pageData);

    const data: StockItem[] = pageData.map((s) => {
      const q = quotes.get(s.code);
      return {
        code: s.code,
        name: s.name,
        market: s.market,
        price: q?.price ?? 0,
        changePercent: q?.changePercent ?? 0,
        changeAmount: q?.changeAmount ?? 0,
        volume: q?.volume ?? 0,
        amount: q?.amount ?? 0,
      };
    });

    res.json({ code: 0, data, total, page, pageSize } as StockListResponse);
  } catch (err) {
    console.error("[stocks/list] error:", err);
    res.status(500).json({
      code: -1,
      data: [],
      total: 0,
      page: 1,
      pageSize: 50,
      error: "获取股票列表失败，请稍后重试",
    });
  }
});

/**
 * GET /api/stocks/kline
 */
router.get("/kline", async (req: Request, res: Response): Promise<void> => {
  try {
    const code = (req.query.code as string)?.trim();
    const market = req.query.market as Market | undefined;
    const period = (req.query.period as KlinePeriod) || "daily";

    if (!code) {
      res.status(400).json({ code: -1, error: "缺少股票代码" });
      return;
    }

    const m = market || marketFromCode(code);
    // 根据当前数据源选择 K线 API，若主源返回空则降级到备用源
    let klines: Array<{ date: string; open: number; close: number; high: number; low: number; volume: number; amount: number }> = [];
    let name = "";

    if (apiConfig.source === "sina") {
      // 新浪优先，降级到腾讯
      klines = await fetchSinaKline(code, m, 200, period);
      if (klines.length === 0) {
        try {
          const tencentResult = await fetchTencentKline(code, m, period);
          klines = tencentResult.klines;
          name = tencentResult.name;
        } catch {
          // 腾讯异常，忽略
        }
      }
    } else {
      // 腾讯优先（前复权），降级到新浪
      try {
        const tencentResult = await fetchTencentKline(code, m, period);
        klines = tencentResult.klines;
        name = tencentResult.name;
      } catch {
        // 腾讯异常，忽略
      }
      if (klines.length === 0) {
        klines = await fetchSinaKline(code, m, 200, period);
      }
    }

    // 从目录缓存中查找名称
    let stockName = name;
    if (!stockName) {
      const found = stockDirectory.find((s) => s.code === code);
      stockName = found?.name || "";
    }

    res.json({
      code: 0,
      data: { klines, name: stockName, code },
    } as KlineResponse);
  } catch (err) {
    console.error("[stocks/kline] error:", err);
    res.status(500).json({ code: -1, error: "获取K线数据失败" });
  }
});

/**
 * GET /api/stocks/api-source
 * 获取当前数据源
 */
router.get("/api-source", (_req: Request, res: Response): void => {
  res.json({ code: 0, data: { source: apiConfig.source } });
});

/**
 * POST /api/stocks/api-source
 * 切换数据源（sina / tencent）
 */
router.post("/api-source", (req: Request, res: Response): void => {
  const source = req.body?.source;
  if (source !== "sina" && source !== "tencent") {
    res.status(400).json({ code: -1, error: "无效的数据源，仅支持 sina 或 tencent" });
    return;
  }
  apiConfig.source = source;
  console.log(`[api-source] 数据源已切换为: ${source}`);
  res.json({ code: 0, data: { source: apiConfig.source } });
});

/**
 * GET /api/stocks/screening/status
 * 查询后台筛选任务进度和实时结果
 */
router.get("/screening/status", (_req: Request, res: Response): void => {
  res.json({
    code: 0,
    data: {
      status: screeningState.status,
      progress: screeningState.progress,
      scannedCount: screeningState.scannedCount,
      totalCount: screeningState.totalCount,
      matchedCount: screeningState.matchedCount,
      results: screeningState.results,
      startedAt: screeningState.startedAt,
      finishedAt: screeningState.finishedAt,
      duration: screeningState.duration,
      error: screeningState.error,
    },
  } as ScreeningStatusResponse);
});

/**
 * GET /api/stocks/screening
 * 返回缓存的筛选结果（后台已扫描完成则全量返回，未完成则返回空）
 */
router.get("/screening", (_req: Request, res: Response): void => {
  if (screeningState.status === "done") {
    res.json({
      code: 0,
      data: screeningState.results,
      total: screeningState.results.length,
    } as ScreeningResponse);
  } else {
    res.json({ code: 0, data: [], total: 0 } as ScreeningResponse);
  }
});

/**
 * POST /api/stocks/screening/restart
 * 启动/重新启动后台筛选任务（用户点击按钮触发）
 */
router.post("/screening/restart", (_req: Request, res: Response): void => {
  if (screeningState.status === "running") {
    screeningState.status = "pending"; // 标记为中止，循环中会检测
  }
  // 异步启动新任务
  setTimeout(() => startBackgroundScreening(SCREENING_DAYS), 100);
  res.json({ code: 0, data: { message: "筛选任务已启动" } });
});

// ============ 9日下跌历史记录（轻量级JSON文件存储） ============

const DECLINE_HISTORY_FILE = path.join(process.cwd(), "data", "decline-history.json");

interface DeclineHistoryEntry {
  code: string;
  name: string;
  market: Market;
  price: number;
}

interface DeclineHistoryData {
  [date: string]: DeclineHistoryEntry[];
}

function readDeclineHistory(): DeclineHistoryData {
  try {
    if (!fs.existsSync(DECLINE_HISTORY_FILE)) return {};
    const raw = fs.readFileSync(DECLINE_HISTORY_FILE, "utf-8");
    return JSON.parse(raw) as DeclineHistoryData;
  } catch {
    return {};
  }
}

function writeDeclineHistory(data: DeclineHistoryData): void {
  const dir = path.dirname(DECLINE_HISTORY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DECLINE_HISTORY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * POST /api/stocks/screening/history
 * 保存今天9日下跌入选的股票
 */
router.post("/screening/history", (req: Request, res: Response): void => {
  try {
    const stocks = req.body?.stocks as DeclineHistoryEntry[];
    if (!Array.isArray(stocks)) {
      res.status(400).json({ code: -1, error: "参数错误" });
      return;
    }

    const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
    const history = readDeclineHistory();
    history[today] = stocks;
    writeDeclineHistory(history);

    console.log(`[decline-history] 已保存 ${today} 的入选记录: ${stocks.length} 只`);
    res.json({ code: 0, data: { date: today, count: stocks.length } });
  } catch (err) {
    const e = err as { message?: string };
    res.status(500).json({ code: -1, error: e.message || "保存历史记录失败" });
  }
});

/**
 * GET /api/stocks/screening/history
 * 获取所有往期9日下跌入选记录
 */
router.get("/screening/history", (_req: Request, res: Response): void => {
  try {
    const history = readDeclineHistory();
    const sortedDates = Object.keys(history).sort((a, b) => b.localeCompare(a));
    const result = sortedDates.map((date) => ({
      date,
      stocks: history[date] || [],
    }));
    res.json({ code: 0, data: result });
  } catch (err) {
    const e = err as { message?: string };
    res.status(500).json({ code: -1, error: e.message || "读取历史记录失败" });
  }
});

/**
 * GET /api/stocks/intraday?code=600120&market=sh
 * 返回当日1分钟K线数据（分时图用，9:30-15:00完整交易日）
 * 使用新浪API: scale=1, datalen=240
 */
router.get("/intraday", async (req: Request, res: Response): Promise<void> => {
  const code = (req.query.code as string || "").trim();
  const market = (req.query.market as string || marketFromCode(code)) as Market;

  if (!code) {
    res.status(400).json({ code: -1, error: "缺少 code 参数" });
    return;
  }

  try {
    const sym = tencentSymbol(code, market);
    // 新浪5分钟K线，datalen=48 覆盖一个完整交易日（9:30-11:30 + 13:00-15:00 = 240分钟 / 5 = 48根）
    const url = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";
    const resp = await axios.get(url, {
      params: { symbol: sym, scale: 5, ma: "no", datalen: 48 },
      timeout: 8000,
    });

    const raw = resp.data;
    if (!Array.isArray(raw)) {
      res.status(502).json({ code: -1, error: "新浪接口返回异常" });
      return;
    }

    // 找到最近一个有数据的交易日
    // 新浪API返回的240根1分钟K线可能跨越多天，取最后出现的日期
    let lastTradeDate = "";
    for (const item of raw) {
      const day = (item as { day: string }).day;
      if (day) {
        const datePart = day.slice(0, 10); // YYYY-MM-DD
        if (datePart > lastTradeDate) lastTradeDate = datePart;
      }
    }

    if (!lastTradeDate) {
      res.json({ code: 0, data: { code, name: "", prevClose: 0, points: [] } });
      return;
    }

    // 只保留最近交易日的数据
    const todayData = raw
      .filter((item: { day: string }) => item.day?.startsWith(lastTradeDate))
      .map((item: { day: string; open: string; high: string; low: string; close: string; volume: string }) => ({
        time: item.day.slice(11, 16), // HH:mm
        price: parseFloat(item.close),
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        volume: parseFloat(item.volume),
      }));

    // 获取昨收价（从实时行情中提取）和股票名称
    let prevClose = 0;
    let name = "";
    // 优先从目录缓存获取名称（UTF-8）
    const dirEntry = stockDirectory.find((d) => d.code === code);
    if (dirEntry) name = dirEntry.name;
    try {
      if (apiConfig.source === "sina") {
        const rtResp = await axios.get(`http://hq.sinajs.cn/list=${sym}`, {
          headers: { Referer: "https://finance.sina.com" },
          timeout: 5000,
          responseType: "text",
        });
        const match = rtResp.data.match(/="(.+?)"/);
        if (match) {
          const fields = match[1].split(",");
          if (!name) name = fields[0] || ""; // 只在目录缓存没有时才用API名称
          prevClose = parseFloat(fields[2]) || 0;
        }
      } else {
        const rtResp = await axios.get(`http://qt.gtimg.cn/q=${sym}`, {
          timeout: 5000,
          responseType: "text",
        });
        const match = rtResp.data.match(/v_\w+?="(.+?)"/);
        if (match) {
          const fields = match[1].split("~");
          if (!name) name = fields[1] || ""; // 腾讯返回GBK编码，优先用目录缓存
          prevClose = parseFloat(fields[4]) || 0;
        }
      }
    } catch {
      // 静默失败
    }

    res.json({
      code: 0,
      data: {
        code,
        name,
        prevClose,
        points: todayData,
      },
    });
  } catch (err) {
    const e = err as { message?: string };
    res.status(500).json({ code: -1, error: e.message || "获取分时数据失败" });
  }
});

/**
 * GET /api/stocks/realtime?code=600120&market=sh
 * 返回单只股票的实时行情（用于实时股价图表轮询）
 */
router.get("/realtime", async (req: Request, res: Response): Promise<void> => {
  const code = (req.query.code as string || "").trim();
  const market = (req.query.market as string || marketFromCode(code)) as Market;

  if (!code) {
    res.status(400).json({ code: -1, error: "缺少 code 参数" });
    return;
  }

  try {
    const sym = tencentSymbol(code, market);

    if (apiConfig.source === "sina") {
      // 新浪实时行情
      const resp = await axios.get(`http://hq.sinajs.cn/list=${sym}`, {
        headers: { Referer: "https://finance.sina.com" },
        timeout: 5000,
        responseType: "text",
      });
      const text: string = resp.data;
      const match = text.match(/="(.+?)"/);
      if (match) {
        const fields = match[1].split(",");
        if (fields.length >= 10) {
          const open = parseFloat(fields[1]) || 0;
          const prevClose = parseFloat(fields[2]) || 0;
          const price = parseFloat(fields[3]) || 0;
          const high = parseFloat(fields[4]) || 0;
          const low = parseFloat(fields[5]) || 0;
          const volume = parseFloat(fields[8]) || 0; // 股
          const amount = parseFloat(fields[9]) || 0; // 元
          const changeAmount = price - prevClose;
          const changePercent = prevClose > 0 ? (changeAmount / prevClose) * 100 : 0;
          res.json({
            code: 0,
            data: {
              code,
              name: fields[0],
              price,
              open,
              prevClose,
              high,
              low,
              volume: volume / 100, // 转为手
              amount,
              changeAmount,
              changePercent,
              time: new Date().toISOString(),
            },
          });
          return;
        }
      }
      res.status(502).json({ code: -1, error: "新浪接口返回异常" });
    } else {
      // 腾讯实时行情
      const resp = await axios.get(`http://qt.gtimg.cn/q=${sym}`, {
        timeout: 5000,
        responseType: "text",
      });
      const text: string = resp.data;
      const match = text.match(/v_\w+?="(.+?)"/);
      if (match) {
        const fields = match[1].split("~");
        if (fields.length >= 32) {
          const price = parseFloat(fields[3]) || 0;
          const prevClose = parseFloat(fields[4]) || 0;
          const open = parseFloat(fields[5]) || 0;
          const volume = parseFloat(fields[6]) || 0; // 手
          const high = parseFloat(fields[33]) || 0;
          const low = parseFloat(fields[34]) || 0;
          const changeAmount = parseFloat(fields[30]) || 0;
          const changePercent = parseFloat(fields[31]) || 0;
          let amount = 0;
          const amountStr = fields[37] || "";
          const amountParts = amountStr.split("/");
          if (amountParts.length >= 3) amount = parseFloat(amountParts[2]) || 0;
          res.json({
            code: 0,
            data: {
              code,
              name: fields[1],
              price,
              open,
              prevClose,
              high,
              low,
              volume,
              amount,
              changeAmount,
              changePercent,
              time: new Date().toISOString(),
            },
          });
          return;
        }
      }
      res.status(502).json({ code: -1, error: "腾讯接口返回异常" });
    }
  } catch (err) {
    const e = err as { message?: string };
    res.status(500).json({ code: -1, error: e.message || "获取实时行情失败" });
  }
});

/** 导出目录访问函数（供其他路由使用） */
export function getStockDirectory(): DirEntry[] {
  return stockDirectory;
}

export default router;
