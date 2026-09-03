// src/renderer/components/preview/format.js
// 文件预览面板（REQ-PREVIEW-001）展示格式化纯函数。
// 纯函数零依赖，便于 Node 环境无 JSX 直接单元测试（STANDARDS.md「展示格式化纯函数模块」）。

const KIND_LABEL = { markdown: "Markdown", image: "图片" };

// 头部类型标签（REQ-001 AC1）：markdown/image 用固定文案；code 用 hljs 语言键
// （无语言 → plaintext 兜底）；其余 kind 原样透出。
export function kindLabelOf(state) {
  if (!state?.kind) return null;
  if (state.kind === "code") return state.language ?? "plaintext";
  return KIND_LABEL[state.kind] ?? state.kind;
}

// 文件大小格式化（B / KB / MB）
export function formatSize(size) {
  const n = Number(size) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
