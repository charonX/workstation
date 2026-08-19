// REQ-TRACE: 2026-08-16-deepen-channel-sender-seam/REQ-FLOW-054, 2026-08-16-deepen-channel-sender-seam/REQ-FLOW-056
// REQ-VERSION: v1-hash:c3363f6a90ec4db66a9835cad4acc076b399a6c3fded1ce35ed12b7d8e1d4e64
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: execution
// EXPECTED-TRACE: prd.md §6.3 row 1, 2, 3
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as executionRunner from "../../../../../../src/services/executionRunner.js";

describe("REQ-FLOW-054 & REQ-FLOW-056: executionRunner channelSender seam & pure variables", () => {
  beforeEach(() => {
    executionRunner.resetTestChannelSender?.();
  });

  afterEach(() => {
    executionRunner.resetTestChannelSender?.();
  });

  it("REQ-FLOW-054 AC1/AC2: 执行 variables 中彻底移除 _channelManager", async () => {
    // 源码级断言：runOnce 拼装 variablesForRun 时不再包含 _channelManager
    const runnerFilePath = path.resolve("src/services/executionRunner.js");
    const sourceCode = fs.readFileSync(runnerFilePath, "utf-8");
    assert.equal(sourceCode.includes("_channelManager:"), false, "executionRunner 不应再注入 _channelManager 变量");

    let receivedContext = null;
    const testFlow = {
      id: "flow-test-vars",
      nodeList: [
        {
          id: "node-1",
          type: "custom-inspect",
          config: {}
        }
      ],
      edges: []
    };

    const customExecutors = {
      "custom-inspect": async ({ context }) => {
        receivedContext = { ...context };
        return { status: "success", output: "ok" };
      }
    };

    await executionRunner.runOnce(
      {
        flow: testFlow,
        project: { localPath: "/tmp" },
        variables: { customVar: "abc" }
      },
      {
        persist: false,
        executors: customExecutors
      }
    );

    assert.ok(receivedContext);
    assert.equal(receivedContext.customVar, "abc");
    assert.equal(receivedContext._channelManager, undefined, "context 中绝不包含 _channelManager");
  });

  it("REQ-FLOW-056 AC1: 默认组装的 services.channelSender 提供 send 与 reply 方法", async () => {
    let capturedServices = null;
    const testFlow = {
      id: "flow-test-services",
      nodeList: [{ id: "n1", type: "capture-node" }],
      edges: []
    };

    await executionRunner.runOnce(
      {
        flow: testFlow,
        project: { localPath: "/tmp" }
      },
      {
        persist: false,
        executors: {
          "capture-node": async ({ services }) => {
            capturedServices = services;
            return { status: "success" };
          }
        }
      }
    );

    assert.ok(capturedServices);
    assert.ok(capturedServices.channelSender);
    assert.equal(typeof capturedServices.channelSender.send, "function");
    assert.equal(typeof capturedServices.channelSender.reply, "function");
  });

  it("REQ-FLOW-056 AC2: setTestChannelSender 注入 mock 并优先生效", async () => {
    const mockSent = [];
    const mockSender = {
      async send(channelType, payload) {
        mockSent.push({ channelType, ...payload });
        return { mockSuccess: true };
      },
      async reply(channelType, payload) {
        mockSent.push({ reply: true, channelType, ...payload });
        return { mockSuccess: true };
      }
    };

    executionRunner.setTestChannelSender(mockSender);

    const testFlow = {
      id: "flow-test-mock-sender",
      nodeList: [{ id: "n1", type: "check-mock" }],
      edges: []
    };

    await executionRunner.runOnce(
      {
        flow: testFlow,
        project: { localPath: "/tmp" }
      },
      {
        persist: false,
        executors: {
          "check-mock": async ({ services }) => {
            await services.channelSender.send("feishu", { chatId: "oc_mock" });
            return { status: "success" };
          }
        }
      }
    );

    assert.equal(mockSent.length, 1);
    assert.equal(mockSent[0].chatId, "oc_mock");
  });

  it("REQ-FLOW-056 AC2 兼容性: setChannelAdapterForTests 在注入边界包装 1 参 adapter", async () => {
    const adapterSent = [];
    const legacyAdapter = {
      async send(payload) {
        adapterSent.push(payload);
        return { legacy: true };
      },
      async reply(payload) {
        adapterSent.push({ reply: true, ...payload });
        return { legacy: true };
      }
    };

    executionRunner.setChannelAdapterForTests(legacyAdapter);

    const testFlow = {
      id: "flow-test-legacy-adapter",
      nodeList: [{ id: "n1", type: "check-legacy" }],
      edges: []
    };

    await executionRunner.runOnce(
      {
        flow: testFlow,
        project: { localPath: "/tmp" }
      },
      {
        persist: false,
        executors: {
          "check-legacy": async ({ services }) => {
            await services.channelSender.send("feishu", { chatId: "oc_legacy" });
            return { status: "success" };
          }
        }
      }
    );

    assert.equal(adapterSent.length, 1);
    assert.equal(adapterSent[0].chatId, "oc_legacy");
  });

  it("REQ-FLOW-056 AC3: 子流程继承父流程注入的 services.channelSender", async () => {
    const subflowCalls = [];
    const mockSender = {
      async send(channelType, payload) {
        subflowCalls.push({ method: "send", channelType, ...payload });
        return { ok: true };
      },
      async reply(channelType, payload) {
        subflowCalls.push({ method: "reply", channelType, ...payload });
        return { ok: true };
      }
    };

    executionRunner.setTestChannelSender(mockSender);

    let subflowRan = false;
    const parentFlow = {
      id: "parent-flow",
      nodeList: [{ id: "n1", type: "call-sub" }],
      edges: []
    };

    const subFlow = {
      id: "child-flow",
      nodeList: [{ id: "cn1", type: "child-send" }],
      edges: []
    };

    const customExecutors = {
      "call-sub": async ({ services }) => {
        // 调用子流程
        const result = await services.invokeSubflow(
          { flow: subFlow, project: { localPath: "/tmp" } },
          { subflowId: "child-flow", persist: false, executors: customExecutors }
        );
        return { status: "success", output: result.output };
      },
      "child-send": async ({ services }) => {
        subflowRan = true;
        // 子流程节点调用 channelSender
        await services.channelSender.send("feishu", { chatId: "oc_from_child" });
        return { status: "success", output: "child_done" };
      }
    };

    await executionRunner.runOnce(
      {
        flow: parentFlow,
        project: { localPath: "/tmp" }
      },
      {
        persist: false,
        executors: customExecutors
      }
    );

    assert.equal(subflowRan, true, "子流程必须成功执行");
    assert.equal(subflowCalls.length, 1, "子流程调用应直接命中 mockSender");
    assert.equal(subflowCalls[0].chatId, "oc_from_child");
  });

  it("REQ-FLOW-056 AC4: resetTestChannelSender 与 runner.reset 清理 mock 恢复生产默认", async () => {
    let mockCalls = 0;
    const mockSender = {
      async send() {
        mockCalls++;
        return { ok: true };
      },
      async reply() {
        mockCalls++;
        return { ok: true };
      }
    };

    executionRunner.setTestChannelSender(mockSender);

    const testFlow = {
      id: "flow-test-reset-mock",
      nodeList: [{ id: "n1", type: "send-node" }],
      edges: []
    };

    const customExecutors = {
      "send-node": async ({ services }) => {
        try {
          await services.channelSender.send("feishu", { chatId: "oc_test" });
        } catch {
          // 生产离线可能抛错，忽略
        }
        return { status: "success" };
      }
    };

    // 第一次运行：mock 生效
    await executionRunner.runOnce(
      { flow: testFlow, project: { localPath: "/tmp" } },
      { persist: false, executors: customExecutors }
    );
    assert.equal(mockCalls, 1, "第一次运行应调用 mockSender");

    // 调用 runner.reset()
    await executionRunner.reset();

    // 第二次运行：mock 已被清除，不再调用 mockSender
    await executionRunner.runOnce(
      { flow: testFlow, project: { localPath: "/tmp" } },
      { persist: false, executors: customExecutors }
    );
    assert.equal(mockCalls, 1, "reset 后再次运行，mockSender 不应再被调用");
  });
});
