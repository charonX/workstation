// REQ-TRACE: REQ-FLOW-058
// REQ-VERSION: v1-hash:f255c1918d40e06767b8129157cdcde68091d02015b0b577fa7c03b449fa5d8f
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// EXPECTED-TRACE: prd.md §6.3 锚点（缺少 provider 的 agent 节点返回 error）+ §8 错误状态（E-AGENT-NO-PROVIDER）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { agentExecutor } from "../../../../../../src/flowEngine/executors/agentExecutor.js";
import { setQueryFn, resetQueryFn } from "../../../../../../src/flowEngine/claudeAgentAdapter.js";

describe("REQ-FLOW-058 废除 agentAdapter 与缺 Provider 显式报错", () => {
  it("AC1: src/flowEngine/agentAdapter.js 必须被彻底删除", () => {
    // EXPECTED-TRACE: prd.md §10.1 设计目标 1
    const adapterPath = path.resolve(process.cwd(), "src/flowEngine/agentAdapter.js");
    assert.equal(fs.existsSync(adapterPath), false, "agentAdapter.js 必须被删除，不得遗留静默 mock");
  });

  it("AC2: 未配置 provider 时 agentExecutor 显式返回 error 且含 E-AGENT-NO-PROVIDER", async () => {
    // EXPECTED-TRACE: prd.md §6.3 row 1
    const cases = [
      { config: {} },
      { config: { provider: "" } },
      { config: { provider: null } },
      { config: { provider: undefined } }
    ];

    for (const node of cases) {
      const result = await agentExecutor({ node, context: {}, projectPath: "/tmp" });
      assert.equal(result.status, "error", "缺 provider 必须返回 error 状态");
      assert.ok(result.error && result.error.includes("E-AGENT-NO-PROVIDER"), `错误信息必须包含 E-AGENT-NO-PROVIDER，实际：${result.error}`);
      assert.ok(Array.isArray(result.logs) && result.logs.length > 0, "logs 必须记录错误日志");
    }
  });

  it("AC3: 未知 provider 时 agentExecutor 返回 Unknown agent provider 错误", async () => {
    // EXPECTED-TRACE: prd.md §6.2 / §8 未知 Agent Provider
    const node = { config: { provider: "unknown-llm" } };
    const result = await agentExecutor({ node, context: {}, projectPath: "/tmp" });
    assert.equal(result.status, "error", "未知 provider 必须返回 error");
    assert.ok(result.error.includes("Unknown agent provider: unknown-llm"), "错误信息必须指出未知 provider");
  });

  it("AC4: provider 为 anthropic 时正常调用 claudeAgentAdapter", async () => {
    // EXPECTED-TRACE: prd.md §6.1 row 1
    setQueryFn(async () => {
      async function* generate() {
        yield { type: "text", text: "real anthropic response" };
      }
      return generate();
    });

    try {
      const node = {
        config: {
          provider: "anthropic",
          prompt: "hello",
          model: "claude-3-5-sonnet"
        }
      };
      const result = await agentExecutor({ node, context: {}, projectPath: "/tmp" });
      assert.equal(result.status, "success", "有效 anthropic provider 必须返回 success");
      assert.equal(result.output, "real anthropic response", "output 必须包含生成内容");
      assert.equal(result.agent.provider, "anthropic", "agent 详情必须记录 provider");
    } finally {
      resetQueryFn();
    }
  });
});
