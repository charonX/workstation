// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-014, 2026-08-02-builtin-agent/REQ-AGENT-015
// REQ-VERSION: v1-hash:1a95cf23677ba5e4cea1a2eb2157896aeef22713b6de03f9c5119c49f3830e2b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: user-binding
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// seam：agentRouter 绑定检查纯函数 + settings 绑定状态（pendingBind 状态机）。
// TODO(HUMAN): 确认 agentRouter 纯函数导出形态与 pendingBind 的存储位置（settings JSON）。

describe("REQ-AGENT-014 用户绑定（E3 + arming）", () => {
  it("状态机：未绑定 → arming(pendingBind) → 下一条消息绑定 → 解绑 → 重绑", async () => {
    // TODO: HUMAN ASSERTION — 全路径断言：绑定成功回复；后续未绑定消息拒绝
  });

  it("pendingBind 一次性：仅下一条未绑定消息生效", async () => {
    // TODO: HUMAN ASSERTION — arming 后第一条消息绑定；第二条（未绑定者）拒绝
  });

  it("未 arming 时未绑定消息 → 拒绝 + 引导卡片（不执行绑定）", async () => {
    // TODO: HUMAN ASSERTION — 未置 pendingBind → E-AUTH-NOT-BOUND + 引导文案；绑定状态不变
  });

  it("pendingBind 有效期 10 分钟 / 取消", async () => {
    // TODO: HUMAN ASSERTION — 过期（10 分钟，签核拍板）或取消后不生效
  });
});

describe("REQ-AGENT-015 未绑定用户拒绝", () => {
  it("未绑定用户一切消息（含查询）→ E-AUTH-NOT-BOUND，不启动会话不执行命令", async () => {
    // TODO: HUMAN ASSERTION — 未绑定者发"看下执行情况"与 /status → 均拒绝；无 agent_sessions 行
  });

  it("拒绝先于命令识别与会话分发", async () => {
    // TODO: HUMAN ASSERTION — 路由顺序断言（绑定检查为第一道）
  });
});
