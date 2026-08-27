// REQ-TRACE: REQ-SRC-004
// REQ-VERSION: v1-hash:4a2a2c821cb0ea95ccba724d23ab3dbaefcf5df398a23b9afe12b8b9852e1c03
// CAPABILITY-TRACE: collection-pipeline
// ENTITY-TRACE: content-source
// EXPECTED-TRACE: prd.md §6.3 row 3 & row 4
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { resolveSourceFeedUrl } from "../../../../../../src/services/contentSourceService.js";

describe("REQ-SRC-004: 社交账号自动映射与带鉴权路由生成", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
    // 预置 RSSHub 全局配置
    await fetch(`${serverCtx.baseUrl}/api/settings/credentials/rsshub`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: "http://localhost:1200",
        accessKey: "test-access-key",
      }),
    });
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("创建 X 内容源，自动去除 @ 前缀并支持创建，正确解析路由 URL", async () => {
    // EXPECTED-TRACE: prd.md §6.3 row 3
    const res = await fetch(`${serverCtx.baseUrl}/api/content-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Elon Musk X",
        type: "x",
        tags: ["tech", "kol"],
        config: "@elonmusk",
      }),
    });
    assert.equal(res.status, 201, `创建 X 内容源应成功: ${await res.clone().text()}`);
    const data = await res.json();
    assert.equal(data.type, "x");
    assert.equal(data.config, "@elonmusk");

    // 强化断言：验证路由解析函数输出符合 PRD §6.3 row 3
    const resolved = resolveSourceFeedUrl(data);
    assert.equal(resolved.url, "http://localhost:1200/twitter/user/elonmusk");
    assert.equal(resolved.isRsshub, true);
    assert.equal(resolved.accessKey, "test-access-key");
  });

  it("创建 Bilibili 内容源，纯数字 UID 校验通过并解析为视频路由", async () => {
    // EXPECTED-TRACE: prd.md §6.3 row 4
    const res = await fetch(`${serverCtx.baseUrl}/api/content-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "影视飓风",
        type: "bilibili",
        tags: ["video"],
        config: "2267573",
      }),
    });
    assert.equal(res.status, 201, `创建 Bilibili 内容源应成功: ${await res.clone().text()}`);
    const data = await res.json();
    assert.equal(data.type, "bilibili");
    assert.equal(data.config, "2267573");

    // 强化断言：验证路由解析函数输出符合 PRD §6.3 row 4
    const resolved = resolveSourceFeedUrl(data);
    assert.equal(resolved.url, "http://localhost:1200/bilibili/user/video/2267573");
    assert.equal(resolved.isRsshub, true);
  });

  it("Bilibili 非纯数字 UID 校验拦截（400 E-SRC-CONFIG）", async () => {
    // EXPECTED-TRACE: prd.md §7 表单与输入验证 row 4
    const res = await fetch(`${serverCtx.baseUrl}/api/content-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "非法UID",
        type: "bilibili",
        tags: ["test"],
        config: "UID_invalid123",
      }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, "E-SRC-CONFIG");
  });

  it("微信公众号内容源合法保存并解析为公众号历史消息路由", async () => {
    // EXPECTED-TRACE: prd.md §7 表单与输入验证 row 5
    const res = await fetch(`${serverCtx.baseUrl}/api/content-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "机器之心",
        type: "wechat",
        tags: ["ai"],
        config: "almosthuman2014",
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.type, "wechat");

    const resolved = resolveSourceFeedUrl(data);
    assert.equal(resolved.url, "http://localhost:1200/wechat/mp/msghistory/almosthuman2014");
    assert.equal(resolved.isRsshub, true);
  });

  it("未配置 RSSHub 时调用 resolveSourceFeedUrl 抛出 E-RSSHUB-NOT-CONFIGURED", async () => {
    // EXPECTED-TRACE: prd.md §8 E4
    const { saveSettingsRaw, loadSettings } = await import("../../../../../../src/services/settingsService.js");
    saveSettingsRaw({ ...loadSettings(), credentials: {} });

    const source = { type: "x", config: "testuser" };
    assert.throws(
      () => resolveSourceFeedUrl(source),
      (err) => err.code === "E-RSSHUB-NOT-CONFIGURED" && err.unconfigured === true
    );
  });
});
