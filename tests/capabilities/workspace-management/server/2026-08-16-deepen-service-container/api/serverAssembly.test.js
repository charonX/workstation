// REQ-TRACE: 2026-08-16-deepen-service-container/REQ-WORKSPACE-019
// REQ-VERSION: v1-hash:e34004c13ba54416d2b9151f375ae0daedea3adee9adc4d2f3a6ddfbbd00c56a
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: server
// EXPECTED-TRACE: prd.md §6.3 锚点（server.services 存在性 / 兼容代理 / 行数 ≤250 行 / import 依赖方向约束）+ §10.3 数据流
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-WORKSPACE-019（server.js 瘦身、server.services 注入与 _opcXxx 兼容代理）集成与架构静态检查直测。
//
// seam：src/http/server.js（startServer, stopServer）及 server.js 源码结构。

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

describe("REQ-WORKSPACE-019 server.js 瘦身、server.services 注入与 _opcXxx 兼容代理", () => {
  it("AC1: startServer 创建并挂载 server.services", async () => {
    // EXPECTED-TRACE: prd.md §6.3（server.services 存在性锚点）
    const serverCtx = await startServer({ reset: true, port: 0 });
    try {
      assert.ok(serverCtx.server.services, "server.services 必须挂载容器实例");
      assert.equal(typeof serverCtx.server.services.getSessionStore, "function", "server.services 必须暴露 getSessionStore");
      assert.equal(typeof serverCtx.server.services.getAgentService, "function", "server.services 必须暴露 getAgentService");
    } finally {
      await stopServer(serverCtx);
    }
  });

  it("AC2: handleRequest 经 server.services 注入路由并正常响应", async () => {
    // EXPECTED-TRACE: prd.md §10.3 数据流
    const serverCtx = await startServer({ reset: true, port: 0 });
    try {
      const res = await fetch(`${serverCtx.baseUrl}/api/settings`);
      assert.equal(res.status, 200, "GET /api/settings 经容器注入后必须返回 200");
      const data = await res.json();
      assert.ok(typeof data === "object", "响应必须为 JSON 对象");
    } finally {
      await stopServer(serverCtx);
    }
  });

  it("AC3: _opcXxx 兼容代理层可读且可写联动", async () => {
    // EXPECTED-TRACE: prd.md §6.3（兼容代理锚点）
    const serverCtx = await startServer({ reset: true, port: 0 });
    const { server } = serverCtx;
    try {
      // 1. 可读验证
      assert.equal(typeof server._opcSessionStoreFactory, "function", "_opcSessionStoreFactory 必须可读");
      assert.equal(typeof server._opcSseRegistryFactory, "function", "_opcSseRegistryFactory 必须可读");
      assert.equal(typeof server._opcConfirmationServiceFactory, "function", "_opcConfirmationServiceFactory 必须可读");
      assert.equal(typeof server._opcModeServiceFactory, "function", "_opcModeServiceFactory 必须可读");
      assert.equal(typeof server._opcPermissionBridgeFactory, "function", "_opcPermissionBridgeFactory 必须可读");
      assert.equal(typeof server._opcAgentServiceFactory, "function", "_opcAgentServiceFactory 必须可读");
      assert.equal(server._opcAgentService, null, "未拉起时 _opcAgentService 必须为 null");

      // 2. 模拟测试中的写入覆盖（如 confirmation.test.js 中的 _opcConfirmationServiceFactory 替换）
      const dummyFactory = () => ({ dummy: true });
      server._opcConfirmationServiceFactory = dummyFactory;
      assert.equal(server._opcConfirmationServiceFactory, dummyFactory, "写入 _opcConfirmationServiceFactory 必须生效");
    } finally {
      await stopServer(serverCtx);
    }
  });

  it("AC4: stopServer 联动 container.dispose 关停并释放端口", async () => {
    // EXPECTED-TRACE: prd.md §6.1 主路径
    const serverCtx = await startServer({ reset: true, port: 0 });
    await assert.doesNotReject(async () => {
      await stopServer(serverCtx);
    }, "stopServer 必须安全关停");
  });

  it("AC5: server.js 架构约束与行数瘦身（≤250 行）", () => {
    // EXPECTED-TRACE: prd.md §6.3（行数阈值 ≤250 行 & import 依赖方向约束）
    const serverJsPath = path.resolve(process.cwd(), "src/http/server.js");
    const serverJsContent = fs.readFileSync(serverJsPath, "utf-8");
    const lineCount = serverJsContent.split("\n").length;

    assert.ok(
      lineCount <= 250,
      `src/http/server.js 行数必须 ≤ 250 行（当前: ${lineCount} 行）`
    );

    // 静态检查：server.js 不得直接 import 8 个具体服务的创建工厂
    const forbiddenImports = [
      "createSessionStore",
      "createCardRenderer",
      "createConfirmationService",
      "createPermissionBridge",
      "createModeService",
      "createAgentService",
      "createImRouter",
    ];

    for (const forbidden of forbiddenImports) {
      assert.ok(
        !serverJsContent.includes(`import { ${forbidden}`) && !serverJsContent.includes(`import {${forbidden}`),
        `src/http/server.js 不得直接 import 具体服务工厂 ${forbidden}，装配必须收归 serviceContainer.js`
      );
    }
  });
});
