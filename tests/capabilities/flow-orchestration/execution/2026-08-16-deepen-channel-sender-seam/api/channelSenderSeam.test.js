// REQ-TRACE: 2026-08-16-deepen-channel-sender-seam/REQ-FLOW-054, 2026-08-16-deepen-channel-sender-seam/REQ-FLOW-056
// REQ-VERSION: v1-hash:6348d0580bb1f96aa54ff94bb9cba9287ec6a6eaac76fb83f6b5754f80af0c6d
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
  let capturedServices = null;
  let capturedContext = null;

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

    let senderInEngine = null;
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
            senderInEngine = services.channelSender;
            await services.channelSender.send("feishu", { chatId: "oc_mock" });
            return { status: "success" };
          }
        }
      }
    );

    assert.equal(mockSent.length, 1);
    assert.equal(mockSent[0].chatId, "oc_mock");

    // reset 后清除
    executionRunner.resetTestChannelSender();
    assert.notEqual(senderInEngine, null);
  });
});
