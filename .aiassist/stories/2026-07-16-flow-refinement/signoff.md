# Signoff — 2026-07-16-flow-refinement

## Assertion Signoff

**日期**：2026-07-17
**签核人**：用户

### REQ 覆盖

| REQ-ID | 标题 | 测试文件 | 签核状态 |
|---|---|---|---|
| REQ-FLOW-018 | Trigger 节点输出变量声明 | `flow/api/triggerConfig.test.js`<br>`flow/e2e/triggerConfig.test.cjs` | ✅ |
| REQ-FLOW-019 | Condition 节点 JS 表达式与 true/false 分支标识 | `flow/api/conditionConfig.test.js`<br>`flow/e2e/conditionConfig.test.cjs` | ✅ |
| REQ-FLOW-020 | Claude Agent 节点统一 adapter 调用与输出变量 | `flow/api/agentConfig.test.js`<br>`flow/e2e/agentConfig.test.cjs`<br>`flow-engine/api/claudeAgentAdapter.test.js` | ✅ |
| REQ-FLOW-021 | 节点级错误处理配置 | `flow/e2e/nodeErrorHandling.test.cjs` | ✅ |
| REQ-FLOW-022 | 变量选择器按节点分组展示 | `flow/e2e/variablePicker.test.cjs` | ✅ |
| REQ-FLOW-023 | FlowEngine 变量注册表 | `flow-engine/api/variableRegistry.test.js` | ✅ |
| REQ-FLOW-024 | FlowEngine 变量替换机制 | `flow-engine/api/variableSubstitution.test.js` | ✅ |
| REQ-FLOW-025 | FlowEngine 节点错误处理执行 | `flow-engine/api/errorHandling.test.js` | ✅ |
| REQ-FLOW-026 | Claude Agent 悬空引用执行行为 | `flow-engine/api/danglingReference.test.js`<br>`flow/e2e/danglingReference.test.cjs` | ✅ |
| REQ-FLOW-027 | Claude Agent 工作目录注入 | `flow-engine/api/projectPathInjection.test.js` | ✅ |
| REQ-FLOW-028 | 执行日志持久化与自动清理 | `execution/api/executionLog.test.js`<br>`execution/e2e/executionLog.test.cjs` | ✅ |

### 检查清单

- [x] 不存在未关闭的 `prd-gap-report.md`
- [x] PRD 第 6-8 节已覆盖或已声明 N/A
- [x] 每个 REQ-ID 都有对应测试
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致
- [x] 无 `// TODO: HUMAN ASSERTION` 占位
- [x] 预期值来源清晰，非代码输出
- [x] 无快照当判定依据
- [x] 边界/错误 case 已覆盖
- [x] `signoff.md` Assertion 部分已创建

### 关键签核决策

1. **校验位置**：节点配置校验放在 `flowService` 层，非法时抛出 `"Validation failed"`，HTTP API 层返回 400。
2. **错误格式**：结构化错误 `{ path, message }`，方便前端定位字段。
3. **变量引用格式**：
   - Condition 表达式直接使用 `fullName`（如 `n1.count > 3`）。
   - Claude Agent prompt 使用 `{{fullName}}`（如 `{{n1.input}}`）。
4. **mock 注入方式**：FlowEngine 测试通过 `options.executors` 注入 mock adapter。
5. **执行日志存储**：新建 `execution_nodes` 表，与 `executions` 表通过 `executionId` 关联。
6. **E2E 断言级别**：E2E 测试只签核核心行为，具体 URL/定位器/文案由 BUILD 阶段根据实际组件确定。

### 遗留问题

- 节点配置 schema 最终版在 tech-design 阶段确定。
- Claude Agent adapter 具体 provider/SDK 在 tech-design 阶段确定。
- 执行日志清理逻辑实现方式在 tech-design 阶段确定。

## Feel Signoff

（待 BUILD 和 QA 完成后填写）
