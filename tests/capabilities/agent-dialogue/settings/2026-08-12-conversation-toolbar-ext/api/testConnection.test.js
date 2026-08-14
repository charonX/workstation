// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-103
// REQ-VERSION: v5-hash:98fd8e7b5e422ebb499f737b00421a4db397895794664dd5e6bfea1c492398a2
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true（expected 值人签：E-TEST-UNSUPPORTED 码 + 文案 + 前端中性展示，BUG-001 分类确认 2026-08-14；协议族分派 + google key-in-URL 安全边界，BUG-002 范围 A 人签 2026-08-14）

// test-connection 全量 apiKey 型 provider 语义（REQ-AGENT-103，v0.7 / BUG-001+002 req-gap 补全）。
//
// v4 协议族感知派生（BUG-002 实证）：kimi-coding 属 anthropic-messages 族——
// /coding/models → 404（端点不存在），/coding/v1/models → 401（端点存在，假 key 被拒）；
// pi-ai Anthropic SDK 实证形态 = x-api-key + anthropic-version 头。
// 族数据源 = pi-ai 目录 model.api（单一真源）：
//   openai-completions/responses → {baseUrl}/models + Bearer（legacy 3 项逐字不变）
//   anthropic-messages           → {baseUrl}/v1/models + x-api-key + anthropic-version
//   mistral-conversations        → {baseUrl}/v1/models + Bearer
//   google-generative-ai         → {baseUrl}/models?key=<key>（人签安全边界）
//   baseUrl 缺失（7 项）          → E-TEST-UNSUPPORTED，不发请求
//
// seam：POST /api/settings/agent/test-connection（settings 路由，真实 server harness +
// mock 全局 fetch 拦截供应商最小校验请求，参考 agentConfig.test.js 模式）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// mock 全局 fetch：拦截供应商校验请求（捕获 URL/全量请求头、按剧本响应），测试 harness
// 自身的 API 调用（127.0.0.1）放行 originalFetch。calls 记录 {url, headers} 供断言。
function mockProviderFetch(script) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.startsWith("http://127.0.0.1") || urlStr.startsWith("http://localhost")) {
      return originalFetch(url, init);
    }
    calls.push({ url: urlStr, headers: init?.headers ?? {} });
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

describe("REQ-AGENT-103 test-connection 全量 provider（v0.7 / BUG-001+002）", () => {
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

  it("标准 1：kimi-coding（anthropic 族）→ baseUrl+/v1/models + x-api-key/anthropic-version，200 → ok:true", async () => {
    const mock = mockProviderFetch(() => new Response("{}", { status: 200 }));
    try {
      const { status, body } = await postTestConnection(baseUrl, { provider: "kimi-coding", apiKey: "sk-kc-1" });
      assert.equal(status, 200);
      assert.equal(body.ok, true, `供应商 200 应 ok:true，实际: ${JSON.stringify(body)}`);
      assert.equal(mock.calls.length, 1, "应恰好发 1 次供应商校验请求");
      assert.equal(mock.calls[0].url, "https://api.kimi.com/coding/v1/models", "anthropic 族端点 = baseUrl + /v1/models");
      assert.equal(mock.calls[0].headers["x-api-key"], "sk-kc-1", "anthropic 族鉴权 = x-api-key");
      assert.equal(mock.calls[0].headers["anthropic-version"], "2023-06-01");
      assert.equal(mock.calls[0].headers.Authorization ?? mock.calls[0].headers.authorization, undefined, "anthropic 族不带 Bearer");
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
      assert.equal(mock.calls[0].url, "https://api.kimi.com/coding/v1/models");
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

  it("标准 5：legacy 3 项端点逐字不变（openai 族 /models + Bearer）", async () => {
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
        assert.equal(mock.calls.at(-1).headers.Authorization, "Bearer sk-l", `${provider} 应 Bearer 鉴权`);
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

  it("标准 8：协议族分派抽样（openrouter/mistral/google）", async () => {
    const mock = mockProviderFetch(() => new Response("{}", { status: 200 }));
    try {
      // openai 族新放出项：baseUrl + /models + Bearer
      await postTestConnection(baseUrl, { provider: "openrouter", apiKey: "sk-or" });
      assert.equal(mock.calls.at(-1).url, "https://openrouter.ai/api/v1/models");
      assert.equal(mock.calls.at(-1).headers.Authorization, "Bearer sk-or");

      // mistral 族：baseUrl + /v1/models + Bearer
      await postTestConnection(baseUrl, { provider: "mistral", apiKey: "sk-mi" });
      assert.equal(mock.calls.at(-1).url, "https://api.mistral.ai/v1/models");
      assert.equal(mock.calls.at(-1).headers.Authorization, "Bearer sk-mi");

      // google 族：baseUrl（含 v1beta）+ /models?key=<key>（人签安全边界：key 进 URL）
      await postTestConnection(baseUrl, { provider: "google", apiKey: "sk-go" });
      assert.equal(mock.calls.at(-1).url, "https://generativelanguage.googleapis.com/v1beta/models?key=sk-go");
      assert.equal(mock.calls.at(-1).headers.Authorization, undefined, "google 不带 Bearer（key 在 URL）");
    } finally {
      mock.restore();
    }
  });
});
