// src/http/browserApiGuard.js
// 本地敏感端点访问控制（security review 2026-08-30 & 2026-09-03）：
// 1. /api/browser/*：Cookie 明文导出等凭据面；
// 2. /api/agent/files/*：本地工程源码与目录读取（BUG-001：防御跨站恶意 fetch 与 DNS rebinding）。
// 本前缀统一收口：
// 1. Host 头必须 127.0.0.1[:port]/localhost[:port]（封 DNS rebinding），否则 403；
// 2. 跨源网页封锁：Origin 非 http://127.0.0.1:*/http://localhost:* → 403；
//    Sec-Fetch-Site: cross-site|cross-origin → 403；
// 3. 仅对合法 loopback Origin 反射 CORS 头；无 Origin 请求（Node/CLI/curl）不输出 ACAO；
//    其余路由保持 ACAO:*（渲染进程 dev 期跨源依赖，不动全局 CORS）。
// CLI/toolAdapter 调用路径（node fetch：无 Origin 头、Host=127.0.0.1）不受影响。
// 独立成模块：server.js ≤250 行架构约束（2026-08-16-deepen-service-container AC5）。
import { forbidden } from "./responders.js";

const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
const LOOPBACK_ORIGIN_RE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

export function isLoopbackOnlyApi(resource, subPath = []) {
  if (resource === "browser") return true;
  if (resource === "agent" && subPath[0] === "files") return true;
  return false;
}

// 写 403 并返回 true = 已拒绝；false = 放行。
export function denyLoopbackApiIfUnsafe(req, res, message = "API is loopback-only") {
  const host = String(req.headers.host ?? "");
  const origin = req.headers.origin;
  const secFetchSite = req.headers["sec-fetch-site"];

  const hasValidLoopbackOrigin = Boolean(origin && LOOPBACK_ORIGIN_RE.test(origin));
  const denied =
    !LOOPBACK_HOST_RE.test(host) ||
    Boolean(origin && !hasValidLoopbackOrigin) ||
    ((secFetchSite === "cross-site" || secFetchSite === "cross-origin") && !hasValidLoopbackOrigin);

  if (denied) forbidden(res, message);
  return denied;
}

// 保持既有兼容导出
export function denyBrowserApiIfUnsafe(req, res) {
  return denyLoopbackApiIfUnsafe(req, res, "browser API is loopback-only");
}

// 仅对通过校验的合法本地 loopback Origin 反射 CORS（供 Vite dev 服务器等本地跨端口场景使用）
export function applyLoopbackCors(req, res) {
  if (req.headers.origin && LOOPBACK_ORIGIN_RE.test(req.headers.origin)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Vary", "Origin");
  }
}

// 非受限路由的既有 CORS 头（现状保持：渲染进程 dev 期跨源依赖）。
export function applyDefaultCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
