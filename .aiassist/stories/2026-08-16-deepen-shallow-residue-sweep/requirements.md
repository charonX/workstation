# 业务需求契约（Requirements as Contract）

> 故事 ID：`2026-08-16-deepen-shallow-residue-sweep`
> 对应 PRD：`.aiassist/stories/2026-08-16-deepen-shallow-residue-sweep/prd.md`
> 结晶日期：2026-08-19
> 版本：v1

---

## REQ-FLOW-058: 废除 agentAdapter 与缺 Provider 显式报错

- **优先级**: P0
- **必须性**: 必须
- **scope**: intra-module
- **modules**: `src/flowEngine/agentAdapter.js`, `src/flowEngine/executors/agentExecutor.js`
- **capability**: `flow-orchestration`
- **entity**: `flow-engine`
- **测试类型**: 单元 / 集成
- **测试文件**: `tests/capabilities/flow-orchestration/flow-engine/2026-08-16-deepen-shallow-residue-sweep/api/agentExecutorProvider.test.js`

### 验收标准（Acceptance Criteria）

- [ ] **AC1（Deletion Test）**: 彻底删除 `src/flowEngine/agentAdapter.js` 文件，代码库中不再存在固定返回 mock success 的静默 adapter。
- [ ] **AC2（缺 Provider 报错）**: 当 `node.config.provider` 为 `undefined`、`null` 或空字符串 `""` 时，`agentExecutor` 返回 `{ status: "error", error: "Agent provider is required (E-AGENT-NO-PROVIDER)", logs: [{ at: "<timestamp>", message: "Agent provider is required (E-AGENT-NO-PROVIDER)" }] }`，禁止伪造假成功。
- [ ] **AC3（未知 Provider 报错）**: 当 `node.config.provider` 为未识别字符串（如 `"unknown-llm"`）时，`agentExecutor` 保持返回 `{ status: "error", error: "Unknown agent provider: unknown-llm", logs: [...] }`。
- [ ] **AC4（Anthropic Provider 真实分派）**: 当 `node.config.provider === "anthropic"` 时，`agentExecutor` 正常调用 `claudeAgentAdapter.execute` 执行真实分派。

---

## REQ-WORKSPACE-020: 统一 HTTP 响应助手与错误映射收敛

- **优先级**: P0
- **必须性**: 必须
- **scope**: cross-module
- **modules**: `src/http/responders.js`, `src/http/routes/{mcp,plugins,skills,projects,settings}.js`
- **capability**: `workspace-management`
- **entity**: `server`
- **测试类型**: 单元 / 集成
- **测试文件**: `tests/capabilities/workspace-management/server/2026-08-16-deepen-shallow-residue-sweep/api/responders.test.js`

### 验收标准（Acceptance Criteria）

- [ ] **AC1（公共响应模块）**: `src/http/responders.js` 导出完整的标准化助手集合：
  - `ok(res, data, statusCode = 200)`: 写入状态码与 JSON 数据。
  - `noContent(res)`: 写入 204 无响应体。
  - `badRequest(res, message, code = "VALIDATION_ERROR")`: 写入 400 与 JSON `{ error: code, message }`。
  - `notFound(res, message = "Not found")`: 写入 404 与 JSON `{ error: "NOT_FOUND", message }`。
  - `mapError(res, err, defaultStatus = 400)`: 映射错误对象到 HTTP 响应。
  - `decodeParam(value)`: 安全解码 URI 参数。
  - `normalizeBool(value)`: 归一化布尔值（`value === true || value === "true"`）。
- [ ] **AC2（错误映射规范）**: `mapError` 状态码取 `err.status || defaultStatus`；错误体格式为 `{ error: err.code || (status === 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR"), message: err.message }`；当 `err.invalidAgents` 或 `err.issues` 存在时透传至响应体顶层。
- [ ] **AC3（路由引用收敛与解耦）**: `src/http/routes/mcp.js`、`plugins.js`、`skills.js`、`projects.js`、`settings.js` 统一导入并使用 `src/http/responders.js`；`plugins.js` 彻底解除对 `mcp.js` 的跨路由非对称引用。

---

## REQ-SCHEDULE-011: Cron 描述助手归位至 schedulerService

- **优先级**: P1
- **必须性**: 必须
- **scope**: cross-module
- **modules**: `src/services/schedulerService.js`, `src/services/taskService.js`, `src/http/routes/schedules.js`
- **capability**: `scheduling-execution`
- **entity**: `schedule`
- **测试类型**: 单元
- **测试文件**: `tests/capabilities/scheduling-execution/schedule/2026-08-16-deepen-shallow-residue-sweep/api/cronDescription.test.js`

### 验收标准（Acceptance Criteria）

- [ ] **AC1（解析与描述函数）**: `src/services/schedulerService.js` 导出 `getCronDescription(cronExpression)`，支持 5 字段与 6 字段标准 cron 表达式（如 `"0 8 * * *"` → `"At 08:00"` / `"Every day at 08:00"` 等），并在字段数不足或超过 6 个时抛出 `Error("Invalid cron expression: expected 5 or 6 fields")`。
- [ ] **AC2（路由直接调用）**: `src/http/routes/schedules.js` 从 `schedulerService.js` 导入 `getCronDescription`，返回 schedule 列表与详情时注入 `cronDescription` 字段。
- [ ] **AC3（taskService 职责瘦身）**: `src/services/taskService.js` 不再承载 cron 描述的具体业务实现（可单行转发 `schedulerService.getCronDescription` 保证平滑过渡）。

---

## REQ-FLOW-059: 清理 flowService 废弃 UI 计算助手

- **优先级**: P1
- **必须性**: 必须
- **scope**: intra-module
- **modules**: `src/services/flowService.js`
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **测试类型**: 单元 / 回归
- **测试文件**: `tests/capabilities/flow-orchestration/flow/2026-08-16-deepen-shallow-residue-sweep/api/flowServiceCleanup.test.js`

### 验收标准（Acceptance Criteria）

- [ ] **AC1（清理废弃 UI 助手）**: 从 `src/services/flowService.js` 中彻底删除 `toggleRun`、`zoomIn`、`zoomOut`、`resetZoom`、`getNodeCategories`、`getEditableFields` 6 个函数的导出与实现。
- [ ] **AC2（回归零破坏）**: 服务端 flowService 核心能力（`createFlow`、`getFlow`、`updateFlow`、`deleteFlow`、`listFlows`、`publishFlow`、`validateNodeList` 等）功能完整且测试全绿，活跃代码无对废弃 UI 助手的悬空引用。
