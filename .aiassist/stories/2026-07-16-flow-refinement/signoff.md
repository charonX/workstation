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

- 节点配置 schema 最终版在 tech-design 阶段确定。→ **已解决**（2026-07-17 tech-design §5.4）
- Claude Agent adapter 具体 provider/SDK 在 tech-design 阶段确定。→ **已解决**（ADR-005）
- 执行日志清理逻辑实现方式在 tech-design 阶段确定。→ **已解决**（启动 + 每日 cron）

### 补充签核（2026-07-17，BUILD 阶段 S3 对齐检查）

S3 PRD 对齐子代理报告 3 项 UNCERTAIN，用户当面裁决并签核：

1. **REQ-FLOW-018 AC2 v1.1**：变量名 trim 后非空，纯空白（`" "`）拒绝。新增断言：triggerConfig「拒绝纯空白变量名并返回 400」。✅
2. **REQ-FLOW-019 AC4 v1.1**：`expression` 改为必填，缺失或 trim 后为空均拒绝。新增断言：conditionConfig「拒绝纯空白表达式」「拒绝缺失 expression 字段」。✅
3. **provider/options allowlist 拒绝路径**：接受 tech-design §5.4 层承诺，不补签核业务测试，REFLECT 时记录。✅

requirements-v1.hash 已重新生成（`036e30e2`），两个受影响测试文件的 REQ-VERSION 头已同步。

### 补充签核 v1.2（2026-07-17，BUILD 阶段 S4 对齐检查）

S4 PRD 对齐子代理报告 1 项缺口 + 1 项 UNCERTAIN + 1 观察项，用户当面裁决并签核：

1. **REQ-FLOW-028 AC1 v1.2**："每次执行"明确涵盖引擎安全中止（maxIterations/maxDepth/节点或 executor 缺失）的执行。新增断言：executionLog「引擎安全中止的执行也写入已执行节点的记录」。✅
2. **REQ-FLOW-028 AC2 v1.2**：`output` 总是捕获 agent 文本输出（不经 outputVariable 声明）。新增断言：executionLog「agent 未声明 outputVariable 时 output 列仍捕获文本输出」。✅
3. **G2 观察项**：成功路径 insertExecutionNodes 写入失败会把成功执行改判 error——接受为 fail-visible 行为，记 REFLECT。✅

requirements-v1.hash 已重新生成（`2585f81f`），executionLog.test.js 的 REQ-VERSION 头已同步。

## Feel Signoff

（待 BUILD 和 QA 完成后填写）
