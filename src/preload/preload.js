import { contextBridge } from "electron";

/**
 * Discover the local HTTP API base URL.
 * The main process passes the base URL via a command-line argument
 * (--opc-api-base-url=...) which is available in the renderer process.
 */
function discoverApiBaseUrl() {
  // The main process passes --opc-api-base-url via additionalArguments
  // in webPreferences. Chromium strips the leading dashes, so we look for
  // opc-api-base-url=... in process.argv within the renderer.
  // In preload, we can read process.argv.
  for (const arg of process.argv) {
    if (arg.startsWith("--opc-api-base-url=")) {
      return arg.slice("--opc-api-base-url=".length);
    }
    if (arg.startsWith("opc-api-base-url=")) {
      return arg.slice("opc-api-base-url=".length);
    }
  }

  // Fallback: try to read from environment (set by main process)
  if (process.env.OPC_API_BASE_URL) {
    return process.env.OPC_API_BASE_URL;
  }

  // Ultimate fallback for development
  return "http://127.0.0.1:3000";
}

const apiBaseUrl = discoverApiBaseUrl();

contextBridge.exposeInMainWorld("opc", {
  apiBaseUrl,
});
