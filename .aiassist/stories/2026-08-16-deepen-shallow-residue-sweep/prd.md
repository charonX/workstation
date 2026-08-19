# 浅残留清理（Sweep the Silent Mocks and Re-homed Leftovers）

> 故事 ID：`2026-08-16-deepen-shallow-residue-sweep`
> 状态：已完结（历史记录）
> 创建日期：2026-08-16
> 完结日期：2026-08-19
> 评审来源：架构深化评审候选 #8 (`.aiassist/global/architecture-reviews/architecture-review-2026-08-16.html`)

---

## 1. 问题陈述

在前期多个功能迭代（Flow 引擎、PI Agent 整合、MCP / Plugin 扩展、定时调度等）中，代码库中遗留了若干带有伪造假设、模块职责错位或未彻底删除的浅残留：
1. **Agent 静默 Mock 假成功**：`src/flowEngine/agentAdapter.js` 固定返回 mock success；未配置 provider 的 agent 节点在 `agentExecutor.js` 中静默走 mock 返回假成功，掩盖了真实缺少 provider 的配置错误，违背了生产执行的真实性原则。
2. **5 个路由各自定义响应与错误映射**：`src/http/routes/{mcp,plugins,skills,projects,settings}.js` 重复实现 `ok`/`badRequest`/`mapError`/`notFound` 等响应助手，默认状态码存在不一致，且 `plugins.js` 反向跨文件导入 `mcp.js` 的内部 helper。
3. **Cron 描述助手宿主错位**：`src/services/taskService.js` 承载了 `getCronDescription` 纯 cron 字符串解析与人类可读描述逻辑，而真正的 cron 校验与调度归属 `src/services/schedulerService.js`。
4. **flowService 残留废弃 UI 计算助手**：`src/services/flowService.js` 中包含 `toggleRun`、`zoomIn`、`zoomOut`、`resetZoom`、`getNodeCategories`、`getEditableFields` 等纯前端画布计算函数，现已全无活跃调用方。
5. **死导入与残留别名 (Dead Imports)**：部分命令与服务中存在未使用的导入或冗余 alias。

一句话痛点：**一批浅残留各自携带隐藏语义与伪造成功，每处都通过 Deletion Test，需系统性清理消除技术债务。**

---

## 2. 解决方案

1. **废除 Agent 静默 Mock**：
   - 彻底删除 `src/flowEngine/agentAdapter.js`。
   - `agentExecutor.js` 中，当 `node.config.provider` 未提供或为空时，返回显式错误状态 `error`（错误信息包含 `Agent provider is required`，错误码 `E-AGENT-NO-PROVIDER`），绝不返回假成功。
   - 确保测试环境统一经由 `executionRunner.setAgentExecutorForTests` 注入测试 mock。
2. **抽离统一 HTTP 响应助手模块 (`src/http/responders.js`)**：
   - 集中提供标准化响应助手：`ok`、`noContent`、`badRequest`、`notFound`、`mapError`、`decodeParam`、`normalizeBool`。
   - 统一 `mapError` 规则：默认状态码 400，支持 `err.status`，识别 `err.code` 优先作为错误类型；统一 `VALIDATION_ERROR` 与 `INTERNAL_ERROR` 兜底。
   - 重构 `mcp.js`、`plugins.js`、`skills.js`、`projects.js`、`settings.js` 改为直接引用统一助手模块，解除 `plugins.js -> mcp.js` 的跨路由依赖。
3. **Cron 描述助手归位至调度服务**：
   - 将 `getCronDescription` 函数移入 `src/services/schedulerService.js`，`schedules.js` 路由改从 `schedulerService` 导入。
   - 从 `src/services/taskService.js` 中移除该函数（或保留单行转发保证兼容）。
4. **清理 flowService 废弃 UI 助手**：
   - 删除 `flowService.js` 中的 `toggleRun`、`zoomIn`、`zoomOut`、`resetZoom`、`getNodeCategories`、`getEditableFields`，使服务端 flowService 聚焦于数据持久化与业务校验。
5. **清理死导入与冗余引用**：
   - 扫描并清理相关模块中未使用的导入项。

---

## 3. 用户故事

1. 作为 Workstation 开发者与使用者，当我运行未配置 Agent Provider 的 Flow 时，我期望系统立即提示 Provider 缺失的明确错误，而不是静默伪造执行成功输出。
2. 作为 API 开发者与测试者，我期望所有 HTTP 路由遵循统一的响应结构与错误映射规范，不再受到不同路由各自实现偏差的影响。
3. 作为代码库维护者，我期望每个模块职责纯粹（Cron 解析归调度层、Flow 服务不含 UI 缩放算法），没有通过 Deletion Test 的无用代码残留。

---

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | 废除 `agentAdapter.js`，缺 provider 时 `agentExecutor` 显式返回错误 | 伪造成功掩盖配置缺陷；架构评审已确认所有测试均可经由 runner seam 注入 |
| 2 | 统一 HTTP 响应助手 `src/http/responders.js`，5 个路由统一收敛引用 | 消除 5 处重复代码与跨路由非对称导入，统一 API 响应格式 |
| 3 | 将 `getCronDescription` 移至 `schedulerService.js` 并更新路由引用 | 调度领域逻辑收敛归位，解除 taskService 的不合理职责承载 |
| 4 | 删除 `flowService.js` 中废弃的前端 UI 计算助手 | 活跃代码与测试零引用，通过 Deletion Test，属于典型浅残留 |

---

## 5. 移动块（还在动，暂不入 REQ）

*当前无移动块，所有清理目标均在架构评审与需求访谈中明确锁定。*

---

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

| 步骤 | 触发动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 运行包含配置了有效 `provider: "anthropic"` 的 agent 节点 Flow | `agentExecutor` 分派至 `claudeAgentAdapter` 执行真实调用 | 节点返回 success 及 agent 调用详情 |
| 2 | 运行未配置 `provider` 的 agent 节点 Flow | `agentExecutor` 立即返回 error，明确指出缺少 provider | 节点 status 为 `error`，error 包含 `Agent provider is required` |
| 3 | 发起 HTTP GET/POST/PUT 请求至 `/api/mcp`、`/api/plugins`、`/api/skills`、`/api/projects`、`/api/settings` | 路由统一使用 `responders.js` 处理成功与异常响应 | 响应结构规范统一（200 返回 JSON，400/404/500 返回 `{ error, message }`） |
| 4 | 查询定时任务列表（`/api/schedules` 或 `schedules.list()`） | 路由调用 `schedulerService.getCronDescription(schedule.cron)` 生成人类可读描述 | 正确返回 `cronDescription`（如 `Every day at 08:00`） |
| 5 | Flow 画布操作与服务调用 | 界面使用 ReactFlow 原生缩放与组件，`flowService` 专注 flow CRUD 与校验 | `flowService` 正常运行，无前端 UI 函数导出污染 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| Agent 节点 `node.config.provider` 为空字符串、null 或 undefined | `agentExecutor` 拦截并报错 | status 为 `error`, error 包含 `Agent provider is required` |
| Agent 节点 `node.config.provider` 为未知 provider（如 `foo`） | `agentExecutor` 拦截并报错 | status 为 `error`, error 包含 `Unknown agent provider: foo` |
| 路由处理抛出业务异常（带 `code` 与 `status`） | `responders.mapError` 输出对应状态码与错误体 | 响应状态码为 `err.status || 400`，body `{ error: err.code, message: err.message }` |
| 传入非法 cron 表达式请求描述 | `schedulerService.getCronDescription` 抛出格式异常 | 抛错 `Invalid cron expression: expected 5 or 6 fields` |

### 6.3 锚点例子表

| 场景 | 输入 / 调用 | 期望行为 / 输出 |
|---|---|---|
| 缺少 provider 的 agent 节点 | `agentExecutor({ node: { type: "agent", config: {} }, context: {} })` | 返回 `{ status: "error", error: "Agent provider is required (E-AGENT-NO-PROVIDER)", logs: [...] }` |
| 5 字段有效 cron 描述 | `schedulerService.getCronDescription("0 8 * * *")` | 返回 `"At 08:00"` / `"Every day at 08:00"` |
| 非法 cron 字段数 | `schedulerService.getCronDescription("0 8 *")` | 抛出 `Error("Invalid cron expression: expected 5 or 6 fields")` |
| 路由统一 badRequest | `badRequest(res, "name 必填")` | HTTP 400, `{ error: "VALIDATION_ERROR", message: "name 必填" }` |
| 路由统一 notFound | `notFound(res, "Item not found")` | HTTP 404, `{ error: "NOT_FOUND", message: "Item not found" }` |

---

## 7. 表单与输入验证（Form / Input Validation）

本 story 为底层残留清理与重构，涉及的主要输入验证规则如下：

| 输入/配置 | 规则 | 验证失败行为 |
|---|---|---|
| `node.config.provider` | 必须为非空字符串且等于已支持的 provider（`"anthropic"`） | 执行器返回 `error` 状态并记录日志 |
| Cron 表达式 | 必须为非空字符串且由 5 或 6 个空格分隔字段组成 | 抛出 `Error("Invalid cron expression: expected 5 or 6 fields")` |
| 统一 HTTP 参数 | `decodeParam(value)` 解码 URI 组件；`normalizeBool(value)` 转换布尔值 | 解码失败返回原值；布尔归一化为 true/false |

---

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 状态码 / 节点状态 |
|---|---|---|---|
| Agent 缺 Provider | `!node.config?.provider` | `Agent provider is required (E-AGENT-NO-PROVIDER)` | 节点 status: `error` |
| 未知 Agent Provider | `provider !== "anthropic"` | `Unknown agent provider: <provider>` | 节点 status: `error` |
| HTTP 参数校验失败 | 请求体缺少必填字段 | `VALIDATION_ERROR` / 自定义错误文案 | HTTP 400 |
| HTTP 资源不存在 | 请求路径不存在或资源 ID 不匹配 | `NOT_FOUND` / `Not found` | HTTP 404 |
| HTTP 内部异常 | 服务层抛出 500 异常 | `INTERNAL_ERROR` / `err.message` | HTTP 500 |

---

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **simple** |
| 判断理由 | 清理目标边界极为清晰（删除无用文件、提取公共 helper、移动归属错位的函数、修正缺省分派报错）。所有改动均具备现成的单元测试与集成测试接缝，无异步并发竞态或跨服务复杂编排。可直接结晶进入测试与实现。 |

---

## 10. 技术方案（Implementation Decisions）

### 10.1 设计目标
1. 彻底删除 `src/flowEngine/agentAdapter.js`。
2. 改造 `src/flowEngine/executors/agentExecutor.js`：缺 `provider` 时返回 `error`，移除 `mockAgentExecute` 导入与调用。
3. 创建 `src/http/responders.js`，导出公共响应助手。
4. 重构 `src/http/routes/mcp.js`、`plugins.js`、`skills.js`、`projects.js`、`settings.js` 使用 `responders.js`。
5. 将 `getCronDescription` 移至 `src/services/schedulerService.js`，更新 `schedules.js` 路由导入；在 `taskService.js` 中清理或单行转发。
6. 清除 `src/services/flowService.js` 中的 6 个废弃 UI 计算助手（`toggleRun`, `zoomIn`, `zoomOut`, `resetZoom`, `getNodeCategories`, `getEditableFields`）。

### 10.2 模块职责与接口契约

#### 1. `src/http/responders.js` 导出规范：
- `ok(res, data, statusCode = 200)`: 写入 JSON 响应
- `noContent(res)`: 写入 204
- `badRequest(res, message, code = "VALIDATION_ERROR")`: 写入 400 JSON
- `notFound(res, message = "Not found")`: 写入 404 JSON
- `mapError(res, err, defaultStatus = 400)`: 写入 `err.status || defaultStatus` JSON，支持业务 code / invalidAgents / issues 透传
- `decodeParam(value)`: 安全 URI 解码
- `normalizeBool(value)`: 归一化为布尔值

#### 2. `src/services/schedulerService.js` 导出新增：
- `getCronDescription(cronExpression)`: 接收 5/6 字段 cron 字符串，返回人类可读说明。

#### 3. `src/flowEngine/executors/agentExecutor.js` 分派逻辑：
```javascript
if (provider === "anthropic") {
  // 调用 claudeAgentExecute
} else if (!provider) {
  return {
    status: "error",
    error: "Agent provider is required (E-AGENT-NO-PROVIDER)",
    logs: [{ at: new Date().toISOString(), message: "Agent provider is required (E-AGENT-NO-PROVIDER)" }]
  };
} else {
  return {
    status: "error",
    error: `Unknown agent provider: ${provider}`,
    logs: [{ at: new Date().toISOString(), message: `Unknown agent provider: ${provider}` }]
  };
}
```

### 10.3 向后兼容与迁移
- 针对既有 flow 测试，已全部通过 `executionRunner.setAgentExecutorForTests` 注入测试执行器，因此删除 `agentAdapter.js` 不会影响正确配置了 seam 的测试。
- 确保测试套件中所有直接测试 `agentExecutor` 的用例适配新的报错契约。

---

## 11. 测试决策（Test Decisions & Seams）

### 11.1 覆盖接缝（Seams）
1. **Agent 执行器 Seam**：直接单元测试 `agentExecutor`，验证 `provider` 为空、未知 provider、有效 provider 的三种分派分支。
2. **HTTP 响应助手 Seam**：单元测试 `src/http/responders.js` 各 helper 函数在不同参数和错误形态下的输出。
3. **Cron 描述 Seam**：单元测试 `schedulerService.getCronDescription` 对常见合法 cron（每小时、每天、工作日等）及非法格式的输出。
4. **路由集成 Seam**：通过 HTTP 或各路由 handler 验证 `mcp`, `plugins`, `skills`, `projects`, `settings` 响应结构与异常状态码正确。

### 11.2 测试计划
- **单元测试**：
  - `tests/capabilities/flow-orchestration/flow-engine/2026-08-16-deepen-shallow-residue-sweep/agentExecutorProvider.test.js`
  - `tests/capabilities/system-core/http/2026-08-16-deepen-shallow-residue-sweep/responders.test.js`
  - `tests/capabilities/scheduling-execution/scheduler/2026-08-16-deepen-shallow-residue-sweep/cronDescription.test.js`
- **回归测试**：全量运行既有测试套件，验证 0 failure。

---

## 12. 范围外（Out of Scope）

1. 不引入新的 Agent Provider 支持（保持只支持 `"anthropic"`）。
2. 不重构 Flow 引擎核心执行调度机制（已在 `ExecutionRunner` 深化中完成）。
3. 不更改前端 FlowCanvas 的实际缩放与交互实现（前端已使用 ReactFlow 原生能力）。
4. 不修改数据库 schema。

---

## 13. 补充说明

本 story 是继深化 ExecutionRunner、TurnEventPipeline、SessionDomain、DbPerPathCache、ServiceContainer、ChannelSenderSeam 之后的最后一项浅残留大扫除。完成后代码库将消除已知的伪造成功 mock 和跨路由杂乱依赖。

---

## 14. PRD 完整性自检查

- [x] 每个稳定块至少有一条 happy path（写入第 6 节）。
- [x] 涉及用户输入的稳定块有字段级验证规则（写入第 7 节）。
- [x] 每个稳定块有 ≥1 条具体预期值锚点（例子表，写入第 6.3 节）；§7 每条规则有有效/无效例子。
- [x] 每个稳定块有失败场景或显式 N/A（写入第 8 节）。
- [x] 跨模块/外部依赖调用有错误状态定义（写入第 8 节）。
- [x] 复杂度已分级并给出理由（写入第 9 节，分级为 `simple`）。
- [x] 第 10 节“技术方案”：`simple` 给出明确设计目标、模块职责与接口契约（第 10 节已完整）。
- [x] 第 11 节“覆盖接缝”：每个稳定块至少一个 seam（写入第 11.1 节）。
