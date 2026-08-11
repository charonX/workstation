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
        // BUG-002：S1 主进程服务层（permissionConfigService）顶层 import createJiti
        // 加载 gotgenes TS 源码——运行期从 node_modules（dev）/ asar 内 node_modules
        // （生产）加载，不可内联（内部动态 import/fs 加载 .ts 源码）。rolldown 内联
        // jiti 的 CJS webpack chunk 会保留 `__require("node:os")` 兜底调用，而主
        // bundle 是 ESM（formats:["es"]）无 require → 加载即崩。对齐
        // vite.worker.config.js 同规则（regex 覆盖子路径）。
        /^jiti(\/|$)/,
        /^node:/
      ]
    }
  }
});
