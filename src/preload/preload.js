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
      const url = arg.slice("--opc-api-base-url=".length);
      if (url) return url;
    }
    if (arg.startsWith("opc-api-base-url=")) {
      const url = arg.slice("opc-api-base-url=".length);
      if (url) return url;
    }
  }

  // Fallback: try to read from environment (set by main process)
  if (process.env.OPC_API_BASE_URL) {
    return process.env.OPC_API_BASE_URL;
  }

  // Ultimate fallback: localhost with a common dev port.
  // This should only be reached during development if the main process
  // argument passing fails; in production the argument is always present.
  return "http://127.0.0.1:3000";
}

const apiBaseUrl = discoverApiBaseUrl();

contextBridge.exposeInMainWorld("opc", {
  apiBaseUrl,
});
