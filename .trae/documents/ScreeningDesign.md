# 连续9天下跌股票筛选 — 设计文档

## 一、当前实现逻辑

### 1.1 整体流程

```
用户点击"连续9天下跌"按钮
        │
        ▼
前端 store.runScreening()
  → POST /api/stocks/screening?consecutiveDays=9&sampleSize=500
        │
        ▼
后端同步执行：
  1. 从 5536 只股票中随机采样 500 只
  2. 对每只股票调用新浪K线API获取最近16条日K数据
  3. 逐只计算连续下跌天数
  4. 过滤出连跌≥9天的股票
  5. 返回结果 JSON
        │
        ▼
前端渲染筛选结果列表（等待 ~8 秒）
```

### 1.2 核心代码逻辑

**后端筛选算法**（`api/routes/stocks.ts` `/screening` 路由）：

```typescript
// 1. 随机采样
const shuffled = [...stockDirectory].sort(() => Math.random() - 0.5);
const candidates = shuffled.slice(0, sampleSize); // 默认500只

// 2. 并发拉取K线（每批10只）
const CONCURRENCY = 10;
for (let i = 0; i < candidates.length; i += CONCURRENCY) {
  const batch = candidates.slice(i, i + CONCURRENCY);
  const batchResults = await Promise.all(
    batch.map(async (stock) => {
      // 调用新浪API: scale=240(日K), datalen=16
      const klines = await fetchSinaKline(stock.code, stock.market, 16);
      
      // 3. 计算连续下跌天数
      const recent = klines.slice(-11); // 取最近11条
      let fallDays = 0;
      for (let j = recent.length - 1; j > 0; j--) {
        if (recent[j].close < recent[j - 1].close) {
          fallDays++;  // 今日收盘 < 昨日收盘 → 下跌
        } else {
          break;       // 遇到上涨则中断
        }
      }
      
      // 4. 筛选符合条件的
      if (fallDays >= 9) {
        return { code, name, price, consecutiveFallDays: fallDays, ... };
      }
      return null;
    })
  );
}

// 5. 按连跌天数排序返回
results.sort((a, b) => b.consecutiveFallDays - a.consecutiveFallDays);
```

**连续下跌判定规则**：
- 从最近一个交易日往前追溯
- 逐日比较：`当日收盘价 < 前一日收盘价` → 计1天
- 遇到非下跌日立即中断（不累计非连续的下跌）
- 连续下跌天数 ≥ 9 → 符合条件

**数据源**：新浪财经 `CN_MarketData.getKLineData`，scale=240（日K），datalen=16

### 1.3 当前方案的问题

| 问题 | 说明 |
|------|------|
| **同步阻塞** | 用户点击后HTTP请求持续8~15秒，前端只能显示loading |
| **超时风险** | 500只样本约8秒，若扫全量5536只需80秒+，超过Vite代理120秒超时 |
| **覆盖不全** | 随机采样500只仅覆盖9%，大部分股票未被扫描 |
| **无法重试** | 请求失败后需重新点击，已扫描的进度丢失 |
| **无进度反馈** | 用户不知道扫描进度，体验差 |

---

## 二、异步任务方案设计（建议）

### 2.1 核心思路

将筛选从**同步HTTP请求**改为**后台异步任务**：

```
用户点击"开始筛选"
        │
        ▼
POST /api/stocks/screening/start
  → 立即返回 { taskId: "xxx" }
        │
        ▼  （后台任务开始执行）
前端定期轮询 GET /api/stocks/screening/status/:taskId
  → 返回 { status: "running", progress: 45%, matched: 3 }
        │
        ▼  （任务完成）
GET /api/stocks/screening/status/:taskId
  → 返回 { status: "done", progress: 100%, results: [...] }
```

### 2.2 后端任务管理器

```typescript
// api/screening/taskManager.ts

interface ScreeningTask {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  progress: number;        // 0~100
  scannedCount: number;    // 已扫描
  totalCount: number;      // 总数
  matchedCount: number;    // 已找到符合条件的
  results: ScreeningItem[];// 实时结果
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

class ScreeningTaskManager {
  private tasks = new Map<string, ScreeningTask>();
  
  createTask(consecutiveDays: number, sampleSize: number): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task: ScreeningTask = {
      id, status: "pending", progress: 0,
      scannedCount: 0, totalCount: sampleSize,
      matchedCount: 0, results: [], startedAt: Date.now(),
    };
    this.tasks.set(id, task);
    // 异步启动，不阻塞
    this.runTask(id, consecutiveDays, sampleSize);
    return id;
  }
  
  private async runTask(id: string, days: number, sampleSize: number) {
    const task = this.tasks.get(id)!;
    task.status = "running";
    
    const candidates = this.pickCandidates(sampleSize);
    const BATCH = 10;
    
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const results = await this.scanBatch(batch, days);
      task.results.push(...results);
      task.scannedCount += batch.length;
      task.matchedCount = task.results.length;
      task.progress = Math.round((task.scannedCount / task.totalCount) * 100);
    }
    
    task.status = "done";
    task.finishedAt = Date.now();
  }
  
  getTask(id: string): ScreeningTask | undefined {
    return this.tasks.get(id);
  }
}
```

### 2.3 API 设计

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/stocks/screening/start` | POST | 创建筛选任务，立即返回 taskId |
| `/api/stocks/screening/status/:taskId` | GET | 查询任务进度和实时结果 |
| `/api/stocks/screening/cancel/:taskId` | POST | 取消正在运行的任务 |

**启动任务**：
```http
POST /api/stocks/screening/start
Body: { "consecutiveDays": 9, "sampleSize": 5536 }

Response 200:
{ "code": 0, "data": { "taskId": "task_1720000000_abc123" } }
```

**轮询进度**：
```http
GET /api/stocks/screening/status/task_1720000000_abc123

Response 200 (运行中):
{
  "code": 0,
  "data": {
    "status": "running",
    "progress": 45,
    "scannedCount": 2491,
    "totalCount": 5536,
    "matchedCount": 2,
    "results": [
      { "code": "688337", "name": "普源精电", "consecutiveFallDays": 8, ... }
    ]
  }
}

Response 200 (完成):
{
  "code": 0,
  "data": {
    "status": "done",
    "progress": 100,
    "scannedCount": 5536,
    "matchedCount": 5,
    "results": [ ... ],
    "duration": 82340  // 耗时(ms)
  }
}
```

### 2.4 前端交互流程

```typescript
// store/stockStore.ts

runScreening: async (days?: number) => {
  set({ screeningLoading: true, screeningMode: true });
  
  // 1. 启动任务
  const { taskId } = await startScreeningTask(days || 9, 5536);
  
  // 2. 轮询进度
  const poll = async () => {
    const { status, progress, results, matchedCount } = await getScreeningStatus(taskId);
    
    // 实时更新已找到的结果
    set({ screeningResults: results, screeningProgress: progress });
    
    if (status === "done") {
      set({ screeningLoading: false });
      return;
    }
    if (status === "failed") {
      set({ screeningLoading: false, error: "筛选失败" });
      return;
    }
    
    // 继续轮询（每2秒）
    setTimeout(poll, 2000);
  };
  poll();
}
```

### 2.5 UI 进度展示

```
┌──────────────────────────────────────┐
│  筛选中...  ████████░░░░  68%        │
│  已扫描 3764/5536 · 已找到 3 只      │
│                                      │
│  688337 普源精电  连跌8天  54.58     │
│  301024 霍普股份  连跌7天  31.57     │
│  ...                                 │
└──────────────────────────────────────┘
```

### 2.6 方案对比

| 维度 | 当前同步方案 | 异步任务方案 |
|------|-------------|-------------|
| 响应速度 | 8~15秒阻塞 | 立即响应，2秒出首批结果 |
| 超时风险 | 高（全量扫描必超时） | 无（HTTP请求秒回） |
| 扫描覆盖 | 500只（9%） | 全量5536只（100%） |
| 进度反馈 | 无 | 实时进度+已找到结果 |
| 失败恢复 | 重新点击 | 可断点续扫 |
| 并发限制 | 单次请求 | 多用户可同时创建任务 |

### 2.7 进一步优化方向

1. **定时任务缓存**：每日收盘后（15:30）自动全量扫描一次，结果缓存到内存/文件，用户点击时直接返回缓存结果，0等待
2. **增量扫描**：记录上次扫描时间，仅对期间有交易的股票重新扫描
3. **WebSocket推送**：用WS替代轮询，任务有新结果时实时推送到前端
4. **结果持久化**：将扫描结果存入SQLite，支持历史查询和趋势对比

---

## 三、总结

当前同步方案适合**小样本快速预览**（500只/8秒），但无法满足全量扫描需求。建议采用**异步任务方案**：

- 立即返回 taskId，后台全量扫描
- 前端轮询进度，实时展示已找到的股票
- 用户无需等待，可随时查看部分结果
- 支持全量5536只股票扫描，覆盖率100%
