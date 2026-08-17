// REQ-TRACE: 2026-08-16-deepen-session-domain/REQ-AGENT-112
// REQ-VERSION: v2-hash:77f0f186fe65139c162d3db19364b93827432d5424fd502d067f24df71cbb28c
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §6.3 块1 config 锚点（无参→默认组合；行值优先/NULL/条目已删三态）；§10.4 domain 纯函数组契约
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-AGENT-112：sessionDomain 模块新建与 config 装配搬迁。
// buildSessionConfig 从 src/services/sessionDomain.js 导出，签名与语义逐字节保持：
//   buildSessionConfig(spaceKey, store) → {provider, model, apiKey, identity}
// 行值优先（ADR-026 会话级配置）；无参/无行/条目已删 → 默认组合；
// resolved.provider 为空 → 回落 DEFAULT_PROVIDER="deepseek"。
// 集成半（server.js 确认回调回投改向）由既有 assistantConfirm E2E 绿承载（REQ-112 AC4）。
//
// seam：src/services/sessionDomain.js 的 buildSessionConfig（纯装配函数，
// settingsService.resolveSessionModelConfig 单点解析，真实 settings 文件注入）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadDomain() {
  const mod = await import("../../../../../../src/services/sessionDomain.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/sessionDomain.js 尚未实现（REQ-AGENT-112，ADR-030）");
  assert.equal(
    typeof mod.buildSessionConfig,
    "function",
    "sessionDomain.js 应导出 buildSessionConfig(spaceKey, store)"
  );
  return mod;
}

// 真实 settings 文件注入（providerSwitch.test.js 先例：plaintext apiKey fixture，
// entryApiKey 明文兜底语义）。
function seedSettings(workdir, agent) {
  fs.writeFileSync(path.join(workdir, "settings.json"), JSON.stringify({ agent }), "utf8");
}

const PROVIDERS = [
  { provider: "moonshotai", apiKey: "sk-moonshot", models: ["kimi-k3", "kimi-k2.6"] },
  { provider: "deepseek", apiKey: "sk-deepseek", models: ["deepseek-v4-flash"] },
];

describe("REQ-AGENT-112 buildSessionConfig 搬迁保行为", () => {
  let workdir;
  let savedConfigDir;

  beforeEach(() => {
    savedConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "session-domain-cfg-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
  });

  afterEach(() => {
    if (savedConfigDir === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    else process.env.OPC_WORKSTATION_CONFIG_DIR = savedConfigDir;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("AC1 无参/无行调用 → 默认组合（defaultModel 指针组合）", async () => {
    const domain = await loadDomain();
    seedSettings(workdir, { identity: "", providers: PROVIDERS, defaultModel: { provider: "moonshotai", model: "kimi-k3" } });

    // EXPECTED-TRACE: prd.md §6.3 块1——无参调用 → 默认组合
    const cfg = domain.buildSessionConfig(undefined, undefined);
    assert.deepEqual(cfg, {
      provider: "moonshotai",
      model: "kimi-k3",
      apiKey: "sk-moonshot",
      identity: "",
    });

    // store 无行（get 返回 undefined）与无参同语义
    const cfgNoRow = domain.buildSessionConfig("ui:copilot:abc", { get: () => undefined });
    assert.deepEqual(cfgNoRow, cfg);
  });

  it("AC1b 无已配置 providers 时 provider 回落 DEFAULT_PROVIDER=deepseek", async () => {
    const domain = await loadDomain();
    seedSettings(workdir, { identity: "", providers: [], defaultModel: null });

    // EXPECTED-TRACE: prd.md §6.3 块1——resolved.provider 为空 → DEFAULT_PROVIDER 回落
    const cfg = domain.buildSessionConfig(undefined, undefined);
    assert.equal(cfg.provider, "deepseek");
    assert.equal(cfg.model, "");
    assert.equal(cfg.apiKey, undefined);
    assert.equal(cfg.identity, "");
  });

  it("AC2 行值优先：store 行 provider/model 有效 → 按行解析", async () => {
    const domain = await loadDomain();
    seedSettings(workdir, { identity: "", providers: PROVIDERS, defaultModel: { provider: "moonshotai", model: "kimi-k3" } });
    const store = { get: () => ({ provider: "deepseek", model: "deepseek-v4-flash" }) };

    // EXPECTED-TRACE: prd.md §6.3 块1——行值优先
    const cfg = domain.buildSessionConfig("ui:project:p1:s1", store);
    assert.deepEqual(cfg, {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "sk-deepseek",
      identity: "",
    });
  });

  it("AC2 行 NULL 列 → 默认组合（非回落标记路径）", async () => {
    const domain = await loadDomain();
    seedSettings(workdir, { identity: "", providers: PROVIDERS, defaultModel: { provider: "moonshotai", model: "kimi-k3" } });
    const store = { get: () => ({ provider: null, model: null }) };

    // EXPECTED-TRACE: prd.md §6.3 块1——NULL → 默认组合
    const cfg = domain.buildSessionConfig("ui:project:p1:s1", store);
    assert.equal(cfg.provider, "moonshotai");
    assert.equal(cfg.model, "kimi-k3");
  });

  it("AC2 行值条目已删 → 回落默认组合（E12 不悬空）", async () => {
    const domain = await loadDomain();
    seedSettings(workdir, { identity: "", providers: PROVIDERS, defaultModel: { provider: "moonshotai", model: "kimi-k3" } });
    const store = { get: () => ({ provider: "deleted-provider", model: "x" }) };

    // EXPECTED-TRACE: prd.md §6.3 块1——条目已删 → 回落默认
    const cfg = domain.buildSessionConfig("ui:project:p1:s1", store);
    assert.equal(cfg.provider, "moonshotai");
    assert.equal(cfg.model, "kimi-k3");
    assert.equal(cfg.apiKey, "sk-moonshot");
  });
});
