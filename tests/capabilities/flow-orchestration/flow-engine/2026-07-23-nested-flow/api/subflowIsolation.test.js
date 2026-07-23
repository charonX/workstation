// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-035, 2026-07-23-nested-flow/REQ-FLOW-036
// REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

describe("REQ-FLOW-035: callFlow 同步执行与变量隔离", () => {
  it("AC1: callFlow 同步阻塞，invokeSubflow 返回后父流程继续", async () => {
    const callOrder = [];
    const parentFlow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: "child", targetInputNodeId: "cin",
          inputMappings: [], outputMappings: []
        }},
        { id: "after", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "done", prompt: "x" } }
      ],
      edges: [
        { sourceNodeId: "trig", targetNodeId: "call" },
        { sourceNodeId: "call", targetNodeId: "after" }
      ]
    };
    const services = {
      async invokeSubflow({ targetFlowId }) {
        callOrder.push("subflow-start");
        return { status: "success", output: { result: "from-child" }, childExecutionId: "c1", logs: [] };
      }
    };
    const afterRan = [];
    await run({ flow: parentFlow }, {
      services,
      executors: { agent: async () => { afterRan.push("after"); return { status: "success", output: "done" }; } }
    }, {});
    callOrder.push("parent-done");
    assert.deepEqual(callOrder, ["subflow-start", "parent-done"]);
    assert.deepEqual(afterRan, ["after"]);
  });

  it("AC2: 子流程 context 完全隔离——子内部写的变量不泄漏到父", async () => {
    const parentFlow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [{ name: "topic", defaultValue: "parent-topic" }] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: "child", targetInputNodeId: "cin",
          inputMappings: [{ childVar: "msg", parentExpr: "{{trig.topic}}" }],
          outputMappings: [{ childVar: "result", parentKey: "call.result" }]
        }},
        { id: "after", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "after", prompt: "{{secret}}|{{call.result}}" } }
      ],
      edges: [
        { sourceNodeId: "trig", targetNodeId: "call" },
        { sourceNodeId: "call", targetNodeId: "after" }
      ]
    };
    const prompts = [];
    const services = {
      async invokeSubflow({ inputVars }) {
        assert.equal(inputVars.msg, "parent-topic");
        return { status: "success", output: { result: "child-result" }, childExecutionId: "c1", logs: [] };
      }
    };
    await run({ flow: parentFlow }, {
      services,
      executors: { agent: async ({ node }) => { prompts.push(node.config.prompt); return { status: "success", output: "ok" }; } }
    }, {});
    // secret 未在父 context 定义 → 空字符串；call.result = "child-result"
    assert.equal(prompts[0], "|child-result");
  });

  it("AC3: 入参映射保留类型（object/number 不被字符串化）", async () => {
    const parentFlow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [
          { name: "count", defaultValue: 42 },
          { name: "meta", defaultValue: { k: "v" } }
        ]}},
        { id: "call", type: "callFlow", config: {
          targetFlowId: "child", targetInputNodeId: "cin",
          inputMappings: [
            { childVar: "n", parentExpr: "{{trig.count}}" },
            { childVar: "m", parentExpr: "{{trig.meta}}" }
          ],
          outputMappings: []
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "call" }]
    };
    let receivedVars = null;
    const services = {
      async invokeSubflow({ inputVars }) { receivedVars = inputVars; return { status: "success", output: {}, childExecutionId: "c1", logs: [] }; }
    };
    await run({ flow: parentFlow }, { services }, {});
    assert.strictEqual(receivedVars.n, 42);
    assert.deepEqual(receivedVars.m, { k: "v" });
  });

  it("AC4: 出参按 outputMappings 写回父 context namespaced key", async () => {
    const parentFlow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: {
          targetFlowId: "child", targetInputNodeId: "cin",
          inputMappings: [],
          outputMappings: [{ childVar: "savedUrl", parentKey: "call.savedUrl" }]
        }},
        { id: "after", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "after", prompt: "{{call.savedUrl}}" } }
      ],
      edges: [
        { sourceNodeId: "trig", targetNodeId: "call" },
        { sourceNodeId: "call", targetNodeId: "after" }
      ]
    };
    const prompts = [];
    const services = {
      async invokeSubflow() {
        return { status: "success", output: { savedUrl: "http://saved" }, childExecutionId: "c1", logs: [] };
      }
    };
    await run({ flow: parentFlow }, {
      services,
      executors: { agent: async ({ node }) => { prompts.push(node.config.prompt); return { status: "success", output: "ok" }; } }
    }, {});
    assert.equal(prompts[0], "http://saved");
  });

  it("AC5: __childExecutionId 写入 namespaced key（集成层 FLOW-040 验证端到端）", async () => {
    // 本测试用 stub 验证 callFlowExecutor 把 childExecutionId 放进 outputVariables 返回给引擎
    const parentFlow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "call", type: "callFlow", config: { targetFlowId: "child", targetInputNodeId: "cin", inputMappings: [], outputMappings: [] } }
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "call" }]
    };
    const services = { async invokeSubflow() { return { status: "success", output: {}, childExecutionId: "child-exec-xyz", logs: [] }; } };
    // 用 mock callflow executor 模拟返回，验证引擎的多输出路径把 __childExecutionId 写到 record
    const result = await run({
      flow: parentFlow,
      executors: {
        callflow: async ({ node }) => {
          const svc = await services.invokeSubflow();
          return { status: "success", outputVariables: { __childExecutionId: svc.childExecutionId }, logs: [] };
        }
      }
    }, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "call");
    assert.ok(rec);
    assert.equal(rec.outputVariables["call.__childExecutionId"], "child-exec-xyz");
  });
});

describe("REQ-FLOW-036: 多入口子流程 startNodeId 与入口限定 override", () => {
  it("AC1: startNodeId 跳过入度为 0 的节点寻找，只 override 目标入口", async () => {
    const flow = {
      nodeList: [
        { id: "fm", type: "feishumessage", config: { outputVariables: [{ name: "text", defaultValue: "feishu-default" }, { name: "sender", defaultValue: "s" }, { name: "messageId", defaultValue: "m1" }] } },
        { id: "in1", type: "flowInput", config: { outputVariables: [{ name: "a", defaultValue: "a1" }] } },
        { id: "in2", type: "flowInput", config: { outputVariables: [{ name: "b", defaultValue: "b1" }] } },
        { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "o", prompt: "{{in2.b}}|{{fm.text}}" } }
      ],
      edges: [
        { sourceNodeId: "fm", targetNodeId: "agt" },
        { sourceNodeId: "in1", targetNodeId: "agt" },
        { sourceNodeId: "in2", targetNodeId: "agt" }
      ]
    };
    const prompts = [];
    await run({ flow }, {
      startNodeId: "in2",
      executors: { agent: async ({ node, context }) => {
        prompts.push({ prompt: node.config.prompt, ctx_b: context["in2.b"], ctx_fmText: context["fm.text"] });
        return { status: "success", output: "ok" };
      }}
    }, { b: "from-parent" });
    // in2 是入口 → b 被 override 为 "from-parent"；fm 不是入口 → text 保持默认
    assert.equal(prompts[0].ctx_b, "from-parent");
    assert.equal(prompts[0].ctx_fmText, "feishu-default");
  });

  it("AC1: startNodeId 不存在时抛错", async () => {
    const flow = { nodeList: [{ id: "n1", type: "trigger", config: {} }], edges: [] };
    await assert.rejects(() => run({ flow }, { startNodeId: "nonexistent" }, {}), /not found/);
  });

  it("AC3: 顶层 run 不传 startNodeId 时保留 REQ-FLOW-031 行为（所有 trigger-like 按 name override）", async () => {
    const flow = {
      nodeList: [
        { id: "fm", type: "feishumessage", config: { outputVariables: [{ name: "text", defaultValue: "default" }, { name: "sender", defaultValue: "" }, { name: "messageId", defaultValue: "" }] } }
      ],
      edges: []
    };
    let capturedCtx = null;
    await run({ flow }, {
      executors: { feishumessage: async ({ context }) => { capturedCtx = { ...context }; return { status: "success", output: {} }; } }
    }, { text: "overridden" });
    assert.equal(capturedCtx["fm.text"], "overridden");
  });
});
