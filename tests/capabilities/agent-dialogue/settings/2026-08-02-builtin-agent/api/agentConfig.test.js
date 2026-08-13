// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-001, 2026-08-02-builtin-agent/REQ-AGENT-002
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { getDb } from "../../../../../../src/db.js";

// seam：settings HTTP API（agent 配置区）+ safeStorage 加密存储。
// 依赖：OPC_WORKSTATION_CONFIG_DIR / DB_PATH 指向临时目录（测试隔离，见 README 注意事项）。
// 加密断言：safeStorage fake 由实现期提供；本文件按签核决策 5 断言 settings.json 无明文 key。

// seam：agentRouter（tech-design「agentRouter（三纯函数）」）。
// 建议落点 src/services/agentRouter.js，导出 createAgentRouter({ settings }) → { route({message, chatId, senderId, channelType}) }。
async function loadAgentRouter() {
  const mod = await import("../../../../../../src/services/agentRouter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/agentRouter.js 尚未实现（REQ-AGENT-002）");
  assert.equal(typeof mod.createAgentRouter, "function", "agentRouter 应导出 createAgentRouter()");
  return mod.createAgentRouter;
}

// 前置：把 senderId 绑定为操作者（走真实 arming 流程，参照 agentRoute.test.js bindUser）。
// 绑定检查先于命令识别（REQ-AGENT-021 标准 4 / 签核决策 8）——无绑定态未绑定用户的
// 命令先被 E-AUTH-NOT-BOUND 拒绝；先绑定可隔离「未配 key 命令可用」语义（REQ-AGENT-002）。
function bindUser(router, senderId) {
  router.beginBinding();
  const res = router.route({ message: "绑定", chatId: "oc_0", senderId, channelType: "p2p" });
  assert.ok(JSON.stringify(res.payload).includes("绑定成功"), "前置：绑定用户");
}

describe("REQ-AGENT-001 供应商与 API key 配置", () => {
  let server;
  let baseUrl;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-config-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("供应商枚举与保存（deepseek / moonshotai / moonshotai-cn）", async () => {
    // 签核决策 2：供应商枚举 {deepseek, moonshotai, moonshotai-cn}。
    const providers = ["deepseek", "moonshotai", "moonshotai-cn"];
    for (const provider of providers) {
      const res = await fetch(`${baseUrl}/api/settings/agent`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: `sk-test-${provider}` })
      });
      assert.equal(res.status, 200, `保存 ${provider} 应成功，实际 ${res.status}`);
    }
    const res = await fetch(`${baseUrl}/api/settings/agent`);
    assert.equal(res.status, 200, "读取端点应可用");
    const data = await res.json();
    // 新形态（REQ-AGENT-090）：providers 列表（旧平铺 PUT 兼容路径迁移为单条列表）
    assert.equal(data.providers[0].provider, "moonshotai-cn", "读取应返回最后保存的供应商");
    // 签核决策 5：key 不落 settings.json 明文。
    const settingsText = fs.readFileSync(path.join(workdir, "settings.json"), "utf8");
    for (const provider of providers) {
      assert.ok(!settingsText.includes(`sk-test-${provider}`), `settings.json 不应含 ${provider} 的 key 明文`);
    }
  });

  it("key 仅非空校验（不做前缀校验）", async () => {
    const emptyRes = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", apiKey: "" })
    });
    assert.ok(emptyRes.status >= 400, `空 key 应报错，实际 ${emptyRes.status}`);
    const emptyBody = JSON.stringify(await emptyRes.json());
    assert.ok(emptyBody.includes("E-CONFIG-INVALID"), `空 key 错误应含 E-CONFIG-INVALID，实际: ${emptyBody}`);

    // 签核修订①：仅非空，前缀不校验（key 准确性由用户负责）。
    const oddRes = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", apiKey: "xxx-yyy" })
    });
    assert.equal(oddRes.status, 200, `任意非空前缀应可保存，实际 ${oddRes.status}`);
    const saved = await (await fetch(`${baseUrl}/api/settings/agent`)).json();
    assert.equal(saved.providers[0].configured, true, "保存后应为已配置状态");
    assert.equal(saved.providers[0].provider, "deepseek", "读取应返回保存的供应商");
  });

  it("测试连接（保存前校验 key 有效性）", async () => {
    // 签核决策 3：失败透传原因（E-AGENT-LLM-FAIL）、不阻止保存。
    // 测试环境不允许真实网络：mock LLM 最小校验请求为失败，断言透传与保存不受阻（参考 imRouting mock fetch 模式）。
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes("deepseek.com") || urlStr.includes("moonshot")) {
        return new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 });
      }
      return originalFetch(url, init);
    };
    try {
      const testRes = await fetch(`${baseUrl}/api/settings/agent/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "deepseek", apiKey: "sk-invalid-000" })
      });
      const testBody = JSON.stringify(await testRes.json());
      assert.ok(testBody.includes("E-AGENT-LLM-FAIL"), `测试连接失败应透传 E-AGENT-LLM-FAIL，实际: ${testBody}`);
      assert.ok(/invalid api key/.test(testBody), `应透传供应商失败原因，实际: ${testBody}`);

      const saveRes = await fetch(`${baseUrl}/api/settings/agent`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "deepseek", apiKey: "sk-invalid-000" })
      });
      assert.equal(saveRes.status, 200, "测试连接失败不应阻止保存");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("配置状态可查（已配置/未配置 + 供应商名）", async () => {
    const before = await (await fetch(`${baseUrl}/api/settings/agent`)).json();
    assert.equal(before.providers.length, 0, "初始应为未配置（空列表）");
    assert.equal(before.defaultModel, null, "未配置时默认组合应为 null");

    await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "moonshotai", apiKey: "sk-m-123" })
    });
    const after = await (await fetch(`${baseUrl}/api/settings/agent`)).json();
    assert.equal(after.providers[0].configured, true, "保存后应为已配置");
    assert.equal(after.providers[0].provider, "moonshotai", "应返回供应商名");
  });
});

describe("REQ-AGENT-002 key 缺失引导", () => {
  let server;
  let baseUrl;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-config-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("未配置 key 时 agent 对话回复 E-AGENT-NO-KEY 引导文案，不启动会话", async () => {
    const createAgentRouter = await loadAgentRouter();
    const router = createAgentRouter({}); // 未配置 key（默认 settings）
    // 全量拒绝语义（REQ-AGENT-015，Slice 8 裁决）：无绑定态未绑定用户一切消息先被
    // E-AUTH-NOT-BOUND 拒绝（绑定检查先于 key 检查）——先绑定操作者，使「已绑定用户
    // 未配 key → E-AGENT-NO-KEY」语义完整成立（REQ-AGENT-002 标准 1）。
    bindUser(router, "ou_1");
    const result = router.route({ message: "你好", chatId: "oc_1", senderId: "ou_1", channelType: "p2p" });
    assert.equal(result.action, "reject", "未配 key 时对话应被拒绝（不进入会话分发）");
    const payloadJson = JSON.stringify(result.payload);
    assert.ok(payloadJson.includes("E-AGENT-NO-KEY"), `应返回 E-AGENT-NO-KEY，实际: ${payloadJson}`);
    // 引导文案指向 Settings Agent 区（PRD §8 签核文案：「请在设置中配置 Agent API key」）。
    assert.match(payloadJson, /配置 Agent API key|设置/, "回复应含指向 Settings 的引导文案");
    // 不启动 agent 会话：agent_sessions 无行。
    const { c } = getDb().prepare("SELECT COUNT(*) AS c FROM agent_sessions").get();
    assert.equal(c, 0, "未配 key 不应创建会话行");
  });

  it("斜杠命令在未配 key 时照常可用", async () => {
    const createAgentRouter = await loadAgentRouter();
    // 注入同步 mock 命令执行层（本文件声明的 test seam；生产缺省 = C2 真实命令模块）。
    const router = createAgentRouter({
      commands: { execute() { return { output: "ok" }; } }
    }); // 未配置 key
    // 无绑定态未绑定用户的命令先被绑定检查拒绝（REQ-AGENT-021 标准 4 / 签核决策 8）——
    // 先绑定操作者，再验证「未配 key 命令可用」与绑定无关（REQ-AGENT-002 标准 2）。
    bindUser(router, "ou_1");
    const result = router.route({
      message: "/status 00000000-0000-0000-0000-000000000000",
      chatId: "oc_1",
      senderId: "ou_1",
      channelType: "p2p"
    });
    assert.equal(result.action, "command", "斜杠命令应直通（不依赖 LLM，签核决策 7）");
    assert.ok(!JSON.stringify(result.payload).includes("E-AGENT-NO-KEY"), "命令直通不应被 key 缺失拦截");
  });
});
