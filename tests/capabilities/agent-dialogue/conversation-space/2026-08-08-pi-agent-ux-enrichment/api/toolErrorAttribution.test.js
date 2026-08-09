// REQ-TRACE: 2026-08-08-pi-agent-ux-enrichment/REQ-AGENT-052
// REQ-VERSION: v1-hash:dfd35b8a5242cf1ef089f0b289012aa34a1dd194c813e014e8e81b73fc9f403b
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true
// BUG-TRACE: BUG-006

// BUG-006 回归：tool_execution_error 事件必须携带 toolCallId——并行工具调用时
// 无 id 的错误事件在渲染层按「最近 running 块」关联 = 系统性错配（生产事故实锤
// 2026-08-09：一轮 3 个并行调用 read×2+bash×1，read#1 的错误错挂 bash 块，
// read#1 块只剩 isError end → 显示「未知错误」；成功的 bash 块被 error 终态
// 锁死，成功输出被隐藏）。
//
// 根因：toolAdapter 的 toPiToolDefinitions execute(toolCallId, ...) 持有 id 却
// 未透传进 emitToolError——REQ-AGENT-055 加法扩展补了 start.input/end.output/
// isError 载体，漏了 error 事件的 id。渲染层 reduceToolEvent 的 toolCallId
// 精确匹配分支早已存在（Assistant.jsx），只欠事件携带。
//
// 断言（REQ-AGENT-052 工具块生命周期「end|error 按 id 更新」契约面）：
// 1. FS 工具失败（read 不存在文件）→ tool_execution_error 事件 toolCallId =
//    execute 调用入参 id；
// 2. CLI 工具失败（settings get 指向不可达 server）→ 同上（两工具面一致性）；
// 3. error 事件字段集兼容——name/status/errorCode/errorMessage 不丢（加法语义，
//    既有消费方字段不变）；
// 4. 不经 PI 的直接 execute(name, args) 调用（无 id）→ 事件无 toolCallId 字段
//    （向后兼容：渲染层回退「最近 running 块」路径保持可用）。
//
// seam：createSessionToolSurface(project) 的 toPiToolDefinitions——execute 是
// PI agent-loop 真实调用形态（toolCallId 为 SDK 生成 id）；onEvent 捕获事件流。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const COMMANDS_DIR = path.resolve(import.meta.dirname, "../../../../../../src/cli/commands");

async function loadToolAdapter() {
  const mod = await import("../../../../../../src/agent/toolAdapter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/toolAdapter.js 尚未导出 createSessionToolSurface");
  return mod;
}

function defsByName(surface) {
  const map = new Map();
  for (const def of surface.toPiToolDefinitions()) map.set(def.label ?? def.name, def);
  return map;
}

describe("BUG-006 回归：tool_execution_error 事件携带 toolCallId（并行错配根治）", () => {
  let workdir;
  let projectDir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "bug006-err-attr-"));
    projectDir = path.join(workdir, "project");
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("用例 1：FS 工具失败 → error 事件 toolCallId = execute 入参 id", async () => {
    // Arrange
    const { createSessionToolSurface } = await loadToolAdapter();
    const surface = createSessionToolSurface({ profile: "project", cwd: projectDir, commandsDir: COMMANDS_DIR });
    const events = [];
    surface.onEvent((ev) => events.push(ev));
    const readDef = defsByName(surface).get("read");
    assert.ok(readDef, "read 工具定义应存在（project profile）");
    // Act：PI 调用形态——失败（不存在文件）→ execute 抛错（PI 标记 isError）。
    await assert.rejects(() => readDef.execute("tc-read-1", { path: "no-such.md" }), /E-AGENT-FS-ERROR/);
    // Assert
    const errEv = events.find((ev) => ev.type === "tool_execution_error");
    assert.ok(errEv, "应发出 tool_execution_error 事件");
    assert.equal(
      errEv.toolCallId,
      "tc-read-1",
      `error 事件必须携带 execute 入参 toolCallId（渲染层精确归块）。实际事件: ${JSON.stringify(errEv)}`
    );
  });

  it("用例 2：CLI 工具失败 → error 事件 toolCallId = execute 入参 id（两工具面一致）", async () => {
    // Arrange：baseUrl 注入不可达端口（invokeCommandHandler 会以其为 override——
    // 连接立即拒绝，快速确定性失败；堵死注册表发现/headless/in-process 兜底）。
    const { createSessionToolSurface } = await loadToolAdapter();
    const surface = createSessionToolSurface({
      profile: "project",
      cwd: projectDir,
      commandsDir: COMMANDS_DIR,
      baseUrl: "http://127.0.0.1:1",
    });
    const events = [];
    surface.onEvent((ev) => events.push(ev));
    const settingsDef = defsByName(surface).get("settings get");
    assert.ok(settingsDef, "settings get 工具定义应存在");
    // Act：server 不可达（override 到 127.0.0.1:1）→ 命令失败。
    await assert.rejects(() => settingsDef.execute("tc-cli-1", {}));
    // Assert
    const errEv = events.find((ev) => ev.type === "tool_execution_error");
    assert.ok(errEv, "应发出 tool_execution_error 事件");
    assert.equal(
      errEv.toolCallId,
      "tc-cli-1",
      `CLI 面 error 事件同样携带 toolCallId。实际事件: ${JSON.stringify(errEv)}`
    );
  });

  it("用例 3：error 事件既有字段集不丢（name/status/errorCode/errorMessage）", async () => {
    // Arrange
    const { createSessionToolSurface } = await loadToolAdapter();
    const surface = createSessionToolSurface({ profile: "project", cwd: projectDir, commandsDir: COMMANDS_DIR });
    const events = [];
    surface.onEvent((ev) => events.push(ev));
    const readDef = defsByName(surface).get("read");
    // Act
    await assert.rejects(() => readDef.execute("tc-read-2", { path: "no-such.md" }));
    // Assert：加法语义——id 之外字段与既有契约一致（渲染层/转发层消费不变）。
    const errEv = events.find((ev) => ev.type === "tool_execution_error");
    assert.ok(errEv);
    assert.equal(errEv.name, "read");
    assert.equal(errEv.status, "error");
    assert.equal(errEv.errorCode, "E-AGENT-FS-ERROR");
    assert.match(errEv.errorMessage ?? "", /no-such\.md/);
  });

  it("用例 4：无 id 直接 execute → 事件无 toolCallId 字段（向后兼容回退路径）", async () => {
    // Arrange：主进程确认执行/测试等直接调用形态（无 PI toolCallId）。
    const { createSessionToolSurface } = await loadToolAdapter();
    const surface = createSessionToolSurface({ profile: "project", cwd: projectDir, commandsDir: COMMANDS_DIR });
    const events = [];
    surface.onEvent((ev) => events.push(ev));
    // Act
    const result = await surface.execute("read", { path: "no-such.md" });
    // Assert：errorResult 语义不变 + 事件不携带 undefined id 字段（JSON 帧不增键）。
    assert.equal(result.errorCode, "E-AGENT-FS-ERROR");
    const errEv = events.find((ev) => ev.type === "tool_execution_error");
    assert.ok(errEv);
    assert.ok(!("toolCallId" in errEv), `无 id 调用的事件不应出现 toolCallId 键。实际: ${JSON.stringify(errEv)}`);
  });
});
