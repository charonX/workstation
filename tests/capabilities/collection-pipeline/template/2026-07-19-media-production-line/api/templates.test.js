// REQ-TRACE: 2026-07-19-media-production-line/REQ-TPL-001
// REQ-VERSION: v1-hash:835c36c5544138cce6439e02f7ba146691088bcb08b1de2b6224f939ddbc7485
// CAPABILITY-TRACE: collection-pipeline
// ENTITY-TRACE: template
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { startServer, stopServer } from "../../../../../../src/http/server.js";
import { makeTmpProjectDir } from "../../../../../fixtures/media-production-line/tmpProjectDir.js";

const CLI = "node src/cli/opc-workstation.js";
// 签核：内置模板 id `daily-digest`（定时日报）/ `link-capture`（链接速存）；
// CLI 面 `template list` / `template instantiate --id <id> --project-id <pid> [--force]`。
const TPL_DAILY = "daily-digest";
const TPL_LINK = "link-capture";

describe("REQ-TPL-001: 模板实例化", () => {
  let serverCtx;
  let tmp;
  let project;

  beforeEach(async () => {
    serverCtx = await startServer();
    tmp = makeTmpProjectDir();
    project = await (await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tpl Project", localPath: tmp.dir })
    })).json();
  });

  afterEach(async () => {
    tmp.cleanup();
    await stopServer(serverCtx);
  });

  async function instantiate(templateId, body = {}) {
    return fetch(`${serverCtx.baseUrl}/api/templates/${templateId}/instantiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, ...body })
    });
  }

  it("AC1: 内置 2 个模板（定时日报、链接速存）可列出", async () => {
    const res = await fetch(`${serverCtx.baseUrl}/api/templates`);
    assert.equal(res.status, 200);
    const list = await res.json();
    const items = Array.isArray(list) ? list : list.items;
    assert.equal(items.length, 2, "应恰好内置 2 个模板");
    // 签核模板名：「定时日报」「链接速存」。
    const names = items.map((t) => `${t.id}:${t.name}`).join(" ");
    assert.ok(names.includes("定时日报"), `模板名应含「定时日报」，实际: ${names}`);
    assert.ok(names.includes("链接速存"), `模板名应含「链接速存」，实际: ${names}`);
  });

  it("AC1: instantiate 生成 draft flow（含 agent 节点与 skill 引用）并关联收集 skill 包到项目", async () => {
    const res = await instantiate(TPL_DAILY, { overrides: { topic: "AI 科技动态" } });
    assert.equal(res.status, 201, `实际: ${res.status}`);
    const data = await res.json();
    assert.ok(data.flowId || data.flow?.id, "实例化应返回新建 flow");

    const flowId = data.flowId || data.flow.id;
    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows/${flowId}`)).json();
    assert.equal(flow.status, "draft", "实例化生成的 flow 应为 draft");
    const nodes = typeof flow.nodeList === "string" ? JSON.parse(flow.nodeList) : flow.nodeList;
    assert.ok(nodes.some((n) => n.type === "agent"), "模板 flow 应含 agent 节点");

    // 收集 skill 包关联到项目（经既有 /api/projects/:id/skills 查询）。
    const skillsRes = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}/skills`);
    assert.equal(skillsRes.status, 200);
    const skills = await skillsRes.json();
    const linked = (Array.isArray(skills) ? skills : skills.items).filter((s) => s.linked);
    const linkedNames = linked.map((s) => s.name).join(" ");
    for (const required of ["fetch-to-markdown", "topic-daily-digest"]) {
      assert.ok(linkedNames.includes(required), `项目应关联收集 skill ${required}，实际: ${linkedNames}`);
    }
  });

  it("AC1: 链接速存模板生成的 flow 首节点为 feishuMessage 触发节点（固定输出 url/sender/messageId）", async () => {
    const res = await instantiate(TPL_LINK);
    assert.equal(res.status, 201, `实际: ${res.status}`);
    const data = await res.json();
    const flowId = data.flowId || data.flow.id;

    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows/${flowId}`)).json();
    const nodes = typeof flow.nodeList === "string" ? JSON.parse(flow.nodeList) : flow.nodeList;
    const triggerNode = nodes.find((n) => n.type === "feishuMessage");
    assert.ok(triggerNode, "链接速存模板应包含 feishuMessage 触发节点");
    assert.equal(triggerNode.id, "n1", "首节点 id 应为 n1（模板约定）");

    const outputs = triggerNode.config?.outputVariables || [];
    const names = outputs.map((v) => v.name);
    assert.deepEqual(names, ["url", "sender", "messageId"], "固定输出变量顺序应为 url/sender/messageId");
    for (const v of outputs) {
      assert.equal(v.type, "string", `${v.name} 类型应为 string`);
    }
  });

  it("AC4: 链接速存模板生成的 flow 被 IM 消息触发时，注入变量能被 feishuMessage 节点正确合并进 context", async () => {
    const { run } = await import("../../../../../../src/flowEngine/flowEngine.js");
    const res = await instantiate(TPL_LINK);
    assert.equal(res.status, 201);
    const data = await res.json();
    const flowId = data.flowId || data.flow.id;

    const flow = await (await fetch(`${serverCtx.baseUrl}/api/flows/${flowId}`)).json();
    const nodeList = typeof flow.nodeList === "string" ? JSON.parse(flow.nodeList) : flow.nodeList;
    const publishedFlow = { ...flow, nodeList };

    const store = { prompts: [] };
    const capture = (store) => async ({ node }) => {
      store.prompts.push({ nodeId: node.id, prompt: node.config.prompt });
      return { status: "success", output: "mocked" };
    };

    const result = await run(
      publishedFlow,
      { executors: { agent: capture(store) } },
      { url: "https://example.com/link", sender: "ou_123", messageId: "om_456" }
    );

    assert.equal(result.status, "success");
    const agentPrompt = store.prompts.find((p) => p.nodeId !== "n1")?.prompt || "";
    assert.ok(agentPrompt.includes("https://example.com/link"), "agent prompt 应能引用注入的 url 变量");
  });

  it("AC2: 链接速存模板实例化同事务写入 channel_bindings；已有绑定无 force 报 E-BINDING-EXISTS", async () => {
    const first = await instantiate(TPL_LINK);
    assert.equal(first.status, 201);
    const firstData = await first.json();
    const firstFlowId = firstData.flowId || firstData.flow.id;

    // 绑定可查（当前绑定 → 新 flow）。
    const bindingRes = await fetch(`${serverCtx.baseUrl}/api/channel/binding`);
    assert.equal(bindingRes.status, 200);
    const binding = await bindingRes.json();
    assert.equal(binding.flowId, firstFlowId, "绑定应指向链接速存模板生成的 flow");
    assert.equal(binding.projectId, project.id);

    // 再次实例化（无 force）→ E-BINDING-EXISTS。
    const second = await instantiate(TPL_LINK);
    assert.ok([400, 409].includes(second.status), `重复实例化应报业务错误，实际: ${second.status}`);
    assert.match(JSON.stringify(await second.json()), /E-BINDING-EXISTS/);
  });

  it("AC2: force 参数替换绑定（同事务删旧写新）", async () => {
    const firstData = await (await instantiate(TPL_LINK)).json();
    const firstFlowId = firstData.flowId || firstData.flow?.id;

    const forced = await instantiate(TPL_LINK, { force: true });
    assert.equal(forced.status, 201, `force 应替换成功，实际: ${forced.status}`);
    const forcedData = await forced.json();
    const forcedFlowId = forcedData.flowId || forcedData.flow?.id;

    const binding = await (await fetch(`${serverCtx.baseUrl}/api/channel/binding`)).json();
    assert.equal(binding.flowId, forcedFlowId, "force 后绑定应指向新 flow");
    assert.notEqual(binding.flowId, firstFlowId);
  });

  it("边界：模板不存在报 E-TPL-NOT-FOUND，projectId 无效报 E-TPL-PROJECT-INVALID", async () => {
    const notFound = await fetch(`${serverCtx.baseUrl}/api/templates/no-such-template/instantiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id })
    });
    assert.ok([400, 404].includes(notFound.status));
    // 码值出自 tech-design 契约表（E-TPL-NOT-FOUND / E-TPL-PROJECT-INVALID），签核确认。
    assert.match(JSON.stringify(await notFound.json()), /E-TPL-NOT-FOUND/);

    const badProject = await fetch(`${serverCtx.baseUrl}/api/templates/${TPL_DAILY}/instantiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "proj-missing" })
    });
    assert.ok([400, 404].includes(badProject.status));
    assert.match(JSON.stringify(await badProject.json()), /E-TPL-PROJECT-INVALID/);
  });

  it("AC3: CLI template list / instantiate 等价可用", async () => {
    const list = JSON.parse(execSync(`${CLI} template list`, { encoding: "utf-8" }));
    const items = Array.isArray(list) ? list : list.items;
    assert.equal(items.length, 2);

    const out = JSON.parse(execSync(`${CLI} template instantiate --id ${TPL_DAILY} --project-id ${project.id}`, { encoding: "utf-8" }));
    assert.ok(out.flowId || out.flow?.id, "CLI 实例化应返回新建 flow");
  });
});
