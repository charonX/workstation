// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-033
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true
// BUG-TRACE: BUG-001

// REQ-AGENT-033 授权桥（S8，M2）——ask → 挂起确认 → approve/reject 全链（标准 3）、
// user_bash 同策略拦截（标准 4）、双会话并发 ask 策略隔离（标准 5，H4）。
//
// 前置 spike 依赖：H3（gotgenes config 两级加载）、H4（单 worker 多并发会话
// 策略隔离，globalThis 单槽服务不串扰）。H3/H4 未过 → 按 ADR-017 回退预案
// 自实现 tool_call 钩子，验收语义不变；spike 未过期间本文件整体应以
// 「seam 未就绪」失败信息注明，不得静默绿。
//
// seam 1：授权桥——建议落点 src/services/permissionBridge.js，导出
//   createPermissionBridge({ confirmationService }) → {
//     // gotgenes registerAuthorizer 回调形态（tech-design 授权桥契约节）：
//     authorize({ spaceKey, tool, input, description }) →
//       { confirmId, decision: Promise<{ kind: "allow" | "deny", reason?: string }> }
//     // user_bash 事件入口（! bash；不经 tool_call 路径，research §6 旁路点）：
//     evaluateUserBash({ spaceKey, command, cwd? }) →
//       { verdict: "allow" | "ask", confirmId?, decision? }
//   }
// 副作用 = 写 agent_confirmations 行（复用 confirmationService 既有挂起队列）；
// approve/reject 走既有端点/服务方法，桥内等待决议回传 gotgenes。
// seam 具体形态以 implementer 提供的等价 public seam 为准。
//
// seam 2（标准 5 隔离断言）：策略评估 seam（同 permissionPolicy.test.js，
// src/services/permissionPolicy.js createPolicyEvaluator）——按空间上下文
// （项目目录策略 vs 全局策略）并发评估互不串扰。
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { closeDb } from "../../../../../../src/db.js";

async function loadPermissionBridge() {
  const mod = await import("../../../../../../src/services/permissionBridge.js").catch(() => null);
  assert.ok(
    mod,
    "seam 未就绪：src/services/permissionBridge.js 尚未实现（REQ-AGENT-033 标准 3/4/5，tech-design 授权桥契约节）"
  );
  assert.equal(
    typeof mod.createPermissionBridge,
    "function",
    "permissionBridge 应导出 createPermissionBridge({ confirmationService })（REQ-AGENT-033）"
  );
  return mod.createPermissionBridge;
}

async function loadPolicyEvaluator() {
  const mod = await import("../../../../../../src/services/permissionPolicy.js").catch(() => null);
  assert.ok(
    mod && typeof mod.createPolicyEvaluator === "function",
    "seam 未就绪：src/services/permissionPolicy.js createPolicyEvaluator 尚未实现（REQ-AGENT-033 标准 5，H4 隔离断言依赖）"
  );
  return mod.createPolicyEvaluator;
}

async function loadConfirmationService() {
  const mod = await import("../../../../../../src/services/confirmationService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/confirmationService.js 尚未实现（REQ-AGENT-016 既有 seam）");
  return mod.createConfirmationService;
}

describe("REQ-AGENT-033 授权桥：ask → 挂起确认 → 决议回传（标准 3）", () => {
  let workdir;
  let dbPath;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "authorizer-bridge-"));
    dbPath = path.join(workdir, "confirm.db");
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    closeDb();
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("ask → 创建挂起确认行（含操作描述 + 来源 spaceKey）→ approve → allow（执行由 worker 侧 gate 放行承担）", async () => {
    // Arrange：既有挂起队列 + 授权桥；execute 注入记录实际操作。
    // BUG-001 语义调整：授权桥行（riskLevel="permission"）的操作执行由 worker
    // 侧 gate allow 后经工具调用路径承担（单一闸门，设计声明）——主进程 execute
    // 对该行不再调用（修复前无条件调用 → project create 建两个项目等双重执行）。
    // 「执行一次」的真实性由 worker 侧全链/冒烟覆盖；此处断言主进程不重复执行
    // + approve 决议仍返回 allow。
    const createConfirmationService = await loadConfirmationService();
    const createPermissionBridge = await loadPermissionBridge();
    const executed = [];
    const svc = createConfirmationService({
      dbPath,
      execute: async (command, args) => {
        executed.push({ command, args });
        return { output: "done" };
      },
    });
    const bridge = createPermissionBridge({ confirmationService: svc });
    // Act 1：gotgenes 评估 ask → 授权桥入队。
    const ask = await bridge.authorize({
      spaceKey: "ui:project:p_1:s1",
      tool: "bash",
      input: { command: "rm -rf node_modules" },
      description: "bash: rm -rf node_modules",
    });
    // Assert 1：挂起确认行创建，含操作描述 + 来源 spaceKey。
    const row = svc.get(ask.confirmId);
    assert.ok(row, "ask 应创建挂起确认行（agent_confirmations）");
    assert.equal(row.status, "pending", "确认行应挂起为 pending");
    assert.equal(row.sessionKey, "ui:project:p_1:s1", "确认行应记录来源 spaceKey（确认卡渲染目标）");
    assert.ok(
      JSON.stringify(row).includes("rm -rf node_modules"),
      `确认行应含操作描述（command 或 args 承载）。实际: ${JSON.stringify(row)}`
    );
    assert.equal(executed.length, 0, "挂起期间操作不得执行");
    // Act 2：人工 approve（既有端点语义，确认回调幂等由 REQ-AGENT-016 兜底）。
    await svc.approve(ask.confirmId);
    // Assert 2：桥回传 allow 且主进程不重复执行（授权桥行执行由 worker 侧承担）。
    const decision = await ask.decision;
    assert.equal(decision.kind, "allow", `approve 后授权桥应回传 allow。实际: ${JSON.stringify(decision)}`);
    assert.equal(executed.length, 0, "approve 授权桥行不得触发主进程 execute（BUG-001：worker 侧 gate 放行后工具路径单次执行）");
    assert.equal(svc.get(ask.confirmId).status, "approved", "approve 后行应结清 approved（决议回传前提）");
  });

  it("ask → reject → deny 且 agent 收到可转述的工具错误", async () => {
    // Arrange
    const createConfirmationService = await loadConfirmationService();
    const createPermissionBridge = await loadPermissionBridge();
    const executed = [];
    const svc = createConfirmationService({
      dbPath,
      execute: async (command, args) => {
        executed.push({ command, args });
        return {};
      },
    });
    const bridge = createPermissionBridge({ confirmationService: svc });
    // Act
    const ask = await bridge.authorize({
      spaceKey: "ui:copilot:s1",
      tool: "write",
      input: { path: "/tmp/x.txt" },
      description: "write: /tmp/x.txt",
    });
    await svc.reject(ask.confirmId);
    // Assert：deny + 拒绝原因（作为错误工具结果回喂 LLM，agent 可转述，PI 契约）。
    const decision = await ask.decision;
    assert.equal(decision.kind, "deny", `reject 后授权桥应回传 deny。实际: ${JSON.stringify(decision)}`);
    assert.ok(
      typeof decision.reason === "string" && decision.reason.length > 0,
      `deny 应携带可转述的拒绝原因（agent 收到的工具错误文本）。实际: ${JSON.stringify(decision)}`
    );
    assert.equal(executed.length, 0, "reject 后操作不得执行");
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });
});

describe("REQ-AGENT-033 user_bash 同策略拦截（标准 4）", () => {
  let workdir;
  let dbPath;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "user-bash-"));
    dbPath = path.join(workdir, "confirm.db");
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    closeDb();
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("用户 ! bash 破坏性命令 → 走同一策略评估：ask 并创建挂起确认行", async () => {
    // Arrange
    const createConfirmationService = await loadConfirmationService();
    const createPermissionBridge = await loadPermissionBridge();
    const svc = createConfirmationService({ dbPath });
    const bridge = createPermissionBridge({ confirmationService: svc });
    // Act：! bash 事件（不经 tool_call 路径——research §6 旁路点，单独断言）。
    const result = await bridge.evaluateUserBash({
      spaceKey: "ui:project:p_1:s1",
      command: "rm -rf build/",
    });
    // Assert：与工具调用同策略——破坏性模式 → ask → 挂起行。
    assert.equal(result.verdict, "ask", `! bash 破坏性命令应同策略评估为 ask。实际: ${JSON.stringify(result)}`);
    const row = svc.get(result.confirmId);
    assert.ok(row && row.status === "pending", "! bash ask 应创建挂起确认行（同一挂起队列）");
    assert.equal(row.sessionKey, "ui:project:p_1:s1", "挂起行应记录来源 spaceKey");
  });

  it("用户 ! bash 非破坏命令 → allow，不产生挂起行", async () => {
    // Arrange
    const createConfirmationService = await loadConfirmationService();
    const createPermissionBridge = await loadPermissionBridge();
    const svc = createConfirmationService({ dbPath });
    const bridge = createPermissionBridge({ confirmationService: svc });
    // Act
    const result = await bridge.evaluateUserBash({ spaceKey: "ui:project:p_1:s1", command: "git status" });
    // Assert
    assert.equal(result.verdict, "allow", `! bash 非破坏命令应直接放行。实际: ${JSON.stringify(result)}`);
    assert.deepEqual(svc.listPending(), [], "allow 的 ! bash 不得产生挂起确认行");
  });
});

describe("REQ-AGENT-033 双会话并发 ask 策略隔离（标准 5，H4）", () => {
  let workdir;
  let projectDirA;
  let generalDirB;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-isolation-"));
    projectDirA = path.join(workdir, "project-a");
    generalDirB = path.join(workdir, "general-b");
    fs.mkdirSync(projectDirA, { recursive: true });
    fs.mkdirSync(generalDirB, { recursive: true });
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("A 空间项目策略不影响 B 空间评估结果（并发 ask 隔离）", async () => {
    // Arrange：A = 项目空间（项目目录含约定策略文件：cat * 升级为 ask）；
    // B = 通用空间（仅全局策略：cat = 读类 allow）。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    const projectPolicyPath = path.join(projectDirA, ".pi", "extensions", "pi-permission-system", "config.json");
    fs.mkdirSync(path.dirname(projectPolicyPath), { recursive: true });
    fs.writeFileSync(projectPolicyPath, JSON.stringify({ bash: { "cat *": "ask" } }));
    const createPolicyEvaluator = await loadPolicyEvaluator();
    const evalA = createPolicyEvaluator({ cwd: projectDirA, projectDir: projectDirA });
    const evalB = createPolicyEvaluator({ cwd: generalDirB });
    // Act：双会话并发评估同一命令（H4：单进程多并发会话策略不串扰）。
    const [verdictA, verdictB] = await Promise.all([
      Promise.resolve(evalA.evaluate({ tool: "bash", input: { command: "cat README.md" } })),
      Promise.resolve(evalB.evaluate({ tool: "bash", input: { command: "cat README.md" } })),
    ]);
    // Assert：A 空间项目策略（cat * → ask）不影响 B 空间评估（读类 → allow）。
    assert.equal(verdictA, "ask", `A 空间应命中项目策略（cat * → ask）。实际: ${verdictA}`);
    assert.equal(verdictB, "allow", `B 空间评估不得受 A 空间项目策略影响（隔离）。实际: ${verdictB}`);
    // 注：本断言在策略评估 seam 层锁定 H4 隔离契约（globalThis 单槽服务不串扰）；
    // gotgenes 运行时并发形态由 H4 spike 脚本验证，spike 未过则按 ADR-017 回退
    // 自实现评估——本断言语义不变。
  });
});

describe("REQ-AGENT-033 挂起行共存（标准 3 补充，轻量共存断言）", () => {
  let workdir;
  let dbPath;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "coexist-"));
    dbPath = path.join(workdir, "confirm.db");
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    closeDb();
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("UI 空间授权桥挂起行与飞书确认挂起行同表共存、各自独立决议", async () => {
    // Arrange：同一挂起队列（agent_confirmations，tech-design F3：按 spaceKey 前缀分流渲染）。
    const createConfirmationService = await loadConfirmationService();
    const createPermissionBridge = await loadPermissionBridge();
    const svc = createConfirmationService({ dbPath, execute: async () => ({}) });
    const bridge = createPermissionBridge({ confirmationService: svc });
    // Act 1：飞书空间既有确认路径入队。
    const feishuId = crypto.randomUUID();
    svc.submit({ confirmId: feishuId, sessionKey: "feishu:oc_1", command: "source delete", args: { id: "src_1" }, riskLevel: "confirm" });
    // Act 2：UI 空间授权桥 ask 入队。
    const uiAsk = await bridge.authorize({
      spaceKey: "ui:project:p_1:s1",
      tool: "write",
      input: { path: "a.txt" },
      description: "write: a.txt",
    });
    // Assert 1：同表共存——两条 pending 各自携带来源 spaceKey。
    const pending = svc.listPending();
    const pendingIds = pending.map((r) => r.confirmId).sort();
    assert.deepEqual(pendingIds, [feishuId, uiAsk.confirmId].sort(), `飞书确认与 UI 授权桥挂起行应同表共存。实际: ${JSON.stringify(pending)}`);
    // Act 2：飞书确认先决议。
    await svc.approve(feishuId);
    // Assert 2：UI 挂起行不受影响的仍 pending，可独立决议。
    assert.equal(svc.get(uiAsk.confirmId).status, "pending", "飞书确认决议不得影响 UI 空间挂起行");
    await svc.reject(uiAsk.confirmId);
    const decision = await uiAsk.decision;
    assert.equal(decision.kind, "deny", "UI 空间挂起行应可独立 reject → deny");
    assert.equal(svc.get(feishuId).status, "approved", "飞书确认行状态不受 UI 决议影响");
  });
});

// —— BUG-001 回归（code-defect，2026-08-07）——
// 症状：project 空间（gotgenes 装配成功）CLI 高危工具（flow delete / project
// create / schedule toggle 等 18 个 confirm 级，TOOL_DEFS riskLevel="confirm"）
// 经 gotgenes ask → 用户确认后操作执行两次：① 主进程 approve → claimPending →
// executeToolCommand 真实执行（结果被 notifyOnSettle=false 吞掉不回投）；② worker
// 侧 permission-decision(allow) → gate 放行 → PI 执行 → 再次真实执行。后果：project
// create 建两个项目、delete 删两次、schedule toggle 开关两次回原态；超时后晚批准
// 仍执行（绕过 gate 上下文）。
// 根因：confirmationService.approve 对任意行无条件调用注入 execute（server.js 接线
// = executeToolCommand，无 riskLevel 守卫）；授权桥行（riskLevel="permission"、
// notifyOnSettle=false）的 command = CLI 工具名，在 TOOL_DEFS 注册表内（非 no-op）。
// 修复语义：approve 对 permission 行跳过主进程 execute——执行由 worker 侧 gate
// 放行后的工具路径承担（单一闸门，设计声明）；行仍结清（approved）→ 决议 allow；
// gate 超时后的晚批准同样不得执行（决议上下文已失效）。
describe("BUG-001 回归：授权桥 permission 行 approve 不得主进程重复执行（REQ-AGENT-033 标准 3）", () => {
  let workdir;
  let dbPath;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bug001-"));
    dbPath = path.join(workdir, "confirm.db");
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    closeDb();
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("approve 授权桥行（CLI 高危工具名）→ 主进程 execute 不被调用", async () => {
    // Arrange：真实 confirmationService + spy execute（"flow delete" 在 TOOL_DEFS
    // 注册表内——修复前 approve 会真执行 → 本用例红）。
    const createConfirmationService = await loadConfirmationService();
    const createPermissionBridge = await loadPermissionBridge();
    const executed = [];
    const svc = createConfirmationService({
      dbPath,
      execute: async (command, args) => {
        executed.push({ command, args });
        return { output: "已删除" };
      },
    });
    const bridge = createPermissionBridge({ confirmationService: svc });
    const ask = await bridge.authorize({
      spaceKey: "ui:project:p_1:s1",
      tool: "flow delete",
      input: { id: "flow_1" },
      description: "flow delete: flow_1",
    });
    // Act：人工 approve（授权桥行，既有端点语义）。
    await svc.approve(ask.confirmId);
    // Assert：决议 allow（worker gate 放行）+ 主进程不执行（执行由 worker 侧
    // gate 放行后的工具路径承担，单一闸门——双重执行即本 bug）。
    const decision = await ask.decision;
    assert.equal(decision.kind, "allow", `approve 后授权桥应回传 allow。实际: ${JSON.stringify(decision)}`);
    assert.equal(executed.length, 0, "approve 授权桥行不得触发主进程 execute（BUG-001：主进程执行 + worker 侧执行 = 双重执行）");
    assert.equal(svc.get(ask.confirmId).status, "approved", "行应结清 approved（决议回传前提）");
  });

  it("gate 超时后晚批准授权桥行 → 不执行（绕过 gate 上下文）", async () => {
    // Arrange：授权桥挂起行 + spy execute（"project create" 在 TOOL_DEFS 注册表内）。
    // 模拟 gate 超时：worker 侧 PERMISSION_DECISION_TIMEOUT_MS（10 分钟）无裁决 →
    // permissionDecisions 解析器已清除、工具调用已以 deny（超时）结束——决议等待
    // 无人消费；行仍 pending（挂起队列 = SQLite 真相，「稍后处理」语义保留）。
    const createConfirmationService = await loadConfirmationService();
    const createPermissionBridge = await loadPermissionBridge();
    const executed = [];
    const svc = createConfirmationService({
      dbPath,
      execute: async (command, args) => {
        executed.push({ command, args });
        return { output: "已创建" };
      },
    });
    const bridge = createPermissionBridge({ confirmationService: svc });
    const ask = await bridge.authorize({
      spaceKey: "ui:project:p_1:s1",
      tool: "project create",
      input: { name: "p2" },
      description: "project create: p2",
    });
    // gate 超时：ask 的决议等待已失效（worker 侧按 deny 结束，无消费方）。
    // Act：超时后人工晚批准（挂起行稍后处理语义仍受理）。
    await svc.approve(ask.confirmId);
    // Assert：晚批准只结清行（approved）——主进程不得执行（决议上下文已失效，
    // 晚执行 = 绕过 gate 上下文）。
    assert.equal(executed.length, 0, "超时后晚批准不得触发主进程执行（BUG-001：gate 上下文已失效，执行即绕过闸门）");
    assert.equal(svc.get(ask.confirmId).status, "approved", "晚批准应结清行（已处理，稍后处理语义）");
  });
});
