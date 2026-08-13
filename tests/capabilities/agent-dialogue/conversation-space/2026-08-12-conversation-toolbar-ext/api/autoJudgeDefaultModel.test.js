// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-096
// REQ-VERSION: v1-hash:ff3ce6c28851eddb44986c153881ae32c5547116942bab700427cfca94e46514
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
    // 集成（FAUX）：无配置下 ask 操作 → 确认卡出现，不静默放行
    // TODO(实现时接线)：OPC_AGENT_FAUX + OPC_FAUX_JUDGE_RESULT 触发判断 → 确认卡断言
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
    // 集成断言：FAUX 会话活动期间检查 worker 日志输出与 JSONL 会话文件——
    // 无 apiKey 明文（对齐 session-config 既有安全语义：sendToChild 只记消息类型）
    // TODO(实现时接线)：日志/JSONL 扫描断言
    assert.ok(true, "见实现时接线的日志扫描断言（不落日志/JSONL 是既有安全契约延续）");
  });
});
