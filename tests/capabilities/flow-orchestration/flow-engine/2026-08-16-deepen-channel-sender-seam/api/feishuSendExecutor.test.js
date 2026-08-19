// REQ-TRACE: 2026-08-16-deepen-channel-sender-seam/REQ-FLOW-055, 2026-08-16-deepen-channel-sender-seam/REQ-FLOW-057
// REQ-VERSION: v1-hash:6348d0580bb1f96aa54ff94bb9cba9287ec6a6eaac76fb83f6b5754f80af0c6d
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// EXPECTED-TRACE: prd.md §6.3 row 1, 2, 3
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { feishuSendExecutor } from "../../../../../../src/flowEngine/executors/feishuSendExecutor.js";

describe("REQ-FLOW-055 & REQ-FLOW-057: feishuSendExecutor via services.channelSender", () => {
  it("REQ-FLOW-055 AC1: 源码中彻底移除 context._channelManager 与 dynamic import channelManager", () => {
    const executorFilePath = path.resolve("src/flowEngine/executors/feishuSendExecutor.js");
    const sourceCode = fs.readFileSync(executorFilePath, "utf-8");
    assert.equal(sourceCode.includes("_channelManager"), false, "源码中不应再包含 _channelManager");
    assert.equal(sourceCode.includes("import("), false, "源码中不应再包含 dynamic import");
  });

  it("REQ-FLOW-055 AC2: 包含 messageId 时通过 services.channelSender.reply 发送", async () => {
    const replied = [];
    const fakeSender = {
      async reply(channelType, payload) {
        replied.push({ channelType, ...payload });
        return { ok: true };
      },
      async send() {
        throw new Error("should not call send");
      }
    };

    const result = await feishuSendExecutor({
      node: { config: { msgType: "text", content: '{"text":"hello {{user}}"}' } },
      context: {
        user: "world",
        channelReply: { channelType: "feishu", chatId: "oc_test_chat", messageId: "om_test_msg" }
      },
      services: {
        channelSender: fakeSender
      }
    });

    assert.equal(result.status, "success");
    assert.equal(replied.length, 1);
    assert.equal(replied[0].channelType, "feishu");
    assert.equal(replied[0].messageId, "om_test_msg");
    assert.equal(replied[0].msgType, "text");
    const content = JSON.parse(replied[0].content);
    assert.equal(content.text, "hello world");
    assert.deepEqual(result.outputVariables, { sent: true, msgType: "text", content });
  });

  it("REQ-FLOW-055 AC3: replyToMessage=false 时通过 services.channelSender.send 发送", async () => {
    const sent = [];
    const fakeSender = {
      async reply() {
        throw new Error("should not call reply");
      },
      async send(channelType, payload) {
        sent.push({ channelType, ...payload });
        return { ok: true };
      }
    };

    const result = await feishuSendExecutor({
      node: { config: { msgType: "text", replyToMessage: false, content: '{"text":"direct send"}' } },
      context: {
        channelReply: { channelType: "feishu", chatId: "oc_direct_chat", messageId: "om_test_msg" }
      },
      services: {
        channelSender: fakeSender
      }
    });

    assert.equal(result.status, "success");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].channelType, "feishu");
    assert.equal(sent[0].chatId, "oc_direct_chat");
    assert.equal(sent[0].messageId, undefined);
  });

  it("REQ-FLOW-055 AC5: 缺失 channelReply 或 content 为空时降级为 skipped", async () => {
    const resultNoReply = await feishuSendExecutor({
      node: { config: { msgType: "text", content: '{"text":"hi"}' } },
      context: {},
      services: { channelSender: {} }
    });
    assert.equal(resultNoReply.status, "success");
    assert.equal(resultNoReply.output, "skipped");
    assert.deepEqual(resultNoReply.outputVariables, { skipped: true });

    const resultEmptyContent = await feishuSendExecutor({
      node: { config: { msgType: "text", content: "" } },
      context: { channelReply: { channelType: "feishu", chatId: "oc_1" } },
      services: { channelSender: {} }
    });
    assert.equal(resultEmptyContent.status, "success");
    assert.equal(resultEmptyContent.output, "skipped");
    assert.deepEqual(resultEmptyContent.outputVariables, { skipped: true });
  });

  it("REQ-FLOW-057 AC1: 缺失 services.channelSender 时返回受控错误", async () => {
    const result = await feishuSendExecutor({
      node: { config: { msgType: "text", content: '{"text":"fail test"}' } },
      context: {
        channelReply: { channelType: "feishu", chatId: "oc_chat", messageId: "om_msg" }
      },
      services: {}
    });
    assert.equal(result.status, "error");
    assert.match(result.error, /channelSender service not available/i);
    assert.ok(result.logs.some((l) => l.message.includes("channelSender service not available")));
  });

  it("REQ-FLOW-057 AC2: channelSender 抛出异常（如离线）时返回受控错误与日志", async () => {
    const fakeSender = {
      async reply() {
        throw new Error("E-CHANNEL-OFFLINE: channel feishu is offline");
      }
    };
    const result = await feishuSendExecutor({
      node: { config: { msgType: "text", content: '{"text":"offline test"}' } },
      context: {
        channelReply: { channelType: "feishu", chatId: "oc_chat", messageId: "om_msg" }
      },
      services: {
        channelSender: fakeSender
      }
    });
    assert.equal(result.status, "error");
    assert.match(result.error, /feishuSend: send failed: E-CHANNEL-OFFLINE/);
    assert.ok(result.logs.some((l) => l.message.includes("E-CHANNEL-OFFLINE")));
  });
});
