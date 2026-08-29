// BUG-001: stdio EPIPE 防护须最先安装（副作用即装，见 src/stdioGuard.js）——
// 不依赖 env/db，不影响下方 bootstrap-env「首个设置 env」的 BUG-007 不变量；
// 位置最前可覆盖包括 bootstrap-env 在内的所有 import 期 console.*。
import "../stdioGuard.js";
// BUG-007: bootstrap-env MUST be the first project import. It sets
// OPC_WORKSTATION_CONFIG_DIR and DB_PATH to app.getPath("userData") before any
// module that transitively loads settingsService/db.js runs its top-level
// initialization (ESM static imports are hoisted, so the order here is the
// load order).
import "./bootstrap-env.js";
import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } from "electron";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { migrateLegacyDb } from "../db.js";
import { discoverServer } from "../cli/server.js";
import { takeoverExistingServer, readServerInfoRaw } from "../serverRegistry.js";
import { isArtifactPathAllowed } from "../preload/artifactPathGuard.js";
import { getDb } from "../db.js";
import { checkForUpdates, E_UPDATE_PARSE } from "./updates.js";
import { setSecretBackend } from "../services/secretStore.js";
import { configDir } from "../services/settingsService.js";
import { safeKeyFor } from "../services/sessionStore.js";

const require = createRequire(import.meta.url);

// Handle squirrel startup events (Windows installer)
if (process.platform === "win32" && (await import("electron-squirrel-startup")).default) {
  app.quit();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// bootstrap-env.js already set OPC_WORKSTATION_CONFIG_DIR and DB_PATH based on
// app.getPath("userData"). Read the resolved values back so we can migrate any
// legacy data.db that predates the unified DB path.
const userData = app.getPath("userData");
const newDbPath = process.env.DB_PATH;
// First, migrate any userData-local data.db (pre-unified-path era) onto the
// canonical DB_PATH. After BUG-007 the canonical path IS userData/data.db, so
// this first call is a no-op when both match — kept for forward compatibility.
migrateLegacyDb({
  legacyPath: path.join(userData, "data.db"),
  targetPath: newDbPath,
  logger: (entry) => console.log(JSON.stringify(entry))
});

// BUG-007 one-time recovery: before the bootstrap-env fix, settingsService and
// the DB were initialized against ~/.opc-workstation/ instead of userData/ due
// to ESM import hoisting. The user's channel credentials were correctly written
// to userData/settings.json (because saveChannelCredentials runs after env is
// set), but flows/bindings/projects created during that window lived in
// ~/.opc-workstation/data.db. Detect this by checking whether the home-dir DB
// has actual channel_bindings ROWS while the canonical DB has none (checking
// row count, not just table existence, because initSchema auto-creates empty
// tables on first startup with the new code) — if so, back up the stale
// canonical DB and copy over the real one.
const legacyHomeDb = path.join(os.homedir(), ".opc-workstation", "data.db");
if (fsSync.existsSync(legacyHomeDb) && fsSync.existsSync(newDbPath)) {
  try {
    const homeBindingCount = dbTableCount(legacyHomeDb, "channel_bindings");
    const canonicalBindingCount = dbTableCount(newDbPath, "channel_bindings");
    if (homeBindingCount > 0 && canonicalBindingCount === 0) {
      const backupPath = `${newDbPath}.pre-bug-007.bak`;
      if (!fsSync.existsSync(backupPath)) {
        fsSync.copyFileSync(newDbPath, backupPath);
      }
      fsSync.copyFileSync(legacyHomeDb, newDbPath);
      console.log(JSON.stringify({
        event: "bug-007-recovery-db",
        source: legacyHomeDb,
        target: newDbPath,
        backup: backupPath,
        recoveredBindings: homeBindingCount,
        note: "recovered flows/bindings from ~/.opc-workstation/ (pre-bootstrap-env)"
      }));
    }
  } catch (err) {
    console.error(JSON.stringify({ event: "bug-007-recovery-db-error", error: err.message }));
  }
}

function dbTableCount(dbPath, tableName) {
  // Lazy-load better-sqlite3 so the native binding does not affect bootstrap
  // import order; this function only runs during one-time recovery after env is set.
  const Database = require("better-sqlite3");
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(tableName);
      if (!tableExists) return 0;
      const row = db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get();
      return row?.c ?? 0;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

const { startServer, stopServer } = await import("../http/server.js");

function resolvePreloadPath() {
  const candidates = [
    path.join(__dirname, "../preload/preload.js"), // source layout
    path.join(__dirname, "preload.js"),            // built layout
  ];
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  // Fallback to source layout; Electron will report the missing file clearly.
  return candidates[0];
}

let mainWindow = null;
let serverCtx = null;
let apiBaseUrl = null;
let isCleaningUp = false;

// 浏览器面板事件转发（REQ-BROWSER-001/002，PRD §10.3 副作用）：manager 的
// navigated/panel-request-open/crashed/load-failed 等事件 → mainWindow.webContents.send
// "opc-browser-event"。窗口尚未创建/已销毁时安全 no-op；server 启动后与 createWindow
// 末尾两处经 setNotifier 挂载同一回调。
function forwardBrowserEventToWindow(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("opc-browser-event", payload);
  }
}

async function cleanupServer() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  if (serverCtx) {
    await stopServer(serverCtx);
    serverCtx = null;
    apiBaseUrl = null;
  }
}

async function createWindow() {
  // Guard: do not start multiple servers on macOS re-activate
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  // Start the HTTP server only if not already running (guard against activate).
  // REQ-WORKSPACE-009: if a headless server is already running, request shutdown and take over.
  if (!serverCtx) {
    // REQ-AGENT-001 AC2：Agent API key 经 Electron safeStorage 加密存储
    // （macOS Keychain / Windows DPAPI / Linux libsecret）；不可用（无钥匙串环境）
    // 时保持 secretStore 默认 fake 后端（settings.json 仍无明文，tech-design 风险表降级）。
    if (typeof safeStorage?.isEncryptionAvailable === "function" && safeStorage.isEncryptionAvailable()) {
      setSecretBackend({
        encrypt: (plaintext) => Buffer.from(safeStorage.encryptString(String(plaintext))).toString("base64"),
        decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, "base64")).toString("utf8")
      });
    }
    const existing = await discoverServer({ allowAnyOwner: true });
    if (existing) {
      try {
        await takeoverExistingServer({ port: existing.port, timeoutMs: 5000 });
      } catch (err) {
        console.error("Failed to takeover existing server:", err.message);
        dialog.showErrorBox(
          "Server Takeover Failed",
          `Could not take over the existing workstation server: ${err.message}`
        );
        app.quit();
        return;
      }
    }
    // 重启保端口（2026-08-02-ui-copilot assistantConfirm AC3「重启后卡片仍挂起」E2E
    // 契约 + server.json 消费者稳定性）：复用本配置目录 registry 中最近一条记录的
    // 端口——应用重启后 baseUrl 不变（E2E 重启场景的既有 apiBaseUrl 继续可达）。
    // 端口被占用时由 startServer 回退随机端口（EADDRINUSE → listen(0)）。
    let preferredPort = 0;
    try {
      const records = readServerInfoRaw();
      const last = records[records.length - 1];
      if (last && Number.isInteger(last.port) && last.port > 0) preferredPort = last.port;
    } catch {
      // 无既有记录 → 随机端口。
    }
    serverCtx = await startServer({ reset: false, port: preferredPort });
    const { server, baseUrl } = serverCtx;
    const { port } = server.address();
    apiBaseUrl = baseUrl;

    // 浏览器面板事件转发接线：窗口尚未创建时 no-op（forwardBrowserEventToWindow 内部
    // 判空），createWindow 末尾统一重挂到当前窗口。
    if (server.services?.getBrowserViewManager) {
      server.services.getBrowserViewManager().setNotifier(forwardBrowserEventToWindow);
    }
    // Write server.json into userData so E2E fixtures can discover the port
    const serverJsonPath = path.join(userData, "server.json");
    await fs.mkdir(userData, { recursive: true });
    await fs.writeFile(serverJsonPath, JSON.stringify({ port, baseUrl }, null, 2));
  }

  const currentBaseUrl = apiBaseUrl;
  process.env.OPC_API_BASE_URL = currentBaseUrl;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--opc-api-base-url=${currentBaseUrl}`],
    },
  });

  // Load renderer
  // 默认落地 = 会话区（ADR-018 / REQ-AGENT-026 AC1）：启动 URL 直接带 #/assistant
  // （不引入 "/" 重定向路由——管理区左导仪表盘指向 "/"（Dashboard）须保持可达，
  // 旧壳零改动；"管理区 ↔ 会话区"往返由 back-to-chat / open-admin 显式导航）。
  if (process.env.NODE_ENV === "development" || process.env.ELECTRON_IS_DEV) {
    // Development: load from Vite dev server
    await mainWindow.loadURL("http://localhost:5173/#/assistant");
  } else {
    // Production / test: load bundled renderer
    const rendererPath = path.join(__dirname, "../renderer/main_window/index.html");
    await mainWindow.loadFile(rendererPath, { hash: "/assistant" });
  }

  mainWindow.maximize();

  // 浏览器面板 notifier 重挂（headless→有窗口切换）：notifier 闭包引用 mainWindow
  // 模块级变量，此处仅确保 server 侧 manager notifier 已接线（createWindow 早退分支
  // 与 server 先于窗口创建的时序兜底）。
  // 同时注入宿主窗口解析器（Slice 3 实证修复：serviceContainer 创建 manager 时无
  // getWindow，视图 attach/屏外停靠/截图全部静默失效）——闭包惰性读 mainWindow，
  // 窗口销毁后自动降级 no-op。
  if (serverCtx?.server?.services?.getBrowserViewManager) {
    const manager = serverCtx.server.services.getBrowserViewManager();
    manager.setNotifier(forwardBrowserEventToWindow);
    if (typeof manager.setWindowResolver === "function") {
      manager.setWindowResolver(() => mainWindow);
    }
  }

  // 启动静默检查（REQ-DIST-002 AC7）：窗口创建/加载后异步触发一次
  scheduleSilentUpdateCheck();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("opc-select-directory", async (_event, { title, defaultPath }) => {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(focusedWindow, {
    title,
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

function resolveArtifactPath(projectRoot, artifactPath) {
  return path.isAbsolute(artifactPath)
    ? artifactPath
    : path.resolve(projectRoot, artifactPath);
}

function assertArtifactPathAllowed(projectRoot, artifactPath) {
  if (!isArtifactPathAllowed(projectRoot, artifactPath)) {
    throw new Error("E-ARTIFACT-PATH-FORBIDDEN");
  }
}

ipcMain.handle("opc-open-artifact-path", async (_event, { projectRoot, artifactPath }) => {
  assertArtifactPathAllowed(projectRoot, artifactPath);
  return shell.openPath(resolveArtifactPath(projectRoot, artifactPath));
});

ipcMain.handle("opc-show-artifact-in-folder", async (_event, { projectRoot, artifactPath }) => {
  assertArtifactPathAllowed(projectRoot, artifactPath);
  shell.showItemInFolder(resolveArtifactPath(projectRoot, artifactPath));
});

// ---- 内置浏览器面板 IPC（REQ-BROWSER-001/003/004，PRD §10.4 接口 5，GAP-2 裁决）----
// 渲染进程经 preload window.opc.browser* 到达本组 handler，不直接依赖 HTTP 面；
// navigate 的 source 在本进程固定为 "user"（渲染进程无 agent 来源面——agent 走
// toolAdapter → HTTP 路由）。serverCtx/manager 未就绪时全部安全降级（NOT-READY 或丢弃）。

function getBrowserManager() {
  try {
    return serverCtx?.server?.services?.getBrowserViewManager?.() ?? null;
  } catch {
    return null;
  }
}

// 布局真相推送（渲染侧已 rAF 节流）：bounds 哑执行 + visible=false 隐藏保活。
ipcMain.on("opc-browser-bounds", (_event, payload) => {
  const manager = getBrowserManager();
  if (!manager || !payload || typeof payload !== "object") return;
  manager.setBounds({
    x: Number(payload.x) || 0,
    y: Number(payload.y) || 0,
    width: Number(payload.width) || 0,
    height: Number(payload.height) || 0,
    visible: payload.visible !== false,
  });
});

ipcMain.handle("opc-browser-control", async (_event, payload) => {
  const manager = getBrowserManager();
  if (!manager) return { ok: false, error: { code: "E-BROWSER-NOT-READY" } };
  if (payload?.action !== "stop-agent-control") {
    return { ok: false, error: { code: "E-BROWSER-BAD-ACTION" } };
  }
  return manager.stopAgentControl();
});

// 渲染进程地址栏导航（source="user" 固定）：错误回传与 HTTP 面同构 {ok:false,error:{code,reason}}。
ipcMain.handle("opc-browser-navigate", async (_event, payload) => {
  const manager = getBrowserManager();
  if (!manager) return { ok: false, error: { code: "E-BROWSER-NOT-READY" } };
  try {
    return await manager.navigate({ url: payload?.url, source: "user" });
  } catch (err) {
    if (err?.code && String(err.code).startsWith("E-BROWSER-")) {
      const error = { code: err.code };
      if (err.reason) error.reason = err.reason;
      return { ok: false, error };
    }
    throw err;
  }
});

ipcMain.handle("opc-browser-state", async () => {
  const manager = getBrowserManager();
  if (!manager) {
    return { ok: true, open: false, url: null, title: null, agentControl: false, agentControlRevoked: false, crashed: false };
  }
  return manager.getState();
});

// 「在系统浏览器打开」（REQ-BROWSER-004 关联菜单 + 面板外链按钮）：http/https 白名单，
// 防 shell 协议（file:/javascript: 等）经 openExternal 滥用。
ipcMain.handle("opc-open-external", async (_event, { url } = {}) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
});

// dev-only seam（E2E 弹窗拦截流程）：驱动面板 WebContentsView 内真实点击——渲染进程
// 不可直接触达视图 webContents（Playwright 只见 BrowserWindow），经本 handler 到 manager。
// 与下方 opc-seed-* 同规：仅 development 注册，生产构建无此面。
if (process.env.NODE_ENV === "development") {
  ipcMain.handle("opc-browser-test-click", async (_event, { selector } = {}) => {
    const manager = getBrowserManager();
    if (!manager || typeof manager._testClick !== "function") {
      return { ok: false, error: { code: "E-BROWSER-NOT-READY" } };
    }
    return manager._testClick(selector);
  });
}

// ---- 检查更新（REQ-DIST-002）----

// 从 package.json repository 字段解析 {owner, repo}。
// 兼容两种形态：字符串 "owner/repo" 与对象 {url: "https://github.com/owner/repo.git"}；
// 缺失/无法解析返回 null（调用方负责降级，不抛异常）。
function parseRepositoryFromPackageJson() {
  try {
    const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const pkg = JSON.parse(fsSync.readFileSync(pkgPath, "utf8"));
    const repository = pkg?.repository;
    if (typeof repository === "string") {
      const m = /^([^/\s]+)\/([^/\s]+)$/.exec(repository);
      if (m) return { owner: m[1], repo: m[2] };
      return null;
    }
    if (repository && typeof repository === "object" && typeof repository.url === "string") {
      const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(repository.url);
      if (m) return { owner: m[1], repo: m[2] };
    }
    return null;
  } catch {
    return null;
  }
}

// 以真实 fetch 与当前应用版本运行一次更新检查（手动 IPC 与启动静默检查共用）。
function runUpdateCheck(repo) {
  return checkForUpdates({
    fetchImpl: (url, opts) => fetch(url, opts),
    getVersion: () => app.getVersion(),
    repo,
  });
}

// 手动检查更新（Settings 页"检查更新"按钮 / REQ-DIST-002 AC1）。
ipcMain.handle("opc-check-updates", async () => {
  const repo = parseRepositoryFromPackageJson();
  if (!repo) {
    return {
      currentVersion: app.getVersion(),
      latestVersion: null,
      hasUpdate: false,
      error: { code: E_UPDATE_PARSE, message: "无法从 package.json repository 字段解析仓库" },
    };
  }
  return runUpdateCheck(repo);
});

ipcMain.handle("opc-get-version", () => app.getVersion());

// "去下载"：打开 GitHub Releases 页（浏览器，REQ-DIST-002 AC2）。
ipcMain.handle("opc-open-releases-page", async () => {
  const repo = parseRepositoryFromPackageJson();
  if (!repo) return false;
  try {
    await shell.openExternal(`https://github.com/${repo.owner}/${repo.repo}/releases`);
    return true;
  } catch {
    return false;
  }
});

// 启动静默检查（REQ-DIST-002 AC7）：窗口创建后约 8 秒异步触发一次。
// 有新版 → webContents.send("opc-silent-update")（UI 提示路径由 Slice 3 Settings 页接入）；
// 失败/无新版 → 完全静默（仅一行日志），绝不打扰用户、绝不弹窗、绝不抛未捕获异常。
const SILENT_UPDATE_CHECK_DELAY_MS = 8000;

function scheduleSilentUpdateCheck() {
  setTimeout(async () => {
    const repo = parseRepositoryFromPackageJson();
    if (!repo) return;
    try {
      const result = await runUpdateCheck(repo);
      if (result.hasUpdate && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("opc-silent-update", result);
      }
      console.log(JSON.stringify({ event: "opc-silent-update-check", ...result }));
    } catch (err) {
      // checkForUpdates 已吞掉所有异常，这里仅作最后防线，防止未捕获异常
      console.log(JSON.stringify({ event: "opc-silent-update-check-error", error: err?.message ?? String(err) }));
    }
  }, SILENT_UPDATE_CHECK_DELAY_MS);
}

// Test-only seam: E2E helper seeds notifications by writing directly to the DB.
// Guarded to development so production builds do not expose this surface.
if (process.env.NODE_ENV === "development") {
  ipcMain.handle("opc-seed-notifications", async (_event, notifications) => {
    const list = Array.isArray(notifications) ? notifications : [];
    const db = getDb();
    const insert = db.prepare(`
      INSERT OR REPLACE INTO notifications (id, type, title, body, executionId, createdAt, readAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of list) {
      insert.run(
        n.id,
        n.type,
        n.title,
        n.body ?? null,
        n.executionId ?? null,
        n.createdAt,
        n.readAt ?? null
      );
    }
    return list.length;
  });
}

// Test-only seam（2026-08-02-ui-copilot，仿 opc-seed-notifications 先例）：E2E 直写
// agent-sessions.db 造数——与生产 sessionStore/confirmationService 同库同路径
// （<configDir>/agent-sessions.db；JSONL 会话目录 <configDir>/agent-sessions）。
// Guarded to development so production builds do not expose this surface.
if (process.env.NODE_ENV === "development") {
  // 直写挂起确认行（assistantConfirm.test.cjs 种子 seam）：rows =
  // [{ confirmId, sessionKey, command, args?, riskLevel? }] → INSERT pending 行。
  // 挂起队列 = SQLite 真相（agent_confirmations），与 confirmationService 同库。
  ipcMain.handle("opc-seed-agent-confirmations", async (_event, rows) => {
    const list = Array.isArray(rows) ? rows : [];
    const db = getDb(path.join(configDir(), "agent-sessions.db"));
    const insert = db.prepare(`
      INSERT OR REPLACE INTO agent_confirmations
        (confirmId, sessionKey, command, args, riskLevel, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `);
    const now = new Date().toISOString();
    for (const r of list) {
      insert.run(
        r.confirmId,
        r.sessionKey ?? "",
        r.command ?? "",
        JSON.stringify(r.args ?? {}),
        r.riskLevel ?? "confirm",
        now,
        now
      );
    }
    return list.length;
  });

  // 造飞书/孤儿会话（assistantFeishu.test.cjs 种子 seam）：rows =
  // [{ spaceKey, title?, createdAt?, lastActiveAt?, messages?: [{ role, text, time? }] }]
  // - 新 spaceKey → INSERT agent_sessions 行 + JSONL 历史（可被 GET .../messages
  //   投影读到，气泡渲染源）；
  // - 已有 spaceKey → 追加 messages + 更新 lastActiveAt（模拟通道侧新消息到达）；
  // - sessionRef 命名与 sessionStore 同规（safeKeyFor）。
  ipcMain.handle("opc-seed-agent-sessions", async (_event, rows) => {
    const list = Array.isArray(rows) ? rows : [];
    const db = getDb(path.join(configDir(), "agent-sessions.db"));
    const sessionDir = path.join(configDir(), "agent-sessions");
    const now = new Date().toISOString();
    for (const r of list) {
      const spaceKey = String(r.spaceKey ?? "");
      if (spaceKey === "") continue;
      const ref = path.join(sessionDir, `${safeKeyFor(spaceKey)}.jsonl`);
      const existing = db.prepare("SELECT sessionRef FROM agent_sessions WHERE spaceKey = ?").get(spaceKey);
      if (existing) {
        // 已有空间：追加消息 + 更新 lastActiveAt（lastActiveAt 缺省 = 不改变活跃序外
        // 的新时间——模拟「新消息到达」）。
        appendSeedMessages(ref, r.messages);
        db.prepare("UPDATE agent_sessions SET lastActiveAt = ? WHERE spaceKey = ?").run(
          r.lastActiveAt ?? now,
          spaceKey
        );
      } else {
        fsSync.mkdirSync(sessionDir, { recursive: true });
        db.prepare(
          "INSERT INTO agent_sessions (spaceKey, sessionRef, createdAt, lastActiveAt, title) VALUES (?, ?, ?, ?, ?)"
        ).run(spaceKey, ref, r.createdAt ?? now, r.lastActiveAt ?? now, r.title ?? null);
        appendSeedMessages(ref, r.messages);
      }
    }
    return list.length;
  });
}

// JSONL 历史种子追加（与 agentService appendJsonlMessage 同构——B1：平台侧不复制
// 全文，运行时真相 = PI JSONL；投影契约见 agentSessions.js projectMessagesFromJsonl）。
function appendSeedMessages(ref, messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) return;
  fsSync.mkdirSync(path.dirname(ref), { recursive: true });
  const lines = list.map((m) =>
    JSON.stringify({
      type: "message",
      id: randomUUID(),
      timestamp: typeof m.time === "string" ? m.time : new Date().toISOString(),
      message: {
        role: typeof m.role === "string" ? m.role : "user",
        content: [{ type: "text", text: String(m.text ?? "") }],
      },
    })
  );
  fsSync.appendFileSync(ref, `${lines.join("\n")}\n`);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", async () => {
  await cleanupServer();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", async () => {
  await cleanupServer();
});
