// REQ-TRACE: REQ-SRC-005
// REQ-VERSION: v1-hash:4a2a2c821cb0ea95ccba724d23ab3dbaefcf5df398a23b9afe12b8b9852e1c03
// CAPABILITY-TRACE: collection-pipeline
// ENTITY-TRACE: content-source
// EXPECTED-TRACE: prd.md §6.3 row 5 & row 6
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <link>https://example.com</link>
    <description>Sample RSS</description>
    <item>
      <title>Hello RSS</title>
      <link>https://example.com/hello</link>
      <pubDate>Mon, 24 Aug 2026 12:00:00 GMT</pubDate>
      <description>World description</description>
      <author>test@example.com (Author Name)</author>
    </item>
  </channel>
</rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link href="https://example.com"/>
  <entry>
    <title>Hello Atom</title>
    <link href="https://example.com/atom-entry"/>
    <updated>2026-08-24T12:00:00Z</updated>
    <summary>Atom description</summary>
    <author>
      <name>Alice</name>
    </author>
  </entry>
</feed>`;

describe("REQ-SRC-005: 带鉴权的 Feed 抓取与标准化 XML 解析", () => {
  let serverCtx;
  let mockServer;
  let mockPort;
  let lastRequestHeaders;

  beforeEach(async () => {
    serverCtx = await startServer();
    lastRequestHeaders = null;

    mockServer = http.createServer((req, res) => {
      lastRequestHeaders = req.headers;
      if (req.url.includes("/atom")) {
        res.writeHead(200, { "Content-Type": "application/atom+xml" });
        res.end(ATOM_SAMPLE);
      } else if (req.url.includes("/invalid")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>Not XML</body></html>");
      } else {
        res.writeHead(200, { "Content-Type": "application/rss+xml" });
        res.end(RSS_SAMPLE);
      }
    });

    await new Promise((resolve) => mockServer.listen(0, resolve));
    mockPort = mockServer.address().port;
  });

  afterEach(async () => {
    mockServer.close();
    await stopServer(serverCtx);
  });

  it("抓取标准 RSS 2.0 内容源并归一化输出字段", async () => {
    // EXPECTED-TRACE: prd.md §6.3 row 6
    // 1. 创建 RSS 内容源
    const createRes = await fetch(`${serverCtx.baseUrl}/api/content-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Mock RSS",
        type: "rss",
        tags: ["test"],
        config: `http://localhost:${mockPort}/feed.xml`,
      }),
    });
    assert.equal(createRes.status, 201);
    const source = await createRes.json();

    // 2. 调用抓取端点
    const fetchRes = await fetch(`${serverCtx.baseUrl}/api/content-sources/${source.id}/fetch`, {
      method: "POST",
    });
    assert.equal(fetchRes.status, 200, `抓取接口应成功: ${await fetchRes.clone().text()}`);
    const result = await fetchRes.json();

    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(Array.isArray(result.items), true);
    const item = result.items[0];
    assert.equal(item.title, "Hello RSS");
    assert.equal(item.link, "https://example.com/hello");
    assert.match(item.pubDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.equal(item.content, "World description");
  });

  it("抓取 Atom 格式源并统一归一化", async () => {
    const createRes = await fetch(`${serverCtx.baseUrl}/api/content-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Mock Atom",
        type: "rss",
        tags: ["test"],
        config: `http://localhost:${mockPort}/atom.xml`,
      }),
    });
    const source = await createRes.json();

    const fetchRes = await fetch(`${serverCtx.baseUrl}/api/content-sources/${source.id}/fetch`, {
      method: "POST",
    });
    assert.equal(fetchRes.status, 200);
    const result = await fetchRes.json();
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.equal(result.items[0].title, "Hello Atom");
    assert.equal(result.items[0].link, "https://example.com/atom-entry");
    assert.equal(result.items[0].content, "Atom description");
    assert.equal(result.items[0].author, "Alice");
    assert.match(result.items[0].pubDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("自动注入已配置的 RSSHub AccessKey 请求头", async () => {
    // EXPECTED-TRACE: prd.md §6.3 row 5
    // 配置全局 RSSHub 凭据为 mockServer 地址
    await fetch(`${serverCtx.baseUrl}/api/settings/credentials/rsshub`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: `http://localhost:${mockPort}`,
        accessKey: "secret-bearer-token-888",
      }),
    });

    // 创建 X 内容源
    const createRes = await fetch(`${serverCtx.baseUrl}/api/content-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test X Key Injection",
        type: "x",
        tags: ["test"],
        config: "@jack",
      }),
    });
    const source = await createRes.json();

    // 抓取该社交源
    await fetch(`${serverCtx.baseUrl}/api/content-sources/${source.id}/fetch`, {
      method: "POST",
    });

    // 验证发往 mockServer 的请求头中携带了 Bearer token
    assert.ok(lastRequestHeaders);
    assert.equal(
      lastRequestHeaders.authorization,
      "Bearer secret-bearer-token-888",
      "应自动注入 Authorization: Bearer <key> 请求头"
    );
  });

  it("目标返回非 XML 时返回 400 E-FEED-PARSE-FAILED", async () => {
    // EXPECTED-TRACE: prd.md §8 E5
    const createRes = await fetch(`${serverCtx.baseUrl}/api/content-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Invalid Source",
        type: "rss",
        tags: ["test"],
        config: `http://localhost:${mockPort}/invalid`,
      }),
    });
    const source = await createRes.json();

    const fetchRes = await fetch(`${serverCtx.baseUrl}/api/content-sources/${source.id}/fetch`, {
      method: "POST",
    });
    assert.equal(fetchRes.status, 400);
    const result = await fetchRes.json();
    assert.equal(result.code, "E-FEED-PARSE-FAILED");
  });
});
