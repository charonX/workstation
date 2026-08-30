// src/renderer/components/assistant/mdLinkDispatch.js
// MdLink 链接分发纯逻辑（REQ-BROWSER-004 AC2/AC3 组件测试 seam，review 2026-08-30）：
// 分发判定自 MdLink JSX 内联提取——组件测试可 mock 桥函数断言 opc.openExternal
// 被以正确 URL 调用、mailto: 不拦截；MdLink 行为零变化。
// - http(s) 链接 → 默认动作 "panel"（内置浏览器面板打开）；"external" 显式动作
//   （关联菜单「在系统浏览器打开」）→ openExternal 桥；
// - 非 http(s)（mailto: 等）→ "passthrough"：不拦截，不调用任何桥（AC3）。
const HTTP_LINK_RE = /^https?:\/\//i;

export function isHttpLink(href) {
  return typeof href === "string" && HTTP_LINK_RE.test(href);
}

// 默认动作判定："panel"（http(s)）| "passthrough"（非 http(s)，保持默认锚点行为）
export function resolveLinkAction(href) {
  return isHttpLink(href) ? "panel" : "passthrough";
}

// 执行分发。action: "panel"（默认）| "external"。返回实际执行的动作
// （"panel" | "external" | "passthrough"）；passthrough 不触达任何桥。
export function dispatchLink(href, { action = "panel", openPanel, openExternal } = {}) {
  if (!isHttpLink(href)) return "passthrough";
  if (action === "external") {
    if (typeof openExternal === "function") openExternal(href);
    return "external";
  }
  if (typeof openPanel === "function") openPanel(href);
  return "panel";
}
