// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-009
// REQ-VERSION: v1-hash:1a95cf23677ba5e4cea1a2eb2157896aeef22713b6de03f9c5119c49f3830e2b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// seam：真实子进程 + 临时目录（两次启动断言恢复）。依赖 H2 假设（会话目录自定义 + SessionManager.open）。
// TODO(HUMAN): 确认 PI 会话目录自定义方式（--session-dir / SDK 选项）与恢复 API。

describe("REQ-AGENT-009 会话恢复", () => {
  it("重启后按 agent_sessions + SessionManager.open 恢复上下文", async () => {
    // TODO: HUMAN ASSERTION — 第一轮对话（含关键实体"日报"）→ 重启 agent → 问"刚才的任务"
    // → 正确回应（证明上下文恢复）
  });

  it("JSONL 缺失/损坏 → 新建会话 + 提示历史不可恢复，不阻塞对话", async () => {
    // TODO: HUMAN ASSERTION — 删 JSONL → 重启 → 新会话可用 + 用户可见提示
  });
});
