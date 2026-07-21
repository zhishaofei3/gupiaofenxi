/**
 * 股票池管理面板
 * 侧边滑出：展示当前股票池列表 + 支持单个删除 + textarea批量更新
 */

import { useState, useEffect, useCallback } from "react";
import { X, ListChecks, Loader2, Plus, Trash2 } from "lucide-react";
import { fetchStockPool, updateStockPool, removeStockFromPool, type PoolStock } from "@/api/stockApi";

interface StockPoolPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function StockPoolPanel({ open, onClose }: StockPoolPanelProps) {
  const [stocks, setStocks] = useState<PoolStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetchStockPool();
      setStocks(resp.data.stocks);
    } catch {
      setError("加载股票池失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // 删除单只
  const handleRemove = async (code: string) => {
    try {
      await removeStockFromPool(code);
      setStocks((prev) => prev.filter((s) => s.code !== code));
    } catch {
      setError("删除失败");
    }
  };

  // 解析 textarea：支持换行、英文逗号、空格分隔
  const parseBatch = (text: string): string[] => {
    return text
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^\d{6}$/.test(s));
  };

  // 批量更新
  const handleBatchUpdate = async () => {
    const codes = parseBatch(batchText);
    if (codes.length === 0) {
      setError("未识别到合法的6位股票代码");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (mode === "replace") {
        await updateStockPool(codes);
      } else {
        // 追加模式：合并已有 + 新增（去重）
        const existing = stocks.map((s) => s.code);
        const merged = Array.from(new Set([...existing, ...codes]));
        await updateStockPool(merged);
      }
      setBatchText("");
      await load();
    } catch {
      setError("更新失败");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-[520px] flex-col border-l border-base-500 bg-base-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-base-500 px-4 py-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-accent-gold" />
            <span className="text-sm font-semibold text-text-primary">股票池管理</span>
            <span className="rounded bg-base-600 px-1.5 py-0.5 text-[10px] text-text-muted">
              {stocks.length} 只
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-base-600 hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="border-b border-rise/20 bg-rise/10 px-4 py-2 text-xs text-rise-bright">
            {error}
          </div>
        )}

        {/* 当前股票池列表 */}
        <div className="flex-1 overflow-y-auto">
          <div className="border-b border-base-600 px-4 py-2 text-xs font-medium text-text-muted">
            当前股票池（点击 × 删除）
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : stocks.length === 0 ? (
            <div className="py-8 text-center text-xs text-text-muted">股票池为空</div>
          ) : (
            <div className="flex flex-wrap gap-1.5 p-3">
              {stocks.map((s) => (
                <div
                  key={s.code}
                  className="group flex items-center gap-1.5 rounded border border-base-600 bg-base-800 px-2 py-1 text-xs"
                >
                  <span className="font-mono-num text-accent-gold">{s.code}</span>
                  <span className="text-text-secondary">{s.name}</span>
                  <button
                    onClick={() => handleRemove(s.code)}
                    className="ml-0.5 text-text-muted opacity-0 transition hover:text-rise-bright group-hover:opacity-100"
                    title="删除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 批量更新区域 */}
        <div className="border-t border-base-500 bg-base-800 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-text-primary">批量更新</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMode("replace")}
                className={`rounded px-2 py-0.5 text-[10px] transition ${
                  mode === "replace"
                    ? "bg-accent-gold/20 text-accent-gold"
                    : "bg-base-600 text-text-muted hover:text-text-primary"
                }`}
              >
                替换全部
              </button>
              <button
                onClick={() => setMode("append")}
                className={`rounded px-2 py-0.5 text-[10px] transition ${
                  mode === "append"
                    ? "bg-accent-gold/20 text-accent-gold"
                    : "bg-base-600 text-text-muted hover:text-text-primary"
                }`}
              >
                追加
              </button>
            </div>
          </div>
          <textarea
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            placeholder={"输入股票代码，支持换行或英文逗号分隔\n例如：\n600519\n000858,002304"}
            rows={4}
            className="w-full resize-none rounded border border-base-500 bg-base-900 px-3 py-2 font-mono-num text-xs text-text-primary placeholder:text-text-muted focus:border-accent-gold focus:outline-none focus:ring-1 focus:ring-accent-gold/40"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-text-muted">
              {batchText ? `已识别 ${parseBatch(batchText).length} 个代码` : "仅保留6位数字代码，自动去重"}
            </span>
            <button
              onClick={handleBatchUpdate}
              disabled={saving || !batchText.trim()}
              className="flex items-center gap-1.5 rounded bg-accent-gold/20 px-3 py-1.5 text-xs font-medium text-accent-gold transition hover:bg-accent-gold/30 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : mode === "replace" ? (
                <Trash2 className="h-3.5 w-3.5" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {mode === "replace" ? "替换全部" : "追加添加"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
