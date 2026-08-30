// src/http/browserApiGuard.js
// /api/browser/* 访问控制（security review 2026-08-30，ADR-039 决策 7「本地通道」前提落地）：
// Cookie 明文导出等凭据面曾被 ACAO:* + 无 Host 校验暴露给任意来源网页（含 agent 在面板内
// 导航到的恶意站点；DNS rebinding 可绕过无 Host 校验的监听面）。本前缀统一收口：
// 1. Host 头必须 127.0.0.1[:port]/localhost[:port]（封 DNS rebinding），否则 403；
// 2. 跨源网页封锁：Origin 非 http://127.0.0.1:*/http://localhost:* → 403；
//    Sec-Fetch-Site: cross-site|cross-origin → 403；
// 3. 不输出 ACAO 头（跨源 fetch 读不到回执）；其余路由保持 ACAO:*（渲染进程 dev 期
//    跨源依赖它们，不动全局 CORS）。
// CLI/toolAdapter 调用路径（node fetch：无 Origin 头、Host=127.0.0.1）不受影响。
// 独立成模块：server.js ≤250 行架构约束（2026-08-16-deepen-service-container AC5）。
import { forbidden } from "./responders.js";

const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
const LOOPBACK_ORIGIN_RE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

// 写 403 并返回 true = 已拒绝；false = 放行。
export function denyBrowserApiIfUnsafe(req, res) {
  const denied =
    !LOOPBACK_HOST_RE.test(String(req.headers.host ?? "")) ||
    Boolean(req.headers.origin && !LOOPBACK_ORIGIN_RE.test(req.headers.origin)) ||
    req.headers["sec-fetch-site"] === "cross-site" ||
    req.headers["sec-fetch-site"] === "cross-origin";
  if (denied) forbidden(res, "browser API is loopback-only");
  return denied;
}

// 非 browser 路由的既有 CORS 头（现状保持：渲染进程 dev 期跨源依赖）。
export function applyDefaultCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
