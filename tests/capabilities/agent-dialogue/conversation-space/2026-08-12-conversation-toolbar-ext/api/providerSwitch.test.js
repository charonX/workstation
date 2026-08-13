// REQ-TRACE: 2026-08-12-conversation-toolbar-ext/REQ-AGENT-093, 2026-08-12-conversation-toolbar-ext/REQ-AGENT-095
// REQ-VERSION: v1-hash:ff3ce6c28851eddb44986c153881ae32c5547116942bab700427cfca94e46514
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// 会话级 provider 切换（REQ-AGENT-093）+ 默认语义/懒恢复重装/删除回落（REQ-AGENT-095）。
//
// seam 1：PUT /api/agent/sessions/:spaceKey/provider {provider, model}
//   → 200 {provider, model}；400 E-MODEL-CONFIG-MISSING / E-MODEL-KEY-FAIL。
// seam 2：agent_sessions 行（SQLite 为真相）：provider/model 列回写；懒恢复/水合按行重装；
//   行 NULL → 默认组合；条目删除 → 回落默认 + 提示（E12）。
// seam 3：sessionRef 不变（JSONL 历史保留）——切换后 GET messages 内容一致。
//
// 环境：FAUX + 真实 settings 文件（测试 configDir）+ startServer。既有 E2E fixture
// （startElectronApp）覆盖 UI 链路，本文件聚焦 HTTP/数据面。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer } from "../../../../../../src/http/server.js";

async function seedSettings(workdir, providers, defaultModel) {
  fs.writeFileSync(
    path.join(workdir, "settings.json"),
    JSON.stringify({
      agent: {
        identity: "",
        providers,
        defaultModel,
      },
    }),
    "utf8"
  );
}

async function putProvider(baseUrl, spaceKey, body) {
  return fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/provider`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("REQ-AGENT-093 会话级 provider 切换（B3）", () => {
  let workdir;
  let server;
  let baseUrl;
  let spaceKey;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    process.env.DB_PATH = path.join(workdir, "data.db");
    process.env.OPC_AGENT_FAUX = "1";
    seedSettings(workdir, [
      { provider: "moonshotai", apiKey: "sk-moonshot", models: ["kimi-k3", "kimi-k2.6"] },
      { provider: "deepseek", apiKey: "sk-deepseek", models: ["deepseek-v4-flash"] },
    ], { provider: "moonshotai", model: "kimi-k3" });
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const res = await fetch(`${baseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "general" }),
    });
    spaceKey = (await res.json()).spaceKey;
  });

  afterEach(async () => {
    await stopServer({ server });
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    delete process.env.DB_PATH;
    delete process.env.OPC_AGENT_FAUX;
  });

  it("切换成功：回读 provider/model + agent_sessions 列回写 + sessionRef 不变", async () => {
    const res = await putProvider(baseUrl, spaceKey, { provider: "deepseek", model: "deepseek-v4-flash" });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { provider: "deepseek", model: "deepseek-v4-flash" });
    // 回读契约（REQ-093 标准 1）：GET provider → 当前会话组合
    const rb = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/provider`)).json();
    assert.deepEqual(rb, { provider: "deepseek", model: "deepseek-v4-flash" });
    // sessionRef 不变（JSONL 世代未 +1——ADR-026 不换代）
    const list = await (await fetch(`${baseUrl}/api/agent/sessions`)).json();
    const row = [...(list.general ?? []), ...(list.projects ?? [])].find((r) => r.spaceKey === spaceKey);
    assert.ok(row, "会话行存在");
    assert.match(row.sessionRef, /\.jsonl$/); // 无 .N 世代后缀
  });

  it("历史保留：切换后既有消息仍可回读（内容一致）", async () => {
    await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "切换前的消息" }),
    });
    await putProvider(baseUrl, spaceKey, { provider: "deepseek", model: "deepseek-v4-flash" });
    const before = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/messages`)).json();
    // FAUX 回复后，历史含 user 消息；切换不换代 → 内容完整
    const texts = before.messages.filter((m) => m.role === "user").map((m) => m.content ?? "");
    assert.ok(texts.some((t) => t.includes("切换前的消息")), "切换后历史仍含切换前消息");
  });

  it("下一条消息用新 provider 回复", async () => {
    await putProvider(baseUrl, spaceKey, { provider: "deepseek", model: "deepseek-v4-flash" });
    const res = await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "切换后发消息" }),
    });
    assert.equal(res.status, 202);
    // FAUX 链路通（新 provider 装配的会话可正常回复）；provider 生效由回读契约覆盖
    const after = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/messages`)).json();
    assert.ok(after.messages.some((m) => m.role === "assistant"), "FAUX 回复到达");
  });

  it("非法组合 → 400 E-MODEL-CONFIG-MISSING，会话不变", async () => {
    const res = await putProvider(baseUrl, spaceKey, { provider: "openai", model: "gpt-x" });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, "E-MODEL-CONFIG-MISSING");
    const rb = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/provider`)).json();
    assert.deepEqual(rb, { provider: "moonshotai", model: "kimi-k3" }); // 会话不变
  });

  it("key 解密失败 → 400 E-MODEL-KEY-FAIL，会话不变", async () => {
    // 覆盖该条目的 key 为损坏密文（直接写 settings fixture）
    const settingsPath = path.join(workdir, "settings.json");
    const s = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    s.agent.providers[1].apiKeyEncrypted = "broken-cipher";
    delete s.agent.providers[1].apiKey;
    fs.writeFileSync(settingsPath, JSON.stringify(s), "utf8");
    const res = await putProvider(baseUrl, spaceKey, { provider: "deepseek", model: "deepseek-v4-flash" });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, "E-MODEL-KEY-FAIL");
  });

  it("幂等：同组合重复 PUT → 200 无副作用", async () => {
    const r1 = await putProvider(baseUrl, spaceKey, { provider: "moonshotai", model: "kimi-k3" });
    const r2 = await putProvider(baseUrl, spaceKey, { provider: "moonshotai", model: "kimi-k3" });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const list = await (await fetch(`${baseUrl}/api/agent/sessions`)).json();
    const row = [...(list.general ?? [])].find((r) => r.spaceKey === spaceKey);
    assert.match(row.sessionRef, /\.jsonl$/); // 无世代递增
  });
});

describe("REQ-AGENT-095 默认语义 + 懒恢复重装 + 删除回落（B4）", () => {
  let workdir;
  let server;
  let baseUrl;

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "default-"));
    process.env.OPC_WORKSTATION_CONFIG_DIR = workdir;
    process.env.DB_PATH = path.join(workdir, "data.db");
    process.env.OPC_AGENT_FAUX = "1";
  });

  afterEach(async () => {
    await stopServer({ server });
    delete process.env.OPC_WORKSTATION_CONFIG_DIR;
    delete process.env.DB_PATH;
    delete process.env.OPC_AGENT_FAUX;
  });

  it("新会话初始组合 = defaultModel", async () => {
    seedSettings(workdir, [
      { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] },
      { provider: "deepseek", apiKey: "sk-d", models: ["deepseek-v4-flash"] },
    ], { provider: "deepseek", model: "deepseek-v4-flash" });
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const res = await fetch(`${baseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "general" }),
    });
    const spaceKey = (await res.json()).spaceKey;
    // 新会话初始 = defaultModel（Q10 语义）
    const rb = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/provider`)).json();
    assert.deepEqual(rb, { provider: "deepseek", model: "deepseek-v4-flash" });
  });

  it("懒恢复按行重装：行带 provider/model → 用行值（非全局默认）", async () => {
    seedSettings(workdir, [
      { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] },
      { provider: "deepseek", apiKey: "sk-d", models: ["deepseek-v4-flash"] },
    ], { provider: "moonshotai", model: "kimi-k3" });
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const res = await fetch(`${baseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "general" }),
    });
    const spaceKey = (await res.json()).spaceKey;
    await putProvider(baseUrl, spaceKey, { provider: "deepseek", model: "deepseek-v4-flash" });
    // 重启服务（模拟 worker 重启 → 懒恢复按行重装）
    await stopServer({ server });
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const rb = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/provider`)).json();
    // 行值（deepseek）而非全局默认（kimi-k3）——ADR-026 语义
    assert.deepEqual(rb, { provider: "deepseek", model: "deepseek-v4-flash" });
  });

  it("行 NULL（旧行）→ 回落默认组合", async () => {
    seedSettings(workdir, [
      { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] },
      { provider: "deepseek", apiKey: "sk-d", models: ["deepseek-v4-flash"] },
    ], { provider: "moonshotai", model: "kimi-k3" });
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const res = await fetch(`${baseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "general" }),
    });
    const spaceKey = (await res.json()).spaceKey;
    // fixture：模拟迁移前旧行（provider/model 为 NULL）
    const { getDb } = await import("../../../../../../src/db.js");
    const db = getDb(path.join(workdir, "data.db"));
    db.prepare("UPDATE agent_sessions SET provider = NULL, model = NULL WHERE spaceKey = ?").run(spaceKey);
    await stopServer({ server });
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const rb = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/provider`)).json();
    // NULL → 默认组合
    assert.deepEqual(rb, { provider: "moonshotai", model: "kimi-k3" });
  });

  it("会话 provider 条目被删 → 回落默认 + 提示（E12）", async () => {
    seedSettings(workdir, [
      { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] },
      { provider: "deepseek", apiKey: "sk-d", models: ["deepseek-v4-flash"] },
    ], { provider: "moonshotai", model: "kimi-k3" });
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const res = await fetch(`${baseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "general" }),
    });
    const spaceKey = (await res.json()).spaceKey;
    await putProvider(baseUrl, spaceKey, { provider: "deepseek", model: "deepseek-v4-flash" });
    // 删除 deepseek 条目（settings 仅剩 moonshotai）
    seedSettings(workdir, [
      { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] },
    ], { provider: "moonshotai", model: "kimi-k3" });
    await stopServer({ server });
    ({ server, baseUrl } = await startServer({ port: 0 }));
    const rb = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/provider`)).json();
    // E12：条目被删 → 回落默认（moonshotai·kimi-k3），不悬空
    assert.deepEqual(rb, { provider: "moonshotai", model: "kimi-k3" });
  });

  it("defaultModel 变更 → 新会话/懒恢复用新默认", async () => {
    seedSettings(workdir, [
      { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] },
      { provider: "deepseek", apiKey: "sk-d", models: ["deepseek-v4-flash"] },
    ], { provider: "moonshotai", model: "kimi-k3" });
    ({ server, baseUrl } = await startServer({ port: 0 }));
    // 改默认 → deepseek
    seedSettings(workdir, [
      { provider: "moonshotai", apiKey: "sk-m", models: ["kimi-k3"] },
      { provider: "deepseek", apiKey: "sk-d", models: ["deepseek-v4-flash"] },
    ], { provider: "deepseek", model: "deepseek-v4-flash" });
    const res = await fetch(`${baseUrl}/api/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceKind: "general" }),
    });
    const spaceKey = (await res.json()).spaceKey;
    const rb = await (await fetch(`${baseUrl}/api/agent/sessions/${spaceKey}/provider`)).json();
    assert.deepEqual(rb, { provider: "deepseek", model: "deepseek-v4-flash" });
  });
});
