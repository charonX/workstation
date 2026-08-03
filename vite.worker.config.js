import { defineConfig } from "vite";

// agent 子进程入口 bundle（H1：asar 打包下 ELECTRON_RUN_AS_NODE=1 + asar 内 bundle
// 可 spawn；spike 已实测 require asar 内文件通过，无需 asarUnpack）。
//
// pi 系列包保持 external：运行期从 asar 内 node_modules 加载（electron-forge 打包
// dependencies 及其嵌套依赖；H1 实测 asar require 可用）。dev/测试模式直接跑源码
// 入口（src/agent/worker.js），不经本 bundle。
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
        /^node:/
      ]
    }
  }
});
