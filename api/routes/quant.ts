/**
 * 量化交易分析路由
 * 基于 stock_requests.py 的选股逻辑，使用新浪财经API实时分析
 * - 实时价格：hq.sinajs.cn
 * - 日线K线：money.finance.sina.com.cn (scale=240)
 * - 15分钟K线：money.finance.sina.com.cn (scale=15)
 * - MACD计算：DIF=EMA12-EMA26, DEA=EMA9(DIF), MACD=2*(DIF-DEA)
 */

import { Router, type Request, type Response } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import type { QuantItem, QuantResponse, Market } from "../../shared/types.js";
import { getStockDirectory, apiConfig } from "./stocks.js";

const router = Router();

// ============ 预定义股票池 ============
const STOCK_POOL: string[] = [
  "688722", "300129", "600664", "601608", "002606", "600428", "603223", "000933",
  "601858", "000920", "603698", "603162", "600685", "000887", "002970", "603236",
  "603155", "603270", "605090", "603556", "001395", "002402", "002202", "002346",
  "003020", "002479", "600129", "000938", "605377", "002185", "603020", "603339",
  "603087", "600488", "002815", "600360", "600988", "301596", "603928", "603931",
  "000975", "000977", "601100", "000021", "300718", "601689", "300018", "605319",
  "300684", "601069", "001287", "003011", "603296", "002841", "001337", "600143",
  "603757", "603012", "603303", "600120", "601121", "603165", "002536", "601369",
  "002674", "603596", "600770", "001206", "002409", "300017", "002156", "001230",
  "600584", "603726", "002546", "603005", "002632", "000811", "002152", "301607",
  "301379", "002916", "001207", "000417", "002396", "603156",
];

// ============ 工具函数 ============

/** 与Python脚本一致：仅6开头为上证，其余为深证 */
function marketFromCode(code: string): Market {
  return code.startsWith("6") ? "sh" : "sz";
}

function sinaSymbol(code: string): string {
  return `${marketFromCode(code)}${code}`;
}

/**
 * EMA（指数移动平均）— 与三方股票软件（同花顺/东方财富/通达信）一致
 * 种子值使用前N根的SMA（简单移动平均），而非第1根收盘价
 * 这是与三方软件MACD保持一致的关键
 */
function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);

  if (values.length === 0) return result;

  // 前 period-1 根：无法计算EMA，用收盘价填充（三方软件也是逐步填充）
  for (let i = 0; i < Math.min(period - 1, values.length); i++) {
    result.push(values[i]);
  }

  // 第 period 根：种子值 = 前N根的SMA
  if (values.length >= period) {
    let sma = 0;
    for (let i = 0; i < period; i++) {
      sma += values[i];
    }
    sma /= period;
    result.push(sma);

    // 从第 period+1 根开始递推
    let prev = sma;
    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      result.push(prev);
    }
  }

  return result;
}

/**
 * 计算MACD — 与三方股票软件算法一致
 * DIF = EMA(close, 12) - EMA(close, 26)
 * DEA = EMA(DIF, 9)
 * MACD = 2 * (DIF - DEA)
 */
function calcMACD(closes: number[]): { dif: number[]; dea: number[]; macd: number[] } {
  if (closes.length === 0) return { dif: [], dea: [], macd: [] };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const dif = closes.map((_, i) => ema12[i] - ema26[i]);
  const dea = ema(dif, 9);
  const macd = dif.map((d, i) => 2 * (d - dea[i]));
  return { dif, dea, macd };
}

/** 并发控制 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ============ 数据获取 ============

/** 腾讯批量实时价格（UTF-8） */
async function batchFetchPrices(codes: string[]): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  const BATCH = 40;
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const symbols = batch.map(sinaSymbol).join(",");
    try {
      const resp = await axios.get(`http://qt.gtimg.cn/q=${symbols}`, {
        timeout: 6000,
        responseType: "text",
      });
      const lines: string[] = resp.data.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        const m = line.match(/v_(\w+?)="(.+?)"/);
        if (!m) continue;
        const sym = m[1];
        const code = sym.replace(/^(sh|sz)/, "");
        const fields = m[2].split("~");
        if (fields.length >= 4) {
          const price = parseFloat(fields[3]) || 0;
          priceMap.set(code, price);
        }
      }
    } catch {
      // 静默失败
    }
  }
  return priceMap;
}

/** 新浪批量实时价格 */
async function batchFetchPricesSina(codes: string[]): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  const BATCH = 40;
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const symbols = batch.map(sinaSymbol).join(",");
    try {
      const resp = await axios.get(`http://hq.sinajs.cn/list=${symbols}`, {
        headers: { Referer: "https://finance.sina.com" },
        timeout: 6000,
        responseType: "text",
      });
      const lines: string[] = resp.data.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        const m = line.match(/hq_str_(\w+?)="(.+?)"/);
        if (!m) continue;
        const sym = m[1];
        const code = sym.replace(/^(sh|sz)/, "");
        const fields = m[2].split(",");
        if (fields.length >= 4) {
          const price = parseFloat(fields[3]) || 0;
          priceMap.set(code, price);
        }
      }
    } catch {
      // 静默失败
    }
  }
  return priceMap;
}

/** 新浪K线数据（K线始终使用新浪API，不受接口切换影响） */
async function fetchSinaKline(
  code: string,
  scale: number,
  datalen: number
): Promise<Array<{ date: string; open: number; close: number; high: number; low: number; volume: number }>> {
  const sym = sinaSymbol(code);
  const url = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";
  try {
    const resp = await axios.get(url, {
      params: { symbol: sym, scale, ma: "no", datalen },
      timeout: 5000,
    });
    const raw = resp.data;
    if (!Array.isArray(raw)) return [];
    return raw.map((item: Record<string, string>) => ({
      date: item.day,
      open: parseFloat(item.open) || 0,
      close: parseFloat(item.close) || 0,
      high: parseFloat(item.high) || 0,
      low: parseFloat(item.low) || 0,
      volume: parseFloat(item.volume) || 0,
    }));
  } catch {
    return [];
  }
}

// ============ 核心选股逻辑 ============

async function analyzeStock(
  code: string,
  price: number,
  name: string
): Promise<QuantItem> {
  const market = marketFromCode(code);

  // 并行获取日K和15分K
  // 15分K取200根：足够EMA26预热，使MACD值与三方软件一致
  const [dayKline, min15Kline] = await Promise.all([
    fetchSinaKline(code, 240, 10),
    fetchSinaKline(code, 15, 200),
  ]);

  // MA5 计算（与Python一致：rolling(5).mean().iloc[-1]）
  let ma5 = 0;
  let ztOk = false;
  if (dayKline.length >= 5) {
    const closes = dayKline.map((k) => k.close);
    ma5 = closes.slice(-5).reduce((s, c) => s + c, 0) / 5;
  }

  // 涨停检测（与Python一致：close/pre_close >= 1.097 且 close==high，最近5日）
  // Python中zt_ok已注释，不参与最终判定，但仍计算并展示
  if (dayKline.length >= 6) {
    for (let i = dayKline.length - 5; i < dayKline.length; i++) {
      const preClose = dayKline[i - 1].close;
      if (preClose > 0 && dayKline[i].close / preClose >= 1.097 && dayKline[i].close === dayKline[i].high) {
        ztOk = true;
        break;
      }
    }
  }

  const ma5Ok = ma5 !== 0 ? price >= ma5 * 0.99 : false;

  // 15分钟 MACD
  let macdCross = false;
  let difCrossDea = false;
  let difNearZero = false;
  let difAboveDea = false;
  let last15Price = 0;

  if (min15Kline.length >= 2) {
    last15Price = min15Kline[min15Kline.length - 2].close;
  }

  if (min15Kline.length >= 16) {
    const closes = min15Kline.map((k) => k.close);
    const { dif, dea, macd } = calcMACD(closes);

    // 仅打印 600120 的 MACD 原始数据
    if (code === "600120") {
      console.log(`\n[quant] ===== 600120 MACD原始数据 (15分钟·新浪API) =====`);
      console.log(JSON.stringify({ dif, dea, macd }, null, 2));
      console.log(`========================================================\n`);
    }

    // 最近16根
    const recent16Start = dif.length - 16;
    for (let i = recent16Start + 1; i < dif.length; i++) {
      // cond3: MACD 从负转正
      if (macd[i - 1] < 0 && macd[i] >= 0) macdCross = true;
      // cond4: DIF 上穿 DEA
      if (dif[i - 1] < dea[i - 1] && dif[i] > dea[i]) difCrossDea = true;
    }

    // cond5: DIF 在零轴附近 (-0.05, 0.1)
    const currDif = dif[dif.length - 1];
    difNearZero = currDif > -0.05 && currDif < 0.1;

    // cond6: DIF > DEA
    difAboveDea = currDif > dea[dea.length - 1];
  }

  const conditions = {
    ztOk,
    ma5Ok,
    macdCross,
    difCrossDea,
    difNearZero,
    difAboveDea,
  };
  // Python: all_ok = ma5_ok and cond3 and cond4 and cond5 and cond6 (zt_ok已注释，不参与判定)
  const passed = ma5Ok && macdCross && difCrossDea && difNearZero && difAboveDea;

  return {
    code,
    name,
    market,
    price: Math.round(price * 100) / 100,
    ma5: Math.round(ma5 * 100) / 100,
    dayCount: dayKline.length,
    min15Count: min15Kline.length,
    last15Price: Math.round(last15Price * 100) / 100,
    conditions,
    passed,
  };
}

// ============ 缓存 ============
interface QuantCache {
  results: QuantItem[];
  total: number;
  passedCount: number;
  scannedCount: number;
  duration: number;
  timestamp: number;
}
let quantCache: QuantCache | null = null;
const CACHE_TTL = 60 * 1000; // 60秒缓存

// ============ 路由 ============

/**
 * GET /api/stocks/quant
 * 量化分析股票池
 */
router.get("/quant", async (req: Request, res: Response): Promise<void> => {
  try {
    // 检查缓存
    const force = req.query.force === "1";
    if (!force && quantCache && Date.now() - quantCache.timestamp < CACHE_TTL) {
      res.json({
        code: 0,
        data: {
          results: quantCache.results,
          total: quantCache.total,
          passedCount: quantCache.passedCount,
          scannedCount: quantCache.scannedCount,
          duration: quantCache.duration,
        },
      } as QuantResponse);
      return;
    }

    const startTime = Date.now();

    // 1. 批量获取实时价格（根据当前数据源切换）
    const priceMap = apiConfig.source === "sina"
      ? await batchFetchPricesSina(STOCK_POOL)
      : await batchFetchPrices(STOCK_POOL);

    // 2. 从目录缓存获取股票名称（UTF-8，避免腾讯API的GBK编码乱码）
    const dir = getStockDirectory();
    const nameMap = new Map<string, string>();
    for (const item of dir) {
      if (STOCK_POOL.includes(item.code)) {
        nameMap.set(item.code, item.name);
      }
    }

    // 3. 并发分析所有股票（并发数8）
    const CONCURRENCY = 8;
    const results = await mapWithConcurrency(
      STOCK_POOL,
      CONCURRENCY,
      (code) => analyzeStock(code, priceMap.get(code) || 0, nameMap.get(code) || code)
    );

    const duration = Date.now() - startTime;
    const passedCount = results.filter((r) => r.passed).length;

    // 更新缓存
    quantCache = {
      results,
      total: STOCK_POOL.length,
      passedCount,
      scannedCount: results.length,
      duration,
      timestamp: Date.now(),
    };

    res.json({
      code: 0,
      data: {
        results,
        total: STOCK_POOL.length,
        passedCount,
        scannedCount: results.length,
        duration,
      },
    } as QuantResponse);
  } catch (err) {
    console.error("[quant] error:", err);
    res.status(500).json({ code: -1, error: "量化分析失败" });
  }
});

// ============ 量化入选历史记录（轻量级JSON文件存储） ============

const HISTORY_FILE = path.join(process.cwd(), "data", "quant-history.json");

interface HistoryEntry {
  code: string;
  name: string;
  market: Market;
  price: number; // 入选时价格
}

interface HistoryData {
  [date: string]: HistoryEntry[];
}

/** 确保数据目录存在 */
function ensureDataDir(): void {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 读取历史记录 */
function readHistory(): HistoryData {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return {};
    const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
    return JSON.parse(raw) as HistoryData;
  } catch {
    return {};
  }
}

/** 写入历史记录 */
function writeHistory(data: HistoryData): void {
  ensureDataDir();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/** 获取今天的日期 YYYY-MM-DD */
function getToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * POST /api/stocks/quant/history
 * 保存今天入选的股票（每次访问 /quant 页面时调用）
 */
router.post("/quant/history", (req: Request, res: Response): void => {
  try {
    const passedStocks = req.body?.stocks as HistoryEntry[];
    if (!Array.isArray(passedStocks)) {
      res.status(400).json({ code: -1, error: "参数错误" });
      return;
    }

    const today = getToday();
    const history = readHistory();

    // 保存/覆盖今天的数据
    history[today] = passedStocks;
    writeHistory(history);

    console.log(`[quant-history] 已保存 ${today} 的入选记录: ${passedStocks.length} 只`);
    res.json({ code: 0, data: { date: today, count: passedStocks.length } });
  } catch (err) {
    const e = err as { message?: string };
    res.status(500).json({ code: -1, error: e.message || "保存历史记录失败" });
  }
});

/**
 * GET /api/stocks/quant/history
 * 获取所有往期入选记录
 * 返回按日期倒序排列的全部历史数据
 */
router.get("/quant/history", (_req: Request, res: Response): void => {
  try {
    const history = readHistory();
    // 按日期倒序排列
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

export default router;
