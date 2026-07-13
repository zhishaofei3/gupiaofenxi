# 量化交易分析功能说明

## 源文件

`src/stock_requests.py` — 基于 Python 的 A 股量化选股脚本。

## 核心功能

对预定义的约 200 只股票池进行实时技术面扫描，筛选出符合条件的标的。

## 数据源（全部为新浪财经线上 API）

| 数据 | API | 用途 |
|------|-----|------|
| 实时价格 | `http://hq.sinajs.cn/list={code}` | 当前价 |
| 日线K线 | `money.finance.sina.com.cn/.../getKLineData?scale=240` | MA5 计算 |
| 15分钟K线 | `money.finance.sina.com.cn/.../getKLineData?scale=15` | MACD 计算 |

## 选股条件（6 项）

### 1. 涨停检测 `zt_ok`（当前已注释关闭）
- 最近 5 个交易日内是否出现过涨停
- 判定：`收盘价 / 前日收盘价 >= 1.097` 且 `收盘价 == 最高价`

### 2. MA5 支撑 `ma5_ok`
- 当前价格是否在 MA5（5日均线）附近或上方
- 判定：`当前价 >= MA5 * 0.99`（允许 1% 容差）

### 3. MACD 金叉 `cond3`
- 最近 16 根 15 分钟 K 线中，MACD 柱是否从负转正
- 判定：存在 `前一根 MACD < 0 且当前 MACD >= 0` 的时刻

### 4. DIF 上穿 DEA `cond4`
- 最近 16 根 15 分钟 K 线中，DIF 是否上穿 DEA
- 判定：存在 `前一根 DIF < 前一根 DEA 且当前 DIF > 当前 DEA` 的时刻

### 5. DIF 在零轴附近 `cond5`
- 当前 DIF 值在 -0.05 到 0.1 之间
- 说明趋势处于启动初期，非高位

### 6. DIF 在 DEA 上方 `cond6`
- 当前 `DIF > DEA`，确认多头排列

## MACD 计算公式

```
DIF  = EMA(close, 12) - EMA(close, 26)
DEA  = EMA(DIF, 9)
MACD = 2 × (DIF - DEA)
```

其中 EMA 为指数移动平均，`adjust=False`。

## 最终筛选

```python
all_ok = ma5_ok and cond3 and cond4 and cond5 and cond6
```

（`zt_ok` 涨停条件在 2026.04.23 被临时注释，当前不参与判定）

## 输出字段

| 字段 | 说明 |
|------|------|
| 代码 | 股票代码 |
| 状态 | 入选 / 不符合 |
| 价格 | 当前实时价格 |
| MA5 | 5日均线值 |
| 日线K数 | 获取到的日K数量 |
| 15分钟K数 | 获取到的15分K数量 |
| 上一根15分钟价 | 倒数第二根15分钟K线收盘价 |
