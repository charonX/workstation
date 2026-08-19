# ADR-036: 统一 HTTP 响应助手与生产静默 Mock 清除

## 状态
已接受 (Accepted) — 2026-08-19

## 背景与问题
在前期快速迭代中，代码库中遗留了若干违反真实性原则、模块职责错位或重复内联的浅残留（架构评审候选 #8）：
1. **生产静默 Mock 假成功**：`src/flowEngine/agentAdapter.js` 固定返回 mock success；未配置 provider 的 agent 节点在 `agentExecutor.js` 中静默走 mock 返回假成功，掩盖了真实缺少 provider 的配置错误，破坏了生产执行的真实性原则。
2. **5 个路由各自定义响应与错误映射助手**：`src/http/routes/{mcp,plugins,skills,projects,settings}.js` 重复实现 `ok`/`badRequest`/`mapError`/`notFound` 等助手，默认状态码存在 400 vs 500 不一致，且 `plugins.js` 跨文件反向引入 `mcp.js` 内部导出的 response helper。
3. **Cron 描述助手宿主错位**：`src/services/taskService.js` 承载了 `getCronDescription` 纯 cron 字符串解析与人类可读描述逻辑，而真正的 cron 校验与调度归属 `src/services/schedulerService.js`。
4. **flowService 残留废弃 UI 计算助手**：`src/services/flowService.js` 中包含 `toggleRun`、`zoomIn`、`zoomOut`、`resetZoom`、`getNodeCategories`、`getEditableFields` 等纯前端画布计算函数，现已全无活跃调用方，属于典型的未清理浅残留。

## 决策

1. **废除生产静默 Mock，显式报告错误**：
   - 彻底删除 `src/flowEngine/agentAdapter.js`。
   - `agentExecutor.js` 中，当 `node.config.provider` 未提供或为空时，返回显式错误状态 `error`（错误码 `E-AGENT-NO-PROVIDER`，错误文案 `Agent provider is required`），杜绝伪造假成功。
   - 测试环境统一通过 `executionRunner.setAgentExecutorForTests` 注入测试 mock。

2. **统一 HTTP 响应助手 (`src/http/responders.js`)**：
   - 提取集中式公共响应助手模块，导出 `ok`、`noContent`、`badRequest`、`notFound`、`mapError`、`decodeParam`、`normalizeBool`。
   - `mapError` 统一状态码规则（默认 400，E- 开头业务码透传，`status === 500` 时映射为 `INTERNAL_ERROR`），并保证 `invalidAgents`、`issues`、`existing` 等业务上下文结构安全透传。
   - 5 个路由文件统一导入 `responders.js`，彻底解开 `plugins.js -> mcp.js` 的跨路由非对称依赖。

3. **Cron 描述助手归位至调度服务**：
   - 将 `getCronDescription` 移至 `src/services/schedulerService.js`，`schedules.js` 路由改从 `schedulerService` 直接导入。
   - `src/services/taskService.js` 移除本地解析实现，保留单行兼容转发导出。

4. **清理服务端 service 层废弃 UI 计算助手**：
   - 从 `src/services/flowService.js` 中彻底删除 `toggleRun`、`zoomIn`、`zoomOut`、`resetZoom`、`getNodeCategories`、`getEditableFields` 6 个函数，使服务层聚焦数据持久化与业务规则校验。

## 后果与影响

### 积极影响
- 生产执行真实性恢复，缺少 provider 的 flow 能即时暴露配置缺陷，不再伪造执行结果。
- HTTP 响应与错误映射标准化，消除了不同路由之间的方言分裂，跨路由反向依赖清零。
- 模块职责边界清晰，Cron 描述与调度服务统一，服务端 service 层摆脱前端 UI 计算逻辑。
- 1034 个单元测试全量通过，所有清理点均通过 Deletion Test 验证。

### 潜在代价
- 极早期未声明 provider 的历史 flow 运行契约若依赖 mock 成功，需在测试中显式经由 `setAgentExecutorForTests` 注入 mock。
