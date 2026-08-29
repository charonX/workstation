// src/services/browserViewManager.js
// 浏览器面板主进程托管（REQ-BROWSER-001/003/005，ADR-039，story 2026-08-24-embedded-browser）：
// - WebContentsView 懒创建（首次导航时），partition persist:browser，无 preload、
//   nodeIntegration=false、contextIsolation=true、sandbox=true（REQ-BROWSER-001 安全基线）；
// - 协议白名单双闸：navigate 入口 normalize + 白名单（本文件为真源，导出 normalizeBrowserUrl
//   供共享），will-navigate / setWindowOpenHandler 兜底（覆盖重定向链与 target=_blank——
//   弹窗一律转面板内导航，绝不劫持主窗口，ADR-039 决策 4）；
// - 人机共驾状态机（REQ-BROWSER-003）：stop-agent-control → agentControlRevoked=true，
//   revoked 期间 agent 来源调用一律 E-BROWSER-DENIED；source=user 导航成功即解除
//   （流程 C：手动导航 = 收回并归还控制）；崩溃中 agent 导航 → E-BROWSER-CRASHED，
//   用户导航自动重建实例（E4 副作用：实例可重建，人操作优先）；
// - 可见性解耦（ADR-039 决策 3）：bounds visible=false 只隐藏视图，webContents 保活，
//   agent 工具照常可用；布局真相归渲染进程，本模块哑执行 setBounds（E6：同步异常只记日志）；
// - Cookie 受控导出（REQ-BROWSER-005，ADR-039 决策 7/8）：persist:browser 分区独立于视图
//   实例可读/删；明文只走 HTTP 回执，日志一律域级/计数（禁止 cookie 值入日志——脱敏收口，
//   REQ-BROWSER-005 标准 7）。
//
// headless 兼容（CLI / 纯 node 单元测试环境无 Electron）：
// - session：process.versions.electron 不存在 → 内存 fallback session（Map 存 Cookie，
//   get/set/remove 语义与 electron session.cookies 对齐：url 形态入参、domain 后缀匹配）；
// - 导航：无注入且无 Electron → HTTP fetch 退化执行器（GET 抓 <title>，node 错误码映射
//   Chromium ERR_*，如 ECONNREFUSED → ERR_CONNECTION_REFUSED，锚点 §8-E2）；
// - read：无真实视图但已有成功 fallback 导航 → 返回最近导航的静态快照（正文退化抽取）；
//   实例从未创建（无成功导航）→ E-BROWSER-NOT-READY；scroll/screenshot 无视图 → NOT-READY。
// 注入缝：{ sessionFactory, navigateExecutor, createView, getWindow, notify, shotsDir }——
//   navigateExecutor(url) → { title } 或抛 { code:"E-BROWSER-NAV-FAILED", reason }。

import path from "node:path";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

export const BROWSER_PARTITION = "persist:browser";
export const READ_TEXT_LIMIT = 4000; // 锚点 §6.3 块2：正文截断阈值
export const READ_ELEMENTS_LIMIT = 50; // 锚点 §6.3 块2：元素截断阈值

// —— 契约错误码（PRD §8）——
function browserError(code, reason) {
  const err = new Error(reason || code);
  err.code = code;
  if (reason) err.reason = reason;
  return err;
}

// cookie 域校验（REQ-BROWSER-005，§7.1：必填且以 "." 开头的域后缀语义）
function assertValidCookieDomain(domain) {
  if (typeof domain !== "string" || !domain.startsWith(".") || domain.length < 2) {
    throw browserError("E-BROWSER-BAD-DOMAIN");
  }
}

// —— 协议白名单 + normalize（锚点 §7 row1 / §6.3 块1 rows1-2）——
// 仅 http/https；缺省补全：localhost/127.0.0.1 补 http://，其余补 https://；
// 空/白名单外/无主机 → E-BROWSER-BAD-URL。返回 null 表示非法。
// scheme 判定陷阱：`localhost:3000` 会被裸 scheme 正则误判为 "localhost:" 协议——
// 仅 `scheme://`（带授权符）算显式协议；`host:端口`（冒号后纯数字）按无协议补全；
// `javascript:alert(1)` 这类 scheme-without-// 保留原样走白名单拒绝。
export function normalizeBrowserUrl(rawInput) {
  const raw = typeof rawInput === "string" ? rawInput.trim() : "";
  if (!raw) return null;
  let candidate = raw;
  const hasAuthorityScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate);
  const looksLikeHostPort = /^[^:/?#]+:\d+(?:[/?#]|$)/.test(candidate);
  const hasBareScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate);
  if (!hasAuthorityScheme && (looksLikeHostPort || !hasBareScheme)) {
    // 缺协议：localhost / 127.0.0.1（含端口/路径）补 http，其余补 https（浏览器惯例）
    const isLocal = /^(localhost|127\.0\.0\.1)([:/?#]|$)/i.test(candidate);
    candidate = `${isLocal ? "http" : "https"}://${candidate}`;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null; // 白名单外（file:/javascript: 等）
  if (!parsed.hostname) return null; // "http://" 无主机 → 地址不完整
  return parsed.href;
}

// node 网络错误码 → Chromium ERR_* 透传映射（锚点 §8-E2 / §10.4 接口1 连接失败样例）
const NODE_ERR_TO_CHROMIUM = {
  ECONNREFUSED: "ERR_CONNECTION_REFUSED",
  ENOTFOUND: "ERR_NAME_NOT_RESOLVED",
  EAI_AGAIN: "ERR_NAME_NOT_RESOLVED",
  ECONNRESET: "ERR_CONNECTION_RESET",
  ECONNABORTED: "ERR_CONNECTION_ABORTED",
  ETIMEDOUT: "ERR_CONNECTION_TIMED_OUT",
  EACCES: "ERR_ACCESS_DENIED",
  EHOSTUNREACH: "ERR_ADDRESS_UNREACHABLE",
  ENETUNREACH: "ERR_ADDRESS_UNREACHABLE",
  CERT_HAS_EXPIRED: "ERR_CERT_DATE_INVALID",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "ERR_CERT_AUTHORITY_INVALID",
  ERR_CONNECTION_REFUSED: "ERR_CONNECTION_REFUSED",
  ERR_NAME_NOT_RESOLVED: "ERR_NAME_NOT_RESOLVED",
};

function chromiumReasonFromError(err) {
  if (!err) return "ERR_FAILED";
  const direct = typeof err.reason === "string" && err.reason.startsWith("ERR_") ? err.reason : null;
  if (direct) return direct;
  const code = err.code || err.cause?.code;
  if (typeof code === "string") {
    if (NODE_ERR_TO_CHROMIUM[code]) return NODE_ERR_TO_CHROMIUM[code];
    if (code.startsWith("ERR_")) return code;
  }
  return "ERR_FAILED";
}

// —— 内存 fallback session（纯 node 环境下替代 electron session，Map 存 Cookie）——
// get/remove 语义与 electron session.cookies 对齐：入参 url 形态，domain 后缀匹配。
// 注意：cookiesGet/cookiesSet/cookiesRemove 是本 fallback 的自定义命名，electron Session
// 上没有这些方法——业务代码一律走 createCookieStore adapter，禁止直接触碰这些方法名。
function createMemoryCookieSession() {
  const cookies = new Map(); // key: name|domain|path
  const keyOf = (c) => `${c.name}|${c.domain}|${c.path || "/"}`;
  const domainSuffixMatch = (cookieDomain, filterDomain) => {
    if (!filterDomain) return true;
    const cd = String(cookieDomain || "").toLowerCase();
    const fd = String(filterDomain).toLowerCase();
    return cd === fd || cd.endsWith(fd.startsWith(".") ? fd : `.${fd}`);
  };
  return {
    isFallback: true,
    async cookiesGet({ url, domain, name } = {}) {
      const list = [...cookies.values()].filter((c) => {
        if (!domainSuffixMatch(c.domain, domain)) return false;
        if (name && c.name !== name) return false;
        if (url && c.domain && !url.includes(String(c.domain).replace(/^\./, ""))) return false;
        return true;
      });
      return list;
    },
    async cookiesSet(details) {
      const cookie = {
        name: details.name,
        value: details.value,
        domain: details.domain,
        path: details.path || "/",
        expirationDate: details.expirationDate,
        secure: details.secure === true,
        httpOnly: details.httpOnly === true,
      };
      cookies.set(keyOf(cookie), cookie);
      return cookie;
    },
    async cookiesRemove({ url, name, domain } = {}) {
      let removed = 0;
      for (const [key, c] of [...cookies.entries()]) {
        const nameMatch = name ? c.name === name : true;
        const domainMatch = domainSuffixMatch(c.domain, domain);
        const urlMatch = url ? domainSuffixMatch(c.domain, new URL(url).hostname) : true;
        if (nameMatch && (domain ? domainMatch : urlMatch)) {
          cookies.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

// —— Cookie adapter：归一 fallback session 与 Electron Session 两种形态到同一调用面 ——
// 调用面：get({domain,name?}) → Cookie[]；remove(cookie, domain?) → 删除条数；set(cookie)。
// Electron 分支走 session.cookies.get/remove/set：
// - get 的 domain filter：Electron 语义为「域或其子域」，与 fallback 的后缀匹配对齐；
//   契约入参 domain 以 "." 开头（域后缀语义，§7.1），喂给 Electron 前剥掉前导点。
// - remove 需要 url 形态入参（无 {domain,name} 直删 API）：由 cookie 的 domain/path 构造。
function buildCookieUrl(c) {
  const proto = c.secure ? "https" : "http";
  const host = String(c.domain || "").replace(/^\./, "");
  return `${proto}://${host}${c.path || "/"}`;
}

function createCookieStore(session) {
  if (session && session.isFallback) {
    return {
      get: ({ domain, name } = {}) => session.cookiesGet({ domain, name }),
      remove: (cookie, domain) => session.cookiesRemove({ name: cookie.name, domain }),
      set: (cookie) => session.cookiesSet(cookie),
    };
  }
  const jar = session && session.cookies ? session.cookies : null;
  return {
    get: async ({ domain, name } = {}) => {
      const filter = {};
      if (domain) filter.domain = String(domain).replace(/^\./, ""); // 剥前导点：匹配域及子域
      if (name) filter.name = name;
      return jar.get(filter);
    },
    remove: async (cookie) => {
      await jar.remove(buildCookieUrl(cookie), cookie.name);
      return 1;
    },
    set: (cookie) =>
      jar.set({
        url: buildCookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || "/",
        secure: cookie.secure === true,
        httpOnly: cookie.httpOnly === true,
        expirationDate: cookie.expirationDate ?? cookie.expires,
      }),
  };
}

// —— 主进程事件通知 seam 缺省由 notifierRef 承载（createBrowserViewManager 内定义）——

// —— read 快照自包含序列化器（PRD §10.3：executeJavaScript 注入；无外部依赖字符串）——
// 遍历 DOM 产出 {title, text, elements:[{tag,text,selector,rect:{x,y,width,height}}]}；
// 截断（4000 字符 / 50 元素）由宿主侧统一执行——注入体只负责按序收集。
function buildReadScript() {
  return `
(() => {
  const interactive = 'a[href], button, input, select, textarea, [role=button], [onclick], summary';
  const seen = new Set();
  const elements = [];
  for (const el of document.querySelectorAll(interactive)) {
    if (elements.length >= ${READ_ELEMENTS_LIMIT}) break;
    if (seen.has(el)) continue;
    seen.add(el);
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 200);
    const r = el.getBoundingClientRect();
    let selector = el.tagName.toLowerCase();
    if (el.id) selector = '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\\s+/)[0];
      if (cls) selector = el.tagName.toLowerCase() + '.' + cls;
    }
    elements.push({
      tag: el.tagName.toLowerCase(),
      text,
      selector,
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
    });
  }
  return { title: document.title || '', text: (document.body ? document.body.innerText : ''), elements };
})()`;
}

// host 侧截断（对齐 §10.4 接口2 golden：text→4000、elements→50、truncated 标记）
function truncateSnapshot(snapshot) {
  const text = typeof snapshot?.text === "string" ? snapshot.text : "";
  const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : [];
  const truncated = text.length > READ_TEXT_LIMIT || elements.length > READ_ELEMENTS_LIMIT;
  return { text: text.slice(0, READ_TEXT_LIMIT), elements: elements.slice(0, READ_ELEMENTS_LIMIT), truncated };
}

// headless 退化路径的 HTML→纯文本抽取（script/style 剔除、标签剥离、实体反转义、空白折叠）。
// 无 DOM 可用时的保守近似：只保证 read 契约字段形状与截断语义，元素列表由真实视图路径提供。
function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function createBrowserViewManager(options = {}) {
  const notifierRef = { fn: null };
  function notify(payload) {
    try {
      if (notifierRef.fn) notifierRef.fn(payload);
      else if (typeof options.notify === "function") options.notify(payload);
    } catch {
      // 通知失败（无窗口/渲染侧异常）安全吞掉：headless/测试下 no-op 语义
    }
  }
  const partition = options.partition || BROWSER_PARTITION;
  const shotsDir = options.shotsDir || path.join(process.env.OPC_WORKSTATION_CONFIG_DIR || ".", "shots");

  // —— Electron 可用性探测（纯 node 单测/CLI 下走 fallback）——
  let electron = null;
  if (options.electron) {
    electron = options.electron;
  } else if (process.versions.electron) {
    // 动态 require 规避打包器静态分析；失败按无 Electron 处理。
    try {
      electron = createRequire(import.meta.url)("electron");
    } catch {
      electron = null;
    }
  }

  // —— session seam：注入优先，其次 electron.session.fromPartition，最后内存 fallback ——
  let session = null;
  if (typeof options.sessionFactory === "function") {
    session = options.sessionFactory();
  } else if (electron) {
    try {
      session = electron.session.fromPartition(partition);
    } catch {
      session = null;
    }
  }
  if (!session) {
    session = createMemoryCookieSession();
  }
  // 统一 cookie 调用面：fallback 自定义命名与 Electron session.cookies API 归一到同一
  // adapter，业务代码只面向 adapter——fallback 命名不再泄漏进 Electron 路径。
  const cookieStore = createCookieStore(session);

  // —— 状态（REQ-BROWSER-003 状态机 + state 契约字段）——
  let view = null; // WebContentsView 实例（懒创建）
  let currentUrl = null;
  let currentTitle = null;
  let crashed = false;
  let agentControl = false; // agent 曾驱动且未 revoked → 渲染进程显示「agent 控制中」
  let agentControlRevoked = false;
  let open = false; // 面板可见性（渲染进程 bounds 推送镜像）
  let screenshotSeq = 0;
  let fallbackSnapshot = null; // headless 退化：最近一次 fallback 导航的静态快照（truncateSnapshot 结果）
  let navigateExecutor = typeof options.navigateExecutor === "function" ? options.navigateExecutor : null;

  // —— WebContentsView 创建（Electron 真实路径；headless 走退化）——
  // webPreferences 最小化（REQ-BROWSER-001 安全基线：无 preload、nodeIntegration 关、
  // contextIsolation 开、sandbox 开）。返回 null = 无 Electron 不可创建。
  function createView() {
    if (typeof options.createView === "function") return options.createView();
    if (!electron || typeof electron.WebContentsView !== "function") return null;
    const v = new electron.WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        // 无 preload：视图内页面不获得任何宿主桥（§10.7 安全基线）
      },
    });
    const wc = v.webContents;
    // 弹窗拦截双闸之一：setWindowOpenHandler 一律 deny 并转面板内导航（锚点 §6.3 块1 row4）
    wc.setWindowOpenHandler(({ url: target }) => {
      const normalized = normalizeBrowserUrl(target);
      if (normalized) {
        wc.loadURL(normalized).catch(() => {});
        notify({ type: "navigated", url: normalized, source: "popup-redirect" });
      }
      return { action: "deny" };
    });
    // 双闸之二：will-navigate 白名单校验（覆盖重定向链；白名单外拒绝迁移）
    wc.on("will-navigate", (event, target) => {
      if (!normalizeBrowserUrl(target)) event.preventDefault();
    });
    wc.on("did-finish-load", () => {
      crashed = false;
      currentUrl = safeCurrentUrl(wc);
      wc.executeJavaScript("document.title").then((t) => {
        if (typeof t === "string" && t) currentTitle = t;
        notify({ type: "navigated", url: currentUrl, title: currentTitle });
      }).catch(() => notify({ type: "navigated", url: currentUrl }));
    });
    wc.on("did-fail-load", (_e, errorCode, errorDesc) => {
      notify({ type: "load-failed", url: currentUrl, reason: extractErrCode(errorDesc, errorCode) });
    });
    // 崩溃监听（§8-E4）：置 crashed 状态 + 通知渲染进程显示崩溃页
    wc.on("render-process-gone", (_e, details) => {
      crashed = true;
      notify({ type: "crashed", reason: details?.reason });
    });
    return v;
  }

  function safeCurrentUrl(wc) {
    try {
      return wc.getURL ? wc.getURL() : currentUrl;
    } catch {
      return currentUrl;
    }
  }

  // did-fail-load 的 errorDesc 形如 "net::ERR_CONNECTION_REFUSED (-102)"——提取 ERR_* 码
  function extractErrCode(errorDesc, errorCode) {
    if (typeof errorDesc === "string") {
      const m = /ERR_[A-Z_]+/.exec(errorDesc);
      if (m) return m[0];
    }
    return errorCode ? `ERR_${errorCode}` : "ERR_FAILED";
  }

  function resolveHostWindow() {
    return typeof options.getWindow === "function" ? options.getWindow() : null;
  }

  function attachView(v) {
    const win = resolveHostWindow();
    if (win && win.contentView && typeof win.contentView.addChildView === "function") {
      try {
        win.contentView.addChildView(v);
        return;
      } catch (err) {
        // E6 兜底：attach 失败只记日志，面板内容暂时隐藏而非错位遮挡
        console.error(JSON.stringify({ event: "browser-view-attach-failed", error: err?.message }));
      }
    }
  }

  function detachView(v) {
    const win = resolveHostWindow();
    if (win && win.contentView && typeof win.contentView.removeChildView === "function") {
      try {
        win.contentView.removeChildView(v);
      } catch {
        // ignore：视图可能从未 attach
      }
    }
  }

  function ensureReady() {
    if (crashed) throw browserError("E-BROWSER-CRASHED");
    if (!view) throw browserError("E-BROWSER-NOT-READY");
    return view;
  }

  // —— revoked 检查（REQ-BROWSER-003：revoked 期间 agent 来源一律 DENIED）——
  function assertAgentAllowed(source) {
    if (source === "agent" && agentControlRevoked) throw browserError("E-BROWSER-DENIED");
  }

  // —— 无 Electron 退化导航执行器：HTTP GET 抓 <title>，node 错误码映射 ERR_*（§8-E2）——
  // 同时产出静态快照（正文文本退化抽取），供 read 在无视图环境返回最近导航结果。
  async function fallbackNavigateExecutor(normalizedUrl) {
    try {
      const res = await fetch(normalizedUrl, { redirect: "follow", signal: AbortSignal.timeout(15000) });
      const html = await res.text();
      const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      const title = m ? m[1].trim() : "";
      return { title, snapshot: { title, text: htmlToText(html), elements: [] } };
    } catch (err) {
      throw browserError("E-BROWSER-NAV-FAILED", chromiumReasonFromError(err));
    }
  }

  async function runNavigation(normalizedUrl) {
    if (typeof navigateExecutor === "function") {
      // 注入 seam（单测）：返回 {title} 或抛 {code:"E-BROWSER-NAV-FAILED", reason}
      const out = await navigateExecutor(normalizedUrl);
      return { title: typeof out?.title === "string" ? out.title : "" };
    }
    if (view) {
      // 真实路径：loadURL + 等 did-finish-load / did-fail-load
      const wc = view.webContents;
      await new Promise((resolve, reject) => {
        const onFinish = () => { cleanup(); resolve(); };
        const onFail = (_e, _code, errorDesc) => { cleanup(); reject(browserError("E-BROWSER-NAV-FAILED", extractErrCode(errorDesc, _code))); };
        const cleanup = () => {
          wc.off("did-finish-load", onFinish);
          wc.off("did-fail-load", onFail);
        };
        wc.on("did-finish-load", onFinish);
        wc.on("did-fail-load", onFail);
        wc.loadURL(normalizedUrl).catch((err) => { cleanup(); reject(browserError("E-BROWSER-NAV-FAILED", chromiumReasonFromError(err))); });
      });
      let title = "";
      try { title = await wc.executeJavaScript("document.title"); } catch { /* CSP 退化 */ }
      return { title: typeof title === "string" ? title : "" };
    }
    return fallbackNavigateExecutor(normalizedUrl);
  }

  return {
    // —— REQ-BROWSER-001：导航（协议白名单 → revoked → crashed → 执行）——
    async navigate({ url, source, expand } = {}) {
      const normalized = normalizeBrowserUrl(url);
      if (!normalized) throw browserError("E-BROWSER-BAD-URL");
      assertAgentAllowed(source);
      if (crashed) {
        // E4 副作用：实例可重建；用户导航自动恢复，agent 导航报崩溃（agent 无权重建——
        // 重建即未经人确认复活崩溃面；人导航一次即隐式重建，人操作优先）
        if (source === "agent") throw browserError("E-BROWSER-CRASHED");
        if (view) { detachView(view); view = null; }
        crashed = false;
      }
      if (!view) {
        view = createView();
        if (view) attachView(view);
      }
      const { title, snapshot } = await runNavigation(normalized);
      currentUrl = normalized;
      currentTitle = title || currentTitle;
      // fallback 导航携带静态快照（无视图环境 read 的数据源）；真实视图路径不需要
      fallbackSnapshot = snapshot ? truncateSnapshot(snapshot) : null;
      if (source === "user") {
        // 流程 C 步骤 3：手动导航 = 收回并归还控制（revoked 自动清除）
        agentControlRevoked = false;
        agentControl = false;
      } else if (source === "agent") {
        agentControl = true;
        if (expand === true) notify({ type: "panel-request-open" });
      }
      notify({ type: "navigated", url: currentUrl, title: currentTitle, source });
      return { ok: true, url: currentUrl, title: currentTitle };
    },

    // —— REQ-BROWSER-002/003：read（revoked → DENIED；未就绪 → NOT-READY；CSP 退化不报错）——
    async read({ source } = {}) {
      assertAgentAllowed(source);
      if (crashed) throw browserError("E-BROWSER-CRASHED");
      if (!view) {
        // headless 退化（纯 node/CLI 无 Electron 视图）：返回最近一次 fallback 导航的静态快照；
        // 实例从未创建（无任何成功导航）→ E-BROWSER-NOT-READY（锚点 §8-E3 / §10.4 接口2 未就绪样例）。
        if (!fallbackSnapshot) throw browserError("E-BROWSER-NOT-READY");
        return { ok: true, url: currentUrl, title: currentTitle || "", ...fallbackSnapshot };
      }
      let url = currentUrl;
      let title = currentTitle;
      try {
        const wc = view.webContents;
        if (wc.getURL) url = wc.getURL() || url;
        const snapshot = await wc.executeJavaScript(buildReadScript(), true);
        const { text, elements, truncated } = truncateSnapshot(snapshot);
        if (typeof snapshot?.title === "string" && snapshot.title) title = snapshot.title;
        return { ok: true, url, title, text, elements, truncated };
      } catch (err) {
        // 注入被 CSP 拒 → 退化 {url, title, text:"", elements:[], truncated:false} 不报错（接口2 系统错误行）
        if (err?.code) throw err;
        return { ok: true, url, title: title || "", text: "", elements: [], truncated: false };
      }
    },

    // —— REQ-BROWSER-002/003：scroll（executeJavaScript scrollBy 后回读位置）——
    async scroll({ source, dx = 0, dy = 0 } = {}) {
      assertAgentAllowed(source);
      ensureReady();
      const wc = view.webContents;
      let pos = { scrollX: 0, scrollY: 0 };
      try {
        pos = await wc.executeJavaScript(
          `(() => { window.scrollBy(${Number(dx) || 0}, ${Number(dy) || 0}); return { scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) }; })()`,
          true
        );
      } catch (err) {
        if (err?.code) throw err;
      }
      return { ok: true, scrollX: pos?.scrollX ?? 0, scrollY: pos?.scrollY ?? 0 };
    },

    // —— REQ-BROWSER-002：screenshot（capturePage → PNG 落 <sessionDir>/shots/browser-<n>.png，n 单调递增）——
    async screenshot({ source } = {}) {
      assertAgentAllowed(source);
      ensureReady();
      const image = await view.webContents.capturePage();
      const png = image.toPNG ? image.toPNG() : image;
      screenshotSeq += 1;
      await fs.mkdir(shotsDir, { recursive: true });
      const filePath = path.join(shotsDir, `browser-${screenshotSeq}.png`);
      await fs.writeFile(filePath, png);
      const size = image.getSize ? image.getSize() : { width: 0, height: 0 };
      return { ok: true, path: filePath, width: size.width, height: size.height };
    },

    // —— REQ-BROWSER-001：bounds 哑执行（visible=false 只隐藏，webContents 保活，ADR-039 决策 3）——
    setBounds({ x, y, width, height, visible } = {}) {
      const wasOpen = open;
      open = visible !== false;
      if (!view) return { ok: true, open };
      try {
        if (open && typeof width === "number" && typeof height === "number") {
          view.setBounds({ x: Number(x) || 0, y: Number(y) || 0, width, height });
        }
        if (open !== wasOpen) {
          if (open) attachView(view);
          else detachView(view); // 隐藏 = 从窗口摘除视图，实例与 webContents 保活
        }
      } catch (err) {
        // E6：bounds 同步异常只记日志不弹错，下帧重算恢复
        console.error(JSON.stringify({ event: "browser-view-bounds-error", error: err?.message }));
      }
      return { ok: true, open };
    },

    // —— REQ-BROWSER-003：停止控制状态机 ——
    stopAgentControl() {
      agentControlRevoked = true;
      console.log(JSON.stringify({ event: "browser-agent-control-revoked" }));
      notify({ type: "agent-control-revoked" });
      return { ok: true, agentControlRevoked };
    },

    // —— REQ-BROWSER-001 标准6：state 契约字段（§10.4 接口3 golden）——
    getState() {
      return {
        ok: true,
        open, // 启动后初始收起（§6.3 块1 row3）
        url: currentUrl,
        title: currentTitle,
        agentControl,
        agentControlRevoked,
        crashed,
      };
    },

    // —— REQ-BROWSER-005：Cookie 受控导出（分区 session 独立于视图实例；ADR-039 决策 7）——
    async getCookies({ domain, name } = {}) {
      assertValidCookieDomain(domain);
      const list = await cookieStore.get({ domain, name });
      const cookies = list.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        expires: c.expirationDate ?? c.expires ?? null,
        httpOnly: c.httpOnly === true,
        secure: c.secure === true,
      }));
      // cookieString = 分号拼接明文（采集引擎直用；日志/折叠块展示侧脱敏）
      const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      // 日志脱敏收口：只记域与计数，值与 cookieString 禁入日志（REQ-BROWSER-005 标准 7）
      console.log(JSON.stringify({ event: "browser-cookies-get", domain, count: cookies.length }));
      return { ok: true, domain, cookieString, cookies };
    },

    async deleteCookies({ domain } = {}) {
      assertValidCookieDomain(domain);
      const list = await cookieStore.get({ domain });
      let deletedCount = 0;
      for (const c of list) {
        try {
          deletedCount += await cookieStore.remove(c, domain);
        } catch {
          // 单条删除失败（已失效/竞态）不计入，不阻断其余删除
        }
      }
      // 域级审计日志：仅域，不含任何 cookie 值（REQ-BROWSER-005 标准 7 / §10.7）
      console.log(JSON.stringify({ event: "browser-cookies-delete", domain, deletedCount }));
      return { ok: true, deletedCount };
    },

    // dev/test-only seam（业务测试骨架注释约定「实现提供测试 seam（分区 session.cookies.set）」，
    // 经 POST /api/browser/_test/seed-cookies 到达，路由层 NODE_ENV=test 门控——生产语义不开
    // Cookie 写入面，REQ-BROWSER-005 安全边界：凭据唯一来源=用户在面板内真实登录）：
    // 经 cookieStore adapter 统一写入（fallback 走内存 Map，Electron 走分区 session.cookies.set，
    // E2E 亦可用）。入参 {cookies:[{name,value,domain,path?,expires?,httpOnly?,secure?}]} 或单个 cookie 对象。
    async _seedCookiesForTest(details) {
      const list = Array.isArray(details?.cookies) ? details.cookies : details ? [details] : [];
      if (!session.isFallback && !(session.cookies && typeof session.cookies.set === "function")) {
        return { ok: false, error: { code: "E-BROWSER-SEED-UNAVAILABLE" } };
      }
      for (const c of list) {
        await cookieStore.set(c);
      }
      return { ok: true, count: list.length };
    },

    // 注入 seam（Slice 2/3 与测试用）：运行期替换导航执行器
    setNavigateExecutor(fn) {
      navigateExecutor = typeof fn === "function" ? fn : null;
    },

    // 事件回调注入（main.js 接线：mainWindow.webContents.send("opc-browser-event", …)）
    setNotifier(fn) {
      notifierRef.fn = typeof fn === "function" ? fn : null;
    },

    dispose() {
      if (view) {
        try { detachView(view); } catch { /* ignore */ }
        try { view.webContents?.close?.(); } catch { /* ignore */ }
        view = null;
      }
    },
  };
}
