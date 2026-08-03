// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-017, 2026-08-02-builtin-agent/REQ-AGENT-018
// REQ-VERSION: v1-hash:1a95cf23677ba5e4cea1a2eb2157896aeef22713b6de03f9c5119c49f3830e2b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// seam：imRouter/agentRouter（注入 fake 飞书消息）+ 复用 mockChannelAdapter 模式（REQ-CHANNEL）。
// 契约修订：REQ-CHANNEL-002 接替——绑定不再直接 createTask。
// TODO(HUMAN): 确认 agentRouter 注入方式与 fake 消息注入 seam（沿用 feishuChannelAdapter 的 test seam 或新注入点）。

describe("REQ-AGENT-017 agent 优先路由（REQ-CHANNEL-002 接替）", () => {
  it("消息去重后进 agentRouter（绑定检查 → 命令识别 → 会话分发）", async () => {
    // TODO: HUMAN ASSERTION — 注入消息 → 路由三函数顺序执行；重复消息丢弃
  });

  it("命中绑定不再直接 createTask（旧语义接替）", async () => {
    // TODO: HUMAN ASSERTION — 有绑定 + 消息 → 无 executions 行直接产生；消息进对话
  });

  it("绑定作为 agent 下发任务的默认目标候选", async () => {
    // TODO: HUMAN ASSERTION — 绑定 flow 存在时 agent 下发意图优先用绑定 flow（工具上下文断言）
  });

  it("手动/定时/调试触发路径不受影响（回归）", async () => {
    // TODO: HUMAN ASSERTION — 非通道触发仍正常 createTask
  });
});

describe("REQ-AGENT-018 会话分发与群聊语义", () => {
  it("空间 key = feishu:<chatId>：单聊与群聊各自独立", async () => {
    // TODO: HUMAN ASSERTION — 两个 chatId → 两个 agent_sessions 行，上下文隔离
  });

  it("绑定用户在群聊发言 → 群空间对话；同群他人 → 拒绝", async () => {
    // TODO: HUMAN ASSERTION — 绑定者消息进对话；非绑定者 E-AUTH-NOT-BOUND，群空间不受影响
  });

  it("空间不存在自动创建 + 下发 session-config", async () => {
    // TODO: HUMAN ASSERTION — 首次对话 → 建空间 + session-config（供应商/key/身份）
  });
});
