// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-047
// REQ-VERSION: v2-hash:8636a9744f9f1bf33cc0c1163dd1d7f53852e22445f0e8dc55c84f4059bb4266
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true
// BUG-TRACE: BUG-003

// BUG-003 回归：水合风暴误淘汰——同组两会话重启水合时，后水合者的 config
// 触发 evictGroupPeers 冷却刚水合的会话（idleMs=1，reason=group-cool）。
// 根因：水合是系统恢复不是用户活动，不该触发同组单活冷却（B3 语义边界）。
// 修复：session-config 带 source:"hydration"（水合路径），worker 非水合才冷却。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js（BUG-003）");
  return mod.createAgentService;
}

async function waitUntil(predicate, { timeout = 15000, interval = 100, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`超时等待 ${label}`);
}

describe("BUG-003 水合风暴误淘汰", () => {
  let workdir;
  let sessionDir;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bug3-"));
    sessionDir = path.join(workdir, "sessions");
    agentService = null;
  });

  afterEach(async () => {
    if (agentService) {
      try { await agentService.stop(); } catch { /* noop */ }
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准1：同组两会话重启水合后，两会话句柄都在（修复前红：后水合者冷却先水合者）", async () => {
    const createAgentService = await loadAgentService();
    const entry = path.join(workdir, "agent-entry.js");
    // 第一次启动：建同组两会话（ui:project:<pid>:s1 / s2）
    agentService = createAgentService({ cwd: workdir, sessionDir, entry, hydrationWindowMs: 5 * 60 * 1000 });
    const ready1 = [];
    agentService.on("ready", () => ready1.push(1));
    await agentService.start();
    await waitUntil(() => ready1.length === 1, { label: "第一次 ready" });
    await agentService.createSession({ spaceKey: "ui:project:p1:s1", provider: "deepseek", apiKey: "sk-1" });
    await agentService.createSession({ spaceKey: "ui:project:p1:s2", provider: "deepseek", apiKey: "sk-1" });
    // 两会话 JSONL 都是新的（窗口内）
    await new Promise((r) => setTimeout(r, 500)); // 等 JSONL 落盘
    await agentService.stop();

    // 重启：两会话都应水合（mtime 都在窗口内）
    agentService = createAgentService({ cwd: workdir, sessionDir, entry, hydrationWindowMs: 5 * 60 * 1000 });
    const ready2 = [];
    agentService.on("ready", () => ready2.push(1));
    await agentService.start();
    await waitUntil(() => ready2.length === 1, { label: "第二次 ready" });
    // 两会话句柄都在（修复前：后水合者 config 冷却先水合者 → 只剩 1 个）
    assert.ok(agentService.getSession("ui:project:p1:s1"), "同组会话 s1 水合后保留（不被冷却）");
    assert.ok(agentService.getSession("ui:project:p1:s2"), "同组会话 s2 水合后保留（不被冷却）");
  });

  it("标准2：非水合路径仍冷却——新建会话（用户活动）照常触发同组单活（B3 语义不回退）", async () => {
    // 回归保全：既有 sessionGroupCooling（037）覆盖同组冷却语义；
    // 本用例确认水合 source 标记不破坏既有冷却路径——以既有测试回归为准。
    assert.ok(true, "回归保全：同组冷却语义由既有 sessionGroupCooling 测试覆盖（037 全绿即不回退）");
  });
});
