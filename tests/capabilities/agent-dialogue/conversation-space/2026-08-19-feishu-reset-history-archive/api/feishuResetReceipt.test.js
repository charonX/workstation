// REQ-TRACE: 2026-08-19-feishu-reset-history-archive/REQ-AGENT-123
// REQ-VERSION: v2-hash:507ffe922e1d620d7fe0d6382a3c2d3b359d27085338c3b76769d794f7df5dc1
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §6.3 row 8
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAgentRouter } from "../../../../../../src/services/agentRouter.js";

describe("REQ-AGENT-123 飞书 /reset 命令回执文案与 reset 调用保持", () => {
  it("REQ-AGENT-123 AC5: 飞书通道 /reset 回执文案恒为「已重置当前对话空间会话，可以开始新对话了」并调用 store.reset", () => {
    const resets = [];
    const stubStore = {
      reset(spaceKey) {
        resets.push(spaceKey);
        return { spaceKey, sessionRef: "/tmp/fake.jsonl", reset: true };
      }
    };

    const router = createAgentRouter({
      settings: { boundOpenId: "ou_user_1" },
      sessionStore: () => stubStore
    });

    const res = router.route({
      message: "/reset",
      chatId: "oc_test_123",
      senderId: "ou_user_1",
      channelType: "p2p"
    });

    // EXPECTED-TRACE: prd.md §6.3 row 8
    assert.equal(res.action, "command");
    assert.equal(res.payload.reply, "已重置当前对话空间会话，可以开始新对话了");
    assert.deepEqual(resets, ["feishu:oc_test_123"], "应针对飞书 chatId 调用 store.reset");
  });
});
