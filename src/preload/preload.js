const { contextBridge, ipcRenderer, webUtils } = require("electron");

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

// 附件文件路径解析（REQ-AGENT-098，Slice 5）：文件选择器 File 对象的真实磁盘路径。
// Electron 经 webUtils.getPathForFile 解析（File.path 的现代替代——CDP/测试注入
// 的 File 对象无 .path 属性；webUtils 按 FileData 内部路径解析，两者都覆盖）。
// 失败（非本应用 File / 桥接异常）→ 空串（调用方拒绝附加并提示，E8 口径）。
contextBridge.exposeInMainWorld("opc", {
  apiBaseUrl,

  /**
   * 解析 File 对象对应的磁盘路径（webUtils.getPathForFile 封装）。
   * @param {File} file - 文件选择器/测试注入产生的 File 对象
   * @returns {string} 磁盘绝对路径；无法解析 → ""
   */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },

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
   * 在系统浏览器打开任意 http(s) URL（REQ-BROWSER-004「在系统浏览器打开」入口）。
   * 主进程侧做 http/https 白名单（防 shell 协议滥用）。
   * @param {string} url
   * @returns {Promise<boolean>} 是否成功打开。
   */
  openExternal: (url) => ipcRenderer.invoke("opc-open-external", { url }),

  /**
   * 内置浏览器面板桥（REQ-BROWSER-001/003/004，PRD §10.4 接口 5，GAP-2 裁决：
   * 渲染进程 ↔ 主进程走 preload IPC，不直接依赖 HTTP 面）。
   * - bounds 用 send（渲染侧 rAF 节流后推送，布局真相归渲染进程）；
   * - stop-agent-control / navigate / getState 用 invoke；
   * - navigate 的 source 由主进程固定为 "user"（渲染进程无 agent 来源面）；
   * - onEvent 订阅主进程转发事件（navigated/panel-request-open/crashed/load-failed/
   *   agent-control-revoked/cookie-updated），返回退订函数。
   */
  browser: {
    /** @param {{x:number,y:number,width:number,height:number,visible:boolean}} bounds */
    sendBounds: (bounds) => ipcRenderer.send("opc-browser-bounds", bounds),
    /** @returns {Promise<{ok:true, agentControlRevoked:boolean}|{ok:false,error:{code:string}}>} */
    stopAgentControl: () => ipcRenderer.invoke("opc-browser-control", { action: "stop-agent-control" }),
    /** @param {{url:string}} input @returns {Promise<{ok:true,url:string,title:string}|{ok:false,error:{code:string,reason?:string}}>} */
    navigate: ({ url }) => ipcRenderer.invoke("opc-browser-navigate", { url }),
    /** @returns {Promise<{ok:true,open:boolean,url:string|null,title:string|null,agentControl:boolean,agentControlRevoked:boolean,crashed:boolean}>} */
    getState: () => ipcRenderer.invoke("opc-browser-state"),
    /**
     * @param {(payload: {type:string, url?:string, title?:string, source?:string, reason?:string}) => void} handler
     * @returns {() => void} 退订函数
     */
    onEvent: (handler) => {
      const wrapped = (_event, payload) => handler(payload);
      ipcRenderer.on("opc-browser-event", wrapped);
      return () => ipcRenderer.removeListener("opc-browser-event", wrapped);
    },
  },

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
   * Test-only seam: drive a real click inside the browser panel's WebContentsView
   * (E2E popup-interception flow; main-process handler is development-gated).
   * @param {string} selector
   * @returns {Promise<{ok:boolean, error?:{code:string}}>}
   */
  __browserTestClick: (selector) =>
    ipcRenderer.invoke("opc-browser-test-click", { selector }),

  /**
   * Test-only seam to seed agent sessions (feishu/orphan 会话无 HTTP 创建面，
   * 2026-08-02-ui-copilot E2E 造数）。写 agent-sessions.db + JSONL 历史。
   * @param {Array<{spaceKey: string, title?: string, createdAt?: string, lastActiveAt?: string, messages?: Array<{role: string, text: string, time?: string}>}>} rows
   * @returns {Promise<number>}
   */
  __seedAgentSessions: (rows) =>
    ipcRenderer.invoke("opc-seed-agent-sessions", rows),
});
