// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-017
// REQ-VERSION: v1-hash:4ed3c67befef393165738dafca1a9a153b278661403fc6cc06025a430d1bab87
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// BUG-001 回归（code-defect）：飞书消息 → routeToAgent 失败处理路径 console.error
// 写已断开的 stderr 管道 → stdio 流 'error'(EPIPE) 无监听器 → uncaughtException →
// Electron 主进程崩溃弹窗。契约依据 REQ-AGENT-017 验收标准 3「消息路由失败 →
// 复用现有通道错误处理」：失败须优雅降级，日志通道故障不得成为未捕获异常源。
//
// seam：机制级子进程复现。系统 Node v24 内核对真实 stdio EPIPE 默认容错（实测
// 不崩），Electron 主进程的 stdio 流不容错（崩溃截图实证）——故在子进程内手动
// emit 'error'(EPIPE) 模拟 Electron 运行时行为：装 guard → 存活；对照（无 guard）
// → 必死，证明装置真实有效、非假绿。

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Writable } from "node:stream";

const guardModuleUrl = new URL("../../../../../../src/stdioGuard.js", import.meta.url).href;

async function loadGuard() {
  const mod = await import(guardModuleUrl).catch(() => null);
  assert.ok(mod, "seam 未就绪：src/stdioGuard.js 尚未实现（BUG-001 stdio EPIPE 防护）");
  assert.equal(
    typeof mod.installStdioErrorGuard,
    "function",
    "stdioGuard 应导出 installStdioErrorGuard()"
  );
  return mod.installStdioErrorGuard;
}

function fakeStream() {
  return new Writable({ write(_chunk, _enc, cb) { cb(); } });
}

const EPIPE_EXPR = `Object.assign(new Error("write EPIPE"), { code: "EPIPE" })`;

function runChild(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    const watchdog = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("子进程超时未退出"));
    }, 15000);
    child.on("exit", (code) => {
      clearTimeout(watchdog);
      resolve({ code, out, err });
    });
    child.on("error", (e) => {
      clearTimeout(watchdog);
      reject(e);
    });
  });
}

describe("BUG-001 stdio EPIPE 防护（REQ-AGENT-017 AC3 优雅降级）", () => {
  it("seam：src/stdioGuard.js 导出 installStdioErrorGuard()", async () => {
    await loadGuard();
  });

  it("安装后 stdout/stderr 携带 'error' 监听器，且重复安装幂等", async () => {
    const installStdioErrorGuard = await loadGuard();
    const stdout = fakeStream();
    const stderr = fakeStream();
    installStdioErrorGuard({ stdout, stderr });
    assert.ok(stdout.listenerCount("error") >= 1, "stdout 应携带 'error' 监听器");
    assert.ok(stderr.listenerCount("error") >= 1, "stderr 应携带 'error' 监听器");
    const before = stderr.listenerCount("error");
    installStdioErrorGuard({ stdout, stderr });
    assert.equal(stderr.listenerCount("error"), before, "重复安装不得叠加监听器");
  });

  it("安装后 stdio 流错误（EPIPE 及其他）被吞掉，不向外抛出", async () => {
    const installStdioErrorGuard = await loadGuard();
    const stderr = fakeStream();
    installStdioErrorGuard({ stdout: fakeStream(), stderr });
    assert.doesNotThrow(() => {
      stderr.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      stderr.emit("error", new Error("other stdio error"));
    }, "stdio 流错误不得成为未捕获异常源");
  });

  it("回归核心：子进程装 guard 后 stderr 发 'error'(EPIPE) 存活（崩溃场景机制级复现）", async () => {
    await loadGuard();
    const script = `
      import { installStdioErrorGuard } from ${JSON.stringify(guardModuleUrl)};
      installStdioErrorGuard();
      process.stderr.emit("error", ${EPIPE_EXPR});
      console.log("SURVIVED");
    `;
    const { code, out } = await runChild(script);
    assert.equal(code, 0, `装 guard 后子进程应存活退出，实际 code=${code}`);
    assert.ok(out.includes("SURVIVED"), "EPIPE 后进程应继续执行到存活标记");
  });

  it("对照：未装 guard 的子进程同场景必死（证明装置真实制造崩溃机制）", async () => {
    const script = `
      process.stderr.emit("error", ${EPIPE_EXPR});
      console.log("SURVIVED");
    `;
    const { code, out } = await runChild(script);
    assert.notEqual(code, 0, "未装 guard 的子进程应死于未处理 'error'(EPIPE)");
    assert.ok(!out.includes("SURVIVED"), "致死路径不应到达存活标记");
  });
});
