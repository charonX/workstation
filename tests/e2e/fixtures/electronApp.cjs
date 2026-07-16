// REQ-TRACE: codex-harness-desktop/REQ-CLI-001
// REQ-VERSION: v1-hash:5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108
// CAPABILITY-TRACE: command-interface
// ENTITY-TRACE: cli
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const MAIN_ENTRY = path.join(process.cwd(), "src/main/main.js");
const SERVER_JSON_POLL_MS = 200;
const SERVER_JSON_TIMEOUT_MS = 10000;
const VITE_DEV_URL = "http://localhost:5173";
const VITE_READY_POLL_MS = 200;
const VITE_READY_TIMEOUT_MS = 15000;

let viteProcess = null;

/**
 * Wait for the Vite dev server to be reachable.
 */
async function waitForViteDevServer() {
  const start = Date.now();
  while (Date.now() - start < VITE_READY_TIMEOUT_MS) {
    try {
      const res = await fetch(VITE_DEV_URL, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, VITE_READY_POLL_MS));
  }
  throw new Error("Vite dev server did not start within timeout");
}

/**
 * Start the Vite dev server if it is not already running.
 */
async function startViteDevServer() {
  // If Vite is already running, reuse it.
  try {
    const res = await fetch(VITE_DEV_URL, { signal: AbortSignal.timeout(500) });
    if (res.ok) return null;
  } catch {
    // not running, start one
  }

  const child = spawn("npx", ["vite", "--config", "vite.renderer.config.js"], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "development" },
  });

  viteProcess = child;
  await waitForViteDevServer();
  return child;
}

/**
 * Start the Electron application with a temporary userData directory.
 * Waits for the HTTP server to be ready by polling server.json in userData.
 *
 * @returns {Promise<{ electronApp: import('@playwright/test').ElectronApplication, firstWindow: import('@playwright/test').Page, apiBaseUrl: string, userDataDir: string }>}
 */
async function startElectronApp() {
  await startViteDevServer();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-"));

  const electronApp = await electron.launch({
    args: [
      MAIN_ENTRY,
      `--user-data-dir=${userDataDir}`,
      "--no-sandbox",
    ],
    env: {
      ...process.env,
      NODE_ENV: "development",
    },
  });

  const firstWindow = await electronApp.firstWindow();

  // Wait for the HTTP server to publish its port.
  const serverJsonPath = path.join(userDataDir, "server.json");
  const start = Date.now();
  let serverJson;
  while (Date.now() - start < SERVER_JSON_TIMEOUT_MS) {
    try {
      const raw = await fs.readFile(serverJsonPath, "utf-8");
      serverJson = JSON.parse(raw);
      if (serverJson.port) break;
    } catch {
      // file may not exist yet
    }
    await new Promise((resolve) => setTimeout(resolve, SERVER_JSON_POLL_MS));
  }

  if (!serverJson || !serverJson.port) {
    await electronApp.close();
    if (viteProcess) {
      viteProcess.kill();
      viteProcess = null;
    }
    await fs.rm(userDataDir, { recursive: true, force: true });
    throw new Error("Electron app did not publish server.json within timeout");
  }

  const apiBaseUrl = `http://127.0.0.1:${serverJson.port}`;

  return { electronApp, firstWindow, apiBaseUrl, userDataDir };
}

/**
 * Stop the Electron application and clean up the temporary userData directory.
 *
 * @param {import('@playwright/test').ElectronApplication} electronApp
 * @param {string} userDataDir
 */
async function stopElectronApp(electronApp, userDataDir) {
  if (electronApp) {
    await electronApp.close();
  }
  if (userDataDir) {
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { startElectronApp, stopElectronApp, MAIN_ENTRY };
