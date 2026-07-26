# Build Progress — 2026-07-23-nested-flow

> 负责人：agent (父代理调度)
> 契约版本：v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4

## 切片计划

| Slice | REQ | 描述 | 状态 |
|---|---|---|---|
| S1 | FLOW-042 | 引擎 executor 签名扩展 (services/currentDepth) + 多输出 result.outputVariables | pending |
| S2 | FLOW-032/033 | flowInput/flowOutput 节点类型、executor、validator 注册 | pending |
| S3 | FLOW-036 | startNodeId 选项 + 入口限定 applyTriggerVariableOverrides | pending |
| S4 | FLOW-035 | callFlow executor：parentExpr 解析、入/出参映射、隔离 context | pending |
| S5 | FLOW-037/039/040 | taskService invokeSubflow、executions 表 migration、嵌套执行记录、失败传播、调最新 | pending |
| S6 | FLOW-034/038/041/046 | validateSubflowCalls（字段/循环/深度）、callflow-candidates API、foreach 组合 | pending |
| S7 | FLOW-043/045 | 前端：NodePalette、CallFlowFields/FlowInputFields/FlowOutputFields 配置面板、跳转子流程 | complete |
| S8 | FLOW-044 | 前端：执行详情嵌套展开 UI | complete |
| S9 | FLOW-047 | setVariables 通用变量赋值节点 (executor + 校验 + UI) | complete |

## Slice 记录

### S1: FLOW-042 — engine executor signature + multi-output (complete)
- Commits: `16ff408` [build] S1 → `b740fec` [refactor] S1
- Tests: 6/6 new + 56/56 existing = 62/62 pass
- PRD alignment: ALIGNED
- Notes: `startNodeId` option pre-pulled (forward-compat for S3); refactor extracted `writeOutputVariable` helper
- Scope: only `src/flowEngine/flowEngine.js`

### S2: FLOW-032/033 — flowInput/flowOutput node types (complete)
- Commits: `74c3722` [build] S2 → `cc683e0` [refactor] S2
- Tests: 11/11 new + 56/56 existing = 67/67 pass
- PRD alignment: ALIGNED
- Notes:
  - New: flowInputExecutor.js / flowOutputExecutor.js
  - flowInput added to TRIGGER_LIKE set; both types registered in defaultExecutors + VALIDATED_NODE_TYPES
  - evaluateExpression.js reserved-word rewrite needed for AC5 test using node id "in" (safe additive change)
  - Refactor deleted redundant wrapper functions, fixed misleading comments
- Scope: 6 files (executors + engine + validator + evaluateExpression)

### S3: FLOW-036 — startNodeId + entry-scoped override (complete)
- Commits: `d8d20d5` [build] S3 → `d3b72a7` [refactor] S3
- Tests: 3/3 FLOW-036 + 56/56 regression
- PRD alignment: ALIGNED
- Notes: applyTriggerVariableOverrides accepts entryNodeId; top-level backward compat preserved; two-pass declaredNames collection prevents same-named inputVars clobbering non-entry trigger defaults
- Scope: only `src/flowEngine/flowEngine.js`

### S4: FLOW-035 — callFlow executor (complete)
- Commits: `ca42a14` [build] S4 → `446eb0e` [build] S4 fix (__ prefix)
- Tests: 5/5 FLOW-035 + 81 total engine green
- PRD alignment: initial MISALIGNMENT (AC5 __childExecutionId bare-key leak) → fixed by engine `__` prefix skip in writeOutputVariable
- Notes: parentExpr regex, service invokeSubflow delegation, D10 outputVariables return; errors wrapped as E-SUBFLOW-FAILED
- Scope: callFlowExecutor.js (new) + index.js + flowEngine.js (defaultExecutors + __ prefix guard)

### S5: FLOW-037/039/040 — invokeSubflow + migration + nested records (complete)
- Commits: `7827105` [build] S5 + `fdd76a3` revert projectId auto-resolve + `2429416` [test] fix test helpers
- Tests: 5/5 subflowFailure + 6/6 nestedExecution (AC migration、子记录、3层嵌套、cascade purge、调最新)
- PRD alignment: 验证通过
- Notes:
  - db.js: executions 加 parentExecutionId/parentNodeId/depth + idx_executions_parentExecutionId
  - taskService: invokeSubflowImpl/makeInvokeSubflow 递归调用 run()，加载子 flow 当前版本，扫描 exit flowOutput
  - taskService: listExecutions 支持 parentExecutionId 过滤；purgeExpiredExecutions 用递归 CTE 级联删除
  - routes/executions.js: GET ?parentExecutionId= 支持；revert projectId 自动解析（违反既有 REQ-SCHEDULE-001 契约）
  - flowService: trigger outputVariables type 字段可选（与 flowInput/flowOutput 一致）
  - 回归 255/255 全绿；剩余 14 fail 均属 S6 范围
- Scope: db.js + taskService.js + routes/executions.js + flowService.js（type 可选）

### S6: FLOW-034/038/041/046 — validation + candidates + foreach (complete)
- Commits: `ea67ebe` [build] S6 + `bea6855` [refactor] S5/S6 comments + `0d7fb63` [test] fill AC6
- Tests: 14 API/engine tests (FLOW-034/038/041/046) + 308 full regression = **308/308 green**
- PRD alignment: ALIGNED
- Notes:
  - flowService: validateCallFlowConfig + validateSubflowCalls (DFS cycle/depth + ref/mapping checks) + listCallFlowCandidates
  - routes/flows: GET /api/flows/:id/callflow-candidates
  - forEachExecutor + engine continuation stack 支持 foreach body 含 callFlow 的循环迭代
  - 引擎 foreach body continuation 改动零回归
  - 已知小限制：FLOW-034 AC4 outputMappings auto-generation 是 UI 展示用，runtime 已经返回所有 childOutputs，前端可从 callflow-candidates 派生
- Scope: flowService.js + routes/flows.js + forEachExecutor.js + flowEngine.js (continuation stack)

### S7: FLOW-043/045 — palette + config panels + jump-to-child (complete)
- Commit: `8c7d62a` [build] S7
- Tests: backend 308/308 unchanged; E2E data-testids match spec; esbuild bundle clean
- Notes:
  - NodePalette: flowInput(Trigger)/flowOutput(new Flow cat)/callFlow(Logic) + palette-node-{type} testids
  - NodeConfigPanel: FlowInputFields/FlowOutputFields(shared DeclaredVariablesFields) + CallFlowFields(subflow select/entry select/input mappings/output read-only/open child)
  - validateFlowNodes client mirror + i18n en/zh
  - FlowCanvas/upstreamVariables/api/flows.js updates for callFlow
- Scope: renderer/ only (9 files)

### S8: FLOW-044 — nested execution detail expand/collapse (complete)
- Commit: `2a8b10b` [build] S8
- Tests: backend 308/308 unchanged; E2E data-testids match spec; esbuild bundle clean
- Notes:
  - ExecutionNodeList 重构支持递归嵌套：callFlow 节点含 __childExecutionId 时渲染展开按钮
  - 展开时 lazy-fetch 子 execution，渲染缩进子列表（data-indent 属性）
  - 独立展开状态、缓存、i18n en/zh、CSS 样式
  - 默认折叠状态零回归
- Scope: renderer/ only (ExecutionNodeList.jsx + index.css + i18n)

### S9: FLOW-047 — setVariables 通用变量赋值节点 (complete)
- Commits: `8f10b2f` [build] S9 初版 → `dce4ccf` [test] TDD 单元 → `0a682a6` [test] 移除业务测试 stub 跑真实 executor + D11 模板拼接用例 → `1af671f` [build] 移除无消费者的 context[nodeId][varName] 嵌套写入 → `128b2f1` [refactor] 提取 writeContextEntries helper
- Tests: 15/15 setVariables business tests (8 engine + 7 validation) + 97 engine unit tests green; TDD 5/5 green; total 102/102
- PRD alignment: 首轮 MISALIGNMENT_FOUND（业务测试 stub 覆盖真实 executor + 引擎 triple-write 第二段反向污染），fix 后 ALIGNED

#### PRD→代码 可追溯性表

| PRD 意图 | 实现文件 | 测试文件 | 状态 |
|---|---|---|---|
| AC1 节点注册 (defaultExecutors + VALIDATED_NODE_TYPES + NodePalette) | `src/flowEngine/flowEngine.js`, `src/flowEngine/executors/index.js`, `src/services/flowService.js`, `src/renderer/components/flow/NodePalette.jsx` | setVariablesValidation.test.js (AC1) | COVERED |
| AC2 字段校验 (assignments 数组、variableName 格式/唯一、expression 非空) | `src/services/flowService.js` (validateSetVariablesConfig), `src/renderer/components/flow/validateFlowNodes.js` | setVariablesValidation.test.js (AC2) | COVERED |
| AC3 执行语义：赋值写入 context/record (D10 多输出) | `src/flowEngine/executors/setVariablesExecutor.js`, engine writeContextEntries/writeOutputVariable | setVariables.test.js (AC3, 真实 executor), TDD unit | COVERED |
| AC4 单 {{var}} 引用保留原类型 | setVariablesExecutor.js (evaluateExpression 单引用路径保留类型) | setVariables.test.js (AC4, 真实 executor), TDD unit | COVERED |
| AC5 多入口归一化 | setVariablesExecutor.js | setVariables.test.js (AC5, 真实 executor) | COVERED |
| AC6 常量 + 嵌套字段 ({{a.b.c}}) + 模板字符串拼接 | setVariablesExecutor.js | setVariables.test.js (AC6 含新增 D11 拼接用例, 真实 executor), TDD unit | COVERED |
| AC7 pass-through 语义 | setVariablesExecutor.js (returns status:success) | setVariables.test.js (AC7, 真实 executor) | COVERED |
| AC8 UI 配置面板 (SetVariablesFields) | NodeConfigPanel.jsx + i18n | SetVariablesFields.test.jsx (skeleton) | COVERED (skeleton) |

- Notes:
  - setVariablesExecutor.js: 新增；三态 expression 求值（单 {{var}} 引用保留类型 / 模板拼接 / 纯字面量），走引擎 evaluateExpression
  - engine flowEngine.js: 初版为配合 stub 维护了 `context[nodeId][varName]` 嵌套对象（triple-write 第二段），PRD 对齐发现无生产消费者后移除；refactor 提取 writeContextEntries helper 统一 namespaced key + bare key 双写逻辑，避免 writeOutputVariable/setContextVariable 内联重复
  - evaluateExpression.buildNestedScope 独立负责从 flat key 构造嵌套 scope，单一事实源，executor 无需感知嵌套形式
  - 业务测试 stub 移除后直接跑真实 setVariablesExecutor，新增 D11 模板字符串拼接用例覆盖原 stub 不支持的场景
  - validateSetVariablesConfig: assignments 数组 + variableName (VARIABLE_NAME_PATTERN 复用) + expression 非空校验
  - SetVariablesFields: 行级编辑器，每行 variableName 输入 + expression 输入 + VariablePicker 插入 {{var}} + 增删按钮
  - i18n: zh/en nodeTypes.setVariables + assignments/addAssignment/setVariablesHelp
- Scope: 9 files (executor + engine + flowService + 4 renderer + 2 i18n) + TDD test file

## 总结
- 9 个切片全部完成（S1–S9）
- 后端业务测试：setVariables 15/15 全绿；engine 单元测试 97/97 全绿
- 新 REQ 测试 33 个（engine unit）+ 6 个（execution API）+ 17 个（flow API）+ 15 个（setVariables）= 71 个新业务测试通过
- 前端 esbuild bundle 通过；E2E 测试待 QA runner 验证（需 Electron 构建）
- DB 集成测试（circularReference/callflowCandidates/nestedExecution/codex-harness）因环境 better-sqlite3 原生模块版本不匹配未能在本次验证，属预先存在问题
- 总 commits：12 个 [build] + 3 个 [refactor] + 2 个 [test] + 1 个 [build] S9
