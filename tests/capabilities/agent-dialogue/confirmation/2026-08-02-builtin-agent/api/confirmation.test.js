// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-016
// REQ-VERSION: v1-hash:1a95cf23677ba5e4cea1a2eb2157896aeef22713b6de03f9c5119c49f3830e2b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: confirmation
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// seam：确认服务状态机（agent_confirmations 表，临时 SQLite）+ 真 IPC 集成（notify-result 回投）。
// TODO(HUMAN): 确认确认服务 API 形态（submit/approve/reject/query）与卡片渲染回调注入点。

describe("REQ-AGENT-016 高危确认挂起与解耦执行", () => {
  it("confirm 级命令拦截 → 挂起队列 + 确认卡片 + agent 回复待确认", async () => {
    // TODO: HUMAN ASSERTION — agent 调 source delete → confirm-request 事件；队列 pending；
    // 回复含"待确认"；确认卡片含命令摘要
  });

  it("确认回调驱动执行（不经过 agent turn）+ notify-result 回投自然语言", async () => {
    // TODO: HUMAN ASSERTION — approve 后命令执行（副作用可见）→ notify-result 注入会话
    // → agent 生成基于执行结果的回投文本
  });

  it("拒绝 → 不执行 + 回投已取消", async () => {
    // TODO: HUMAN ASSERTION — reject 后无副作用；回投含"已取消"
  });

  it("confirmId 幂等：重复回调只执行一次", async () => {
    // TODO: HUMAN ASSERTION — 同一 confirmId approve 两次 → 执行一次
  });

  it("挂起队列持久化：重启后 pending 项仍可确认", async () => {
    // TODO: HUMAN ASSERTION — 重启后 approve 仍生效（SQLite 真相）
  });
});
