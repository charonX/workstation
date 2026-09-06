// REQ-TRACE: 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-002, 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-004, 2026-09-06-cli-service-connection/REQ-CLI-SERVICE-005
// REQ-VERSION: v1-hash:7a08fa0c5ef0d0de30c2e6ac387f5cfc7b3534a2baebed30b2dc11edbe6563a9
// CAPABILITY-TRACE: plugin-management
// ENTITY-TRACE: cli-service
// EXPECTED-TRACE: prd.md §6.3 块 3, §10.4 接口 1/2/3 全部 golden values
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true (2026-09-06 assertion signoff, 见 signoff.md)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadRoute() {
  const mod = await import("../../../../../../src/http/routes/cliServices.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/cliServices.js 尚未实现（REQ-CLI-SERVICE-004）");
  assert.equal(typeof mod.handleCliServices, "function", "导出 handleCliServices");
  return mod;
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      if (payload) {
        try {
          this.body = JSON.parse(payload);
        } catch {
          this.body = payload;
        }
      }
      return this;
    },
  };
}

function mockReq(method, url, body = null) {
  const [pathname, search] = url.split("?");
  const query = Object.fromEntries(new URLSearchParams(search || ""));
  return {
    method,
    url,
    pathname,
    query,
    headers: { host: "127.0.0.1:3000" },
    on(event, cb) {
      if (event === "data" && body) cb(JSON.stringify(body));
      if (event === "end") cb();
      return this;
    },
  };
}

describe("REQ-CLI-SERVICE-004/005 CLI 服务 HTTP 路由与接口契约", () => {
  let workdir;
  let handleCliServices;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-http-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    ({ handleCliServices } = await loadRoute());
  });

  afterEach(() => {
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("接口 1：GET /api/cli-services 获取服务列表与探测结果（golden values 对齐）", async () => {
    const req = mockReq("GET", "/api/cli-services");
    const res = mockRes();

    await handleCliServices(req, res, req.pathname, req.query);

    // EXPECTED-TRACE: prd.md §10.4 接口 1
    assert.equal(res.statusCode, 200);
    assert.ok(res.body && Array.isArray(res.body.services), "返回 services 数组");
    assert.equal(res.body.services.length, 3, "列表包含 3 个内置服务");

    const claude = res.body.services.find((s) => s.id === "claude");
    assert.ok(claude, "存在 claude 条目");
    assert.equal(claude.id, "claude");
    assert.equal(typeof claude.installed, "boolean");
    assert.ok(Array.isArray(claude.envKeys), "包含 envKeys 数组且无明文 env");
    assert.ok(!claude.env, "严禁返回明文 env 字典");
  });

  it("接口 1：GET /api/cli-services?refresh=1 强制刷新探测", async () => {
    const req = mockReq("GET", "/api/cli-services?refresh=1");
    const res = mockRes();

    await handleCliServices(req, res, req.pathname, req.query);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.services.length === 3);
  });

  it("接口 2：PUT /api/cli-services/:id 配置修改（超时/env）与未知 id 404", async () => {
    // 未知 id 404
    const badReq = mockReq("PUT", "/api/cli-services/unknown-tool", { timeoutSec: 100 });
    const badRes = mockRes();
    await handleCliServices(badReq, badRes, badReq.pathname, badReq.query);
    // EXPECTED-TRACE: prd.md §10.4 接口 2
    assert.equal(badRes.statusCode, 404);
    assert.equal(badRes.body.error, "E-CLI-UNKNOWN-ID");

    // 合法修改 claude 的 timeoutSec
    const req = mockReq("PUT", "/api/cli-services/claude", { timeoutSec: 200 });
    const res = mockRes();
    await handleCliServices(req, res, req.pathname, req.query);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.service.timeoutSec, 200);
  });

  it("接口 2：PUT /api/cli-services/:id 传入非法 env KEY 报 400 E-CLI-INVALID-ENV-KEY", async () => {
    const req = mockReq("PUT", "/api/cli-services/claude", {
      env: { "bad-lowercase-key": "val" },
    });
    const res = mockRes();
    await handleCliServices(req, res, req.pathname, req.query);

    // EXPECTED-TRACE: prd.md §10.4 接口 2, §8 E4
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "E-CLI-INVALID-ENV-KEY");
  });

  it("接口 3：PUT /api/cli-services/:id/projects/:projectId 全局未启用时返回 409", async () => {
    // codex 未全局启用时，试图在项目内启用
    const req = mockReq("PUT", "/api/cli-services/codex/projects/proj-1", {
      enabled: true,
    });
    const res = mockRes();
    await handleCliServices(req, res, req.pathname, req.query);

    // EXPECTED-TRACE: prd.md §10.4 接口 3, §7.1 规则 3
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "E-CLI-GLOBALLY-DISABLED");
  });
});
