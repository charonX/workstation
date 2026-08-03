// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-001, 2026-08-02-builtin-agent/REQ-AGENT-002
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

// seam：settings HTTP API（agent 配置区）+ safeStorage 加密存储。
// 依赖：OPC_WORKSTATION_CONFIG_DIR / DB_PATH 指向临时目录（测试隔离，见 README 注意事项）。
// TODO(HUMAN): 确认 safeStorage 在测试环境的 fake 方式（或跳过加密断言只断言 settings.json 无明文 key）。

describe("REQ-AGENT-001 供应商与 API key 配置", () => {
  let server;
  let baseUrl;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-config-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer(server);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("供应商枚举与保存（deepseek / moonshotai / moonshotai-cn）", async () => {
    // TODO: HUMAN ASSERTION — 供应商枚举与保存/读取往返
    // const res = await fetch(`${baseUrl}/api/settings/agent`, { method: "PUT", body: JSON.stringify({ provider: "deepseek", apiKey: "sk-test-..." }) });
    // assert.equal(res.status, 200);
    // 读取返回 provider=deepseek；settings.json 无明文 "sk-test-..."
  });

  it("key 仅非空校验（不做前缀校验）", async () => {
    // TODO: HUMAN ASSERTION — 空 key → E-CONFIG-INVALID；任意非空前缀（如 "xxx-yyy"）可保存（准确性由用户负责）
  });

  it("测试连接（保存前校验 key 有效性）", async () => {
    // TODO: HUMAN ASSERTION — 对当前供应商发最小请求；失败透传 E-AGENT-LLM-FAIL 原因；失败不阻止保存
  });

  it("配置状态可查（已配置/未配置 + 供应商名）", async () => {
    // TODO: HUMAN ASSERTION — GET 返回配置状态结构
  });
});

describe("REQ-AGENT-002 key 缺失引导", () => {
  it("未配置 key 时 agent 对话回复 E-AGENT-NO-KEY 引导文案，不启动会话", async () => {
    // TODO: HUMAN ASSERTION — 注入一条飞书消息（未配 key），断言回复含"设置中配置"引导
    // 且不产生 agent_sessions 行
  });

  it("斜杠命令在未配 key 时照常可用", async () => {
    // TODO: HUMAN ASSERTION — /status /list 在未配 key 下正常返回（不依赖 LLM）
  });
});
