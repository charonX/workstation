# 测试计划 — 2026-09-07-mcp-sse-transport

> REQ 版本：`v1`（hash 见 `requirements-v1.hash`）
> 生成：/test-author（自动链）

## 覆盖矩阵

| REQ | 测试文件 | Seam | 类型 | 依赖处理 |
|---|---|---|---|---|
| REQ-MCP-SSE-001（sse 注册/校验/脱敏） | `api/mcpSseRegister.test.js`（9 用例） | `mcpService.create/update/list` | 集成 | 真实临时 SQLite（OPC_WORKSTATION_CONFIG_DIR） |
| REQ-MCP-SSE-002（快照 httpTransport） | `api/mcpSseBridge.test.js`（6 用例） | `mcpService.effectiveConfig` | 集成 | 真实临时库 + 预置加密 token；better-sqlite3 只读校验密文列 |
| REQ-MCP-SSE-003（探测分派） | `api/mcpSseProbe.test.js`（4 用例） | `mcpService.probeTools` | 集成 | 本地 legacy-SSE stub（新 fixture，legacy-only，拒 streamable POST）+ 既有 streamable fixture（回归） |
| REQ-MCP-SSE-004（UI 三选） | `e2e/mcpSsePage.test.cjs`（4 用例） | Mcp.jsx 管理页 | 浏览器 E2E（Electron） | 真实后端（Electron 内嵌服务）；提交体形状经 API 回读观察 |

## 新增 fixture

- `tests/fixtures/mcp-sse-server/server.mjs`：手写最小 legacy SSE MCP server（GET /sse + POST /messages；其余一律 405）。工具 `echo`（description「回显输入文本（sse fixture）」）；`MCP_FIXTURE_TOKEN` 校验 bearer；`MCP_FIXTURE_AUTH_LOG` 记录 Authorization 头。不依赖 MCP SDK（对齐既有 fixture 手写协议先例）。

## RED 基线（2026-09-07，实现前）

- api 19 用例：**17 fail / 2 pass**。
- 2 个 pass 均为回归守卫，预期绿：`mcpSseBridge` 标准 3（stdio 快照无 httpTransport 键——今日即成立，防实现误加）、`mcpSseProbe` 标准 5（既有 http 探测回归）。
- 其余 17 用例全部以 `type 不合法: 仅支持 stdio/http`（当前实现拒绝 sse）失败，符合 RED 预期。
- e2e 4 用例未跑（实现前 UI 无 sse 选项，必然 RED；QA 阶段随全量跑）。

## 来自 HTML 原型的映射

- 无（本 story 无新 UX 原型；复用 mcp-page 现有 seg 模式，人确认跳过 DESIGN）。

## 留给 REFLECT 人工验收

- 真实 crawl4ai 远程实例端到端连通（prd.md §6.1 步骤 3-5）：注册 type:sse+bearer → 探测返回真实 tools → 项目会话 agent 调用 crawl 工具。理由：外部依赖不可控，不进自动化断言（非审美项，属环境依赖）。

## 回溯检查

- 4 条 REQ 每条 ≥1 自动化测试：✅（无 `人工(仅视觉)` REQ）
- 每个断言 expected 值 trace 到 PRD §6.3/§7/§10.4/全局约束：✅（无 TODO: HUMAN ASSERTION，无升级点）
