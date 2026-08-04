// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-009
// REQ-VERSION: v1-hash:4ed3c67befef393165738dafca1a9a153b278661403fc6cc06025a430d1bab87
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// seam：真实子进程 + 临时目录（两次启动断言恢复）。依赖 H2 假设（会话目录自定义 + SessionManager.open）。

// seam：agentService（tech-design「agentService（主进程）」+ signoff 实现者测试缝契约）。
// 建议落点 src/services/agentService.js，导出 createAgentService({ cwd, sessionDir, entry }) →
// { start(), stop(), createSession({spaceKey, provider, apiKey}), prompt(spaceKey, text), getSession(spaceKey) }。
// 真实对话凭据/faux 注入方式由实现期决定（H2 spike 已证恢复机制；对话断言用假 key 即可验证恢复语义）。
async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-009）");
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

describe("REQ-AGENT-009 会话恢复", () => {
  let workdir;
  let sessionDir;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "session-restore-"));
    sessionDir = path.join(workdir, "sessions");
    agentService = null;
  });

  afterEach(async () => {
    await agentService?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("重启后按 agent_sessions + SessionManager.open 恢复上下文", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    // 第一次启动：对话含关键实体「日报」。
    agentService = createAgentService({ cwd: workdir, sessionDir, entry });
    const ev1 = [];
    agentService.on("ready", () => ev1.push(1));
    await agentService.start();
    await waitUntil(() => ev1.length === 1, { label: "第一次 ready" });
    const session = await agentService.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-1" });
    await agentService.prompt("feishu:oc_1", "帮我准备一份日报模板");
    await agentService.stop();

    // 重启（模拟应用/子进程重启）。
    agentService = createAgentService({ cwd: workdir, sessionDir, entry });
    const ev2 = [];
    agentService.on("ready", () => ev2.push(1));
    await agentService.start();
    await waitUntil(() => ev2.length === 1, { label: "第二次 ready" });
    const restored = agentService.getSession("feishu:oc_1");
    assert.ok(restored, "重启后应按 agent_sessions.sessionRef 恢复会话（H2：SessionManager.open）");
    assert.equal(restored.sessionRef, session.sessionRef, "恢复应复用同一 JSONL");
    // 恢复后对话能引用重启前的上下文（REQ-AGENT-009 标准 1：问「刚才的任务」得到正确回应）。
    const reply = await agentService.prompt("feishu:oc_1", "刚才的任务是什么？");
    assert.ok(JSON.stringify(reply).includes("日报"), `恢复后应引用重启前上下文（回答应提到日报），实际: ${JSON.stringify(reply)}`);
  });

  it("JSONL 缺失/损坏 → 新建会话 + 提示历史不可恢复，不阻塞对话", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    agentService = createAgentService({ cwd: workdir, sessionDir, entry });
    const ev1 = [];
    agentService.on("ready", () => ev1.push(1));
    await agentService.start();
    await waitUntil(() => ev1.length === 1, { label: "第一次 ready" });
    const session = await agentService.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-1" });
    await agentService.prompt("feishu:oc_1", "会消失的内容");
    await agentService.stop();

    // 删除 JSONL 模拟丢失/损坏（REQ-AGENT-009 标准 2）。
    fs.rmSync(session.sessionRef, { force: true });

    agentService = createAgentService({ cwd: workdir, sessionDir, entry });
    const ev2 = [];
    agentService.on("ready", () => ev2.push(1));
    await agentService.start();
    await waitUntil(() => ev2.length === 1, { label: "第二次 ready" });
    const recreated = agentService.getSession("feishu:oc_1");
    assert.ok(recreated, "JSONL 缺失时不应阻塞对话");
    assert.notEqual(recreated.sessionRef, session.sessionRef, "应新建会话（新 JSONL）");
    // 用户可见提示：历史不可恢复。
    const hint = recreated.recoveryHint ?? recreated.hint ?? "";
    assert.ok(String(hint).includes("不可恢复"), `应提示历史不可恢复，实际: ${hint}`);
    const reply = await agentService.prompt("feishu:oc_1", "继续");
    assert.ok(reply !== undefined, "新建会话后对话应可用");
  });
});
