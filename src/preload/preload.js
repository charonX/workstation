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
   * Test-only hook to replace the directory picker implementation.
   * @param {Function} fn - async (title, defaultPath) => string | null
   */
  __setSelectDirectoryImpl: (fn) => { selectDirectoryImpl = fn; },
});
