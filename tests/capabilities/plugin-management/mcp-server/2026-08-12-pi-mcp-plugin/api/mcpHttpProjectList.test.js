// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-084
// REQ-VERSION: v1-hash:6c7fd998525a697ef21587c808800edfb15182b428d588f83c9ae835acf09243
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false (BUG-012 回归：断言 = 项目感知 list 的 enabled 语义，直接应用 REQ-084 标准 4「项目启用/停用持久化」已签契约)

// BUG-012 回归（code-defect，人确认 2026-08-15）：管理页 MCP「项目启用」弹层拿
// 全局开关冒充项目启用态——renderer buildProjectMaps 调 listMcpServers() 不带
// projectId（对照插件侧 listPlugins(proj.id)），且 GET /api/mcp 无 ?project= 读
// seam（对照 GET /api/plugins?project=<id>，plugins.js:129）。后果：全局开 → 每个
// 项目都显示已启用，真实启用行永不落库 → effectiveConfig 恒空 → 桥 0 server。
//
// 本文件锁 HTTP 读 seam 契约（对齐 plugins?project= 先例：project 模式下
// row.enabled = 该项目启用态，缺省 false）：
//   1. 无启用行 → project 模式 enabled=false（即使全局开关开）
//   2. setProjectEnabled(true) 后 → project 模式 enabled=true（持久化可读）
//   3. 无 project 参数 → enabled=全局开关（现状语义不变，防回归）
//
// seam：src/http/routes/mcp.js handleMcp（mock req/res 直调；DB 经
//   OPC_WORKSTATION_CONFIG_DIR 指向临时库——对齐 mcpHttpUpdate.test.js 先例）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadRoute() {
  const mod = await import("../../../../../../src/http/routes/mcp.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/mcp.js");
  assert.equal(typeof mod.handleMcp, "function", "导出 handleMcp");
  return mod;
}

function mockRes() {
  return {
    statusCode: 0,
    body: undefined,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : undefined;
      return this;
    },
  };
}

describe("REQ-AGENT-084 MCP server 项目感知 list（BUG-012 回归）", () => {
  let workdir;
  let handleMcp;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-http-plist-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ handleMcp } = await loadRoute());
    // seed 一个全局开关开的 server
    const res = mockRes();
    await handleMcp(
      { method: "POST" },
      res,
      { name: "firecrawl", type: "http", url: "https://mcp.example.com/v2/mcp" },
      []
    );
    assert.equal(res.statusCode, 200, `seed 失败: ${JSON.stringify(res.body)}`);
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function listWithProject(projectId) {
    const res = mockRes();
    await handleMcp(
      { method: "GET", url: `/api/mcp?project=${projectId}`, headers: { host: "localhost" } },
      res,
      undefined,
      []
    );
    assert.equal(res.statusCode, 200, `list 失败: ${JSON.stringify(res.body)}`);
    return res.body;
  }

  it("无启用行 → ?project= 模式 enabled=false（即使全局开关开）", async () => {
    const rows = await listWithProject("proj-a");
    const row = (rows ?? []).find((r) => r.name === "firecrawl");
    assert.ok(row, "list 应含 firecrawl");
    assert.equal(row.enabled, false, "无启用行时项目启用态必须为 false（全局开关不得冒充）");
  });

  it("setProjectEnabled(true) 后 → ?project= 模式 enabled=true（启用态持久化可读）", async () => {
    const enableRes = mockRes();
    await handleMcp(
      { method: "POST" },
      enableRes,
      { projectId: "proj-a", enabled: true },
      ["firecrawl", "project-enable"]
    );
    assert.equal(enableRes.statusCode, 200, `project-enable 失败: ${JSON.stringify(enableRes.body)}`);

    const rows = await listWithProject("proj-a");
    const row = (rows ?? []).find((r) => r.name === "firecrawl");
    assert.equal(row.enabled, true, "启用后 ?project= 模式应反映 true");

    // 其他项目视角仍为 false（启用是项目级的）
    const other = await listWithProject("proj-b");
    assert.equal((other ?? []).find((r) => r.name === "firecrawl").enabled, false);
  });

  it("无 project 参数 → enabled=全局开关（现状语义不变）", async () => {
    const res = mockRes();
    await handleMcp({ method: "GET", url: "/api/mcp", headers: { host: "localhost" } }, res, undefined, []);
    assert.equal(res.statusCode, 200);
    const row = (res.body ?? []).find((r) => r.name === "firecrawl");
    assert.equal(row.enabled, true, "无 project 参数时 enabled 保持全局开关语义");
  });
});
