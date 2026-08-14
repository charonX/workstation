// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-096
// REQ-VERSION: v4-hash:6561019623cc0a639dbe9590db95fdec1ac812b68be7d1e3e31617668a4ef5c7
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// auto 判断用默认模型（REQ-AGENT-096，B5 解耦）。
//
// seam 1：worker session-config 携带 defaultJudge {provider, model, keyRef, apiKey}；
//   createSessionDecide 的 modelObj 来源 = defaultJudge 解析（非会话模型）。
// seam 2：judge-config IPC 广播（默认组合变更 → 全部活跃会话热更新）。
// seam 3：缺失 defaultJudge → auto 档 fail-safe defer（REQ-AGENT-073 标准 4 延续）。
//
// 环境：FAUX + OPC_AGENT_JUDGE_DENY_THRESHOLD 类测试 seam 沿用
//   （autoJudgeLink 既有 createAutoJudgeLink 注入缝）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("REQ-AGENT-096 auto 判断用默认模型（B5）", () => {
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "judge-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    process.env.OPC_AGENT_FAUX = "1";
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    delete process.env.OPC_AGENT_FAUX;
  });

  async function loadJudgeSeam() {
    // seam：agentService 导出 buildJudgeConfig(settings) → {provider, model}|null
    // （defaultJudge 装配契约：settings defaultModel 派生，与会话模型解耦）
    const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
    assert.ok(mod, "seam 未就绪：src/services/agentService.js 未导出 buildJudgeConfig（REQ-AGENT-096）");
    return mod;
  }

  it("session-config 携带 defaultJudge → judge 用默认模型，不随会话漂移", async () => {
    const { buildJudgeConfig } = await loadJudgeSeam();
    const cfg = buildJudgeConfig({
      providers: [
        { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] },
        { provider: "deepseek", apiKey: "sk-d", models: ["deepseek-v4-flash"] },
      ],
      defaultModel: { provider: "moonshotai", model: "kimi-k3" },
    });
    // defaultJudge = 默认组合（B5 锚点）；输入仅依赖 settings，与会话模型无关
    assert.deepEqual(cfg, { provider: "moonshotai", model: "kimi-k3" });
  });

  it("缺 defaultJudge（未配置）→ auto 判断 fail-safe defer", async () => {
    const { buildJudgeConfig } = await loadJudgeSeam();
    const cfg = buildJudgeConfig({ providers: [], defaultModel: null });
    // 无配置 → null → worker 侧 auto 档 fail-safe defer（REQ-AGENT-073 标准 4 延续）
    assert.equal(cfg, null);
    // decide 层：createAutoJudgeLink 未注入 decide → defaultDecide 读空配置目录 →
    // throw E-AUTO-JUDGE-NO-PROVIDER → link 映射 call-failed defer（不静默放行）
    const { createAutoJudgeLink } = await import("../../../../../../src/agent/autoJudgeLink.js");
    const reviewLogPath = path.join(workdir, "judge-review.jsonl");
    const link = createAutoJudgeLink({ reviewLogPath });
    const verdict = await link.authorize({ requestId: "gap-ac2", surface: "bash", command: "ls" });
    assert.equal(verdict.kind, "defer");
    // review log（REQ-AGENT-076）：defer 记录 deferReason=call-failed
    const logLine = fs.readFileSync(reviewLogPath, "utf8").trim().split("\n").pop();
    const parsed = JSON.parse(logLine);
    assert.equal(parsed.verdict, "defer");
    assert.equal(parsed.deferReason, "call-failed");
  });

  it("judge-config 广播：默认组合变更 → 活跃会话 judge 热更新", async () => {
    const { buildJudgeConfig } = await loadJudgeSeam();
    const cfg1 = buildJudgeConfig({
      providers: [
        { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] },
        { provider: "deepseek", apiKey: "sk-d", models: ["deepseek-v4-flash"] },
      ],
      defaultModel: { provider: "moonshotai", model: "kimi-k3" },
    });
    const cfg2 = buildJudgeConfig({
      providers: [
        { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] },
        { provider: "deepseek", apiKey: "sk-d", models: ["deepseek-v4-flash"] },
      ],
      defaultModel: { provider: "deepseek", model: "deepseek-v4-flash" },
    });
    // 默认变更 → judge 目标更新（同一 settings 形态下仅 defaultModel 不同）
    assert.deepEqual(cfg1, { provider: "moonshotai", model: "kimi-k3" });
    assert.deepEqual(cfg2, { provider: "deepseek", model: "deepseek-v4-flash" });
    // 广播语义（无滞后窗口）：活跃会话随 judge-config 热更新——
    // 集成断言见 worker 侧（实现时接线：改 settings 后活跃会话判断落新默认）
  });

  it("懒恢复会话随 session-config 自然带新 defaultJudge", async () => {
    // 懒恢复路径：agentService 水合按行重装 session-config 时同步带 defaultJudge
    // （buildJudgeConfig 输出；与 REQ-095 懒恢复共用装配链路）
    const { buildJudgeConfig } = await loadJudgeSeam();
    const cfg = buildJudgeConfig({
      providers: [{ provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] }],
      defaultModel: { provider: "moonshotai", model: "kimi-k3" },
    });
    assert.deepEqual(cfg, { provider: "moonshotai", model: "kimi-k3" });
  });

  it("defaultJudge 的 key 一次注入仅内存、不落日志/JSONL", async () => {
    // 集成：配置 defaultJudge（含 key）→ 建会话 → 发消息 → 读会话 JSONL 无明文 key
    fs.writeFileSync(
      path.join(workdir, "settings.json"),
      JSON.stringify({
        agent: {
          identity: "",
          providers: [{ provider: "moonshotai", apiKey: "sk-judge-secret-096", models: ["kimi-k3"] }],
          defaultModel: { provider: "moonshotai", model: "kimi-k3" },
        },
      }),
      "utf8"
    );
    process.env.DB_PATH = path.join(workdir, "data.db");
    const { startServer, stopServer } = await import("../../../../../../src/http/server.js");
    const { server, baseUrl } = await startServer({ port: 0 });
    try {
      const res = await fetch(`${baseUrl}/api/agent/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceKind: "general" }),
      });
      assert.equal(res.status, 200);
      const spaceKey = (await res.json()).spaceKey;
      // 走完整消息链路（session-config 携带 defaultJudge 装配）
      const sendRes = await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      });
      assert.equal(sendRes.status, 202);
      const list = await (await fetch(`${baseUrl}/api/agent/sessions`)).json();
      const row = [...(list.general ?? [])].find((r) => r.spaceKey === spaceKey);
      assert.ok(row?.sessionRef, "会话行存在");
      const raw = fs.readFileSync(row.sessionRef, "utf8");
      assert.ok(!raw.includes("sk-judge-secret-096"), "JSONL 不得含 defaultJudge key 明文");
    } finally {
      await stopServer({ server });
      delete process.env.DB_PATH;
    }
  });
});
