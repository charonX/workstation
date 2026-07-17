# Requirements — 2026-07-16-flow-refinement

> 生成阶段：CRYSTALLIZE
> 来源：`.aiassist/stories/2026-07-16-flow-refinement/prd.md`
> 哈希文件：`requirements-v1.hash`

## 能力/实体映射

本 story 新增/扩展以下 capability 与 entity：

| REQ-ID | capability | entity | 说明 |
|---|---|---|---|
| REQ-FLOW-018~022 | flow-orchestration | flow | Flow Editor 节点配置面板与画布语义 |
| REQ-FLOW-023~027 | flow-orchestration | flow-engine | FlowEngine 变量注册表、执行语义、错误处理 |
| REQ-FLOW-028 | flow-orchestration | execution | 执行日志持久化与清理 |

## REQ-FLOW-018：Trigger 节点输出变量声明

**优先级**：P0  
**必须性**：必须  
**scope**：cross-module  
**modules**：flowService、前端 Flow Editor  
**interface_contract**：节点 `config.outputVariables` 数组，元素为 `{ name: string, type: "string"|"number"|"array"|"object", defaultValue?: any }`。  
**capability**：flow-orchestration  
**entity**：flow  
**UX 参照**：Flow Editor 节点属性面板

### 验收标准

1. Trigger 节点配置面板允许添加、编辑、删除一个或多个输出变量。
2. 每个输出变量必须填写名称，名称经 trim 后非空（纯空白拒绝），且在同一节点内唯一，类型为 `string` / `number` / `array` / `object` 之一。
3. 保存时前端校验变量名称 trim 后非空、类型合法；后端 API 拒绝非法配置并返回 400。
4. 保存后变量定义持久化到 flow 的 `nodeList` 中对应 Trigger 节点的 `config` 字段。
5. 删除变量后，该变量不再出现在下游节点的变量选择器中。

### 测试要求

- 类型：E2E + API 单元测试
- 路径：`tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/e2e/triggerConfig.test.cjs`、`tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/api/triggerConfig.test.js`

---

## REQ-FLOW-019：Condition 节点 JS 表达式与 true/false 分支标识

**优先级**：P0  
**必须性**：必须  
**scope**：cross-module  
**modules**：flowService、前端 Flow Editor  
**interface_contract**：节点 `config.expression` 为字符串；画布上 Condition 节点显示两个输出端口，分别标记 `true` 和 `false`。  
**capability**：flow-orchestration  
**entity**：flow  
**UX 参照**：Flow Editor 画布与节点属性面板

### 验收标准

1. Condition 节点配置面板提供表达式输入框，支持输入 JavaScript 表达式。
2. 表达式输入框支持变量选择器，可从上游节点已声明的变量中选择并插入 `fullName`（如 `n1.count`）。
3. 画布上 Condition 节点显示两个输出端口，分别明确标识为 `true` 和 `false`。
4. `expression` 为必填：保存时前端校验表达式 trim 后非空；后端 API 对缺失或 trim 后为空的表达式拒绝并返回 400（2026-07-17 用户决策，取代原"仅拒绝空字符串"）。
5. 本 story 不承诺运行时前的表达式语法校验；表达式写错仍在运行时按 error/fatal 处理。

### 测试要求

- 类型：E2E + API 单元测试
- 路径：`tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/e2e/conditionConfig.test.cjs`、`tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/api/conditionConfig.test.js`

---

## REQ-FLOW-020：Claude Agent 节点统一 adapter 调用与输出变量

**优先级**：P0  
**必须性**：必须  
**scope**：cross-module  
**modules**：flowService、claudeAgentAdapter、前端 Flow Editor  
**interface_contract**：节点 `config` 包含 `provider`、`model`、`outputVariable`、`prompt`、`retries`、`onError`；prompt 支持 `{{fullName}}` 变量插入；adapter 返回 `{ status, output, error, logs }`。  
**capability**：flow-orchestration  
**entity**：flow  
**UX 参照**：Flow Editor 节点属性面板

### 验收标准

1. Claude Agent 节点配置面板提供统一 prompt 文本框，支持多行文本输入。
2. prompt 文本框支持变量选择器，可从上游节点已声明的变量中选择并插入 `{{fullName}}`。
3. 节点可配置 `provider`（初始支持 `anthropic`）、`model`、`outputVariable`、`retries`、`onError`。
4. 执行时 adapter 把统一输入映射到 Claude Agent SDK，返回的文本内容写入声明的 `outputVariable`。
5. adapter 不感知变量注册表，只接收已替换变量后的最终 prompt 文本。
6. 默认工作目录为 flow 所属项目的本地路径，由调用方传入 adapter。

### 测试要求

- 类型：E2E + API 单元测试 + adapter 集成测试（mock SDK）
- 路径：`tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/e2e/agentConfig.test.cjs`、`tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/api/agentConfig.test.js`、`tests/capabilities/flow-orchestration/flow-engine/2026-07-16-flow-refinement/api/claudeAgentAdapter.test.js`

---

## REQ-FLOW-021：节点级错误处理配置

**优先级**：P0  
**必须性**：必须  
**scope**：intra-module  
**modules**：前端 Flow Editor、flowService  
**interface_contract**：Trigger / Condition / Claude Agent 节点 `config` 均包含 `retries: number` 和 `onError: "fail" | "ignore"`。  
**capability**：flow-orchestration  
**entity**：flow  
**UX 参照**：Flow Editor 节点属性面板

### 验收标准

1. Trigger、Condition、Claude Agent 三个节点的配置面板均显示“重试次数”输入框和“失败时”下拉选择（`终止流程` / `忽略并继续`）。
2. `retries` 默认值为 1，可配置为 0 或正整数。
3. `onError` 默认值为 `fail`。
4. 保存后配置持久化到节点 `config` 中。

### 测试要求

- 类型：E2E
- 路径：`tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/e2e/nodeErrorHandling.test.cjs`

---

## REQ-FLOW-022：变量选择器按节点分组展示

**优先级**：P0  
**必须性**：必须  
**scope**：intra-module  
**modules**：前端 Flow Editor  
**interface_contract**：变量选择器接收上游节点列表及各自变量定义，按节点分组渲染，选中后插入 `fullName`。  
**capability**：flow-orchestration  
**entity**：flow  
**UX 参照**：Flow Editor 节点属性面板中的变量选择器

### 验收标准

1. 变量选择器下拉列表按上游节点分组显示，每组标题为节点名称或节点 ID。
2. 每个变量条目显示友好名称（变量名）和类型标签。
3. 选中变量后，输入框中自动插入 `fullName`（如 `n1.result` 或 `{{n1.result}}`，根据使用场景）。
4. 上游节点删除或重命名变量后，变量选择器列表实时刷新，不再显示已删除变量。

### 测试要求

- 类型：E2E + 组件测试
- 路径：`tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/e2e/variablePicker.test.cjs`

---

## REQ-FLOW-023：FlowEngine 变量注册表

**优先级**：P0  
**必须性**：必须  
**scope**：intra-module  
**modules**：FlowEngine  
**interface_contract**：`VariableRegistry := Map<nodeId, Map<variableName, { type, value }>>`；节点执行成功后按 `nodeId.variableName` 写入；下游节点可读取。  
**capability**：flow-orchestration  
**entity**：flow-engine

### 验收标准

1. FlowEngine 执行时维护 `VariableRegistry`，初始包含 Trigger 节点声明的变量及其默认值。
2. 每个节点执行成功后，如果声明了 `outputVariable`，则把 `result.output` 写入 `registry[nodeId][outputVariable]`。
3. 下游节点可通过 `fullName`（`nodeId.variableName`）读取上游变量值。
4. 同一节点内变量名不重复；不同节点可声明同名变量，通过 `nodeId` 区分。
5. 变量注册表不持久化到数据库，仅存在于单次执行内存中。

### 测试要求

- 类型：API 单元测试
- 路径：`tests/capabilities/flow-orchestration/flow-engine/2026-07-16-flow-refinement/api/variableRegistry.test.js`

---

## REQ-FLOW-024：FlowEngine 变量替换机制

**优先级**：P0  
**必须性**：必须  
**scope**：cross-module  
**modules**：FlowEngine、claudeAgentAdapter  
**interface_contract**：Claude Agent prompt 中的 `{{fullName}}` 在执行前替换为 registry 中的实际值；Condition 表达式直接使用 `fullName` 读取。  
**capability**：flow-orchestration  
**entity**：flow-engine

### 验收标准

1. FlowEngine 在执行 Claude Agent 节点前，把 prompt 中所有 `{{fullName}}` 替换为 registry 中对应变量的当前值。
2. 若 `fullName` 在 registry 中不存在，替换为空字符串。
3. Condition 表达式中的 `fullName` 直接作为 JavaScript 标识符求值；变量不存在时按 JS 语义处理为 `undefined`。
4. 替换后的 prompt 文本传递给 claudeAgentAdapter。

### 测试要求

- 类型：API 单元测试
- 路径：`tests/capabilities/flow-orchestration/flow-engine/2026-07-16-flow-refinement/api/variableSubstitution.test.js`

---

## REQ-FLOW-025：FlowEngine 节点错误处理执行

**优先级**：P0  
**必须性**：必须  
**scope**：intra-module  
**modules**：FlowEngine  
**interface_contract**：节点执行返回 `error` 时按 `retries` 重试；重试耗尽后按 `onError` 处理；`fatal` 直接终止。  
**capability**：flow-orchestration  
**entity**：flow-engine

### 验收标准

1. 节点执行返回 `status: "error"` 时，FlowEngine 按 `config.retries` 次数重试。
2. 重试耗尽后，若 `config.onError === "fail"`，则终止整个 flow 并返回错误。
3. 重试耗尽后，若 `config.onError === "ignore"`，则该节点视为执行成功，输出变量按 fallback 处理（默认空字符串），flow 继续执行下游。
4. 节点执行返回 `status: "fatal"` 时，直接终止 flow，不进入重试逻辑。
5. 错误处理对 Trigger、Condition、Claude Agent 三个节点均生效。

### 测试要求

- 类型：API 单元测试
- 路径：`tests/capabilities/flow-orchestration/flow-engine/2026-07-16-flow-refinement/api/errorHandling.test.js`

---

## REQ-FLOW-026：Claude Agent 悬空引用执行行为

**优先级**：P1  
**必须性**：应该  
**scope**：cross-module  
**modules**：FlowEngine、claudeAgentAdapter、前端 Flow Editor  
**interface_contract**：上游删除/重命名变量后，下游引用按空值处理；前端变量选择器实时刷新。  
**capability**：flow-orchestration  
**entity**：flow-engine

### 验收标准

1. 上游节点删除或重命名变量后，下游节点中引用该变量的表达式/prompt 在保存时不做强制阻断。
2. 执行时，若 `{{fullName}}` 在 registry 中不存在，替换为空字符串。
3. Condition 表达式中的 `fullName` 不存在时按 JavaScript 语义处理为 `undefined`。
4. 前端变量选择器实时刷新，删除后不再显示已删除变量。

### 测试要求

- 类型：API 单元测试 + E2E
- 路径：`tests/capabilities/flow-orchestration/flow-engine/2026-07-16-flow-refinement/api/danglingReference.test.js`、`tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/e2e/danglingReference.test.cjs`

---

## REQ-FLOW-027：Claude Agent 工作目录注入

**优先级**：P0  
**必须性**：必须  
**scope**：cross-module  
**modules**：FlowEngine、projectService、claudeAgentAdapter  
**interface_contract**：执行 Claude Agent 节点时，把 flow 所属项目的本地路径作为 `projectPath` 传入 adapter。  
**capability**：flow-orchestration  
**entity**：flow-engine

### 验收标准

1. FlowEngine 执行 Claude Agent 节点时，通过 projectService 获取 flow 所属项目的本地路径。
2. 项目本地路径作为 `projectPath` 参数传入 claudeAgentAdapter。
3. adapter 使用 `projectPath` 作为 Claude Agent SDK 调用时的工作目录。
4. 若项目路径不存在或不可读，adapter 返回 `status: "error"` 并附带错误信息。

### 测试要求

- 类型：API 单元测试 + adapter 集成测试
- 路径：`tests/capabilities/flow-orchestration/flow-engine/2026-07-16-flow-refinement/api/projectPathInjection.test.js`

---

## REQ-FLOW-028：执行日志持久化与自动清理

**优先级**：P0  
**必须性**：必须  
**scope**：cross-module  
**modules**：FlowEngine、taskService、executionService  
**interface_contract**：执行记录包含每个节点的输入变量、输出变量、分支选择、错误信息、重试次数、agent 调用详情；日志默认保留 7 天。  
**capability**：flow-orchestration  
**entity**：execution

### 验收标准

1. flow 每次执行生成执行记录，包含每个节点的 `nodeId`、`nodeName`、`inputVariables`、`outputVariables`、`branchTaken`、`error`、`attemptCount`。"每次执行"涵盖失败与**引擎安全中止**（maxIterations/maxDepth/节点或 executor 缺失）的执行（2026-07-17 用户决策）。
2. Claude Agent 节点的调用详情最小字段清单为：`prompt`（脱敏/截断，前 4000 字符）、`output`、`model`、`provider`、`status`、`error`、`durationMs`、`attemptCount`。`output` **总是捕获** agent 文本输出（无论是否声明 `outputVariable`），由 agent 调用详情携带（2026-07-17 用户决策）。
3. 日志写入 SQLite `executions` 表（或关联表），与现有执行历史兼容。
4. 日志默认保留 7 天，到期自动清理。
5. 清理逻辑在 tech-design 中明确实现方式（启动时清理 / 后台定时清理 / 每次执行后触发）。
6. 执行日志 API 返回的字段与现有前端 Executions 详情页兼容。

### 测试要求

- 类型：API 单元测试 + E2E
- 路径：`tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/api/executionLog.test.js`、`tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/e2e/executionLog.test.cjs`

---

## REFLECT 人工验收备注

以下项为纯审美/主观判断，不进入 REQ 正式验收标准，在 REFLECT 阶段人工验收：

- 变量选择器的分组样式、图标、颜色是否符合设计系统。
- Condition 节点 true/false 端口标签的视觉呈现。
- 节点配置面板的整体布局密度与交互手感。

## 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-07-17 | 初始结晶，基于 PRD 稳定块生成 REQ-FLOW-018~028 |
| v1.1 | 2026-07-17 | BUILD 阶段 S3 对齐检查用户决策：REQ-FLOW-018 AC2 变量名 trim 后非空；REQ-FLOW-019 AC4 表达式改为必填（缺失或 trim 后为空均拒绝）；provider/options 拒绝路径接受 tech-design 层承诺不补签核测试 |
| v1.2 | 2026-07-17 | BUILD 阶段 S4 对齐检查用户决策：REQ-FLOW-028 AC1 明确覆盖引擎安全中止的执行；AC2 明确 output 总是捕获（不经 outputVariable 声明）；成功路径节点记录写入失败改判 error 接受为 fail-visible（记 REFLECT） |
