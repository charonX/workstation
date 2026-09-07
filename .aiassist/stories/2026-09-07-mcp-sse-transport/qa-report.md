# QA 报告 — 2026-09-07-mcp-sse-transport

> 故事 ID：`2026-09-07-mcp-sse-transport`  
> 评审时间：2026-09-07  
> 执跑环境：macOS, Node.js v22, Electron v43, Playwright v1.51.0

---

## 1. 单元与集成测试 (API & Integration)

- **结果**：PASS (59/59 passed, 0 fail)
- **命令**：
  ```bash
  NODE_ENV=test node --import ./scripts/session-lifecycle-seam.mjs --test $(find tests/capabilities/plugin-management/mcp-server -name "*.test.js")
  ```
- **测试分布**：
  - **Story 契约测试（19/19 pass）**：
    - `api/mcpSseRegister.test.js`：9/9 pass（REQ-MCP-SSE-001，覆盖 create/update、枚举校验、脱敏、协议校验、token 校验、headers）
    - `api/mcpSseBridge.test.js`：6/6 pass（REQ-MCP-SSE-002，覆盖 sse+bearer 显式输出 `httpTransport: "sse"`、http 输出 `streamable-http`、stdio 无 transport 键、两层启用过滤、唯一解密点）
    - `api/mcpSseProbe.test.js`：4/4 pass（REQ-MCP-SSE-003，覆盖 legacy-only stub 工具探测、端口关闭失败处理、bearer 头注入、http streamable 探测回归）
  - **既有 MCP 单元回归测试（40/40 pass）**：
    - 涉及 `channelParity`, `mcpBridge`, `mcpHttpProjectList`, `mcpHttpUpdate`, `mcpPermissionBroker`, `mcpPermissionDefaults`, `mcpProbeTools`, `mcpService`, `policyRulesMcp`，全部零回归。

---

## 2. E2E / 浏览器测试 (Playwright)

- **结果**：PASS (4/4 passed, 0 fail)
- **命令**：
  ```bash
  npm run rebuild:electron && npx playwright test tests/capabilities/plugin-management/mcp-server/2026-09-07-mcp-sse-transport/e2e/mcpSsePage.test.cjs
  ```
- **覆盖流程**：
  - 用例 1：`[data-testid='mcp-type-seg']` 内 `stdio` / `http` / `sse` 三选项均可见（REQ-MCP-SSE-004 AC1）
  - 用例 2：选 `sse` 后 `command/args/env` 隐藏，`url/auth/token/headers` 可见；切回 `stdio` 恢复（REQ-MCP-SSE-004 AC2、AC5）
  - 用例 3：选 `sse` 填表提交，列表行出现该 server，badge 文本为 `sse`，API 回读 `type=sse` 且无 stdio 字段，页面脱敏不回显明文 token（REQ-MCP-SSE-004 AC3）
  - 用例 4：编辑既有 `sse` 条目，seg 激活 `sse`（`active`）且 url 字段回填（REQ-MCP-SSE-004 AC4）
- **Flaky 测试**：无（首轮全部一次性通过）。

---

## 3. 静态代码分析与 Lint

- **结果**：PASS (0 errors)
- **命令**：`npm run lint` (`oxlint src/`)
- **分析**：新修改的 `src/services/mcpService.js` 与 `src/renderer/pages/Mcp.jsx` 无任何 lint 报错或告警。

---

## 4. 运行时浏览器验证 (Browser Verify)

- **状态**：SKIPPED
- **原因**：本 Story 复用现有 `Mcp.jsx` 管理页与通用 seg 控件，无新增独立 `ux/` 原型（需求与设计阶段已确认跳过 DESIGN），因此跳过 Chrome DevTools 运行时比对。

---

## 5. 覆盖与 Seam 验证

| 稳定块 / REQ | 验证 Seam | 测试类型 | 覆盖状态 |
|---|---|---|---|
| REQ-MCP-SSE-001 (sse 注册/校验/存储) | `mcpService.create/update/list` | 集成 (API) | 100% 覆盖 (9 用例) |
| REQ-MCP-SSE-002 (快照显式 transport) | `mcpService.effectiveConfig` | 集成 (API) | 100% 覆盖 (6 用例) |
| REQ-MCP-SSE-003 (探测分派) | `mcpService.probeTools` | 集成 (API) | 100% 覆盖 (4 用例) |
| REQ-MCP-SSE-004 (管理页 transport 三选) | `Mcp.jsx` 管理页 | 浏览器 E2E (Playwright) | 100% 覆盖 (4 用例) |

---

## 6. 不稳定测试登记

- 无不稳定测试（无 flaky 测试）。

---

## 7. 留给 REFLECT 人工验收事项

- 真实远程 crawl4ai 实例（`http://<host>:11235/mcp/sse`）端到端连通验证（PRD §6.1 步骤 3-5）：在真实部署环境中配置远程 sse 端点与 Bearer Token，通过探测并验证 Agent 会话中调用 crawl 工具。

---

## 8. 结论

- [x] **可进入 `/reflect`**（无 open bugs，QA 自动化与回归测试全绿）
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [ ] 有失败，建议调用 `/bug`
