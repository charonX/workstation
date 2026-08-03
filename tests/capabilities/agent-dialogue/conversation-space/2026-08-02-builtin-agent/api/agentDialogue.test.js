// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-006, 2026-08-02-builtin-agent/REQ-AGENT-007
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

// seam：agent 适配层（fauxProvider 注入，H3 假设）+ 内存版 IPC 快速路径。
// TODO(HUMAN): 确认 fauxProvider 注入 createAgentSession 的最小用法（H3 spike）。
// 对话回路不真调 DeepSeek/Kimi——所有测试经 fauxProvider 脚本化响应。

describe("REQ-AGENT-006 对话回路与流式事件", () => {
  it("prompt → faux LLM → 回复经 session-event 回传", async () => {
    // TODO: HUMAN ASSERTION — faux 响应"执行列表"→ 断言回复文本与事件序列
  });

  it("同空间并发 prompt 排队串行；跨空间并行互不阻塞", async () => {
    // TODO: HUMAN ASSERTION — 同空间两连发按序处理；两空间交错不互相等待
  });

  it("流式增量事件（text_delta）按序回传", async () => {
    // TODO: HUMAN ASSERTION — faux 流式响应 → 事件序列递增完整（无乱序/丢帧）
  });

  it("工具调用事件含工具名与状态", async () => {
    // TODO: HUMAN ASSERTION — agent 调 CLI 工具 → tool_execution_* 事件含工具名/状态
  });

  it("单条 IPC 消息 ≤ 256KB，超限截断或降级文件引用", async () => {
    // TODO: HUMAN ASSERTION — 超长工具结果 → 截断/引用（断言消息大小与降级标记）
  });
});

describe("REQ-AGENT-007 LLM 错误结构化", () => {
  it("供应商失败 → 错误消息回传，会话存活可继续", async () => {
    // TODO: HUMAN ASSERTION — faux 注入失败响应 → session-event 错误（E-AGENT-LLM-FAIL 透传）
    // 进程不崩；下一条 prompt 正常
  });

  it("重试语义（408/409/429/5xx）与耗尽路径", async () => {
    // TODO: HUMAN ASSERTION — faux 连续 429 → 重试后成功；一直失败 → 错误消息
  });

  it("错误响应含用户文案与内部错误码", async () => {
    // TODO: HUMAN ASSERTION — 错误结构含 userMessage + code（区分业务/系统）
  });
});
