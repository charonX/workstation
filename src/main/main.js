import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { startServer, stopServer } from "../http/server.js";
import { registerServerRecord, unregisterServerRecord } from "../cli/server.js";

// Handle squirrel startup events (Windows installer)
if (process.platform === "win32" && (await import("electron-squirrel-startup")).default) {
  app.quit();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let serverCtx = null;
let apiBaseUrl = null;

async function createWindow() {
  const userData = app.getPath("userData");

  // Set DB_PATH before starting the HTTP server so each test run gets isolated data
  const dbPath = path.join(userData, "data.db");
  process.env.DB_PATH = dbPath;

  // Start the HTTP server (do not reset data in production/test)
  serverCtx = await startServer({ reset: false });
  const { port, baseUrl } = serverCtx;
  apiBaseUrl = baseUrl;

  // Write server.json into userData so E2E fixtures can discover the port
  const serverJsonPath = path.join(userData, "server.json");
  await fs.mkdir(userData, { recursive: true });
  await fs.writeFile(serverJsonPath, JSON.stringify({ port, baseUrl }, null, 2));

  // Register server record for CLI discovery
  registerServerRecord(port, process.pid);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--opc-api-base-url=${baseUrl}`],
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

app.whenReady().then(createWindow);

app.on("window-all-closed", async () => {
  // Stop the HTTP server and unregister on window close
  if (serverCtx) {
    await stopServer(serverCtx);
    serverCtx = null;
  }
  unregisterServerRecord();

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
  if (serverCtx) {
    await stopServer(serverCtx);
    serverCtx = null;
  }
  unregisterServerRecord();
});
