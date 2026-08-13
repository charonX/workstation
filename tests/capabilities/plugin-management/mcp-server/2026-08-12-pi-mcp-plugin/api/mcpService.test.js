// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-084
// REQ-VERSION: v1-hash:080af1f439bec8660eeadc84b57fbef5650081f47d8918a7da585b9c172a49a1
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-08-13 assertion signoff)

// MCP server 配置 CRUD + 项目启用（REQ-084，B4）。
//
// seam：src/services/mcpService.js（BUILD 产物，动态 import）。
//
// 已签契约（门 1，2026-08-13，D1 扩展/D4 相关）：
//   工厂：createMcpService()（DB 经 OPC_WORKSTATION_CONFIG_DIR 指向测试库）。
//   ServerRow = { id, name, type: "stdio"|"http", command?, args?, env?, url?, headers?,
//                 auth?: "none"|"bearer"|"oauth", enabled /* 全局开关，默认 true */ }
//   setGlobalEnabled(name, enabled)；setProjectEnabled(projectId, name, enabled)
//   effectiveConfig(projectId) → { servers: { [name]: <桥 config 项> } }——
//     只含「全局开关开 ∧ 项目已启用」的 server；形态直接被 createMcpAdapter({config}) 消费。
//   错误消息：名称重复 = 含「已存在」；URL 非法 = 含「URL」；env/headers KEY 非法 = 含「KEY=VALUE」。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadMcpService() {
  const mod = await import("../../../../../../src/services/mcpService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/mcpService.js 尚未实现（REQ-AGENT-084）");
  assert.equal(typeof mod.createMcpService, "function", "导出 createMcpService");
  return mod;
}

describe("REQ-AGENT-084 MCP server 配置 CRUD + 项目启用（B4）", () => {
  let workdir;
  let svc;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-svc-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    const mod = await loadMcpService();
    svc = await mod.createMcpService();
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("标准 1：建 stdio server，合法配置落库（字段断言）", async () => {
    const row = await svc.create({
      name: "local-db",
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sqlite"],
      env: { DB_PATH: "./data/app.db" },
    });
    assert.ok(row.id, "落库行含 id");
    assert.equal(row.name, "local-db");
    assert.equal(row.type, "stdio");
    assert.equal(row.enabled, true, "全局开关默认开");
    const list = await svc.list();
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].args, ["-y", "@modelcontextprotocol/server-sqlite"]);
  });

  it("标准 2：http URL 仅 http/https；env/headers 必须 KEY=VALUE 且 KEY 合法（E2）", async () => {
    await assert.rejects(
      () => svc.create({ name: "bad-url", type: "http", url: "ftp://x" }),
      /URL/,
      "非 http/https URL 拒绝"
    );
    await assert.rejects(
      () => svc.create({ name: "bad-env", type: "stdio", command: "x", env: { "1BAD": "v" } }),
      /KEY=VALUE/,
      "非法环境变量 KEY 拒绝"
    );
    await assert.rejects(
      () => svc.create({ name: "no-cmd", type: "stdio" }),
      /command|命令/,
      "stdio 缺 command 拒绝"
    );
    assert.equal((await svc.list()).length, 0, "非法输入不落库");
  });

  it("标准 3：名称库内唯一，重复 → 业务错误", async () => {
    await svc.create({ name: "dup", type: "stdio", command: "x" });
    await assert.rejects(() => svc.create({ name: "dup", type: "stdio", command: "y" }), /已存在/);
  });

  it("标准 4：effectiveConfig 组合矩阵——仅「全局开 ∧ 项目启用」入快照", async () => {
    await svc.create({ name: "a", type: "stdio", command: "x" });
    await svc.create({ name: "b", type: "stdio", command: "x" });
    await svc.create({ name: "c", type: "stdio", command: "x" });
    const pid = "proj-1";
    await svc.setProjectEnabled(pid, "a", true);   // 全局开 + 项目启用 → 入
    // b：全局开 + 项目未启用 → 不入
    await svc.setProjectEnabled(pid, "c", true);
    await svc.setGlobalEnabled("c", false);        // 全局关 + 项目启用 → 不入
    const snap = await svc.effectiveConfig(pid);
    assert.deepEqual(Object.keys(snap.servers), ["a"], "快照只含 a");
  });

  it("标准 5：快照直接传入桥 createMcpAdapter({config}) 不报错", async () => {
    const adapter = await import("pi-mcp-adapter").catch(() => null);
    assert.ok(adapter, "依赖未就绪：pi-mcp-adapter 尚未安装（BUILD 切片引入）");
    await svc.create({ name: "compat", type: "stdio", command: "node", args: ["s.mjs"] });
    const pid = "proj-1";
    await svc.setProjectEnabled(pid, "compat", true);
    const snap = await svc.effectiveConfig(pid);
    assert.doesNotThrow(() => adapter.createMcpAdapter({ config: snap }), "快照 schema 与桥对齐");
  });
});
