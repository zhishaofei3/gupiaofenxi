# 股析 · A股看盘

股票分析网站，调用开放API获取实时行情和K线数据，支持全量A股列表浏览、K线图查看（日/周/月K）和连续9天下跌股票筛选。

## 技术栈

- **前端**：React 18 + TypeScript + Vite + TailwindCSS + ECharts + Zustand
- **后端**：Express.js + Axios（API代理层）
- **数据源**：
  - 股票目录：东方财富 datacenter-web.eastmoney.com
  - 实时行情：腾讯财经 qt.gtimg.cn
  - K线数据：腾讯 web.ifzq.gtimg.cn（前复权）→ 新浪 finance.sina.com.cn（自动降级）
  - 筛选扫描：新浪财经 CN_MarketData.getKLineData

## 环境要求

- Node.js >= 18
- npm >= 9

## 安装依赖

```bash
npm install
```

## 启动命令

```bash
npm run dev
```

该命令会同时启动前端开发服务器和后端API服务：

- **前端**：http://localhost:5173/ （Vite 开发服务器）
- **后端**：http://localhost:3001/ （Express API 服务）

启动后浏览器访问 http://localhost:5173/ 即可使用。

## 其他命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 同时启动前端+后端开发服务器 |
| `npm run client:dev` | 仅启动前端 |
| `npm run server:dev` | 仅启动后端（nodemon 热重载） |
| `npm run build` | 构建生产版本 |
| `npm run check` | TypeScript 类型检查 |

## 功能说明

### 股票列表
- 启动时自动加载全量5536只A股（上证主板、深证主板、科创板、创业板）
- 支持按代码或名称搜索
- 左侧列表分页展示，实时行情每页50只

### K线图
- 点击左侧任意股票，右侧展示K线图
- 支持日K / 周K / 月K切换
- 蜡烛图 + MA5/MA10/MA20均线 + 成交量
- 红涨绿跌（A股惯例）

### 连续9天下跌筛选
- 服务器启动后自动在后台扫描全量5536只股票
- 右上角按钮显示实时进度（如"筛选中 2448/5536 44%"）
- 扫描完成后按钮亮起，点击即可查看所有连续9天下跌的股票
- 全量扫描约65秒完成，结果缓存在内存中
