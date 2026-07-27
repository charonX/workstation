# Signoff — 2026-07-23-nested-flow

---

## Stage 1: Assertion Signoff (Attempt 2)

**签核日期**：2026-07-27
**REQ-VERSION**：v2-hash:908d0d519cd9d8d668fa99c1f665649cb12e62697b3d29bb7561297e253d46f8

### 回流说明

Attempt 1 的 signoff 已被归档到 `archive/attempt-1/signoff.md`。Attempt 2 因 BUG-001 暴露 `upstreamVariables.js` 集中式 switch 易漏，回流到 TECH-DESIGN，引入统一节点输出模型（ADR-010）和 renderer 侧节点类型注册表。本 signoff 针对 attempt 2 的新契约。

### REQ 覆盖摘要

| REQ | 测试文件 | 类型 | 断言状态 |
|---|---|---|---|
| FLOW-032 flowInput 节点 | subflowNodeTypes.test.js, nodeRegistry.test.js | 单元 | 待签 |
| FLOW-033 flowOutput 节点 | subflowNodeTypes.test.js, nodeRegistry.test.js | 单元 | 待签 |
| FLOW-034 callFlow 字段校验 | callFlowValidation.test.js | API 集成 | 待签 |
| FLOW-035 同步执行与变量隔离 | subflowIsolation.test.js | 单元 | 待签 |
| FLOW-036 startNodeId 多入口 | subflowIsolation.test.js | 单元 | 待签 |
| FLOW-037 失败传播 | subflowFailure.test.js | 单元 | 待签 |
| FLOW-038 循环/深度校验 | circularReference.test.js | API 集成 | 待签 |
| FLOW-039 调最新版本 | subflowLatestVersion.test.js | API 集成 | 待签 |
| FLOW-040 嵌套执行记录 | nestedExecution.test.js | API 集成 | 待签 |
| FLOW-041 候选列表 API | callflowCandidates.test.js | API 集成 | 待签 |
| FLOW-042 executor 签名/多输出 | executorSignature.test.js | 单元 | 待签 |
| FLOW-043 节点面板/配置 UI | NodeConfigPanel.test.jsx, subflowConfig.spec.js | 组件+E2E | 骨架待 UI 落地 |
| FLOW-044 执行详情展开 | nestedExecutionDetail.spec.js | E2E | 骨架待 UI 落地 |
| FLOW-045 跳转子流程 | subflowConfig.spec.js | E2E | 骨架待 UI 落地 |
| FLOW-046 foreach + callFlow | foreachCallflow.test.js | 单元 | 待签 |
| FLOW-047 setVariables 引擎语义 | setVariables.test.js | 单元 | 待签 |
| FLOW-047 setVariables 字段校验 | setVariablesValidation.test.js | 单元 | 待签 |
| FLOW-047 setVariables 上游可见 | setVariablesUpstream.test.js | 单元 | 待签 |
| FLOW-047 setVariables 配置 UI | SetVariablesFields.test.jsx | 组件 | 骨架待 UI 落地 |
| ADR-010 统一输出模型/注册表 | nodeRegistry.test.js, setVariablesUpstream.test.js | 单元 | 待签 |

### Capability / Entity 覆盖

- capability：`flow-orchestration`（已登记，无需新增能力）
- entity：`flow`、`flow-engine`、`execution`（均已登记）
- business-capabilities.md 已更新测试路径映射

### 关键断言决策（Attempt 2 新增/变更）

1. **统一节点输出模型**：所有节点类型使用 `config.outputVariables: [{ name, type?, defaultValue? }]` 作为唯一下游可见变量声明；`agent.outputVariable`、`callFlow.outputMappings`、`setVariables.assignments` 旧字段不再识别。
2. **节点类型注册表**：renderer 侧 `nodeRegistry.js` 统一注册节点类型元数据、`defaultConfig`、`configPanel`、`deriveOutputVariables`；新增节点类型只需注册一次。
3. **setVariables 新契约**：`outputVariables` 声明下游变量名；`expressions: [{ name, expression }]` 描述求值逻辑；expression 中的 `name` 必须在同节点 `outputVariables` 中存在。
4. **callFlow 出参自动填充**：保存时由 `flowService` 根据目标子 flow 所有 `flowOutput` 的 `outputVariables` 并集自动写入 `callFlow.config.outputVariables`，不再持久化 `outputMappings`。
5. **agent 单输出**：`config.outputVariables[0].name` 作为 `result.output` 写入目标；不再读取 `config.outputVariable`。
6. **upstreamVariables.js 通用化**：通过 `nodeRegistry[type].deriveOutputVariables(config)` 推导，不再按类型硬编码 switch。
7. **开发阶段无历史数据迁移**：旧 flow / execution 数据可清空，不保证向后兼容。
8. **保留Attempt 1 其他决策**：同步调用、变量隔离、8层深度、失败传播、嵌套执行记录、调最新语义等保持不变。

### 检查清单

- [x] 不存在未关闭的 prd-gap-report.md
- [x] PRD 第 6-8 节（操作流、验证规则、错误状态）已覆盖
- [x] 每个 REQ-ID 至少一个测试文件
- [x] 每个测试文件含 REQ-TRACE / REQ-VERSION / CAPABILITY-TRACE / ENTITY-TRACE
- [x] capability/entity 与 business-capabilities.md 一致
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（nodeRegistry 使用 dynamic import 优雅失败）
- [x] 无快照当判定依据
- [x] 边界/错误 case 覆盖（AC 各错误码、循环、深度、类型保留、未达出口、表达式非法）
- [ ] 全部预期值被人审阅（人审阅本文件即完成）

### 人签核

**断言归人**：人已审阅测试骨架、断言、接口契约，承诺以上预期值即为"做对"的定义。

- **签核人**：用户
- **签核日期**：2026-07-27
- **REQ-VERSION**：v2-hash:908d0d519cd9d8d668fa99c1f665649cb12e62697b3d29bb7561297e253d46f8
