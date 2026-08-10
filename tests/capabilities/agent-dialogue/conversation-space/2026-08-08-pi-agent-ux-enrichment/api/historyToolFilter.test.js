// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-054
// REQ-VERSION: v1-hash:dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true
// BUG-TRACE: BUG-009

// BUG-009 回归：历史投影必须只落对话文本——「工具不落历史」（REQ-AGENT-054 /
// PRD B8「工具块仅实时呈现不落历史」）。生产观感事故实锤 2026-08-10：重开
// knowledge 项目会话历史，bash ls -la 原始输出与 project_list JSON 以纯文本
// 气泡漏进消息流（实时视图正常=工具折叠块，重载后裸输出裸露）。
//
// 根因：projectMessagesFromJsonl（src/http/routes/agentSessions.js）投影 PI
// JSONL 时不按 role 过滤——role:"toolResult" 的行原样投影为文本消息，渲染层
// MessageList 把非 user 角色一律映射 agent 气泡；且只含 thinking/toolCall
// （无 text 段）的 assistant 行投影为空文本气泡。生产数据普查（4 个会话文件）：
// 三种 role（user/assistant/toolResult）+ 多个空文本 assistant 气泡。
//
// 断言（历史投影契约：历史 = 对话文本，工具产物零渗漏）：
// 1. seam 存在：agentSessions.js 导出 projectMessagesFromJsonl；
// 2. toolResult 行不落历史——投影无 toolResult 角色，原始输出文本零渗漏；
// 3. 纯工具调用 assistant 行（thinking+toolCall 无 text 段）→ 不落历史
//    （工具调用气泡也是工具产物；无空气泡）；
// 4. user/assistant 文本保留——assistant 只保留 text 段（thinking/toolCall
//    段剔除），生产形态 fixture 全量对齐；
// 5. 旧形态兼容：content 为纯字符串的 message 行（平台内存内核轻量记录形态）
//    → user/assistant 保留。
//
// seam：src/http/routes/agentSessions.js 的 projectMessagesFromJsonl
// （纯函数，GET /api/agent/sessions/:spaceKey/messages 的唯一历史变换点）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

async function loadProjection() {
  const mod = await import("../../../../../../src/http/routes/agentSessions.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/agentSessions.js 不可导入");
  assert.equal(
    typeof mod.projectMessagesFromJsonl,
    "function",
    "agentSessions.js 应导出 projectMessagesFromJsonl(sessionRef)"
  );
  return mod;
}

// 生产形态 JSONL 行（复刻 2026-08-09 knowledge 会话 109ccae5 结构）。
function msgLine(id, role, content, ts) {
  return JSON.stringify({ type: "message", id, parentId: null, timestamp: ts, message: { role, content } });
}

const TS = (s) => `2026-08-09T14:49:${s}.000Z`;

describe("BUG-009 回归：工具产物不落历史（历史投影 role 过滤）", () => {
  let workdir;
  let sessionFile;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bug009-hist-filter-"));
    sessionFile = path.join(workdir, "session.jsonl");
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("用例 2：toolResult 行不落历史——原始工具输出零渗漏", async () => {
    // Arrange：用户提问 → assistant（text+toolCall）→ 两条 toolResult（复刻截图症状：
    // bash ls -la 原始输出 + project_list JSON）。
    const RAW_LS = "total 152\n-rw-r--r--@  1 zhanglei  staff  11578 Jul 28 17:43 用 Codex + Remotion 实现无痛自媒体视频日更.md";
    const RAW_JSON = '[\n  {\n    "id": "d2c3ede1-903f-4a6b-b4f0-674efa1c9484",\n    "name": "knowledge"\n  }\n]';
    const lines = [
      JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: TS("00"), cwd: "/x" }),
      msgLine("u1", "user", [{ type: "text", text: "这个项目的目录，帮我看一下都有哪些？" }], TS("01")),
      msgLine("a1", "assistant", [
        { type: "thinking", thinking: "用户想了解目录内容。" },
        { type: "text", text: "我先看一下当前项目目录的结构。" },
        { type: "toolCall", id: "call_00", name: "bash", arguments: { command: "ls -la" } },
        { type: "toolCall", id: "call_01", name: "project_list", arguments: { q: "knowledge" } },
      ], TS("03")),
      msgLine("t1", "toolResult", [{ type: "text", text: RAW_LS }], TS("16")),
      msgLine("t2", "toolResult", [{ type: "text", text: RAW_JSON }], TS("16")),
      msgLine("a2", "assistant", [
        { type: "thinking", thinking: "看完目录了。" },
        { type: "text", text: "给你梳理一下：这是 knowledge 项目。" },
      ], TS("33")),
    ];
    fs.writeFileSync(sessionFile, lines.join("\n") + "\n");
    const { projectMessagesFromJsonl } = await loadProjection();

    // Act
    const msgs = projectMessagesFromJsonl(sessionFile);

    // Assert：投影只含 user/assistant 文本；toolResult 行与其原始输出零渗漏。
    assert.deepEqual(
      msgs.map((m) => m.role),
      ["user", "assistant", "assistant"],
      `历史投影不得含 toolResult 角色。实际: ${JSON.stringify(msgs.map((m) => m.role))}`
    );
    const allText = msgs.map((m) => m.text).join("\n");
    assert.ok(!allText.includes("total 152"), `bash 原始输出漏进历史: ${allText.slice(0, 200)}`);
    assert.ok(!allText.includes("d2c3ede1"), `project_list JSON 漏进历史: ${allText.slice(0, 200)}`);
  });

  it("用例 3：纯工具调用 assistant 行（无 text 段）→ 不落历史（无空气泡）", async () => {
    // Arrange：assistant 行只含 thinking+toolCall（生产会话 002e7653 实存 5 条此类），
    // 投影为空文本气泡 = 工具调用产物落历史的另一形态。
    const lines = [
      msgLine("u1", "user", [{ type: "text", text: "读一下说明文档" }], TS("01")),
      msgLine("a1", "assistant", [
        { type: "thinking", thinking: "先读文件。" },
        { type: "toolCall", id: "call_00", name: "read", arguments: { path: "README.md" } },
      ], TS("03")),
      msgLine("t1", "toolResult", [{ type: "text", text: "# README 内容" }], TS("04")),
      msgLine("a2", "assistant", [{ type: "text", text: "文档读完了，要点如下。" }], TS("06")),
    ];
    fs.writeFileSync(sessionFile, lines.join("\n") + "\n");
    const { projectMessagesFromJsonl } = await loadProjection();

    // Act
    const msgs = projectMessagesFromJsonl(sessionFile);

    // Assert：无 text 段的 assistant 行（纯工具调用载体）不落历史；无空文本气泡。
    assert.deepEqual(
      msgs.map((m) => `${m.role}:${m.text}`),
      ["user:读一下说明文档", "assistant:文档读完了，要点如下。"],
      `纯工具调用 assistant 行不落历史。实际: ${JSON.stringify(msgs.map((m) => [m.role, m.text]))}`
    );
    assert.ok(msgs.every((m) => m.text.trim() !== ""), "历史不得含空文本气泡");
  });

  it("用例 4：assistant 只保留 text 段（thinking/toolCall 段剔除），id/createdAt 保留", async () => {
    // Arrange
    const lines = [
      msgLine("u1", "user", [{ type: "text", text: "问题" }], TS("01")),
      msgLine("a1", "assistant", [
        { type: "thinking", thinking: "内心独白不应入史" },
        { type: "text", text: "可见回答。" },
        { type: "toolCall", id: "call_00", name: "bash", arguments: { command: "ls" } },
      ], TS("03")),
    ];
    fs.writeFileSync(sessionFile, lines.join("\n") + "\n");
    const { projectMessagesFromJsonl } = await loadProjection();

    // Act
    const msgs = projectMessagesFromJsonl(sessionFile);

    // Assert：封套字段契约不回归（REQ-AGENT-029：messageId/role/createdAt）。
    assert.deepEqual(
      msgs.map((m) => [m.messageId, m.role, m.createdAt, m.text]),
      [
        ["u1", "user", TS("01"), "问题"],
        ["a1", "assistant", TS("03"), "可见回答。"],
      ],
      `文本段提取与封套字段不回归。实际: ${JSON.stringify(msgs)}`
    );
  });

  it("用例 5：旧形态兼容——content 纯字符串的 user/assistant 行保留", async () => {
    // Arrange：平台内存内核轻量记录形态（projection 注释承诺同构兼容）。
    const lines = [
      msgLine("u1", "user", "字符串用户消息", TS("01")),
      msgLine("a1", "assistant", "字符串 agent 回复", TS("03")),
    ];
    fs.writeFileSync(sessionFile, lines.join("\n") + "\n");
    const { projectMessagesFromJsonl } = await loadProjection();

    // Act
    const msgs = projectMessagesFromJsonl(sessionFile);

    // Assert
    assert.deepEqual(
      msgs.map((m) => `${m.role}:${m.text}`),
      ["user:字符串用户消息", "assistant:字符串 agent 回复"],
      "旧形态字符串 content 不回归"
    );
  });
});
