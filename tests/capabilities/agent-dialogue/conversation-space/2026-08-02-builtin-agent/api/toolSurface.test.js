// REQ-TRACE: 2026-08-02-builtin-agent/REQ-AGENT-012, 2026-08-02-builtin-agent/REQ-AGENT-013
// REQ-VERSION: v1-hash:16f30c7bbd781fb9f86f573f3c92dc0c96a1aa38aecf3bd08c54caa0cdb712f4
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

// seam：工具适配器（agent 子进程内 import CLI 命令模块，C2 链路，ADR-001：进程内 import → HTTP API → services）。

const COMMANDS_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../../src/cli/commands"
);

// seam：工具适配器（tech-design「agent 子进程（PI 宿主）」C2 + REQ-AGENT-012）。
// 建议落点 src/agent/toolAdapter.js，导出 createToolSurface({ commandsDir, baseUrl }) →
// { listTools() → [{name, description, riskLevel, argsSchema}], execute(name, args) → {output, errorCode?, errorMessage?}, onEvent(cb) }。
async function loadToolSurface() {
  const mod = await import("../../../../../../src/agent/toolAdapter.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/agent/toolAdapter.js 尚未实现（REQ-AGENT-012/013）");
  assert.equal(typeof mod.createToolSurface, "function", "toolAdapter 应导出 createToolSurface()");
  return mod.createToolSurface;
}

describe("REQ-AGENT-012 工具面全量命令与风险等级", () => {
  let server;
  let baseUrl;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-surface-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("工具清单 = 现有 commands 全量（除 release）", async () => {
    const createToolSurface = await loadToolSurface();
    const surface = createToolSurface({ commandsDir: COMMANDS_DIR, baseUrl });
    const tools = surface.listTools();
    assert.ok(Array.isArray(tools) && tools.length > 0, "工具清单不应为空");
    // 命令清单 = 现有 commands 目录全量（release 除外，REQ-AGENT-012 标准 1 / REQ-AGENT-013）。
    const modules = fs.readdirSync(COMMANDS_DIR)
      .filter((f) => f.endsWith(".js"))
      .map((f) => f.replace(/\.js$/, ""))
      .filter((m) => m !== "release");
    for (const mod of modules) {
      assert.ok(tools.some((t) => t.name.startsWith(`${mod} `)), `工具清单应含 ${mod} 的命令（C2 进程内 import）`);
    }
    assert.ok(!tools.some((t) => t.name.startsWith("release")), "release 不得在工具面内");
    // 工具定义含命令、参数 schema、风险等级。
    for (const t of tools) {
      assert.ok(["query", "dispatch", "confirm"].includes(t.riskLevel), `${t.name} 应声明 riskLevel`);
      assert.ok(typeof t.description === "string" && t.description.length > 0, `${t.name} 应有工具描述`);
      assert.ok(t.argsSchema, `${t.name} 应有参数 schema`);
    }
  });

  it("riskLevel 声明与 PRD §7.2 映射一致", async () => {
    const createToolSurface = await loadToolSurface();
    const surface = createToolSurface({ commandsDir: COMMANDS_DIR, baseUrl });
    const tools = surface.listTools();
    const level = (name) => tools.find((t) => t.name === name)?.riskLevel;
    // 抽样断言（PRD §7.2，签核决策 12）：
    assert.equal(level("task run"), "dispatch", "task run = dispatch（直跑-下发）");
    assert.equal(level("task list"), "query", "task list = query（直跑-查询）");
    assert.equal(level("task get"), "query", "task get = query");
    assert.equal(level("flow list"), "query", "flow list = query");
    assert.equal(level("source delete"), "confirm", "source delete = confirm（高危-确认）");
    assert.equal(level("settings set"), "confirm", "settings set = confirm");
    assert.equal(level("channel bind"), "confirm", "channel bind = confirm");
    assert.equal(level("schedule create"), "confirm", "schedule create = confirm");
    assert.equal(level("schedule toggle"), "confirm", "schedule toggle = confirm");
    assert.equal(level("release"), undefined, "release 不注入工具面（REQ-AGENT-013）");
  });

  it("工具执行走 C2 链路并返回结构化结果", async () => {
    const createToolSurface = await loadToolSurface();
    const surface = createToolSurface({ commandsDir: COMMANDS_DIR, baseUrl });
    // C2：进程内 import 命令模块 → HTTP API（本测试服务器）→ services。
    const result = await surface.execute("task list", {});
    assert.ok(result, "应返回结构化结果");
    assert.ok(result.output !== undefined, "结果应含 output（输出/列表）");
    assert.ok(!result.errorCode, `成功执行不应有错误码，实际: ${JSON.stringify(result)}`);
  });

  it("工具失败 → tool_execution_* 错误事件，agent 可继续", async () => {
    const createToolSurface = await loadToolSurface();
    const surface = createToolSurface({ commandsDir: COMMANDS_DIR, baseUrl });
    const events = [];
    surface.onEvent((e) => events.push(e));
    // 注入失败：非法参数触发命令校验错误。
    const err = await surface.execute("task get", { id: "not-a-uuid" }).catch((e) => e);
    assert.ok(err, "失败命令应抛错或返回错误");
    assert.ok(
      events.some((e) => e.type.startsWith("tool_execution") && e.status === "error" && JSON.stringify(e).includes("task get")),
      `应回传 tool_execution_* 错误事件（含工具名与状态），实际事件: ${JSON.stringify(events)}`
    );
    // agent 可继续（REQ-AGENT-012 标准 4：不崩）。
    const ok = await surface.execute("task list", {});
    assert.ok(ok && !ok.errorCode, "失败后下一条工具执行应正常");
  });
});

describe("REQ-AGENT-013 release 拒绝", () => {
  let server;
  let baseUrl;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-surface-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ server, baseUrl } = await startServer({ port: 0 }));
  });

  afterEach(async () => {
    await stopServer({ server });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("release 不在工具面；尝试执行 → 明确拒绝", async () => {
    const createToolSurface = await loadToolSurface();
    const surface = createToolSurface({ commandsDir: COMMANDS_DIR, baseUrl });
    assert.ok(!surface.listTools().some((t) => t.name.startsWith("release")), "注入清单不含 release（REQ-AGENT-013 标准 1）");
    const err = await surface.execute("release", {}).catch((e) => e);
    const msg = err?.message ?? String(err);
    assert.match(msg, /不支持该操作/, `尝试 release 应被明确拒绝（回复「不支持该操作」），实际: ${msg}`);
  });
});
