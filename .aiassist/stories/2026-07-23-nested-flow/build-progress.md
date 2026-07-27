# Build Progress — 2026-07-23-nested-flow (Attempt 2)

> Story ID: `2026-07-23-nested-flow`
> Attempt: 2
> Phase: BUILD
> Start: 2026-07-27

---

## 切片计划

Attempt 1 已实现子流程调用的核心能力（flowInput/flowOutput/callFlow、嵌套执行记录、执行详情展开等）。Attempt 2 的核心变更是引入**统一节点输出模型**和**节点类型注册表**，解决 `upstreamVariables.js` 集中式 switch 易漏的问题。

| Slice | 目标 | 覆盖 REQ | 主要文件 | 状态 |
|---|---|---|---|---|
| S1 | 统一输出模型基础设施：创建 `nodeRegistry.js`，改造 `upstreamVariables.js`，统一 `flowService` outputVariables 校验 | ADR-010, FLOW-032 AC5, FLOW-033 AC6, FLOW-042 AC5 | `nodeRegistry.js`, `upstreamVariables.js`, `flowService.js` | COVERED |
| S2 | 节点类型配置迁移：agent/setVariables/callFlow 配置面板适配新契约，callFlow 保存时自动填充 outputVariables | FLOW-032~034, FLOW-043, FLOW-047 | `NodePalette.jsx`, `NodeConfigPanel.jsx`, `validateFlowNodes.js`, `flowService.js` | pending |
| S3 | 运行时引擎迁移：单输出按 `outputVariables[0].name` 写入；setVariablesExecutor 用 expressions；callFlowExecutor/invokeSubflow 用 outputVariables | FLOW-035~037, FLOW-039, FLOW-042, FLOW-046, FLOW-047 | `flowEngine.js`, `setVariablesExecutor.js`, `agentExecutor.js`, `callFlowExecutor.js`, `flowOutputExecutor.js`, `taskService.js` | pending |
| S4 | 回归验证：嵌套执行记录与执行详情 UI 在统一输出模型下无回归 | FLOW-040, FLOW-044, FLOW-045 | `db.js`, `taskService.js`, `ExecutionDetail.jsx` | pending |

---

## Slice S1: 统一输出模型基础设施

### PRD→代码 可追溯性表

| PRD/REQ 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| 所有节点类型统一使用 `config.outputVariables` | `nodeRegistry.js`, `flowService.js` | `nodeRegistry.test.js`, `setVariablesUpstream.test.js` | COVERED |
| `upstreamVariables.js` 不再按类型 switch | `upstreamVariables.js` | `setVariablesUpstream.test.js` | COVERED |
| 节点类型注册表包含 `deriveOutputVariables` | `nodeRegistry.js` | `nodeRegistry.test.js` | COVERED |

---

## Slice S2: 节点类型配置迁移

### PRD→代码 可追溯性表

| PRD/REQ 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| NodePalette 从注册表读取节点类型 | `NodePalette.jsx` | `subflowConfig.spec.js` | pending |
| NodeConfigPanel 从注册表读取配置面板 | `NodeConfigPanel.jsx` | `NodeConfigPanel.test.jsx` | pending |
| setVariables 配置面板维护 outputVariables + expressions | `NodeConfigPanel.jsx` | `SetVariablesFields.test.jsx` | pending |
| callFlow 保存时自动填充 outputVariables | `flowService.js` | `callFlowValidation.test.js` | pending |
| 客户端校验镜像 outputVariables 规则 | `validateFlowNodes.js` | `setVariablesValidation.test.js` | pending |

---

## Slice S3: 运行时引擎迁移

### PRD→代码 可追溯性表

| PRD/REQ 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| agent 单输出按 `outputVariables[0].name` 写入 | `flowEngine.js` / `agentExecutor.js` | `executorSignature.test.js` | pending |
| setVariablesExecutor 按 expressions 求值 | `setVariablesExecutor.js` | `setVariables.test.js` | pending |
| callFlowExecutor 按 outputVariables 返回 | `callFlowExecutor.js`, `taskService.js` | `subflowIsolation.test.js`, `subflowFailure.test.js` | pending |
| invokeSubflow 扫描 flowOutput outputVariables | `taskService.js` | `subflowLatestVersion.test.js`, `nestedExecution.test.js` | pending |

---

## Slice S4: 回归验证

### PRD→代码 可追溯性表

| PRD/REQ 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| executions 表 parentExecutionId/parentNodeId/depth | `db.js`, `taskService.js` | `nestedExecution.test.js` | pending |
| 执行详情嵌套展开 | `ExecutionDetail.jsx` | `nestedExecutionDetail.spec.js` | pending |
| 从 callFlow 跳转到子流程画布 | `NodeConfigPanel.jsx` | `subflowConfig.spec.js` | pending |

---

## Commit 记录

| Slice | Commit | 说明 |
|---|---|---|
| S1 | `7e19e989` | [build] S1: unified output model infrastructure |

---

## 阻塞项

无。
