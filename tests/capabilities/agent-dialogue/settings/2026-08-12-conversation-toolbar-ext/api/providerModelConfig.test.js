// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-090, 2026-08-12-conversation-toolbar-ext/REQ-AGENT-092, 2026-08-12-conversation-toolbar-ext/REQ-AGENT-099, 2026-08-12-conversation-toolbar-ext/REQ-AGENT-104
// REQ-VERSION: v5-hash:98fd8e7b5e422ebb499f737b00421a4db397895794664dd5e6bfea1c492398a2
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 多 provider 配置列表（REQ-AGENT-090 数据模型/迁移）、动态模型列表（REQ-AGENT-092）、
// 默认模型刷新（REQ-AGENT-099）。
//
// seam 1：GET/PUT /api/settings/agent（新形态
//   {identity, providers:[{provider, models[], configured}], defaultModel}）。
// seam 2：modelCatalogService（BUILD 产物，动态 import，RED 失败而非 import 崩溃）——
//   src/services/modelCatalogService.js 导出 fetchModels(provider, apiKey)。
// seam 3：DEFAULT_MODELS 常量（agentService 导出）+ pi-ai 静态目录（真实）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const HASH = "ff3ce6c28851eddb44986c153881ae32c5547116942bab700427cfca94e46514";

describe("REQ-AGENT-090 多 provider 配置列表 + 存量迁移（B1）", () => {
  let workdir;
  let server;
  let baseUrl;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "providers-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    process.env.DB_PATH = path.join(workdir, "data.db");
    // 存量旧格式（迁移输入）：单条 agent.provider + apiKeyEncrypted
    fs.writeFileSync(
      path.join(workdir, "settings.json"),
      JSON.stringify({
        agent: { provider: "moonshotai", apiKeyEncrypted: "ENC:legacy", identity: "测试身份", configured: true },
      }),
      "utf8"
    );
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    delete process.env.DB_PATH;
  });

  it("存量单条配置自动迁移为第一条 + 默认组合（identity 保留）", async () => {
    const res = await fetch(`${baseUrl}/api/settings/agent`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.providers.length, 1);
    assert.equal(body.providers[0].provider, "moonshotai");
    assert.deepEqual(body.providers[0].models, ["kimi-k3"]); // DEFAULT_MODELS.moonshotai（REQ-AGENT-099）
    assert.deepEqual(body.defaultModel, { provider: "moonshotai", model: "kimi-k3" });
    assert.equal(body.identity, "测试身份");
    assert.equal(body.providers[0].configured, true);
  });

  it("迁移失败（settings 损坏）→ 空列表 + 提示 + 原文件不动", async () => {
    fs.writeFileSync(path.join(workdir, "settings.json"), "{broken json", "utf8");
    const res = await fetch(`${baseUrl}/api/settings/agent`);
    const body = await res.json();
    // E13：迁移失败不破坏原文件；GET 回落空列表（可配态由 UI 引导）
    assert.equal(res.status, 200);
    assert.deepEqual(body.providers, []);
    assert.equal(fs.readFileSync(path.join(workdir, "settings.json"), "utf8"), "{broken json"); // 原文件未被覆盖
  });

  it("新增条目校验：models 非空且模型来自拉取结果/内置目录", async () => {
    const res = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "",
        providers: [{ provider: "deepseek", apiKey: "sk-x", models: [] }], // models 空 → 应拒绝
        defaultModel: { provider: "deepseek", model: "deepseek-v4-flash" },
      }),
    });
    // E1：models 空 → 400（字段级校验）
    assert.equal(res.status, 400);

    const res2 = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "",
        providers: [{ provider: "deepseek", apiKey: "sk-x", models: ["not-a-real-model"] }], // 不在真实列表 → 应拒绝
        defaultModel: { provider: "deepseek", model: "not-a-real-model" },
      }),
    });
    // E9：模型不在真实列表（pi-ai 目录/拉取结果）→ 400
    assert.equal(res2.status, 400);
  });

  it("默认组合唯一（新增首个条目自动指向；删除默认条目自动重定向）", async () => {
    // 空列表 → 新增首个条目（无 defaultModel）→ 默认自动指向首个组合
    const r1 = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "",
        providers: [{ provider: "deepseek", apiKey: "sk-x", models: ["deepseek-v4-flash"] }],
      }),
    });
    assert.equal(r1.status, 200);
    const b1 = await (await fetch(`${baseUrl}/api/settings/agent`)).json();
    assert.deepEqual(b1.defaultModel, { provider: "deepseek", model: "deepseek-v4-flash" });

    // 删除全部条目 → defaultModel 为 null（UI 禁用态）
    const r2 = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: "", providers: [], defaultModel: null }),
    });
    assert.equal(r2.status, 200);
    const b2 = await (await fetch(`${baseUrl}/api/settings/agent`)).json();
    assert.equal(b2.defaultModel, null);
  });

  it("apiKey 加密落盘 0o600；GET 不回传明文", async () => {
    await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "",
        providers: [{ provider: "deepseek", apiKey: "sk-plain-secret-090", models: ["deepseek-v4-flash"] }],
        defaultModel: { provider: "deepseek", model: "deepseek-v4-flash" },
      }),
    });
    const raw = fs.readFileSync(path.join(workdir, "settings.json"), "utf8");
    assert.ok(!raw.includes("sk-plain-secret-090"), "明文 key 不得落盘");
    assert.equal(fs.statSync(path.join(workdir, "settings.json")).mode & 0o777, 0o600);
    const body = await (await fetch(`${baseUrl}/api/settings/agent`)).json();
    assert.ok(!JSON.stringify(body).includes("sk-plain-secret-090"), "GET 不回传明文");
  });

  it("key 成对规则：新增条目缺 key → 400；已有条目不重填 → 复用密文", async () => {
    // 先 PUT 一个条目（含 key）
    const r1 = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "",
        providers: [{ provider: "deepseek", apiKey: "sk-pair-1", models: ["deepseek-v4-flash"] }],
        defaultModel: { provider: "deepseek", model: "deepseek-v4-flash" },
      }),
    });
    assert.equal(r1.status, 200);
    const enc1 = JSON.parse(fs.readFileSync(path.join(workdir, "settings.json"), "utf8")).agent.providers[0].apiKeyEncrypted;
    assert.ok(typeof enc1 === "string" && enc1.length > 0, "key 应加密落盘");

    // 编辑已有条目（同 provider，不重填 key）→ 200 + 密文不变（keepExistingKey）
    const r2 = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "",
        providers: [{ provider: "deepseek", models: ["deepseek-v4-pro"] }],
        defaultModel: { provider: "deepseek", model: "deepseek-v4-pro" },
      }),
    });
    assert.equal(r2.status, 200);
    const enc2 = JSON.parse(fs.readFileSync(path.join(workdir, "settings.json"), "utf8")).agent.providers[0].apiKeyEncrypted;
    assert.equal(enc2, enc1, "未重填 key 时应复用密文");

    // 新增条目（provider 不在现有列表）缺 key → 400
    const r3 = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "",
        providers: [
          { provider: "deepseek", models: ["deepseek-v4-pro"] },
          { provider: "moonshotai", models: ["kimi-k3"] }, // 新增无 key
        ],
        defaultModel: { provider: "deepseek", model: "deepseek-v4-pro" },
      }),
    });
    assert.equal(r3.status, 400);
  });

  it("删除默认条目 → 默认重定向剩余条目首个组合", async () => {
    await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "",
        providers: [
          { provider: "deepseek", apiKey: "sk-d", models: ["deepseek-v4-flash"] },
          { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3", "kimi-k2.6"] },
        ],
        defaultModel: { provider: "deepseek", model: "deepseek-v4-flash" },
      }),
    });
    // 删除默认条目（deepseek）→ defaultModel 重定向到剩余条目（moonshotai）首个模型
    const r2 = await fetch(`${baseUrl}/api/settings/agent`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: "",
        providers: [{ provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3", "kimi-k2.6"] }],
      }),
    });
    assert.equal(r2.status, 200);
    const b = await (await fetch(`${baseUrl}/api/settings/agent`)).json();
    assert.deepEqual(b.defaultModel, { provider: "moonshotai", model: "kimi-k3" });
  });
});

describe("REQ-AGENT-092 动态模型列表（B2）", () => {
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "models-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
  });

  async function loadCatalog() {
    const mod = await import("../../../../../../src/services/modelCatalogService.js").catch(() => null);
    assert.ok(mod, "seam 未就绪：src/services/modelCatalogService.js 尚未实现（REQ-AGENT-092）");
    return mod;
  }

  it("kimi provider：/v1/models 能力标志直存", async () => {
    const { fetchModels } = await loadCatalog();
    const globalFetch = global.fetch;
    global.fetch = async (url) => ({
      ok: true,
      json: async () => ({
        object: "list",
        data: [
          { id: "kimi-k3", object: "model", context_length: 1048576, supports_image_in: true, supports_reasoning: true },
        ],
      }),
    });
    try {
      const out = await fetchModels("moonshotai", "sk-x");
      // kimi 能力标志直存：{model, vision, reasoning}
      assert.deepEqual(out, [{ model: "kimi-k3", vision: true, reasoning: true }]);
    } finally {
      global.fetch = globalFetch;
    }
  });

  it("deepseek provider：/models 仅 id → 内置能力表补全（vision=false）", async () => {
    const { fetchModels } = await loadCatalog();
    const globalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ object: "list", data: [{ id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" }] }),
    });
    try {
      const out = await fetchModels("deepseek", "sk-x");
      // deepseek 能力硬编码补全（pi-ai 目录实证：全系 text-only，reasoning=true）
      assert.deepEqual(out, [{ model: "deepseek-v4-flash", vision: false, reasoning: true }]);
    } finally {
      global.fetch = globalFetch;
    }
  });

  it("拉取失败 → 回退 pi-ai 内置目录 + 错误标记", async () => {
    const { fetchModels } = await loadCatalog();
    const globalFetch = global.fetch;
    global.fetch = async () => { throw new Error("network down"); };
    try {
      const out = await fetchModels("moonshotai", "sk-x");
      // E3：失败回退内置目录（pi-ai 静态目录实证 moonshotai ≥2 模型）+ fallback 标记
      assert.equal(out.fallback, true);
      assert.ok(out.models.length >= 2);
      assert.ok(out.models.every((m) => typeof m.model === "string"));
    } finally {
      global.fetch = globalFetch;
    }
  });

  it("无 apiKey → 不拉取直接回退内置目录", async () => {
    const { fetchModels } = await loadCatalog();
    let called = false;
    const globalFetch = global.fetch;
    global.fetch = async () => { called = true; return { ok: true, json: async () => ({ data: [] }) }; };
    try {
      const out = await fetchModels("deepseek", "");
      // E2：无 key 不发网络请求
      assert.equal(called, false);
      assert.equal(out.fallback, true);
    } finally {
      global.fetch = globalFetch;
    }
  });

  it("拉取返回空列表 → 回退内置目录 + fallback 标记", async () => {
    const { fetchModels } = await loadCatalog();
    const globalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ object: "list", data: [] }) });
    try {
      const out = await fetchModels("deepseek", "sk-x");
      // E3 变体：供应商返回空列表（非网络失败）同样回退，不返回空数组
      assert.equal(out.fallback, true);
      assert.ok(out.models.length >= 1, "回退内置目录非空");
    } finally {
      global.fetch = globalFetch;
    }
  });

  it("拉取结果含目录不可解析 id → 剔除（BUG-004 防御）", async () => {
    const { fetchModels } = await loadCatalog();
    const globalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        object: "list",
        data: [
          { id: "kimi-k3", object: "model", supports_image_in: true, supports_reasoning: true },
          { id: "not-a-real-kimi-model", object: "model", supports_image_in: false, supports_reasoning: false },
        ],
      }),
    });
    try {
      const out = await fetchModels("moonshotai", "sk-x");
      // AC5：目录不可解析 id 剔除，输出只含真实模型（BUG-004 教训）
      assert.deepEqual(out, [{ model: "kimi-k3", vision: true, reasoning: true }]);
    } finally {
      global.fetch = globalFetch;
    }
  });
});

// REQ-AGENT-104（v0.7 / BUG-002 req-gap 补全）：动态拉取全协议族化——端点/鉴权与
// REQ-103 同一派生源；响应解析按族分派；能力标志 = 供应商直存（带能力字段时）或
// pi-ai 目录补全（deepseek 模式泛化）；E2/E3 兜底语义不变。
describe("REQ-AGENT-104 动态模型拉取全协议族化", () => {
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "models104-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
  });

  async function loadCatalog() {
    const mod = await import("../../../../../../src/services/modelCatalogService.js").catch(() => null);
    assert.ok(mod, "seam 未就绪：src/services/modelCatalogService.js 未导出 fetchModels（REQ-AGENT-104）");
    return mod;
  }

  it("标准 1：kimi-coding（anthropic 族）→ /v1/models + x-api-key，anthropic 格式解析 + 目录补能力", async () => {
    const { fetchModels } = await loadCatalog();
    const calls = [];
    const globalFetch = global.fetch;
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      return {
        ok: true,
        json: async () => ({ data: [{ id: "k3", display_name: "K3", type: "model" }, { id: "kimi-for-coding", type: "model" }] }),
      };
    };
    try {
      const out = await fetchModels("kimi-coding", "sk-kc");
      assert.equal(calls[0].url, "https://api.kimi.com/coding/v1/models");
      assert.equal(calls[0].headers["x-api-key"], "sk-kc");
      // anthropic 格式无能力字段 → pi-ai 目录补全（k3 目录值 vision/reasoning 均 true）
      assert.deepEqual(out, [
        { model: "k3", vision: true, reasoning: true },
        { model: "kimi-for-coding", vision: true, reasoning: true },
      ]);
    } finally {
      global.fetch = globalFetch;
    }
  });

  it("标准 2：google（google-generative-ai 族）→ /v1beta/models?key=，剥 models/ 前缀 + 目录补能力", async () => {
    const { fetchModels } = await loadCatalog();
    const calls = [];
    const globalFetch = global.fetch;
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      return {
        ok: true,
        json: async () => ({ models: [{ name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] }] }),
      };
    };
    try {
      const out = await fetchModels("google", "sk-go");
      assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models?key=sk-go");
      // 目录值（gemini-2.0-flash：vision=true reasoning=false）
      assert.deepEqual(out, [{ model: "gemini-2.0-flash", vision: true, reasoning: false }]);
    } finally {
      global.fetch = globalFetch;
    }
  });

  it("标准 3：openrouter（openai 族新放出项）→ /models + Bearer，仅 id → 目录补能力", async () => {
    const { fetchModels } = await loadCatalog();
    const calls = [];
    const globalFetch = global.fetch;
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      return { ok: true, json: async () => ({ data: [{ id: "ai21/jamba-large-1.7" }] }) };
    };
    try {
      const out = await fetchModels("openrouter", "sk-or");
      assert.equal(calls[0].url, "https://openrouter.ai/api/v1/models");
      assert.equal(calls[0].headers.Authorization, "Bearer sk-or");
      // 目录值（ai21/jamba-large-1.7：vision=false reasoning=false）
      assert.deepEqual(out, [{ model: "ai21/jamba-large-1.7", vision: false, reasoning: false }]);
    } finally {
      global.fetch = globalFetch;
    }
  });

  it("标准 7：amazon-bedrock（baseUrl 缺失）→ 直接兜底，不发网络请求", async () => {
    const { fetchModels } = await loadCatalog();
    let called = 0;
    const globalFetch = global.fetch;
    global.fetch = async () => { called++; return { ok: true, json: async () => ({ data: [] }) }; };
    try {
      const out = await fetchModels("amazon-bedrock", "sk-br");
      assert.equal(called, 0, "baseUrl 缺失不得发网络请求");
      assert.equal(out.fallback, true);
      assert.ok(out.models.length >= 1, "兜底 = 内置目录非空");
    } finally {
      global.fetch = globalFetch;
    }
  });
});

describe("REQ-AGENT-099 默认模型刷新（B8）", () => {
  let workdir;
  let server;
  let baseUrl;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "default-model-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    process.env.DB_PATH = path.join(workdir, "data.db");
    // 旧格式 moonshotai 单条（迁移输入）
    fs.writeFileSync(
      path.join(workdir, "settings.json"),
      JSON.stringify({ agent: { provider: "moonshotai", apiKeyEncrypted: "ENC:legacy", identity: "", configured: true } }),
      "utf8"
    );
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    delete process.env.DB_PATH;
  });

  it("DEFAULT_MODELS.moonshotai === kimi-k3（非日落模型 k2.5）", async () => {
    const mod = await import("../../../../../../src/services/agentService.js").catch(() => null);
    assert.ok(mod, "seam 未就绪：src/services/agentService.js 未导出 DEFAULT_MODELS（REQ-AGENT-099）");
    // B8 人拍板：k2.5 2026-08-31 日落 → 默认换在售旗舰 kimi-k3
    assert.equal(mod.DEFAULT_MODELS.moonshotai, "kimi-k3");
  });

  it("DEFAULT_MODELS 全部值在 pi-ai 静态目录可解析（真实目录）", async () => {
    const { getBuiltinModel } = await import("@earendil-works/pi-ai/providers/all");
    const agentMod = await import("../../../../../../src/services/agentService.js").catch(() => null);
    assert.ok(agentMod, "seam 未就绪：agentService 未导出 DEFAULT_MODELS");
    // BUG-004 教训：默认模型必须真实存在于运行时目录（deepseek 系 / kimi 系）；
    // faux 为测试 seam 不在静态目录（agentDefaultModel.test.js 先例跳过）
    for (const [provider, model] of Object.entries(agentMod.DEFAULT_MODELS)) {
      if (provider === "faux") continue;
      assert.ok(getBuiltinModel(provider, model), `${provider}/${model} 不在 pi-ai 目录`);
    }
  });

  it("存量迁移产物 models[0] = DEFAULT_MODELS[provider]（kimi-k3 而非 k2.5）", async () => {
    // 与 REQ-090 迁移标准 1 同一链路，这里显式断言 models[0] 不指向日落模型
    const res = await fetch(`${baseUrl}/api/settings/agent`);
    const body = await res.json();
    assert.equal(body.providers[0].models[0], "kimi-k3");
    assert.ok(!body.providers[0].models.includes("kimi-k2.5"), "迁移不得指向日落模型");
  });
});
