// REQ-TRACE: REQ-WORKSPACE-020
// REQ-VERSION: v1-hash:f255c1918d40e06767b8129157cdcde68091d02015b0b577fa7c03b449fa5d8f
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: server
// EXPECTED-TRACE: prd.md §6.3 锚点（badRequest / notFound 响应形态）+ §10.2 responders 导出规范
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as responders from "../../../../../../src/http/responders.js";

function createMockResponse() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = { ...this.headers, ...headers };
      return this;
    },
    end(chunk = "") {
      this.body = chunk;
      return this;
    }
  };
}

describe("REQ-WORKSPACE-020 统一 HTTP 响应助手与错误映射收敛", () => {
  it("AC1: src/http/responders.js 导出完整的标准化助手集合", () => {
    // EXPECTED-TRACE: prd.md §10.2 导出规范
    assert.equal(typeof responders.ok, "function", "必须导出 ok");
    assert.equal(typeof responders.noContent, "function", "必须导出 noContent");
    assert.equal(typeof responders.badRequest, "function", "必须导出 badRequest");
    assert.equal(typeof responders.notFound, "function", "必须导出 notFound");
    assert.equal(typeof responders.mapError, "function", "必须导出 mapError");
    assert.equal(typeof responders.decodeParam, "function", "必须导出 decodeParam");
    assert.equal(typeof responders.normalizeBool, "function", "必须导出 normalizeBool");
  });

  it("AC2: ok / noContent / badRequest / notFound 产生规范的 HTTP 响应", () => {
    // EXPECTED-TRACE: prd.md §6.3 锚点
    const res1 = createMockResponse();
    responders.ok(res1, { success: true });
    assert.equal(res1.statusCode, 200);
    assert.equal(JSON.parse(res1.body).success, true);

    const res2 = createMockResponse();
    responders.noContent(res2);
    assert.equal(res2.statusCode, 204);
    assert.equal(res2.body, "");

    const res3 = createMockResponse();
    responders.badRequest(res3, "参数错误", "CUSTOM_VALIDATION");
    assert.equal(res3.statusCode, 400);
    assert.deepEqual(JSON.parse(res3.body), { error: "CUSTOM_VALIDATION", message: "参数错误" });

    const res4 = createMockResponse();
    responders.notFound(res4, "未找到目标资源");
    assert.equal(res4.statusCode, 404);
    assert.deepEqual(JSON.parse(res4.body), { error: "NOT_FOUND", message: "未找到目标资源" });
  });

  it("AC3: mapError 正确处理状态码、业务错误码与 extra 字段透传", () => {
    // EXPECTED-TRACE: prd.md §6.2 分支与异常 / §10.2
    const res1 = createMockResponse();
    const err1 = new Error("缺少必填项");
    responders.mapError(res1, err1);
    assert.equal(res1.statusCode, 400);
    assert.deepEqual(JSON.parse(res1.body), { error: "VALIDATION_ERROR", message: "缺少必填项" });

    const res2 = createMockResponse();
    const err2 = new Error("资源不存在");
    err2.code = "E-RESOURCE-MISSING";
    err2.status = 404;
    responders.mapError(res2, err2);
    assert.equal(res2.statusCode, 404);
    assert.deepEqual(JSON.parse(res2.body), { error: "E-RESOURCE-MISSING", message: "资源不存在" });

    const res3 = createMockResponse();
    const err3 = new Error("非法 agent");
    err3.invalidAgents = ["agent-a", "agent-b"];
    responders.mapError(res3, err3);
    assert.equal(res3.statusCode, 400);
    assert.deepEqual(JSON.parse(res3.body).invalidAgents, ["agent-a", "agent-b"]);
  });

  it("AC4: decodeParam 与 normalizeBool 辅助函数行为正确", () => {
    // EXPECTED-TRACE: prd.md §7 表单与输入验证
    assert.equal(responders.decodeParam("hello%20world"), "hello world");
    assert.equal(responders.decodeParam("%E4%B8%AD%E6%96%87"), "中文");
    assert.equal(responders.decodeParam("%"), "%");

    assert.equal(responders.normalizeBool(true), true);
    assert.equal(responders.normalizeBool("true"), true);
    assert.equal(responders.normalizeBool(false), false);
    assert.equal(responders.normalizeBool("false"), false);
    assert.equal(responders.normalizeBool(undefined), false);
  });

  it("AC5: 5 个路由文件统一导入 responders.js，plugins 不再跨文件引用 mcp.js", () => {
    // EXPECTED-TRACE: prd.md §10.1 / §10.2
    const routesDir = path.resolve(process.cwd(), "src/http/routes");
    const targetFiles = ["mcp.js", "plugins.js", "skills.js", "projects.js", "settings.js"];

    for (const file of targetFiles) {
      const content = fs.readFileSync(path.join(routesDir, file), "utf8");
      assert.ok(content.includes("responders.js"), `${file} 必须导入 responders.js`);
    }

    const pluginsContent = fs.readFileSync(path.join(routesDir, "plugins.js"), "utf8");
    assert.equal(pluginsContent.includes('from "./mcp.js"'), false, "plugins.js 不得跨路由导入 mcp.js 的响应助手");
  });
});
