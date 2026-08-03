// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-019, 2026-08-02-builtin-agent/REQ-AGENT-020
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

// seam：会话卡片渲染器 + feishuChannelAdapter 卡片接口（adapter fake 断言结构与 sequence）。
// 依赖 H4 假设（CardKit 卡片流式最小调用）。
// TODO(HUMAN): 确认 adapter fake 方式（sendCard/updateCardStream 可注入断言）。

describe("REQ-AGENT-019 回复卡片流式", () => {
  it("流式输出 → sendCard + updateCardStream 按序更新（sequence 递增）", async () => {
    // TODO: HUMAN ASSERTION — 注入流式事件序列 → adapter 收到 sendCard 一次 + 递增 sequence 更新
  });

  it("流式结束卡片定型；错误标注失败状态", async () => {
    // TODO: HUMAN ASSERTION — 完成事件 → 无后续更新；错误事件 → 卡片含失败标记
  });

  it("流式窗口 10 分钟关闭 → 降级普通消息 + /status 提示", async () => {
    // TODO: HUMAN ASSERTION — 模拟窗口关闭 → 普通文本消息 + 提示文案
  });
});

describe("REQ-AGENT-020 任务卡片流式与降级", () => {
  it("执行启动 → 任务卡片；进度增量更新；终态含执行 id", async () => {
    // TODO: HUMAN ASSERTION — 注入 eventBus 执行事件 → 卡片序列（启动→进度→终态含 executionId）
  });

  it("执行结果经对话回投（会话活跃时）", async () => {
    // TODO: HUMAN ASSERTION — 执行完成 → agent 生成摘要回投
  });

  it("卡片更新失败（重试耗尽）→ 告警不阻断执行", async () => {
    // TODO: HUMAN ASSERTION — adapter 连续失败 → E-CHANNEL-SEND 告警；执行正常完成
  });
});
