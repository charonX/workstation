# 契约式需求 — 嵌套子流程调用（Nested Subflow）

> 故事 ID：`2026-07-23-nested-flow`
> 版本：v1
> 最后更新：2026-07-23

---

## REQ 概览

| ID | 标题 | 优先级 | 必须性 | scope | 测试类型 | capability | entity |
|---|---|---|---|---|---|---|---|
| REQ-FLOW-032 | flowInput 节点类型 | P0 | 必须 | intra-module | 单元 | flow-orchestration | flow |
| REQ-FLOW-033 | flowOutput 节点类型 | P0 | 必须 | intra-module | 单元 | flow-orchestration | flow |
| REQ-FLOW-034 | callFlow 节点配置与字段校验 | P0 | 必须 | cross-module | 单元+集成 | flow-orchestration | flow |
| REQ-FLOW-035 | callFlow 同步执行与变量隔离 | P0 | 必须 | cross-module | 单元+集成 | flow-orchestration | flow-engine |
| REQ-FLOW-036 | 多入口子流程：startNodeId 与入口限定 override | P0 | 必须 | intra-module | 单元 | flow-orchestration | flow-engine |
| REQ-FLOW-037 | 子流程失败/未达出口向父传播 | P0 | 必须 | cross-module | 单元+集成 | flow-orchestration | flow-engine |
| REQ-FLOW-038 | 保存时循环引用与嵌套深度校验 | P0 | 必须 | cross-module | 单元 | flow-orchestration | flow |
| REQ-FLOW-039 | 运行时加载子流程最新版本 | P0 | 必须 | intra-module | 集成 | flow-orchestration | flow-engine |
| REQ-FLOW-040 | 嵌套执行记录：parentExecutionId/parentNodeId/depth | P0 | 必须 | cross-module | 集成 | flow-orchestration | execution |
| REQ-FLOW-041 | callFlow 候选子流程列表 API | P1 | 应该 | intra-module | 单元+API | flow-orchestration | flow |
| REQ-FLOW-042 | 引擎 executor 签名扩展与多输出支持 | P0 | 必须 | intra-module | 单元 | flow-orchestration | flow-engine |
| REQ-FLOW-043 | 节点面板与配置面板 UI | P1 | 应该 | cross-module | 组件+E2E | flow-orchestration | flow |
| REQ-FLOW-044 | 执行详情嵌套展开 UI | P1 | 应该 | cross-module | E2E | flow-orchestration | execution |
| REQ-FLOW-045 | 从 callFlow 节点跳转到子流程画布 | P2 | 可以 | intra-module | E2E | flow-orchestration | flow |
| REQ-FLOW-046 | foreach 内 callFlow 批量调用 | P1 | 应该 | intra-module | 单元 | flow-orchestration | flow-engine |
| REQ-FLOW-047 | setVariables 节点：变量赋值/重命名/归一化 | P0 | 必须 | intra-module | 单元+组件 | flow-orchestration | flow |

---

## REQ-FLOW-032：flowInput 节点类型

**稳定块**：#1（三新节点类型）、#3（多入口共存）

- **优先级**：P0
- **必须性**：必须
- **scope**：intra-module（flowService 校验 + flowEngine TRIGGER_LIKE 集）
- **capability/entity**：flow-orchestration / flow
- **modules**：flowService、flowEngine、NodePalette、NodeConfigPanel

### 验收标准

1. **AC1（节点注册）**：`flowInput`（引擎小写 `flowinput`）加入引擎 `defaultExecutors` 注册、`TRIGGER_LIKE_NODE_TYPES` 集合、flowService `VALIDATED_NODE_TYPES` 白名单；保存含 `type:"flowInput"` 节点的流程时不被拒绝。
2. **AC2（字段校验）**：节点配置 `config.outputVariables` 必须是数组；每项 `name` 非空字符串、同节点内唯一、符合 `/^[a-zA-Z][a-zA-Z0-9_]*$/`；违规时保存失败并返回 `details[]` 含路径 `nodes[i].config.outputVariables[j].name` 和错误码 `E-VAR-NAME`。
3. **AC3（执行语义）**：执行到 flowInput 节点时按 trigger-like 语义 pass-through，节点的 outputVariables 通过 seedTriggerVariables 播种 defaultValue，通过 applyTriggerVariableOverrides 接收父流程传入的 inputVars 覆盖（覆盖范围受 REQ-FLOW-036 限制）。
4. **AC4（单流程内多 flowInput）**：同一流程可有多个 flowInput 节点（代表多个被调用入口），引擎不拒绝；节点之间按 DAG 边自然不可达（从任一个 flowInput 启动时其他 flowInput 不会被执行）。

### 测试

- Seam: `flowService.validateNodeList` 单元测试传含 flowInput 节点的 nodeList
- Seam: `flowEngine.run()` 单元测试从 flowInput 入口启动，断言 outputVariables 被正确注入 context
- 文件：`tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/subflowNodeTypes.test.js`

---

## REQ-FLOW-033：flowOutput 节点类型

**稳定块**：#1（三新节点类型）

- **优先级**：P0
- **必须性**：必须
- **scope**：intra-module（flowService + 新增 executor）
- **capability/entity**：flow-orchestration / flow
- **modules**：flowService、flowOutputExecutor、NodePalette、NodeConfigPanel

### 验收标准

1. **AC1（节点注册）**：`flowOutput`（引擎小写 `flowoutput`）加入 defaultExecutors、VALIDATED_NODE_TYPES；保存不被拒绝。
2. **AC2（字段校验）**：`config.outputVariables` 数组的 `name` 规则同 REQ-FLOW-032 AC2；违规返回 `E-VAR-NAME`。
3. **AC3（执行语义）**：flowOutput 节点执行时：
   - 遍历自身 config.outputVariables，从当前 context 读同名 bare key 作为返回值
   - 返回 `{status:"success", outputVariables: { [varName]: context[varName] }}`（依赖 REQ-FLOW-042 的多输出支持）
   - 引擎自动把每个输出写入 `${nodeId}.${varName}` 和裸 `${varName}` 到 context 和 nodeRecord.outputVariables
4. **AC4（叶子语义）**：flowOutput 节点无出边时执行完流程终止（与其他叶子节点一致）；有出边时按普通节点继续（允许编排者把 flowOutput 放在中间——但 invokeSubflow 仍然取"最后一个 flowOutput"作为出口，见 REQ-FLOW-035）。
5. **AC5（多 flowOutput）**：同一流程可有多个 flowOutput 节点（不同分支出口）；流程结束时 invokeSubflow 取 nodeRecords 中最后一个 type=flowoutput 的记录作为返回值来源。

### 测试

- Seam: validateNodeList 单元 + flowEngine.run() 单元（构造含 flowOutput 的流程，断言 outputVariables 被写入 record）
- 文件：同 REQ-FLOW-032

---

## REQ-FLOW-034：callFlow 节点配置与字段校验

**稳定块**：#1（三新节点类型）、#4（显式入参/出参映射）

- **优先级**：P0
- **必须性**：必须
- **scope**：cross-module（flowService 校验 + callFlowExecutor 解析）
- **capability/entity**：flow-orchestration / flow
- **modules**：flowService、callFlowExecutor、NodeConfigPanel

### 验收标准

1. **AC1（节点注册）**：`callFlow`（引擎小写 `callflow`）加入 defaultExecutors、VALIDATED_NODE_TYPES。
2. **AC2（必填字段）**：
   - `config.targetFlowId`（字符串）：必填，否则保存失败 `E-CALLFLOW-TARGET`
   - `config.targetInputNodeId`（字符串）：必填，指向子流程内 flowInput 节点 id，否则 `E-CALLFLOW-INPUT`
   - `config.inputMappings`（数组）：每项形如 `{childVar, parentExpr}`，否则 `E-CALLFLOW-MAP`
   - `config.retries`：非负整数（沿用通用校验）
3. **AC3（parentExpr 格式）**：每条 inputMapping.parentExpr 必须匹配 `/^\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}$/`（单变量引用），不匹配时保存失败 `E-CALLFLOW-MAP`。
4. **AC4（出参映射自动生成）**：callFlow 节点保存时 outputMappings 由后端根据目标子流程所有 flowOutput 节点声明的 outputVariables 并集自动生成（parentKey = `${callFlowNodeId}.${childVar}`），用户不可改；返回给前端时包含完整映射表供只读展示。
5. **AC5（映射完整性）**：目标 flowInput 节点声明的每个 outputVariable 必须被 inputMappings 覆盖 或 该变量有 defaultValue；缺失时保存失败 `E-CALLFLOW-MAP-MISSING`，details 包含具体 var 名。

### 接口契约（flowService 校验）

- 输入：`(flow, projectId)`
- 输出：void；失败 throw Error，`err.details = [{code, message, nodeId?, path?}]`
- 副作用：无

### 测试

- Seam: validateNodeList 单元覆盖 AC2/AC3；validateSubflowCalls 单元覆盖 AC5（需内存 DB fixture）
- 文件：`tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/api/callFlowValidation.test.js`

---

## REQ-FLOW-035：callFlow 同步执行与变量隔离

**稳定块**：#2（同步）、#4（隔离+映射）

- **优先级**：P0
- **必须性**：必须
- **scope**：cross-module（callFlowExecutor + services.invokeSubflow）
- **capability/entity**：flow-orchestration / flow-engine
- **modules**：callFlowExecutor、taskService（invokeSubflow 实现）、flowEngine

### 验收标准

1. **AC1（同步阻塞）**：父流程执行到 callFlow 节点时阻塞等待子流程完成；callFlowExecutor 返回后父流程后续节点才能看到子流程返回值；不经过任务队列。
2. **AC2（隔离 context）**：子流程在全新空 context 起跑；父流程 context 中除 inputMappings 映射的变量外，其他变量（包括父流程节点写入的 fullName/bare key、_channelManager 等 services shim）**不**对子流程可见；子流程内部节点写入的变量**不**回写到父 context（outputMappings 声明的除外）。
3. **AC3（入参映射求值）**：对每条 inputMapping：
   - 解析 parentExpr 抓出 fullName（单变量引用）
   - 从父 context 读原值（保留类型：string/number/object/array 原样传递）
   - 按 childVar 名注入子流程 inputVars（子流程的 applyTriggerVariableOverrides 按 REQ-FLOW-036 规则覆盖到目标入口 flowInput 节点）
4. **AC4（出参写回）**：invokeSubflow 返回 `childOutputs`（子流程最后一个 flowOutput 节点的 outputVariables 集合）后，callFlowExecutor 通过 D10 多输出机制返回 `{status:"success", outputVariables: childOutputs, __childExecutionId}`，引擎自动把每个 childVar 写成 `${callFlowNodeId}.${childVar}` 和裸 `${childVar}` 到父 context；父下游节点通过 `{{callFlowNodeId.savedUrl}}` 引用。
4. **AC5（__childExecutionId 特殊字段）**：callFlowExecutor 的 outputVariables 包含 `__childExecutionId`（字符串 UUID），供执行详情 UI 识别可展开；该字段以 `${callFlowNodeId}.__childExecutionId` 写入父 context 和 nodeRecord.outputVariables，但不泄漏为裸 `__childExecutionId`（引擎对 `__` 前缀不写 bare key——实现上 callFlowExecutor 自行只写 namespaced key，不依赖引擎特判）。
5. **AC6（子流程出口识别）**：invokeSubflow 在子流程 run() 返回后扫描 `childResult.nodeRecords`，取最后一个 `node.type?.toLowerCase()==='flowoutput'` 的记录；其 record.outputVariables 的 fullName key（`${outNodeId}.${varName}`）剥离前缀后得到 childOutputs。如果没有 flowOutput 记录，按 REQ-FLOW-037 AC2 处理。
6. **AC7（services 注入）**：engine run() options 接受 `services` 对象，executor 入参包含 `services`、`currentDepth`；测试可传 stub `{invokeSubflow: async () => ({...})}` 不依赖 DB。

### 测试

- Seam: flowEngine.run() 单元 + 手写 invokeSubflow stub
- 断言：父 context 不含子内部节点写入的变量；入参保留类型（传 object 子能读到 object）；出参按映射回到父 `${nodeId}.var`
- 文件：`tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/subflowIsolation.test.js`

---

## REQ-FLOW-036：多入口子流程：startNodeId 与入口限定 override

**稳定块**：#3（多入口共存）

- **优先级**：P0
- **必须性**：必须
- **scope**：intra-module（flowEngine.run() 新增 startNodeId + applyTriggerVariableOverrides 改造）
- **capability/entity**：flow-orchestration / flow-engine
- **modules**：flowEngine

### 验收标准

1. **AC1（startNodeId 选项）**：engine `run(flowOrConfig, options, inputVariables)` 接受 `options.startNodeId?: string`：
   - 为 null/undefined：保持现有行为（找 incomingCount=0 的首节点）
   - 为字符串：currentNodeId = startNodeId，跳过入度为 0 节点寻找；如果 startNodeId 不存在于 nodeList 则 throw `Node ... not found`
2. **AC2（入口限定 override）**：当 options.startNodeId 指向的节点类型是 `flowinput`（大小写不敏感）时，`applyTriggerVariableOverrides` 只对**该入口节点**的 outputVariables 做 override；子流程内其他 trigger-like 节点（feishumessage、其他 flowinput、trigger）仅播种 defaultValue，不从 inputVars 覆盖。
3. **AC3（顶层向后兼容）**：顶层 executeTask 调用 run() 不传 startNodeId 时，applyTriggerVariableOverrides 行为不变——遍历所有 trigger-like 节点按 name 匹配 inputVars（现有 REQ-FLOW-031 测试必须仍然通过）。
4. **AC4（自然不可达）**：子流程从 flowInput 入口启动后，其他 trigger/flowInput 节点因在 DAG 中无入边路径可达，不会执行；不需要显式"跳过"逻辑。

### 接口契约（flowEngine.run）

- 输入：options.startNodeId?: string
- 输出：无变化；startNodeId 无效时 throw Error

### 测试

- Seam: flowEngine.run() 单元
- 断言 AC2：子流程含 feishumessage(text/sender) + flowInput X(messageText/messageId) + flowInput Y(topic)；从 X 启动、inputVars={messageText:"hi"}：
  - X 的 messageText 被覆盖为 "hi"
  - feishumessage 的 text/sender 保留默认值（不被 inputVars 覆盖，即使 inputVars 里有 sender 同名 key）
  - Y 的 topic 保留默认值
- 断言 AC3：现有 REQ-FLOW-031 triggerVariables 测试全绿
- 文件：同 REQ-FLOW-035 `subflowIsolation.test.js`

---

## REQ-FLOW-037：子流程失败/未达出口向父传播

**稳定块**：#5（失败中止父）

- **优先级**：P0
- **必须性**：必须
- **scope**：cross-module（invokeSubflow 错误冒泡 + callFlowExecutor 错误返回）
- **capability/entity**：flow-orchestration / flow-engine
- **modules**：taskService、callFlowExecutor、flowEngine

### 验收标准

1. **AC1（子节点失败）**：子流程内节点执行失败（onError=fail 默认，重试耗尽）→ engine failRun 抛出 Error（含 .nodeRecords）→ invokeSubflow catch 后：
   - 更新子 execution 为 status=error
   - 持久化 err.nodeRecords 到子 execution_nodes
   - rethrow Error → callFlowExecutor 收到异常 → 返回 `{status:"error", error: "E-SUBFLOW-FAILED: ..."}` → 父流程按现有 onError=fail 规则中止父流程
2. **AC2（未达出口）**：子流程 run() 正常结束（无下一节点）但 nodeRecords 中**没有**任何 flowOutput 节点记录 → invokeSubflow:
   - 更新子 execution 为 status=error
   - 持久化子 nodeRecords
   - throw Error("E-SUBFLOW-NO-OUTPUT: ...")
   - callFlowExecutor 返回 error → 父流程中止
3. **AC3（运行时子流程被删）**：invokeSubflow 加载 targetFlowId 返回 null/undefined → throw Error("E-FLOW-REF-MISSING: ...") → 父流程中止。
4. **AC4（嵌套深度运行时兜底）**：invokeSubflow 检查 parentDepth+1 > 8 → throw Error("E-FLOW-MAX-DEPTH: ...") → 父中止（保存时静态检测已拦截，此为竞态兜底）。
5. **AC5（错误日志）**：父流程 callFlow 节点 nodeRecord.error 含子错误消息；子 execution 的 logs 表含完整子流程失败原因；父子均可见可追溯。
6. **AC6（无 try/catch 分支）**：callFlow 节点 onError 固定为 `fail`；validateNodeList 拒绝 `onError:"ignore"`；不在本期提供错误分支路由。
7. **AC7（副作用不回滚）**：子流程失败时，已产生的副作用（外发飞书消息、文件产物）不回滚，与其他节点失败语义一致。

### 测试

- Seam: flowEngine.run() 单元（stub invokeSubflow throw / 返回无 flowOutput 的 nodeRecords）
- Seam: taskService 集成测试（内存 DB，构造子流程内 agent 强制失败）
- 断言：父流程 status=error，父 nodeRecords 最后一项是 callFlow 节点且 error 非空；子 execution 记录存在且 status=error
- 文件：`tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/subflowFailure.test.js`

---

## REQ-FLOW-038：保存时循环引用与嵌套深度校验

**稳定块**：#6（8 层上限 + 静态检测）

- **优先级**：P0
- **必须性**：必须
- **scope**：cross-module（flowService.validateSubflowCalls）
- **capability/entity**：flow-orchestration / flow
- **modules**：flowService

### 验收标准

1. **AC1（DFS 检测循环）**：保存含 callFlow 节点的流程时，flowService.validateSubflowCalls 以当前保存的 flow 为起点，沿 callFlow.targetFlowId 指针 DFS 加载相关流程：
   - visited 集合记录已访问 flowId
   - 遇到已访问 flowId → 保存失败，错误码 `E-FLOW-CIRCULAR`，details 含人类可读链路（如 `A → B → A`）
2. **AC2（深度上限静态检查）**：DFS 过程中累计调用深度（从当前 flow 为 0 开始），如果路径深度 > 8 → 保存失败 `E-FLOW-MAX-DEPTH`。
3. **AC3（入口不影响环检测）**：环检测只看 targetFlowId，不看 targetInputNodeId（子流程所有内部 callFlow 都计入图）。
4. **AC4（已存在流程不回溯）**：validateSubflowCalls 只校验"以当前 flow 为根可达的子图"；不扫描反向引用（被别人调的流程）。这保证环在其"闭合边"保存时必被抓到。
5. **AC5（错误定位）**：错误 details 包含触发违规的 callFlow 节点 id/name，UI 可定位到画布节点。

### 测试

- Seam: flowService.validateSubflowCalls 单元（内存 DB 构造多流程互调 fixture）
- 用例：A→B→A 拒保存；A→B→C→A 拒保存；A→B→C→D 深度=3 通过；A→(...8层...)→I 深度=8 通过；A→(...9层...)→J 拒保存
- 文件：`tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/api/circularReference.test.js`

---

## REQ-FLOW-039：运行时加载子流程最新版本

**稳定块**：#7（调最新）

- **优先级**：P0
- **必须性**：必须
- **scope**：intra-module（invokeSubflow 加载逻辑）
- **capability/entity**：flow-orchestration / flow-engine
- **modules**：taskService

### 验收标准

1. **AC1（读当前版本）**：invokeSubflow 加载 targetFlowId 时读 `flows.nodeList` / `flows.edges`（当前定义，即 draft），**不**读 publishedNodeList/publishedEdges。
2. **AC2（schedule 父流程场景）**：即使父流程是被 schedule 触发（父用 publishedNodeList 快照），其中的 callFlow 节点运行时仍加载子流程当前版本；子流程在父发布后改动立即生效，无需重新发布父。
3. **AC3（调试场景）**：debugFlow 路径同样走 services.invokeSubflow（draft 版本），父子均用当前编辑版。
4. **AC4（软删除检查）**：子流程 deletedAt 非空视为不存在，按 REQ-FLOW-037 AC3 处理。

### 测试

- Seam: taskService.executeTask 集成测试
- 用例：1) 保存父调 B、执行 → 看到 v1 结果；2) 更新 B 节点、不重新发布父；3) 再执行父 → 断言看到 v2 结果
- 文件：`tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/subflowLatestVersion.test.js`

---

## REQ-FLOW-040：嵌套执行记录：parentExecutionId/parentNodeId/depth

**稳定块**：#8（嵌套执行记录）

- **优先级**：P0
- **必须性**：必须
- **scope**：cross-module（db.js migration + taskService invokeSubflow + 查询 API）
- **capability/entity**：flow-orchestration / execution
- **modules**：db、taskService、HTTP API

### 验收标准

1. **AC1（Schema migration）**：`executions` 表新增列：
   - `parentExecutionId TEXT NULL`
   - `parentNodeId TEXT NULL`
   - `depth INTEGER NOT NULL DEFAULT 0`
   - 索引 `idx_executions_parentExecutionId` on `parentExecutionId`
   - 老数据 depth 默认 0、parentExecutionId NULL，无需回填，启动时自动 migration 不报错
2. **AC2（子 execution 插入）**：invokeSubflow 在执行前 INSERT executions 行：
   - trigger = `"subflow"`（CONTEXT.md 触发来源新增枚举值）
   - parentExecutionId = 父 execution id
   - parentNodeId = 父 callFlow 节点 id
   - depth = parentDepth + 1
   - status = "running"
3. **AC3（子 execution 完成）**：子流程成功 → 更新子行 status=success/duration/output/nodesRun；失败 → status=error，持久化 nodeRecords 到 execution_nodes。
4. **AC4（子 execution_nodes 独立）**：子流程的每个节点记录写在**子 execution_id** 下的 execution_nodes 表，不混入父 execution_nodes（父 callFlow 节点在父 execution_nodes 中只是一行记录，含 __childExecutionId）。
5. **AC5（查询 API）**：现有 `GET /api/executions/:id` 返回 execution 对象时包含 parentExecutionId/parentNodeId/depth 字段；新增 `GET /api/executions?parentExecutionId=:id` 返回直接子 execution 列表（按 startedAt ASC）。
6. **AC6（清理级联）**：purgeExpiredExecutions 删除父 execution 时级联删除其所有后代 execution（通过 parentExecutionId 递归）和相关 logs/execution_nodes。

### 测试

- Seam: taskService.executeTask 集成 + HTTP API
- 断言：3 层嵌套执行后查询 executions 表，每条子行 parentExecutionId 指向父、depth 递增；GET /api/executions?parentExecutionId=父ID 返回子列表
- 文件：`tests/capabilities/flow-orchestration/execution/2026-07-23-nested-flow/api/nestedExecution.test.js`

---

## REQ-FLOW-041：callFlow 候选子流程列表 API

**稳定块**：#9（可选列表过滤）

- **优先级**：P1
- **必须性**：应该
- **scope**：intra-module（flowService 查询函数 + HTTP API）
- **capability/entity**：flow-orchestration / flow
- **modules**：flowService、HTTP routes

### 验收标准

1. **AC1（新接口）**：`GET /api/flows/:id/callflow-candidates`（id 是当前编辑的父流程 id，用于排除自身防止自调）：
   - 返回同 projectId 下、未软删除、**含至少一个 flowInput 节点**的流程列表
   - 每项：`{id, name, inputNodes: [{id, name, variables: [{name, type, defaultValue}]}]}`
   - inputNodes 是该流程所有 flowInput 节点（用户在 callFlow 配置面板选子流程后，再选入口）
2. **AC2（排除自身）**：返回结果不含 :id 自身（避免流程调用自己——环检测会在保存时拦截，但 UI 层面提前减少困惑）。
3. **AC3（空结果）**：项目内无含 flowInput 节点的流程时返回 `[]`，HTTP 200。

### 测试

- Seam: HTTP API 测试（内存 DB fixture）
- 文件：`tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/api/callflowCandidates.test.js`

---

## REQ-FLOW-042：引擎 executor 签名扩展与多输出支持

**稳定块**：支撑性基础设施（服务注入 + flowOutput/callFlow 多值返回）

- **优先级**：P0
- **必须性**：必须
- **scope**：intra-module（flowEngine.js 主循环）
- **capability/entity**：flow-orchestration / flow-engine
- **modules**：flowEngine

### 验收标准

1. **AC1（executor 入参扩展）**：executor 被调用时收到 `{node, context, project, projectPath, iteration, services, currentDepth}`；现有 executor 不读这两个字段也不报错（向后兼容）。
2. **AC2（services 透传）**：options.services 非空时传给所有 executor；为空时 services={} 不报错。
3. **AC3（多输出写入 context）**：executor 返回 `result.outputVariables` 是 plain object 时，引擎遍历其 entries 写入 `${nodeId}.${varName}` 和裸 `${varName}` 到 context，并同步写入 record.outputVariables（record.outputVariables 是现有字段，扩展为可容纳多值）。
4. **AC4（单输出行为不变）**：现有 result.output + config.outputVariable 单变量写入逻辑不变；多输出和单输出可共存（同一 executor 返回两者时按各自规则写）。
5. **AC5（feishuSend 顺势受益）**：现有 feishuSendExecutor 返回的 `outputVariables: {sent, msgType, content}`（当前是死代码）经 AC3 后正确写入 context 和 record；不破坏现有测试。
6. **AC6（currentDepth 透传）**：options.currentDepth 透传给 executor；顶层默认为 0；invokeSubflow 递归 run() 时传 currentDepth: parentDepth+1。

### 测试

- Seam: flowEngine.run() 单元
- 用例：mock executor 返回 `{status:"success", outputVariables:{a:1,b:"x"}}`，断言 context[`${nid}.a`]===1、record.outputVariables[`${nid}.a`]===1
- 文件：`tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/executorSignature.test.js`

---

## REQ-FLOW-043：节点面板与配置面板 UI

**稳定块**：#1（三新节点类型）、UX 配置交互

- **优先级**：P1
- **必须性**：应该
- **scope**：cross-module（renderer 组件）
- **capability/entity**：flow-orchestration / flow
- **modules**：NodePalette、NodeConfigPanel、validateFlowNodes（客户端镜像校验）

### 验收标准

1. **AC1（NodePalette）**：面板新增三个节点：
   - flowInput（Trigger 分类，和 feishuMessage/trigger 并列）
   - flowOutput（新增分类"Flow"或 Output 分类）
   - callFlow（Logic 分类或 Flow 分类）
   拖到画布即创建对应 type 的节点。
2. **AC2（FlowInputFields 配置）**：点 flowInput 节点，配置面板显示 outputVariables 编辑器（同 trigger 节点），可添加/删除/重命名变量。
3. **AC3（FlowOutputFields 配置）**：点 flowOutput 节点，配置面板显示 outputVariables 编辑器（同 flowInput）。
4. **AC4（CallFlowFields 配置）**：点 callFlow 节点，配置面板：
   - 子流程下拉：加载 `/api/flows/:currentId/callflow-candidates`，显示 name；选子流程后入口下拉展示该子流程 inputNodes；只有一个 inputNode 时自动选中
   - 入参映射表：每行 = 子入参名（只读，从选定入口的 variables 读）+ 父变量下拉（读 upstreamVariables 当前节点可用的上游变量，插入 `{{fullName}}`）
   - 出参只读展示：列出子所有 flowOutput 变量 → `${callFlowNodeId}.${childVar}`（不可编辑）
5. **AC5（客户端校验）**：validateFlowNodes 镜像：flowInput/flowOutput 的 outputVariables name 规则；callFlow 的 targetFlowId/targetInputNodeId 必填；循环/深度校验**不**做（纯服务端）。
6. **AC6（i18n）**：所有新 UI 文案走 i18n（现有机制），支持中/英。

### UX 自动验证检查

- [x] 元素存在性：Palette 节点、配置子组件（组件测试覆盖）
- [x] 交互状态：选子流程 → 入口下拉刷新；选入口 → 入参表刷新（组件测试覆盖）
- [x] API 调用时机：打开 CallFlowFields 时调 candidates API；选子流程时拉 inputNodes（组件测试覆盖）
- [x] 导航：节点拖放→画布（Playwright E2E 覆盖）

### 测试

- Seam: 组件测试（React Testing Library）覆盖 AC1-AC5；E2E Playwright 覆盖拖拽+保存+发布
- 文件：`tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/e2e/subflowConfig.spec.js`、`.../components/`（组件测试）

---

## REQ-FLOW-044：执行详情嵌套展开 UI

**稳定块**：#8（嵌套执行记录 UX）

- **优先级**：P1
- **必须性**：应该
- **scope**：cross-module（renderer 执行详情组件 + API）
- **capability/entity**：flow-orchestration / execution
- **modules**：ExecutionDetail 组件、/api/executions?parentExecutionId=

### 验收标准

1. **AC1（可展开指示）**：执行详情页节点列表中，nodeRecord.outputVariables 含 `__childExecutionId` 的 callFlow 节点显示展开箭头/图标。
2. **AC2（展开加载子节点）**：点击展开 → 调 `GET /api/executions?parentExecutionId=:childExecutionId`（或 GET /api/executions/:childExecutionId/nodes）→ 在该 callFlow 节点下方缩进展示子流程节点树（含状态、输入/输出、错误）。
3. **AC3（递归展开）**：子流程内的 callFlow 节点同样可展开（支持 8 层递归），每层缩进。
4. **AC4（失败状态可见）**：子 execution status=error 时父 callFlow 节点显示错误状态，展开能看到子失败节点及错误消息。
5. **AC5（展开态独立）**：多个 callFlow 节点展开态互不影响；刷新页面不保留展开态（一期不做 URL 状态同步）。

### UX 自动验证检查

- [x] 元素存在性：展开箭头（组件测试）
- [x] 交互状态：点击展开 → 子节点渲染；点击收起 → 卸载（Playwright E2E）
- [x] API 调用：点击展开时 fetch 子执行（Playwright 断言网络请求）

### 测试

- Seam: Playwright E2E（触发嵌套执行后打开详情，展开断言子节点可见）
- 文件：`tests/capabilities/flow-orchestration/execution/2026-07-23-nested-flow/e2e/nestedExecutionDetail.spec.js`

---

## REQ-FLOW-045：从 callFlow 节点跳转到子流程画布

**稳定块**：#10（画布跳转）

- **优先级**：P2
- **必须性**：可以
- **scope**：intra-module（renderer）
- **capability/entity**：flow-orchestration / flow
- **modules**：NodeConfigPanel/画布交互

### 验收标准

1. **AC1（跳转入口）**：CallFlowFields 配置面板中已选子流程旁边显示"打开子流程"链接/按钮。
2. **AC2（跳转行为）**：点击 → 路由切换到子流程的画布编辑器（`/flows/:subId` 或现有路由）；原父流程状态保留（浏览器后退可回到父）。

### 测试

- Seam: Playwright E2E
- 文件：同 REQ-FLOW-043 e2e

---

## REQ-FLOW-046：foreach 内 callFlow 批量调用

**稳定块**：#11（foreach 组合）

- **优先级**：P1
- **必须性**：应该
- **scope**：intra-module（引擎组合性）
- **capability/entity**：flow-orchestration / flow-engine
- **modules**：flowEngine（无需专门代码，验证组合性即可）

### 验收标准

1. **AC1（foreach body 含 callFlow）**：forEach 节点 body 分支连到 callFlow 节点时，forEach 每轮迭代独立调用 invokeSubflow（每轮 inputMappings 取迭代项的值），子流程串行执行。
2. **AC2（子 execution 记录）**：每次迭代产生独立子 execution 行（各自 childExecutionId），父 callFlow 的 nodeRecord.outputVariables 只保留最后一次迭代结果（和现有 forEach 语义一致：最后一次迭代值作为节点 output）。
3. **AC3（循环内失败）**：任意一次迭代子流程失败 → forEach 失败 → 父流程中止（和 forEach 现有失败语义一致）。

### 测试

- Seam: flowEngine.run() 单元（stub invokeSubflow 计数调用次数）
- 断言：forEach items=[1,2,3] body→callFlow，invokeSubflow 被调 3 次，每次 inputVars 取对应迭代项
- 文件：`tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/foreachCallflow.test.js`

---

## REQ-FLOW-047：setVariables 节点：变量赋值/重命名/归一化

**稳定块**：新增 #12（通用变量赋值节点，支撑多入口归一化）

- **优先级**：P0
- **必须性**：必须
- **scope**：intra-module（setVariablesExecutor + flowService 校验 + NodeConfigPanel UI）
- **capability/entity**：flow-orchestration / flow
- **modules**：setVariablesExecutor、flowService、NodePalette、NodeConfigPanel

### 验收标准

1. **AC1（节点注册）**：`setVariables`（引擎小写 `setvariables`）加入 defaultExecutors、VALIDATED_NODE_TYPES、NodePalette Logic 分类；保存含 type:"setVariables" 节点的流程时不被拒绝。
2. **AC2（字段校验）**：节点配置 `config.assignments` 必须是数组；每项：
   - `variableName`：非空字符串，同节点内唯一，符合 `/^[a-zA-Z][a-zA-Z0-9_]*$/`，违规返回 `E-VAR-NAME`
   - `expression`：非空字符串，支持现有 evaluateExpression 语法（`{{var}}` 单引用、`{{a}} {{b}}` 字符串拼接、字符串字面量），违规返回 `E-EXPR`
3. **AC3（执行语义：赋值）**：执行到 setVariables 节点时，遍历 assignments 对每条 expression 调用 evaluateExpression 求值，通过 D10 多输出机制返回 `outputVariables: { [variableName]: value }`，引擎自动写入 `${nodeId}.${variableName}` 和裸 `${variableName}` 到 context 和 nodeRecord.outputVariables。
4. **AC4（执行语义：保留类型）**：expression 是单 `{{var}}` 引用时，原值类型保留（string/number/object/array/boolean 原样传递），不做字符串化。
5. **AC5（典型场景：多入口归一化）**：子 flow 含 feishuMessage 入口（输出 `{{feishuMsg.text}}`）和 flowInput 入口（声明 `messageText`），每个入口后连一个 setVariables 节点分别配置：
   - feishuMessage 后：`{text: "{{feishuMsg.text}}", messageId: "{{feishuMsg.messageId}}"}`
   - flowInput 后：`{text: "{{flowInput.messageText}}", messageId: "{{flowInput.messageId}}"}`
   从任一入口启动后，下游节点统一引用裸 `{{text}}` / `{{messageId}}` 都能拿到正确值，两个入口路径下游行为一致。
6. **AC6（典型场景：常量/嵌套字段）**：assignments 支持常量（`{apiVersion: "v2"}`）和嵌套字段提取（`{url: "{{response.data.url}}"}`），求值结果正确写入 context。
7. **AC7（pass-through）**：setVariables 节点不中断流程，执行完正常按出边继续下一节点（普通 pass-through 节点语义）。
8. **AC8（UI 配置面板）**：点击 setVariables 节点，配置面板显示 assignments 编辑器：可添加/删除行，每行有变量名输入框 + 表达式输入框（表达式输入支持插入上游变量引用，同现有其他节点表达式输入）。

### 测试

- Seam: flowService.validateNodeList 单元覆盖 AC1/AC2 字段校验
- Seam: flowEngine.run() 单元覆盖 AC3/AC4/AC5/AC6/AC7：
  - 构造双入口 + 双 setVariables fixture，从两个入口分别启动，断言下游 `context.text` 值一致
  - 断言单变量引用类型保留（传 object 不被字符串化）
  - 断言常量/嵌套字段求值正确
- Seam: 组件测试覆盖 AC8 UI 交互
- 文件：`tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/setVariables.test.js`

---

## 跨 REQ 约束与系统级约束

- **术语同步**：CONTEXT.md "触发来源"枚举新增 `subflow`——"被父流程通过 callFlow 节点调用启动"。由实现阶段顺手更新。
- **channelReply 透传方式**：父 context.channelReply 不自动透传（隔离语义）。子流程要发飞书必须在 flowInput 声明 channelReply 入参、父 callFlow 显式映射 `{{channelReply}}` → 子 channelReply。文档 + 飞书壳 flow 示例说明。
- **orphaned 引用已知限制**：子流程删/改 flowInput 不反向扫描引用方，运行时/保存父时 E-FLOW-NO-INPUT/E-CALLFLOW-MAP-MISSING 兜底。

## 覆盖矩阵（稳定块 → REQ）

| 稳定块 | 覆盖的 REQ |
|---|---|
| #1 三新节点类型 | FLOW-032, FLOW-033, FLOW-034, FLOW-043 |
| #2 同步调用模型 | FLOW-035, FLOW-042 |
| #3 多入口共存 | FLOW-032, FLOW-036 |
| #4 显式映射+隔离 | FLOW-034, FLOW-035 |
| #5 失败中止 | FLOW-037 |
| #6 循环+深度检测 | FLOW-038 |
| #7 调最新 | FLOW-039 |
| #8 嵌套执行记录 | FLOW-040, FLOW-044 |
| #9 可选列表过滤 | FLOW-041 |
| #10 画布跳转 | FLOW-045 |
| #11 foreach 组合 | FLOW-046 |
| #12 通用变量赋值节点 setVariables | FLOW-047 |
| 支撑：executor 签名扩展 | FLOW-042 |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1.1 | 2026-07-26 | req-gap 补全：新增 REQ-FLOW-047 setVariables 通用变量赋值节点，解决多入口场景下变量名异构归一化问题 | AI + 人 |
| v1 | 2026-07-23 | 初版，15 REQ（FLOW-032 ~ FLOW-046） | AI + 人 |
