# 测试计划 — 嵌套子流程调用（Nested Subflow）Attempt 2

> 故事 ID：`2026-07-23-nested-flow`
> REQ 版本：`v2.0`（hash=`908d0d51...`）
> 生成日期：2026-07-27

---

## 测试策略

- **CLI 优先**：本项目 CLI 层较薄，核心 seams 为 `flowEngine.run()` 单元和 `flowService` API/函数接口。
- **引擎单元为主**：大多数行为可通过构造 flow JSON 直接驱动 `flowEngine.run()` 验证。
- **服务层集成**：跨模块校验（callFlow、循环检测、候选列表）使用内存 DB fixture。
- **组件测试**：NodePalette、NodeConfigPanel、变量选择器用 React Testing Library。
- **浏览器 E2E**：画布拖拽、子流程配置、执行详情展开用 Playwright。
- **统一输出模型/注册表**：新增 `nodeRegistry.test.js` 作为基础契约测试；所有节点类型测试默认检查 `outputVariables`。

---

## REQ → 测试映射

| REQ-ID | 标题 | Seam | 测试类型 | 测试文件 |
|---|---|---|---|---|
| REQ-FLOW-032 | flowInput 节点类型 | `flowEngine.run()` + `validateNodeList` + `nodeRegistry` | 单元 | `flow-engine/.../api/subflowNodeTypes.test.js`, `flow-engine/.../api/nodeRegistry.test.js` |
| REQ-FLOW-033 | flowOutput 节点类型 | `flowEngine.run()` + `validateNodeList` + `nodeRegistry` | 单元 | `flow-engine/.../api/subflowNodeTypes.test.js`, `flow-engine/.../api/nodeRegistry.test.js` |
| REQ-FLOW-034 | callFlow 节点配置与字段校验 | `flowService.validateNodeList` / `validateSubflowCalls` | 单元+集成 | `flow/.../api/callFlowValidation.test.js` |
| REQ-FLOW-035 | callFlow 同步执行与变量隔离 | `flowEngine.run()` + stub invokeSubflow | 单元 | `flow-engine/.../api/subflowIsolation.test.js` |
| REQ-FLOW-036 | 多入口子流程 startNodeId | `flowEngine.run()` | 单元 | `flow-engine/.../api/subflowIsolation.test.js` |
| REQ-FLOW-037 | 子流程失败向父传播 | `flowEngine.run()` + 真实 invokeSubflow | 单元+集成 | `flow-engine/.../api/subflowFailure.test.js` |
| REQ-FLOW-038 | 保存时循环引用/深度校验 | `flowService.validateSubflowCalls` | 单元 | `flow/.../api/circularReference.test.js` |
| REQ-FLOW-039 | 运行时加载子流程最新版本 | `taskService.executeTask` 集成 | 集成 | `flow-engine/.../api/subflowLatestVersion.test.js` |
| REQ-FLOW-040 | 嵌套执行记录 | `taskService.executeTask` + HTTP API | 集成 | `execution/.../api/nestedExecution.test.js` |
| REQ-FLOW-041 | callFlow 候选子流程列表 API | `flowService.listCallFlowCandidates` / HTTP API | 单元+API | `flow/.../api/callflowCandidates.test.js` |
| REQ-FLOW-042 | 引擎 executor 签名扩展与多输出 | `flowEngine.run()` | 单元 | `flow-engine/.../api/executorSignature.test.js` |
| REQ-FLOW-043 | 节点面板与配置面板 UI | React 组件 + Playwright | 组件+E2E | `flow/.../component/NodeConfigPanel.test.jsx`, `flow/.../e2e/subflowConfig.spec.js` |
| REQ-FLOW-044 | 执行详情嵌套展开 UI | Playwright | E2E | `execution/.../e2e/nestedExecutionDetail.spec.js` |
| REQ-FLOW-045 | 从 callFlow 跳转到子流程画布 | Playwright | E2E | `flow/.../e2e/subflowConfig.spec.js` |
| REQ-FLOW-046 | foreach 内 callFlow 批量调用 | `flowEngine.run()` | 单元 | `flow-engine/.../api/foreachCallflow.test.js` |
| REQ-FLOW-047 | setVariables 节点赋值/归一化 | `flowEngine.run()` + `validateNodeList` + React 组件 | 单元+组件 | `flow-engine/.../api/setVariables.test.js`, `flow/.../api/setVariablesValidation.test.js`, `flow/.../api/setVariablesUpstream.test.js` |
| ADR-010 系统约束 | 统一输出模型 + 节点注册表 | `nodeRegistry.deriveOutputVariables` + `getUpstreamVariableGroups` | 单元 | `flow-engine/.../api/nodeRegistry.test.js`, `flow/.../api/setVariablesUpstream.test.js` |

---

## 新增/更新测试文件清单

### 新增

| 文件 | 覆盖 REQ | 说明 |
|---|---|---|
| `tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/nodeRegistry.test.js` | ADR-010, FLOW-032/033/043/047 | 节点注册表契约：所有类型默认配置含 outputVariables；deriveOutputVariables 正确 |
| `tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/component/NodeConfigPanel.test.jsx` | FLOW-043 | 配置面板按注册表渲染；setVariables 同时维护 outputVariables + expressions |

### 需要更新

| 文件 | 原契约 | 新契约 | 更新点 |
|---|---|---|---|
| `flow-engine/.../api/setVariables.test.js` | `assignments` | `outputVariables` + `expressions` | 节点 config、断言路径不变 |
| `flow/.../api/setVariablesValidation.test.js` | `assignments` | `outputVariables` + `expressions` | 校验字段名和错误路径 |
| `flow/.../api/setVariablesUpstream.test.js` | `assignments` | `outputVariables` | 上游变量组推导 |
| `flow-engine/.../api/executorSignature.test.js` | `config.outputVariable` | `config.outputVariables[0].name` | agent 节点默认配置 |
| `flow/.../api/callFlowValidation.test.js` | `config.outputMappings` | `config.outputVariables` | 出参自动填充断言 |
| `flow-engine/.../api/subflowIsolation.test.js` | 可能含 outputMappings | `outputVariables` | 检查并调整 callFlow config |

### 无需大改

- `subflowNodeTypes.test.js`
- `subflowFailure.test.js`
- `circularReference.test.js`
- `subflowLatestVersion.test.js`
- `callflowCandidates.test.js`
- `foreachCallflow.test.js`
- `nestedExecution.test.js`
- `subflowConfig.spec.js`（仅 setVariables 配置部分可能需微调）

---

## 占位断言（等人签核）

所有测试头部 `ASSERTIONS-SIGNED: false`。以下位置需要人确认预期值：

1. `nodeRegistry.test.js`：每个节点类型的默认 outputVariables 名称（如 agent 默认 `"output"`）。
2. `setVariablesValidation.test.js`：expressions 中 name 不在 outputVariables 中时的错误码（`E-EXPR` 具体文案）。
3. `callFlowValidation.test.js`：保存后 `callFlow.config.outputVariables` 是否按子 flowOutput 并集自动填充。
4. `executorSignature.test.js`：agent 单输出写入目标是否改为 `outputVariables[0].name`。

---

## REFLECT 人工验收项

以下纯审美/视觉判断不进入自动化测试：

- 节点在画布上的图标、颜色、形状（由设计系统决定）。
- 配置面板间距、字体大小、过渡动画曲线。
- 执行详情展开动画的时序和 easing。

---

## 风险

- 旧测试文件可能仍引用 `assignments` / `outputVariable` / `outputMappings`，需要逐一遍历更新。
- `nodeRegistry` 尚未实现，测试会红；需实现后才能绿。
- 由于开发阶段清空历史数据，现有 E2E fixture 可能需要重建。

---

## 版本

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v2.0 | 2026-07-27 | Attempt 2：适配统一节点输出模型 + 节点注册表；新增 nodeRegistry 测试；更新 setVariables/callFlow/agent 测试契约 | agent |
| v1.1 | 2026-07-26 | 新增 FLOW-047 setVariables 节点测试（单元 + 校验 + 组件骨架） | agent |
| v1 | 2026-07-23 | 初版，覆盖 FLOW-032~046 全部 REQ | agent |
