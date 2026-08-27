// REQ-TRACE: REQ-CRED-001, REQ-CRED-002
// REQ-VERSION: v1-hash:4a2a2c821cb0ea95ccba724d23ab3dbaefcf5df398a23b9afe12b8b9852e1c03
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: credentials
// EXPECTED-TRACE: prd.md §6.3 row 1
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

describe("REQ-CRED-001 & REQ-CRED-002: 服务凭据管理与连通性测试", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("保存 RSSHub 凭据成功，GET 返回脱敏只读视图（无明文 Key）", async () => {
    // EXPECTED-TRACE: prd.md §6.3 row 1 & row 2
    const putRes = await fetch(`${serverCtx.baseUrl}/api/settings/credentials/rsshub`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "http://localhost:1200/",
        accessKey: "my-secret-key-123",
      }),
    });
    assert.equal(putRes.status, 200, `PUT 应成功: ${await putRes.clone().text()}`);
    const putData = await putRes.json();
    assert.equal(putData.service, "rsshub");
    assert.equal(putData.baseUrl, "http://localhost:1200", "应自动去除尾部斜杠");
    assert.equal(putData.configured, true);
    assert.equal(putData.accessKey, undefined, "保存响应不应泄露明文 key");

    // GET 读取脱敏视图
    const getRes = await fetch(`${serverCtx.baseUrl}/api/settings/credentials`);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(getData.credentials, "响应应包含 credentials 字典");
    assert.ok(getData.credentials.rsshub, "应包含 rsshub 配置");
    assert.equal(getData.credentials.rsshub.baseUrl, "http://localhost:1200");
    assert.equal(getData.credentials.rsshub.configured, true);
    assert.equal(getData.credentials.rsshub.accessKey, undefined, "GET 绝不返回明文 Key");
    assert.equal(getData.credentials.rsshub.accessKeyEncrypted, undefined, "GET 绝不返回密文 Key");
  });

  it("部分更新：不传 accessKey 时保留原加密 Key", async () => {
    // 先写入带 key 凭据
    await fetch(`${serverCtx.baseUrl}/api/settings/credentials/rsshub`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "http://localhost:1200",
        accessKey: "original-key",
      }),
    });

    // 仅更新 baseUrl
    const updateRes = await fetch(`${serverCtx.baseUrl}/api/settings/credentials/rsshub`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://rsshub.custom.org",
      }),
    });
    assert.equal(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.equal(updateData.baseUrl, "https://rsshub.custom.org");
    assert.equal(updateData.configured, true, "configured 仍应为 true（保留原 key）");
  });

  it("支持保存与读取其他扩展服务凭据（多服务通用性）", async () => {
    const putRes = await fetch(`${serverCtx.baseUrl}/api/settings/credentials/custom_service`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "https://api.custom.com",
        accessKey: "custom-token",
      }),
    });
    assert.equal(putRes.status, 200);

    const getRes = await fetch(`${serverCtx.baseUrl}/api/settings/credentials`);
    const getData = await getRes.json();
    assert.ok(getData.credentials.custom_service);
    assert.equal(getData.credentials.custom_service.baseUrl, "https://api.custom.com");
    assert.equal(getData.credentials.custom_service.configured, true);
  });

  it("非法 Base URL 校验拦截（400 E-CONFIG-INVALID）", async () => {
    // EXPECTED-TRACE: prd.md §7 表单与输入验证 row 1
    const res = await fetch(`${serverCtx.baseUrl}/api/settings/credentials/rsshub`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "ftp://127.0.0.1",
        accessKey: "test",
      }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, "E-CONFIG-INVALID");
  });

  it("REQ-CRED-002: 测试连接成功返回 latencyMs", async () => {
    // 启动本地 mock RSSHub server
    const mockServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("RSSHub Mock Instance");
    });
    await new Promise((resolve) => mockServer.listen(0, resolve));
    const mockPort = mockServer.address().port;
    const mockUrl = `http://localhost:${mockPort}`;

    try {
      const testRes = await fetch(`${serverCtx.baseUrl}/api/settings/credentials/rsshub/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: mockUrl,
          accessKey: "valid-key",
        }),
      });
      assert.equal(testRes.status, 200);
      const testData = await testRes.json();
      assert.equal(testData.ok, true);
      assert.ok(typeof testData.latencyMs === "number" && testData.latencyMs >= 0);
    } finally {
      mockServer.close();
    }
  });

  it("REQ-CRED-002: 测试连接目标返回 401/403 鉴权失败时返回 E-CRED-AUTH-FAILED", async () => {
    // EXPECTED-TRACE: prd.md §8 E3
    const mockServer = http.createServer((req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized access" }));
    });
    await new Promise((resolve) => mockServer.listen(0, resolve));
    const mockPort = mockServer.address().port;
    const mockUrl = `http://localhost:${mockPort}`;

    try {
      const testRes = await fetch(`${serverCtx.baseUrl}/api/settings/credentials/rsshub/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: mockUrl,
          accessKey: "invalid-key",
        }),
      });
      assert.equal(testRes.status, 200);
      const testData = await testRes.json();
      assert.equal(testData.ok, false);
      assert.equal(testData.error, "E-CRED-AUTH-FAILED");
      assert.ok(typeof testData.latencyMs === "number");
    } finally {
      mockServer.close();
    }
  });

  it("REQ-CRED-002: 测试连接目标不可达返回错误", async () => {
    // EXPECTED-TRACE: prd.md §8 E2
    const testRes = await fetch(`${serverCtx.baseUrl}/api/settings/credentials/rsshub/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "http://localhost:59999",
      }),
    });
    assert.equal(testRes.status, 200);
    const testData = await testRes.json();
    assert.equal(testData.ok, false);
    assert.ok(testData.error === "ECONNREFUSED" || testData.error === "E-CRED-CONN-FAILED");
  });
});
