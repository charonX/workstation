# Technical Design: Flow 细化

> Story：`2026-07-16-flow-refinement`
> 日期：2026-07-17
> 状态：待用户审查
> 说明：本 story 在 PRD → CRYSTALLIZE 时跳过了 TECH-DESIGN，assertion-signoff 将 3 个遗留问题与 PRD 移动块 1/2/5/6 推迟到本阶段。本文档补齐这些决策，**不改变任何已签核契约**。

## 1. 目标与范围

把 PRD 的稳定块翻译成系统语言：Trigger / Condition / Claude Agent 三个节点的配置语义、FlowEngine 变量注册表与错误处理、Claude Agent SDK 集成、执行日志持久化与清理。节点范围、变量命名空间、错误处理策略、日志保留期均已在 REQ-FLOW-018~028 锁定，本文档不重新讨论。

范围外沿用 PRD §8：Codex App Server 节点、本地 CLI agent 扫描、复杂错误分支、输出结构化解析、新节点类型、调试面板、ForEach/While 细化。

## 2. 关键约束（已签核契约）

以下来自 requirements.md 与 signoff.md，是实现必须满足的硬约束：

1. 变量注册表：`VariableRegistry := Map<nodeId, Map<variableName, { type, value }>>`；executor 面向的 `context` 是其扁平视图，键为 `fullName`（`"n1.x"`）。
2. Condition 表达式直接使用 `fullName`（`n1.count > 3`）；Agent prompt 使用 `{{fullName}}`。
3. **引擎在调用 executor 之前完成 prompt 替换**：executor 读到的 `node.config.prompt` 必须是替换后文本（不得修改 flow 定义本身，传替换后的副本）。
4. 校验在 `flowService` 层，非法时抛 `"Validation failed"`，HTTP 层返回 400；错误结构 `{ path, message }`。
5. 测试 mock 经 `run(flow, { executors })`（第二参数）注入；executor 输入包含 `{ node, context, projectPath }`。
6. 错误语义：`error` 按 `config.retries` 重试（默认 1），耗尽后 `onError: fail` 终止 / `onError: ignore` 视为成功且输出变量写空字符串继续；`fatal` 不重试直接抛。
7. `execution_nodes` 表必须包含列：`executionId, nodeId, nodeName, inputVariables, outputVariables, branchTaken, error, attemptCount, prompt, output, model, provider, status, durationMs`；`executions.startedAt` 用于 7 天清理。
8. Agent 调用详情 prompt 截断前 4000 字符；凭证不进日志。
9. 节点配置面板字段（E2E 已签核）：Provider / Model / Output variable / Retries / On error / Prompt。

## 3. 模块与边界

| 模块 | 职责 | 不越界 |
|---|---|---|
| `FlowEngine` | 维护变量注册表（扁平 context 视图 + 嵌套 scope 视图）；执行前替换 `{{fullName}}`；按 `retries`/`onError` 执行重试与降级；累计每节点执行记录 `nodeRecords` | 不感知 agent SDK；不读写数据库；不读 settings |
| `executors/agentExecutor` | 引擎与 adapter 的边界：把 `{ node, context, projectPath }` 组装为 adapter 输入 | 不做变量替换（引擎已完成）；不解析凭证 |
| `claudeAgentAdapter` | 包装 `@anthropic-ai/claude-agent-sdk` 的 `query()`；校验 `projectPath`；汇聚流式消息为文本；映射 SDK 错误为 `error`/`fatal` | 不感知变量注册表；不决定工作目录语义 |
| `flowService` | 节点配置校验（Trigger/Condition/Agent 三节点 schema）；持久化 | 不执行 flow |
| `taskService` | 执行入口唯一性不变；把 `result.nodeRecords` 写入 `execution_nodes`；触发日志清理 | 不解析节点 config 语义 |
| `executionCleanup`（新，可挂在 taskService 或独立模块） | `purgeExpiredExecutions()`：滚动 7×24h cutoff，事务删三表 | 不感知调度业务 |
| 前端 Flow Editor | 六字段配置面板；变量选择器按节点分组 | 不执行表达式；不调 agent |

凭证解析**不进入任何模块**：见 §6.3。

## 4. 数据流

### 4.1 执行路径

```
taskService.runFlowEngine
  │ 创建 executions 行（startedAt）
  ▼
FlowEngine.run({ flow, project }, options, inputVariables)
  │ 1. 播种注册表：Trigger 节点 outputVariables 的 defaultValue 写入 context["<nodeId>.<name>"]
  │    inputVariables 合入同一扁平 context（键冲突时覆盖默认值）
  │ 2. 逐节点执行：
  │    a. agent 节点：替换 config.prompt 中 {{fullName}}（缺失 → ""）→ 传 node 副本给 executor
  │    b. condition 节点：executor 用嵌套 scope 求值表达式（见 §5.3）
  │    c. executor 返回 error → 按 retries 重试 → 耗尽按 onError 处理
  │    d. 成功（或 ignore 降级）→ output 写入 context["<nodeId>.<outputVariable>"]
  │    e. 累计 nodeRecord：{ nodeId, nodeName, inputVariables(context 快照), outputVariables,
  │       branchTaken, error, attemptCount, agent?(prompt/model/provider/durationMs) }
  │ 3. 返回 { status, output, branch, iterations, nodesRun, logs, nodeRecords }
  ▼
taskService 事务写入 execution_nodes；更新 executions 行；沿用 logs 表
```

### 4.2 副作用清单

- 写库：`executions` / `execution_nodes` / `logs`（taskService，同一 db 连接）。
- 外部调用：Agent SDK 子进程（adapter），仅此一处出网。
- 定时任务：日志清理 cron（见 §7）。

### 4.3 触发方式与入口变量填充

**触发来源建模在 Trigger 节点之外**：当前架构中"如何触发"不是节点 config 的属性——手动触发走 `POST /api/flows/:id/debug`，定时触发是独立的 `schedules` 实体（REQ-SCHEDULE-001~003），`executions.trigger` 列记录每次执行的来源（`manual` / `schedule`）。Trigger 节点只负责**声明入口变量契约**（名称/类型/默认值），各触发方式共用这份契约。若把触发方式塞进节点 config，会与 schedules 表形成双事实源，明确不采用。

| 触发方式 | 入口变量来源 | 现状 |
|---|---|---|
| 手动（UI/CLI） | debug endpoint 已接受 `variables`（API 级）；未传项回落 `defaultValue`。**按 Trigger 声明渲染填写表单不在本 story 签核范围**（E2E 只签了配置面板），若需要属后续细化 | 端点可用，无表单 UI |
| 定时 | 无交互，全部使用 `defaultValue` | schedule 执行传空 inputVariables；Trigger 默认值机制是定时触发的 enabler |
| webhook | request body JSON → 变量映射 | **不存在，划入后续 story**（新端点 + 鉴权/信任边界设计，见 PRD §8） |

各触发方式共用规则：`inputVariables` 与 Trigger 声明同名时覆盖 `defaultValue`；未声明的 key 原样进入扁平 context（legacy 兼容）。

## 5. 接口契约

### 5.1 FlowEngine 变更（内部，对外签名不变）

- `run(flowOrConfig, options, inputVariables)`：签名不变。
- executor 解析优先级：`options.executors` > `flowOrConfig.executors` > 默认 executors（修复当前只读第一参数的缺陷——已签核测试使用第二参数）。
- executor 输入：`{ node, context, project, projectPath, iteration }`。`projectPath` 取自 `project.localPath`；`context` 为扁平 fullName 键对象（向后兼容旧的平铺键）。
- 返回值新增 `nodeRecords: Array<NodeExecutionRecord>`，既有字段不变。

### 5.2 变量注册表双视图

单一事实来源是扁平 `context`（键 `"n1.x"`），派生两个视图：

- **扁平视图**：executor 输入、prompt 替换查表、`nodeRecord.inputVariables` 快照。
- **嵌套视图**：Condition 求值 scope，由扁平键按第一个 `.` 拆分为 `{ n1: { x } }`；无 `.` 的 legacy 键保持顶层标识符（向后兼容旧表达式）。

### 5.3 Condition 表达式求值语义

- 求值器把嵌套视图包装为 scope：`n1.count > 3` 中 `n1` 是普通对象。
- **悬空引用不抛异常**：未知 nodeId 解析为"任意属性都读出 `undefined` 的对象"（Proxy 实现），使 `typeof n999.missing === 'undefined'` 为 true、`n999.missing > 3` 为 false。
- 表达式自身语法/求值异常 → conditionExecutor 返回 `status: "error"`，进入统一重试/onError 流程（默认 fail，与旧行为"直接终止"一致）。
- 旧 REQ-FLOW-007 测试（无变量表达式）不受影响。

### 5.4 节点配置 schema（最终版）

**Trigger**
```json
{ "type": "trigger",
  "config": { "outputVariables": [ { "name": "repoPath", "type": "string", "defaultValue": "" } ],
              "retries": 1, "onError": "fail" } }
```
校验：name 非空且节点内唯一；type ∈ `string|number|array|object`。

**Condition**
```json
{ "type": "condition", "config": { "expression": "n1.count > 3", "retries": 1, "onError": "fail" } }
```
校验：expression 非空；**不做语法校验**（REQ-FLOW-019）。

**Claude Agent**
```json
{ "type": "agent",
  "config": { "provider": "anthropic", "model": "claude-sonnet-5",
              "outputVariable": "summary", "prompt": "Summarize {{n1.result}}",
              "retries": 1, "onError": "fail",
              "options": { "systemPrompt": "...", "maxTurns": 20 } } }
```
- `options` 可选，**allowlist 仅 `systemPrompt` / `maxTurns`**，透传给 SDK；其余键（含 `temperature` / `maxTokens`）拒绝——Agent SDK 不支持，静默忽略会误导用户。
- 面板 UI 只暴露已签核六字段；`options` 供 API/后续 story 使用。
- `retries` 默认 1（≥0 整数），`onError` 默认 `fail`，三个节点一致。

### 5.5 claudeAgentAdapter 接口

```js
execute({ prompt, model, projectPath, options?, apiKey? }) →
  { status: "success" | "error" | "fatal", output?, error?, logs?, durationMs }
```

- **agentExecutor 按 `config.provider` 分派**：无 `provider`（旧 flow，如 `config: { model: "mock" }`）→ 内置 mock 响应（保持 REQ-FLOW-017 等旧签核契约离线可过）；`provider: "anthropic"` → claudeAgentAdapter 真实调用。
- 先校验 `projectPath` 存在且可读，失败返回 `status: "error"`（走节点重试/onError 流程）。
- 映射到 SDK：`query({ prompt, options: { cwd: projectPath, model, systemPrompt?, maxTurns?, permissionMode: "bypassPermissions" } })`。
- `apiKey` 为可选透传：提供时注入子进程 env（`ANTHROPIC_API_KEY`）；不提供时由 SDK/CLI 本机凭证解析（§6.3）。
- 流式消息汇聚为最终文本写入 `output`；SDK 抛错 → `status: "error"`（鉴权失败信息需可辨识，提示本机 claude code 未登录）。
- **可测试性**：内部持有可注入的 `queryFn`（默认 SDK `query`），映射/汇聚/错误转换逻辑由 BUILD 阶段 TDD 单元测试离线覆盖（实现测试，非业务契约）。

### 5.6 execution_nodes 表

```sql
CREATE TABLE IF NOT EXISTS execution_nodes (
  id TEXT PRIMARY KEY,
  executionId TEXT NOT NULL,
  nodeId TEXT NOT NULL,
  nodeName TEXT,
  inputVariables TEXT,     -- JSON（扁平 fullName 键快照）
  outputVariables TEXT,    -- JSON
  branchTaken TEXT,        -- condition: "true"/"false"
  error TEXT,
  attemptCount INTEGER NOT NULL DEFAULT 1,
  prompt TEXT,             -- agent 详情：截断前 4000 字符
  output TEXT,
  model TEXT,
  provider TEXT,
  status TEXT,
  durationMs INTEGER
);
CREATE INDEX IF NOT EXISTS idx_execution_nodes_execution ON execution_nodes(executionId);
```

- 迁移加入 `db.js` 的 `initSchema` + `migrateSchema`（与既有表同模式）。
- agent 详情字段由 agentExecutor 在返回中携带（`{ agent: { prompt, model, provider, durationMs } }`），引擎抄入 nodeRecord；非 agent 节点/mock executor 为 NULL。
- Executions 详情 API 关联查询返回节点记录，既有响应字段不变（REQ-028 AC6）。

## 6. Claude Agent SDK 集成

### 6.1 选型：`@anthropic-ai/claude-agent-sdk`

决策理由与取舍见 `adr/ADR-005`。要点：REQ-FLOW-027 的 `projectPath` 工作目录语义只有 agentic harness（带工具的子进程）才有意义；Messages API 会使其退化为空校验。

### 6.2 打包与运行

- SDK 依赖随 npm 安装；其捆绑 CLI 需在 `forge.config.js` 的 asar unpack 列表中（参照 better-sqlite3 的 `plugin-auto-unpack-natives` 模式，非原生但需解包为可执行文件）。
- 子进程 node 运行时：Electron 下用 `ELECTRON_RUN_AS_NODE=1` + `process.execPath`；headless CLI 下直接用系统 node。封装在 adapter 内。
- **风险**：打包后子进程路径/运行时是本 story 最大集成风险，BUILD 切片先做最小 spike（adapter 在 dev 与 packaged 两种形态下各跑一次真实调用）。

### 6.3 凭证策略：不存储，复用本机 claude code

**用户决策（2026-07-17）**：应用不配置、不存储 API key。前置条件是用户本机 claude code 已可用（已 `claude` 登录或自行配置 `ANTHROPIC_API_KEY`）。

- adapter 的 `apiKey` 入参保留为可选透传缝（已签核接口的一部分），应用自身不填充。
- Electron 从 Finder 启动拿不到 shell env：由 CLI 自身的登录态（`~/.claude` 凭证）兜底，与 env 无关。
- 鉴权失败 → adapter 返回 `error`，错误消息提示"本机 claude code 未登录/不可用"。
- 安全红线不变：prompt 截断 4000 字符入库（REQ-028）；应用代码路径上不接触凭证，天然满足"凭证不进日志"。

### 6.4 执行模式

- `permissionMode: "bypassPermissions"`：无人值守/定时执行无法应答权限提示；这是产品形态决定的有意取舍（flow 由用户本人编排，agent 在其项目目录内工作）。风险在 §9 记录。
- 默认 `maxTurns` 上限（adapter 内置，如 20），防止单节点失控计费；可经 `config.options.maxTurns` 覆盖。

## 7. 执行日志清理

- **`purgeExpiredExecutions(db, { retentionDays = 7 })`**：滚动时间窗 `startedAt < now - 7×24h`（不按自然日）；单事务内按序删 `execution_nodes` → `logs` → `executions`（前两者按 executionId 子查询）。
- **触发点 A：HTTP server 启动时**——Electron main 与 headless CLI 两条路径都经过 `startServer`，短生命周期 headless 进程由此覆盖。
- **触发点 B：node-cron 每日任务**——常驻实例（本产品的核心形态）由此覆盖；复用现有调度器基础设施。
- 保留期暂不开放 settings 配置（与"面板不扩展"纪律一致），后续需要时再加。

## 8. Seams 与测试策略

| seam | 覆盖 | 说明 |
|---|---|---|
| FlowEngine（注册表/替换/错误处理/悬空引用） | 已签核 API 测试 | mock executor 经 `options.executors` 注入 |
| 三节点 config 校验与持久化 | 已签核 API 测试（flowService） | `"Validation failed"` + `{ path, message }` |
| adapter 形状契约 | 已签核占位测试 | 自指断言，不触达真实 SDK |
| adapter↔SDK 映射/汇聚/错误转换 | BUILD 阶段 TDD 单元测试 | 注入 `queryFn`，离线；属实现测试非业务契约 |
| 配置面板 / 变量选择器 / 分支标识 | 已签核 Playwright E2E | 行为级断言 |
| execution_nodes 表结构与清理 | 已签核 API 测试 + E2E | 清理函数用伪造 startedAt 行验证 |
| 真实 SDK 端到端 | 手动 / feel-signoff | 打包形态 spike 见 §6.2 |

**测试框架事故记录**：test-author 生成的 10 个 API 测试误用未安装的 vitest，已在 2026-07-17 经用户决策机械转换为 `node:test` + `node:assert/strict`（断言值不变，`[test]` commit `560faca`）。转换后 41 测试可运行：19 通过 / 22 失败（红色契约）。

## 9. 安全 / 性能 / 可观测性

**安全**（对照 checklists/security.md）：
- 信任边界：用户编写的 prompt/表达式 → agent 子进程；SDK 输出 → 注册表 → 下游 prompt。
- LLM 输出视为不可信：只作为字符串写入注册表与日志，不进 eval/SQL/shell（表达式求值 scope 只含注册表数据，不含输出执行能力）。
- `bypassPermissions` 是有意取舍：agent 可在项目目录内读写执行。缓解：flow 由用户本人编排并显式保存/发布；本 story 不开放远程触发新面。
- 凭证不落地（§6.3）；日志 prompt 截断 4000 字符。

**性能**：
- 注册表为内存 Map，单执行生命周期；无持久化开销。
- 清理为单事务三条 DELETE（startedAt 无索引——executions 行数小，全表扫描可接受；若未来膨胀再加索引）。
- agent 节点成本由 `maxTurns` 上限兜底。

**可观测性**：
- `execution_nodes` 即节点级 trace：input/output/branch/error/attemptCount/durationMs。
- adapter 返回 `logs` 数组并入既有 `logs` 表链路。
- 清理任务执行结果（删除行数）写入应用日志。

## 10. 失败与风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Electron packaged 形态下 SDK 子进程无法启动（asar 内路径/ELECTRON_RUN_AS_NODE） | agent 节点全部失败 | BUILD 第一切片做 dev+packaged spike（§6.2） |
| 用户本机 claude code 未登录 | agent 节点运行时 error | adapter 错误消息明确指引；`onError` 机制兜底 |
| 旧 flow（无 outputVariable/无 namespaced 变量）回归 | 既有 88+43 测试 | legacy 平铺键与 fullName 键共存于同一扁平 context；旧 REQ-FLOW-007~017 测试保持绿 |
| `options.executors` 优先级变更影响旧调用方 | 低 | 旧调用方用 `flowOrConfig.executors`，优先级低于 options、高于默认，语义不变 |

## 11. 对 PRD 的反向同步

- 移动块 1（provider/SDK）→ 已决策：Claude Agent SDK（ADR-005）。
- 移动块 2（凭证存储）→ 已决策：不存储，复用本机 claude code。
- 移动块 3（变量选择器 UI 细节）→ REQ-022 已锁定行为；图标/搜索等观感留 REFLECT。
- 移动块 4（表达式编辑体验）→ REQ-019 已锁定：不做静态校验。
- 移动块 5（可配置参数）→ 已决策：`options` 透传 allowlist（systemPrompt/maxTurns），面板不扩展。
- 移动块 6（清理策略）→ 已决策：滚动 7×24h，启动 + 每日 cron。
- PRD §6.2.3 agent schema 增补可选 `options` 字段说明。

## 12. 下一步

1. 用户审查本文档与 ADR-005。
2. 更新 workflow-state：TECH-DESIGN 完成（补档），进入 BUILD。
3. `/implementer` 切片建议：① SDK spike + adapter（§6.2）；② FlowEngine 注册表/替换/错误处理；③ flowService 三节点校验；④ execution_nodes + 清理；⑤ 前端面板与变量选择器。
