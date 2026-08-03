// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-021, 2026-08-02-builtin-agent/REQ-AGENT-022
// REQ-VERSION: v1-hash:1a95cf23677ba5e4cea1a2eb2157896aeef22713b6de03f9c5119c49f3830e2b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { getDb } from "../../../../../../src/db.js";

// seam：agentRouter 命令识别纯函数 + 命令模块直通（不走 LLM/agent 进程，D1 决策）。
// 命令格式（签核决策 6）：/status <UUID>（crypto.randomUUID）、/list [projectId|flowId]、/reset、/help 无参。

// seam：agentRouter（tech-design「agentRouter（三纯函数）」）。
// 建议落点 src/services/agentRouter.js，导出 createAgentRouter({ commands?, sessionStore? }) →
// route({message, chatId, senderId, channelType}) → {action: "reject"|"command"|"dialogue", payload: {reply, code?, ...}}。
// commands 为命令模块执行层注入（生产走真实命令模块直通，C2 路径）；命令直通不经 LLM。
async function loadAgentRouter() {
  const mod = await import("../../../../../../src/services/agentRouter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentRouter.js 尚未实现（REQ-AGENT-021/022）");
  assert.equal(typeof mod.createAgentRouter, "function", "agentRouter 应导出 createAgentRouter()");
  return mod.createAgentRouter;
}

// 前置：把 senderId 绑定为操作者（走真实 arming 流程）。
function bindUser(router, senderId) {
  router.beginBinding();
  const res = router.route({ message: "绑定", chatId: "oc_0", senderId, channelType: "p2p" });
  assert.ok(JSON.stringify(res.payload).includes("绑定成功"), "前置：绑定用户");
}

describe("REQ-AGENT-021 命令识别直通（/status /list）", () => {
  let server;
  let baseUrl;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "slash-commands-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("/ 前缀命中命令集 → 主进程直通命令模块，不经 LLM", async () => {
    const createAgentRouter = await loadAgentRouter();
    const invoked = [];
    const router = createAgentRouter({
      commands: {
        async execute(name, args) { invoked.push({ name, args }); return { output: "执行状态：成功" }; }
      }
    });
    bindUser(router, "ou_1");
    const res = router.route({ message: `/status ${crypto.randomUUID()}`, chatId: "oc_1", senderId: "ou_1", channelType: "p2p" });
    assert.equal(res.action, "command", "斜杠命令应直通（不经 LLM/agent 进程，签核决策 7）");
    assert.equal(invoked.length, 1, "应直接调命令模块");
    assert.ok(res.payload?.reply && JSON.stringify(res.payload.reply).length > 0, "应返回格式化回复");
    // 不创建 agent 会话（命令直通先于会话分发）。
    const { c } = getDb().prepare("SELECT COUNT(*) AS c FROM agent_sessions").get();
    assert.equal(c, 0, "命令直通不应创建 agent 会话");
  });

  it("/status <id>：UUID 格式校验；未知 id 明确回复", async () => {
    const createAgentRouter = await loadAgentRouter();
    const invoked = [];
    const router = createAgentRouter({
      commands: {
        async execute(name, args) {
          invoked.push({ name, args });
          // 未知 id：查无此执行。
          return { output: null, notFound: true };
        }
      }
    });
    bindUser(router, "ou_1");
    // 非法（非 UUID）→ E-CMD-INVALID 用法提示（签核决策 6：id 必填且 UUID 格式）。
    const invalid = router.route({ message: "/status 123", chatId: "oc_1", senderId: "ou_1", channelType: "p2p" });
    assert.equal(invalid.action, "command");
    assert.ok(JSON.stringify(invalid.payload).includes("E-CMD-INVALID"), "非法 id 应报 E-CMD-INVALID");
    assert.ok(JSON.stringify(invalid.payload).includes("用法"), "应含用法提示（用法：/status <executionId>）");
    assert.equal(invoked.length, 0, "非法参数不应执行命令");
    // 合法 UUID 但未知 → 查无此执行的明确回复（REQ-AGENT-021 标准 2）。
    const unknown = router.route({ message: `/status ${crypto.randomUUID()}`, chatId: "oc_1", senderId: "ou_1", channelType: "p2p" });
    assert.ok(JSON.stringify(unknown.payload).includes("查无此执行"), "未知 id 应明确回复查无此执行");
  });

  it("/list 可选过滤参数与格式校验", async () => {
    const createAgentRouter = await loadAgentRouter();
    const invoked = [];
    const router = createAgentRouter({
      commands: {
        async execute(name, args) { invoked.push({ name, args }); return { output: "[]" }; }
      }
    });
    bindUser(router, "ou_1");
    const all = router.route({ message: "/list", chatId: "oc_1", senderId: "ou_1", channelType: "p2p" });
    assert.equal(all.action, "command", "/list 无参应可用");
    const filtered = router.route({ message: "/list proj_1", chatId: "oc_1", senderId: "ou_1", channelType: "p2p" });
    assert.equal(filtered.action, "command", "/list <projectId> 应可用（REQ-AGENT-021 标准 3）");
    assert.ok(
      invoked.some((i) => JSON.stringify(i.args).includes("proj_1")),
      "过滤参数应传给命令模块"
    );
    const bad = router.route({ message: "/list a b", chatId: "oc_1", senderId: "ou_1", channelType: "p2p" });
    assert.ok(JSON.stringify(bad.payload).includes("E-CMD-INVALID"), "多余参数应报 E-CMD-INVALID（用法：/list [projectId|flowId]）");
  });

  it("未绑定用户命令仍先过绑定检查", async () => {
    const createAgentRouter = await loadAgentRouter();
    const invoked = [];
    const router = createAgentRouter({
      commands: { async execute(name, args) { invoked.push(name); return {}; } }
    }); // 未绑定
    const res = router.route({ message: `/status ${crypto.randomUUID()}`, chatId: "oc_1", senderId: "ou_unbound", channelType: "p2p" });
    assert.equal(res.action, "reject", "未绑定用户命令应先被绑定检查拒绝（REQ-AGENT-021 标准 4）");
    assert.ok(JSON.stringify(res.payload).includes("E-AUTH-NOT-BOUND"), "拒绝应含 E-AUTH-NOT-BOUND");
    assert.equal(invoked.length, 0, "命令不应被执行（拒绝先于命令识别）");
  });
});

describe("REQ-AGENT-022 会话命令与可用性", () => {
  let server;
  let baseUrl;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "slash-commands-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("/reset 复用 REQ-AGENT-010 语义（当前空间，其他空间不受影响）", async () => {
    const createAgentRouter = await loadAgentRouter();
    const resets = [];
    const router = createAgentRouter({
      sessionStore: {
        reset: (spaceKey) => { resets.push(spaceKey); }
      }
    });
    bindUser(router, "ou_1");
    const res = router.route({ message: "/reset", chatId: "oc_a", senderId: "ou_1", channelType: "p2p" });
    assert.equal(res.action, "command", "/reset 应直通");
    assert.deepEqual(resets, ["feishu:oc_a"], "/reset 仅应作用于当前空间（REQ-AGENT-010 语义，签核决策 17）");
    assert.ok(JSON.stringify(res.payload.reply).includes("已重置"), "应回复「已重置」");
  });

  it("/help 返回命令集与用法说明", async () => {
    const createAgentRouter = await loadAgentRouter();
    const router = createAgentRouter({});
    bindUser(router, "ou_1");
    const res = router.route({ message: "/help", chatId: "oc_1", senderId: "ou_1", channelType: "p2p" });
    assert.equal(res.action, "command");
    const reply = JSON.stringify(res.payload?.reply ?? res.payload);
    for (const cmd of ["/status", "/list", "/reset", "/help"]) {
      assert.ok(reply.includes(cmd), `/help 应说明 ${cmd} 用法（REQ-AGENT-022 标准 2）`);
    }
  });

  it("全部命令未配 key 可用；命令先于会话分发（无空间也响应）", async () => {
    const createAgentRouter = await loadAgentRouter();
    const router = createAgentRouter({}); // 未配 key、无任何空间
    bindUser(router, "ou_1");
    const res = router.route({ message: "/help", chatId: "oc_new_space", senderId: "ou_1", channelType: "p2p" });
    assert.equal(res.action, "command", "未配 key 时命令应照常可用（回归 REQ-AGENT-002 标准 2，签核决策 7）");
    assert.ok(!JSON.stringify(res.payload).includes("E-AGENT-NO-KEY"), "命令直通不应被 key 缺失拦截");
    const { c } = getDb().prepare("SELECT COUNT(*) AS c FROM agent_sessions").get();
    assert.equal(c, 0, "命令先于会话分发：无空间也响应且不创建会话");
  });
});
