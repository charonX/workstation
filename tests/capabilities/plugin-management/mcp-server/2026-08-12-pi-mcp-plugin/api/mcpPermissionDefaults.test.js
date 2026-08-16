// REQ-TRACE: 2026-08-12-pi-mcp-plugin/REQ-AGENT-087
// REQ-VERSION: v1-hash:7051b638e8a78c81a06fdaa5c64aaf5a48f422c35401c11113f11a033386cc06
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: mcp-server
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false (BUG-014 req-gap 补全新增 AC8/AC9：用户级默认层——
//   MCP 页可编辑的默认权限（存 workstation DB），项目页 mcp 族为覆盖层)

// BUG-014 回归（req-gap 就地补全，人确认 2026-08-16，人拍板「默认层存 workstation DB」）：
// 「MCP 权限默认层」服务端 seam——GET/PUT /api/mcp/permission-defaults + 视图/部署合并。
//
// 锁定契约（REQ-AGENT-087 AC8/AC9）：
//   AC8a  GET 空默认层 → 200 { rules: {} }
//   AC8b  PUT { rules } 全量替换 → GET 回读同 map（插入序保持）
//   AC8c  非法 verdict / pattern 缺「:」→ 4xx；server 名撞保留字 permission-defaults → 4xx
//   AC9a  视图合并：getPermissionView 的 mcp 族行 global = 默认层值；
//         项目文件显式规则仍标 projectOverridden（覆盖语义不变）
//   AC9b  部署合并纯函数：默认层 pattern 追加进 permission.mcp 且 "*" 保持首位
//         （gotgenes 同层 last-match-wins——具体 pattern 必须后于 "*" 才生效）；
//         空默认层 → 原样；输入对象不可变
//
// seam 1：src/http/routes/mcp.js handleMcp（mock req/res 直调；DB 经
//   OPC_WORKSTATION_CONFIG_DIR 指向临时库——对齐 mcpProbeTools.test.js 先例）。
// seam 2：真实 HTTP server（startServer，进程级临时 DB）+ 真实项目 fixture
//   （对齐 permissionConfig.test.js 先例）——AC9a 视图合并走全栈。
// seam 3：src/services/mcpPermissionDefaults.js 纯函数 mergeMcpDefaultsIntoPolicy
//   （worker 部署合并的单一真源，直接单测）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { startServer, stopServer } from "../../../../../../src/http/server.js";

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

async function callRoute(handleMcp, method, parts, body) {
  const res = mockRes();
  await handleMcp(
    { method, url: `/api/mcp/${parts.join("/")}`, headers: { host: "localhost" } },
    res,
    body,
    parts
  );
  return res;
}

describe("REQ-AGENT-087 AC8 默认权限层 CRUD GET/PUT /api/mcp/permission-defaults（BUG-014）", () => {
  let workdir;
  let handleMcp;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-perm-defaults-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ handleMcp } = await loadRoute());
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("AC8a：空默认层 → 200 { rules: {} }", async () => {
    const res = await callRoute(handleMcp, "GET", ["permission-defaults"]);
    assert.equal(res.statusCode, 200, `应为 200: ${JSON.stringify(res.body)}`);
    assert.deepEqual(res.body, { rules: {} });
  });

  it("AC8b：PUT 全量替换 → GET 回读同 map（插入序保持）", async () => {
    const rules = { "local-db:query_*": "allow", "github:*": "deny" };
    const put = await callRoute(handleMcp, "PUT", ["permission-defaults"], { rules });
    assert.equal(put.statusCode, 200, `PUT 应为 200: ${JSON.stringify(put.body)}`);

    const get = await callRoute(handleMcp, "GET", ["permission-defaults"]);
    assert.equal(get.statusCode, 200);
    assert.deepEqual(get.body.rules, rules);
    assert.deepEqual(Object.keys(get.body.rules), ["local-db:query_*", "github:*"], "插入序保持");

    // 全量替换语义：再 PUT 只含一条 → 前两条消失
    const put2 = await callRoute(handleMcp, "PUT", ["permission-defaults"], { rules: { "x:y": "ask" } });
    assert.equal(put2.statusCode, 200);
    const get2 = await callRoute(handleMcp, "GET", ["permission-defaults"]);
    assert.deepEqual(get2.body.rules, { "x:y": "ask" });
  });

  it("AC8c：非法 verdict / pattern 缺「:」→ 4xx（不落库）", async () => {
    const bad1 = await callRoute(handleMcp, "PUT", ["permission-defaults"], { rules: { "a:b": "maybe" } });
    assert.ok(bad1.statusCode >= 400 && bad1.statusCode < 500, `非法 verdict 应 4xx: ${bad1.statusCode}`);
    const bad2 = await callRoute(handleMcp, "PUT", ["permission-defaults"], { rules: { "no-colon": "ask" } });
    assert.ok(bad2.statusCode >= 400 && bad2.statusCode < 500, `pattern 缺冒号应 4xx: ${bad2.statusCode}`);
    const get = await callRoute(handleMcp, "GET", ["permission-defaults"]);
    assert.deepEqual(get.body.rules, {}, "非法 PUT 不落库");
  });

  it("AC8d：server 名撞保留字 permission-defaults → 4xx", async () => {
    const res = await callRoute(handleMcp, "POST", [], {
      name: "permission-defaults",
      type: "stdio",
      command: "x",
    });
    assert.ok(res.statusCode >= 400 && res.statusCode < 500, `保留字应 4xx: ${res.statusCode}`);
  });
});

describe("REQ-AGENT-087 AC9a 视图合并（BUG-014，startServer 全栈）", () => {
  let serverCtx;
  let workdir;
  let project;
  let savedDbPath;

  beforeEach(async () => {
    savedDbPath = process.env.DB_PATH;
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-perm-view-"));
    serverCtx = await startServer();
    const res = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "PermView", localPath: workdir, agentTypes: [] }),
    });
    assert.equal(res.status, 201, `建项目 201: ${res.status}`);
    project = await res.json();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    if (savedDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = savedDbPath;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("默认层值成为 mcp 族行 global；项目显式规则仍标 projectOverridden", async () => {
    // 默认层：local-db:* = allow
    const put = await fetch(`${serverCtx.baseUrl}/api/mcp/permission-defaults`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: { "local-db:*": "allow" } }),
    });
    assert.equal(put.status, 200, `PUT 默认层 200: ${put.status}`);

    // 视图：默认层 pattern 出现在 mcp 族规则行，global = allow，未覆盖
    const view1 = await (await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`)).json();
    const row1 = (view1.rules ?? []).find((r) => r.family === "mcp" && r.readable === "local-db:*");
    assert.ok(row1, "默认层 pattern 应出现在 mcp 族规则行");
    assert.equal(row1.global, "allow", "global = 默认层值（非出厂 ask）");
    assert.equal(row1.projectOverridden ?? false, false, "未覆盖");

    // 项目文件写显式规则 local-db:* = deny → 覆盖语义不变
    const save = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: { mcp: { "local-db:*": "deny" } } }),
    });
    assert.equal(save.status, 200, `项目覆盖保存 200: ${save.status} ${await save.text().catch(() => "")}`);

    const view2 = await (await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`)).json();
    const row2 = (view2.rules ?? []).find((r) => r.family === "mcp" && r.readable === "local-db:*");
    assert.ok(row2, "覆盖后规则行仍在");
    assert.equal(row2.global, "allow", "global 仍为默认层值");
    assert.equal(row2.value, "deny", "项目覆盖值");
    assert.equal(row2.projectOverridden, true, "标项目覆盖");
  });
});

describe("REQ-AGENT-087 AC9b 部署合并纯函数 mergeMcpDefaultsIntoPolicy（BUG-014）", () => {
  it('默认层 pattern 追加且 "*" 保持首位；输入不可变；空默认层原样', async () => {
    const mod = await import("../../../../../../src/services/mcpPermissionDefaults.js").catch(() => null);
    assert.ok(mod, "seam 未就绪：src/services/mcpPermissionDefaults.js");
    assert.equal(typeof mod.mergeMcpDefaultsIntoPolicy, "function", "导出 mergeMcpDefaultsIntoPolicy");

    const policy = { permission: { mcp: { "*": "ask" }, bash: { "rm *": "ask" } }, other: true };
    const snapshot = JSON.parse(JSON.stringify(policy));
    const merged = mod.mergeMcpDefaultsIntoPolicy(policy, {
      "local-db:*": "allow",
      "github:create_issue": "deny",
    });
    assert.deepEqual(
      Object.keys(merged.permission.mcp),
      ["*", "local-db:*", "github:create_issue"],
      '"*" 首位，用户 pattern 追加在后（last-match-wins）'
    );
    assert.equal(merged.permission.mcp["local-db:*"], "allow");
    assert.equal(merged.permission.mcp["github:create_issue"], "deny");
    assert.deepEqual(merged.permission.bash, { "rm *": "ask" }, "其他族不动");
    assert.deepEqual(policy, snapshot, "输入对象不可变");

    // 空默认层 → 语义原样
    const noop = mod.mergeMcpDefaultsIntoPolicy(policy, {});
    assert.deepEqual(noop.permission.mcp, { "*": "ask" });
  });
});
