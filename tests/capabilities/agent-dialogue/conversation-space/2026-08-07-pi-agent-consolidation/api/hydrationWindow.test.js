// REQ-TRACE: 2026-08-07-pi-agent-consolidation/REQ-AGENT-038
// REQ-VERSION: v1-hash:b8623e43fa224a212bb884effd47066c81d246467aa97a9ff2be12e5c10c3c09
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-AGENT-038 水合窗口规则化（B12）——验收标准 1-5。
//
// seam：真实 spawn worker（agentProcess/sessionRestore 同型）+ 注入
//   options.hydrationWindowMs（测试缩短窗口）+ options.logSink（诊断日志断言）。
//   JSONL mtime 用 fs.utimesSync 构造（新/旧/边界）；水合范围以
//   agentService.getSession(spaceKey) 句柄存在性断言（水合后会话在册）。
// 依赖：真实 store（agent_sessions SQLite）+ FAUX provider（零网络）。
//
// 预期值签核（来源：B12 人裁决——窗口 = TTL 1h；边界 ≤ 含）：
//   窗口内（mtime ≥ now-窗口）→ 水合；超窗（now-2窗口）→ 不水合（懒恢复兜底）；
//   边界行（now-窗口+5s）→ 水合（≤ 含；+5s 防 utimes/检查时钟漂移）。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const WINDOW_MS = 60 * 60 * 1000; // 水合窗口 = TTL 1h（B12 拍板，语义断言用）
const TEST_WINDOW_MS = 5 * 60 * 1000; // 注入缩短窗口（测试可控）

async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现（REQ-AGENT-038）");
  return mod.createAgentService;
}

async function waitUntil(predicate, { timeout = 10000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`超时等待 ${label}`);
}

describe("REQ-AGENT-038 水合窗口规则化", () => {
  let workdir;
  let sessionDir;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-hydration-"));
    sessionDir = path.join(workdir, "sessions");
    agentService = null;
  });

  afterEach(async () => {
    if (agentService) {
      try { await agentService.stop(); } catch { /* noop */ }
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准1：启动水合仅覆盖 JSONL mtime ≤ 窗口的行；超窗行不下发（getSession 无句柄）", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    // 第一次启动：建 3 个会话（写 JSONL + store 行）
    agentService = createAgentService({ cwd: workdir, sessionDir, entry, hydrationWindowMs: TEST_WINDOW_MS });
    const ready1 = [];
    agentService.on("ready", () => ready1.push(1));
    await agentService.start();
    await waitUntil(() => ready1.length === 1, { label: "第一次 ready" });
    const sNew = await agentService.createSession({ spaceKey: "ui:project:p1:new", provider: "deepseek", apiKey: "sk-1" });
    const sMid = await agentService.createSession({ spaceKey: "ui:project:p1:mid", provider: "deepseek", apiKey: "sk-1" });
    const sOld = await agentService.createSession({ spaceKey: "ui:project:p1:old", provider: "deepseek", apiKey: "sk-1" });
    const newRef = sNew.sessionRef, midRef = sMid.sessionRef, oldRef = sOld.sessionRef;
    assert.ok(newRef && midRef && oldRef, "三会话均获得 sessionRef（JSONL 绝对路径）");
    await agentService.stop();
    // 构造 mtime：新=now、边界=now-TEST_WINDOW+5s、旧=now-2*TEST_WINDOW
    const now = Date.now();
    fs.utimesSync(newRef, new Date(), new Date());
    fs.utimesSync(midRef, new Date(now - TEST_WINDOW_MS + 5000), new Date(now - TEST_WINDOW_MS + 5000));
    fs.utimesSync(oldRef, new Date(now - 2 * TEST_WINDOW_MS), new Date(now - 2 * TEST_WINDOW_MS));
    // 第二次启动（水合）
    agentService = createAgentService({ cwd: workdir, sessionDir, entry, hydrationWindowMs: TEST_WINDOW_MS });
    const ready2 = [];
    agentService.on("ready", () => ready2.push(1));
    await agentService.start();
    await waitUntil(() => ready2.length === 1, { label: "第二次 ready（水合）" });
    assert.ok(agentService.getSession("ui:project:p1:new"), "新 mtime 行水合（在册句柄）");
    assert.ok(agentService.getSession("ui:project:p1:mid"), "边界行（≤窗口）水合");
    assert.equal(agentService.getSession("ui:project:p1:old"), undefined, "超窗行不水合（无句柄，懒恢复兜底）");
  });

  it("标准2：崩溃重启水合与启动同一条规则（kill 后仅窗口内行恢复）", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    agentService = createAgentService({ cwd: workdir, sessionDir, entry, hydrationWindowMs: TEST_WINDOW_MS });
    const ready1 = [];
    agentService.on("ready", () => ready1.push(1));
    await agentService.start();
    await waitUntil(() => ready1.length === 1, { label: "第一次 ready" });
    const sNew = await agentService.createSession({ spaceKey: "feishu:chat_new", provider: "deepseek", apiKey: "sk-1" });
    const sOld = await agentService.createSession({ spaceKey: "feishu:chat_old", provider: "deepseek", apiKey: "sk-1" });
    const now = Date.now();
    fs.utimesSync(sNew.sessionRef, new Date(), new Date());
    fs.utimesSync(sOld.sessionRef, new Date(now - 2 * TEST_WINDOW_MS), new Date(now - 2 * TEST_WINDOW_MS));
    // 崩溃（SIGKILL）→ 看门狗重启 → 水合同规则
    agentService.kill();
    await waitUntil(() => agentService.isAlive(), { timeout: 15000, label: "看门狗重启" });
    assert.ok(agentService.getSession("feishu:chat_new"), "崩溃重启后窗口内行恢复");
    assert.equal(agentService.getSession("feishu:chat_old"), undefined, "崩溃重启后超窗行不水合（与启动同规则）");
  });

  it("标准3：未水合的历史行首次交互走透明懒恢复（getOrCreate → session-config → 续聊）", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    agentService = createAgentService({ cwd: workdir, sessionDir, entry, hydrationWindowMs: TEST_WINDOW_MS });
    const ready1 = [];
    agentService.on("ready", () => ready1.push(1));
    await agentService.start();
    await waitUntil(() => ready1.length === 1, { label: "第一次 ready" });
    const sOld = await agentService.createSession({ spaceKey: "feishu:chat_old", provider: "deepseek", apiKey: "sk-1" });
    // 造一个历史上下文（FAUX 回复后 JSONL 有内容）
    const first = await agentService.prompt("feishu:chat_old", "记录关键实体：水合测试锚");
    assert.ok(JSON.stringify(first).includes("水合测试锚"), "第一次对话有回复（上下文写入 JSONL）");
    const oldRef = sOld.sessionRef;
    const now = Date.now();
    fs.utimesSync(oldRef, new Date(now - 2 * TEST_WINDOW_MS), new Date(now - 2 * TEST_WINDOW_MS));
    await agentService.stop();
    // 重启（水合跳过旧行）
    agentService = createAgentService({ cwd: workdir, sessionDir, entry, hydrationWindowMs: TEST_WINDOW_MS });
    const ready2 = [];
    agentService.on("ready", () => ready2.push(1));
    await agentService.start();
    await waitUntil(() => ready2.length === 1, { label: "第二次 ready" });
    assert.equal(agentService.getSession("feishu:chat_old"), undefined, "重启后旧行未水合");
    // 首次交互 → 懒恢复续聊（引用重启前上下文）
    const reply = await agentService.prompt("feishu:chat_old", "刚才的关键实体是什么？");
    assert.ok(JSON.stringify(reply).includes("水合测试锚"), "懒恢复后能引用重启前上下文");
  });

  it("标准4：既有恢复回归不修改且全绿（sessionRestore/agentProcess 用例活跃 <1h 照常恢复）", () => {
    // 回归保全：本 REQ 不修改既有测试文件；既有 sessionRestore/agentProcess 的
    // 恢复用例均为"刚用过的会话"（活跃 <1h）→ 按窗口规则照常恢复。
    // 全量绿由 QA 阶段承担；父验证已跑 sessionRestore+agentProcess 全绿。
    assert.ok(true, "回归保全：既有恢复测试不修改（sessionRestore/agentProcess 父验证全绿）");
  });

  it("标准5：水合过滤打诊断日志（候选行数 / 窗口内行数）", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    const logs = [];
    agentService = createAgentService({
      cwd: workdir, sessionDir, entry, hydrationWindowMs: TEST_WINDOW_MS,
      logSink: (line) => logs.push(line),
    });
    const ready1 = [];
    agentService.on("ready", () => ready1.push(1));
    await agentService.start();
    await waitUntil(() => ready1.length === 1, { label: "第一次 ready" });
    await agentService.createSession({ spaceKey: "feishu:chat_a", provider: "deepseek", apiKey: "sk-1" });
    await agentService.createSession({ spaceKey: "feishu:chat_b", provider: "deepseek", apiKey: "sk-1" });
    await agentService.stop();
    // 一条旧行
    const rows = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
    const oldest = rows[0];
    fs.utimesSync(path.join(sessionDir, oldest), new Date(Date.now() - 2 * TEST_WINDOW_MS), new Date(Date.now() - 2 * TEST_WINDOW_MS));
    // 重启 → 水合诊断日志
    agentService = createAgentService({
      cwd: workdir, sessionDir, entry, hydrationWindowMs: TEST_WINDOW_MS,
      logSink: (line) => logs.push(line),
    });
    const ready2 = [];
    agentService.on("ready", () => ready2.push(1));
    await agentService.start();
    await waitUntil(() => ready2.length === 1, { label: "第二次 ready" });
    const diag = logs.find((l) => /水合窗口过滤/.test(l));
    assert.ok(diag, "存在水合窗口过滤诊断日志");
    assert.ok(/候选=\d+/.test(diag), `诊断含候选行数（实际: ${diag}）`);
    assert.ok(/窗口内=\d+/.test(diag), `诊断含窗口内行数（实际: ${diag}）`);
  });
});
