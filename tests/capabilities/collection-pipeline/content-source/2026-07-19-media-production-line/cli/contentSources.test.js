// REQ-TRACE: 2026-07-19-media-production-line/REQ-SRC-001, 2026-07-19-media-production-line/REQ-SRC-002
// REQ-VERSION: v1-hash:de43bc8607a89efe5512712a188a5f24f259d8109cb31a7a476827dd0883fab9
// CAPABILITY-TRACE: collection-pipeline
// ENTITY-TRACE: content-source
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const CLI = "node src/cli/opc-workstation.js";
// 签核 CLI 面：`source create --name --type --config --tags "t1,t2"`（--tags 逗号分隔）、
// `source list [--tag t] [--enabled]`、`source update --id ...`、`source toggle --id`、`source delete --id`。

function runCli(args) {
  return execSync(`${CLI} ${args}`, { encoding: "utf-8" });
}

describe("REQ-SRC-001/002: 内容源 CLI", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("REQ-SRC-001: CLI 创建内容源并出现在 list 输出（机器可读 JSON）", () => {
    const out = runCli(`source create --name "Hacker News" --type webpage --config "https://news.ycombinator.com" --tags "科技,新闻"`);
    const created = JSON.parse(out);
    assert.ok(created.id);
    assert.equal(created.type, "webpage");
    assert.deepEqual(created.tags, ["科技", "新闻"]);

    const list = JSON.parse(runCli("source list"));
    const items = Array.isArray(list) ? list : list.items;
    assert.ok(items.some((s) => s.id === created.id));
  });

  it("REQ-SRC-001: CLI 校验错误与 API 一致（非法 type 报 E-SRC-TYPE，退出码 1）", () => {
    try {
      runCli(`source create --name "Bad" --type tiktok --config "x" --tags "t"`);
      assert.fail("应非零退出");
    } catch (error) {
      assert.equal(error.status, 1, "业务校验错误退出码应为 1");
      assert.match(error.stderr, /E-SRC-TYPE/);
    }
  });

  it("REQ-SRC-001: CLI 启停切换与删除", () => {
    const created = JSON.parse(runCli(`source create --name "RSS Source" --type rss --config "https://example.com/feed" --tags "技术"`));
    const toggled = JSON.parse(runCli(`source toggle --id ${created.id}`));
    assert.equal(toggled.enabled, false);

    runCli(`source delete --id ${created.id}`);
    const list = JSON.parse(runCli("source list"));
    const items = Array.isArray(list) ? list : list.items;
    assert.ok(!items.some((s) => s.id === created.id));
  });

  it("REQ-SRC-002 AC1: source list --tag <t> --enabled 仅返回启用且含该 tag 的内容源", () => {
    const a = JSON.parse(runCli(`source create --name "AI Daily" --type rss --config "https://example.com/ai.xml" --tags "AI,资讯"`));
    const b = JSON.parse(runCli(`source create --name "AI Disabled" --type rss --config "https://example.com/ai2.xml" --tags "AI"`));
    JSON.parse(runCli(`source create --name "Tech Only" --type webpage --config "https://example.com" --tags "科技"`));
    runCli(`source toggle --id ${b.id}`); // 停用 b

    const filtered = JSON.parse(runCli(`source list --tag AI --enabled`));
    const items = Array.isArray(filtered) ? filtered : filtered.items;
    assert.ok(items.some((s) => s.id === a.id), "启用且含 tag 的源应返回");
    assert.ok(!items.some((s) => s.id === b.id), "停用的源不应返回");
    assert.ok(items.every((s) => s.tags.includes("AI")), "结果应全部含所筛 tag");
  });

  it("REQ-SRC-002 AC2: 无匹配返回空列表（退出码 0，机器可消费）", () => {
    const out = runCli(`source list --tag 不存在的标签 --enabled`);
    const data = JSON.parse(out);
    const items = Array.isArray(data) ? data : data.items;
    assert.deepEqual(items, [], "无匹配应返回空列表");
  });
});
