const { contextBridge } = require("electron");

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

contextBridge.exposeInMainWorld("opc", {
  apiBaseUrl,
});
