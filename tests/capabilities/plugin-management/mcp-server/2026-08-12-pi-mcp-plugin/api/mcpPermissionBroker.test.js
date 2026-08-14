// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-086
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// MCP 权限 broker 接线（REQ-086，B6 核心）。
//
// seam：src/agent/mcpBrokerLink.js（BUILD 产物，动态 import）。
//
// 已签契约（门 1，2026-08-13，D3 同批）：
//   createMcpBrokerLink({ checkPermission, askConfirmation, mode, decide?, reviewLog? })
//     → async handleApproval(payload, claim)
//   payload = { serverName, originalToolName, args, origin }（桥 broker 事件载荷）
//   checkPermission(surface, value)：gotgenes 求值——本 link 恒以
//     ("mcp", "<serverName>:<originalToolName>") 调用。
//   裁决映射：allow→claim("allow_once")；deny→claim("deny")+reason；
//     ask→askConfirmation(payload)→人裁决（auto 模式先过 decide，defer 才弹卡）。
//     一期不返回 "allow_for_session"；任何异常/无人 claim → fail-closed（claim("deny")）。
//   reviewLog(record)：每次裁决落痕，record 含 serverName/tool/verdict。
//
// 端到端「server 是否收到调用」由 REQ-085 的 fixture 调用日志断言点复用（E2E/集成驱动时接线）。

import { describe, it } from "node:test";
import assert from "node:assert/strict";

async function loadBrokerLink() {
  const mod = await import("../../../../../../src/agent/mcpBrokerLink.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/mcpBrokerLink.js 尚未实现（REQ-AGENT-086）");
  assert.equal(typeof mod.createMcpBrokerLink, "function", "导出 createMcpBrokerLink");
  return mod;
}

function makeHarness({ verdict, mode = "standard", decide, humanAnswer = "allow" } = {}) {
  const calls = { permissions: [], confirmations: [], claims: [], log: [] };
  const link = null; // 由各用例 createMcpBrokerLink 生成后填入
  const deps = {
    checkPermission: (surface, value) => {
      calls.permissions.push([surface, value]);
      return verdict ?? "ask";
    },
    askConfirmation: async (payload) => {
      calls.confirmations.push(payload);
      return humanAnswer;
    },
    mode,
    decide,
    reviewLog: (record) => calls.log.push(record),
  };
  const claim = async (fn) => {
    const result = await fn();
    calls.claims.push(result);
    return result;
  };
  return { calls, deps, claim };
}

const PAYLOAD = { serverName: "local-db", originalToolName: "fixture_ping", args: { text: "hi" }, origin: "agent" };

describe("REQ-AGENT-086 MCP 权限 broker 接线（B6）", () => {
  it("标准 1：规则 allow → claim('allow_once')，无确认卡", async () => {
    const { createMcpBrokerLink } = await loadBrokerLink();
    const h = makeHarness({ verdict: "allow" });
    const link = createMcpBrokerLink(h.deps);
    await link.handleApproval(PAYLOAD, h.claim);
    assert.deepEqual(h.calls.permissions, [["mcp", "local-db:fixture_ping"]], "以 server:tool 求值");
    assert.deepEqual(h.calls.claims, ["allow_once"]);
    assert.equal(h.calls.confirmations.length, 0, "无确认卡");
  });

  it("标准 2：未配置（默认 ask）→ 确认卡；确认 → allow_once；拒绝 → deny", async () => {
    const { createMcpBrokerLink } = await loadBrokerLink();
    const yes = makeHarness({ verdict: "ask", humanAnswer: "allow" });
    await createMcpBrokerLink(yes.deps).handleApproval(PAYLOAD, yes.claim);
    assert.equal(yes.calls.confirmations.length, 1, "弹确认卡");
    assert.deepEqual(yes.calls.claims, ["allow_once"]);

    const no = makeHarness({ verdict: "ask", humanAnswer: "deny" });
    await createMcpBrokerLink(no.deps).handleApproval(PAYLOAD, no.claim);
    assert.deepEqual(no.calls.claims, ["deny"], "拒绝 → deny（reason 回 agent）");
  });

  it("标准 3：规则 deny → 不弹卡，claim('deny') 带 reason", async () => {
    const { createMcpBrokerLink } = await loadBrokerLink();
    const h = makeHarness({ verdict: "deny" });
    await createMcpBrokerLink(h.deps).handleApproval(PAYLOAD, h.claim);
    assert.equal(h.calls.confirmations.length, 0, "不弹卡");
    assert.deepEqual(h.calls.claims, ["deny"]);
  });

  it("标准 4：strict 模式——即使规则 allow 也弹卡", async () => {
    const { createMcpBrokerLink } = await loadBrokerLink();
    const h = makeHarness({ verdict: "allow", mode: "strict" });
    await createMcpBrokerLink(h.deps).handleApproval(PAYLOAD, h.claim);
    assert.equal(h.calls.confirmations.length, 1, "strict 下仍弹卡");
  });

  it("标准 5：auto 模式——模型 link 三路径（allow/deny/defer）", async () => {
    const { createMcpBrokerLink } = await loadBrokerLink();

    const allow = makeHarness({ verdict: "ask", mode: "auto", decide: () => ({ kind: "allow" }) });
    await createMcpBrokerLink(allow.deps).handleApproval(PAYLOAD, allow.claim);
    assert.deepEqual(allow.calls.claims, ["allow_once"]);
    assert.equal(allow.calls.confirmations.length, 0, "判安全直放");

    const deny = makeHarness({ verdict: "ask", mode: "auto", decide: () => ({ kind: "deny", reason: "危险操作" }) });
    await createMcpBrokerLink(deny.deps).handleApproval(PAYLOAD, deny.claim);
    assert.deepEqual(deny.calls.claims, ["deny"]);

    const defer = makeHarness({ verdict: "ask", mode: "auto", decide: () => ({ kind: "defer" }) });
    await createMcpBrokerLink(defer.deps).handleApproval(PAYLOAD, defer.claim);
    assert.equal(defer.calls.confirmations.length, 1, "defer 才弹卡");
  });

  it("标准 6：claim 内异常 → fail-closed（deny），不抛出", async () => {
    const { createMcpBrokerLink } = await loadBrokerLink();
    const h = makeHarness({ verdict: "ask", humanAnswer: "allow" });
    h.deps.askConfirmation = async () => { throw new Error("queue down"); };
    const link = createMcpBrokerLink(h.deps);
    await assert.doesNotReject(() => link.handleApproval(PAYLOAD, h.claim));
    assert.deepEqual(h.calls.claims, ["deny"], "异常 fail-closed");
  });

  it("标准 7：每次裁决落 review log（含 serverName/tool/verdict）", async () => {
    const { createMcpBrokerLink } = await loadBrokerLink();
    const h = makeHarness({ verdict: "allow" });
    await createMcpBrokerLink(h.deps).handleApproval(PAYLOAD, h.claim);
    assert.equal(h.calls.log.length, 1);
    const rec = h.calls.log[0];
    assert.equal(rec.serverName, "local-db");
    assert.equal(rec.tool, "fixture_ping");
    assert.equal(rec.verdict, "allow_once");
  });
});
