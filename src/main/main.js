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
// has channel_bindings (a story-2026-07-19 table) while the canonical DB does
// not — if so, back up the stale canonical DB and copy over the real one.
const legacyHomeDb = path.join(os.homedir(), ".opc-workstation", "data.db");
if (fsSync.existsSync(legacyHomeDb) && fsSync.existsSync(newDbPath)) {
  try {
    const homeHasBindings = dbHasTable(legacyHomeDb, "channel_bindings");
    const canonicalHasBindings = dbHasTable(newDbPath, "channel_bindings");
    if (homeHasBindings && !canonicalHasBindings) {
      const backupPath = `${newDbPath}.pre-bug-007.bak`;
      fsSync.copyFileSync(newDbPath, backupPath);
      fsSync.copyFileSync(legacyHomeDb, newDbPath);
      console.log(JSON.stringify({
        event: "bug-007-recovery-db",
        source: legacyHomeDb,
        target: newDbPath,
        backup: backupPath,
        note: "recovered flows/bindings from ~/.opc-workstation/ (pre-bootstrap-env)"
      }));
    }
  } catch (err) {
    console.error(JSON.stringify({ event: "bug-007-recovery-db-error", error: err.message }));
  }
}

function dbHasTable(dbPath, tableName) {
  // Lazy-load better-sqlite3 so the native binding does not affect bootstrap
  // import order; this function only runs during one-time recovery after env is set.
  const Database = require("better-sqlite3");
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(tableName);
      return !!row;
    } finally {
      db.close();
    }
  } catch {
    return false;
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
