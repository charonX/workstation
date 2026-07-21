// REQ-TRACE: 2026-07-19-media-production-line/REQ-COLL-002
// REQ-VERSION: v1-hash:aeebbee331c0863144ca7b891e8faf8da12fde2bfbceb0ad525049febf3f1d48
// CAPABILITY-TRACE: collection-pipeline
// ENTITY-TRACE: collection
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { makeTmpProjectDir, readFileIfExists } from "../../../../../fixtures/media-production-line/tmpProjectDir.js";
import { createMockAgentExecutor, createFailingAgentExecutor } from "../../../../../fixtures/media-production-line/mockAgent.js";
import { createMockChannelAdapter } from "../../../../../fixtures/media-production-line/mockChannelAdapter.js";
import { startFakeContentServer } from "../../../../../fixtures/media-production-line/fakeContentServer.js";

// 说明：mock agent 按 fetch-to-markdown skill 的契约写素材文件（frontmatter + 索引追加），
// 验证 IM 消息 → 去重 → 回执 → 队列 → 执行 → 落盘 → 索引 → 回复 → 登记 → 通知 的端到端接线。

async function loadSeams() {
  const routerMod = await import("../../../../../../src/services/channels/imRouter.js").catch(() => null);
  assert.ok(routerMod?.createImRouter, "seam 未就绪：imRouter（REQ-COLL-002 触发源）");
  const bindingMod = await import("../../../../../../src/services/channelBindingService.js").catch(() => null);
  assert.ok(bindingMod?.createBinding, "seam 未就绪：channelBindingService（REQ-COLL-002 路由查询）");
  const taskService = await import("../../../../../../src/services/taskService.js");
  assert.equal(typeof taskService.setAgentExecutorForTests, "function",
    "seam 未就绪：taskService.setAgentExecutorForTests（agent mock 注入）");
  assert.equal(typeof taskService.setChannelAdapterForTests, "function",
    "seam 未就绪：taskService.setChannelAdapterForTests（fake 飞书注入）");
  return { routerMod, bindingMod, taskService };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** mock agent：按速存契约写 materials/<date>-<slug>.md 并追加索引一行。 */
function createLinkCaptureAgent(projectDir, { slug, title }) {
  return createMockAgentExecutor(({ context }) => {
    const text = context?.["n1.text"] || "";
    const urlMatch = text.match(/(https?:\/\/\S+)/);
    const url = urlMatch ? urlMatch[1] : "";
    const materialRel = `materials/${todayStr()}-${slug}.md`;
    fs.writeFileSync(
      path.join(projectDir, materialRel),
      `---\nsource: ${url}\ntitle: ${title}\nfetchedAt: ${new Date().toISOString()}\n---\n\n# ${title}\n`,
      "utf8"
    );
    // 签核索引文件：materials/LIBRARY.md。
    fs.appendFileSync(path.join(projectDir, "materials", "LIBRARY.md"), `- [${title}](${materialRel}) — ${url}\n`, "utf8");
    return { status: "success", output: materialRel };
  });
}

describe("REQ-COLL-002: 场景 B · 链接速存端到端", () => {
  let serverCtx;
  let contentServer;
  let tmp;
  let seams;
  let adapter;
  let project;
  let flow;

  beforeEach(async () => {
    tmp = makeTmpProjectDir();
    serverCtx = await startServer();
    contentServer = await startFakeContentServer({
      "/building-effective-agents": { status: 200, body: "<html><body><h1>Building effective agents</h1></body></html>" }
    });
    seams = await loadSeams();

    adapter = createMockChannelAdapter();
    await adapter.start({ credentials: {} });
    seams.taskService.setChannelAdapterForTests(adapter);
    seams.routerMod.createImRouter({ channelAdapter: adapter, baseUrl: serverCtx.baseUrl });

    project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Capture Project", localPath: tmp.dir })
    })).json();
    flow = await (await fetch(`${serverCtx.baseUrl}/api/flows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "链接速存",
        projectId: project.id,
        nodeList: [
          {
            id: "n1",
            type: "feishuMessage",
            config: {
              outputVariables: [
                { name: "text", type: "string", defaultValue: "" },
                { name: "sender", type: "string", defaultValue: "" },
                { name: "messageId", type: "string", defaultValue: "" }
              ]
            }
          },
          { id: "n2", type: "agent", config: { provider: "anthropic", model: "claude", outputVariable: "out", prompt: "使用 {{n1.text}} 转 Markdown 存素材库" } }
        ],
        edges: [{ sourceNodeId: "n1", targetNodeId: "n2" }]
      })
    })).json();
    await fetch(`${serverCtx.baseUrl}/api/flows/${flow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published" })
    });
    seams.bindingMod.createBinding({ channelType: "feishu", flowId: flow.id, projectId: project.id });
  });

  afterEach(async () => {
    try { seams.taskService.setAgentExecutorForTests?.(null); } catch { /* ignore */ }
    try { seams.taskService.setChannelAdapterForTests?.(null); } catch { /* ignore */ }
    await contentServer.stop();
    tmp.cleanup();
    await stopServer(serverCtx);
  });

  async function waitForTerminalExecution(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const list = await (await fetch(`${serverCtx.baseUrl}/api/executions`)).json();
      const hit = list.find((e) => e.flowId === flow.id && e.trigger === "channel");
      if (hit && (hit.status === "success" || hit.status === "error")) return hit;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.fail("timed out waiting for: 链接速存执行到达终态");
  }

  it("URL 消息 → 排队回执 → 素材落盘 + 索引追加 → 完成回复 + 登记 + 通知", async () => {
    const articleUrl = contentServer.urlFor("/building-effective-agents");
    seams.taskService.setAgentExecutorForTests(createLinkCaptureAgent(tmp.dir, {
      slug: "building-effective-agents",
      title: "Building effective agents"
    }));

    adapter.emitMessage({ messageId: "om_cap_1", chatId: "oc_1", senderId: "ou_1", text: `存一下 ${articleUrl}` });

    // AC1：立即收到排队回执（含位置）。
    // 签核回执模板：「收到，排队中（第 N 位）」。
    const receipt = adapter.replies.find((r) => r.messageId === "om_cap_1");
    assert.ok(receipt, "应立即回复排队回执");
    assert.match(receipt.text, /收到，排队中（第 \d+ 位）/);

    const execution = await waitForTerminalExecution();
    assert.equal(execution.status, "success");

    // AC2：素材文件真实存在，frontmatter 含 source url/title/fetchedAt；索引追加一行。
    const materialRel = `materials/${todayStr()}-building-effective-agents.md`;
    const material = readFileIfExists(path.join(tmp.dir, materialRel));
    assert.ok(material !== null, `素材文件应真实存在: ${materialRel}`);
    assert.match(material, /source: /, "frontmatter 应含 source url");
    assert.match(material, /title: /, "frontmatter 应含 title");
    assert.match(material, /fetchedAt: /, "frontmatter 应含 fetchedAt");

    const index = readFileIfExists(path.join(tmp.dir, "materials", "LIBRARY.md"));
    assert.ok(index !== null, "索引文件应存在");
    const indexLines = index.trim().split("\n").filter(Boolean);
    assert.equal(indexLines.length, 1, "索引应恰好追加一行");
    assert.ok(indexLines[0].includes(materialRel));

    // AC3：完成回复「已存：<路径>」；artifacts 登记；通知落「产物产出」。
    const completion = adapter.replies.filter((r) => r.messageId === "om_cap_1");
    assert.ok(completion.some((r) => r.text.includes("已存") && r.text.includes(materialRel)),
      `完成回复应含「已存：<路径>」，实际: ${JSON.stringify(completion.map((r) => r.text))}`);

    const detail = await (await fetch(`${serverCtx.baseUrl}/api/executions/${execution.id}`)).json();
    const artifacts = typeof detail.artifacts === "string" ? JSON.parse(detail.artifacts) : detail.artifacts;
    assert.ok(Array.isArray(artifacts) && artifacts.some((a) => String(a?.path ?? a).includes(materialRel)),
      "artifacts 应登记素材路径");

    // 通知 API 面（签核）：{ items, unreadCount }。
    const nres = await fetch(`${serverCtx.baseUrl}/api/notifications`);
    const { items } = await nres.json();
    assert.ok(items.some((n) => n.type === "artifact"), "通知列表应含「产物产出」");
  });

  it("抓取失败（fake 源 404）→ 无落盘、无索引追加，飞书收到 E-FETCH-FAILED 原因回复", async () => {
    seams.taskService.setAgentExecutorForTests(createFailingAgentExecutor("E-FETCH-FAILED: 目标链接返回 404"));
    const deadUrl = contentServer.urlFor("/missing-page");

    adapter.emitMessage({ messageId: "om_cap_404", chatId: "oc_1", senderId: "ou_1", text: `存 ${deadUrl}` });
    const execution = await waitForTerminalExecution();
    assert.equal(execution.status, "error");

    // 无文件落盘、无索引追加。
    const materialsDir = path.join(tmp.dir, "materials");
    const files = fs.existsSync(materialsDir) ? fs.readdirSync(materialsDir) : [];
    assert.equal(files.length, 0, "抓取失败不应有任何素材/索引落盘");

    // 飞书收到含 E-FETCH-FAILED 原因的回复。
    const replies = adapter.replies.filter((r) => r.messageId === "om_cap_404");
    assert.ok(replies.some((r) => /E-FETCH-FAILED/.test(r.text)),
      `失败回复应含 E-FETCH-FAILED，实际: ${JSON.stringify(replies.map((r) => r.text))}`);
  });
});
