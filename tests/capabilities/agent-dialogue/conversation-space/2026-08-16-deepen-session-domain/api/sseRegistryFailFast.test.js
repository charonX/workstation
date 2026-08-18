// BUG-TRACE: BUG-001
// REQ-TRACE: 2026-08-16-deepen-session-domain/REQ-AGENT-117
// REQ-VERSION: v2-hash:77f0f186fe65139c162d3db19364b93827432d5424fd502d067f24df71cbb28c
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §10.4 context 袋 fail-fast 契约（未接线 → 干净报错，先于写 SSE 头/建句柄等副作用）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// BUG-001（2026-08-18，/code-review 发现，人确认 code-defect 后修复）：
// sseRegistryOf fail-fast 落点缺陷——未接线场景下抛错发生在副作用之后：
//   A. handleGetEvents 先 writeHead/flushHeaders 再 sseRegistryOf → SSE 头已提交后
//      抛错 → 连接挂死（无 body 无 end）；
//   B. 袋内 getSseRegistry 存在但工厂未赋值（getter 返回 undefined）→ typeof 守卫
//      通过但拿到 undefined → 裸 TypeError（fail-fast 要避免的 cryptic 错误）；
//   C. handlePostMessage 先 createSession 再 sseRegistryOf → 建句柄后 500 → 孤儿
//      会话 + 挂起订阅永不挂接。
// 契约：fail-fast 必须先于副作用——接线缺失时干净抛错（HTTP 层转 500），不得挂死
// 连接、不得留下孤儿句柄。
//
// seam：src/http/routes/agentSessions.js 的 handleAgentSessions（直接调用，res stub）。

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function loadRoutes() {
  const mod = await import("../../../../../../src/http/routes/agentSessions.js").catch(() => null);
  assert.ok(mod, "seam 未就绪：src/http/routes/agentSessions.js 不可导入");
  return mod;
}

// HTTP res stub：跟踪 writeHead（headersSent/status）——fail-fast 契约断言
// 「先于写 SSE 头」，故写头时序是核心可观察量。
function createHttpResStub() {
  return {
    writes: [],
    status: null,
    headersSent: false,
    ended: false,
    writeHead(status, headers) {
      this.status = status;
      this.headersSent = true;
      this.headers = headers;
    },
    flushHeaders() {},
    write(s) { this.writes.push(s); return true; },
    on() {},
    end() { this.ended = true; },
  };
}

// 行存在 → 越过 404 检查，直达 fail-fast（GET events 路径）。
const STORE = {
  get: () => ({ spaceKey: "ui:copilot:abc" }),
};

describe("BUG-001 sseRegistryOf fail-fast 落点", () => {
  it("GET events 未接线（袋无 getSseRegistry）→ fail-fast 先于写 SSE 头", async () => {
    const { handleAgentSessions } = await loadRoutes();
    const res = createHttpResStub();

    await assert.rejects(
      handleAgentSessions({ method: "GET" }, res, undefined, ["sessions", "ui:copilot:abc", "events"], {
        getSessionStore: () => STORE,
        // 缺 getSseRegistry —— 未接线场景
      }),
      /getSseRegistry 未接线/
    );

    // 修复前：writeHead(200, SSE) 已提交 → headersSent=true → 断言红。
    // 修复后：抛错在 writeHead 之前 → headersSent=false → 断言绿。
    assert.equal(res.headersSent, false, "fail-fast 必须先于写 SSE 头——未接线不得挂死连接");
  });

  it("GET events 袋有 getSseRegistry 但返回 undefined（工厂未赋值）→ 同样干净 fail-fast 而非裸 TypeError", async () => {
    const { handleAgentSessions } = await loadRoutes();
    const res = createHttpResStub();

    await assert.rejects(
      handleAgentSessions({ method: "GET" }, res, undefined, ["sessions", "ui:copilot:abc", "events"], {
        getSessionStore: () => STORE,
        // server.js 袋同型：getter 恒存在，但工厂未赋值时返回 undefined
        getSseRegistry: () => undefined,
      }),
      /getSseRegistry 未接线/
    );

    assert.equal(res.headersSent, false, "getter 返回 undefined 同样必须 fail-fast，不得抛 cryptic TypeError");
  });

  it("POST messages 未接线 → fail-fast 先于 createSession（不得建句柄后 500 留孤儿）", async () => {
    const { handleAgentSessions } = await loadRoutes();

    const ctxDir = fs.mkdtempSync(path.join(os.tmpdir(), "bug001-"));
    const savedConfigDir = process.env.OPC_WORKSTATION_CONFIG_DIR;
    process.env.OPC_WORKSTATION_CONFIG_DIR = ctxDir;
    try {
      const settings = await import("../../../../../../src/services/settingsService.js");
      settings.saveAgentConfig({ provider: "deepseek", apiKey: "sk-faux-bug001" });

      let created = 0;
      const svc = {
        createSession() { created++; },
        prompt: async () => undefined,
        getSession: () => null,
      };
      const res = createHttpResStub();

      await assert.rejects(
        handleAgentSessions({ method: "POST" }, res, { text: "你好" }, ["sessions", "ui:copilot:abc", "messages"], {
          getSessionStore: () => ({ get: () => ({ spaceKey: "ui:copilot:abc", provider: "deepseek", model: "" }) }),
          getAgentService: async () => svc,
          // 缺 getSseRegistry —— 未接线场景
        }),
        /getSseRegistry 未接线/
      );

      // 修复前：createSession 已执行（created=1）→ 断言红。
      // 修复后：fail-fast 在建句柄之前 → created=0 → 断言绿。
      assert.equal(created, 0, "fail-fast 必须先于 createSession——不得留下孤儿句柄与未挂接的挂起订阅");
    } finally {
      if (savedConfigDir === undefined) delete process.env.OPC_WORKSTATION_CONFIG_DIR;
      else process.env.OPC_WORKSTATION_CONFIG_DIR = savedConfigDir;
      fs.rmSync(ctxDir, { recursive: true, force: true });
    }
  });
});
