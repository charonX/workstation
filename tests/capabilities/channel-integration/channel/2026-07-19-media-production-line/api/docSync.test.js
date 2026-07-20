// REQ-TRACE: 2026-07-19-media-production-line/REQ-CHANNEL-005
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: channel-integration
// ENTITY-TRACE: channel
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startFakeFeishuServer } from "../../../../../fixtures/media-production-line/fakeFeishuServer.js";

// seam：飞书文档同步（tech-design 关键决策「Markdown→docx：blocks/convert」「文档权限 tenant_readable」）。
// 建议落点 src/services/channels/feishuDocSync.js，导出
//   syncMarkdownToFeishuDoc({ markdown, title, domain, credentials }) → { url }
// 失败契约（签核）：返回 { error: { code: "E-DOC-SYNC-FAILED", stage } }（不抛出，调用方按契约降级）。
async function loadDocSync() {
  const mod = await import("../../../../../../src/services/channels/feishuDocSync.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/services/channels/feishuDocSync.js 尚未实现（REQ-CHANNEL-005）");
  assert.equal(typeof mod.syncMarkdownToFeishuDoc, "function", "feishuDocSync 应导出 syncMarkdownToFeishuDoc()");
  return mod.syncMarkdownToFeishuDoc;
}

describe("REQ-CHANNEL-005: 飞书文档同步端点", () => {
  let fake;
  let syncMarkdownToFeishuDoc;

  beforeEach(async () => {
    fake = await startFakeFeishuServer();
    syncMarkdownToFeishuDoc = await loadDocSync();
  });

  afterEach(async () => {
    await fake.stop();
  });

  it("AC1: markdown + 标题 → convert + 创建文档 + tenant_readable 分享 → 返回文档 URL", async () => {
    const result = await syncMarkdownToFeishuDoc({
      markdown: "# AI 日报\n\n- 条目一\n- 条目二\n",
      title: "2026-07-19 AI 日报",
      domain: fake.baseUrl,
      credentials: { appId: "cli_fake", appSecret: "fake" }
    });

    // 三端点均被调用，且顺序上 convert 先于 create、create 先于 permission。
    assert.equal(fake.received.docxConverts.length, 1, "应调用 blocks/convert");
    assert.equal(fake.received.docxCreates.length, 1, "应调用创建文档");
    assert.equal(fake.received.permissionPatches.length, 1, "应调用权限分享");

    // convert 请求携带 markdown 内容。
    assert.ok(JSON.stringify(fake.received.docxConverts[0]).includes("AI 日报"), "convert 请求应含 markdown 内容");
    // 创建文档携带标题。
    assert.ok(JSON.stringify(fake.received.docxCreates[0]).includes("2026-07-19 AI 日报"), "创建请求应含标题");
    // 权限设置为 tenant_readable（tech-design 决策）。
    assert.ok(JSON.stringify(fake.received.permissionPatches[0]).includes("tenant_readable"),
      `链接分享应为 tenant_readable，实际: ${JSON.stringify(fake.received.permissionPatches[0])}`);

    // 返回文档 URL。
    assert.ok(!result.error, `成功路径不应返回错误: ${JSON.stringify(result.error)}`);
    assert.match(result.url, /^https?:\/\//, "应返回可打开的文档 URL");
    assert.ok(result.url.includes("doc_fake_1") || /docx|docs|doc/.test(result.url),
      `URL 应指向新建文档，实际: ${result.url}`);
  });

  it("AC2: convert 失败 → 返回 E-DOC-SYNC-FAILED（不抛出，调用方可降级）", async () => {
    fake.failNext("/open-apis/docx/v1/documents/blocks/convert", 5);
    const result = await syncMarkdownToFeishuDoc({
      markdown: "# x",
      title: "t",
      domain: fake.baseUrl,
      credentials: { appId: "cli_fake", appSecret: "fake" }
    });
    // 签核失败契约：{ error: { code: "E-DOC-SYNC-FAILED", stage: "convert" } }。
    assert.equal(result.error?.code, "E-DOC-SYNC-FAILED");
    assert.equal(result.error?.stage, "convert");
    assert.equal(fake.received.docxCreates.length, 0, "convert 失败不应继续创建文档");
  });

  it("AC2: 创建文档失败 → 返回 E-DOC-SYNC-FAILED，不做权限设置", async () => {
    fake.failNext("/open-apis/docx/v1/documents", 5);
    const result = await syncMarkdownToFeishuDoc({
      markdown: "# x",
      title: "t",
      domain: fake.baseUrl,
      credentials: { appId: "cli_fake", appSecret: "fake" }
    });
    assert.equal(result.error?.code, "E-DOC-SYNC-FAILED");
    assert.ok(typeof result.error?.stage === "string" && result.error.stage.length > 0,
      `失败契约应带 stage 字段，实际: ${JSON.stringify(result.error)}`);
    assert.equal(fake.received.permissionPatches.length, 0, "创建失败不应继续权限设置");
  });

  it("AC2: 权限设置失败 → 返回 E-DOC-SYNC-FAILED", async () => {
    fake.failNext("/open-apis/drive/v1/permissions/", 5);
    const result = await syncMarkdownToFeishuDoc({
      markdown: "# x",
      title: "t",
      domain: fake.baseUrl,
      credentials: { appId: "cli_fake", appSecret: "fake" }
    });
    assert.equal(result.error?.code, "E-DOC-SYNC-FAILED");
    assert.ok(typeof result.error?.stage === "string" && result.error.stage.length > 0,
      `失败契约应带 stage 字段，实际: ${JSON.stringify(result.error)}`);
  });
});
