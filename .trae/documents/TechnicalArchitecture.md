## 1. 架构设计

```mermaid
flowchart TD
    subgraph "前端层 Frontend"
        "React 18 + Vite" --> "股票列表组件"
        "React 18 + Vite" --> "K线图组件 ECharts"
        "React 18 + Vite" --> "搜索筛选组件"
    end

    subgraph "后端代理层 Backend Proxy"
        "Express Server" --> "股票列表接口"
        "Express Server" --> "K线数据接口"
        "Express Server" --> "筛选计算接口"
    end

    subgraph "外部数据源 External APIs"
        "东方财富 API" --> "沪深A股列表"
        "东方财富 API" --> "日/周/月K线数据"
        "新浪财经 API" --> "实时行情备用"
    end

    "股票列表组件" --> "股票列表接口"
    "K线图组件 ECharts" --> "K线数据接口"
    "搜索筛选组件" --> "筛选计算接口"
    "股票列表接口" --> "东方财富 API"
    "K线数据接口" --> "东方财富 API"
    "筛选计算接口" --> "东方财富 API"
```

## 2. 技术说明
- **前端**：React@18 + tailwindcss@3 + vite + echarts@5 + axios
- **初始化工具**：vite-init（React 模板）
- **后端**：Express@4（用作 API 代理，解决 CORS 与统一数据格式）
- **数据库**：无，全部实时从公开 API 获取
- **外部 API**：东方财富公开接口（`push2.eastmoney.com` / `push2his.eastmoney.com`）

## 3. 路由定义
| 路由 | 用途 |
|------|------|
| `/` | 主页，包含股票列表、搜索、K线图、筛选功能 |

## 4. API 定义

### 4.1 后端代理接口（Express）

#### 4.1.1 获取沪深A股列表
```typescript
GET /api/stocks/list
Query: { page: number, pageSize: number, keyword?: string }
Response: {
  code: number;
  data: Array<{
    code: string;        // 股票代码
    name: string;        // 股票名称
    market: 'sh' | 'sz'; // 市场
    price: number;       // 最新价
    changePercent: number; // 涨跌幅
    changeAmount: number;  // 涨跌额
    volume: number;        // 成交量
    amount: number;        // 成交额
  }>;
  total: number;
}
```

#### 4.1.2 获取K线数据
```typescript
GET /api/stocks/kline
Query: { code: string, market: 'sh'|'sz', period: 'daily'|'weekly'|'monthly' }
Response: {
  code: number;
  data: {
    klines: Array<{
      date: string;    // 日期
      open: number;    // 开盘价
      close: number;   // 收盘价
      high: number;    // 最高价
      low: number;     // 最低价
      volume: number;  // 成交量
      amount: number;  // 成交额
    }>;
  }
}
```

#### 4.1.3 筛选连续9天下跌股票
```typescript
GET /api/stocks/screening
Query: { consecutiveDays?: number } // 默认9
Response: {
  code: number;
  data: Array<{
    code: string;
    name: string;
    market: 'sh'|'sz';
    price: number;
    changePercent: number;
    consecutiveFallDays: number; // 连续下跌天数
  }>;
}
```

### 4.2 外部 API（东方财富）

#### 股票列表
```
GET http://82.push2.eastmoney.com/api/qt/clist/get
Params: {
  pn: 页码,
  pz: 每页数量,
  po: 1,
  np: 1,
  fltt: 2,
  invt: 2,
  fid: f3,           // 按涨跌幅排序
  fs: m:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048,  // 沪深A股
  fields: f12,f14,f2,f3,f4,f5,f6  // 代码,名称,最新价,涨跌幅,涨跌额,成交量,成交额
}
```

#### K线数据
```
GET http://push2his.eastmoney.com/api/qt/stock/kline/get
Params: {
  secid: 市场.代码,    // 如 1.600000（沪）0.000001（深）
  klt: 101/102/103,   // 101日K 102周K 103月K
  fqt: 1,             // 前复权
  lmt: 200,           // 获取数量
  end: 20500101,
  fields1: f1,f2,f3,f4,f5,f6,
  fields2: f51,f52,f53,f54,f55,f56,f57,f58
}
```

## 5. 服务端架构图

```mermaid
flowchart LR
    "Controller 路由层" --> "Service 业务层"
    "Service 业务层" --> "HTTP Client 数据层"
    "HTTP Client 数据层" --> "东方财富 API"
```

### 目录结构
```
server/
├── index.js              # Express 入口
├── routes/
│   └── stocks.js         # 股票相关路由
├── services/
│   ├── stockList.js      # 获取列表
│   ├── stockKline.js     # 获取K线
│   └── screening.js      # 筛选计算
└── utils/
    └── httpClient.js     # 统一HTTP请求封装
```

## 6. 数据模型

本项目不使用数据库，所有数据实时获取。前端缓存层使用 React Query 或 SWR 进行短期缓存。

### 6.1 前端状态模型
```typescript
interface StockItem {
  code: string;
  name: string;
  market: 'sh' | 'sz';
  price: number;
  changePercent: number;
  changeAmount: number;
  volume: number;
  amount: number;
}

interface KlineItem {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
}

interface AppState {
  stockList: StockItem[];
  selectedStock: StockItem | null;
  klineData: KlineItem[];
  klinePeriod: 'daily' | 'weekly' | 'monthly';
  screeningResults: StockItem[];
  loading: boolean;
}
```
