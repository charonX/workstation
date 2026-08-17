// REQ-TRACE: 2026-08-16-deepen-session-domain/REQ-AGENT-117
// REQ-VERSION: v1-hash:370f51eb4d13d39db48c284dfa2857d2ceaa603138023afb94c94325fbd4c245
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §10.2 模块关系图（依赖方向）+ REQ-117 契约（re-export 最小面/瘦身 ≤350 行）
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

// REQ-AGENT-117：依赖方向回正与路由瘦身（ADR-030）。
// 静态 seam（feishuReadonly.test.js 同款源码断言先例）：
//   ① sessionDomain.js / sessionSseRegistry.js 不得 import routes/ 下任何模块
//      （domain ← route 永不存在——方向回正的机器可验证据）；
//   ② server.js 不得从 routes/agentSessions.js import buildSessionConfig /
//      attachPendingSseSubs（反向 import 消亡——领域函数只从 services 层取）；
//   ③ 路由兼容面：文件存在 + 仅 re-export projectMessagesFromJsonl
//      （测试唯一实际使用名，historyToolFilter 直调契约）；
//   ④ 路由瘦身实证：≤350 行（评审目标 ~300，上限含注释余量）。
// HTTP/SSE 行为字节级不变（AC4）与无消息桥断言（AC3）由既有 10 测试文件承载。
//
// seam：源码静态断言 + 路由模块动态 import。

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../../../../../src", import.meta.url));
const ROUTE_FILE = `${SRC}/http/routes/agentSessions.js`;
const DOMAIN_FILE = `${SRC}/services/sessionDomain.js`;
const REGISTRY_FILE = `${SRC}/services/sessionSseRegistry.js`;
const SERVER_FILE = `${SRC}/http/server.js`;

const ROUTES_IMPORT_RE = /(?:from\s+|require\()\s*["'][^"']*routes\//;

describe("REQ-AGENT-117 依赖方向回正（静态断言）", () => {
  it("AC1 新领域模块不得反向 import 路由层", () => {
    for (const file of [DOMAIN_FILE, REGISTRY_FILE]) {
      assert.ok(fs.existsSync(file), `seam 未就绪：${file} 尚未实现（REQ-AGENT-117，ADR-030）`);
      const source = fs.readFileSync(file, "utf8");
      // EXPECTED-TRACE: prd.md §10.2——不存在 domain ← route
      assert.ok(
        !ROUTES_IMPORT_RE.test(source),
        `${file} 不得 import routes/ 下模块（依赖方向倒置复活）`
      );
    }
  });

  it("AC1 server.js 不得从路由 import 领域函数", () => {
    const source = fs.readFileSync(SERVER_FILE, "utf8");
    const m = /import\s*\{([^}]*)\}\s*from\s*["']\.\/routes\/agentSessions\.js["']/.exec(source);
    const names = m ? m[1] : "";

    // EXPECTED-TRACE: prd.md §10.2——不存在 server.js → route 内部函数
    assert.ok(!/\bbuildSessionConfig\b/.test(names), "server.js 不得从路由 import buildSessionConfig");
    assert.ok(!/\battachPendingSseSubs\b/.test(names), "server.js 不得从路由 import attachPendingSseSubs");

    // server.js 必须从 services 层新模块取领域能力（方向回正的正向证据）
    assert.ok(
      /from\s*["'][^"']*services\/sessionDomain\.js["']/.test(source),
      "server.js 应 import services/sessionDomain.js"
    );
  });

  it("AC2 路由兼容面：文件存在 + re-export projectMessagesFromJsonl", async () => {
    const mod = await import(ROUTE_FILE).catch(() => null);
    assert.ok(mod, "路由文件 src/http/routes/agentSessions.js 必须存在（既有测试 seam 门）");
    assert.equal(
      typeof mod.projectMessagesFromJsonl,
      "function",
      "路由须 re-export projectMessagesFromJsonl（historyToolFilter 直调契约）"
    );
    // handler 本就住路由（server → route 正常分层）
    assert.equal(typeof mod.handleAgentSessions, "function");
    assert.equal(typeof mod.handleAgentLastMode, "function");
  });

  it("AC5 路由瘦身实证：≤350 行", () => {
    const lines = fs.readFileSync(ROUTE_FILE, "utf8").split("\n").length;
    // EXPECTED-TRACE: REQ-117 AC5——评审目标 ~300 行，上限 350 含注释余量
    assert.ok(lines <= 350, `路由应瘦身为纯转发（≤350 行），实际 ${lines} 行`);
  });
});
