// BUG-007: bootstrap-env MUST be the first project import. It sets
// OPC_WORKSTATION_CONFIG_DIR and DB_PATH to app.getPath("userData") before any
// module that transitively loads settingsService/db.js runs its top-level
// initialization (ESM static imports are hoisted, so the order here is the
// load order).
import "./bootstrap-env.js";
import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { migrateLegacyDb } from "../db.js";
import { discoverServer } from "../cli/server.js";
import { takeoverExistingServer } from "../serverRegistry.js";
import { isArtifactPathAllowed } from "../preload/artifactPathGuard.js";
import { getDb } from "../db.js";
import { checkForUpdates } from "./updates.js";

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
    serverCtx = await startServer({ reset: false });
    const { server, baseUrl } = serverCtx;
    const { port } = server.address();
    apiBaseUrl = baseUrl;

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
  if (process.env.NODE_ENV === "development" || process.env.ELECTRON_IS_DEV) {
    // Development: load from Vite dev server
    await mainWindow.loadURL("http://localhost:5173");
  } else {
    // Production / test: load bundled renderer
    const rendererPath = path.join(__dirname, "../renderer/main_window/index.html");
    await mainWindow.loadFile(rendererPath);
  }

  mainWindow.maximize();

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

// 手动检查更新（Settings 页"检查更新"按钮 / REQ-DIST-002 AC1）。
ipcMain.handle("opc-check-updates", async () => {
  const repo = parseRepositoryFromPackageJson();
  if (!repo) {
    return {
      currentVersion: app.getVersion(),
      latestVersion: null,
      hasUpdate: false,
      error: { code: "E_UPDATE_PARSE", message: "无法从 package.json repository 字段解析仓库" },
    };
  }
  return checkForUpdates({
    fetchImpl: (url, opts) => fetch(url, opts),
    getVersion: () => app.getVersion(),
    repo,
  });
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
      const result = await checkForUpdates({
        fetchImpl: (url, opts) => fetch(url, opts),
        getVersion: () => app.getVersion(),
        repo,
      });
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
