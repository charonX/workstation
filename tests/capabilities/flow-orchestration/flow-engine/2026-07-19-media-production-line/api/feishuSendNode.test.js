// REQ-TRACE: 2026-07-19-media-production-line/REQ-FLOW-032
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow-engine
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { feishuSendExecutor } from "../../../../../../src/flowEngine/executors/feishuSendExecutor.js";

describe("REQ-FLOW-032: feishuSend node executor", () => {
  it("AC3/AC4: 无 channelReply 上下文时降级为 skipped 不阻断 flow", async () => {
    const result = await feishuSendExecutor({
      node: { config: { msgType: "text", content: '{"text":"hi"}' } },
      context: {}
    });
    assert.equal(result.status, "success");
    assert.equal(result.output, "skipped");
    assert.deepEqual(result.outputVariables, { skipped: true });
  });

  it("AC3: content 支持 {{fullName}} 插值并经 channelManager.reply 发送（reply 默认线程回复）", async () => {
    const sent = [];
    const replied = [];
    const fakeChannelManager = {
      async reply(channelType, payload) { replied.push({ channelType, ...payload }); },
      async send(channelType, payload) { sent.push({ channelType, ...payload }); }
    };
    const result = await feishuSendExecutor({
      node: { config: { msgType: "text", content: '{"text":"已存：{{agent.savedPath}}"}' } },
      context: {
        "agent.savedPath": "/abs/path/to/file.md",
        channelReply: { channelType: "feishu", chatId: "oc_1", messageId: "om_1" },
        _channelManager: fakeChannelManager
      }
    });
    assert.equal(result.status, "success");
    assert.equal(replied.length, 1, "应经 reply 回原线程");
    assert.equal(sent.length, 0, "不应经 send");
    assert.equal(replied[0].messageId, "om_1");
    assert.equal(replied[0].msgType, "text");
    // 插值：字符串值应正确替换并 JSON-encoded for content
    const parsed = JSON.parse(replied[0].content);
    assert.equal(parsed.text, "已存：/abs/path/to/file.md");
  });

  it("AC3: replyToMessage=false 时经 channelManager.send 发送到 chat", async () => {
    const sent = [];
    const fakeChannelManager = {
      async reply() {},
      async send(channelType, payload) { sent.push({ channelType, ...payload }); }
    };
    await feishuSendExecutor({
      node: { config: { msgType: "text", replyToMessage: false, content: '{"text":"hello"}' } },
      context: {
        channelReply: { channelType: "feishu", chatId: "oc_1", messageId: "om_1" },
        _channelManager: fakeChannelManager
      }
    });
    assert.equal(sent.length, 1, "replyToMessage=false 时走 send");
    assert.equal(sent[0].chatId, "oc_1");
  });

  it("AC3: 支持 post 富文本 msgType，content JSON 直接透传", async () => {
    const replied = [];
    const fakeChannelManager = {
      async reply(_, payload) { replied.push(payload); },
      async send() {}
    };
    const postContent = {
      zh_cn: {
        title: "完成",
        content: [[{ tag: "text", text: "ok" }]]
      }
    };
    await feishuSendExecutor({
      node: { config: { msgType: "post", content: JSON.stringify(postContent) } },
      context: {
        channelReply: { channelType: "feishu", chatId: "oc_1", messageId: "om_1" },
        _channelManager: fakeChannelManager
      }
    });
    assert.equal(replied[0].msgType, "post");
    assert.deepEqual(JSON.parse(replied[0].content), postContent);
  });

  it("AC3: send 失败返回 status=error 不静默吞掉", async () => {
    const fakeChannelManager = {
      async reply() { throw new Error("network down"); },
      async send() {}
    };
    const result = await feishuSendExecutor({
      node: { config: { msgType: "text", content: '{"text":"hi"}' } },
      context: {
        channelReply: { channelType: "feishu", chatId: "oc_1", messageId: "om_1" },
        _channelManager: fakeChannelManager
      }
    });
    assert.equal(result.status, "error");
    assert.match(result.error, /send failed/);
  });
});
