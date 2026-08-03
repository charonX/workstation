// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-003, 2026-08-02-builtin-agent/REQ-AGENT-004
// REQ-VERSION: v1-hash:1a95cf23677ba5e4cea1a2eb2157896aeef22713b6de03f9c5119c49f3830e2b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: settings
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// seam：agent 适配层（session-config 消息注入断言）+ settings HTTP API。
// 依赖：agent 适配层在测试中可用内存版 IPC（不 spawn 真子进程）快速路径。

describe("REQ-AGENT-003 内置基础身份", () => {
  it("内置 system prompt 恒注入（身份 + 工具面 + 行为规则）", async () => {
    // TODO: HUMAN ASSERTION — 创建会话时断言 session-config.systemPrompt 包含：
    // 平台助手身份、CLI 工具面说明、授权边界/高危确认/流式汇报规则
  });

  it("内置身份不含 secret", async () => {
    // TODO: HUMAN ASSERTION — systemPrompt 内容不含任何 key 值（注入测试 key 后断言）
  });
});

describe("REQ-AGENT-004 全局自定义身份", () => {
  it("自定义身份保存与校验（≤2000 字符，可空）", async () => {
    // TODO: HUMAN ASSERTION — 超长报 E-CONFIG-INVALID；空=仅内置；保存后可读
  });

  it("保存后 session-config 热更新存量会话（config-ack），不重建上下文", async () => {
    // TODO: HUMAN ASSERTION — 改自定义身份 → 断言收到 session-config（systemPrompt 含新内容）
    // + config-ack；provider/key 未变 → 无重建（sessionRef 不变）
  });

  it("内置在前、自定义在后拼接顺序固定", async () => {
    // TODO: HUMAN ASSERTION — 最终 systemPrompt = 内置 + 自定义（顺序断言）
  });
});
