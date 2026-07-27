# 嵌套子流程调用（Nested Subflow）

> 状态：探索期
> 故事 ID：`2026-07-23-nested-flow`
> 最后更新：2026-07-23

---

## 1. 问题陈述

工作站的 flow 引擎当前只支持扁平的单层 DAG 编排。当用户搭建多条自动化生产线时，像「飞书消息接收 → 路由到不同业务处理 → 飞书消息回发」这样的通用脚手架逻辑必须在每个业务 flow 里重复配置——同样的 feishuMessage 触发节点、同样的 feishuSend 回复节点，散落在各个 flow 里。处理逻辑（链接速存、日报生成、问答等）也无法作为独立 flow 演化，只能在每个外层 flow 里复制一份。

用户无法把通用逻辑封装成可复用的"流程模块"，新业务接入成本高、改一处要改多处、各业务 flow 的飞书收发行为不一致。

## 2. 解决方案

提供「子流程同步调用」能力——flow 可以作为节点被另一个 flow 调用。用户可以：

- 在子 flow 里声明**入口节点**（`flowInput`）和**出口节点**（`flowOutput`），定义它的输入/输出契约
- 在父 flow 里用**调用节点**（`callFlow`）同步调用子 flow，显式映射入参和出参
- 子 flow 依然可以独立被飞书/定时/手动触发（多入口共存）

典型形态：一个飞书外层 flow 负责"收消息 → 按内容路由 → 回消息"，中间的处理委托给多个子 flow（链接速存 flow、日报 flow…），每个子 flow 自己也能被定时任务独立触发。

## 3. 用户故事

1. 作为流程编排用户，我想要在一个 flow 里调用另一个 flow，以便把飞书收发等通用脚手架抽成外层 flow、让业务 flow 专注处理逻辑。
2. 作为流程编排用户，我想要子 flow 能有多个入口（被父调用 / 被飞书触发 / 被定时触发），以便同一份业务逻辑既能响应飞书消息、也能定时运行、还能被其他 flow 复用。
3. 作为流程编排用户，我想要父 flow 能在执行详情里展开看子 flow 的执行过程，以便调试嵌套 flow 时能像调用栈一样看清每一步。
4. 作为流程编排用户，我想要在保存 flow 时系统就帮我检测循环调用，以便我不会配出 A→B→A 的死循环。
5. 作为流程编排用户，我想要只有声明了"可被调用"入口的 flow 才出现在调用节点的可选列表里，以便我不会误调到一个根本不能被调用的 flow。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | 新增三种节点类型：`flowInput`（入口声明）、`flowOutput`（出口声明）、`callFlow`（调用节点） | 访谈中明确为一等公民节点，与 trigger 语义不同 |
| 2 | 同步调用模型：父 flow 阻塞等子 flow 跑完，拿结果继续 | 用户明确选同步；飞书场景要等结果回发 |
| 3 | 子 flow 多入口共存：feishuMessage / scheduled / 多个 flowInput 可同时存在于一个 flow，启动时只跑指定入口 | 用户确认"允许多 trigger，触发指定入口就行" |
| 4 | 显式入参/出参映射 + 变量完全隔离 | 用户担心父直接注入变量不好管理；隔离 + 映射 = 可预测 |
| 5 | 子 flow 失败/未跑到出口 → 父 callFlow 节点失败 → 父 flow 中止（一期无 try/catch） | 用户选 (c)：先做失败中止，错误分支后续 |
| 6 | 多层嵌套支持，硬上限 8 层 + 保存时静态检测循环引用 | 用户选 (z)；8 层够用，静态检测比运行时爆栈体验好 |
| 7 | 版本语义：调用最新（运行时动态加载子 flow 定义），不做版本绑定 | 用户明确选"调最新" |
| 8 | 嵌套执行记录：父执行详情里 callFlow 可展开看子 flow 执行树（调用栈模型） | 用户选 (A)；数据模型加 parentExecutionId |
| 9 | 只有含 flowInput 节点的 flow 出现在 callFlow 可选列表 | 用户选 (y) |
| 10 | 点击 callFlow 节点可跳转到子 flow 画布 | UX 增值功能，低成本 |
| 11 | foreach 里可以放 callFlow 自然支持批量调用 | 引擎组合性自然支持，无需特殊处理 |
| 12 | 新增 `setVariables` 通用变量赋值节点（2026-07-27 tech-design v0.3） | 解决多入口场景下各 trigger/flowInput 输出变量名异构、下游无法统一引用的问题；统一使用 `config.outputVariables` 声明下游可见变量名，用 `config.expressions` 描述求值逻辑；支持变量重命名、常量注入、嵌套字段提取，每个入口后连一个做归一化 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| 1 | flowInput/flowOutput 节点在画布上的视觉样式 | 属于 /design 阶段，不影响引擎语义 |
| 2 | 入参/出参映射配置面板的具体交互 | 属于 /design 阶段 |
| 3 | 嵌套执行详情的展开交互细节 | 属于 /design 阶段 |
| 4 | 子 flow 被删除/修改后，父 flow 保存时的具体提示文案 | 小细节，TECH-DESIGN 时定 |

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

**场景 A：搭建一个可复用子 flow**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 新建 flow "链接速存" | 打开空画布 | — |
| 2 | 从节点面板拖入 `feishuMessage` 节点 | 画布出现 feishuMessage 节点，预置 text/sender/messageId 输出 | 节点面板 Trigger 分类下显示 feishuMessage |
| 3 | 从节点面板拖入 `flowInput` 节点（新类型） | 画布出现 flowInput 节点，用户可在配置面板声明入参变量名 | 节点面板新增分类/位置出现 flowInput；配置面板允许添加多个入参变量（名字字符串 key） |
| 4 | 配置 flowInput 入参：`messageText`、`messageId` | 变量声明保存到节点 config | flowInput 节点在画布上显示声明的入参 |
| 5 | 继续编排中间处理节点（agent 等） | 正常编排 | agent 节点可引用 `{{flowInputNodeId.messageText}}` 等 |
| 6 | 从节点面板拖入 `flowOutput` 节点 | 画布出现 flowOutput 节点，配置声明显式出参变量名 | — |
| 7 | 配置 flowOutput 出参：`savedUrl`、`title` | 变量声明保存 | — |
| 8 | 把处理节点的输出映射到 flowOutput 的出参，连边保存 | flow 保存成功 | flow 现在同时支持飞书触发（从 feishuMessage 入口启动）和被父 flow 调用（从 flowInput 入口启动） |

**场景 B：在父 flow 里调用子 flow（飞书壳 + 路由）**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 打开父 flow "飞书壳" | 画布加载 | — |
| 2 | 拖入 feishuMessage 节点 | — | — |
| 3 | 拖入 condition 节点（按消息是否链接分支） | — | — |
| 4 | 拖入 callFlow 节点 | 画布出现 callFlow 节点 | 节点面板出现 callFlow 类型 |
| 5 | 点击 callFlow 节点，配置面板选择子 flow | 下拉只列出含 flowInput 节点的 flow（含场景 A 的"链接速存"） | 下拉里看不到不含 flowInput 的 flow |
| 6 | 选择"链接速存" flow | 系统加载该 flow 的 flowInput 节点列表，用户选择入口 | 如果子 flow 只有一个 flowInput 则自动选中；多个则需选 |
| 7 | 映射入参：父 `{{feishuMessage.text}}` → 子 `messageText`；父 `{{feishuMessage.messageId}}` → 子 `messageId` | 映射表保存 | UI 提示子 flow 期望哪些入参名 |
| 8 | 映射出参：子 `savedUrl` → 父 `callFlowNodeId.savedUrl`；子 `title` → 父 `callFlowNodeId.title` | 出参映射保存 | 下游 agent/feishuSend 节点可引用 `{{callFlowNodeId.savedUrl}}` |
| 9 | 连边：condition 的 true 分支 → callFlow → feishuSend | — | — |
| 10 | 保存 flow | 保存成功；静态检测通过（无循环引用） | — |
| 11 | 发布 flow，从飞书发一条含链接的消息 | 外层 feishuMessage 触发 → condition 命中 → callFlow 同步调用"链接速存"子 flow → 子 flow 从 flowInput 入口启动（忽略它自己的 feishuMessage）、隔离 context 跑、flowOutput 返回 savedUrl/title → 父 feishuSend 收到结果回发 | 飞书收到含 savedUrl 的回复 |
| 12 | 打开父 flow 的执行详情 | 看到完整节点记录，callFlow 节点可展开 | 展开后看到"链接速存"子 flow 内部每个节点的输入/输出/日志 |

**场景 C：子 flow 独立被定时触发**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 给"链接速存" flow 配置定时任务 | — | — |
| 2 | 定时触发 | 子 flow 从 feishuMessage 旁边的 scheduled/trigger 入口启动（或独立 trigger 节点），正常运行 | 定时触发时 flowInput 节点被忽略，走独立 trigger 路径 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 保存时检测到 A→B→A 循环引用 | 保存失败，提示循环链路 | E-FLOW-CIRCULAR |
| 保存时 callFlow 引用的子 flow 不存在（被删） | 保存失败，提示"引用的子 flow 已删除" | E-FLOW-REF-MISSING |
| 保存时 callFlow 引用的子 flow 不含 flowInput 节点 | 保存失败，提示"该 flow 未声明可被调用的入口" | E-FLOW-NO-INPUT |
| 运行时子 flow 嵌套深度超过 8 层 | 父 flow 中止，callFlow 节点标记失败 | E-FLOW-MAX-DEPTH |
| 运行时子 flow 执行到结束但没走到任何 flowOutput 节点 | 父 flow 中止，callFlow 节点失败，提示"子 flow 未到达出口" | E-SUBFLOW-NO-OUTPUT |
| 运行时子 flow 内部节点失败（agent 报错等） | 子 flow 中止，父 callFlow 节点标记失败，父 flow 中止 | E-SUBFLOW-FAILED |
| 入参映射引用了父 flow 里不存在的变量 | 运行时该变量为空字符串/undefined（和现有未定义变量一致），不预校验 | —（符合现有 evaluateExpression 行为） |

## 7. 表单与输入验证（Form / Input Validation）

### 7.1 flowInput 节点配置

| 输入字段 | 规则 | 错误提示 | 错误状态 |
|---|---|---|---|
| 节点名 name | 非空，同 flow 内节点名唯一 | "节点名不能为空"/"节点名已存在" | E-NODE-NAME |
| 入参变量 outputVariables[].name | 非空字符串，同节点内唯一，符合标识符（字母开头，字母数字下划线） | "变量名不能为空"/"变量名重复"/"变量名只能包含字母数字下划线" | E-VAR-NAME |
| 入参变量 outputVariables[].type | 只读 string（一期不做类型校验，保留字段） | — | — |
| 入参变量 outputVariables[].defaultValue | 可选字符串 | — | — |

### 7.2 flowOutput 节点配置

| 输入字段 | 规则 | 错误提示 | 错误状态 |
|---|---|---|---|
| 节点名 name | 同 7.1 | 同 7.1 | E-NODE-NAME |
| 出参变量 outputVariables[].name | 同 7.1 | 同 7.1 | E-VAR-NAME |

### 7.3 callFlow 节点配置

| 输入字段 | 规则 | 错误提示 | 错误状态 |
|---|---|---|---|
| 节点名 name | 同 7.1 | 同 7.1 | E-NODE-NAME |
| 子 flow 引用 targetFlowId | 非空，必须是同项目内已存在 flow | "请选择子 flow" | E-CALLFLOW-TARGET |
| 入口节点 targetInputNodeId | 非空，必须是 targetFlowId 指向 flow 内的 flowInput 类型节点 | "请选择入口" | E-CALLFLOW-INPUT |
| 入参映射 inputMappings[] | 每条包含 `childVar`（子 flow 入参名）和 `parentExpr`（父 flow 变量表达式字符串，如 `{{feishuMessage.text}}`）；childVar 必须是子 flow 入口声明的入参名之一 | "变量 '{name}' 在子 flow 入口未声明" | E-CALLFLOW-MAP |
| 出参映射 outputMappings[] | 每条包含 `childVar`（子 flow 某 flowOutput 出口声明的出参名）和 `parentKey`（父命名空间 key）；一期 parentKey 自动为 `{callFlowNodeId}.{childVar}`，用户不可改（只读展示） | — | — |
| retries | 非负整数（和其他节点一致，失败重试次数） | — | E-NODE-RETRIES |
| onError | `fail`（固定，一期不支持 ignore） | — | — |

### 7.4 跨字段/业务规则

| 规则 | 触发时机 | 错误状态 |
|---|---|---|
| 子 flow 的 flowInput 节点声明的入参必须被 inputMappings 全部覆盖（或提供 defaultValue） | 保存父 flow 时 | E-CALLFLOW-MAP-MISSING |
| 调用图无环：构建 flow→targetFlowId 的图，DFS 检测环 | 保存任意含 callFlow 节点的 flow 时 | E-FLOW-CIRCULAR |
| 嵌套深度（调用图最长路径）不超过 8 | 保存时 | E-FLOW-MAX-DEPTH |
| 子 flow 必须存在且未被软删除 | 保存时 | E-FLOW-REF-MISSING |
| 子 flow 必须至少含一个 flowInput 节点 | 保存时 | E-FLOW-NO-INPUT |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| E-FLOW-CIRCULAR | 保存时检测到循环引用 | "检测到循环调用：{链路 A→B→A}，无法保存" | 保存按钮报错，定位到涉及的 callFlow 节点 | 不保存 |
| E-FLOW-REF-MISSING | callFlow 引用的子 flow 不存在 | "引用的子 flow '{name}' 不存在或已删除" | 保存失败，定位 callFlow 节点 | 不保存 |
| E-FLOW-NO-INPUT | 子 flow 无 flowInput 节点 | "flow '{name}' 未声明可被调用的入口（缺少 flowInput 节点）" | 保存失败 | 不保存 |
| E-FLOW-MAX-DEPTH | 嵌套深度 > 8 | "嵌套调用过深（超过 8 层）" | 保存失败 或 运行时失败（见下注） | 不保存 或 运行中止 |
| E-CALLFLOW-TARGET | callFlow 未选子 flow | "请选择要调用的子 flow" | 保存失败 | 不保存 |
| E-CALLFLOW-INPUT | callFlow 未选入口或入口已删 | "请选择子 flow 的入口节点" | 保存失败 | 不保存 |
| E-CALLFLOW-MAP | 入参映射的 childVar 不在子 flow 入口声明内 | "入参 '{var}' 未在子 flow 入口声明" | 保存失败 | 不保存 |
| E-CALLFLOW-MAP-MISSING | 子 flow 入参未被映射覆盖且无 defaultValue | "子 flow 入参 '{var}' 未提供映射且无默认值" | 保存失败 | 不保存 |
| E-SUBFLOW-FAILED | 运行时子 flow 内节点报错（重试后仍失败） | "子 flow '{name}' 执行失败：{reason}" | 父 flow 中止，callFlow 节点标记 error，执行详情可展开看子 flow 失败节点 | 子 flow 已产生的副作用（如外发消息、产物）不回滚 |
| E-SUBFLOW-NO-OUTPUT | 子 flow 执行到达终点（无下一节点）但未经过任何 flowOutput 节点 | "子 flow '{name}' 未到达出口节点" | 父 flow 中止 | 同上 |
| E-SUBFLOW-RUNTIME-REF | 运行时子 flow 已被删（保存后到运行之间被删） | "调用的子 flow '{id}' 不存在" | 父 flow 中止 | 不保存的执行，记录错误日志 |

注：E-FLOW-MAX-DEPTH 两层防护——保存时静态检查（按调用图最长路径），运行时再做一次栈深计数（防止 A→B→C 保存后新增 C→A 造成漏检的竞态）。

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 模块数多（引擎改造 + 新增节点类型 + validator + DB schema 变更 + 前端配置面板 + 执行记录嵌套 + 循环检测）；引擎核心执行模型从"单指针 DAG"改为"栈式调用"，涉及 `flowEngine.js` 核心控制流；DB 表 `executions`/`execution_nodes` 加字段；跨模块耦合（flowService 校验、taskService 执行记录、NodePalette/NodeConfigPanel UI、upstreamVariables 上游变量发现）；多分支（多入口/多出口）；无外部依赖（都是内部模块）。 |

## 10. 实现决策（高层，不写代码）

- **执行模型**：callFlow 节点的 executor **内联**执行子 flow（在父 flow 的 `flowEngine.run()` 调用栈里递归调用），**不**走 `taskService.createTask()`（那会变成异步队列、丢失同步语义）。引擎需要在 callFlow executor 返回前完成子 flow 的全部执行，把子 flow 的出参作为 executor 的 output 返回给父。
- **执行记录可观测性**：子 flow 执行产生独立的 `executions` 行（带 `parentExecutionId` + `parentNodeId`），其 `execution_nodes` 正常写入；父 callFlow 节点的 nodeRecord 持有子 executionId 供 UI 展开查询。这保持执行记录数据模型清晰，不把父子节点混在扁平数组里。
- **栈式执行**：引擎 `run()` 需要接受"起始节点 ID"参数（当前硬编码为入度 0 节点），以便子 flow 从指定 flowInput 节点启动；其他 trigger/flowInput 节点在该次执行中按普通节点处理（到达才执行），但由于图是 DAG 且从 flowInput 出发，其他 trigger 节点自然不可达、不会跑到。
- **flowService 注入**：当前 executor 签名里没有 flowService，callFlow executor 需要加载子 flow 定义。通过 options 注入 `loadFlow(flowId)` 回调（和现有 `_channelManager` 通过 variables 注入的模式类似，但更干净的方式是走 options.executors 或 options.services）。
- **published vs draft**：**永远用子 flow 的当前版本**（nodeList/edges，即 draft）——父 flow 无论是 draft 调试还是 published 生产触发，调用子 flow 时都读子 flow 的当前定义。这与用户"调最新、子 flow 改了自动生效"的本意一致；也和现有飞书/manual 触发都跑当前版本的行为一致。schedule 触发仍走父 flow 的 published 快照（父快照里的 callFlow 节点本身记录了 targetFlowId，但加载子 flow 时仍读子的当前定义）。
- **上游变量发现**：所有节点类型统一通过 `config.outputVariables` 声明对下游可见的变量名；`upstreamVariables.js` 从节点类型注册表读取推导函数，不再按类型硬编码 switch。callFlow 节点的 outputVariables 在保存时由 flowService 根据目标子 flow 的 flowOutput 并集自动补全，对下游暴露为 `${nodeId}.${var}`。子 flow 内部，flowInput 节点按 TRIGGER_LIKE 处理（它的 outputVariables 对整个子 flow 可见），flowOutput 节点是叶子、不产生下游引用。
- **多出口**：一个子 flow 可含多个 flowOutput 节点（不同分支走不同出口）；callFlow 节点的 outputMappings 覆盖"所有 flowOutput 的出参并集"——子 flow 最终走到哪个出口，该出口声明的出参就有值，未到达出口的出参为 undefined。这与"未到出口算失败"不冲突（未到达任何出口才失败，到达任一个出口算成功）。

## 11. 测试决策

### 11.1 覆盖接缝（coverage seams）

| 稳定块 | seam | 测试类型 |
|---|---|---|
| 1. 三种新节点类型定义 | flowService 节点验证（validateNodeList） | 单元 |
| 2. 同步调用执行 | flowEngine.run() 直接调用，构造父/子 flow fixture | 单元 + 集成 |
| 3. 多入口启动（从 flowInput 启动 vs 从 trigger 启动） | flowEngine.run() 带 startNodeId 参数 | 单元 |
| 4. 显式映射 + 变量隔离 | flowEngine.run()，断言子内部写的变量不泄漏到父、父变量不污染子（除映射外） | 单元 |
| 5. 失败中止 | flowEngine.run() 构造子 flow 内失败/未到出口的 fixture，断言父 callFlow 节点 error、父中止 | 单元 |
| 6. 多层嵌套 + 静态循环检测 | flowService 保存校验（validateCircularCalls） | 单元（循环检测）+ 集成（3 层嵌套执行） |
| 7. 调最新语义 | 执行前修改子 flow 定义，断言运行时使用新版本 | 集成 |
| 8. 嵌套执行记录 | taskService.createTask 跑嵌套 flow，查询 executions/execution_nodes 表断言 parentExecutionId 正确、子节点记录完整 | 集成（CLI 或 API 层） |
| 9. 可选列表过滤 | flowService API 返回"可作为子 flow"列表只含 flowInput 节点的 flow | 单元 |
| 10. 画布跳转 / callFlow 配置面板 | E2E Playwright：配一个父 flow 调子 flow，保存发布，飞书发消息触发，看父执行详情展开 | E2E |
| 11. foreach + callFlow 组合 | flowEngine.run() 构造 foreach body 含 callFlow，断言循环多次调用子 flow | 单元 |

主要测试 seam：
- **引擎层**：`flowEngine.run()` 是主 seam——直接构造 flow JSON 驱动执行，无需 UI
- **服务层**：`flowService.validateNodeList` + 新的 `validateSubflowCalls()` 测校验
- **API/CLI**：`POST /api/flows` 保存测循环检测；`POST /api/executions` 或 CLI 测执行记录嵌套
- **E2E**：Playwright 跑完整画布配置 + 触发 + 详情展开

## 12. 范围外

- **异步派发 / 扇出广播**：这是上层路由/广播节点的能力，本期只做"flow 变节点"底层抽象
- **错误分支 / try-catch 语义**：callFlow 失败即父 flow 中止，不支持 onError: 分支路由，后续迭代
- **变量类型系统**：flowInput/flowOutput 的 `type` 字段保留但不校验（和现有 trigger 一致）
- **版本绑定 / 快照**：永远调最新，不做"父 flow 绑定子 flow vN"
- **子 flow 节流 / 并发控制**：父 flow 并发（含 foreach 并行）调子 flow 时不做限流
- **跨项目调用子 flow**：callFlow 只能引用同项目内 flow
- **调用子 flow 时传入父 context 只读透传**：严格隔离，不提供逃生口
- **flowOutput 节点的"出口命名路由"**：父 callFlow 不按出口名分支路由（一期父不关心从哪个出口返回，只关心映射了哪些变量）

## 13. 补充说明

- **与现有 template 机制的关系**：template 是"拷贝节点进 flow 后解耦"，callFlow 是"引用执行始终最新"，两者是不同复用模型，共存不冲突。
- **与已存在 story `2026-07-19-media-production-line` 的关系**：该 story 正在 BUG 阶段（BUG-007 刚修完），本 story 是独立的新能力，不影响其契约。飞书壳 + 子 flow 的场景是本 story 的**应用示例**而非前置依赖。
- **现有节点类型校验白名单**：`flowService.VALIDATED_NODE_TYPES` 要加 `flowinput`/`flowoutput`/`callflow`（小写），NodePalette/NodeConfigPanel 的 REFINED_NODE_TYPES 也要加对应 camelCase。
- **引擎层执行上限**：现有 `maxDepth:100` 针对 while/foreach 循环；子 flow 嵌套深度单独设 8 层硬上限，独立计数。
- **执行日志清理**：新增的子执行记录和父执行记录共用 `purgeExpiredExecutions` 清理逻辑，通过 parentExecutionId 级联。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | 6.1 三个场景（建子 flow / 父调用法 / 独立触发），6.2 列全异常分支 |
| 输入验证 | PASS | 7.1-7.3 覆盖三种新节点配置字段，7.4 覆盖跨字段/循环/深度检测 |
| 错误状态 | PASS | 第 8 节列出全部错误码和运行时失败，含回滚语义 |
| 复杂度分级 | complex | 多模块、引擎核心改造、DB schema 变更、跨层耦合 |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.2 | 2026-07-27 | Attempt 2 反向同步：统一节点输出模型，setVariables 改用 outputVariables + expressions；更新上游变量发现描述 | AI + 人 |
| v0.1 | 2026-07-23 | 初稿，基于访谈笔记合成 | AI + 人 |
