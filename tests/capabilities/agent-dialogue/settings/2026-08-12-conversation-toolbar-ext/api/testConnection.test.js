// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-103
// REQ-VERSION: v3-hash:253ff44240a7dc1db95967cead3d95ed990ef61c7c4b8f8654fd146cdc93c005
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true（expected 值人签：E-TEST-UNSUPPORTED 码 + 文案 + 前端中性展示，BUG-001 分类/方案确认 2026-08-14）

// test-connection 全量 apiKey 型 provider 语义（REQ-AGENT-103，v0.7 / BUG-001 req-gap 就地补全）。
//
// 背景：v0.6（REQ-100/101）把添加表单 provider 放到 37 个 catalog 项，test-connection 端点
// 仍用三 provider 时代硬编码端点表（AGENT_PROVIDER_ENDPOINTS 仅 deepseek/moonshotai/
// moonshotai-cn）→ 34 个新 provider 点「测试连接」误报「请选择供应商」。
//
// 契约（requirements v3 / REQ-AGENT-103）：
// - provider 合法性 = isApiKeyProvider（catalog 单一真源，与保存校验同源）；
// - 端点 = pi-ai 目录 baseUrl + "/models"（Authorization: Bearer）；legacy 3 项派生结果
//   与原硬编码端点逐字一致；
// - baseUrl 缺失 provider（amazon-bedrock 等 7 项）→ 200 {ok:false, error:
//   "E-TEST-UNSUPPORTED", message:"该供应商不支持连接测试，可直接保存"}，不发网络请求；
// - 网络/HTTP 失败 → {ok:false, error:"E-AGENT-LLM-FAIL", message 透传}；不阻塞保存。
//
// seam：POST /api/settings/agent/test-connection（settings 路由，真实 server harness +
// mock 全局 fetch 拦截供应商最小校验请求，参考 agentConfig.test.js 模式）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// mock 全局 fetch：拦截供应商校验请求（捕获 URL/头、按剧本响应），测试 harness 自身的
// API 调用（127.0.0.1）放行 originalFetch。calls 记录 {url, authorization} 供断言。
function mockProviderFetch(script) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.startsWith("http://127.0.0.1") || urlStr.startsWith("http://localhost")) {
      return originalFetch(url, init);
    }
    calls.push({ url: urlStr, authorization: init?.headers?.Authorization ?? null });
    return script(urlStr);
  };
  return { calls, restore: () => { global.fetch = originalFetch; } };
}

async function postTestConnection(baseUrl, body) {
  const res = await fetch(`${baseUrl}/api/settings/agent/test-connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("REQ-AGENT-103 test-connection 全量 provider（v0.7 / BUG-001）", () => {
  let workdir;
  let server;
  let baseUrl;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "testconn-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    process.env.DB_PATH = path.join(workdir, "data.db");
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    delete process.env.DB_PATH;
  });

  it("标准 1：kimi-coding 端点派生 = catalog baseUrl + /models（Bearer），200 → ok:true", async () => {
    const mock = mockProviderFetch(() => new Response("{}", { status: 200 }));
    try {
      const { status, body } = await postTestConnection(baseUrl, { provider: "kimi-coding", apiKey: "sk-kc-1" });
      assert.equal(status, 200);
      assert.equal(body.ok, true, `供应商 200 应 ok:true，实际: ${JSON.stringify(body)}`);
      assert.equal(mock.calls.length, 1, "应恰好发 1 次供应商校验请求");
      assert.equal(mock.calls[0].url, "https://api.kimi.com/coding/models", "端点 = catalog baseUrl + /models");
      assert.equal(mock.calls[0].authorization, "Bearer sk-kc-1", "应带 Bearer apiKey");
    } finally {
      mock.restore();
    }
  });

  it("标准 2：kimi-coding + 无效 key → 供应商 401 → E-AGENT-LLM-FAIL 透传原因", async () => {
    const mock = mockProviderFetch(
      () => new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 })
    );
    try {
      const { status, body } = await postTestConnection(baseUrl, { provider: "kimi-coding", apiKey: "sk-bad" });
      assert.equal(status, 200, "供应商失败不走 4xx（不阻塞保存语义）");
      assert.equal(body.ok, false);
      assert.equal(body.error, "E-AGENT-LLM-FAIL");
      assert.ok(/invalid api key/.test(body.message ?? ""), `应透传供应商原因，实际: ${JSON.stringify(body)}`);
      assert.equal(mock.calls[0].url, "https://api.kimi.com/coding/models");
    } finally {
      mock.restore();
    }
  });

  it("标准 3：amazon-bedrock（baseUrl 缺失）→ E-TEST-UNSUPPORTED 且不发网络请求", async () => {
    const mock = mockProviderFetch(() => new Response("{}", { status: 200 }));
    try {
      const { status, body } = await postTestConnection(baseUrl, { provider: "amazon-bedrock", apiKey: "sk-br-1" });
      assert.equal(status, 200);
      assert.equal(body.ok, false);
      assert.equal(body.error, "E-TEST-UNSUPPORTED", `baseUrl 缺失应 E-TEST-UNSUPPORTED，实际: ${JSON.stringify(body)}`);
      assert.equal(body.message, "该供应商不支持连接测试，可直接保存");
      assert.equal(mock.calls.length, 0, "baseUrl 缺失不得发网络请求");
    } finally {
      mock.restore();
    }
  });

  it("标准 4：非法 provider（faux / 不存在 id）→ 400 E-CONFIG-INVALID「请选择供应商」", async () => {
    for (const bad of ["faux", "no-such-provider"]) {
      const { status, body } = await postTestConnection(baseUrl, { provider: bad, apiKey: "sk-x" });
      assert.equal(status, 400, `${bad} 应 400`);
      assert.equal(body.error, "E-CONFIG-INVALID");
      assert.equal(body.message, "请选择供应商");
    }
  });

  it("标准 5：legacy 3 项端点逐字不变", async () => {
    const LEGACY = {
      deepseek: "https://api.deepseek.com/models",
      moonshotai: "https://api.moonshot.ai/v1/models",
      "moonshotai-cn": "https://api.moonshot.cn/v1/models",
    };
    const mock = mockProviderFetch(() => new Response("{}", { status: 200 }));
    try {
      for (const [provider, endpoint] of Object.entries(LEGACY)) {
        const { status, body } = await postTestConnection(baseUrl, { provider, apiKey: "sk-l" });
        assert.equal(status, 200, `${provider} 应 200`);
        assert.equal(body.ok, true, `${provider} 应 ok:true，实际: ${JSON.stringify(body)}`);
        assert.equal(mock.calls.at(-1).url, endpoint, `${provider} 端点应逐字不变`);
      }
      assert.equal(mock.calls.length, 3);
    } finally {
      mock.restore();
    }
  });

  it("标准 6：空 key → 400 E-CONFIG-INVALID「API key 不能为空」（既有行为回归）", async () => {
    const { status, body } = await postTestConnection(baseUrl, { provider: "kimi-coding", apiKey: "  " });
    assert.equal(status, 400);
    assert.equal(body.error, "E-CONFIG-INVALID");
    assert.equal(body.message, "API key 不能为空");
  });
});
