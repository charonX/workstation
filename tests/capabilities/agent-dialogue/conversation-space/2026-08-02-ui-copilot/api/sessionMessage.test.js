// REQ-TRACE: 2026-08-02-ui-copilot/REQ-AGENT-028
// REQ-VERSION: v1-hash:8432c0cff25d5ef4a71d5c8fd95b3045977d65430eb968d7063be5fc81d67012
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// seam：HTTP 会话消息端点（tech-design 接口契约表 + 数据流 F1）：
//   POST /api/agent/sessions/:spaceKey/messages { text } → 202 { messageId }
//   错误映射（ADR-001：HTTP 状态码 + JSON { error, message }）：
//   trim 后空 / 超上限 → 400；agent 未配置 → 409 E-AGENT-CONFIG；孤儿项目空间 →
//   409 E-SESSION-ORPHAN；feishu:* → 403 E-SESSION-READONLY；spaceKey 不存在 → 404。
// 新路由落点 src/http/routes/agentSessions.js（server.js handleRequest 挂接，tech-design 模块表）。
// setup 依赖契约 seam：POST /api/agent/sessions（REQ-AGENT-027）创建 UI 空间行。
// FAUX provider seam：NODE_ENV=test 时 agentService 自动注入 OPC_AGENT_FAUX=1（零网络，
// src/services/agentService.js spawnChild）；agent 配置经 settingsService.saveAgentConfig 注入
// （agentRestartKey.test.js 同型）；流式速率可由 OPC_AGENT_FAUX_TPS 调节（本套件默认速率即可）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

// seam 就绪门：路由文件不存在时给出清晰失败（而非把一切读成 404）。
async function loadSessionsRouteSeam() {
  const mod = await import("../../../../../../src/http/routes/agentSessions.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/agentSessions.js 尚未实现（REQ-AGENT-028，tech-design 模块表）");
  return mod;
}

// REQ-AGENT-027 契约 seam（本套件 setup）：创建通用 UI 空间。
async function createUiSession(baseUrl) {
  const res = await fetch(`${baseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ spaceKind: "general" })
  });
  const body = await res.json().catch(() => ({}));
  assert.equal(
    res.status,
    200,
    `seam 未就绪：POST /api/agent/sessions 应 200（REQ-AGENT-027 标准 1，本套件 setup 依赖），实际 ${res.status}：${JSON.stringify(body)}`
  );
  assert.match(body.spaceKey ?? "", /^ui:copilot:.+/, "通用空间 spaceKey 应匹配 ^ui:copilot:.+（REQ-AGENT-027 标准 1）");
  return body.spaceKey;
}

// REQ-AGENT-027 契约 seam（本套件 setup）：创建项目 UI 空间。
async function createProjectSession(baseUrl, projectId) {
  const res = await fetch(`${baseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ spaceKind: "project", projectId })
  });
  const body = await res.json().catch(() => ({}));
  assert.equal(
    res.status,
    200,
    `seam 未就绪：POST /api/agent/sessions（project）应 200（REQ-AGENT-027 标准 2），实际 ${res.status}：${JSON.stringify(body)}`
  );
  assert.match(body.spaceKey ?? "", /^ui:project:.+/, "项目空间 spaceKey 应匹配 ^ui:project:<pid>:.+（REQ-AGENT-027 标准 2）");
  return body.spaceKey;
}

// agent 配置注入（生产等价：设置页保存 provider+key；FAUX 模式 key 不触网）。
async function configureAgent() {
  const settingsMod = await import("../../../../../../src/services/settingsService.js");
  settingsMod.saveAgentConfig({ provider: "deepseek", apiKey: "sk-test-faux" });
}

async function postMessage(baseUrl, spaceKey, body) {
  const res = await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/messages`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  });
  const parsed = await res.json().catch(() => ({}));
  return { res, body: parsed };
}

// feishu 空间行物化：feishu 会话由通道侧创建（UI 端点不承保 feishu 创建）；测试经
// sessionStore 向服务端同库建行（SQLite 为真相，W-3），模拟通道侧既存会话。
async function materializeFeishuSession(spaceKey) {
  const { createSessionStore } = await import("../../../../../../src/services/sessionStore.js");
  const settingsMod = await import("../../../../../../src/services/settingsService.js");
  const configDir = settingsMod.configDir();
  const store = createSessionStore({
    dbPath: path.join(configDir, "agent-sessions.db"),
    sessionDir: path.join(configDir, "agent-sessions")
  });
  store.getOrCreate(spaceKey, { sessionDir: path.join(configDir, "agent-sessions") });
}

describe("REQ-AGENT-028 对话发送（POST .../messages，标准 1/6）", () => {
  let serverCtx;

  beforeEach(async () => {
    serverCtx = await startServer();
    await configureAgent();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
  });

  it("合法文本发送返回 202 与 messageId", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);

    const { res, body } = await postMessage(serverCtx.baseUrl, spaceKey, { text: "帮我看看今天的任务" });

    assert.equal(res.status, 202, `合法文本应 202，实际 ${res.status}：${JSON.stringify(body)}`);
    assert.ok(typeof body.messageId === "string" && body.messageId.length > 0, "202 响应应含 messageId（REQ-AGENT-028 标准 1）");
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  it("trim 后为空的文本返回 400", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);

    const { res, body } = await postMessage(serverCtx.baseUrl, spaceKey, { text: "   \n\t  " });

    assert.equal(res.status, 400, `trim 后空文本应 400，实际 ${res.status}：${JSON.stringify(body)}`);
    assert.ok(typeof body.error === "string" && body.error.length > 0, "400 响应应含 error 字段（ADR-001 错误形态）");
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });

  it("超出 enforceSizeLimit 上限的文本返回 400", async () => {
    await loadSessionsRouteSeam();
    const spaceKey = await createUiSession(serverCtx.baseUrl);

    // enforceSizeLimit 语义 = 单事件 ≤ 256KB（MAX_IPC_BYTES，src/services/agentService.js），
    // F1 输入校验沿用该上限语义；此处 300KB 为明确越界占位。
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
    const { res, body } = await postMessage(serverCtx.baseUrl, spaceKey, { text: "x".repeat(300 * 1024) });

    assert.equal(res.status, 400, `超上限文本应 400，实际 ${res.status}：${JSON.stringify(body).slice(0, 200)}`);
    assert.ok(typeof body.error === "string" && body.error.length > 0, "400 响应应含 error 字段（ADR-001 错误形态）");
  });
});

describe("REQ-AGENT-028 发送错误映射（标准 3）", () => {
  let serverCtx;
  let workdir;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-copilot-msg-"));
    serverCtx = await startServer();
    // BUG-007（test-gap）：ADR-026 slice-1（1dfeff8）后 resetSettings 走 E13 语义——
    // 磁盘已有 settings.json 则以磁盘为真相、不覆盖（迁移 fixture 保护契约）。而
    // startServer 的临时 configDir 进程内设一次复用（server.js），同文件前一 describe
    // 的 configureAgent 已把 agent 配置落盘——本 describe 的「agent 未配置」前提需
    // 显式重建：删 settings.json + 重载默认。断言本体不变。
    const settingsMod = await import("../../../../../../src/services/settingsService.js");
    fs.rmSync(path.join(settingsMod.configDir(), "settings.json"), { force: true });
    settingsMod.resetSettings();
  });

  afterEach(async () => {
    await stopServer(serverCtx);
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("agent 未配置时发送返回 409 E-AGENT-CONFIG", async () => {
    await loadSessionsRouteSeam();
    // 注意：本用例不调用 configureAgent——beforeEach 已显式重建「未配置」前提（BUG-007）。
    const spaceKey = await createUiSession(serverCtx.baseUrl);

    const { res, body } = await postMessage(serverCtx.baseUrl, spaceKey, { text: "你好" });

    assert.equal(res.status, 409, `agent 未配置应 409，实际 ${res.status}：${JSON.stringify(body)}`);
    assert.equal(body.error, "E-AGENT-CONFIG", "错误码应为 E-AGENT-CONFIG（REQ-AGENT-028 标准 3）");
  });

  it("项目已删除的孤儿空间发送返回 409 E-SESSION-ORPHAN", async () => {
    await loadSessionsRouteSeam();
    await configureAgent();
    const createRes = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "孤儿项目", localPath: workdir })
    });
    assert.equal(createRes.status, 201, "setup：项目创建应 201");
    const project = await createRes.json();
    const spaceKey = await createProjectSession(serverCtx.baseUrl, project.id);
    const delRes = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`, { method: "DELETE" });
    assert.ok(delRes.ok, `setup：项目删除应成功，实际 ${delRes.status}`);

    const { res, body } = await postMessage(serverCtx.baseUrl, spaceKey, { text: "项目还在吗" });

    assert.equal(res.status, 409, `孤儿空间发送应 409，实际 ${res.status}：${JSON.stringify(body)}`);
    assert.equal(body.error, "E-SESSION-ORPHAN", "错误码应为 E-SESSION-ORPHAN（REQ-AGENT-028 标准 3）");
  });

  it("feishu 空间发送返回 403 E-SESSION-READONLY", async () => {
    await loadSessionsRouteSeam();
    await configureAgent();
    await materializeFeishuSession("feishu:oc_readonly_1");

    const { res, body } = await postMessage(serverCtx.baseUrl, "feishu:oc_readonly_1", { text: "在吗" });

    assert.equal(res.status, 403, `feishu 空间发送应 403，实际 ${res.status}：${JSON.stringify(body)}`);
    assert.equal(body.error, "E-SESSION-READONLY", "错误码应为 E-SESSION-READONLY（REQ-AGENT-028 标准 3 / REQ-AGENT-034 标准 2 同断言）");
  });

  it("feishu 空间发送优先级：未配置 agent 时仍 403 E-SESSION-READONLY（先于 409 E-AGENT-CONFIG）", async () => {
    // T-4（test-gap 修复，signoff 裁决 2）：只读是空间属性，与 agent 配置无关——
    // 若实现把「未配置」校验提前到只读之前，本用例会红（错得 409 E-AGENT-CONFIG）。
    // 注意：本用例不调用 configureAgent（startServer 后 agent 默认未配置）。
    await loadSessionsRouteSeam();
    await materializeFeishuSession("feishu:oc_readonly_unconfigured");

    const { res, body } = await postMessage(serverCtx.baseUrl, "feishu:oc_readonly_unconfigured", { text: "在吗" });

    assert.equal(res.status, 403, `feishu 空间未配置 agent 时应仍 403（裁决 2 只读先于配置），实际 ${res.status}：${JSON.stringify(body)}`);
    assert.equal(body.error, "E-SESSION-READONLY", "错误码应为 E-SESSION-READONLY（非 E-AGENT-CONFIG）");
  });

  it("孤儿空间发送优先级：未配置 agent 时仍 409 E-SESSION-ORPHAN（先于 409 E-AGENT-CONFIG）", async () => {
    // T-4（test-gap 修复）：孤儿是空间属性，先于 agent 配置——若实现把「未配置」
    // 校验提前到孤儿判定之前，本用例会红（错得 409 E-AGENT-CONFIG）。
    // 注意：本用例不调用 configureAgent（startServer 后 agent 默认未配置）。
    await loadSessionsRouteSeam();
    const createRes = await fetch(`${serverCtx.baseUrl}/api/projects`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "孤儿项目（未配置）", localPath: workdir })
    });
    assert.equal(createRes.status, 201, "setup：项目创建应 201");
    const project = await createRes.json();
    const spaceKey = await createProjectSession(serverCtx.baseUrl, project.id);
    const delRes = await fetch(`${serverCtx.baseUrl}/api/projects/${project.id}`, { method: "DELETE" });
    assert.ok(delRes.ok, `setup：项目删除应成功，实际 ${delRes.status}`);

    const { res, body } = await postMessage(serverCtx.baseUrl, spaceKey, { text: "项目还在吗" });

    assert.equal(res.status, 409, `孤儿空间未配置 agent 时应仍 409（孤儿先于配置），实际 ${res.status}：${JSON.stringify(body)}`);
    assert.equal(body.error, "E-SESSION-ORPHAN", "错误码应为 E-SESSION-ORPHAN（非 E-AGENT-CONFIG）");
  });

  it("不存在的 spaceKey 发送返回 404", async () => {
    await loadSessionsRouteSeam();
    await configureAgent();
    await createUiSession(serverCtx.baseUrl); // seam 就绪证据：真实空间可建（防路由全 404 造成假阳性）。

    const { res, body } = await postMessage(serverCtx.baseUrl, "ui:copilot:no-such-session", { text: "你好" });

    assert.equal(res.status, 404, `不存在的 spaceKey 应 404，实际 ${res.status}：${JSON.stringify(body)}`);
    assert.equal(body.error, "E-SESSION-NOT-FOUND", "错误码应为 E-SESSION-NOT-FOUND");
    // signoff 2026-08-06: assertion signed（裁决见 signoff.md）
  });
});
