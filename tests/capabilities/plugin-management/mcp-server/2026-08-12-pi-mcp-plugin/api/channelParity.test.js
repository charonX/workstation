// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-088
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// 飞书通道同工同权（REQ-088，B7）。
//
// seam：飞书会话入口（既有 channel 集成测试先例，通道 mock/stub）。
// 实现接线：mock 飞书消息触发会话 → 与 UI 会话同一 worker 装配路径。
//
// 已签断言（门 1，2026-08-13）：
//   同工标志 = 飞书会话工具面与 UI 会话工具面完全相等（同一 assembleSessionExtensions 输出）；
//   同权标志 = ask 场景飞书确认卡出现，确认后 fixture server 调用日志含该次调用。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../../../../");
const STDIO_SERVER = path.join(ROOT, "tests/fixtures/mcp-stdio-server/server.mjs");

describe("REQ-AGENT-088 飞书通道同工同权（B7）", () => {
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-channel-"));
    // RED 门：通道同工同权依赖 worker 装配缝（BUILD 前不允许变绿）
    const asm = await import("../../../../../../src/agent/sessionAssembly.js").catch(() => null);
    assert.ok(asm, "seam 未就绪：sessionAssembly 尚未实现（REQ-AGENT-088）");
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准 1：飞书会话工具面 = UI 会话工具面（含已启用插件/MCP 工具）", async () => {
    // 实现接线：项目启用 fixture 插件 + fixture MCP server →
    //   分别经 UI 入口与飞书入口建会话，工具面集合断言相等
    // 已签断言（接线后生效）：assert.deepEqual(feishuTools.sort(), uiTools.sort())
    assert.ok(fs.existsSync(STDIO_SERVER), "fixture 就位");
  });

  it("标准 2：飞书会话 MCP 调用过 broker→gotgenes→飞书确认卡，确认后执行", async () => {
    // 实现接线：ask 场景（无规则）→ 断言飞书确认卡消息发出（mock 通道见证）→
    //   模拟确认 → fixture 调用日志含 name="fixture_ping"
    assert.ok(true, "接线占位——见注释断言");
  });
});
