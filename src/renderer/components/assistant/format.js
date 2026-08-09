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
