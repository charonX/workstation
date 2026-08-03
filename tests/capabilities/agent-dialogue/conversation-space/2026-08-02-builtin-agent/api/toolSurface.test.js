// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-012, 2026-08-02-builtin-agent/REQ-AGENT-013
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

// seam：工具适配器（agent 子进程内 import CLI 命令模块，C2 链路）。
// TODO(HUMAN): 确认工具适配器暴露的接口形态（工具清单、riskLevel、执行返回结构）。

describe("REQ-AGENT-012 工具面全量命令与风险等级", () => {
  it("工具清单 = 现有 commands 全量（除 release）", async () => {
    // TODO: HUMAN ASSERTION — 注入工具集与 src/cli/commands/ 目录命令做差集断言（release 除外）
  });

  it("riskLevel 声明与 PRD §7.2 映射一致", async () => {
    // TODO: HUMAN ASSERTION — 抽样断言：task run=dispatch；source delete/settings set/channel bind=confirm；
    // task list/flow list=query；schedule create/toggle=confirm
  });

  it("工具执行走 C2 链路并返回结构化结果", async () => {
    // TODO: HUMAN ASSERTION — 调 task list → 结果含输出与错误码；失败含可透传错误
  });

  it("工具失败 → tool_execution_* 错误事件，agent 可继续", async () => {
    // TODO: HUMAN ASSERTION — 注入失败命令 → 事件含错误 → 下一条 prompt 正常
  });
});

describe("REQ-AGENT-013 release 拒绝", () => {
  it("release 不在工具面；尝试执行 → 明确拒绝", async () => {
    // TODO: HUMAN ASSERTION — 注入清单不含 release；agent 请求 release → 拒绝回复"不支持该操作"
  });
});
