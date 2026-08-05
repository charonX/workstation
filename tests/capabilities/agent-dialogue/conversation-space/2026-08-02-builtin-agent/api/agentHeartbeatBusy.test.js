// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-005
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// BUG-008（code-defect）回归：worker 长流式生成期间，心跳 ping 必须仍被及时响应，
// 看门狗不得误杀「健康但忙碌」的子进程（REQ-AGENT-005 标准 2 的意图是检测真崩溃；
// 误杀直接导致 REQ-AGENT-019 标准 1/2 流式回复中途断裂，飞书卡片停在「生成中...」）。
//
// 根因：worker 把 stdin 所有消息（含 ping）塞进全局串行队列逐条 await，
// handlePrompt 会 await 整个 LLM 生成（几十秒）→ 期间到达的 ping 排在 prompt
// 后面无法处理 → 主进程 HEARTBEAT_TIMEOUT_MS(6s) 收不到 pong → SIGKILL 强杀。
// 短回复 6s 内生成完故不触发，长回复必现。
//
// 为什么既有测试全绿：FAUX 模式 tokensPerSecond=1000，生成瞬时完成，ping 从不
// 被长 prompt 阻塞。本测试用 OPC_AGENT_FAUX_TPS=1 把 faux 流式拉长到远超心跳
// 超时窗口，让「生成中收到 ping」真实发生。
//
// seam：createAgentService({ cwd, sessionDir }) 默认入口 = 真实 worker
// （src/agent/worker.js），NODE_ENV=test 自动 FAUX（零网络）。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 与 src/services/agentService.js 的 HEARTBEAT_TIMEOUT_MS 对齐：生成必须横跨
// 完整的超时窗口才能证明「忙碌不被误杀」。
const HEARTBEAT_TIMEOUT_MS = 6000;

describe("BUG-008 回归：长生成期间看门狗不得误杀健康忙碌的 worker（REQ-AGENT-005）", () => {
  let workdir;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-heartbeat-busy-"));
    agentService = null;
    // faux 慢速流式：生成时间远超 6s 心跳超时（测试结束 stop() SIGTERM 中止，
    // 不等生成完成）。
    process.env.OPC_AGENT_FAUX_TPS = "1";
  });

  afterEach(async () => {
    delete process.env.OPC_AGENT_FAUX_TPS;
    await agentService?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("长流式生成横跨心跳超时窗口：子进程不被重启、prompt 不被打断（修复前红：6s 无 pong → SIGKILL）", async () => {
    const createAgentService = await loadAgentService();
    agentService = createAgentService({ cwd: workdir, sessionDir: path.join(workdir, "sessions") });
    const readyEvents = [];
    agentService.on("ready", () => readyEvents.push(Date.now()));
    await agentService.start();
    await waitUntil(() => readyEvents.length === 1, { label: "第一次 ready" });
    await agentService.createSession({ spaceKey: "feishu:oc_1", provider: "deepseek", apiKey: "sk-1" });
    const firstPid = agentService.childPid;
    assert.ok(Number.isInteger(firstPid), "应有子进程 pid");

    // 发起长生成（faux tps=1，生成远慢于心跳超时）；红态下 prompt 会被
    // 看门狗 reject（restarting），先挂 catch 防 unhandled rejection。
    // 不 await 完成：tps=1 生成要几十秒，stop() SIGTERM 中止即可。
    let promptOutcome = null;
    agentService
      .prompt("feishu:oc_1", "请写一份详细的项目周报")
      .then((r) => { promptOutcome = { settled: "resolved", value: r }; })
      .catch((e) => { promptOutcome = { settled: "rejected", error: e }; });

    // 等过完整心跳超时窗口 + 余量：此时生成仍在进行中（tps=1）。
    await sleep(HEARTBEAT_TIMEOUT_MS + 2000);

    assert.equal(
      readyEvents.length,
      1,
      `长生成期间看门狗不得重启子进程（收到 ${readyEvents.length} 次 ready，期望 1）；` +
        `日志: ${agentService.logs.filter((l) => l.includes("心跳") || l.includes("重启")).join(" | ")}`
    );
    assert.equal(agentService.childPid, firstPid, "长生成期间子进程应保持同一 pid（不被 SIGKILL）");
    assert.ok(
      !agentService.logs.some((l) => l.includes("心跳超时")),
      "长生成期间不得出现心跳超时误判（ping 须带外即时响应）"
    );
    // 红态下此刻 prompt 已被看门狗 reject（restarting）。
    assert.ok(
      !(promptOutcome?.settled === "rejected" && String(promptOutcome.error?.message ?? "").includes("重启")),
      `进行中的 prompt 不得被看门狗重启打断，实际: ${JSON.stringify(promptOutcome).slice(0, 200)}`
    );
  });
});
