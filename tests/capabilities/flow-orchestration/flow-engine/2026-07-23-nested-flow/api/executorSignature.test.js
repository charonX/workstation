// REQ-TRACE: 2026-07-23-nested-flow/REQ-FLOW-042
// REQ-VERSION: v2.2-hash:b496ef72731fba3105a49d3185d3ca6f430dae96b9cf22e358cf2a2fd589f104
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run } from "../../../../../../src/flowEngine/flowEngine.js";

describe("REQ-FLOW-042: 引擎 executor 签名扩展与多输出支持", () => {
  it("AC1/AC2: executor 收到 services 和 currentDepth；不传不报错", async () => {
    let received = null;
    const flow = {
      nodeList: [
        { id: "n1", type: "agent", config: { provider: "anthropic", model: "claude", outputVariables: [{ name: "o", type: "string" }], prompt: "x" } }
      ],
      edges: []
    };
    await run(
      { flow },
      {
        services: { myService: () => "ok" },
        currentDepth: 3,
        executors: {
          agent: async (args) => { received = args; return { status: "success", output: "done" }; }
        }
      },
      {}
    );
    assert.ok(received);
    assert.equal(received.services.myService(), "ok");
    assert.equal(received.currentDepth, 3);
    assert.ok("node" in received);
    assert.ok("context" in received);
    assert.ok("project" in received);
    assert.ok("iteration" in received);
  });

  it("AC2: services 为空对象时不报错", async () => {
    const flow = {
      nodeList: [{ id: "n1", type: "trigger", config: { outputVariables: [] } }],
      edges: []
    };
    await assert.doesNotReject(() => run({ flow }, { services: {} }, {}));
  });

  it("AC3/AC5: executor 返回 result.outputVariables 时，多值写入 context 和 record；agent 单输出按 outputVariables[0].name", async () => {
    const flow = {
      nodeList: [
        { id: "n1", type: "trigger", config: { outputVariables: [] } },
        { id: "multi", type: "agent", config: { provider: "anthropic", model: "claude", outputVariables: [{ name: "primary", type: "string" }], prompt: "x" } }
      ],
      edges: [{ sourceNodeId: "n1", targetNodeId: "multi" }]
    };
    let capturedContext = null;
    const result = await run(
      { flow },
      { executors: {
        agent: async ({ context }) => {
          capturedContext = context;
          return { status: "success", output: "PRIMARY", outputVariables: { a: 1, b: "two", c: { deep: true } } };
        }
      }},
      {}
    );
    const rec = result.nodeRecords.find(r => r.nodeId === "multi");
    assert.ok(rec);
    // 单变量路径按 outputVariables[0].name
    assert.equal(rec.outputVariables["multi.primary"], "PRIMARY");
    // 多输出路径
    assert.equal(rec.outputVariables["multi.a"], 1);
    assert.equal(rec.outputVariables["multi.b"], "two");
    assert.deepEqual(rec.outputVariables["multi.c"], { deep: true });
    // context 同步写入
    assert.equal(capturedContext["multi.a"], 1);
    assert.equal(capturedContext["multi.b"], "two");
    assert.equal(capturedContext.a, 1); // bare key
  });

  it("AC4: 单 output 行为不变", async () => {
    const flow = {
      nodeList: [{ id: "n1", type: "trigger", config: { outputVariables: [] } }],
      edges: []
    };
    const result = await run({ flow }, {}, {});
    assert.equal(result.status, "success");
    assert.equal(result.nodesRun, 1);
  });

  it("AC5: feishuSend 的 outputVariables 被引擎消费（死代码复活）", async () => {
    // feishuSendExecutor 返回 outputVariables:{sent,msgType,content}
    // 用真实 feishusend executor + stub channel manager 验证返回值进入 record
    const flow = {
      nodeList: [
        { id: "fm", type: "feishumessage", config: { outputVariables: [
          { name: "text", defaultValue: "hi" }, { name: "sender", defaultValue: "s" }, { name: "messageId", defaultValue: "m1" }
        ]}},
        { id: "fs", type: "feishusend", config: { msgType: "text", content: `{"text":"{{fm.text}}"}`, replyToMessage: false } }
      ],
      edges: [{ sourceNodeId: "fm", targetNodeId: "fs" }]
    };
    const sent = [];
    const fakeChannelManager = {
      async send(_type, payload) { sent.push(payload); return { ok: true }; }
    };
    const result = await run({ flow }, {
      services: {
        channelSender: fakeChannelManager
      }
    }, {
      channelReply: { channelType: "feishu", chatId: "c1", messageId: "m1" }
    });
    const fsRec = result.nodeRecords.find(r => r.nodeId === "fs");
    assert.ok(fsRec);
    // sent 和 msgType 应出现在 outputVariables
    assert.equal(fsRec.outputVariables["fs.sent"], true);
    assert.equal(fsRec.outputVariables["fs.msgType"], "text");
  });

  it("AC6: currentDepth 顶层默认为 0", async () => {
    let depth;
    const flow = {
      nodeList: [{ id: "n1", type: "trigger", config: { outputVariables: [] } }],
      edges: []
    };
    await run({ flow }, { executors: {
      trigger: async (args) => { depth = args.currentDepth; return { status: "success", output: {} }; }
    }}, {});
    assert.equal(depth, 0);
  });
});
