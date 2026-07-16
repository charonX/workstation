import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fsSync from "node:fs";
import fs from "node:fs/promises";

// Handle squirrel startup events (Windows installer)
if (process.platform === "win32" && (await import("electron-squirrel-startup")).default) {
  app.quit();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Isolate per-app settings and DB before any service modules are imported,
// so that settingsService and the SQLite DB use the correct paths.
const userData = app.getPath("userData");
process.env.OPC_WORKSTATION_CONFIG_DIR = userData;
process.env.DB_PATH = path.join(userData, "data.db");

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

  // Start the HTTP server only if not already running (guard against activate)
  if (!serverCtx) {
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
