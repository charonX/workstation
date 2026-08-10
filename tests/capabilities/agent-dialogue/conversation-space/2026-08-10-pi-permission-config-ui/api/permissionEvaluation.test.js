// REQ-TRACE: 2026-08-10-pi-permission-config-ui/REQ-AGENT-069
// REQ-VERSION: v1-hash:4b944146fd166a4f60e5ba65080efefeb75690ff7be837718c867c2d2c01b77d
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// 保存即生效（REQ-AGENT-069）：真实 worker + gotgenes，改项目文件后同一会话内
// 权限评估结果变化——证明"我们保存的文件被运行时正确消费"（T3 实证：每次评估
// stat 文件，stamp 变即重读；本测试验证端到端）。
//
// seam 1：真实 worker spawn（createAgentService + 会话句柄，对齐
//   workerServerDiscovery.test.js 先例）——零 FAUX 网络，项目空间会话。
// seam 2：项目 .pi 文件写入（模拟 UI 保存的动作：写 config.json）。
// seam 3：权限评估驱动——FAUX 工具序列（OPC_FAUX_TOOL_SEQUENCE）或直接调用
//   评估 seam（permissionBridge/permissionPolicy 同型；实现时接线确认）。
//
// 核心断言形态（Prove-It）：
//   写文件前：`rm *` 评估 = ask（弹确认）
//   写文件后（同会话，无重启）：`rm *` 评估 = allow（直放）——不重启即生效。
//   反向：allow → ask 同理。
//
// 注：worker 冷启动方差大（1.4s~60s+，既有先例），等待预算用轮询 + 长超时。

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PI_REL = path.join(".pi", "extensions", "pi-permission-system", "config.json");

async function loadAgentService() {
  const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentService.js 尚未实现");
  return mod.createAgentService;
}

async function waitUntil(predicate, { timeout = 30000, interval = 200, label = "条件" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  assert.fail(`超时等待 ${label}`);
}

describe("REQ-AGENT-069 保存即生效（真实 worker + gotgenes）", () => {
  let workdir;
  let projectDir;
  let agentService;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-eff-"));
    projectDir = path.join(workdir, "proj");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "README.md"), "fixture");
    // 会话配置：项目空间（session-config cwd = 项目目录，M2 装配）
    process.env.OPC_AGENT_FAUX = "1";
  });

  afterEach(async () => {
    delete process.env.OPC_AGENT_FAUX;
    delete process.env.OPC_FAUX_TOOL_SEQUENCE;
    await agentService?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function writeProjectPolicy(config) {
    const p = path.join(projectDir, PI_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(config, null, 2));
  }

  async function evaluateCommand(command) {
    // TODO: HUMAN ASSERTION — 评估 seam 接线：实现后确认调用形态
    //（permissionBridge.evaluateBashToolCall({spaceKey, command, cwd: projectDir})
    //  或 worker 会话内驱动；返回值 verdict: "allow"|"ask"）
    const { evaluateBashToolCall } = await import(
      "../../../../../../src/services/permissionBridge.js"
    ).catch(() => null);
    assert.ok(evaluateBashToolCall, "seam 未就绪：permissionBridge.evaluateBashToolCall");
    // 会话键：项目空间会话（实现后按 createAgentService 返回的 session 语义接线）
    const verdict = await evaluateBashToolCall({ spaceKey: "ui:project:perm-e2e:1", command, cwd: projectDir });
    return verdict;
  }

  it("REQ-AGENT-069 标准 1：ask → allow（同会话改文件后评估变化，不重启）", async () => {
    // Arrange：项目策略 rm * = ask（与全局一致），基线评估应为 ask
    await writeProjectPolicy({ permission: { bash: { "rm *": "ask" } } });
    const before = await evaluateCommand("rm file.txt");
    assert.equal(before, "ask", "基线：rm * 应评估为 ask");

    // Act：模拟 UI 保存（改文件 rm * → allow）
    await writeProjectPolicy({ permission: { bash: { "rm *": "allow" } } });

    // Assert：同会话内（无重启 worker）评估变化
    // TODO: HUMAN ASSERTION — 确认改文件后评估立即变 allow（或轮询内）
    const after = await evaluateCommand("rm file.txt");
    assert.equal(after, "allow", "保存后同会话内评估应变 allow");
  });

  it("REQ-AGENT-069 标准 2：allow → ask（反向）", async () => {
    await writeProjectPolicy({ permission: { bash: { "rm *": "allow" } } });
    const before = await evaluateCommand("rm file.txt");
    assert.equal(before, "allow", "基线：rm * 应评估为 allow");

    await writeProjectPolicy({ permission: { bash: { "rm *": "ask" } } });

    const after = await evaluateCommand("rm file.txt");
    assert.equal(after, "ask", "保存后同会话内评估应变 ask");
  });

  it("REQ-AGENT-069 标准 3：未覆盖字段回落全局（写文件只含覆盖项仍正确合并）", async () => {
    // 项目文件只写 rm *（最小覆盖集），sudo 未写 → 回落全局 ask
    await writeProjectPolicy({ permission: { bash: { "rm *": "allow" } } });
    const sudo = await evaluateCommand("sudo ls /");
    // TODO: HUMAN ASSERTION — 确认 sudo 未覆盖 → 全局 ask
    assert.equal(sudo, "ask", "未覆盖字段应回落全局（ask）");
  });
});
