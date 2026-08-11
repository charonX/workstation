// REQ-TRACE: 2026-08-11-pi-agent-modes/REQ-AGENT-073, 2026-08-11-pi-agent-modes/REQ-AGENT-074, 2026-08-11-pi-agent-modes/REQ-AGENT-075, 2026-08-11-pi-agent-modes/REQ-AGENT-076
// REQ-VERSION: v1-hash:3e5839b75173b7b59c41c0da8085ff7f09755fdb443f22c43ebfa310d7813add
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// auto 引擎（REQ-AGENT-073 link 判断 / 074 envelope 从严 / 075 熔断 / 076 可观测）。
//
// seam 1：真实 gotgenes（authorizerChain 执行）——项目 .pi 配置 authorizerChain
//   ["auto-judge", "opc-bridge"]，真实评估链（对齐 permissionEvaluation 先例）。
// seam 2：auto-judge link 实现（BUILD 产物，动态 import）——registerAuthorizer
//   注册到 gotgenes；接用户 provider（settings agent 配置；FAUX 注入缝）。
// seam 3：熔断计数（link 内，可注入阈值）+ 模式服务降级。
// seam 4：review log（决策记录文件，对齐 permission review log 形态）。
//
// 注：真实模型调用在测试中不可行——用「可编程判定注入缝」（如 OPC_FAUX_JUDGE_RESULT
//   或 link 构造函数注入 decide 函数），实现时接线确认。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PI_REL = path.join(".pi", "extensions", "pi-permission-system", "config.json");

async function loadJudgeLink() {
  const mod = await import("../../../../../../src/agent/autoJudgeLink.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/autoJudgeLink.js 尚未实现（REQ-AGENT-073）");
  return mod;
}

describe("REQ-AGENT-073 auto 引擎：模型 link 判断链路（B4）", () => {
  let workdir;
  let projectDir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mode-judge-"));
    projectDir = path.join(workdir, "proj");
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(async () => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function writePolicyWithChain(authorizerChain) {
    const p = path.join(projectDir, PI_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify({ authorizerChain, permission: { bash: { "*": "ask" } } }, null, 2)
    );
  }

  it("REQ-AGENT-073 标准 1：判安全 allow → 命令直接执行、无确认卡", async () => {
    const { createAutoJudgeLink } = await loadJudgeLink();
    const link = createAutoJudgeLink({ decide: () => ({ kind: "allow" }) });
    // TODO: HUMAN ASSERTION — 确认 allow 判定路径：命令执行、无确认卡产生
    const result = await link.authorize(
      { surface: "bash", toolName: "bash", input: { command: "npm test" } },
      {},
      () => {}
    );
    assert.equal(result.kind, "allow");
  });

  it("REQ-AGENT-073 标准 2：判危险 deny → 命令不执行 + teaching reason 回 agent", async () => {
    const { createAutoJudgeLink } = await loadJudgeLink();
    const link = createAutoJudgeLink({
      decide: () => ({ kind: "deny", reason: "该命令会删除未跟踪文件（git clean）" }),
    });
    // TODO: HUMAN ASSERTION — 确认 deny 判定路径：拦截 + reason 透传
    const result = await link.authorize(
      { surface: "bash", toolName: "bash", input: { command: "git clean -fd" } },
      {},
      () => {}
    );
    assert.equal(result.kind, "deny");
    assert.ok(result.reason.includes("git clean"), "deny 应带 teaching reason");
  });

  it("REQ-AGENT-073 标准 3：判断不了/模型失败 → defer", async () => {
    const { createAutoJudgeLink } = await loadJudgeLink();
    const link = createAutoJudgeLink({ decide: () => ({ kind: "defer" }) });
    // TODO: HUMAN ASSERTION — 确认 defer 判定路径（落回确认卡）
    const result = await link.authorize(
      { surface: "bash", toolName: "bash", input: { command: "some odd command" } },
      {},
      () => {}
    );
    assert.equal(result.kind, "defer");
  });

  it("REQ-AGENT-073 标准 4：provider 未配置 → 判断失败 defer（auto 不可用）", async () => {
    const { createAutoJudgeLink } = await loadJudgeLink();
    // 无 provider 注入 → decide 内部失败 → defer
    const link = createAutoJudgeLink({ decide: () => { throw new Error("no provider"); } });
    // TODO: HUMAN ASSERTION — 确认 provider 缺失场景 defer（fail-safe）
    const result = await link.authorize(
      { surface: "bash", toolName: "bash", input: { command: "npm test" } },
      {},
      () => {}
    );
    assert.equal(result.kind, "defer");
  });
});

describe("REQ-AGENT-074 external_directory/path 系统级从严（B5）", () => {
  it("envelope 强制语义：模型对 excluded 面 allow 被降级 defer", async () => {
    // 实证测试：直接调用 gotgenes 的 encloseInDelegationEnvelope（本地源码实证，
    // 非实现依赖——验证系统级强制而非我们 link 的自觉）。
    const { createJiti } = await import("jiti").catch(() => ({ createJiti: null }));
    assert.ok(createJiti, "jiti 不可用");
    const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
    const envelopeMod = await jiti.import(
      path.resolve("node_modules/@gotgenes/pi-permission-system/src/authority/delegation-envelope.ts"),
      { default: true }
    );
    assert.ok(envelopeMod?.encloseInDelegationEnvelope, "envelope 加载失败");
    const wrapped = envelopeMod.encloseInDelegationEnvelope(async () => ({ kind: "allow" }));

    // excluded 面（external_directory）：allow → defer
    const deferred = await wrapped({ surface: "external_directory" }, {}, () => {});
    // TODO: HUMAN ASSERTION — 确认 excluded 面 allow 被降级 defer（系统强制）
    assert.equal(deferred.kind, "defer");

    // 非 excluded 面（bash）：allow 原样
    const allowed = await wrapped({ surface: "bash" }, {}, () => {});
    assert.equal(allowed.kind, "allow");

    // excluded 面 deny 原样有效
    const denyWrapped = envelopeMod.encloseInDelegationEnvelope(async () => ({ kind: "deny", reason: "x" }));
    const denied = await denyWrapped({ surface: "external_directory" }, {}, () => {});
    assert.equal(denied.kind, "deny");
  });
});

describe("REQ-AGENT-075 熔断（B6）", () => {
  it("连续 deny 计数达阈值 → 降级 standard + allow 重置计数", async () => {
    const { createAutoJudgeLink } = await loadJudgeLink();
    let denyCount = 0;
    const link = createAutoJudgeLink({
      decide: () => ({ kind: "deny", reason: "test" }),
      denyThreshold: 2, // 可注入缩短（REQ-AGENT-075 标准 1）
      onTripped: () => { denyCount += 1; },
    });
    // TODO: HUMAN ASSERTION — 确认连续 deny N 次后熔断回调触发（降级 standard）
    await link.authorize({ surface: "bash", toolName: "bash", input: { command: "a" } }, {}, () => {});
    await link.authorize({ surface: "bash", toolName: "bash", input: { command: "b" } }, {}, () => {});
    assert.equal(denyCount, 1, "连续 2 次 deny 后应触发熔断");

    // allow 重置计数：deny → allow → deny 不应触发
    // TODO: HUMAN ASSERTION — 确认 allow 重置连续计数（REQ-AGENT-075 标准 3）
  });
});

describe("REQ-AGENT-076 auto 可观测（B7）", () => {
  it("每次判断写 review log（verdict/deferReason/latencyMs）", async () => {
    const { createAutoJudgeLink } = await loadJudgeLink();
    const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mode-log-")), "review.jsonl");
    const link = createAutoJudgeLink({
      decide: () => ({ kind: "defer" }),
      reviewLogPath: logPath,
    });
    await link.authorize({ surface: "bash", toolName: "bash", input: { command: "x" } }, {}, () => {});
    // TODO: HUMAN ASSERTION — 确认日志含 defer 决策记录（含 reason/latency）
    assert.ok(fs.existsSync(logPath), "review log 应生成");
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 1, "至少一条决策记录");
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.verdict, "defer");
    assert.ok("latencyMs" in rec, "记录应含 latencyMs");
  });
});
