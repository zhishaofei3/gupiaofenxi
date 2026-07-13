/**
 * 数字格式化工具
 */

/** 格式化价格：保留2位小数 */
export function formatPrice(n: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "--";
  return n.toFixed(2);
}

/** 格式化涨跌幅：+/-X.XX% */
export function formatPercent(n: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "--";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** 格式化成交量（手） */
export function formatVolume(n: number): string {
  if (!n) return "--";
  if (n >= 100000000) return (n / 100000000).toFixed(2) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(2) + "万";
  return String(n);
}

/** 格式化成交额（元） */
export function formatAmount(n: number): string {
  if (!n) return "--";
  if (n >= 100000000) return (n / 100000000).toFixed(2) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(2) + "万";
  return n.toFixed(0);
}

/** 涨跌幅颜色类名 */
export function changeColor(n: number): string {
  if (n > 0) return "text-rise";
  if (n < 0) return "text-fall";
  return "text-text-secondary";
}
