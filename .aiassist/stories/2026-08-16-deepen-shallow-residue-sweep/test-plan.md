# 测试计划（Test Plan）

> 故事 ID：`2026-08-16-deepen-shallow-residue-sweep`
> 对应 REQ 版本：`v1-hash:f255c1918d40e06767b8129157cdcde68091d02015b0b577fa7c03b449fa5d8f`
> 创建日期：2026-08-19

---

## 1. 测试接缝与 REQ 映射

| REQ-ID | 验收内容 | Seam 类型 | Capability / Entity | 测试文件 |
|---|---|---|---|---|
| **REQ-FLOW-058** | 废除 agentAdapter 与缺 Provider 显式报错 | API / public 函数 | `flow-orchestration` / `flow-engine` | `tests/capabilities/flow-orchestration/flow-engine/2026-08-16-deepen-shallow-residue-sweep/api/agentExecutorProvider.test.js` |
| **REQ-WORKSPACE-020** | 统一 HTTP 响应助手与错误映射收敛 | API / public 函数 | `workspace-management` / `server` | `tests/capabilities/workspace-management/server/2026-08-16-deepen-shallow-residue-sweep/api/responders.test.js` |
| **REQ-SCHEDULE-011** | Cron 描述助手归位至 schedulerService | API / public 函数 | `scheduling-execution` / `schedule` | `tests/capabilities/scheduling-execution/schedule/2026-08-16-deepen-shallow-residue-sweep/api/cronDescription.test.js` |
| **REQ-FLOW-059** | 清理 flowService 废弃 UI 计算助手 | API / public 函数 | `flow-orchestration` / `flow` | `tests/capabilities/flow-orchestration/flow/2026-08-16-deepen-shallow-residue-sweep/api/flowServiceCleanup.test.js` |

---

## 2. 详细测试用例规划

### REQ-FLOW-058 (Agent Provider 报错与 Adapter 清理)
- `AC1`: 静态断言 `src/flowEngine/agentAdapter.js` 文件已被删除。
- `AC2`: 调用 `agentExecutor` 传入 `{ config: {} }`、`{ config: { provider: "" } }`、`{ config: { provider: null } }` 等缺省 provider 场景，断言返回 `status: "error"` 且错误信息包含 `E-AGENT-NO-PROVIDER`。
- `AC3`: 调用 `agentExecutor` 传入 `{ config: { provider: "unknown-llm" } }`，断言返回未知 provider 错误。
- `AC4`: 当 `provider === "anthropic"` 时正常调用真实 adapter 并返回 success。

### REQ-WORKSPACE-020 (统一 HTTP 响应助手)
- `AC1`: 验证 `src/http/responders.js` 导出完整的 7 个公共函数。
- `AC2`: 验证 `ok`, `noContent`, `badRequest`, `notFound` 输出符合 HTTP JSON 规范。
- `AC3`: 验证 `mapError` 支持自定义 status、错误码、invalidAgents 和 issues 透传。
- `AC4`: 验证 `decodeParam` 与 `normalizeBool` 处理各种边界输入。
- `AC5`: 静态检查 5 个路由文件均导入 `responders.js`，且 `plugins.js` 解除了对 `mcp.js` 的导入。

### REQ-SCHEDULE-011 (Cron 描述助手归位)
- `AC1`: 验证 `schedulerService.getCronDescription` 正确解析 5/6 字段表达式（如 `0 8 * * *`）。
- `AC2`: 验证对非法字段数抛出 `Invalid cron expression: expected 5 or 6 fields`。
- `AC3`: 静态检查 `routes/schedules.js` 从 `schedulerService` 导入。
- `AC4`: 验证 `taskService.getCronDescription` 兼容转发正常工作。

### REQ-FLOW-059 (flowService 废弃 UI 助手清理)
- `AC1`: 验证 `toggleRun`、`zoomIn`、`zoomOut`、`resetZoom`、`getNodeCategories`、`getEditableFields` 从 `flowService` 导出中移除（`undefined`）。
- `AC2`: 验证服务端核心 Flow CRUD 函数依然正常导出。

---

## 3. REFLECT 阶段人工验收项

- **无人工视觉项**：本次为纯服务端与架构接缝清理，所有验收标准均 100% 具备自动化测试。
