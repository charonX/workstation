// REQ-TRACE: 2026-07-19-media-production-line/REQ-SRC-001
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: collection-pipeline
// ENTITY-TRACE: content-source
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const VALID = {
  name: "Hacker News",
  type: "webpage",
  tags: ["科技", "新闻"],
  config: "https://news.ycombinator.com"
};

async function createSource(baseUrl, body = VALID) {
  return fetch(`${baseUrl}/api/content-sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("REQ-SRC-001: 内容源 CRUD", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("创建内容源成功，返回完整字段（全局归属，无 projectId）", async () => {
    const res = await createSource(serverCtx.baseUrl);
    assert.equal(res.status, 201, `实际: ${res.status} ${JSON.stringify(await res.clone().text())}`);
    const data = await res.json();
    for (const field of ["id", "name", "type", "tags", "config", "enabled", "createdAt"]) {
      assert.ok(field in data, `响应应含字段 ${field}`);
    }
    assert.equal(data.name, "Hacker News");
    assert.equal(data.type, "webpage");
    assert.deepEqual(data.tags, ["科技", "新闻"]);
    assert.equal(data.config, "https://news.ycombinator.com");
    assert.equal(data.enabled, true, "默认应为启用");
    assert.ok(!("projectId" in data) || data.projectId == null, "内容源为全局归属，不应有 projectId");
  });

  it("列表与单查返回已建内容源", async () => {
    const created = await (await createSource(serverCtx.baseUrl)).json();

    const list = await (await fetch(`${serverCtx.baseUrl}/api/content-sources`)).json();
    const items = Array.isArray(list) ? list : list.items;
    assert.ok(items.some((s) => s.id === created.id));

    const detailRes = await fetch(`${serverCtx.baseUrl}/api/content-sources/${created.id}`);
    assert.equal(detailRes.status, 200);
    assert.equal((await detailRes.json()).name, "Hacker News");
  });

  it("更新与启停切换", async () => {
    const created = await (await createSource(serverCtx.baseUrl)).json();
    const res = await fetch(`${serverCtx.baseUrl}/api/content-sources/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, tags: ["科技"] })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.enabled, false);
    assert.deepEqual(data.tags, ["科技"]);
  });

  it("删除内容源", async () => {
    const created = await (await createSource(serverCtx.baseUrl)).json();
    const del = await fetch(`${serverCtx.baseUrl}/api/content-sources/${created.id}`, { method: "DELETE" });
    assert.ok([200, 204].includes(del.status));
    const list = await (await fetch(`${serverCtx.baseUrl}/api/content-sources`)).json();
    const items = Array.isArray(list) ? list : list.items;
    assert.ok(!items.some((s) => s.id === created.id));
  });

  it("name 必填且 1–64 字符，违反报 E-SRC-NAME", async () => {
    for (const bad of [{ ...VALID, name: "" }, { ...VALID, name: "x".repeat(65) }, { ...VALID, name: undefined }]) {
      const res = await createSource(serverCtx.baseUrl, bad);
      assert.equal(res.status, 400, `name=${JSON.stringify(bad.name)} 应 400`);
      // 签核错误体形状：{ error: <码值>, message }。
      assert.equal((await res.json()).error, "E-SRC-NAME");
    }
  });

  it("type 枚举 webpage/rss/x/wechat，违反报 E-SRC-TYPE", async () => {
    const res = await createSource(serverCtx.baseUrl, { ...VALID, type: "tiktok" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "E-SRC-TYPE");
  });

  it("tags 至少 1 个且单个 ≤16 字符，违反报 E-SRC-TAG", async () => {
    for (const badTags of [[], ["ok", "t".repeat(17)]]) {
      const res = await createSource(serverCtx.baseUrl, { ...VALID, tags: badTags });
      assert.equal(res.status, 400, `tags=${JSON.stringify(badTags)} 应 400`);
      assert.equal((await res.json()).error, "E-SRC-TAG");
    }
  });

  it("webpage/rss 的 config 须为合法 http(s) URL，违反报 E-SRC-CONFIG", async () => {
    for (const bad of [
      { ...VALID, type: "webpage", config: "not-a-url" },
      { ...VALID, type: "rss", config: "ftp://example.com/feed" },
      { ...VALID, type: "rss", config: "" }
    ]) {
      const res = await createSource(serverCtx.baseUrl, bad);
      assert.equal(res.status, 400, `config=${JSON.stringify(bad.config)} 应 400`);
      assert.equal((await res.json()).error, "E-SRC-CONFIG");
    }
  });

  it("x/wechat 的 config 非空即可（账号标识），空则报 E-SRC-CONFIG", async () => {
    const okRes = await createSource(serverCtx.baseUrl, { name: "Karpathy 的 X", type: "x", tags: ["AI"], config: "@karpathy" });
    assert.equal(okRes.status, 201);

    const badRes = await createSource(serverCtx.baseUrl, { name: "空公众号", type: "wechat", tags: ["AI"], config: "" });
    assert.equal(badRes.status, 400);
    assert.equal((await badRes.json()).error, "E-SRC-CONFIG");
  });

  it("name 全局唯一，重复报 E-SRC-DUP（签核状态码 409）", async () => {
    assert.equal((await createSource(serverCtx.baseUrl)).status, 201);
    const dup = await createSource(serverCtx.baseUrl, { ...VALID, type: "rss", config: "https://example.com/feed" });
    assert.equal(dup.status, 409, "重复 name 应返回 409（签核状态码）");
    assert.equal((await dup.json()).error, "E-SRC-DUP");
  });
});
