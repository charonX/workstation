// src/shared/urlScheme.js
// URL scheme 判定共享真源（code review 2026-08-30 SUGGESTION：三处平行实现收敛）：
// - browserViewManager.normalizeBrowserUrl（主进程协议白名单双闸真源）——schemeToPrepend；
// - BrowserPanel 地址栏前置拦截——hasForbiddenScheme；
// - main.js opc-open-external（系统浏览器白名单）——isHttpUrl。
// 纯函数、零 node API 依赖（渲染进程经 Vite 可直接 import）。
//
// scheme 判定陷阱（迁移前三处实现注释的共识语义，逐例等价）：
// - 「scheme://」（带授权符）才算显式协议；
// - 「host:端口」（冒号后纯数字，如 localhost:3000）不算协议——避免被裸 scheme 正则误判；
// - 「javascript:alert(1)」这类 scheme-without-// 保留原样，由白名单拒绝。
const AUTHORITY_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const HOST_PORT_RE = /^[^:/?#]+:\d+(?:[/?#]|$)/;
const BARE_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const HTTP_AUTHORITY_RE = /^https?:\/\//i;
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1)([:/?#]|$)/i;

// openExternal 白名单判定：仅 http(s):// 显式 URL。
// 不 trim——与原 main.js 内联判定逐例等价（前导空白输入保持拒绝）。
export function isHttpUrl(raw) {
  return typeof raw === "string" && HTTP_AUTHORITY_RE.test(raw);
}

// 地址栏前置拦截（BrowserPanel）：显式非 http(s) 协议或裸 scheme → forbidden；
// http(s):// 与 host:port 形态放行（协议补全由主进程 normalize 真源执行）。
export function hasForbiddenScheme(raw) {
  const v = String(raw ?? "").trim();
  if (HTTP_AUTHORITY_RE.test(v)) return false;
  if (AUTHORITY_SCHEME_RE.test(v)) return true; // 显式非 http(s) 协议
  if (HOST_PORT_RE.test(v)) return false; // host:port 形态
  return BARE_SCHEME_RE.test(v); // 裸 scheme（javascript: 等）
}

// 缺省协议补全判定（normalizeBrowserUrl 真源逻辑）：返回应补全的协议
// （"http"|"https"）；输入已含显式协议（scheme://）或裸 scheme（保留原样走
// 白名单拒绝）→ null。localhost/127.0.0.1 补 http，其余补 https（浏览器惯例）。
// 入参预期已 trim（调用方 normalizeBrowserUrl 先 trim）。
export function schemeToPrepend(candidate) {
  if (AUTHORITY_SCHEME_RE.test(candidate)) return null;
  if (!HOST_PORT_RE.test(candidate) && BARE_SCHEME_RE.test(candidate)) return null;
  return LOCAL_HOST_RE.test(candidate) ? "http" : "https";
}
