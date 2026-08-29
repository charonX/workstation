// src/cli/commands/browser.js
// agent 浏览器读取工具集命令模块（REQ-BROWSER-002/006，story 2026-08-24-embedded-browser，
// PRD §10.4 接口 6）：navigate/read/scroll/screenshot/auth-check 经 ADR-001 本地 HTTP 通道
// 调 /api/browser/*（browserViewManager 为真源）。业务错误（E-BROWSER-*）由路由层以
// 200 + {ok:false, error:{code, reason}} 返回，命令函数原样透传为回执数据（工具面 JSON
// 回执同构先例），不抛异常；E-BROWSER-DENIED（revoked）由 manager 判定，此处仅透传。
// auth-check 为探测语义（§8-E8：未登录是正常回执非错误）：返回裸 {authenticated, missing?}
// （不包 {ok} 外壳，锚点 §6.3 块5 row2）；domain 非法等业务错误同构透传 {ok:false, error}。

import { ensureServer } from "../server.js";

// 统一 POST 调用：ensureServer 发现主进程 server（ADR-001 本地 HTTP 通道）→ POST /api/browser/*。
async function postBrowserApi(path, body = {}) {
  const server = await ensureServer();
  const res = await fetch(`${server.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function navigate(flags) {
  return postBrowserApi("/api/browser/navigate", {
    url: flags.url,
    source: "agent", // 工具面固定 agent 来源（接口 1 契约）
    ...(flags.expand === true ? { expand: true } : {}),
  });
}

export async function read() {
  return postBrowserApi("/api/browser/read");
}

export async function scroll(flags) {
  return postBrowserApi("/api/browser/scroll", {
    dx: Number(flags.dx) || 0,
    dy: Number(flags.dy) || 0,
  });
}

export async function screenshot() {
  return postBrowserApi("/api/browser/screenshot");
}

// auth-check（ADR-039 决策 8 Human-in-the-Loop Auth）：经 GET /api/browser/cookies
// 读目标域 Cookie 判定登录态。required-cookies 逗号分隔名单：缺省 = 域下存在任意
// Cookie 即 authenticated；非空 = 名单全部存在才 authenticated，缺失名单入 missing。
export async function authCheck(flags) {
  const server = await ensureServer();
  const domain = String(flags.domain ?? "");
  const required = typeof flags["required-cookies"] === "string"
    ? flags["required-cookies"].split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const res = await fetch(`${server.baseUrl}/api/browser/cookies?domain=${encodeURIComponent(domain)}`);
  const data = await res.json();
  if (data?.ok !== true) return data; // E-BROWSER-BAD-DOMAIN 等业务错误同构透传（§8-E7）
  const present = new Set((data.cookies ?? []).map((c) => c.name));
  if (required.length === 0) {
    return present.size > 0 ? { authenticated: true } : { authenticated: false, missing: [] };
  }
  const missing = required.filter((name) => !present.has(name));
  return missing.length === 0 ? { authenticated: true } : { authenticated: false, missing };
}
