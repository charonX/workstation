// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-021, 2026-08-02-builtin-agent/REQ-AGENT-022
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true
//
// Slice 6 test-gap 补测（build-progress 登记 2026-08-04，Slice 8 收口）：
// U2 生产路径斜杠命令不再静默——route() 同步受理 + payload.commandReply（异步执行
// 完成后的真实格式化回复），imRouter 经 channel reply 回投。本文件以 imRouter 级
// seam 断言回投链路：真实 agentRouter（注入异步命令执行层）+ 真实 imRouter +
// mock 通道——「查无此执行」与格式化状态文本经 channel reply 到达用户。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { createMockChannelAdapter } from "../../../../../fixtures/media-production-line/mockChannelAdapter.js";

// seam：agentRouter（tech-design「agentRouter（三纯函数）」）——真实路由 + 注入
// 异步命令执行层（模拟生产 C2 命令模块的 async 返回）。
async function loadAgentRouter() {
  const mod = await import("../../../../../../src/services/agentRouter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentRouter.js 尚未实现（REQ-AGENT-021/022）");
  return mod.createAgentRouter;
}

// seam：imRouter（REQ-AGENT-017 agent 优先路由）。
async function loadImRouter() {
  const mod = await import("../../../../../../src/services/channels/imRouter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/channels/imRouter.js");
  return mod.createImRouter;
}

// 前置：把 senderId 绑定为操作者（走真实 arming 流程，命令直通需先过绑定检查）。
function bindUser(router, senderId) {
  router.beginBinding();
  const res = router.route({ message: "绑定", chatId: "oc_0", senderId, channelType: "p2p" });
  assert.ok(JSON.stringify(res.payload).includes("绑定成功"), "前置：绑定用户");
}

// 经真实 imRouter 发送一条命令消息，返回 mock 通道收到的全部回执文本。
async function sendCommand(adapter, createImRouter, agentRouter, text) {
  const im = createImRouter({ channelAdapter: adapter, baseUrl: "http://127.0.0.1:0", agentRouter });
  adapter.emitMessage({ messageId: "om_cmdreply_1", chatId: "oc_1", senderId: "ou_1", text });
  await new Promise((resolve) => setTimeout(resolve, 300));
  return adapter.replies.map((r) => r.text);
}

describe("REQ-AGENT-021 commandReply 回投链路（U2 test-gap 补测）", () => {
  let serverCtx;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "command-reply-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    serverCtx = await startServer({ port: 0 });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("生产 /status 未知 id：异步执行 → commandReply「查无此执行」经 channel reply 回投", async () => {
    const createAgentRouter = await loadAgentRouter();
    const createImRouter = await loadImRouter();
    // 异步执行层（生产 C2 命令模块路径：route() 同步受理 + commandReply promise）。
    const router = createAgentRouter({
      commands: {
        async execute() {
          return { output: null, notFound: true };
        }
      }
    });
    bindUser(router, "ou_1");
    const adapter = createMockChannelAdapter();
    const unknownId = crypto.randomUUID();
    const texts = await sendCommand(adapter, createImRouter, router, `/status ${unknownId}`);
    assert.ok(
      texts.some((t) => t.includes("查无此执行")),
      `「查无此执行」应经 channel reply 回投，实际回执: ${JSON.stringify(texts)}`
    );
  });

  it("生产 /status 已知执行：commandReply 回投格式化状态文本", async () => {
    const createAgentRouter = await loadAgentRouter();
    const createImRouter = await loadImRouter();
    const router = createAgentRouter({
      commands: {
        async execute(name, args) {
          return { output: { id: args[0], status: "queued", flowId: "flow_x", startedAt: "2026-08-04T00:00:00Z" } };
        }
      }
    });
    bindUser(router, "ou_1");
    const adapter = createMockChannelAdapter();
    const knownId = crypto.randomUUID();
    const texts = await sendCommand(adapter, createImRouter, router, `/status ${knownId}`);
    assert.ok(
      texts.some((t) => t.includes("状态 queued")),
      `格式化状态文本应经 channel reply 回投（命令直通不占 LLM turn），实际回执: ${JSON.stringify(texts)}`
    );
  });
});
