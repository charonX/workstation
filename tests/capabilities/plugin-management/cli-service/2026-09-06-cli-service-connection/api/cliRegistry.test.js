// REQ-TRACE: 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-001
// REQ-VERSION: v1-hash:1f616dc91b7e8d80569503c5ce12f190ddf066f699394496ea8a815e61593119
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: cli-service
// EXPECTED-TRACE: prd.md §6.3 块 1, §10.2
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-06 assertion signoff, 见 signoff.md)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

async function loadRegistry() {
  const mod = await import("../../../../../../src/services/cliRegistry.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/cliRegistry.js 尚未实现（REQ-CLI-SERVICE-001）");
  assert.equal(typeof mod.getRegistry, "function", "导出 getRegistry 函数");
  assert.equal(typeof mod.findRegistryItem, "function", "导出 findRegistryItem 函数");
  return mod;
}

describe("REQ-CLI-SERVICE-001 内置 CLI 清单注册表与数据结构", () => {
  it("清单恰好包含 2 个条目，顺序固定为 claude, codex", async () => {
    const { getRegistry } = await loadRegistry();
    const registry = getRegistry();

    // EXPECTED-TRACE: prd.md §6.3 块 1
    assert.equal(Array.isArray(registry), true, "registry 必须为数组");
    assert.equal(registry.length, 2, "首批清单恰好 2 个条目");
    assert.deepEqual(
      registry.map((item) => item.id),
      ["claude", "codex"],
      "id 顺序必须固定为 claude, codex"
    );
  });

  it("每个条目具有完整且合法的字段结构", async () => {
    const { getRegistry } = await loadRegistry();
    const registry = getRegistry();

    const requiredFields = [
      "id",
      "displayName",
      "command",
      "versionArgs",
      "versionRegex",
      "channel",
      "package",
      "installHint",
      "builtinSkillSlug",
    ];

    for (const item of registry) {
      for (const field of requiredFields) {
        assert.ok(item[field] !== undefined && item[field] !== null, `条目 ${item.id} 缺少字段 ${field}`);
      }
      assert.ok(Array.isArray(item.versionArgs), `条目 ${item.id} versionArgs 必须为数组`);
      assert.ok(["npm", "pypi"].includes(item.channel), `条目 ${item.id} channel 必须为 npm 或 pypi`);
    }
  });

  it("claude 条目精确匹配预期规范", async () => {
    const { findRegistryItem } = await loadRegistry();
    const claude = findRegistryItem("claude");

    // EXPECTED-TRACE: prd.md §6.3 块 1
    assert.ok(claude, "可查询到 claude 条目");
    assert.equal(claude.id, "claude");
    assert.equal(claude.command, "claude");
    assert.deepEqual(claude.versionArgs, ["--version"]);
    assert.equal(claude.channel, "npm");
    assert.equal(claude.package, "@anthropic-ai/claude-code");
    assert.equal(claude.builtinSkillSlug, "cli-claude");
  });

  it("codex 条目精确匹配预期规范", async () => {
    const { findRegistryItem } = await loadRegistry();
    const codex = findRegistryItem("codex");

    // EXPECTED-TRACE: prd.md §6.3 块 1
    assert.ok(codex, "可查询到 codex 条目");
    assert.equal(codex.id, "codex");
    assert.equal(codex.command, "codex");
    assert.deepEqual(codex.versionArgs, ["--version"]);
    assert.equal(codex.channel, "npm");
    assert.equal(codex.package, "@openai/codex");
    assert.equal(codex.builtinSkillSlug, "cli-codex");
  });

  it("findRegistryItem 对未知 id 返回 null", async () => {
    const { findRegistryItem } = await loadRegistry();
    assert.equal(findRegistryItem("nonexistent-cli"), null);
  });
});
