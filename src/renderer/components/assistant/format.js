// src/renderer/components/assistant/format.js
// StatusBar（REQ-AGENT-056）与消息元数据（REQ-AGENT-057）共享的展示格式化纯函数。
// 对齐 ux/assistant-rich.html 语义：token 千分位 k 记法（12.4k / 200k）、耗时秒（1.24s）。
// 纯函数零依赖——SSR 自验 harness 直接断言。

// token 格式化：null/undefined/NaN → 「-」；≥1000 → k 记法（1 位小数去尾零：
// 12400 → 12.4k，200000 → 200k）；<1000 → 原值。
export function formatTokens(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "-";
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

// 耗时格式化：null/undefined/NaN → 「-」；毫秒 → 秒（两位小数：1240 → 1.24s）。
export function formatDuration(ms) {
  if (typeof ms !== "number" || Number.isNaN(ms)) return "-";
  return `${(ms / 1000).toFixed(2)}s`;
}

const PLACEHOLDER = "—";

// 上下文用量文本（REQ-AGENT-056；REQ-AGENT-105 / BUG-003）：`tokens / contextWindow
// · percent%`——percent 恒定两位小数（人签 expected：SDK 全精度浮点 1.9222259521484375
// 直拼可读性差；assistant-rich.html 整数格式被推翻）；tokens null（压缩后）→
// percent 或占位；全缺 → 占位「—」。
// 从 StatusBar.jsx 抽取（REQ-105 补纯函数 seam：JSX 文件 node 不可直接 import）。
export function contextText(ctx) {
  if (!ctx) return PLACEHOLDER;
  const { tokens, contextWindow, percent } = ctx;
  const parts = [];
  if (typeof tokens === "number" && typeof contextWindow === "number") {
    parts.push(`${formatTokens(tokens)} / ${formatTokens(contextWindow)} tokens`);
  }
  if (typeof percent === "number" && !Number.isNaN(percent)) parts.push(`${percent.toFixed(2)}%`);
  return parts.length > 0 ? parts.join(" · ") : PLACEHOLDER;
}

// 仪表宽度（percent → 0-100 clamp，全精度驱动不做两位格式化）；percent 缺失 → 0。
export function meterWidth(ctx) {
  const p = ctx && typeof ctx.percent === "number" && !Number.isNaN(ctx.percent) ? ctx.percent : 0;
  return `${Math.max(0, Math.min(100, p))}%`;
}
