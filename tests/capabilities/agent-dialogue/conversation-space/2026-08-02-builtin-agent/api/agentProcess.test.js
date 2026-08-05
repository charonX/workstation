// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-005
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// seam：agentService 真实 spawn + kill（集成）。依赖 H1 假设（asar 打包 spawn 路径）——开发模式跑源码入口。

// seam：agentService（tech-design「agentService（主进程）」+ 实现者测试缝契约）。
// 建议落点 src/services/agentService.js，导出 createAgentService({ cwd, sessionDir, entry }) →
// { start(), stop(), kill(), on("ready"), isAlive(), childPid, logs, createSession({spaceKey,...}), prompt(spaceKey, text), getSession(spaceKey) }。
async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-005）");
  assert.equal(typeof mod.createAgentService, "function", "agentService 应导出 createAgentService()");
  return mod.createAgentService;
}

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`等待超时：${label}`);
}

describe("REQ-AGENT-005 agent 子进程生命周期（看门狗）", () => {
  let workdir;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-proc-"));
    agentService = null;
  });

  afterEach(async () => {
    await agentService?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("spawn 后子进程回 ready", async () => {
    const createAgentService = await loadAgentService();
    agentService = createAgentService({ cwd: workdir, sessionDir: path.join(workdir, "sessions") });
    const readyEvents = [];
    agentService.on("ready", () => readyEvents.push(Date.now()));
    await agentService.start();
    assert.ok(readyEvents.length >= 1, "子进程就绪后应回 ready（REQ-AGENT-005 标准 1）");
    assert.ok(agentService.isAlive(), "子进程应存活");
    assert.ok(Number.isInteger(agentService.childPid), "应有子进程 pid");
  });

  it("心跳超时/exit → 看门狗自动重启", async () => {
    const createAgentService = await loadAgentService();
    agentService = createAgentService({ cwd: workdir, sessionDir: path.join(workdir, "sessions") });
    const readyEvents = [];
    agentService.on("ready", () => readyEvents.push(Date.now()));
    await agentService.start();
    const firstPid = agentService.childPid;
    assert.ok(Number.isInteger(firstPid), "应有子进程 pid");
    // 模拟崩溃：kill 子进程（任意退出码）。
    agentService.kill();
    // 等待看门狗探测 exit + 自动重启（心跳间隔由实现定，测试留足余量）。
    await waitUntil(() => readyEvents.length >= 2, { timeout: 10000, label: "看门狗自动重启（第二次 ready）" });
    assert.ok(readyEvents.length >= 2, `崩溃后应自动重启（收到 ${readyEvents.length} 次 ready，期望 ≥2）`);
    assert.notEqual(agentService.childPid, firstPid, "重启后应为新子进程");
  });

  it("重启后会话按 agent_sessions + JSONL 恢复，只丢半条流式消息", async () => {
    const createAgentService = await loadAgentService();
    agentService = createAgentService({ cwd: workdir, sessionDir: path.join(workdir, "sessions") });
    const readyEvents = [];
    agentService.on("ready", () => readyEvents.push(Date.now()));
    await agentService.start();
    await waitUntil(() => readyEvents.length >= 1, { label: "第一次 ready" });
    const session = await agentService.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-1" });
    await agentService.prompt("feishu:oc_1", "记录任务：写周报");
    agentService.kill();
    await waitUntil(() => readyEvents.length >= 2, { timeout: 10000, label: "看门狗重启（第二次 ready）" });
    // 重启后各活跃空间按 agent_sessions 引用 + JSONL 恢复（SessionManager.open，REQ-AGENT-005 标准 3）。
    const restored = agentService.getSession("feishu:oc_1");
    assert.ok(restored, "重启后活跃空间应按 agent_sessions 恢复");
    assert.equal(restored.sessionRef, session.sessionRef, "恢复应复用同一 JSONL 引用");
    // 崩溃前已完成消息（message_end 落盘）应可恢复；只允许丢崩溃时流式中的半条。
    const jsonl = fs.readFileSync(restored.sessionRef, "utf8");
    assert.ok(jsonl.includes("记录任务：写周报"), "崩溃前已完成的消息应仍在 JSONL 中（只丢半条流式消息）");
  });

  it("重启期间 prompt 返回 restarting，就绪后重投", async () => {
    const createAgentService = await loadAgentService();
    agentService = createAgentService({ cwd: workdir, sessionDir: path.join(workdir, "sessions") });
    const readyEvents = [];
    agentService.on("ready", () => readyEvents.push(Date.now()));
    await agentService.start();
    await waitUntil(() => readyEvents.length >= 1, { label: "第一次 ready" });
    await agentService.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-1" });
    agentService.kill();
    // 重启窗口内的 prompt → session-error {code:"restarting"}（主进程缓存，REQ-AGENT-005 标准 4）。
    const err = await agentService.prompt("feishu:oc_1", "重投测试").catch((e) => e);
    assert.ok(err && (err.code === "restarting" || String(err.message).includes("restarting")),
      `重启期间 prompt 应返回 restarting，实际: ${err?.message ?? err}`);
    // 就绪后重投成功。
    await waitUntil(() => readyEvents.length >= 2, { timeout: 10000, label: "看门狗重启（第二次 ready）" });
    const reply = await agentService.prompt("feishu:oc_1", "重投测试");
    assert.ok(reply !== undefined, "就绪后重投应成功（或不可恢复时明确拒绝并提示）");
  });

  it("子进程 stderr 进主进程日志且不含 key 值", async () => {
    const createAgentService = await loadAgentService();
    agentService = createAgentService({ cwd: workdir, sessionDir: path.join(workdir, "sessions"), apiKey: "sk-top-secret-777" });
    const readyEvents = [];
    agentService.on("ready", () => readyEvents.push(Date.now()));
    await agentService.start();
    await waitUntil(() => readyEvents.length >= 1, { label: "第一次 ready" });
    // 触发一次子进程活动（会话创建与日志输出）。
    await agentService.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-top-secret-777" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const logs = agentService.logs ?? [];
    assert.ok(Array.isArray(logs), "agentService 应收集子进程 stderr 日志（REQ-AGENT-005 标准 5）");
    for (const line of logs) {
      assert.ok(!line.includes("sk-top-secret-777"), "子进程日志不得含 key 明文（签核决策 5）");
    }
  });
});
