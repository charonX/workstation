# 技术方案 — 嵌套子流程调用（Nested Subflow）

> 故事 ID：`2026-07-23-nested-flow`
> 版本：`v1`
> 最后更新：2026-07-23

---

## 设计目标

在不打破现有单层 DAG 执行模型、不引入异步队列语义的前提下，为 flow 引擎加上「同步子流程调用」能力：父 flow 可通过 callFlow 节点内联递归执行子 flow，子 flow 在隔离 context 中运行、结果经显式入/出参映射回父，执行记录以 parentExecutionId 形成父子调用链。

## 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| `src/flowEngine/flowEngine.js` | 核心执行循环改造：接受 startNodeId、透传 services/currentDepth 给 executor、flowinput 进 TRIGGER_LIKE 集、executor 入参加 services/depth | 否（改造） |
| `src/flowEngine/executors/flowInputExecutor.js` | flowInput 节点执行器（pass-through，复用 triggerExecutor 逻辑，但单独导出以便未来扩展语义） | 是 |
| `src/flowEngine/executors/flowOutputExecutor.js` | flowOutput 节点执行器（pass-through，把 config.outputVariables 声明的变量写进 context，供 invokeSubflow 事后收集） | 是 |
| `src/flowEngine/executors/callFlowExecutor.js` | callFlow 节点执行器：校验入参映射格式 → 调 services.invokeSubflow → 拿到出参后按 outputMappings 写父 context | 是 |
| `src/flowEngine/executors/setVariablesExecutor.js` | setVariables 节点执行器：按配置赋值/重命名变量，把表达式求值结果写入指定变量名（做入口归一化、常量注入、中间值命名） | 是 |
| `src/flowEngine/executors/index.js` | 导出新 executor，注册到 defaultExecutors | 否（改造） |
| `src/services/flowService.js` | 1. 节点类型白名单加 flowinput/flowoutput/callflow/setvariables；2. 新保存校验：子 flow 存在性 / flowInput 存在 / 映射完整性 / 循环引用 DFS / 深度 ≤8；3. listCallFlowCandidates() 返回同项目内含 flowInput 节点的 flow；4. getFlowInputNodes(flowId) 返回指定 flow 的 flowInput 节点列表供 UI 选入口；5. setVariables 节点 assignments 字段校验 | 否（改造） |
| `src/services/taskService.js` | 1. 构造 services.invokeSubflow 注入 engine；2. 实现 invokeSubflow：插子 execution 行 → 加载子 flow 当前定义 → 递归 run(startNodeId, depth+1, services) → 跑完扫 nodeRecords 找 flowOutput → 更新子 execution → 返回出参；3. executeTask 给顶层 run 传 services + depth=0 | 否（改造） |
| `src/db.js` | migrations：executions 表加 `parentExecutionId TEXT NULL`、`parentNodeId TEXT NULL`、`depth INTEGER NOT NULL DEFAULT 0`；新增 `idx_executions_parent` 索引 | 否（改造） |
| `src/services/debugService.js`（或 debugFlow 现有实现） | 调试路径同样注入 services.invokeSubflow（draft 模式），保持和生产路径行为一致 | 否（改造） |
| `src/renderer/components/flow/NodePalette.jsx` | 节点面板加 flowInput（Trigger 分类）/ flowOutput（新分类"Flow"或 Output）/ callFlow（Logic 或新分类） | 否（改造） |
| `src/renderer/components/flow/NodeConfigPanel.jsx` | 加 FlowInputFields / FlowOutputFields / CallFlowFields / SetVariablesFields 配置子组件；callFlow 配置含子 flow 下拉、入口下拉、入参映射表、出参只读展示；setVariables 配置含变量赋值表（变量名 + 表达式） | 否（改造） |
| `src/renderer/components/flow/upstreamVariables.js` | callFlow 节点的出参（从 outputMappings 推导出的 `${nodeId}.{var}`）作为上游变量暴露给下游节点引用 | 否（改造） |
| `src/renderer/components/flow/validateFlowNodes.js` | 客户端校验镜像：单节点配置校验；循环/深度校验只在服务端做（客户端不持有全量 flow 图） | 否（改造） |
| Execution detail UI（新组件或现有组件扩展） | 父执行详情里 callFlow 节点可展开，查询 childExecutionId 对应的 execution + execution_nodes 嵌套展示 | 否（改造） |

### 模块关系图

```
[画布 UI]
   │ save / validate
   ▼
[flowService.validateNodeList + validateSubflowCalls]
   │                    ▲
   │ loadFlow / list    │ saveFlow
   ▼                    │
[SQLite flows 表]       │
                        │
[飞书/Schedule/Manual 触发]
   │ createTask
   ▼
[taskService.executeTask]
   │ 构造 services.invokeSubflow ─────────────────┐
   │ run(flow, {services, depth:0}, vars)         │
   ▼                                              │
[flowEngine.run 循环]                             │
   │ executor({node, context, services, depth})   │
   ▼                                              │
[callFlowExecutor]                                │
   │ services.invokeSubflow({                     │
   │     flowId, entryNodeId,                     │
   │     inputVars, parentExecId, parentNodeId,   │
   │     depth: parentDepth+1 })                  │
   ▼                                              │
[services.invokeSubflow 实现]  ◄──────────────────┘
   │ INSERT executions(parentExecutionId=父id, depth=父d+1)
   │ load subflow (nodeList/edges 当前版本)
   │ run(subflow, {startNodeId, services, depth}, inputVars)
   │     └ 子 flow 内其他 callFlow → 递归 invokeSubflow
   │ 扫子 nodeRecords 找 type=flowoutput 节点
   │ UPDATE executions + INSERT execution_nodes
   ▼
返回 { output: {childVar: value, ...}, childExecutionId }
```

## 数据流

### 场景 1：保存带 callFlow 节点的 flow（保存时校验）

1. **触发**：用户在画布点保存，前端 PATCH /api/flows/:id
2. **输入校验**：
   - `validateNodeList(nodeList)`：原有单节点校验加 flowinput/flowoutput/callflow 三类型的字段校验（targetFlowId 必填、inputMappings childVar 格式、parentExpr 是单 {{var}} 引用）
   - `validateSubflowCalls(flow, projectId)`：对每个 callFlow 节点：
     a. 按 targetFlowId 加载子 flow，不存在 → E-FLOW-REF-MISSING
     b. 子 flow 无 flowinput 节点 → E-FLOW-NO-INPUT
     c. targetInputNodeId 不存在或不是 flowinput → E-CALLFLOW-INPUT
     d. 遍历子 flow 的 targetInputNodeId 节点 config.outputVariables，每个 var 必须有对应 inputMapping 或 defaultValue → E-CALLFLOW-MAP-MISSING / E-CALLFLOW-MAP
     e. **从当前 flow 做 DFS**：沿 callFlow.targetFlowId 链路递归加载，访问过的 flowId 入 visited 集合；若回到已访问 flowId → E-FLOW-CIRCULAR（报告链路）；若累计调用深度 >8 → E-FLOW-MAX-DEPTH
3. **持久化**：校验通过 → UPDATE flows SET nodeList, edges
4. **输出**：HTTP 200 或 400 + details 数组

### 场景 2：父 flow 运行时调用子 flow

1. **触发**：executeTask 拿到顶层 execution，构建 services 对象
2. **顶层 run**：
   - services.invokeSubflow 是绑定了 `{ projectId, parentExecutionId: 顶层execId }` 的闭包
   - 调 `run({flow}, { services, startNodeId: null, currentDepth: 0 }, variablesForRun)`
3. **遇到 callFlow 节点**：
   - callFlowExecutor 解析每个 inputMapping.parentExpr（正则 `/^\{\{\s*([\w.]+)\s*\}\}$/` 抓出 fullName）从父 context 读原值 → 拼 inputVars = `{ childVar: 父context[fullName] }`
   - 调 `await services.invokeSubflow({ targetFlowId, entryNodeId: targetInputNodeId, inputVars, parentNodeId: callFlowNodeId, parentDepth: currentDepth })`
4. **invokeSubflow 实现**（taskService 内）：
   a. 深度检查：parentDepth+1 > 8 → throw E-FLOW-MAX-DEPTH（运行时兜底，正常保存时已拦住）
   b. 生成 childExecutionId（crypto.randomUUID）
   c. startedAt = timestamp()
   d. INSERT executions(id, projectId, flowId, trigger="subflow", status="running", startedAt, parentExecutionId, parentNodeId, depth=parentDepth+1, variables=JSON.stringify(inputVars))
   e. 加载子 flow 当前定义（getFlow(targetFlowId) 拿 nodeList/edges，即 draft）
   f. try {
        const childResult = await run(
          { flow: {nodeList, edges}, project },
          { services, startNodeId: entryNodeId, currentDepth: parentDepth+1, maxDepth: 100, maxIterations: 1000, executors },
          inputVars
        )
        // 子 flow 成功结束
        const exitNode = childResult.nodeRecords
          .filter(r => { const n = nodeById.get(r.nodeId); return n?.type?.toLowerCase() === 'flowoutput' })
          .pop()
        if (!exitNode) {
          // E-SUBFLOW-NO-OUTPUT
          completeExecutionError(childExecutionId, duration)
          throw new Error("E-SUBFLOW-NO-OUTPUT: ...")
        }
        // 按 callFlow 配置的 outputMappings 裁剪（outputMappings 是 {childVar, parentKey}[]，
        // 其中 parentKey = `${callFlowNodeId}.${childVar}`）
        // exitNode.outputVariables 里 key 形式为 `${flowOutputNodeId}.${childVar}`
        // 先剥离前缀拿到 childVar 集合
        const childOutputs = {}
        const flowOutputNode = nodeById.get(exitNode.nodeId)
        for (const varDef of flowOutputNode.config.outputVariables) {
          const fqKey = `${exitNode.nodeId}.${varDef.name}`
          childOutputs[varDef.name] = exitNode.outputVariables[fqKey]
        }
        insertExecutionNodes(childExecutionId, childResult.nodeRecords)
        completeExecution(childExecutionId, { status:"success", duration, nodesRun: childResult.nodesRun, output: childOutputs, ... })
        return { status:"success", output: childOutputs, childExecutionId, logs: childResult.logs }
      } catch (err) {
        completeExecutionError(childExecutionId, duration)
        insertExecutionNodes(childExecutionId, err.nodeRecords ?? [])
        // 错误冒泡给 callFlowExecutor → 父 failRun
        throw err
      }
5. **回到 callFlowExecutor**：
   - 收到 { output: childOutputs, childExecutionId }
   - 按 outputMappings 写父 context：`context[parentKey] = childOutputs[childVar]`（同时写 legacy 裸 key？不——outputMappings 是显式的，父 context 里的 key 是 `${callFlowNodeId}.{childVar}` 这种 fullName，保持和其他节点一致即可；legacy 裸 key 也写一份 childVar → childOutputs[childVar]，保持上游变量读取兼容）
   - return { status:"success", output: childOutputs, logs:[{message: `callFlow: invoked subflow ${targetFlowId} (execution ${childExecutionId})`}] }
6. **父 flow 继续**：后续节点通过 `${callFlowNodeId}.savedUrl` 等引用子 flow 返回值

### 场景 3：子 flow 从指定 flowInput 入口启动

- engine.run() 接受 options.startNodeId：
  - 若 startNodeId 非空 → currentNodeId = startNodeId（跳过入度为 0 节点的寻找）
  - 否则保持现有逻辑（incomingCount=0 的第一个节点）
- 子 flow 的 inputVars 作为 inputVariables 传给 run()，engine 现有 applyTriggerVariableOverrides 逻辑会：
  - 遍历 TRIGGER_LIKE_NODE_TYPES（此时已含 flowinput）
  - **关键**：现有 applyTriggerVariableOverrides 会对**所有** trigger-like 节点的 varDef 查找 inputVariables[varDef.name]。子 flow 里可能有多个 flowInput + 一个 feishuMessage，按名字匹配的话 inputVars.key 可能误匹配到其他入口的同名变量。
  - **解决方案**：applyTriggerVariableOverrides 仅对"启动入口节点"做 override（即当 startNodeId 指向的节点是 flowinput 时，只有该 flowInput 节点的 varDef 被 inputVars 覆盖；其他 trigger-like 节点仅用 defaultValue 播种）。这是引擎要改的点之一——run() 需知道"入口是哪个节点"。

### 场景 4：执行详情嵌套展示

- GET /api/executions/:id 返回的 execution 对象保持现有字段
- callFlow 节点在 execution_nodes 表里是一行（nodeId 是 callFlow 节点 ID），其 outputVariables 里会有一个特殊字段 `__childExecutionId`（callFlowExecutor 写入，供 UI 识别可展开）
- UI 点展开 → GET /api/executions/:childExecutionId → 正常返回子 execution + 其 nodes；子 execution 里若还有 callFlow → 递归展开
- 新增 API 不必要：现有 GET /api/executions/:id 已能按 ID 查任意 execution，前端按 parentExecutionId 串起调用链即可；可选新增 GET /api/executions?parentExecutionId=:id 批量列子执行（前端展开时一次性加载）

## 接口契约

### 接口 1：flowEngine.run() 签名扩展

| 项目 | 说明 |
|---|---|
| 调用方 | taskService.executeTask、debugFlow、单元测试 |
| 被调用方 | flowEngine.run |
| 输入 | `run(flowOrConfig, options, inputVariables)` — options 新增 `startNodeId?: string`、`currentDepth?: number`、`services?: { invokeSubflow?: Function, ...其他未来服务 }` |
| 输出 | 原有 `{status, output, branch, iterations, nodesRun, logs, nodeRecords}` 不变 |
| 业务错误 | 子 flow 失败、深度超限等通过 throw Error + `.nodeRecords` 冒泡（现有 failRun/abortRun 机制） |
| 系统错误 | services 缺失、子 flow 加载失败等 throw Error |
| 副作用 | 无（引擎本身不写 DB，所有持久化由 services 回调承担） |
| 幂等性 | 是（同样输入同样输出；副作用隔离在 services 里） |

### 接口 2：services.invokeSubflow

| 项目 | 说明 |
|---|---|
| 调用方 | callFlowExecutor |
| 被调用方 | taskService 注入的实现（测试可 mock） |
| 输入 | `{ targetFlowId: string, entryNodeId: string, inputVars: Record<string, unknown>, parentNodeId: string, parentDepth: number }` |
| 输出 | Promise<`{ status: "success", output: Record<string, unknown>, childExecutionId: string, logs: Array }`> |
| 业务错误 | E-SUBFLOW-NO-OUTPUT（子 flow 没到出口）、E-SUBFLOW-FAILED（子 flow 节点失败）、E-FLOW-MAX-DEPTH（深度超）、E-FLOW-REF-MISSING（运行时子 flow 被删） — 都以 throw Error 形式返回，Error.message 含错误码，Error.nodeRecords 含已累积节点记录 |
| 系统错误 | DB 错误、flow 加载失败 throw Error |
| 副作用 | 写 executions + execution_nodes 表（子 execution 的完整生命周期） |
| 幂等性 | 否（每次调用创建新 executionId） |

### 接口 3：executor 签名扩展

| 项目 | 说明 |
|---|---|
| 调用方 | flowEngine.run 主循环 |
| 被调用方 | 所有 executor |
| 输入 | `{ node, context, project, projectPath, iteration, services, currentDepth }` — 新增 services / currentDepth；现有 executor 忽略即可，向后兼容 |
| 输出 | 原有 `{status, output, error, logs, agent, outputVariables}` 不变 |
| 业务错误 | 通过 status:"error"/"fatal" 返回 |
| 系统错误 | throw 或 status:"fatal" |

### 接口 4：flowService.validateSubflowCalls

| 项目 | 说明 |
|---|---|
| 调用方 | createFlow / updateFlow / importFlow |
| 被调用方 | flowService |
| 输入 | `(flow, projectId)` |
| 输出 | 无返回值；校验失败 throw Error，`err.details` 是 `[{code, message, nodeId?}]` 数组 |
| 业务错误 | E-FLOW-CIRCULAR / E-FLOW-REF-MISSING / E-FLOW-NO-INPUT / E-FLOW-MAX-DEPTH / E-CALLFLOW-* |
| 副作用 | 无 |

### 接口 5：HTTP API 增量

| 接口 | 方法 | 用途 |
|---|---|---|
| `/api/flows/:id/callflow-candidates` | GET | 返回同项目内可作为子 flow 的 flow 列表（含 flowInput 节点的），供 callFlow 配置面板下拉用；返回 `[{id, name, inputNodes: [{id, name, variables: [{name, type, defaultValue}]}]}]` |
| `/api/executions?parentExecutionId=:id` | GET | 列某父 execution 的直接子 execution（可选；UI 也可一个个查） |

注：`callflow-candidates` 是为了避免前端加载所有 flow 再自己过滤；也可以直接用现有 GET /api/flows 列表前端过滤，后端接口成本低所以加上。

## 测试 seams

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 三新节点类型字段校验 | flowService.validateNodeList | 单元 | 真实 |
| 循环/深度/映射校验 | flowService.validateSubflowCalls | 单元 | 真实（用内存 DB 构造 flow fixture） |
| 可选列表过滤 | flowService.listCallFlowCandidates / GET /api/flows/:id/callflow-candidates | 单元 + API | 真实 |
| 同步调用执行 | flowEngine.run 直接构造父/子 flow fixture + stub services.invokeSubflow（同步返回） | 单元 | invokeSubflow stub |
| 多入口（startNodeId）| flowEngine.run({startNodeId}) fixture | 单元 | 无依赖 |
| 变量隔离 | flowEngine.run 父子 fixture，断言父 context 不含子内部变量 | 单元 | 无 |
| 入参映射（单 {{var}} 引用、保留类型）| flowEngine.run fixture + stub invokeSubflow，断言传给 invokeSubflow 的 inputVars 类型 | 单元 | invokeSubflow stub |
| 子失败中止父 | flowEngine.run fixture + invokeSubflow stub throw | 单元 | invokeSubflow stub |
| 子未到出口失败 | invokeSubflow 真实实现 + 子 flow fixture 无 flowOutput | 集成 | 内存 DB |
| 多层嵌套执行 | taskService.executeTask 跑 3 层嵌套 flow，查询 executions 表断言 parentExecutionId 链/depth 正确/节点记录完整 | 集成（API/CLI 层）| 内存 DB + 真实 services |
| 运行时调最新（改子 flow 后执行）| executeTask 两次：先建父调子，更新子 flow，再跑父，断言看到新行为 | 集成 | 内存 DB |
| foreach 内 callFlow | flowEngine.run fixture（foreach body 含 callFlow），断言 invokeSubflow 被调 N 次 | 单元 | invokeSubflow stub |
| setVariables 赋值/重命名/常量 | flowEngine.run fixture（含 setVariables 节点，从不同入口启动），断言 context 中变量被正确归一化 | 单元 | 无 |
| 执行记录 parentExecutionId | taskService 嵌套跑 → 查 execution_nodes 父 callFlow 节点有 __childExecutionId 字段；GET /api/executions/:childId 返回带 parentExecutionId 的记录 | 集成 | 内存 DB |
| 画布配置 + 保存校验 + 触发 | E2E Playwright：建子 flow（加 flowInput/flowOutput）→ 建父 flow（加 callFlow 映射）→ 保存（含故意配错看错误提示）→ 发布 → 手动触发 → 看执行详情展开子 flow | E2E | 真实 Electron app |

CLI 优先：上述大部分行为可以通过 `opc-workstation flow validate`（如果有）或 `opc-workstation flow run` CLI 覆盖；当前主要 seam 是 `flowEngine.run` 单元 + HTTP API 集成 + Playwright E2E。CLI 层若已有 `flow run <id>` 命令可直接复用，不需要新增 CLI 命令专门测嵌套。

## 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| **D1：executor 通过 options.services 拿服务回调** | A options.services 注入 / B 引擎内建 callFlow 回调 / C context._xxx shim | 保持引擎对节点类型无感知，符合现有 executor 插件模式；服务显式可 mock | 所有 executor 入参多两个它们不需要的字段（向后兼容，可忽略） |
| **D2：子 flow 执行内联递归，不经过任务队列** | 内联 invokeSubflow / 走 createTask 异步队列 / 引擎暂停-恢复 | 同步语义要求父阻塞等结果；内联成本最低；独立 execution 行通过显式 INSERT 保证可观测性 | 长耗时子 flow 阻塞父的执行线程（但 agent 节点本身就是长耗时，现状如此）；递归深度由 8 层上限保护 |
| **D3：子 flow 永远读当前版本（nodeList/edges，draft）** | 跟随父 published / 永远 draft / 节点可配置 | 符合"调最新、自动生效"本意；和现有飞书/manual 触发跑当前版本一致；简单 | 子 flow 未发布改动直接影响已发布父 flow 的生产行为——用户明确接受此风险 |
| **D4：子 flow 生命周期由 invokeSubflow 一站式承担** | executor 内全做 / 引擎内建 / 冒泡回 taskService | 和 D1 一致：引擎无感知，逻辑封装 services 里 | invokeSubflow 职责较重（DB+执行+持久化），需要清晰拆分 |
| **D5：flowOutput 是普通 executor，出口值事后从 nodeRecords 扫描** | 扫 nodeRecords / 特殊 status:"exit" / run 返回 terminalNode | 引擎零侵入；DAG 里 flowOutput 是叶子，跑一个即结束，"最后一个 flowOutput"语义无歧义 | nodeRecords 扫描是 O(n)，n 是节点数，可接受 |
| **D6：入参映射 parentExpr 一期只支持单 {{var}} 引用，原值保留类型** | 单引用 / 模板字符串 / JS 表达式 / 混合 | 80% 场景就是传一个上游变量；UI 做下拉体验好；保留类型对 object/number 重要；未来可增量扩 | 拼接/转换逻辑要在子 flow 内部 agent 节点做（合理分层） |
| **D7：循环/深度检测保存时单 DFS 起点** | 单 flow 为根 DFS / 全量调用图 | 环在闭合时必被抓到；性能好；和现有单 flow 校验一致 | 若子 flow 被删，环可能被破坏但不报错（合理：目标 flow 不存在由 E-FLOW-REF-MISSING 覆盖） |
| **D8：子 flow 执行产生独立 executions 行，带 parentExecutionId/parentNodeId/depth** | 独立行+parentId / 节点混在父 nodeRecords | 数据模型清晰；UI 展开查子表即可；清理逻辑共用 purgeExpiredExecutions | executions 表多一类行；查询子 execution 是额外一跳 |
| **D9：applyTriggerVariableOverrides 仅对启动入口节点做 override** | 全 trigger-like 节点按 varDef.name 匹配 / 仅入口节点 | 多入口共存时，inputVars 不应污染子 flow 其他 trigger/flowInput 节点的变量；用户选定入口就是契约 | 引擎需要知道 startNodeId 对应的节点是"本次入口" |
| **D10：引擎支持 executor 返回多输出 result.outputVariables** | 引擎消费 result.outputVariables map / executor 手动 mutate context | 现有 feishuSendExecutor 已经返回 outputVariables 但引擎未消费（死代码）；flowOutput 和 callFlow 都需要一次写多个变量；统一机制避免各 executor 自己 mutate context 破坏 record 跟踪；所有节点统一写 fullName + bare key（和现有单变量行为一致），callFlow 不特判 | 所有 executor 现在可选择性返回多值；单值 output/outputVariable 行为保持不变（向后兼容）；feishuSend 的 outputVariables 死代码顺势活过来 |
| **D11：多入口变量归一化用通用 setVariables 节点，不在 flowInput 内置映射** | A flowInput 内置 outputMapping / B 通用 setVariables 节点 / C 约定命名 | 方案 B 更通用：不仅解决"多入口变量名异构"，还能做常量注入、中间值重命名、简单表达式计算；每个入口后连一个 setVariables 做归一化，职责单一；和现有 code 节点比更轻量（无 JS 沙箱），表达式复用引擎现有 evaluateExpression（{{var}} 引用 + 简单字符串拼接）；未来如果要支持更复杂转换再升级 code 节点即可 | 多了一个节点类型，用户需要多拖一步配置；但语义清晰、适用场景更广，避免给 flowInput 加额外职责 |

## 引擎多输出机制（D10 细节）

引擎主循环在处理完单变量 `result.output` + `config.outputVariable` 写入后（flowEngine.js:151-161），新增一段处理多输出：

```
if (result.outputVariables && isPlainObject(result.outputVariables)) {
  for (const [varName, value] of Object.entries(result.outputVariables)) {
    const fullName = `${node.id}.${varName}`;
    context[fullName] = value;
    context[varName] = value;   // legacy 裸 key（和现有单变量行为一致）
    record.outputVariables[fullName] = value;
  }
}
```

**flowOutputExecutor 行为**：flowOutput 是"声明出口节点"，它自己不产生值，而是从子 flow 的 context 里把出口声明的变量名对应的值收集起来返回：
1. 遍历自己 config.outputVariables 的每个 varDef.name
2. 从当前 context 读 `context[varDef.name]`（bare key）作为返回值——这要求上游 agent/节点把结果写到与 flowOutput 声明同名的 key 上（即上游节点 config.outputVariable === varDef.name）
3. 返回 `{status:"success", outputVariables: { [varName]: context[varName] }}`，引擎统一写入 context/record

这样 invokeSubflow 事后扫 nodeRecords 找 flowOutput 节点，其 record.outputVariables 就是完整的子 flow 返回值集合。

**flowInputExecutor 行为**：pass-through，直接复用 triggerExecutor 逻辑（返回 `{status:"success", output:{...context}}`）。它的 outputVariables 声明走 TRIGGER_LIKE seeding/override 路径（D9 限定仅启动入口被 override）。

**callFlowExecutor 行为**：调用 services.invokeSubflow 拿到 `{output: childOutputs, childExecutionId}`，返回：
```
{
  status: "success",
  output: childOutputs,                       // for lastOutput
  outputVariables: {
    ...childOutputs,                          // savedUrl, title, ... 引擎会写 ${nodeId}.savedUrl 和裸 savedUrl
    __childExecutionId: childExecutionId      // 供 UI 识别可展开（前缀 __ 避免与用户变量冲突）
  },
  logs: [{ message: `callFlow: invoked ${targetFlowId} (${childExecutionId})` }]
}
```
引擎 D10 通用路径自动把子出参写入父 context，后续节点通过 `${callFlowNodeId}.savedUrl` 或 `savedUrl` 引用（推荐 fullName）。invokeSubflow 读 record.outputVariables 用的也是通用路径，不需要特殊逻辑。

**setVariablesExecutor 行为**（D11）：通用变量赋值/重命名节点，用来在入口后做归一化、或在流程中注入常量/命名中间值。
1. 节点配置 `config.assignments`：数组，每项形如 `{ variableName, expression }`
2. 执行时遍历 assignments：对每条 expression 调用引擎现有 `evaluateExpression(expression, context)` 求值（复用现有 {{var}} 引用、字符串拼接逻辑），得到 value
3. 返回 `{status:"success", outputVariables: { [variableName]: value }}`——通过 D10 多输出机制写入 `${nodeId}.${variableName}` 和裸 `${variableName}` 到 context/record
4. 典型用法（多入口归一化）：
   - feishuMessage 入口 → setVariables 配 `{text: "{{feishuMsg.text}}", messageId: "{{feishuMsg.messageId}}"}`
   - flowInput 入口 → setVariables 配 `{text: "{{flowInput.messageText}}", messageId: "{{flowInput.messageId}}"}`
   - 下游 agent 统一引用 `{{text}}` / `{{messageId}}`，不关心从哪个入口进来
5. 也可用于常量注入：`{apiVersion: "v2"}`、中间结果重命名、提取嵌套字段：`{url: "{{response.data.url}}"}`

**D1-D4、D11 满足 ADR 三条件（难逆转、不说明令人困惑、有真实取舍），写入 ADR-008。**

## 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| 现有单指针 DAG 引擎加 startNodeId + services 透传改造成本可控 | 引擎控制流（chooseNextNode / depth / 循环）耦合太紧，栈式递归引出大量边界 bug | TECH-DESIGN（改方案为子 flow 走异步任务队列） | 能——先做 spike：改造 run 接受 startNodeId，跑通现有测试套件 |
| invokeSubflow 内联递归不会导致栈溢出或上下文混乱 | 8 层深度 + 每层节点数有限，JS 调用栈足够；但若子 flow 内 foreach 调多层子 flow 可能爆栈 | TECH-DESIGN | 能——8 层 × 每层一个 invokeSubflow 递归 ≈ 8 层 run() 嵌套，JS 栈完全够用 |
| 扫 nodeRecords 找 flowOutput 能准确识别出口 | flowOutput 节点 executor 漏写 outputVariables，或子 flow 异常终止绕过 flowOutput | 不回流——E-SUBFLOW-NO-OUTPUT 兜底 | 能——单元测试覆盖 |
| applyTriggerVariableOverrides 改为"只对入口节点 override"不破坏现有 trigger/feishumessage 行为 | 顶层执行（无 startNodeId）时，现有逻辑应保持：顶层 trigger/feishumessage 都按 name 匹配 inputVars | TECH-DESIGN | 能——跑现有 REQ-FLOW-031 测试套件验证 |
| "调最新（draft）"语义在 schedule 触发父 flow 时不意外 | 父走 published 快照、子走当前版本，发布时快照固化了 targetFlowId 但子 flow 改动立即生效；用户后续反馈需要版本锁定 | PRD（加版本绑定为移动块） | 不能——需要真实使用反馈 |
| 子 flow 独立 execution 行 + 客户端展开查询性能足够 | 大量嵌套场景下，UI 一次查 N 个子 execution 变慢 | TECH-DESIGN（改成后端返回嵌套 tree） | 能——8 层上限 + 每层通常一个 callFlow，查询量可预测 |
| 现有 testAgentExecutor 注入机制不受影响 | executors 合入逻辑是 `{...defaultExecutors, ...flowOrConfig.executors, ...options.executors}`，加 services 字段不冲突 | 不回流 | 能——跑现有 agent mocking 测试 |

## 范围外与约束

- 异步派发 / 扇出广播（上层路由/广播节点能力，本期不做）
- 错误分支 / try-catch（callFlow 失败父即中止，后续迭代）
- 变量类型系统（type 字段保留但不校验）
- 版本绑定 / 快照（永远调最新）
- 子 flow 节流 / 并发控制
- 跨项目调用子 flow
- 父 context 透传（严格隔离）
- flowOutput 出口名路由（父不按出口分支）
- **执行记录 migration 对老数据的处理**：新增 parentExecutionId/parentNodeId/depth 字段 NULL/DEFAULT 0，老 execution 行天然是顶层（depth=0），无需回填
- **channelReply 不跨 flow 透传**：父 context.channelReply 是飞书回复通道，是"当前触发"的元信息；子 flow 要发飞书必须通过显式入参映射把 channelReply 传进去（因为子 flow 在隔离 context 起跑）。这符合"显式映射"契约，反过来说这也是用户必须做的——如果飞书壳 flow 调子 flow 后子 flow 里有 feishuSend 想直接回复，就得把 channelReply 映射进来。一期文档说明即可，不做自动透传。
- **callFlow 节点在 schedule 快照中的行为**：schedule 触发时引擎使用父 flow 的 publishedNodeList，其中 callFlow 节点的 targetFlowId 是快照固化的；但 invokeSubflow 加载子 flow 时读当前版本——这意味着用户发布父 flow 后，子 flow 改动仍生效，和 D3 一致。
- **orphaned subflow 引用（已知限制）**：子 flow 被编辑（删 flowInput 节点、改 flowInput 的 varName、被删除）时不反向扫描引用方；保存父 flow 时会立即报错，运行时也有 E-FLOW-NO-INPUT / E-CALLFLOW-MAP-MISSING / E-FLOW-REF-MISSING 兜底。不做反向引用校验是有意为之（避免每次改 flow 都扫全库），后续如果用户反馈再做。
- **maxDepth 语义澄清**：现有 `options.maxDepth`（默认 100）是"边遍历次数上限"，用于防 while/foreach 死循环；它和"子 flow 嵌套深度 8 层"是两个独立计数器。每个 run() 调用内部的边遍历计数独立（子 run 从 0 开始），嵌套层数由 invokeSubflow 的 parentDepth+1 > 8 检查（与现有 maxDepth 正交）。
- **CONTEXT.md 同步**：新增 `trigger="subflow"` 枚举值（含义：被父 flow 通过 callFlow 节点调用启动），/domain-model 或 /crystallize 阶段更新 CONTEXT.md "触发来源"行。

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.2 | 2026-07-26 | req-gap 补全：新增 setVariables 节点设计（D11），解决多入口变量归一化问题 | AI + 人 |
| v0.1 | 2026-07-23 | 初稿 | AI + 人 |
