// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-005
// REQ-VERSION: v1-hash:4ed3c67befef393165738dafca1a9a153b278661403fc6cc06025a430d1bab87
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// BUG-002 回归（code-defect）：vite.worker.config.js external 漏配 → better-sqlite3、
// simple-git、@larksuiteoapi/node-sdk、@anthropic-ai/claude-agent-sdk、node-cron 及其
// 传递 CJS 依赖被整体内联进 ESM bundle → CJS 内部 bare require("fs") 走 rolldown
// __require shim → ESM 运行时无 require → import 期即崩 → 看门狗连续重启失败
// （"agent 子进程反复崩溃"）。开发/测试默认跑源码入口（inElectron=false →
// src/agent/worker.js），构建产物是此前唯一未覆盖形态——REQ-AGENT-005 标准 1
// 「spawn → ready」契约的打包路径。
//
// seam：以 electron-forge plugin-vite 自身的配置管线（ViteConfigGenerator，isProd=true）
// 做保真构建——裸跑 vite.worker.config.js 会得到 browser 默认语义的产物（内建模块被
// browser-shim 化），与生产产物不同；forge 管线注入 resolve.conditions=['node'] +
// 内建双形态 external 后才是真实生产形态。
// → ① 结构断言：bundle 无内联 CJS 的裸内建 __require("fs"/...) 调用；
// ② spawn node <bundle>（OPC_AGENT_FAUX=1 零网络）断言收到 ready 协议行且进程存活。
// plain node 与 ELECTRON_RUN_AS_NODE 对本缺陷等价（同为无 require 的 ESM 上下文）。

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../../../", import.meta.url));

async function buildWorkerBundle(outDir) {
  // CJS 模块（exports.default = ViteConfigGenerator）：ESM 动态 import 后取双层 default。
  const mod = await import("@electron-forge/plugin-vite/dist/ViteConfig.js");
  const ViteConfigGenerator = mod.default?.default ?? mod.default;
  const { build } = await import("vite");
  const generator = new ViteConfigGenerator(
    { build: [{ entry: "src/agent/worker.js", config: "vite.worker.config.js" }], renderer: [] },
    repoRoot,
    true // isProd：build 命令语义（与 electron-forge package/make 的产物形态一致）
  );
  const [workerConfig] = await generator.getBuildConfigs();
  assert.ok(workerConfig, "forge 管线应解析出 worker 构建配置");
  await build({
    ...workerConfig,
    logLevel: "silent",
    build: { ...workerConfig.build, outDir, emptyOutDir: true, watch: null, minify: false }
  });
  return path.join(outDir, "agent-worker.js");
}

// spawn bundle 并等待 stdio 协议 ready 行；提前退出/超时即拒（附 stderr 摘要）。
function waitWorkerReady(bundlePath, workdir, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundlePath], {
      cwd: workdir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        OPC_AGENT_FAUX: "1",
        OPC_AGENT_SESSION_DIR: path.join(workdir, "sessions"),
        OPC_AGENT_HOME: path.join(workdir, ".agent-home"),
        OPC_AGENT_CWD: workdir
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => { stderr += String(d); });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error(`等待 ready 超时（${timeoutMs}ms）。stderr 摘要：${stderr.slice(-500)}`));
    }, timeoutMs);
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      child.kill("SIGKILL");
      reject(err);
    };
    child.on("exit", (code) => {
      fail(new Error(`worker 启动后即退出 code=${code}（构建产物不可运行）。stderr 摘要：${stderr.slice(-800)}`));
    });
    rl.on("line", (line) => {
      if (settled) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.type === "ready") {
        settled = true;
        clearTimeout(timer);
        rl.close();
        resolve({ child });
      }
    });
  });
}

describe("BUG-002 agent-worker 构建产物可运行（REQ-AGENT-005 标准 1 打包形态）", () => {
  // 构建目录放仓库内（临时、用后清理）：external 依赖的 bare import 需经
  // node_modules 向上查找解析——放仓库外（如 os.tmpdir()）会因找不到
  // node_modules 而误伤，与本 bug 无关。
  let buildDir;
  let workdir;
  let bundlePath;
  let spawnedChild = null;

  before(async () => {
    buildDir = fs.mkdtempSync(path.join(repoRoot, ".tmp-worker-bundle-"));
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-bundle-cwd-"));
    bundlePath = await buildWorkerBundle(buildDir);
    assert.ok(fs.existsSync(bundlePath), "构建应产出 agent-worker.js");
  }, { timeout: 180000 });

  after(async () => {
    if (spawnedChild && spawnedChild.exitCode === null) {
      spawnedChild.kill("SIGKILL");
      await new Promise((r) => spawnedChild.once("exit", r));
    }
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("bundle 不含内联 CJS 的裸内建 __require 调用（external 契约）", () => {
    const text = fs.readFileSync(bundlePath, "utf8");
    const m = text.match(/__require\("([^"]+)"\)/g);
    assert.ok(
      !m,
      `bundle 不应内联含裸内建 require 的 CJS 模块（命中：${[...new Set(m ?? [])].join(", ")}）——`
      + `better-sqlite3 等运行时依赖应 external（BUG-002）`
    );
  });

  it("spawn node <bundle> → 进入 stdio 协议回 ready 且进程存活（生产 spawn 形态）", async () => {
    const { child } = await waitWorkerReady(bundlePath, workdir);
    spawnedChild = child;
    assert.equal(child.exitCode, null, "收到 ready 后 worker 应持续存活");
    // 优雅关闭：shutdown 协议行 → worker 清理退出（不留孤儿进程）。
    child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`);
    const code = await new Promise((r) => child.once("exit", r));
    assert.equal(code, 0, "shutdown 后应正常退出");
    spawnedChild = null;
  });
});
