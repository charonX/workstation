import { defineConfig } from "vite";

// agent 子进程入口 bundle（H1：asar 打包下 ELECTRON_RUN_AS_NODE=1 + asar 内 bundle
// 可 spawn；spike 已实测 require asar 内文件通过，无需 asarUnpack）。
//
// pi 系列包保持 external：运行期从 asar 内 node_modules 加载（electron-forge 打包
// dependencies 及其嵌套依赖；H1 实测 asar require 可用）。dev/测试模式直接跑源码
// 入口（src/agent/worker.js），不经本 bundle。
//
// BUG-002（code-defect）：better-sqlite3 等 CJS 运行时依赖此前未 external，
// 被整体内联进 ESM bundle——CJS 内部 bare require("fs") 走 rolldown __require
// shim，ESM 运行时无 require → worker import 期即崩（看门狗报"反复崩溃"）。
// 与 vite.main.config.js 对齐：worker 图的直接运行时依赖全部 external（regex
// 覆盖子路径），运行期从 node_modules（dev）/ asar 内 node_modules（生产）加载。
export default defineConfig({
  build: {
    lib: {
      entry: "src/agent/worker.js",
      formats: ["es"],
      fileName: () => "agent-worker.js"
    },
    rollupOptions: {
      external: [
        "@earendil-works/pi-coding-agent",
        "@earendil-works/pi-ai",
        "@earendil-works/pi-agent-core",
        "@earendil-works/pi-tui",
        // Slice 7（REQ-AGENT-033）：jiti 为 gotgenes 工厂加载器（pi-coding-agent
        // 传递依赖）——运行期从 node_modules（dev）/ asar 内 node_modules（生产）
        // 加载，不可内联（内部动态 import/fs 加载 .ts 源码）。
        /^jiti(\/|$)/,
        // BUG-002：worker 图的直接 CJS 运行时依赖（regex 含子路径），不可内联。
        /^better-sqlite3(\/|$)/,
        /^node-cron(\/|$)/,
        /^simple-git(\/|$)/,
        /^@larksuiteoapi\/node-sdk(\/|$)/,
        /^@anthropic-ai\/claude-agent-sdk(\/|$)/,
        /^node:/
      ]
    }
  }
});
