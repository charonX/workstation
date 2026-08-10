// REQ-TRACE: 2026-08-10-pi-permission-config-ui/REQ-AGENT-059, 2026-08-10-pi-permission-config-ui/REQ-AGENT-060, 2026-08-10-pi-permission-config-ui/REQ-AGENT-061, 2026-08-10-pi-permission-config-ui/REQ-AGENT-063, 2026-08-10-pi-permission-config-ui/REQ-AGENT-064, 2026-08-10-pi-permission-config-ui/REQ-AGENT-065, 2026-08-10-pi-permission-config-ui/REQ-AGENT-066, 2026-08-10-pi-permission-config-ui/REQ-AGENT-067, 2026-08-10-pi-permission-config-ui/REQ-AGENT-068
// REQ-VERSION: v1-hash:4b944146fd166a4f60e5ba65080efefeb75690ff7be837718c867c2d2c01b77d
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// 权限配置 API 面（REQ-AGENT-059~068）：GET 继承视图 / PUT 保存（最小覆盖集、
// 取消覆盖=删除、自定义字段保留、首次生成、校验 fail-closed）。
//
// seam 1：真实 HTTP server（startServer）+ 真实项目 fixture（createProject
//   localPath = 测试临时目录）——对齐 projectAgents.test.js 先例。
// seam 2：全局基底 = agent-policy/pi-permission-config.json 原文（部署 JSON，
//   运行时真相，Q1 拍板）。
// seam 3：gotgenes 校验对照（validateUnifiedConfig）——同输入喂两边，
//   保存拦截的 = 运行时 fail-closed 的（T5）。
//
// 测试基建 seam（如无）：
//   新建项目经 POST /api/projects {name, localPath, agentTypes: []}（既有契约）。
//   权限端点（未实现 → 404/500）：GET/PUT /api/projects/:id/permission。
//   项目删除经 DELETE /api/projects/:id（清理临时目录）。

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { startServer, stopServer } = require("../../../../../../src/http/server.js");

async function loadPermissionModule() {
  // 权限配置服务（BUILD 产物）：动态 import，本文件可加载、测试以 RED 失败而非 import 崩溃。
  const mod = await import("../../../../../../src/services/permissionConfigService.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/permissionConfigService.js 尚未实现（REQ-AGENT-059~068）");
  return mod;
}

async function createProject(baseUrl, { name = "PermProj", localPath } = {}) {
  const res = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, localPath, agentTypes: [] }),
  });
  assert.equal(res.status, 200, `createProject 失败: ${await res.text()}`);
  return res.json();
}

const GLOBAL_JSON = path.resolve(
  __dirname, "..", "..", "..", "..", "..", "..", "agent-policy", "pi-permission-config.json"
);

describe("REQ-AGENT-059/060/061 权限配置 API：GET 继承视图", () => {
  let serverCtx;
  let workdir;
  let project;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-get-"));
    serverCtx = await startServer();
    project = await createProject(serverCtx.baseUrl, { localPath: workdir });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("REQ-AGENT-060 标准 1：GET 的 global 字段 = 部署 JSON 原文", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`);
    assert.equal(res.status, 200);
    const body = await res.json();

    // TODO: HUMAN ASSERTION — 确认 global 与部署 JSON 逐字段一致
    const golden = JSON.parse(fs.readFileSync(GLOBAL_JSON, "utf8"));
    assert.deepEqual(body.global, golden);
  });

  it("REQ-AGENT-060 标准 2：rules[] bash 高危项带 family/label（BASH_RULES 注入对齐）", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`);
    const body = await res.json();

    // TODO: HUMAN ASSERTION — 确认 rm * 等规则带 family（如 destructive-fs）+ label（人可读）
    const rmRule = body.rules.find((r) => r.key === "permission.bash.rm *");
    assert.ok(rmRule, "rules 应含 permission.bash.rm *");
    assert.ok(rmRule.family, "rm * 应带 family");
    assert.ok(rmRule.label, "rm * 应带人可读 label");
    assert.equal(rmRule.readable, "rm *");
  });

  it("REQ-AGENT-060 标准 3：规则表有但部署 JSON 无的 pattern 不产生 rule 项", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`);
    const body = await res.json();

    // TODO: HUMAN ASSERTION — 确认每个 rule 的 key 都存在于 body.global（只返回实际部署的规则）
    for (const r of body.rules) {
      const parts = r.key.split(".");
      let cur = body.global;
      for (const p of parts) cur = cur?.[p];
      assert.ok(cur !== undefined, `rule key ${r.key} 应存在于部署 JSON`);
    }
  });

  it("REQ-AGENT-061 标准 2：无项目文件 → merged=全局，rules 全 source:global / value:null", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`);
    const body = await res.json();

    assert.equal(body.project, null);
    assert.deepEqual(body.merged, body.global);
    for (const r of body.rules) {
      assert.equal(r.source, "global");
      assert.equal(r.value, null);
      assert.equal(r.projectOverridden, false);
    }
  });

  it("REQ-AGENT-059 标准 3：无配置项目 GET 正常（project:null 供 UI 空态）", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.project, null);
  });

  it("项目不存在 → 404 E-PROJECT-NOT-FOUND", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/nonexistent/permission`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.code, "E-PROJECT-NOT-FOUND");
  });
});

describe("REQ-AGENT-062/063/064/065/067 权限配置 API：PUT 保存（最小覆盖集）", () => {
  let serverCtx;
  let workdir;
  let project;
  const piPath = () =>
    path.join(workdir, ".pi", "extensions", "pi-permission-system", "config.json");

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-put-"));
    serverCtx = await startServer();
    project = await createProject(serverCtx.baseUrl, { localPath: workdir });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("REQ-AGENT-067 标准 2：首次保存生成最小覆盖集文件（只含改动字段）", async () => {
    const config = { permission: { bash: { "rm *": "allow" } } };
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    assert.equal(res.status, 200, await res.text());

    assert.ok(fs.existsSync(piPath()), ".pi 文件应生成");
    const written = JSON.parse(fs.readFileSync(piPath(), "utf8"));
    // TODO: HUMAN ASSERTION — 确认只含覆盖项（最小覆盖集，ADR-022）
    assert.deepEqual(written, config);
  });

  it("REQ-AGENT-067 标准 3：首次保存后 GET → project 非 null，改动规则 source:project", async () => {
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: { write: "allow" } }),
    });
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`);
    const body = await res.json();
    assert.ok(body.project, "保存后 project 应非 null");
    const writeRule = body.rules.find((r) => r.key === "permission.write");
    assert.equal(writeRule.source, "project");
    assert.equal(writeRule.value, "allow");
    assert.equal(writeRule.projectOverridden, true);
  });

  it("REQ-AGENT-066 标准 3：面板保存保留 JSON 手写的自定义字段", async () => {
    const custom = { permission: { write: "allow" }, customOrgKey: { rule: "keep" } };
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(custom),
    });

    // 面板保存（只改 write，不含 customOrgKey——面板不认识的字段由前端保留，服务端原样写）
    const panel = { permission: { write: "ask" } };
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(panel),
    });

    const written = JSON.parse(fs.readFileSync(piPath(), "utf8"));
    // TODO: HUMAN ASSERTION — 确认自定义字段仍在文件中
    assert.deepEqual(written.customOrgKey, { rule: "keep" });
  });

  it("REQ-AGENT-066 标准 4：取消覆盖（字段不在请求 JSON）= 从文件删除", async () => {
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: { bash: { "rm *": "allow" }, write: "allow" } }),
    });
    // 取消 rm * 覆盖（仅保留 write）
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: { write: "allow" } }),
    });
    const written = JSON.parse(fs.readFileSync(piPath(), "utf8"));
    // TODO: HUMAN ASSERTION — 确认 rm * 字段已删除（回落全局），write 仍在
    assert.equal(written.permission.bash?.["rm *"], undefined);
    assert.equal(written.permission.write, "allow");
  });

  it("REQ-AGENT-063 标准 2：工具级 write 覆盖 → 文件含 write:allow", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: { write: "allow" } }),
    });
    assert.equal(res.status, 200);
    const written = JSON.parse(fs.readFileSync(piPath(), "utf8"));
    assert.equal(written.permission.write, "allow");
  });

  it("REQ-AGENT-064 标准 2/3：path 条目增删同步文件", async () => {
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: { path: { "src/**": "allow", "*": "allow" } } }),
    });
    let written = JSON.parse(fs.readFileSync(piPath(), "utf8"));
    assert.equal(written.permission.path["src/**"], "allow");

    // 删除 src/** 条目
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: { path: { "*": "allow" } } }),
    });
    written = JSON.parse(fs.readFileSync(piPath(), "utf8"));
    assert.equal(written.permission.path["src/**"], undefined);
  });

  it("REQ-AGENT-065 标准 1：authorizerChain 项目数组整体替换全局", async () => {
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorizerChain: ["opc-bridge", "custom-gate"] }),
    });
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`);
    const body = await res.json();
    // TODO: HUMAN ASSERTION — 确认 merged.authorizerChain = 项目数组（整体替换，非追加）
    assert.deepEqual(body.merged.authorizerChain, ["opc-bridge", "custom-gate"]);
  });

  it("REQ-AGENT-065 标准 2：开关切换 → 文件对应字段更新", async () => {
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yoloMode: true, debugLog: false }),
    });
    const written = JSON.parse(fs.readFileSync(piPath(), "utf8"));
    assert.equal(written.yoloMode, true);
    assert.equal(written.debugLog, false);
  });

  it("REQ-AGENT-069 前置：保存响应带 mtime", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: { write: "allow" } }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    // TODO: HUMAN ASSERTION — 确认响应含 mtime（数值/字符串均可）
    assert.ok(body.mtime !== undefined, "保存响应应带 mtime");
  });
});

describe("REQ-AGENT-068 保存校验 fail-closed", () => {
  let serverCtx;
  let workdir;
  let project;
  const piPath = () =>
    path.join(workdir, ".pi", "extensions", "pi-permission-system", "config.json");

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-val-"));
    serverCtx = await startServer();
    project = await createProject(serverCtx.baseUrl, { localPath: workdir });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("REQ-AGENT-068 标准 1：非法 JSON（语法错）→ 400 + issues 定位；文件未变", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "E-PERMISSION-INVALID");
    assert.ok(Array.isArray(body.issues) && body.issues.length > 0);
    assert.ok(!fs.existsSync(piPath()), "非法保存不得落盘");
  });

  it("REQ-AGENT-068 标准 2：schema 不合法 → 400 + issues 含路径；文件未变", async () => {
    // 先有合法文件，再存非法（覆盖语义下文件不得被污染）
    await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: { write: "allow" } }),
    });
    const before = fs.readFileSync(piPath(), "utf8");

    const res = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission: { bash: "ask" } }), // bash 应为对象，字符串非法
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.issues.some((i) => typeof i.path === "string" && i.path.length > 0));
    assert.equal(fs.readFileSync(piPath(), "utf8"), before, "非法保存不得改变现有文件");
  });

  it("REQ-AGENT-068 标准 3：400 判定与 gotgenes validateUnifiedConfig 一致（对照）", async () => {
    const mod = await loadPermissionModule();
    // 对照：非法输入（bash 字符串）——服务端拒绝 == gotgenes 拒绝
    const illegal = { permission: { bash: "ask" } };
    const serverRes = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/permission`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(illegal),
    });
    // TODO: HUMAN ASSERTION — 确认服务端校验器与 gotgenes validateUnifiedConfig 判定一致
    const gotgenesRejects = mod.validateWithGotgenes(illegal);
    assert.equal(serverRes.status === 400, gotgenesRejects, "服务端与 gotgenes 判定应一致");
  });
});
