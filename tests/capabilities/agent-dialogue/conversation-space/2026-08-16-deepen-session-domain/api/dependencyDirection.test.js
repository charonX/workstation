// REQ-TRACE: 2026-08-16-deepen-session-domain/REQ-AGENT-117
// REQ-VERSION: v2-hash:77f0f186fe65139c162d3db19364b93827432d5424fd502d067f24df71cbb28c
// CAPABILITY-TRACE: agent-dialogue
// ENTITY-TRACE: conversation-space
// EXPECTED-TRACE: prd.md §10.2 模块关系图（依赖方向）+ REQ-117 契约（re-export 最小面/瘦身 ≤650 行）
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
//   ④ 路由瘦身实证：≤650 行（目标 ~600——v2 修订：review 算术复核搬走
//      ~300-330 行后留存 ~600，v1 的 ~300/≤350 不可行，人拍板重定）。
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
    // 全量匹配所有从 agentSessions 路由的具名 import（exec 只取首个匹配会漏
    // 后续 import 语句；specifier 不硬编码 "./" 前缀，防改写逃逸）
    const importRe = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*routes\/agentSessions\.js["']/g;
    const names = [...source.matchAll(importRe)].map((m) => m[1]).join(",");

    // EXPECTED-TRACE: prd.md §10.2——不存在 server.js → route 内部函数
    assert.ok(!/\bbuildSessionConfig\b/.test(names), "server.js 不得从路由 import buildSessionConfig");
    assert.ok(!/\battachPendingSseSubs\b/.test(names), "server.js 不得从路由 import attachPendingSseSubs");

    // server.js 或 serviceContainer.js 必须从 services 层取领域能力（方向回正的正向证据）
    const containerFile = `${SRC}/services/serviceContainer.js`;
    const checkSource = fs.existsSync(containerFile)
      ? fs.readFileSync(containerFile, "utf8")
      : source;
    assert.ok(
      /from\s*["'][^"']*(?:services\/|\.\/)sessionDomain\.js["']/.test(checkSource),
      "services/serviceContainer.js 应 import sessionDomain.js"
    );
    assert.ok(
      /from\s*["'][^"']*(?:services\/|\.\/)sessionSseRegistry\.js["']/.test(checkSource),
      "services/serviceContainer.js 应 import sessionSseRegistry.js"
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

  it("AC5 路由瘦身实证：≤650 行", () => {
    const text = fs.readFileSync(ROUTE_FILE, "utf8");
    // 与 wc -l 口径一致：末尾换行不多计一行（split("\n") 对尾换行多算 1）
    const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    // EXPECTED-TRACE: REQ-117 AC5——目标 ~600 行，上限 650 含注释余量
    // （v2：review 算术复核搬走 ~300-330 行后留存 ~600，人拍板重定）
    assert.ok(lines <= 650, `路由应瘦身为纯转发（≤650 行），实际 ${lines} 行`);
  });
});
