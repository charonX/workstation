// REQ-TRACE: codex-harness-desktop/REQ-CLI-001
// REQ-VERSION: v1-hash:d430fc9129f2087e72c0880464a7bd5430c420753cace446dc54475760bc46c1
// CAPABILITY-TRACE: command-interface
// ENTITY-TRACE: cli
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

const { electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const MAIN_ENTRY = path.join(process.cwd(), "src/main/main.js");
const SERVER_JSON_POLL_MS = 200;
const SERVER_JSON_TIMEOUT_MS = 10000;

/**
 * Start the Electron application with a temporary userData directory.
 * Waits for the HTTP server to be ready by polling server.json in userData.
 *
 * @returns {Promise<{ electronApp: import('@playwright/test').ElectronApplication, firstWindow: import('@playwright/test').Page, apiBaseUrl: string, userDataDir: string }>}
 */
async function startElectronApp() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "opc-e2e-"));

  const electronApp = await electron.launch({
    args: [
      MAIN_ENTRY,
      `--user-data-dir=${userDataDir}`,
      "--no-sandbox",
    ],
    env: {
      ...process.env,
      NODE_ENV: "test",
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
