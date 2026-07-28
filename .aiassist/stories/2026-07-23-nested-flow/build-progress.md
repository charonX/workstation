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
| S2 | 节点类型配置迁移：agent/setVariables/callFlow 配置面板适配新契约，callFlow 保存时自动填充 outputVariables | FLOW-032~034, FLOW-043, FLOW-047 | `NodePalette.jsx`, `NodeConfigPanel.jsx`, `validateFlowNodes.js`, `flowService.js` | COVERED (`648cf35`) |
| S3 | 运行时引擎迁移：单输出按 `outputVariables[0].name` 写入；setVariablesExecutor 用 expressions；callFlowExecutor/invokeSubflow 用 outputVariables | FLOW-035~037, FLOW-039, FLOW-042, FLOW-046, FLOW-047 | `flowEngine.js`, `setVariablesExecutor.js`, `agentExecutor.js`, `callFlowExecutor.js`, `flowOutputExecutor.js`, `taskService.js` | COVERED (pending commit) |
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
| NodePalette 从注册表读取节点类型 | `NodePalette.jsx` | `subflowConfig.spec.js` | COVERED |
| NodeConfigPanel 从注册表读取配置面板 | `NodeConfigPanel.jsx` | `NodeConfigPanel.test.jsx` | COVERED |
| setVariables 配置面板维护 outputVariables + expressions | `NodeConfigPanel.jsx` | `SetVariablesFields.test.jsx` | COVERED |
| callFlow 保存时自动填充 outputVariables | `flowService.js` | `callFlowValidation.test.js` | COVERED |
| 客户端校验镜像 outputVariables 规则 | `validateFlowNodes.js` | `setVariablesValidation.test.js` | COVERED |

---

## Slice S3: 运行时引擎迁移

### PRD→代码 可追溯性表

| PRD/REQ 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| agent 单输出按 `outputVariables[0].name` 写入 | `flowEngine.js` | `executorSignature.test.js` | COVERED |
| setVariablesExecutor 按 expressions 求值 | `setVariablesExecutor.js` | `setVariables.test.js` | COVERED |
| callFlowExecutor 按 outputVariables 返回 | `callFlowExecutor.js` | `subflowIsolation.test.js`, `subflowFailure.test.js` | COVERED |
| invokeSubflow 扫描 flowOutput outputVariables | `taskService.js` | `subflowLatestVersion.test.js`, `nestedExecution.test.js` | COVERED |

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
| S1 refactor | `cf994ab` | [refactor] S1: unified output model infrastructure |
| S2 | `648cf35` | [build] S2: node config migration to unified output model |
| S2 fix | `2f76651` | E-FLOW-NO-INPUT enforcement + agent outputVariable migration |
| S3 | pending | [build] runtime engine migration to unified output model |

---

## S2 修复记录（PRD 对齐后发现）

| 缺陷 | 根因 | 修复文件 | 状态 |
|---|---|---|---|
| E-FLOW-NO-INPUT 未在 `flowService.validateSubflowCalls` 中强制执行 | S2 实现漏了 PRD #6.2 / 7.4 的入口存在性校验，子 flow 无 flowInput 时仍允许保存 | `src/services/flowService.js` | fixed |
| agent 配置面板仍写旧 `config.outputVariable` | NodeConfigPanel 单输出快捷框未随统一输出模型迁移；FlowCanvas 保存/初始化也保留 legacy `outputVariable` 字段 | `src/renderer/components/flow/NodeConfigPanel.jsx`, `src/renderer/components/flow/FlowCanvas.jsx` | fixed |

---

## 阻塞项

- `circularReference.test.js` 仍跟踪 REQ v1 hash，其测试用例使用无 flowInput 的子 flow 构造环，与 PRD v2 / requirements-v2.0 的 `E-FLOW-NO-INPUT` 强制检查冲突。需 `/test-author` 将该测试更新到 v2.0 契约。
