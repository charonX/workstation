// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-005
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

// seam：agentService 真实 spawn + kill（集成）。依赖 H1 假设（asar 打包 spawn 路径）——开发模式跑源码入口。
// TODO(HUMAN): 确认测试环境的子进程入口路径（开发模式 node 直跑 vs 打包 asar）。

describe("REQ-AGENT-005 agent 子进程生命周期（看门狗）", () => {
  let workdir;
  let agentService;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-proc-"));
    // agentService = createAgentService({ cwd: workdir, entry: <子进程入口> });
  });

  afterEach(async () => {
    await agentService?.stop();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("spawn 后子进程回 ready", async () => {
    // TODO: HUMAN ASSERTION — start 后收到 ready；子进程存活
  });

  it("心跳超时/exit → 看门狗自动重启", async () => {
    // TODO: HUMAN ASSERTION — kill 子进程（任意退出码）→ 检测 exit → 新子进程 ready
  });

  it("重启后会话按 agent_sessions + JSONL 恢复，只丢半条流式消息", async () => {
    // TODO: HUMAN ASSERTION — 建会话发消息 → kill → 重启 → 会话可继续；崩溃前已完成消息可恢复
  });

  it("重启期间 prompt 返回 restarting，就绪后重投", async () => {
    // TODO: HUMAN ASSERTION — kill 后立即 prompt → session-error restarting；
    // 就绪后重投成功（或拒绝并提示）
  });

  it("子进程 stderr 进主进程日志且不含 key 值", async () => {
    // TODO: HUMAN ASSERTION — 注入 key 后触发子进程日志，断言日志无 key 明文
  });
});
