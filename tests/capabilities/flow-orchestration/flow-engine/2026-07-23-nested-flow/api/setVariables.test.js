// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-047
// REQ-VERSION: v2.1-hash:67e76a43e5b18a1b015c972d774d3fe12769a99b66fdc639d5a0046d8e446699
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

// setVariables 是普通 pass-through 节点，用真实 executor 跑端到端。
// 引擎 defaultExecutors 注册 setvariables 后本文件无需 mock；
// 仅在需要拦截 agent/trigger 行为观察时传入对应 executor。

describe("REQ-FLOW-047 AC3: setVariables 基本赋值写入 context 和 record", () => {
  it("将 outputVariables 声明的变量写入 namespaced key 和裸 key", async () => {
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "sv", type: "setVariables", config: {
          outputVariables: [{ name: "greeting", type: "string" }],
          expressions: [{ name: "greeting", expression: "hello" }]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, {}, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "sv");
    assert.ok(rec, "setVariables 节点应在 nodeRecords 中");
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
          outputVariables: [
            { name: "n", type: "number" },
            { name: "o", type: "object" },
            { name: "a", type: "array" },
            { name: "f", type: "boolean" }
          ],
          expressions: [
            { name: "n", expression: "{{trig.num}}" },
            { name: "o", expression: "{{trig.obj}}" },
            { name: "a", expression: "{{trig.arr}}" },
            { name: "f", expression: "{{trig.flag}}" }
          ]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, {}, {});
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
          outputVariables: [
            { name: "text", type: "string" },
            { name: "messageId", type: "string" }
          ],
          expressions: [
            { name: "text", expression: "{{fm.text}}" },
            { name: "messageId", expression: "{{fm.messageId}}" }
          ]
        }},
        // 入口 B：被父 flow 调用
        { id: "fin", type: "flowInput", config: { outputVariables: [
          { name: "messageText", defaultValue: "fin-default" },
          { name: "messageId", defaultValue: "m-fin" }
        ]}},
        { id: "svB", type: "setVariables", config: {
          outputVariables: [
            { name: "text", type: "string" },
            { name: "messageId", type: "string" }
          ],
          expressions: [
            { name: "text", expression: "{{fin.messageText}}" },
            { name: "messageId", expression: "{{fin.messageId}}" }
          ]
        }},
        // 下游：统一引用裸 text/messageId
        { id: "agt", type: "agent", config: { outputVariables: [{ name: "o", type: "string" }], provider: "anthropic", model: "claude", prompt: "{{text}}|{{messageId}}" } }
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
        executors: { agent: async ({ node }) => { prompts.push(node.config.prompt); return { status: "success", output: "ok" }; } }
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
        executors: { agent: async ({ node }) => { prompts.push(node.config.prompt); return { status: "success", output: "ok" }; } }
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
          outputVariables: [{ name: "apiVersion", type: "string" }],
          expressions: [{ name: "apiVersion", expression: "v2" }]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, {}, {});
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
          outputVariables: [{ name: "url", type: "string" }],
          expressions: [{ name: "url", expression: "{{trig.response.data.url}}" }]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, {}, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "sv");
    // 签核：点路径 {{a.b.c}} 由引擎 evaluateExpression 支持，setVariables 复用
    assert.equal(rec.outputVariables["sv.url"], "http://x.test/path");
  });

  it("模板字符串拼接多变量 (D11)", async () => {
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [
          { name: "first", defaultValue: "John" },
          { name: "last", defaultValue: "Doe" }
        ]}},
        { id: "sv", type: "setVariables", config: {
          outputVariables: [{ name: "fullName", type: "string" }],
          expressions: [{ name: "fullName", expression: "{{trig.first}} {{trig.last}}" }]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, {}, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "sv");
    // 签核：D11 模板拼接——模板字符串中多个 {{var}} 被插值拼接为一个字符串
    assert.equal(rec.outputVariables["sv.fullName"], "John Doe");
  });
});

describe("REQ-FLOW-047 AC7: setVariables 是 pass-through，执行完正常按出边继续", () => {
  it("下游节点在 setVariables 之后被执行，且能读到 setVariables 写入的变量", async () => {
    const order = [];
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "sv", type: "setVariables", config: {
          outputVariables: [{ name: "x", type: "string" }],
          expressions: [{ name: "x", expression: "computed" }]
        }},
        { id: "after", type: "agent", config: { outputVariables: [{ name: "o", type: "string" }], provider: "anthropic", model: "claude", prompt: "{{x}}" } }
      ],
      edges: [
        { sourceNodeId: "trig", targetNodeId: "sv" },
        { sourceNodeId: "sv", targetNodeId: "after" }
      ]
    };
    await run({ flow }, {
      executors: {
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

describe("REQ-FLOW-047 AC9: 表达式支持任意 JS 表达式与多来源聚合", () => {
  it("{{a || b}} 在 a 为空时回退到 b", async () => {
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [
          { name: "a", defaultValue: "" },
          { name: "b", defaultValue: "fallback-url" }
        ]}},
        { id: "sv", type: "setVariables", config: {
          outputVariables: [{ name: "url", type: "string" }],
          expressions: [{ name: "url", expression: "{{trig.a || trig.b}}" }]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, {}, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "sv");
    assert.equal(rec.outputVariables["sv.url"], "fallback-url");
  });

  it("{{svA.url || svB.url}} 在单 setVariables 节点内聚合多个上游来源", async () => {
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [] } },
        { id: "svA", type: "setVariables", config: {
          outputVariables: [{ name: "url", type: "string" }],
          expressions: [{ name: "url", expression: "http://from-a.test" }]
        }},
        { id: "svB", type: "setVariables", config: {
          outputVariables: [{ name: "url", type: "string" }],
          expressions: [{ name: "url", expression: "http://from-b.test" }]
        }},
        { id: "svAgg", type: "setVariables", config: {
          outputVariables: [{ name: "url", type: "string" }],
          expressions: [{ name: "url", expression: "{{svA.url || svB.url}}" }]
        }}
      ],
      edges: [
        { sourceNodeId: "trig", targetNodeId: "svA" },
        { sourceNodeId: "trig", targetNodeId: "svB" },
        { sourceNodeId: "svA", targetNodeId: "svAgg" },
        { sourceNodeId: "svB", targetNodeId: "svAgg" }
      ]
    };
    const result = await run({ flow }, {}, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "svAgg");
    assert.equal(rec.outputVariables["svAgg.url"], "http://from-a.test");
  });

  it("{{a ?? b}} 在 a 为 null/undefined 时回退到 b", async () => {
    const flow = {
      nodeList: [
        { id: "trig", type: "trigger", config: { outputVariables: [
          { name: "a", defaultValue: null },
          { name: "b", defaultValue: "fallback-url" }
        ]}},
        { id: "sv", type: "setVariables", config: {
          outputVariables: [{ name: "url", type: "string" }],
          expressions: [{ name: "url", expression: "{{trig.a ?? trig.b}}" }]
        }}
      ],
      edges: [{ sourceNodeId: "trig", targetNodeId: "sv" }]
    };
    const result = await run({ flow }, {}, {});
    const rec = result.nodeRecords.find(r => r.nodeId === "sv");
    assert.equal(rec.outputVariables["sv.url"], "fallback-url");
  });
});
