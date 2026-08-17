// REQ-TRACE: 2026-08-16-deepen-session-domain/REQ-AGENT-113
// REQ-VERSION: v2-hash:77f0f186fe65139c162d3db19364b93827432d5424fd502d067f24df71cbb28c
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §6.3 块2 投影/分页锚点（golden 行/工具不落历史/图片标记/降级/limit 归一化/before 游标）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-AGENT-113：历史投影与分页搬迁——projectMessagesFromJsonl / paginateMessages
// 从 sessionDomain.js 直测（不再透 HTTP）。语义逐字节保持：
//   历史 = 对话文本（BUG-009：toolResult 与空文本 assistant 行剔除）；
//   content 数组 image 段 → [图片: name] 标记（REQ-AGENT-097）；
//   文件缺失 → []、单行损坏跳过、非 message 行跳过；
//   limit 0/负/非整数/NaN → 100（signoff 裁决 5）；
//   before 游标 = messageId，严格早于游标的窗口；游标不在 → 最新窗口；时间升序。
//
// seam：src/services/sessionDomain.js 的 projectMessagesFromJsonl / paginateMessages。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadDomain() {
  const mod = await import("../../../../../../src/services/sessionDomain.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/sessionDomain.js 尚未实现（REQ-AGENT-113，ADR-030）");
  assert.equal(typeof mod.projectMessagesFromJsonl, "function", "应导出 projectMessagesFromJsonl(sessionRef)");
  assert.equal(typeof mod.paginateMessages, "function", "应导出 paginateMessages(messages, {limit, before})");
  return mod;
}

function msgLine(id, role, content, ts) {
  return JSON.stringify({ type: "message", id, timestamp: ts, message: { role, content } });
}

describe("REQ-AGENT-113 历史投影（sessionDomain 直测）", () => {
  let workdir;
  let sessionFile;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "session-domain-proj-"));
    sessionFile = path.join(workdir, "session.jsonl");
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("AC1 golden case：message 行投影为 {messageId, role, createdAt, text}", async () => {
    const domain = await loadDomain();
    fs.writeFileSync(
      sessionFile,
      msgLine("m1", "user", "你好", "2026-08-01T10:00:00Z") + "\n",
      "utf8"
    );

    // EXPECTED-TRACE: prd.md §6.3 块2 row 1
    assert.deepEqual(domain.projectMessagesFromJsonl(sessionFile), [
      { messageId: "m1", role: "user", createdAt: "2026-08-01T10:00:00Z", text: "你好" },
    ]);
  });

  it("AC2 工具不落历史：toolResult 行、空文本 assistant 行与空文本 user 行剔除", async () => {
    const domain = await loadDomain();
    const lines = [
      msgLine("u1", "user", [{ type: "text", text: "看一下目录" }], "2026-08-01T10:00:01Z"),
      msgLine("a1", "assistant", [
        { type: "thinking", thinking: "想一下" },
        { type: "toolCall", name: "bash" },
      ], "2026-08-01T10:00:02Z"),
      msgLine("t1", "toolResult", [{ type: "text", text: "total 152 ..." }], "2026-08-01T10:00:03Z"),
      // v2 补：空文本行（text 段 trim 后为空）user/assistant 均剔除（REQ-113 AC2）
      msgLine("u2", "user", [{ type: "text", text: "   " }], "2026-08-01T10:00:04Z"),
      msgLine("a3", "assistant", [{ type: "text", text: "  " }], "2026-08-01T10:00:05Z"),
      msgLine("a2", "assistant", [{ type: "text", text: "目录里有这些文件。" }], "2026-08-01T10:00:06Z"),
    ];
    fs.writeFileSync(sessionFile, lines.join("\n") + "\n", "utf8");

    // EXPECTED-TRACE: prd.md §6.3 块2 row 2（BUG-009 语义）
    const msgs = domain.projectMessagesFromJsonl(sessionFile);
    assert.deepEqual(
      msgs.map((m) => [m.messageId, m.role, m.text]),
      [
        ["u1", "user", "看一下目录"],
        ["a2", "assistant", "目录里有这些文件。"],
      ]
    );
  });

  it("AC3 附件名标记：image 段 → [图片: name] / 无 name → [图片]", async () => {
    const domain = await loadDomain();
    const lines = [
      msgLine("u1", "user", [
        { type: "text", text: "这张图" },
        { type: "image", name: "tiny.png" },
      ], "2026-08-01T10:00:01Z"),
      msgLine("u2", "user", [{ type: "image" }], "2026-08-01T10:00:02Z"),
    ];
    fs.writeFileSync(sessionFile, lines.join("\n") + "\n", "utf8");

    // EXPECTED-TRACE: prd.md §6.3 块2 row 3（REQ-AGENT-097）
    const msgs = domain.projectMessagesFromJsonl(sessionFile);
    assert.equal(msgs[0].text, "这张图[图片: tiny.png]");
    assert.equal(msgs[1].text, "[图片]");
  });

  it("AC4 降级：文件缺失 → []；单行损坏跳过；非 message 行跳过", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块2 row 4——文件不存在 → []
    assert.deepEqual(domain.projectMessagesFromJsonl(path.join(workdir, "no-such.jsonl")), []);

    const lines = [
      JSON.stringify({ type: "session", version: 3, id: "s1" }), // session 头跳过
      "{broken json",                                            // 损坏行跳过
      msgLine("m1", "user", "保留", "2026-08-01T10:00:00Z"),
      "",                                                        // 空行跳过
    ];
    fs.writeFileSync(sessionFile, lines.join("\n"), "utf8");
    const msgs = domain.projectMessagesFromJsonl(sessionFile);
    assert.deepEqual(msgs.map((m) => m.messageId), ["m1"]);
  });
});

describe("REQ-AGENT-113 历史分页（sessionDomain 直测）", () => {
  const MSGS = Array.from({ length: 5 }, (_, i) => ({
    messageId: `m${i + 1}`,
    role: "user",
    createdAt: `2026-08-01T10:00:0${i}Z`,
    text: `t${i + 1}`,
  }));

  it("AC5 limit 归一化：0 / -3 / 2.5 / NaN / 非数字 → 默认 100；正整数原样", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块2 row 5（signoff 裁决 5）
    for (const bad of [0, -3, 2.5, NaN, "abc", undefined]) {
      const out = domain.paginateMessages(MSGS, { limit: bad });
      assert.equal(out.length, 5, `limit=${String(bad)} → 默认 100（5 条全返回）`);
    }
    const out = domain.paginateMessages(MSGS, { limit: 2 });
    assert.deepEqual(out.map((m) => m.messageId), ["m4", "m5"]);
  });

  it("AC6 before 游标：在数组中 → 严格早于游标的最新窗口；不在 → 最新窗口；升序保持", async () => {
    const domain = await loadDomain();

    // EXPECTED-TRACE: prd.md §6.3 块2 row 6/7
    const win = domain.paginateMessages(MSGS, { limit: 2, before: "m3" });
    assert.deepEqual(win.map((m) => m.messageId), ["m1", "m2"]);

    const noCursor = domain.paginateMessages(MSGS, { limit: 2, before: "no-such" });
    assert.deepEqual(noCursor.map((m) => m.messageId), ["m4", "m5"]);

    const emptyBefore = domain.paginateMessages(MSGS, { limit: 2, before: "" });
    assert.deepEqual(emptyBefore.map((m) => m.messageId), ["m4", "m5"]);
  });
});
