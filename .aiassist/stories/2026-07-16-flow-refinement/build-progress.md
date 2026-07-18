# Build Progress — 2026-07-16-flow-refinement

> 由 /implementer 父代理维护。每个 slice 记录 PRD→代码 可追溯性表（由 implementer subagent 写入）、验证结果与 commit 范围。

## 切片总览

| Slice | REQ | 测试文件 | 依赖 | 状态 |
|---|---|---|---|---|
| S1 adapter-sdk | REQ-FLOW-020（adapter seam）、REQ-FLOW-027（adapter 部分） | `flow-engine/api/claudeAgentAdapter.test.js`（占位，保持绿） | 无 | pending |
| S2 engine-core | REQ-FLOW-023/024/025/026/027（api） | `flow-engine/api/{variableRegistry,variableSubstitution,errorHandling,danglingReference,projectPathInjection}.test.js` | 无 | pending |
| S3 service-validation | REQ-FLOW-018/019/020/021（api/持久化） | `flow/api/{triggerConfig,conditionConfig,agentConfig}.test.js` | 无 | pending |
| S4 execution-log | REQ-FLOW-028（api） | `execution/api/executionLog.test.js` | S2（nodeRecords） | pending |
| S5 frontend-e2e | REQ-FLOW-018~022/026/028（e2e） | `flow/e2e/*.test.cjs`（6 个）+ `execution/e2e/executionLog.test.cjs` | S3、S4 | pending |

## 关键契约提醒（所有切片遵守）

- 测试命令：unit = `npm run test:unit`（自动 rebuild better-sqlite3）；e2e = `npm run test:e2e`。
- 业务测试只读；diff 碰测试 = 本轮作废。
- agentExecutor 按 `config.provider` 分派：无 provider → 内置 mock（保持 REQ-FLOW-017 等旧契约）；`anthropic` → claudeAgentAdapter（tech-design §5.5）。
- 注册表双视图：扁平 `context["n1.x"]`（executor/prompt 替换）+ 嵌套 Proxy scope（Condition，悬空引用 → undefined 语义）。
- CodeGraph 已启用：导航可用 MCP 查询（以代码语义为准）；每个 slice commit 后运行 `codegraph sync`（失败记警告即可）。
- 本 story 无 ux/ 目录；前端参照 codex-harness-desktop 的 Flow Editor 原型与 `.aiassist/global/_ds/global/` 设计系统。

---

## Slice 记录

## Slice S1: adapter-sdk

**日期**：2026-07-17
**实现**：`src/flowEngine/claudeAgentAdapter.js`（新建）、`src/flowEngine/executors/agentExecutor.js`（provider 分派改造）、`package.json` / `package-lock.json`（新增 `@anthropic-ai/claude-agent-sdk@0.3.212`）
**签核测试**：`tests/capabilities/flow-orchestration/flow-engine/2026-07-16-flow-refinement/api/claudeAgentAdapter.test.js`（占位自指断言，保持绿，未修改）

### PRD → 代码 可追溯性表

| PRD 意图 | 实现 | 测试 | 状态 |
|---|---|---|---|
| REQ-FLOW-020 AC4：adapter 把统一输入映射到 Claude Agent SDK，返回文本内容 | `claudeAgentAdapter.execute` 映射到 `query({ prompt, options: { cwd, model, permissionMode, maxTurns, systemPrompt? } })`；流式消息汇聚（result.result 优先，回落 assistant 文本拼接）写入 `output`；`agentExecutor` 透传 `output` | 签核占位 `claudeAgentAdapter.test.js`（绿）；映射/汇聚逻辑由 BUILD TDD scratch 测试覆盖（已删除） | PARTIAL — adapter 映射与 output 返回已覆盖；"写入声明的 outputVariable" 的注册表写入属 S2 引擎职责 |
| REQ-FLOW-020 AC5：adapter 不感知变量注册表，只接收已替换变量后的最终 prompt | `execute({ prompt, ... })` 仅接收字符串 prompt；模块内无任何 context/registry 引用 | 签核占位 `claudeAgentAdapter.test.js` 第 4 例（绿） | COVERED |
| REQ-FLOW-020 AC6：默认工作目录为 flow 所属项目本地路径，由调用方传入 adapter | `execute` 接收 `projectPath` 参数；`agentExecutor` 从引擎入参透传 `projectPath`（adapter 不自行决定目录语义） | 签核占位 `claudeAgentAdapter.test.js`（绿）；TDD scratch 验证 `options.cwd === projectPath`（已删除） | PARTIAL — adapter seam 已覆盖；引擎 → executor 的 projectPath 接线属 S2（对齐检查口径修正，2026-07-17） |
| REQ-FLOW-027 AC3：adapter 使用 projectPath 作为 SDK 调用工作目录 | `sdkOptions.cwd = projectPath` | TDD scratch「成功路径参数映射」（已删除） | COVERED |
| REQ-FLOW-027 AC4：项目路径不存在或不可读 → `status: "error"` 附错误信息，不调 SDK | `validateProjectPath`：缺失/不存在/非目录/不可读（`fs.statSync` + `fs.accessSync R_OK`）→ 提前返回 error | 已签核 `projectPathInjection.test.js` 第 3 例本切片后转绿；TDD scratch 三条路径校验用例（已删除） | COVERED |
| tech-design §6.3 凭证策略：不存储；apiKey 可选透传；鉴权失败指引 | 提供 `apiKey` 时 `options.env = { ...process.env, ANTHROPIC_API_KEY }`，不提供则不设置 env；鉴权类错误消息追加"本机 claude code 未登录或不可用"指引；凭证不写入 logs/output/error | TDD scratch「apiKey 注入 env」「鉴权指引」「凭证红线」三例（已删除） | COVERED |
| tech-design §6.4 执行模式：bypassPermissions + maxTurns 上限 | `permissionMode: "bypassPermissions"` + `allowDangerouslySkipPermissions: true`（SDK 0.3.x 强制要求）；`maxTurns` 默认 20，可经 `config.options.maxTurns` 覆盖 | TDD scratch「参数映射」「options 透传 allowlist」（已删除） | COVERED |
| tech-design §5.5 provider 分派（硬约束）：无 provider → 内置 mock；`anthropic` → claudeAgentAdapter | `agentExecutor`：`provider === "anthropic"` 走 adapter；无 provider 走原 `agentAdapter.js` mock（行为原样）；未知 provider 返回 error 不静默 mock | 旧签核契约（REQ-FLOW-017 等）全套保持绿；TDD scratch 分派 4 例（已删除） | COVERED |

### 验证结果

- 全套业务测试 `npm run test:unit`：129 tests / **109 pass / 20 fail**（基线 107/22）。失败集严格为基线子集（无新增回归）；2 个红色契约提前转绿：`REQ-FLOW-027 项目路径不存在或不可读时 adapter 返回 status=error`、`REQ-FLOW-025 重试耗尽后 onError=fail 终止整个 flow`（均因真实分派 + 路径校验的合理行为，非硬凑；其完整契约语义仍由 S2 收尾）。
- TDD scratch 测试：16/16 绿后已删除（`/tmp/s1-scratch/`，实现工具不持久化）。
- dev spike（真实 SDK 调用一次）：见 subagent 报告 / commit message 下方备注。
- 打包注意（留给 QA packaged spike）：SDK 0.3.212 的捆绑 CLI 是平台原生可执行文件（`@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`，Mach-O），`plugin-auto-unpack-natives` 只解包 `.node` 模块，packaged 形态需在 `forge.config.js` 增加 `asarUnpack` 覆盖 `@anthropic-ai/claude-agent-sdk-*`（本切片未改，遵守范围纪律）。原生二进制意味着 tech-design §6.2 假设的 `ELECTRON_RUN_AS_NODE` 子进程运行时不再需要。

### commit 范围

- `[build] S1: claudeAgentAdapter + agentExecutor provider 分派`：`src/flowEngine/claudeAgentAdapter.js`、`src/flowEngine/executors/agentExecutor.js`、`package.json`、`package-lock.json`（commit `b2f0f5c`）

### 完成记录

- Slice S1: complete (`b2f0f5c`, tests 109/20 green baseline, PRD alignment ALIGNED)
- Slice S1: refactor pass done (`b2f0f5c..41fab06`, tests 109/20 unchanged, no rollback)
- 对齐检查观察项：AC6 标注口径已修正（上文）；projectPathInjection 第 3 例转绿机制待 S2 接通 `options.executors` 后归位；`auth_status` 分支经 refactor subagent 核实为 SDK 真实消息类型（sdk.d.ts:2839），保留。

## Slice S2: engine-core

范围：FlowEngine 变量注册表、变量替换、错误处理、projectPath 注入、nodeRecords 累积。实现文件：`src/flowEngine/flowEngine.js`、`src/flowEngine/executors/conditionExecutor.js`、`src/flowEngine/executors/evaluateExpression.js`、`src/flowEngine/executors/agentExecutor.js`（仅 agent 详情透传）。

### PRD → 代码 可追溯性表

| REQ 验收标准 | 实现位置 | 测试 | 状态 |
|---|---|---|---|
| REQ-FLOW-023 AC1：注册表初始含 Trigger 声明变量及默认值 | `flowEngine.js seedTriggerVariables()`：run 开始时把 trigger 节点 `config.outputVariables[].defaultValue` 写入 `context["<nodeId>.<name>"]`，随后 `inputVariables` 覆盖合并 | `variableRegistry.test.js`「Trigger 节点声明的变量作为初始 context」 | COVERED |
| REQ-FLOW-023 AC2：节点成功后按 nodeId.variableName 写入 result.output | `flowEngine.js` 主循环成功路径：`context["<nodeId>.<outputVariable>"] = result.output`（同时写 legacy 平铺键保持旧 flow 行为） | `variableRegistry.test.js`「节点执行成功后按 nodeId.variableName 写入注册表」 | COVERED |
| REQ-FLOW-023 AC3：下游节点可通过 fullName 读取上游变量 | executor 输入 `context` 为注册表扁平视图（单一可变对象，executor 捕获引用可见后续写入）；condition 经嵌套 scope、agent 经 `{{fullName}}` 替换读取 | `variableRegistry.test.js`（mock 捕获 context 断言 `n1.x`）；`variableSubstitution.test.js` | COVERED |
| REQ-FLOW-023 AC4：不同节点同名变量经 nodeId 区分互不覆盖 | fullName 键天然隔离：`context["n1.x"]` 与 `context["n2.x"]` 并存 | `variableRegistry.test.js`「不同节点可声明同名变量，通过 nodeId 区分」 | COVERED |
| REQ-FLOW-023 AC5：注册表不持久化，仅存单次执行内存 | `context` 为 run() 局部对象，无任何 DB 交互；每次 run 独立新建 | `variableRegistry.test.js`「变量注册表不持久化到数据库」 | COVERED |
| REQ-FLOW-024 AC1：执行 agent 节点前替换 prompt 中所有 {{fullName}} | `flowEngine.js substitutePromptVariables()`：agent 类型节点在 executor 调用前替换，传 `{...node, config: {...config, prompt}}` 副本（不改 flow 定义） | `variableSubstitution.test.js`「{{fullName}} 替换为 registry 中的实际值」 | COVERED |
| REQ-FLOW-024 AC2：fullName 不存在 → 替换为空字符串 | `substitutePromptVariables` 替换回调：`value == null → ""`，否则 `String(value)` | `variableSubstitution.test.js`「不存在时替换为空字符串」 | COVERED |
| REQ-FLOW-024 AC3：condition 表达式 fullName 作为 JS 标识符求值；不存在按 undefined | `evaluateExpression.js`：扁平 context → 嵌套 scope（首个 `.` 拆分）；`with` + Proxy `has/get`：已知键读嵌套值，globalThis 透传，未知标识符返回"任意属性皆 undefined"的 Proxy | `variableSubstitution.test.js`「fullName 直接作为 JavaScript 标识符求值」「不存在时按 JS 语义处理为 undefined」 | COVERED |
| REQ-FLOW-024 AC4：替换后 prompt 传给 claudeAgentAdapter | 引擎替换 → mock/真实 executor 读到的 `node.config.prompt` 即替换后文本；`agentExecutor` 原样透传 adapter | `variableSubstitution.test.js`「替换后的 prompt 文本传递给 claudeAgentAdapter」 | COVERED |
| REQ-FLOW-025 AC1：status=error 按 config.retries 重试 | `executeWithRetry(executor, input, retries)`：`do…while (status==="error" && attemptCount<=retries)`，总尝试 = 1 + retries；`normalizeRetries` 默认 1、≥0 整数 | `errorHandling.test.js`「按 config.retries 次数重试」（retries=2 → 3 次调用） | COVERED |
| REQ-FLOW-025 AC2：重试耗尽 onError=fail 终止 flow | 主循环 error 分支：`onError!=="ignore"` → 记 nodeRecord 后 `throw new Error("fatal: …")`（保留 fatal: 前缀，旧 REQ-FLOW-007 断言兼容） | `errorHandling.test.js`「重试耗尽后 onError=fail 终止整个 flow」 | COVERED |
| REQ-FLOW-025 AC3：onError=ignore 视为成功，输出空字符串，flow 继续 | error 分支降级为合成 success（output:""），走统一成功路径写 `context["<nodeId>.<outputVariable>"]=""`，继续下游；record.error 记录原始错误 | `errorHandling.test.js`「onError=ignore 继续执行下游，输出变量为空字符串」 | COVERED |
| REQ-FLOW-025 AC4：fatal 直接终止不重试 | `executeWithRetry` 循环条件只认 `"error"`；主循环 fatal 分支立即 throw（retries=3 时调用计数仍为 1） | `errorHandling.test.js`「fatal 时直接终止，不进入重试逻辑」 | COVERED |
| REQ-FLOW-025 AC5：错误处理对 Trigger/Condition/Agent 三类型生效 | retries/onError 在主循环统一读取 `node.config`，与节点类型无关；conditionExecutor 异常改返回 error（原 fatal）接入同一流程 | `errorHandling.test.js`「错误处理对三个节点均生效」 | COVERED |
| REQ-FLOW-026 AC2：执行时 {{fullName}} 不存在 → 空字符串 | 同 REQ-FLOW-024 AC2（同一实现路径） | `danglingReference.test.js`「执行时 {{fullName}} 不存在替换为空字符串」 | COVERED |
| REQ-FLOW-026 AC3：condition 表达式 fullName 不存在按 JS undefined 语义 | `evaluateExpression.js` Proxy scope：`typeof n999.missing === 'undefined'` → true | `danglingReference.test.js`「fullName 不存在时按 JS 语义处理为 undefined」 | COVERED |
| REQ-FLOW-027 AC1：执行 agent 节点时获取 flow 所属项目本地路径 | `flowEngine.js`：`project = flowOrConfig.project`，executor 输入含 `project` 与 `projectPath` | `projectPathInjection.test.js`（mock 捕获 projectPath） | COVERED |
| REQ-FLOW-027 AC2：本地路径作为 projectPath 传入 adapter | `projectPath = project.localPath` 随 executor 输入下发；`agentExecutor` 透传 `claudeAgentAdapter.execute({ projectPath })` | `projectPathInjection.test.js`「把项目本地路径作为 projectPath 传入 adapter」 | COVERED |

补充覆盖（tech-design §4.1/§5.6，为 S4 铺路）：主循环逐节点累积 `nodeRecords`（nodeId/nodeName/inputVariables 快照/outputVariables/branchTaken/error/attemptCount/agent?），`run()` 返回新增 `nodeRecords` 字段；`agentExecutor` anthropic 分支返回携带 `agent: { prompt, model, provider, durationMs }`。executor 解析优先级修复为 `options.executors > flowOrConfig.executors > 默认`（按类型合并）。

### 验证结果

- 目标 13 个红契约全绿：`variableRegistry` 2 + `variableSubstitution` 5 + `errorHandling` 3 + `danglingReference` 2 + `projectPathInjection` 1。
- 全套业务测试 `npm run test:unit`：**129 tests / 122 pass / 7 fail**（基线 109/20）。失败集 = S3 的 4 个 validation（REQ-FLOW-018×3 + REQ-FLOW-019×1）+ S4 的 3 个 executionLog（REQ-FLOW-028×3），与切片计划完全一致；旧测试零回归。
- 实现期发现并修复一处自引入回归：`with` + Proxy `has:()=>true` 吞掉了求值函数参数 `ctx`/`context`（旧 while 表达式 `ctx.count < 3` 依赖参数绑定），已在 `has` trap 放行这两个标识符，REQ-FLOW-009 保持绿。

### commit 范围

- `[build] S2: FlowEngine 变量注册表/替换/错误处理/projectPath 注入`：`src/flowEngine/flowEngine.js`、`src/flowEngine/executors/conditionExecutor.js`、`src/flowEngine/executors/evaluateExpression.js`、`src/flowEngine/executors/agentExecutor.js`（commit `3042442`）

### 完成记录

- Slice S2: complete (`3042442`, tests 122 pass / 7 fail = S3×4 + S4×3, zero legacy regression)

### S2 完成记录

- Slice S2: complete (`3042442`, tests 129/122/7, PRD alignment ALIGNED)
- Slice S2: refactor pass done (`3042442..7768477`, tests 129/122/7 unchanged, no rollback)
- 对齐检查观察项（留 REFLECT/人确认，不阻塞）：① condition+onError=ignore 输出空串不匹配 true/false 端口 → flow 自然结束（契约未定义该组合）；② nodeRecords 无 per-node status/output 字段，S4 填充 execution_nodes 时可扩展；③ 裸 `typeof n999` 为 "object"（with 语义取舍）；④ object 变量替换进 prompt 为 "[object Object]"（契约未定义对象渲染）；⑤ while 表达式同享悬空语义（拼错标识符静默 false 而非 fatal，旧测试全绿）。

## Slice S3: service-validation

范围：flowService 层 Trigger/Condition/Agent 三节点 config 校验与结构化错误。实现文件：`src/services/flowService.js`（`validateNodeList` + 接入 `updateFlow`/`createFlow`/`importFlow`）、`src/http/routes/flows.js`（`badRequest` 扩展可选 `details`，PATCH/POST/import 三处 catch 透传 `err.details`）。

**错误结构**：Error.message 以 `"Validation failed"` 开头（`"Validation failed: <path>: <message>; ..."`），Error 对象携带 `err.details = [{ path, message }, ...]`。**取舍：聚合全部错误后一次抛出**（对前端逐字段标红友好；签核断言只要求 `/Validation failed/`，两种策略均满足）。HTTP 400 响应体在 `{ error: "VALIDATION_ERROR", message }` 基础上，仅当 `err.details` 存在时追加 `details` 字段；旧 400 行为（如无 name/project）响应体不变。

**仅校验存在的字段**：无 config 节点、config 缺字段节点一律放行；节点 type 不区分大小写（旧数据含 `"Agent"`/`"Condition"`）；非三类型节点（while/foreach/data 等）不校验。

### PRD → 代码 可追溯性表

| REQ 验收标准 | 实现位置 | 测试 | 状态 |
|---|---|---|---|
| REQ-FLOW-018 AC2：变量名必填、节点内唯一、类型 ∈ string/number/array/object | `flowService.js validateTriggerConfig`：name 非空字符串 → `"Variable name is required"`；重复名（在后出现索引处报）→ `"Duplicate variable name: x"`；type allowlist 拒绝 → `"Invalid type: boolean. Must be one of: string, number, array, object"`；`outputVariables` 非数组 → `"Output variables must be an array"` | `triggerConfig.test.js`「拒绝空变量名并返回 400」「拒绝非法变量类型并返回 400」「拒绝同一节点内重复变量名」（3 红 → 绿） | COVERED |
| REQ-FLOW-018 AC3：后端 API 拒绝非法配置并返回 400 | `updateFlow` 在 `patch.nodeList` 存在时调用 `validateNodeList`，写库前抛错；HTTP PATCH catch → `badRequest(res, err.message, err.details)` 返回 400 + 结构化 details | 同上 3 例（service 层 `assert.throws(/Validation failed/)`）；路由链路经旧 `flow.test.js` 400 用例保持绿验证未劣化 | COVERED |
| REQ-FLOW-018 AC4：保存后变量定义持久化到 nodeList 对应 Trigger 节点 config | 校验通过后走既有 updateFlow 持久化路径（未改动） | `triggerConfig.test.js`「保存 Trigger 节点时持久化 outputVariables 到 config」（保持绿） | COVERED |
| REQ-FLOW-019 AC4：后端 API 拒绝空表达式并返回 400 | `validateConditionConfig`：expression 键存在且为空字符串/非字符串 → `"Expression is required"` | `conditionConfig.test.js`「拒绝空表达式并返回 400」（1 红 → 绿） | COVERED |
| REQ-FLOW-019 AC5：不做运行时前的表达式语法校验 | `validateConditionConfig` 只查非空，不解析语法 | `conditionConfig.test.js`「本 story 不承诺运行时前的表达式语法校验」（`"invalid syntax here"` 可保存，保持绿） | COVERED |
| REQ-FLOW-020 AC3（schema 校验侧）：provider 初始仅 anthropic；options allowlist systemPrompt/maxTurns；retries/onError 可配置 | `validateAgentConfig`：provider 存在时非 anthropic → `"Invalid provider: <v>. Must be one of: anthropic"`；options 非对象 → `"Options must be an object"`，未知键 → `"Unknown option: <key>. Must be one of: systemPrompt, maxTurns"` | `agentConfig.test.js`（保持绿：合法六字段持久化不受影响）；拒绝路径无签核用例，由 validator 实现对齐 tech-design §5.4 | COVERED |
| REQ-FLOW-021 AC2/AC3（持久化语义侧）：retries ≥0 整数、onError ∈ fail/ignore | `validateCommonConfig`：retries 存在时非负整数否则拒绝 `"Retries must be a non-negative integer"`；onError 存在时非 fail/ignore 拒绝 `"Invalid onError: <v>. Must be one of: fail, ignore"`；三节点通用 | 持久化正向路径：`agentConfig.test.js`「保存 Claude Agent 节点时持久化 provider/model/outputVariable/prompt/retries/onError」（保持绿）；默认值/面板交互属 S5 E2E | COVERED |

补充说明：`createFlow`（nodes 存在时）与 `importFlow` 接入同一 `validateNodeList`（成本极低，保持"非法配置不入库"不变量一致）；`addNode`/`connectNodes` 未接入（非签核路径，遵守范围纪律）。旧签核契约验证：`flow.test.js` 中无 config 的 agent 节点 PATCH/发布快照、`config:{model:"mock",systemPrompt}` 的 createFlow、`type:"Agent"` 无 config 的 import 全部保持绿。

### 验证结果

- 目标 4 个红契约全绿：`triggerConfig` 3（空变量名/非法类型/重复变量名）+ `conditionConfig` 1（空表达式）；`agentConfig` 保持绿。
- 全套业务测试 `npm run test:unit`：**129 tests / 126 pass / 3 fail**（TAP reporter 计数；基线 122/7）。失败集 = S4 的 3 个 executionLog（REQ-FLOW-028：执行记录生成/agent 调用详情字段/execution_nodes 表），与切片计划完全一致；旧测试零回归。
- `npx codegraph sync`：**WARNING — 不可用**（`npm error could not determine executable to run`，本机无 codegraph 可执行）。

### commit 范围

- `[build] S3: flowService 三节点配置校验与结构化错误`：`src/services/flowService.js`、`src/http/routes/flows.js`（commit `0990399`）

### 完成记录

- Slice S3: complete (`0990399`, tests 126 pass / 3 fail = S4×3, zero legacy regression, codegraph sync unavailable)

### S3 完成记录与 req-gap/bug 处理

- Slice S3: complete (`0990399`, tests 129/126/3, PRD alignment ALIGNED)
- 对齐检查 3 项 UNCERTAIN 用户裁决（2026-07-17）：① 变量名 trim 后拒绝（REQ-FLOW-018 AC2 v1.1）；② expression 必填（REQ-FLOW-019 AC4 v1.1）；③ provider/options 拒绝路径接受 tech-design 层承诺不补签核测试。
- req-gap 补全：`088061e` [docs] REQ v1.1 + hash `036e30e2`；`60d355c` [test] 3 个新签核断言（红）+ signoff 补充签核。
- validator v1.1 实现：`dfa54cb` [build]（132/129/3，3 红为 S4 契约）。
- BUG-001（test-gap）：旧 E2E REQ-FLOW-015 因新校验契约变红（condition 无 expression 保存被合法 400），用户确认修 setup；`181802b` [test] 填入 "1 > 0"，flowEditor spec 9/9。
- 流程教训（留 REFLECT）：后端校验语义变化的 slice 验证必须包含受影响 E2E，仅跑 unit 会漏（S3 验证时未跑 E2E，BUG-001 迟一个环节才暴露）。

## Slice S4: execution-log

范围：execution_nodes 表、节点级执行记录持久化、7 天日志自动清理。实现文件：`src/db.js`（schema + 迁移 + resetDb）、`src/services/taskService.js`（写入 + 清理 + 节点查询）、`src/http/routes/executions.js`（详情 API nodes）、`src/http/server.js`（清理触发点）。**范围偏差一处（最小必要）**：`src/flowEngine/flowEngine.js` 的 `failRun` 把已累积 nodeRecords 挂到抛出错误上（`err.nodeRecords`）——引擎 fatal/fail 路径是 push 后 throw，不 attach 则 taskService 无法取得记录，"终止路径同样写入"硬契约不可达；错误消息与 `fatal:` 前缀不变，REQ-FLOW-007/025 旧契约保持绿。

**status 列语义取舍**：`record.error` 非空 → `"error"`，否则 → `"success"`。onError=ignore 降级路径 record.error 有原始错误信息，故记 `error`（错误信息入 error 列）——语义为"该节点底层执行是否出错"，与 flow 是否继续解耦，自洽。**output 列取舍**：仅 agent 节点（record.agent 存在）填充，取 outputVariables 首个值（agent 的 outputVariable 输出）；未配置 outputVariable 时为 NULL（record 不持原始 output，唯一持久来源是 outputVariables）。

### PRD → 代码 可追溯性表

| REQ 验收标准 | 实现位置 | 测试 | 状态 |
|---|---|---|---|
| REQ-FLOW-028 AC1：每次执行生成节点记录（nodeId/nodeName/inputVariables/outputVariables/branchTaken/error/attemptCount） | `taskService.insertExecutionNodes`：`runFlowEngine` 成功路径写 `result.nodeRecords`，catch 路径写 `err.nodeRecords`（fatal/fail 同样落库，含失败节点）；input/outputVariables JSON 快照 | 签核 `executionLog.test.js` 第 1 例（execution_nodes 表存在，红→绿）；scratch「成功路径」「condition branchTaken」「fatal 路径」（已删除） | COVERED |
| REQ-FLOW-028 AC2：agent 调用详情最小字段（prompt 截断 4000/output/model/provider/status/error/durationMs/attemptCount） | `insertExecutionNodes`：`record.agent` 展开 prompt（`slice(0, 4000)`）/model/provider/durationMs；status 由 record.error 推导；error 列 record.error；attemptCount 列 record.attemptCount；output 取 outputVariables 首值 | 签核 `executionLog.test.js` 第 2 例（PRAGMA 列检查，红→绿）；scratch「anthropic agent 详情 + prompt 截断 4000 + retries=0 attemptCount=1」（已删除） | COVERED |
| REQ-FLOW-028 AC3：写入 SQLite executions 关联表，与现有执行历史兼容 | `src/db.js` initSchema（新库）+ migrateSchema（旧库 `CREATE TABLE IF NOT EXISTS` 幂等）+ resetDb DROP 列表；executionId 索引 `idx_execution_nodes_execution` | 签核 `executionLog.test.js` 第 3 例（两表并存，红→绿）；旧签核 execution/flow 测试全套保持绿 | COVERED |
| REQ-FLOW-028 AC4：日志默认保留 7 天，到期自动清理 | `taskService.purgeExpiredExecutions(db, { retentionDays = 7, now })`：滚动 cutoff `startedAt < now - 7×24h`（ISO 字符串比较，严格小于）；单事务按序删 execution_nodes → logs → executions（executionId 子查询），返回删除计数 | 签核 `executionLog.test.js` 第 4 例（executions.startedAt 列存在，保持绿）；scratch「滚动 cutoff + 边界值保留 + 级联」「retentionDays 可配」（已删除） | COVERED |
| REQ-FLOW-028 AC5：清理实现方式在 tech-design 明确（§7：启动时 + 后台定时） | `src/http/server.js`：触发点 A `startServer` listen 回调启动即清理一次（Electron main 与 headless CLI 均经 startServer，reset:false 生产路径覆盖真实库）；触发点 B `cron.schedule("17 3 * * *")` 每日 03:17（非整点）——src 中原无 node-cron 调度引导，依任务指令在 startServer 注册；`stopServer` 销毁对应任务防进程悬挂；清理失败 try/catch 记日志不阻塞启动（Rule 4 Safe Defaults） | scratch「startServer 启动清理不炸且 server 可用；stopServer 后 cron 销毁」（已删除）；全套 132 测试无进程悬挂（cron 定时器随 stopServer 清理） | COVERED |
| REQ-FLOW-028 AC6：执行日志 API 字段与现有前端 Executions 详情页兼容 | `routes/executions.js`：`GET /api/executions/:id` 既有字段原样（展开 `...execution`），新增 `nodes` 数组（`listExecutionNodes`，input/outputVariables 解析回对象，按 rowid 升序=执行顺序） | 签核 `executionLog.test.js` 第 5 例（占位自指，保持绿）；旧签核 `task.test.js` REQ-SCHEDULE-003/BUG-012/BUG-015 详情字段断言保持绿；scratch「API nodes 且既有字段不变」（已删除） | COVERED |

补充约束遵守：debug 路径不写 execution_nodes/executions（scratch 验证 0 行，REQ-FLOW-017 保持绿）；凭证红线——prompt 列为引擎替换后文本，adapter apiKey 不进任何返回/落库路径，未引入新泄漏面；`resetTasks` 未扩展 execution_nodes 种子（非签核路径，范围纪律）。

### 验证结果

- 目标 3 个红契约全绿（executionLog.test.js 第 1/2/3 例），第 4/5 例保持绿。
- 全套业务测试 `npm run test:unit`：**132 tests / 132 pass / 0 fail**（基线 129 pass / 3 fail），旧测试零回归。
- scratch 验证 9/9 绿后已删除（`/scratch-s4/`，实现工具不持久化）：成功写入/字段完整、branchTaken、fatal 路径写入（status=error + attemptCount=2）、anthropic agent 详情 + prompt 截断 4000、debug 不写、purge 滚动 cutoff + 边界 + 级联、retentionDays 可配、API nodes 兼容、启动清理 + cron 生命周期。
- 实现期发现并修复一处自引入缺陷：`listExecutionNodes` 的 prepared statement 漏传 executionId 参数（`RangeError: Too few parameter values`），scratch 首轮暴露后修复。
- `npx codegraph sync`：**WARNING — 不可用**（`npm error could not determine executable to run`，与 S3 相同）。

### commit 范围

- `[build] S4: execution_nodes 持久化与 7 天日志清理`：`src/db.js`、`src/services/taskService.js`、`src/http/routes/executions.js`、`src/http/server.js`、`src/flowEngine/flowEngine.js`（最小必要偏差，见上）（commit `6f8e9e2`）

### 完成记录

- Slice S4: complete (`6f8e9e2`, tests 132/132, 3 红全绿零回归, 范围偏差 1 处已说明)

### S4 完成记录与 v1.2 处理

- Slice S4: complete (`6f8e9e2`, tests 132/132, PRD alignment MISALIGNMENT_FOUND(G1) 经用户裁决后闭环)
- v1.2 req-gap：`0111dd6` [docs] REQ-FLOW-028 AC1/AC2 语义明确 + hash `2585f81f`；`c785f4a` [test] 2 个新签核断言（红）；`4da8cc1` [build] 中止路径 err.nodeRecords + agent output 总是捕获（134/134）
- Slice S4: refactor pass done (`4da8cc1..45301b2`, tests 134/134 unchanged, no rollback)
- 接受的设计取舍（用户已签）：G2 成功路径写入失败改判 error（fail-visible）；execution_nodes.id 生成依赖"每 execution 只写一次"
- S5 拆分为 S5a（编辑器前端：6 个 E2E）与 S5b（执行日志 UI：1 个 E2E）

## Slice S5a: frontend-editor

范围：Flow Editor 三节点配置面板（Trigger outputVariables / Condition expression / Agent 六字段）、变量选择器（按上游节点分组、类型标签、插入 fullName、实时刷新）、画布 true/false 分支标识、保存前客户端校验、i18n 中英文。

实现文件：`src/renderer/components/flow/NodeConfigPanel.jsx`（三节点字段 + ErrorHandlingFields + 旧节点类型字段保持）、`src/renderer/components/flow/VariablePicker.jsx`、`src/renderer/components/flow/upstreamVariables.js`（上游变量分组推导：trigger flow-wide + 沿边回溯）、`src/renderer/components/flow/validateFlowNodes.js`（镜像 flowService v1.1 的客户端校验）、`src/renderer/components/flow/FlowCanvas.jsx`（端口标签 / 变量 chips / data-node-id / onFlowStateChange）、`src/renderer/pages/FlowEditor.jsx`（面板替换 + 校验接入）、`src/renderer/pages/FlowEditor.css`、`src/renderer/i18n/en-US.json`、`src/renderer/i18n/zh-CN.json`。

### PRD → 代码 可追溯性表

| REQ 验收标准 | 实现位置 | 测试 | 状态 |
|---|---|---|---|
| REQ-FLOW-018 AC1：Trigger 面板添加/编辑/删除输出变量 | `NodeConfigPanel.TriggerFields`：add-variable-button / 每行 name+type+defaultValue 输入 / remove-variable-button；编辑即写画布状态，Save 统一持久化 | 签核 `triggerConfig.test.cjs` 第 1 例（红→绿） | COVERED |
| REQ-FLOW-018 AC2：变量名 trim 非空、节点内唯一、类型四选 | `validateFlowNodes`（trim 非空 + Set 查重 + VARIABLE_TYPES allowlist）+ TriggerFields type 下拉仅四选项 | 签核 `triggerConfig.test.cjs` 第 2 例（红→绿）；API 侧 S3 已覆盖 | COVERED |
| REQ-FLOW-018 AC3：保存时前端校验阻止并显示错误；后端 400 展示 | `FlowEditor.handleSave`：校验失败不发请求，错误（path: message）写入 save-error 反馈区；后端 400 时 client.js 抛 message 同样展示 | 签核 `triggerConfig.test.cjs` 第 2 例（/variable name is required/i 可见 + 无成功反馈，红→绿） | COVERED |
| REQ-FLOW-018 AC4：变量定义持久化到 nodeList | `FlowCanvas.getFlowState` → PATCH nodeList；画布节点 chips 回显已声明变量 | 签核 `triggerConfig.test.cjs` 第 1 例（保存后变量名可见，红→绿） | COVERED |
| REQ-FLOW-018 AC5：删除变量后不再出现在下游选择器 | `upstreamVariables.getUpstreamVariableGroups` 从实时画布状态推导（onFlowStateChange 订阅），删除即消失 | 签核 `triggerConfig.test.cjs` 第 3 例（红→绿） | COVERED |
| REQ-FLOW-019 AC1：Condition 面板表达式输入框 | `NodeConfigPanel.ConditionFields`：condition-expression-input | 签核 `conditionConfig.test.cjs` 第 1 例（红→绿） | COVERED |
| REQ-FLOW-019 AC2：表达式支持变量选择器插入 fullName | ConditionFields + VariablePicker：caret 记录后插入裸 fullName（如 `n1.count`） | 签核 `conditionConfig.test.cjs` 第 4 例（红→绿） | COVERED |
| REQ-FLOW-019 AC3：画布 Condition 节点 true/false 两个输出端口标识 | `FlowCanvas.CustomNode`：`node-<id>-output-true/false` 文本标签 + 既有双 source Handle（30%/70%） | 签核 `conditionConfig.test.cjs` 第 2 例（红→绿）；旧 REQ-FLOW-015 handles 拖拽保持绿 | COVERED |
| REQ-FLOW-019 AC4：expression 必填（trim 非空），保存阻止并提示 | `validateFlowNodes`：condition 无 config 或 expression trim 为空 → "Expression is required"，handleSave 阻断 | 签核 `conditionConfig.test.cjs` 第 3 例（红→绿） | COVERED |
| REQ-FLOW-020 AC1：Agent 面板统一多行 prompt 文本框 | `NodeConfigPanel.AgentFields`：agent-prompt-textarea（rows=6） | 签核 `agentConfig.test.cjs` 第 1 例（红→绿） | COVERED |
| REQ-FLOW-020 AC2：prompt 变量选择器插入 {{fullName}} | AgentFields.insertVariable：caret 处插入 `{{fullName}}` | 签核 `agentConfig.test.cjs` 第 2 例（legacy agent 无 provider，离线 mock 路径不触达 SDK，红→绿） | COVERED |
| REQ-FLOW-020 AC3：provider/model/outputVariable/retries/onError 可配置 | AgentFields provider 下拉（空=mock / anthropic）+ model 下拉（codex/claude-code/claude-sonnet-5）+ 通用 outputVariable 输入 + ErrorHandlingFields | 签核 `agentConfig.test.cjs` 第 3 例（红→绿） | COVERED |
| REQ-FLOW-021 AC1：三节点均显示重试次数与失败时下拉 | `NodeConfigPanel.ErrorHandlingFields`：isRefinedType(trigger/condition/agent) 时渲染 Retries 数字输入 + On error 下拉 | 签核 `nodeErrorHandling.test.cjs` 第 1 例（红→绿） | COVERED |
| REQ-FLOW-021 AC2：retries 默认 1，可配 0 或正整数 | ErrorHandlingFields：`config.retries ?? 1`，min=0 step=1，parse 失败不落库 | 签核 `nodeErrorHandling.test.cjs` 第 2 例（红→绿） | COVERED |
| REQ-FLOW-021 AC3：onError 默认 fail | ErrorHandlingFields：`config.onError || "fail"` | 签核 `nodeErrorHandling.test.cjs` 第 3 例（红→绿） | COVERED |
| REQ-FLOW-021 AC4：保存后持久化到节点 config | handleSave PATCH nodeList；保存后字段值保持 | 签核 `nodeErrorHandling.test.cjs` 第 2/3 例（红→绿） | COVERED |
| REQ-FLOW-022 AC1：选择器按上游节点分组，组标题为节点名或 ID | `VariablePicker`：group-title = `node.data.label || node.id`；upstream = trigger（flow-wide）∪ 沿边回溯可达节点 | 签核 `variablePicker.test.cjs` 第 1 例（红→绿） | COVERED |
| REQ-FLOW-022 AC2：条目显示变量名与类型标签 | VariablePicker item：name span + type span（trigger 用声明 type，其余节点输出按契约为 string） | 签核 `variablePicker.test.cjs` 第 2 例（红→绿） | COVERED |
| REQ-FLOW-022 AC3：选中插入 fullName（按场景裸名或 {{}} 包裹） | VariablePicker.onSelect(fullName)，ConditionFields 裸插 / AgentFields {{}} 包裹 | 签核 `variablePicker.test.cjs` 第 3 例（红→绿） | COVERED |
| REQ-FLOW-022 AC4：上游删除/重命名后列表实时刷新 | groups 由 onFlowStateChange 推送的实时 nodes/edges 推导，无缓存 | 签核 `variablePicker.test.cjs` 第 4 例（红→绿） | COVERED |
| REQ-FLOW-026 AC4（E2E 侧）：删除变量后选择器实时刷新；下游保存不做强制阻断 | validateFlowNodes 不校验引用存在性（仅字段级），dangling 引用可保存 | 签核 `danglingReference.test.cjs` 第 1/2 例（红→绿） | COVERED |

### spec 定位器调整（signoff 决策 6 授权）

- 已在 `[test] 0bc9a53` 完成：6 个 spec 从 test-author 骨架适配为 electron fixture + API 播种 + UI 导航；行为断言语义不变；定位器 scoped 到变量选择器下拉避免 strict 冲突；新增 `tests/e2e/helpers/flowEditor.cjs` 共享 helper（FLOW_SAVE_SUCCESS/ADD/REMOVE_VARIABLE_BUTTON/openFlowInEditor/addNodeFromPalette/nodeByIndex/nodeById/clickSave/saveFlow/openVariablePicker）。
- 本切片实现阶段未再修改任何 spec（0 处新增调整）；所需 testid/label 全部通过实现代码对齐 spec。

### 与 UX 原型的已知偏差（codex-harness-desktop/ux/flow-editor.html，本 story 无 ux/）

1. 原型 Condition 节点端口无文字标识；实现增加 true/false 文本标签（REQ-FLOW-019 AC3 硬性要求，原型为上一 story 产物未覆盖）。
2. 原型属性面板无变量编辑器与变量选择器（本 story 新功能）；下拉/分组/条目样式按设计系统 tokens 自构，分组样式/图标观感留 REFLECT 人工验收。
3. 画布节点 body 新增输出变量 chips（原型无），用于声明回显。
4. Trigger 面板不再显示旧通用 "Output variable" 单字段（被 outputVariables 列表取代，契约语义变化）；其余节点类型该字段保持原样。
5. 面板字段 label 全面 i18n 化（原型为硬编码英文静态稿）。

### 实现期发现并修复的缺陷

1. **Delete 快捷键误删节点**：window 级 keydown 未排除可编辑目标，输入框聚焦时 Playwright fill("")（产生 Delete keydown）删除了选中节点 → editable target guard（FlowEditor.jsx）。
2. **连线拖拽失效（自引入）**：为端口标签给 `.flow-node-custom` 加 `position: relative` 使其成为 handles 包含块，`overflow: hidden` 裁剪了负偏移的 React Flow handles → REQ-FLOW-012/013/015 红；改回 static（标签改以 .react-flow__node 包裹层为定位基准）后三例复绿，CSS 注释记录该约束。

### 验证结果

- 目标 6 个 spec：**19/19 绿**。
- 全量 E2E `npm run test:e2e`（rebuild:electron + 全部 spec）：**62 pass / 4 failed**；4 个失败为 S5b 范围 `execution/.../e2e/executionLog.test.cjs`（test-author 原始骨架，未适配 electron fixture，红色契约待 S5b）。旧 43 个 E2E 零回归。
- flaky 标注：REQ-FLOW-013（delete node and edges）在一次全量并行运行中因 "element is not stable" 超时失败一次；隔离运行与后续全量重跑均绿，判定为并行负载抖动，非回归。
- `npm run test:unit`：**134/134 绿**（一次 `npm rebuild` 网络瞬断重试后通过）。
- 环境教训（留 REFLECT）：`test:unit`（rebuild:node）与 `test:e2e`（rebuild:electron）互相覆盖 better-sqlite3 ABI，单独跑 `npx playwright test` 而不 rebuild 会导致全部 DB 调用 400。
- `npx codegraph sync`：**WARNING — 不可用**（`npm error could not determine executable to run`，与 S3/S4 相同）。

### commit 范围

- `[test] S5a`（先行，已完成）：`0bc9a53` — 6 个 spec 骨架适配 + flowEditor helper。
- `[build] S5a`：`217abb5` — `src/renderer/components/flow/{FlowCanvas,NodeConfigPanel,VariablePicker,upstreamVariables,validateFlowNodes}.jsx/js`、`src/renderer/pages/FlowEditor.{jsx,css}`、`src/renderer/i18n/{en-US,zh-CN}.json`。

### 完成记录

- Slice S5a: complete (`0bc9a53` + `217abb5`, E2E 62/4（4=S5b 红契约）, unit 134/134, 旧 43 E2E 零回归, codegraph sync unavailable)

### S5a 完成记录与 BUG-002 处理

- Slice S5a: complete (`0bc9a53` [test] spec 适配 + `217abb5` [build] 实现, 目标 19/19 E2E 绿, 全量 62 pass/4 fail(4=S5b 骨架), 旧 43 零回归, PRD alignment ALIGNED)
- Slice S5a: refactor pass done (`217abb5..5dd963f`, unit 136/136 + 目标 36 E2E unchanged, no rollback)
- BUG-002（code-defect）：S5a 对齐发现 System Prompt 在 anthropic 路径静默无效；用户确认。`5d6b0fb` [test] 回归测试（红/绿各一）、`4bd5cfd` [bugfix] 顶层 systemPrompt 回落映射（options 优先）。unit 136/136、flowEditor 9/9。
- UX 偏差（留 feel-signoff/REFLECT）：condition 端口 true/false 文字标签（REQ 要求，原型未覆盖）、变量编辑器/选择器为原型外自构 UI、节点变量 chips、Trigger 面板移除旧单 outputVariable 字段、面板 label 全面 i18n 化。
- 观察项（留 REFLECT）：REQ-FLOW-013 并行负载偶发 "element is not stable" flake；REQ-VERSION 头按"断言集变化才 bump"口径，E2E spec 保持 v1 旧 hash。

## Slice S5b: frontend-execution-log

范围：Executions 详情页节点级执行日志 UI（REQ-FLOW-028 E2E 侧）。实现文件：`src/renderer/components/task/ExecutionNodeList.jsx`（新建：节点卡片 + agent 调用详情区块）、`src/renderer/components/task/ExecutionDetail.jsx`（新增 Nodes 标签页并设为默认；按 execution.flowId 拉取 flow nodeList 推导节点类型）、`src/renderer/pages/Executions.jsx`（选中后经详情 API 拉取含 nodes 的执行详情，完成前回落列表行，id 守卫防串扰）、`src/renderer/index.css`（节点卡片样式，沿用设计系统 tokens）、`src/renderer/i18n/{en-US,zh-CN}.json`（12 个新文案键）。

**空值呈现取舍**：字段标签一律渲染，空值（NULL/空对象/空字符串）以 `—` 占位符呈现（与既有 `formatDate`/`formatDuration` 的 `—` 惯例一致）。这样 mock agent 路径（tech-design §5.6：不产 agent 详情，prompt/model 等列为 NULL）的执行记录也能展示 agent 调用详情区块的字段标签，诚实表达"该 agent 节点无已记录的调用详情"。

**agent 节点识别取舍**（二选一中的方案一：UI 渲染标签 + 占位符，不做 db 播种）：优先用 flow `nodeList` 的节点类型判定（`ExecutionDetail` 按 flowId 调 `GET /api/flows/:id`，构建 nodeId→type 映射）；flow 已删除或类型缺失时回落到记录字段启发式（prompt/output/model/provider/durationMs 任一非空即视为 agent 节点，覆盖 anthropic 路径真实详情）。不新增后端字段、不触达 db。

### PRD → 代码 可追溯性表

| REQ 验收标准 | 实现位置 | 测试 | 状态 |
|---|---|---|---|
| REQ-FLOW-028 AC1（E2E 侧）：执行记录含每节点 nodeId/nodeName/inputVariables/outputVariables/branchTaken/error/attemptCount | `ExecutionNodeList.ExecutionNodeCard`：节点卡片头（nodeName + nodeId + status 徽章）+ 五字段区（Input/Output variables JSON、Branch、Error、Attempts），空值 `—` | 签核 `executionLog.test.cjs` 第 2 例（/input/i、/output/i 可见，红→绿） | COVERED |
| REQ-FLOW-028 AC2（E2E 侧）：agent 调用详情 prompt/output/model/provider/status/error/durationMs/attemptCount | `ExecutionNodeCard` agent 区块（`data-testid="execution-node-agent"`）：Prompt/Output/Model/Provider/Status/Duration 六字段 + 卡片级 Error/Attempts；isAgentNode 类型判定见上 | 签核 `executionLog.test.cjs` 第 3 例（/prompt/i、/model/i 可见，红→绿） | COVERED |
| REQ-FLOW-028 AC6：执行日志 API 字段与现有前端 Executions 详情页兼容 | `Executions.jsx`：详情经 `useExecution(selectedId)` 拉取 `{...execution, nodes}`；既有 logs/variables/output 三标签页原样保留（旧签核契约 flowRun「execution detail shows Logs / Variables / Output tabs」保持绿） | 签核 `executionLog.test.cjs` 第 1 例（execution-list 可见，红→绿）；旧 flowRun/dashboard E2E 保持绿 | COVERED |
| REQ-FLOW-028 AC4（UI 呈现侧）：超过 7 天的执行记录不再显示 | 本切片无额外前端工作：清理由后端启动 + 每日 cron 保证（S4）；列表数据源 `listExecutions` 只返回未清理记录；spec 在干净 userData 环境断言 /7 days ago/i 不可见 | 签核 `executionLog.test.cjs` 第 4 例（红→绿） | COVERED |

### spec 定位器调整（signoff 决策 6 授权，`[test] fd307d1`）

1. `page.goto("/executions")` → 侧栏导航 `nav-executions` 点击（Electron 单窗口 HashRouter，无独立 URL）；先点 `nav-dashboard` 再点 `nav-executions` 强制 Executions 页重挂载，保证 API 播种的执行进入列表（列表仅在挂载时拉取一次）。
2. `page.getByTestId("execution-item")` → 沿用旧契约 testid `execution-row`（locators.EXECUTION_ROW）；未新增重复 testid（单元素单 data-testid 属性）。
3. 文本断言 scope 到 `[data-testid='nodes-panel']` 并加 `.first()`：多节点卡片各有一份 Input/Output 标签会触发 strict mode 冲突；正则 `/input/i` `/output/i` `/prompt/i` `/model/i` `/7 days ago/i` 原文保留，断言语义不变。
4. 播种方式：test-author 骨架无播种 → 按离线原则经 REST API 播种（trigger+condition / trigger+mock-agent flow → POST /api/executions → 轮询详情 API 至 status 落定且 nodes 非空），不触达真实 SDK；mock agent 不产 agent 详情，故第 3 例依赖 UI 对 agent 类型节点渲染字段标签 + 占位符（见上）。
5. 新增文件内 helper（openExecutionsPage / waitForExecutionNodes / getExecutionDetail），未改共享 helper；REQ-VERSION 头保持 `v1-hash:faea1df8`（断言集未变）。

### 实现期发现并修复的缺陷

1. **vite import 解析失败（自引入）**：`ExecutionDetail.jsx` 位于 `components/task/`，flows api 应为 `../../api/flows.js`（误写 `../api/flows.js`），首轮 E2E 全部因 vite overlay 白屏失败；修复后 4/4 绿。

### 验证结果

- 目标 spec：**4/4 绿**（`npx playwright test tests/capabilities/flow-orchestration/execution/`）。
- 全量 E2E `npm run test:e2e`：**66/66 绿**（S5a 基线 62 pass / 4 fail = 本切片 4 个红契约；旧 62 个零回归，含 flowRun 的 execution detail 三标签页契约与 dashboard recent executions）。
- `npm run test:unit`：**136/136 绿**（本切片未触及后端/引擎）。
- `npx codegraph sync`：**WARNING — 不可用**（`npm error could not determine executable to run`，与 S3/S4/S5a 相同）。

### commit 范围

- `[test] S5b`：`fd307d1` — `tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/e2e/executionLog.test.cjs`（electron fixture 适配，先行红色契约）。
- `[build] S5b`：`4d78bea` — `src/renderer/pages/Executions.jsx`、`src/renderer/components/task/{ExecutionDetail,ExecutionNodeList}.jsx`、`src/renderer/index.css`、`src/renderer/i18n/{en-US,zh-CN}.json`。

### 完成记录

- Slice S5b: complete (`fd307d1` [test] + `4d78bea` [build], 目标 4/4 E2E 绿, 全量 E2E 66/66, unit 136/136, 旧 62 E2E 零回归, codegraph sync unavailable)

### S5b 完成记录

- Slice S5b: complete (`fd307d1` [test] spec 适配 + `4d78bea` [build] 实现, 目标 4/4 绿, 全量 E2E 66/66, PRD alignment ALIGNED)
- Slice S5b: refactor pass done (`4d78bea..c8cedea`, unit 136/136 + 全量 E2E 66/66 unchanged, no rollback)
- 取舍记录：空值字段标签 + `—` 占位；agent 节点识别 = flow nodeList 类型判定为主 + 记录字段启发式兜底；mock agent 执行显示 agent 区块占位符（离线约束下的诚实呈现，非硬凑——对齐子代理裁决）；Nodes 取代 Logs 成默认 tab（观感留 feel-signoff）。

## BUILD 总结（2026-07-18）

- 全部 6 切片完成，每切片四道：实现 → 父代理独立验证 → PRD 对齐子代理 → refactor 子代理。
- 最终状态：**unit 136/136，E2E 66/66**，旧契约（codex-harness-desktop）零回归。
- req-gap：v1.1（变量名/表达式 trim、expression 必填）、v1.2（中止执行节点记录、output 总是捕获），均经用户签核并走完 [docs]→[test]→[build] 流程。
- bug：BUG-001（test-gap）、BUG-002（code-defect）均闭环。
- 留 REFLECT：REQ-FLOW-013 负载 flake 观察项；REQ-VERSION 头 bump 口径；codegraph CLI 不可用（autoSync 配置下仅警告）；unit/e2e rebuild ABI 互覆的环境坑；condition+ignore 终止语义等 5 条 S2 观察项。
