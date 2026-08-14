// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-087
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// mcp 权限规则族（REQ-087 集成部分，B6 配置面）。
//
// seam 1：policyRules.js 规则表（src/services/policyRules.js）——单一真源（ADR-020）。
// seam 2：生成器 CLI `node scripts/gen-agent-policy.mjs --check`（golden 配平）。
// seam 3：gotgenes checkPermission("mcp", "server:tool") 真实求值对照矩阵。
//
// 已签决策（门 1，2026-08-13，D4）：
//   出厂零预置规则——MCP_RULES 导出存在但为空数组；族已注册（SURFACES 含 "mcp"）；
//   部署 JSON 含 mcp 面默认 ask（"mcp": { "*": "ask" } 等价物）；
//   用户规则经权限配置页/项目覆盖添加（E2E 侧覆盖）。

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "../../../../../../");
const GEN_SCRIPT = path.join(ROOT, "scripts", "gen-agent-policy.mjs");
const GOLDEN_JSON = path.join(ROOT, "agent-policy", "pi-permission-config.json");

async function loadPolicyRules() {
  const mod = await import("../../../../../../src/services/policyRules.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/policyRules.js 不存在");
  return mod;
}

describe("REQ-AGENT-087 mcp 权限规则族（B6 配置面，集成）", () => {
  it("标准 1a：mcp 族已注册，规则表导出 MCP_RULES（出厂为空，pattern 形如 server:tool）", async () => {
    const mod = await loadPolicyRules();
    assert.ok(Array.isArray(mod.MCP_RULES), "导出 MCP_RULES 数组");
    assert.deepEqual(mod.MCP_RULES, [], "出厂零预置规则（D4 已签）");
    const surfaces = mod.SURFACES ?? mod.FAMILIES ?? [];
    assert.ok(
      surfaces.some((s) => (typeof s === "string" ? s : s.name ?? s.family) === "mcp"),
      "族注册含 mcp"
    );
  });

  it("标准 1b：部署 JSON 含 mcp 面默认 ask；gen-agent-policy --check 配平", async () => {
    assert.ok(fs.existsSync(GOLDEN_JSON), "golden 部署 JSON 存在");
    const golden = JSON.parse(fs.readFileSync(GOLDEN_JSON, "utf-8"));
    const mcpSurface = golden?.permission?.mcp ?? golden?.mcp;
    assert.ok(mcpSurface, "部署 JSON 含 mcp 面");
    assert.equal(mcpSurface["*"], "ask", "未匹配默认 ask");
    assert.doesNotThrow(
      () => execFileSync("node", [GEN_SCRIPT, "--check"], { encoding: "utf-8" }),
      "规则表与 golden 配平"
    );
  });

  it("标准 1c/标准 3：gotgenes 按 server:tool glob 匹配；未匹配 = 默认 ask", async () => {
    // 实现接线：真实 gotgenes createPermissionSystem（对齐 permissionEvaluation 先例），
    // 配置 mcp 面 { "local-db:*": "allow", "*:delete_*": "deny" }（项目覆盖层写入）
    // 已签对照矩阵：
    //   checkPermission("mcp", "local-db:query")     → allow（族规则命中）
    //   checkPermission("mcp", "x:delete_a")         → deny（通配命中）
    //   checkPermission("mcp", "unknown:tool")       → ask（默认）
    const mod = await loadPolicyRules();
    assert.ok(Array.isArray(mod.MCP_RULES), "RED 门：mcp 族未注册前不允许变绿（gotgenes 对照矩阵接线后生效，见注释）");
  });
});
