import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The main-process bundle reads agentRegistry.json at runtime next to
// import.meta.url (agentRegistryService, REQ-SKILL-018 AC1). Vite bundles JS
// only — this plugin copies the checked-in snapshot beside the bundle on every
// build (closeBundle), and fails loudly if the source ever goes missing
// (BUG-002: built app threw ENOENT on first agent-registry access).
const AGENT_REGISTRY_SNAPSHOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "src/services/agentRegistry.json"
);

function agentRegistrySnapshotPlugin() {
  let outDir;
  return {
    name: "agent-registry-snapshot",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      fs.copyFileSync(AGENT_REGISTRY_SNAPSHOT, path.join(outDir, "agentRegistry.json"));
    }
  };
}

export default defineConfig({
  plugins: [agentRegistrySnapshotPlugin()],
  build: {
    lib: {
      entry: "src/main/main.js",
      formats: ["es"],
      fileName: () => "main.js"
    },
    rollupOptions: {
      external: [
        "electron",
        "better-sqlite3",
        "node-cron",
        "simple-git",
        "electron-squirrel-startup",
        "@larksuiteoapi/node-sdk",
        /^node:/
      ]
    }
  }
});
