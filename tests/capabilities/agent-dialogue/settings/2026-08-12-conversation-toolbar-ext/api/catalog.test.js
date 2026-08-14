// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-100
// REQ-VERSION: v3-hash:253ff44240a7dc1db95967cead3d95ed990ef61c7c4b8f8654fd146cdc93c005
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// catalog 端点（REQ-AGENT-100，v0.6）：GET /api/settings/agent/catalog →
// {providers: [{provider, displayName, defaultModel, models: [{model, vision, reasoning}]}]}
// 37 个 apiKey 型静态 provider（排除 OAuth 型 openai-codex/github-copilot 与 faux）；
// 数据源 = pi-ai 静态目录（单一真源）；defaultModel = 目录首项；vision = input.includes("image")。
//
// seam 1：GET /api/settings/agent/catalog（settings 路由）。
// seam 2：modelCatalogService.listCatalog()（BUILD 产物，动态 import，RED 失败而非崩溃）——
//   与 @earendil-works/pi-ai/providers/all 的 getBuiltinModels 逐项一致。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// OAuth 型（须排除）与测试 seam（须排除）
const EXCLUDED = new Set(["openai-codex", "github-copilot", "faux"]);
// 新放出项的抽样（须包含）
const MUST_INCLUDE = ["openrouter", "anthropic", "groq", "google", "xai", "openai", "mistral", "together", "fireworks", "nvidia"];

describe("REQ-AGENT-100 catalog 端点（v0.6）", () => {
  let workdir;
  let server;
  let baseUrl;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    process.env.DB_PATH = path.join(workdir, "data.db");
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    delete process.env.DB_PATH;
  });

  async function loadCatalogSeam() {
    const mod = await import("../../../../../../src/services/modelCatalogService.js").catch(() => null);
    assert.ok(mod, "seam 未就绪：src/services/modelCatalogService.js 未导出 listCatalog（REQ-AGENT-100）");
    return mod;
  }

  it("标准 1：包含新放出项 + 排除 OAuth 型与 faux", async () => {
    const res = await fetch(`${baseUrl}/api/settings/agent/catalog`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const providers = body.providers.map((p) => p.provider);
    for (const want of MUST_INCLUDE) {
      assert.ok(providers.includes(want), `catalog 应包含 ${want}`);
    }
    for (const bad of EXCLUDED) {
      assert.ok(!providers.includes(bad), `catalog 不得包含 ${bad}`);
    }
    assert.ok(providers.length >= 30, `apiKey 型 provider 应 ≥30，实际 ${providers.length}`);
  });

  it("标准 2：每个 provider ≥1 模型且带能力标志", async () => {
    const body = await (await fetch(`${baseUrl}/api/settings/agent/catalog`)).json();
    for (const p of body.providers) {
      assert.ok(Array.isArray(p.models) && p.models.length >= 1, `${p.provider} 应至少 1 个模型`);
      for (const m of p.models) {
        assert.equal(typeof m.model, "string");
        assert.equal(typeof m.vision, "boolean", `${p.provider}/${m.model} 缺 vision 标志`);
        assert.equal(typeof m.reasoning, "boolean", `${p.provider}/${m.model} 缺 reasoning 标志`);
      }
    }
  });

  it("标准 3：vision 判定与 pi-ai 目录逐项一致（单一真源）", async () => {
    const { listCatalog } = await loadCatalogSeam();
    const { getBuiltinModels } = await import("@earendil-works/pi-ai/providers/all");
    const ours = await listCatalog();
    // 全量对比：对 catalog 中每个 provider，模型集合与能力与 pi-ai 目录一致
    for (const p of ours.providers) {
      const piModels = getBuiltinModels(p.provider);
      const piById = new Map(piModels.map((m) => [m.id, m]));
      for (const m of p.models) {
        const pi = piById.get(m.model);
        assert.ok(pi, `${p.provider}/${m.model} 应在 pi-ai 目录`);
        assert.equal(m.vision, pi.input.includes("image"), `${p.provider}/${m.model} vision 与目录不一致`);
        assert.equal(m.reasoning, Boolean(pi.reasoning), `${p.provider}/${m.model} reasoning 与目录不一致`);
      }
    }
    // 抽样：kimi-k3 视觉、deepseek 全系非视觉
    const moonshot = ours.providers.find((p) => p.provider === "moonshotai");
    assert.equal(moonshot.models.find((m) => m.model === "kimi-k3").vision, true);
    const deepseek = ours.providers.find((p) => p.provider === "deepseek");
    assert.ok(deepseek.models.every((m) => m.vision === false), "deepseek 全系非视觉");
  });

  it("标准 4：defaultModel = 目录首项", async () => {
    const { listCatalog } = await loadCatalogSeam();
    const ours = await listCatalog();
    for (const p of ours.providers) {
      assert.equal(p.defaultModel, p.models[0].model, `${p.provider} defaultModel 应为目录首项`);
      assert.ok(p.models.some((m) => m.model === p.defaultModel));
    }
  });

  it("标准 5：displayName 非空", async () => {
    const body = await (await fetch(`${baseUrl}/api/settings/agent/catalog`)).json();
    for (const p of body.providers) {
      assert.ok(typeof p.displayName === "string" && p.displayName.length > 0, `${p.provider} displayName 非空`);
    }
  });

  it("标准 6：只读幂等（连续两次一致）", async () => {
    const r1 = await (await fetch(`${baseUrl}/api/settings/agent/catalog`)).json();
    const r2 = await (await fetch(`${baseUrl}/api/settings/agent/catalog`)).json();
    assert.deepEqual(r1, r2);
  });
});
