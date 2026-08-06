const { contextBridge, ipcRenderer } = require("electron");

/**
 * Discover the local HTTP API base URL.
 * The main process sets OPC_API_BASE_URL before creating the renderer.
 */
function discoverApiBaseUrl() {
  if (process.env.OPC_API_BASE_URL) {
    return process.env.OPC_API_BASE_URL;
  }

  // Fallback: command-line argument passed via additionalArguments.
  for (const arg of process.argv) {
    if (arg.startsWith("--opc-api-base-url=")) {
      const url = arg.slice("--opc-api-base-url=".length);
      if (url) return url;
    }
    if (arg.startsWith("opc-api-base-url=")) {
      const url = arg.slice("opc-api-base-url=".length);
      if (url) return url;
    }
  }

  // Ultimate fallback for development.
  return "http://127.0.0.1:3000";
}

const apiBaseUrl = discoverApiBaseUrl();

/**
 * The implementation behind window.opc.selectDirectory.
 * It is kept as a mutable closure variable so that E2E tests can replace it
 * without needing to mutate the contextBridge-exposed window.opc object.
 */
let selectDirectoryImpl = (title, defaultPath) =>
  ipcRenderer.invoke("opc-select-directory", { title, defaultPath });

contextBridge.exposeInMainWorld("opc", {
  apiBaseUrl,

  /**
   * Open a native directory picker dialog.
   * @param {string} title - Dialog title.
   * @param {string} [defaultPath] - Initial directory path.
   * @returns {Promise<string | null>} Selected directory path, or null if cancelled.
   */
  selectDirectory: (title, defaultPath) => selectDirectoryImpl(title, defaultPath),

  /**
   * Open an artifact path with the system's default application.
   * Paths outside the project root are rejected by a whitelist guard in the main process.
   * @param {string} projectRoot
   * @param {string} artifactPath
   * @returns {Promise<string>}
   */
  openArtifactPath: (projectRoot, artifactPath) =>
    ipcRenderer.invoke("opc-open-artifact-path", { projectRoot, artifactPath }),

  /**
   * Reveal an artifact path in the system's file manager.
   * Paths outside the project root are rejected by a whitelist guard in the main process.
   * @param {string} projectRoot
   * @param {string} artifactPath
   * @returns {Promise<void>}
   */
  showArtifactInFolder: (projectRoot, artifactPath) =>
    ipcRenderer.invoke("opc-show-artifact-in-folder", { projectRoot, artifactPath }),

  /**
   * 检查应用更新：查询 GitHub 最新 release 并与当前版本比较。
   * @returns {Promise<{currentVersion: string, latestVersion: string|null, hasUpdate: boolean, error: {code: string, message: string}|null}>}
   */
  checkUpdates: () => ipcRenderer.invoke("opc-check-updates"),

  /**
   * 获取当前应用版本号。
   * @returns {Promise<string>}
   */
  getVersion: () => ipcRenderer.invoke("opc-get-version"),

  /**
   * 打开 GitHub Releases 页（系统默认浏览器）。
   * @returns {Promise<boolean>} 是否成功打开。
   */
  openReleasesPage: () => ipcRenderer.invoke("opc-open-releases-page"),

  /**
   * 订阅启动静默检查结果（仅在新版可用时触发一次）。
   * @param {(result: {currentVersion: string, latestVersion: string|null, hasUpdate: boolean, error: {code: string, message: string}|null}) => void} callback
   * @returns {() => void} 退订函数。
   */
  onUpdateResult: (callback) => {
    const handler = (_event, result) => callback(result);
    ipcRenderer.on("opc-silent-update", handler);
    return () => ipcRenderer.removeListener("opc-silent-update", handler);
  },

  /**
   * Test-only hook to replace the directory picker implementation.
   * @param {Function} fn - async (title, defaultPath) => string | null
   */
  __setSelectDirectoryImpl: (fn) => { selectDirectoryImpl = fn; },

  /**
   * Test-only seam to seed notifications directly into the DB from E2E tests.
   * @param {Array<object>} notifications
   * @returns {Promise<number>}
   */
  __seedNotifications: (notifications) =>
    ipcRenderer.invoke("opc-seed-notifications", notifications),

  /**
   * Test-only seam to seed pending agent confirmations directly into the
   * agent-sessions DB (2026-08-02-ui-copilot: E2E 内联确认卡造数，
   * 仿 __seedNotifications 先例）。与 confirmationService 同库。
   * @param {Array<{confirmId: string, sessionKey: string, command: string, args?: object, riskLevel?: string}>} rows
   * @returns {Promise<number>}
   */
  __seedAgentConfirmations: (rows) =>
    ipcRenderer.invoke("opc-seed-agent-confirmations", rows),

  /**
   * Test-only seam to seed agent sessions (feishu/orphan 会话无 HTTP 创建面，
   * 2026-08-02-ui-copilot E2E 造数）。写 agent-sessions.db + JSONL 历史。
   * @param {Array<{spaceKey: string, title?: string, createdAt?: string, lastActiveAt?: string, messages?: Array<{role: string, text: string, time?: string}>}>} rows
   * @returns {Promise<number>}
   */
  __seedAgentSessions: (rows) =>
    ipcRenderer.invoke("opc-seed-agent-sessions", rows),
});
