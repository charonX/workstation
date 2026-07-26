// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-047
// REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

// setVariables 是普通 pass-through 节点，用真实 executor 跑端到端；
// 引擎 defaultExecutors 注册 setvariables 后本文件无需 mock。
// 骨架阶段通过 options.executors 注入最小 stub；实现后移除 stub 直接用真实 executor 即可。
// 签核说明：stub 行为按 D10/D11 契约模拟（遍历 assignments → 单 {{var}} 引用按点路径从 context 读原值、否则按字面量）；
// 真实 setVariablesExecutor 必须使用引擎统一 evaluateExpression，行为与本 stub 一致。

const setvariablesStub = async ({ node, context }) => {
  const outputVariables = {};
  for (const a of node.config.assignments || []) {
    const match = a.expression.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (match) {
      // 单引用：沿点路径取值，保留原类型
      const path = match[1].split(".");
      let v = context;
      for (const p of path) v = v == null ? undefined : v[p];
      outputVariables[a.variableName] = v;
    } else {
      outputVariables[a.variableName] = a.expression;
    }
  }
  return { status: "success", outputVariables };
};

const stubExecutors = { setvariables: setvariablesStub };

describe("REQ-FLOW-047 AC3: setVariables 基本赋值写入 context 和 record", () => {
  it("将 assignments 声明的变量写入 namespaced key 和裸 key", async () => {
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "sv", type: "setVariables", config: {
          assignments: [
            { variableName: "greeting", expression: "hello" }
          ]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, { executors: stubExecutors }, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "sv");
    assert.ok(rec, "setVariables 节点应在 nodeRecords 中");
    // 签核：D10 多输出机制写入 namespaced key `${nodeId}.${varName}`
    assert.equal(rec.outputVariables["sv.greeting"], "hello");
  });
});

describe("REQ-FLOW-047 AC4: 单 {{var}} 引用保留原值类型（不字符串化）", () => {
  it("object/number/array/boolean 原样传递", async () => {
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [
          { name: "num", defaultValue: 42 },
          { name: "obj", defaultValue: { k: "v" } },
          { name: "arr", defaultValue: [1, 2, 3] },
          { name: "flag", defaultValue: true }
        ]}},
        { id: "sv", type: "setVariables", config: {
          assignments: [
            { variableName: "n", expression: "{{trig.num}}" },
            { variableName: "o", expression: "{{trig.obj}}" },
            { variableName: "a", expression: "{{trig.arr}}" },
            { variableName: "f", expression: "{{trig.flag}}" }
          ]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, { executors: stubExecutors }, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "sv");
    // 签核：类型保留契约与 REQ-FLOW-035 AC3 入参映射一致
    assert.strictEqual(rec.outputVariables["sv.n"], 42);
    assert.deepEqual(rec.outputVariables["sv.o"], { k: "v" });
    assert.deepEqual(rec.outputVariables["sv.a"], [1, 2, 3]);
    assert.strictEqual(rec.outputVariables["sv.f"], true);
  });
});

describe("REQ-FLOW-047 AC5: 多入口归一化——不同入口变量名异构，下游统一引用", () => {
  // 子 flow 场景：入口 A = feishuMessage（输出 feishuMsg.text/messageId）
  //             入口 B = flowInput（声明 messageText/messageId 输入）
  // 每个入口后连 setVariables 把异构名映射到统一 text/messageId
  // 下游 agent 统一引用 {{text}} / {{messageId}}

  function buildChildFlow() {
    return {
      nodeList: [
        // 入口 A：飞书触发
        { id: "fm", type: "feishumessage", config: { outputVariables: [
          { name: "text", defaultValue: "feishu-default" },
          { name: "sender", defaultValue: "s" },
          { name: "messageId", defaultValue: "m-fm" }
        ]}},
        { id: "svA", type: "setVariables", config: {
          assignments: [
            { variableName: "text", expression: "{{fm.text}}" },
            { variableName: "messageId", expression: "{{fm.messageId}}" }
          ]
        }},
        // 入口 B：被父 flow 调用
        { id: "fin", type: "flowInput", config: { outputVariables: [
          { name: "messageText", defaultValue: "fin-default" },
          { name: "messageId", defaultValue: "m-fin" }
        ]}},
        { id: "svB", type: "setVariables", config: {
          assignments: [
            { variableName: "text", expression: "{{fin.messageText}}" },
            { variableName: "messageId", expression: "{{fin.messageId}}" }
          ]
        }},
        // 下游：统一引用裸 text/messageId
        { id: "agt", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "o", prompt: "{{text}}|{{messageId}}" } }
      ],
      edges: [
        { sourceNodeId: "fm", targetNodeId: "svA" },
        { sourceNodeId: "svA", targetNodeId: "agt" },
        { sourceNodeId: "fin", targetNodeId: "svB" },
        { sourceNodeId: "svB", targetNodeId: "agt" }
      ]
    };
  }

  it("从 feishuMessage 入口启动：下游 text/messageId 取到飞书消息值", async () => {
    const prompts = [];
    const result = await run(
      { flow: buildChildFlow() },
      {
        startNodeId: "fm",
        executors: { ...stubExecutors, agent: async ({ node }) => { prompts.push(node.config.prompt); return { status: "success", output: "ok" }; } }
      },
      // 飞书入口的 inputVars：模拟真实飞书触发
      { text: "from-feishu", messageId: "m-feishu-123" }
    );
    assert.equal(result.status, "success");
    assert.equal(prompts.length, 1);
    // 签核：feishu 入口经 svA 归一化后，裸 key text/messageId 为飞书触发值
    assert.equal(prompts[0], "from-feishu|m-feishu-123");
  });

  it("从 flowInput 入口启动：下游 text/messageId 取到父传入值", async () => {
    const prompts = [];
    const result = await run(
      { flow: buildChildFlow() },
      {
        startNodeId: "fin",
        executors: { ...stubExecutors, agent: async ({ node }) => { prompts.push(node.config.prompt); return { status: "success", output: "ok" }; } }
      },
      // 父 flow 通过 callFlow 传入的 inputVars（key 是 flowInput 声明的 messageText/messageId）
      { messageText: "from-parent", messageId: "m-parent-456" }
    );
    assert.equal(result.status, "success");
    assert.equal(prompts.length, 1);
    // 签核：flowInput 入口经 svB 归一化后，裸 key text/messageId 为父传入值
    assert.equal(prompts[0], "from-parent|m-parent-456");
  });
});

describe("REQ-FLOW-047 AC6: 常量注入与嵌套字段提取", () => {
  it("写入字符串常量", async () => {
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "sv", type: "setVariables", config: {
          assignments: [{ variableName: "apiVersion", expression: "v2" }]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, { executors: stubExecutors }, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "sv");
    // 签核：字符串字面量原样写入
    assert.equal(rec.outputVariables["sv.apiVersion"], "v2");
  });

  it("从嵌套对象提取字段", async () => {
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [
          { name: "response", defaultValue: { data: { url: "http://x.test/path", title: "T" } } }
        ]}},
        { id: "sv", type: "setVariables", config: {
          assignments: [{ variableName: "url", expression: "{{trig.response.data.url}}" }]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, { executors: stubExecutors }, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "sv");
    // 签核：点路径 {{a.b.c}} 由引擎 evaluateExpression 支持，setVariables 复用
    assert.equal(rec.outputVariables["sv.url"], "http://x.test/path");
  });
});

describe("REQ-FLOW-047 AC7: setVariables 是 pass-through，执行完正常按出边继续", () => {
  it("下游节点在 setVariables 之后被执行，且能读到 setVariables 写入的变量", async () => {
    const order = [];
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "sv", type: "setVariables", config: {
          assignments: [{ variableName: "x", expression: "computed" }]
        }},
        { id: "after", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "o", prompt: "{{x}}" } }
      ],
      edges: [
        { sourceNodeId: "trig", targetNodeId: "sv" },
        { sourceNodeId: "sv", targetNodeId: "after" }
      ]
    };
    await run({ flow }, {
      executors: {
        ...stubExecutors,
        trigger: async () => { order.push("trig"); return { status: "success", output: {} }; },
        agent: async ({ node, context }) => {
          order.push("after");
          // 下游能读到 setVariables 写入的裸 key x
          assert.equal(context.x, "computed");
          return { status: "success", output: "done" };
        }
      }
    }, {});
    assert.deepEqual(order, ["trig", "after"]);
  });
});
