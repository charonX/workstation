# Build Progress — 2026-08-02-builtin-agent

> 由 /implementer 维护。父代理调度、子代理实现、父代理验证。

## 切片计划（8 slices，依赖序）

| Slice | 内容 | REQ-ID | PRD 里程碑 | 状态 |
|---|---|---|---|---|
| 1 | 配置与身份（供应商/key/身份 + session-config IPC） | REQ-AGENT-001~004 | M1 | complete |
| 2 | agent 进程与对话内核（看门狗/回路/LLM 错误） | REQ-AGENT-005~007 | M1 | complete |
| 3 | 会话存储与恢复（空间模型/恢复/重置/压缩） | REQ-AGENT-008~011 | M1 | complete |
| 4 | 工具面（riskLevel 注入 + release 拒绝） | REQ-AGENT-012~013 | M1 | complete |
| 5 | 路由与飞书入口（agent 优先 + 群聊语义） | REQ-AGENT-017~018 | M1 | complete |
| 6 | 命令直通 | REQ-AGENT-021~022 | M3 | complete |
| 7 | 卡片流式 | REQ-AGENT-019~020 | M2 | complete |
| 8 | 绑定与确认 | REQ-AGENT-014~016 | M3 | complete |

依赖：1→2→3→4→5→{6,7,8}（7 另依赖 4 的下发工具面）。

## Slice 0：断言回写（签核收尾）

将 12 个业务测试骨架中的 `TODO: HUMAN ASSERTION` 占位回写为真实断言代码（依据 signoff.md 20 项决策 + requirements.md 验收标准 + tech-design 接口契约），头部保持不变（REQ-TRACE/REQ-VERSION/CAPABILITY-TRACE/ENTITY-TRACE/ASSERTIONS-SIGNED: true）。

- 状态：**complete**（commit 2736cc23，69 断言块；父代理验证：commit 仅含 12 测试文件、agentConfig 快速失败红因正确；test:unit 508/439 既有全绿零回归）
- 附加修复：骨架 `stopServer(server)` → `stopServer({ server })` 挂死 bug（5 文件）

## PRD→代码 可追溯性表

（每个 slice 完成后由子代理追加，父代理审查）

### Slice 1：配置与身份（REQ-AGENT-001~004）

- 状态：**complete**（commit e76a0ba；agentConfig.test.js 6 it + systemPrompt.test.js 5 it 全绿；既有 439 零回归；其余 10 个新测试文件红 = 后续 slice，抽样：userBinding E-AUTH-NOT-BOUND 缺绑定状态机、agentRoute 缺三纯函数路由、slashCommands 缺命令模块直通）

| PRD 意图项 | 实现文件 | 测试文件 | 覆盖 |
|---|---|---|---|
| REQ-AGENT-001 AC1 供应商枚举 {deepseek, moonshotai, moonshotai-cn} + 切换校验 key | src/services/settingsService.js（AGENT_PROVIDERS / saveAgentConfig）、src/http/routes/settings.js | agentConfig.test.js「供应商枚举与保存」「key 仅非空校验」 | COVERED |
| REQ-AGENT-001 AC2 key 经 safeStorage 加密；settings.json 无明文；不进日志/IPC | src/services/secretStore.js（可注入后端：生产 safeStorage 由 src/main/main.js 注入，测试 fake）、src/services/settingsService.js | agentConfig.test.js「供应商枚举与保存」（断言 settings.json 无明文 key） | COVERED（测试环境 fake 后端；真实 safeStorage 接线在 main.js，人工验收） |
| REQ-AGENT-001 AC3 key 仅非空（前缀不校验）→ E-CONFIG-INVALID | src/services/settingsService.js（saveAgentConfig 校验） | agentConfig.test.js「key 仅非空校验」 | COVERED |
| REQ-AGENT-001 AC4 测试连接失败透传 E-AGENT-LLM-FAIL、不阻止保存 | src/http/routes/settings.js（POST /api/settings/agent/test-connection，fetch 最小校验请求） | agentConfig.test.js「测试连接」 | COVERED |
| REQ-AGENT-001 AC5 配置状态可查（configured + provider） | src/services/settingsService.js（loadAgentConfig 只读视图，不外泄 key）、src/http/routes/settings.js（GET /api/settings/agent） | agentConfig.test.js「配置状态可查」 | COVERED |
| REQ-AGENT-002 AC1 未配 key 对话 → E-AGENT-NO-KEY 引导、不启动会话 | src/services/agentRouter.js（createAgentRouter：命令识别 → key 检查 → reject E-AGENT-NO-KEY）、src/db.js（agent_sessions 表存在，供「不创建会话行」断言） | agentConfig.test.js「未配置 key 时 agent 对话回复 E-AGENT-NO-KEY」 | COVERED |
| REQ-AGENT-002 AC2 斜杠命令未配 key 照常可用（先于 key 检查） | src/services/agentRouter.js（parseSlashCommand 直通 action:"command"） | agentConfig.test.js「斜杠命令在未配 key 时照常可用」 | COVERED |
| REQ-AGENT-003 AC1 内置 system prompt 恒注入（身份+工具面+行为规则） | src/services/agentSystemPrompt.js（BUILT_IN_SYSTEM_PROMPT：身份/工具面/授权边界/需确认/流式汇报/查询优先） | systemPrompt.test.js「内置 system prompt 恒注入」 | COVERED |
| REQ-AGENT-003 AC2 内置身份经 session-config 在会话创建/配置变更时下发 | src/services/agentService.js（createSession → session-config { sessionKey, provider, model, keyRef, systemPrompt }；内存版 IPC 快速路径 sent/acks） | systemPrompt.test.js「内置 system prompt 恒注入」（ipc.sent 断言） | COVERED |
| REQ-AGENT-003 AC3 内置身份不含 secret（key 永不在 system prompt） | src/services/agentService.js + agentSystemPrompt.js（systemPrompt 仅由身份文本构建） | systemPrompt.test.js「内置身份不含 secret」 | COVERED |
| REQ-AGENT-004 AC1 自定义身份 ≤2000 字符可空；超长 E-CONFIG-INVALID | src/services/settingsService.js（AGENT_IDENTITY_MAX_LEN 校验） | systemPrompt.test.js「自定义身份保存与校验」 | COVERED |
| REQ-AGENT-004 AC2 保存后 session-config 热更新存量会话（config-ack），provider/key 未变不重建 | src/services/agentService.js（broadcastConfigUpdate：re-send session-config + config-ack 回执，sessionRef/keyRef 不变）、src/http/routes/settings.js（PUT 保存后广播） | systemPrompt.test.js「保存后 session-config 热更新存量会话」 | COVERED |
| REQ-AGENT-004 AC3 内置在前、自定义在后拼接顺序固定 | src/services/agentSystemPrompt.js（buildSystemPrompt 拼接） | systemPrompt.test.js「内置在前、自定义在后拼接顺序固定」 | COVERED |
| PRD §6 操作流步骤 1（Settings > Agent 选择供应商/粘贴 key/保存 → keychain + 已配置状态） | src/http/routes/settings.js + settingsService.js + secretStore.js | agentConfig.test.js（供应商枚举/配置状态可查） | COVERED（Settings UI 页面属 E2E 范围，story 无 DESIGN 原型，API seam 已覆盖） |
| PRD §6 操作流步骤 2（自定义身份保存生效到所有对话空间） | src/services/agentService.js（广播热更新）+ settingsService.js | systemPrompt.test.js「保存后 session-config 热更新存量会话」 | COVERED |
| PRD §7 输入验证：供应商选择（枚举必选，切换校验对应 key） | settingsService.js saveAgentConfig（provider ∈ AGENT_PROVIDERS + apiKey 非空成对校验） | agentConfig.test.js | COVERED |
| PRD §7 输入验证：API key 仅非空（前缀不校验），可测试连接 | settingsService.js + routes/settings.js test-connection | agentConfig.test.js「key 仅非空校验」「测试连接」 | COVERED |
| PRD §7 输入验证：自定义身份 ≤2000 可空 | settingsService.js（AGENT_IDENTITY_MAX_LEN） | systemPrompt.test.js「自定义身份保存与校验」 | COVERED |
| PRD §8 错误状态：E-CONFIG-INVALID（供应商/key/身份校验失败） | settingsService.js（throw { code: "E-CONFIG-INVALID" }）、routes/settings.js（400 + code） | agentConfig.test.js「key 仅非空校验」、systemPrompt.test.js「自定义身份保存与校验」 | COVERED |
| PRD §8 错误状态：E-AGENT-NO-KEY（未配置 key 对话引导） | agentRouter.js（reject + 引导文案「请在设置中配置 Agent API key」） | agentConfig.test.js「未配置 key 时 agent 对话回复 E-AGENT-NO-KEY」 | COVERED |
| PRD §8 错误状态：E-AGENT-LLM-FAIL（测试连接失败透传供应商原因） | routes/settings.js handleAgentTestConnection（提取 error.message） | agentConfig.test.js「测试连接」 | COVERED |
| 签核决策 5：key 不落 settings.json 明文 | secretStore.js（fake 混淆/safeStorage 密文）+ settingsService.js（仅存 apiKeyEncrypted） | agentConfig.test.js（settings.json 明文断言） | COVERED |
| 签核决策 2/3/4/7：供应商枚举/key 非空/身份拼接/命令未配 key 可用 | 见上各行 | 见上各行 | COVERED |

GAP 说明（本 slice 范围外，后续 slice 或 REFLECT 处理）：
- 真实 safeStorage 生产验证（Linux 无钥匙串降级路径）→ 人工验收/REFLECT。
- Settings Agent 区 UI（E2E）→ story 无 DESIGN 原型，test-plan.md 已显式接受 API seam 覆盖。
- session-config 到真实子进程的传输与 config-ack 真实回执 → Slice 2（REQ-AGENT-005/006）接 IPC。
- **【PRD 对齐缺口 1，登记于 2026-08-03】凭证变更不推送存量会话（tech-design 数据流 7）**：saveAgentConfig 只广播 identity 变更；provider/key 变更后存量会话仍持旧凭证（重启自愈）。不违反已签 REQ-AGENT-004 AC2（只约束"未变不重建"）。→ **Slice 2 实现 session-config 重建路径时补全**（新 key 注入 + 重建）。

### Slice 1 验证记录

- PRD 对齐子代理：**ALIGNED**（23 行追溯表逐条核实；缺口 1 登记上表；卫生项 2-5 移交 refactor）
- refactor 子代理：**REFACTORED**（commit 026debf；GET 剥离密文 / 注释 / 提示拆分 / chmod 0o600；父代理再验证 450/58 与基线一致、零测试文件）
- 遗留设计问题（/review 或人）：通用 PATCH /api/settings 可绕过加密写 agent 区（既有通用行为）；供应商枚举双真源（AGENT_PROVIDER_ENDPOINTS vs AGENT_PROVIDERS）；provider-only 提示不对称

### Slice 2 验证记录（2026-08-04 补）

- PRD 对齐子代理：**MISALIGNMENT_FOUND** → 3 缺口 + 1 接线 UNCERTAIN，人拍板处置：
  1. REQ-AGENT-005 AC4 缓存重投 → **就地补全 REQ**（restarting 拒绝并提示稍后，[docs] commit + hash 4ed3c67b + 12 测试头更新）
  2. creds 重建零断言 → **补自动化断言**（5d1efe72 [test]，2 个 it：重建路径 + 相同值不重建，转绿）
  3. broadcastConfigUpdate 无变更检测 → **fix 落地**（f7c54e2 [build]，按会话当前值比较）
  - UNCERTAIN：agentService 生产接线（createAgentService().start()）→ **归 Slice 5**
- refactor 子代理：**REFACTORED**（f5d69f6，createSerialQueue/hotUpdateSystemPrompt/emitErrorEvent/killChild/rebuildSession 抽取；465/45 逐名一致；父代理再验证零测试文件）
- 遗留设计问题（/review 或人）：worker 新建会话 key 未注册 redact 集合（无泄漏但覆盖不完整）；session.rebuilt 只写不读（后续 slice 预留）；主进程/worker 的 sizeLimit 与 key 清洗正则跨进程重复是有意保留（ADR-014 隔离）；sendPing kill 前置判断行为等价

### Slice 2：可追溯性表（REQ-AGENT-005~007）

- 状态：**complete**（commit 780733b/f7c54e2/f5d69f6；验证记录见上节）

| PRD 意图项 | 实现文件 | 测试文件 | 覆盖 |
|---|---|---|---|
| REQ-AGENT-005 AC1 spawn 子进程 + 就绪回 ready | src/services/agentService.js（createProcessAgentService：spawn/H1 入口解析：开发 node 源码入口 / 打包 ELECTRON_RUN_AS_NODE + asar bundle）、src/agent/worker.js（入口即发 ready） | agentProcess.test.js「spawn 后子进程回 ready」 | COVERED |
| REQ-AGENT-005 AC2 心跳超时/exit（任意退出码）→ 看门狗自动重启 | agentService.js（child exit 监听 + 心跳 ping/pong 2s/6s 超时判定 + 重启退避 150ms + 连续崩溃 ≥5 放弃） | agentProcess.test.js「心跳超时/exit → 看门狗自动重启」（kill → 第二次 ready + 新 pid） | COVERED |
| REQ-AGENT-005 AC3 重启后按 agent_sessions 引用 + JSONL 恢复（SessionManager.open），只丢半条流式消息 | worker.js（session-config 按 sessionRef 路径：文件存在 → SessionManager.open；不存在 → create + setSessionFile 稳定命名）、agentService.js（ready 后重发存量会话 session-config） | agentProcess.test.js「重启后会话按 agent_sessions + JSONL 恢复」（sessionRef 不变 + 崩溃前消息仍在 JSONL） | COVERED |
| REQ-AGENT-005 AC4 重启期间 prompt → session-error {code:"restarting"}，就绪后重投 | agentService.js（kill/exit 即置 restarting 态；prompt 非 ready 拒绝 restarting；就绪后重发配置 + 重投成功） | agentProcess.test.js「重启期间 prompt 返回 restarting，就绪后重投」 | COVERED |
| REQ-AGENT-005 AC5 子进程 stderr 进主进程日志且不含 key | agentService.js（logs 收集 stderr + 出站日志只记类型/sessionKey）、worker.js（stderr redact 掉 keySecrets 值） | agentProcess.test.js「子进程 stderr 进主进程日志且不含 key 值」 | COVERED |
| REQ-AGENT-006 AC1 prompt → PI AgentSession 处理（fauxProvider 注入）→ 回复经 session-event 回传 | worker.js（session.prompt + 事件映射：message_update.assistantMessageEvent → text_delta/text_end）、agentService.js（in-memory 内核 + 真实 IPC 转发） | agentDialogue.test.js「prompt → faux LLM → 回复经 session-event 回传」+ agentProcess（真实回路） | COVERED |
| REQ-AGENT-006 AC2 同空间排队串行（streamingBehavior: followUp）；跨空间并行 | worker.js（每 session 串行队列 + PI followUp）、agentService.js（in-memory 每空间 promise 链） | agentDialogue.test.js「同空间并发 prompt 排队串行；跨空间并行互不阻塞」 | COVERED |
| REQ-AGENT-006 AC3 流式增量事件（text_delta）按序回传 | worker.js（事件按 PI 流式序转发）、agentService.js（enforceSizeLimit 保序直传） | agentDialogue.test.js「流式增量事件（text_delta）按序回传」 | COVERED |
| REQ-AGENT-006 AC4 工具调用事件（tool_execution_*）含工具名与状态 | worker.js（tool_execution_start/end → name/status）、agentService.js（透传） | agentDialogue.test.js「工具调用事件含工具名与状态」 | COVERED |
| REQ-AGENT-006 AC5 单条 IPC ≤ 256KB；超限截断 + 降级标记 | agentService.js（enforceSizeLimit：text_end.content/text_delta.delta 截断 + truncated）、worker.js（limitSize 同规则） | agentDialogue.test.js「单条 IPC 消息 ≤ 256KB，超限截断或降级文件引用」 | COVERED（出站事件侧；入站 prompt 侧未强制，见 GAP 说明） |
| REQ-AGENT-007 AC1 供应商失败 → 结构化错误消息，会话存活可继续，进程不崩 | agentService.js（in-memory emitError + 事件即结果语义）、worker.js（prompt catch → session-error E-AGENT-LLM-FAIL + prompt-result ok:false） | agentDialogue.test.js「供应商失败 → 错误消息回传，会话存活可继续」 | COVERED |
| REQ-AGENT-007 AC2 重试语义（408/409/429/5xx 重试、尊重 retry-after）；耗尽后错误路径 | agentService.js（MAX_LLM_ATTEMPTS=3；retryable 状态集；retryAfter 封顶 300ms）；真实路径由 pi 内置 RetrySettings 生效 | agentDialogue.test.js「重试语义（408/409/429/5xx）与耗尽路径」 | COVERED（in-memory 内核自持重试；真实 PI 路径内置重试未注入失败场景——faux 不失败） |
| REQ-AGENT-007 AC3 错误响应含用户文案与内部错误码（区分业务/系统） | agentService.js（error 事件 { code, reason, userMessage }；userMessage ≠ code） | agentDialogue.test.js「错误响应含用户文案与内部错误码」 | COVERED |
| PRD §6 数据流 1（消息对话 happy path：会话分发 → IPC prompt → LLM → 流式事件回传） | agentService.js + worker.js（真实链路） | agentDialogue + agentProcess（集成） | COVERED（飞书入口/卡片渲染属 Slice 5/7） |
| PRD §6 数据流 6（看门狗重启：exit → 重启 → 按引用 + JSONL 重建） | agentService.js + worker.js | agentProcess.test.js「重启后会话按 agent_sessions + JSONL 恢复」 | COVERED |
| PRD §6 数据流 7（配置变更：provider/key 变更 → 存量会话重建 + 新 key 注入）【GAP 补全】 | agentService.js（broadcastConfigUpdate：identity 仅热更新 / provider+key 重建 sessionRef 换代 + 新 key 注入）、src/http/routes/settings.js（handleAgentConfigSave 传 provider/apiKey）、worker.js（session-config credsChanged → dispose + 重建） | systemPrompt.test.js（identity 热更新不重建，回归）+ 手工验证（重建换代/新 key 注入/config-ack） | COVERED（无独立业务断言，GAP 登记于 Slice 1 已注明补全方式；手工验证脚本见 slice 提交说明） |
| PRD §8 错误状态：E-AGENT-LLM-FAIL（透传供应商错误，会话可继续） | agentService.js + worker.js | agentDialogue.test.js（REQ-AGENT-007 三例） | COVERED |
| PRD §8 错误状态：E-AGENT-RUNTIME（PI 运行时异常 → 错误回复 + 会话可重建） | worker.js（session-config 失败 → session-error E-AGENT-RUNTIME；agentService 看门狗给弃 → E-AGENT-RUNTIME） | 无独立断言（看门狗重启覆盖重建路径） | PARTIAL（结构化消息已实现；会话重建按钮/UI 属后续 slice） |
| 签核决策 14（看门狗 exit/心跳 → 重启；恢复只丢半条；restarting 缓存重投） | 见 AC2/AC3/AC4 行 | agentProcess.test.js | COVERED |
| 签核决策 15（同空间排队串行、跨空间并行；IPC 单条 ≤256KB） | 见 AC2/AC5 行 | agentDialogue.test.js | COVERED |
| 签核决策 5（key 不落日志/IPC 会话文件） | worker.js（redact + stdout 协议纪律 + key 仅内存）、agentService.js（日志只记类型） | agentProcess.test.js「stderr 不含 key」+ systemPrompt.test.js「systemPrompt 不含 key」 | COVERED |
| 实现者测试缝契约：ModelRuntime.create async + authPath 重定向 + SettingsManager.inMemory + fauxProvider 注入 + streamingBehavior followUp | worker.js（authPath=agent-home/auth.json、SettingsManager.inMemory()、OPC_AGENT_FAUX seam、followUp） | agentProcess/agentDialogue（真实 PI SDK + faux 零网络） | COVERED |
| H1 打包 spawn 路径（asar + ELECTRON_RUN_AS_NODE） | vite.worker.config.js（agent-worker bundle 进 .vite/build）+ forge.config.js（build 入口）+ agentService.js（Electron 检测 → execPath + bundle） | 无（打包冒烟属 QA） | PARTIAL（接线完成；打包产物冒烟待 QA 验证） |

GAP 说明（本 slice 范围外，后续 slice 或 REFLECT 处理）：
- 入站 prompt 侧 256KB 限制未强制（出站事件侧已截断；飞书输入天然 ≤150KB，入站超限由通道层兜底）。
- 真实供应商（deepseek/kimi）凭证注入（setRuntimeApiKey）为 best-effort 实现，未注入失败场景测试（faux seam 覆盖对话回路；真实凭据联调待 QA）。
- agent_sessions 表读写（sessionStore）与 JSONL 恢复的 SQLite 侧 → Slice 3（REQ-AGENT-008/009）。
- cancel / reset-session IPC 消息未实现（Slice 3/8 接入）。
- 打包产物（asar + ELECTRON_RUN_AS_NODE + ESM worker 入口）冒烟 → QA（H1 已验证 asar require 可用，worker bundle 全链路未跑）。

### Slice 3：会话存储与恢复（REQ-AGENT-008~011）

- 状态：**complete**（sessionStore.test.js 7 it + sessionRestore.test.js 2 it 全绿；既有 465 零回归；其余 6 个新测试文件红 = 后续 slice，抽样：toolSurface 缺工具面注入、agentRoute 缺三纯函数路由、confirmation 缺确认状态机）

| PRD 意图项 | 实现文件 | 测试文件 | 覆盖 |
|---|---|---|---|
| REQ-AGENT-008 AC1 agent_sessions 表结构（spaceKey 唯一/sessionRef/createdAt/lastActiveAt/summaryRef）；SQLite 为真相、注册表为缓存 | src/db.js（DDL，Slice 1 落地）、src/services/sessionStore.js（createSessionStore：getOrCreate/get/list/reset/updateSummaryRef/updateSessionRef/onReset） | sessionStore.test.js「agent_sessions 表结构与 spaceKey 唯一」 | COVERED |
| REQ-AGENT-008 AC2 空间首次对话 → 建表行 + 创建 PI 会话（JSONL 落自定义目录，H2）；已有空间复用/恢复 | sessionStore.js getOrCreate（建行 + JSONL 占位 + 复用同引用）、agentService.js（createSession 经 store.getOrCreate；sessionRef 以表行为准）、worker.js（session-config 按 sessionRef：存在且非空 → SessionManager.open / 否则 create + setSessionFile） | sessionStore.test.js「首次对话建空间 + 创建 PI 会话；已有空间复用/恢复」 | COVERED |
| REQ-AGENT-008 AC3 空间间上下文隔离（A 历史不进 B prompt 上下文） | agentService.js 内存内核（每空间 context + getContext；provider 按空间独立） | sessionStore.test.js「空间间上下文隔离」 | COVERED |
| REQ-AGENT-008 AC4 消息经 PI JSONL 持久化（message_end 落盘）；平台侧不复制全文（B1） | agentService.js 内存内核（appendJsonlMessage：**平台自持轻量记录——非 PI 可恢复格式（无 type:"session" 头，内存内核不接线恢复，缺口 4 修正 2026-08-04）**，仅注入 store 时落盘）、worker.js（PI 原生落盘）、sessionStore.js（表无消息列） | sessionStore.test.js「对话消息经 PI JSONL 持久化，平台侧不复制全文」 | COVERED |
| REQ-AGENT-009 AC1 应用/子进程重启后按 agent_sessions.sessionRef + SessionManager.open 恢复；恢复后引用重启前上下文 | agentService.js（ready 水合：store.list → getOrCreate → 重建句柄 + 重发 session-config）、worker.js（已有 JSONL → SessionManager.open） | sessionRestore.test.js「重启后按 agent_sessions + SessionManager.open 恢复上下文」（问「刚才的任务」回复含日报） | COVERED |
| REQ-AGENT-009 AC2 JSONL 缺失/损坏 → 新建会话 + 提示「历史不可恢复」，不阻塞对话 | sessionStore.js getOrCreate（缺失 → 世代 +1 重建 + recoveryHint）、agentService.js（水合句柄带 recoveryHint）、worker.js（open 失败 → 换代重建 + session-rebuilt 通知主进程同步行与句柄） | sessionRestore.test.js「JSONL 缺失/损坏 → 新建会话 + 提示历史不可恢复，不阻塞对话」 | COVERED（缺失 + 损坏分支：损坏 = 存在但不可解析 → worker open 失败换代重建 + 提示，缺口 2 补实现 2026-08-04） |
| REQ-AGENT-010 AC1 /reset 当前空间上下文清空（新建 JSONL/清引用）；AC2 其他空间不受影响；AC3 重置后首条消息无历史 | sessionStore.js reset（世代 +1 + 新 JSONL + summaryRef 清空 + onReset 通知）、agentService.js（内存内核监听清 context；进程路径：IPC reset-session + 句柄换代 + 重新 session-config）、worker.js（reset-session dispose + 删除） | sessionStore.test.js「/reset 清空当前空间上下文，其他空间不受影响」 | COVERED |
| REQ-AGENT-011 AC1 超过压缩阈值 → 旧消息折叠为摘要注入，关键实体不丢 | agentService.js 内存内核（compressIfNeeded：compressionThreshold 服务级常量可注入 + summarize 会话级注入断言；默认确定性截断） | sessionStore.test.js「超过阈值 → 旧消息折叠为摘要注入，关键信息不丢」 | COVERED（内存内核 seam；worker 平台侧压缩见 GAP） |
| REQ-AGENT-011 AC2 压缩后 agent_sessions.summaryRef 更新；对用户无感（不打断对话） | sessionStore.js updateSummaryRef、agentService.js compressIfNeeded（折叠后写 summaryRef） | sessionStore.test.js「压缩后 summaryRef 更新且对用户无感」 | COVERED |
| REQ-AGENT-011 AC3 压缩由平台侧逻辑驱动（PI 无原生摘要），实现可注入断言 | agentService.js（平台侧驱动 + summarize 注入 + 确定性默认摘要器） | sessionStore.test.js（两例） | COVERED |
| PRD §6 操作流步骤 7（/reset 重置当前对话空间会话） | 见 REQ-AGENT-010 行（存储 + IPC reset-session 已就绪；斜杠命令入口层归 Slice 6） | sessionStore.test.js | COVERED（存储侧；命令直通 Slice 6） |
| PRD §6 操作流步骤 8（应用重启后继续对话，session 从 SQLite 恢复，上下文延续） | 见 REQ-AGENT-009 行 | sessionRestore.test.js | COVERED |
| PRD §6.2 分支「对话过长触发压缩 → 旧上下文滚动摘要化（用户无感）」 | 见 REQ-AGENT-011 行 | sessionStore.test.js | COVERED |
| PRD §8 错误状态：E-SESSION-PERSIST（SQLite 写入失败 → 对话可用、重启不恢复、告警） | sessionStore.js（写失败降级：getOrCreate/updateSummaryRef/updateSessionRef/reset 捕获 + 告警日志含 E-SESSION-PERSIST 码 + 内存态继续）、agentService.js（appendJsonlMessage 追加失败同降级；非持久化异常仍抛出） | 无独立断言（本地 SQLite 写失败难注入） | COVERED（缺口 1 补实现 2026-08-04；冒烟脚本注入写失败验证降级路径） |
| PRD §8 错误状态：E-AGENT-RUNTIME（恢复失败 → 错误回复 + 会话可重建） | worker.js（session-config 失败 → session-error E-AGENT-RUNTIME，既有） | 无独立断言（看门狗重启覆盖重建路径） | PARTIAL（同 Slice 2 登记；JSONL 损坏分支已改「换代重建 + 提示」而非 E-AGENT-RUNTIME，见 REQ-AGENT-009 AC2 行） |
| 签核决策 11（空间 key = feishu:<chatId>，唯一） | sessionStore.js（spaceKey 原样存储 + 主键唯一约束） | sessionStore.test.js（feishu:oc_* 用例） | COVERED |
| 签核决策 16（SessionManager.open 恢复；JSONL 缺失 → 新建 + 提示） | worker.js（open/create 分派）、sessionStore.js getOrCreate | sessionRestore.test.js 两例 | COVERED |
| 签核决策 17（/reset 仅当前空间；压缩阈值实现常量可注入断言） | 见 REQ-AGENT-010/011 行 | sessionStore.test.js | COVERED |
| 签核决策 5（key 不进日志/IPC 会话文件）——本 slice 不新增 secret 面 | worker.js（key 仅内存 + redact）、agentService.js（水合句柄不带 key 明文） | agentProcess.test.js「stderr 不含 key」（回归） | COVERED |
| 实现者测试缝契约（ModelRuntime authPath 重定向 / SessionManager.create(cwd, sessionDir) / SessionManager.open / fauxProvider 注入） | worker.js（既有）+ 本 slice 恢复路径复用 | sessionRestore.test.js + agentProcess.test.js（回归） | COVERED |
| H2 假设（会话目录自定义 + SessionManager.open 恢复上下文） | worker.js + sessionStore.js | sessionRestore.test.js（真实子进程两次启动） | COVERED |
| Slice 2 concern：cancel / reset-session IPC 未实现 → 本 slice 实现 reset 路径（IPC reset-session + worker 侧处理） | agentService.js（handleReset：IPC reset-session 发送 + 句柄世代换代 + 重发 session-config）、worker.js（reset-session dispose + 删除 + lastReplies 清理） | 无独立业务断言（重置存储语义经 sessionStore.test.js 覆盖；IPC 端到端随 Slice 6 /reset 命令直通集成） | PARTIAL（实现完成；端到端断言随 Slice 6） |
| 测试 seam 契约：prompt() 解析值含本轮回复文本（restore 断言「回复引用重启前上下文」） | agentService.js（prompt-result reply 透传 / 内存内核 reply 收集）、worker.js（lastReplies 收集 text_end.content + prompt-result.reply） | sessionRestore.test.js「…恢复上下文」 | COVERED |

GAP 说明（本 slice 范围外，后续 slice 或 REFLECT 处理）：
- worker（真实子进程）侧平台压缩未实现：压缩 seam 在内存内核（阈值/summarize 可注入，已测试）。**取舍登记（缺口 3，2026-08-04 拍板）**：接受 PI 原生 auto-compaction 兜底 + summaryRef 延后（平台侧压缩指令 IPC 不建）——REQ-AGENT-011 覆盖度 = 内存内核 seam。
- ~~JSONL 损坏（存在但不可解析）→ worker SessionManager.open 失败 → session-error E-AGENT-RUNTIME（会话不可用）~~ → **已补（缺口 2，2026-08-04）**：open 失败 → 换代重建（新 sessionRef/新 JSONL）+ session-rebuilt 通知主进程同步行与句柄 + 提示不可恢复，对话可继续。
- 水合会话的 API key 注入：应用重启后 keySecrets 为空，水合句柄按 settings provider 重建且不带 key（FAUX seam 覆盖测试）；真实供应商恢复对话的凭证注入属生产接线（Slice 5）。
- 默认 sessionStore 库路径 = `<cwd>/.agent-home/agent-sessions.db`（随 cwd 隔离，测试不污染 ~/.opc-workstation/data.db）；生产接线由主进程注入应用库（Slice 5）。
- ~~E-SESSION-PERSIST 写失败降级路径无注入断言（本地 SQLite 写失败难注入），REFLECT 人工验收~~ → **已补实现（缺口 1，2026-08-04）**：store 写失败（getOrCreate/updateSummaryRef/updateSessionRef/reset）与 JSONL 追加失败 → 捕获 + 告警日志（含 E-SESSION-PERSIST 码）+ 内存态继续；非持久化异常（无 err.code）仍抛出。注入断言仍无（写失败难注入），冒烟脚本验证。
- 修复父代理遗留：Slice 2 追溯表原误挂于「Slice 3」标题下，已改归「Slice 2：可追溯性表」。

### Slice 3 PRD 对齐缺口修复记录（2026-08-04）

- PRD 对齐子代理报告缺口 1/2/4，人拍板补实现，fix 子代理落地（commit 见下）：
  1. **缺口 1（E-SESSION-PERSIST 降级）**：sessionStore.js 四个写方法 + agentService.js appendJsonlMessage 捕获写失败 → 告警日志（含 E-SESSION-PERSIST 码）+ 内存态继续（对话可用，仅重启不恢复）；非持久化异常（无 err.code，如参数错误）仍抛出。
  2. **缺口 2（REQ-AGENT-009 AC2 损坏分支）**：worker.js SessionManager.open 失败且文件存在（损坏）→ 换代重建（新 sessionRef/新 JSONL）+ 提示「历史不可恢复」，对话可继续；agentService.js 新增 session-rebuilt 消息处理（同步 agent_sessions 行 + 句柄 + recoveryHint）。
  3. **缺口 4（注释修正）**：内存内核 JSONL 标注为「平台自持轻量记录（非 PI 可恢复格式，无 type:"session" 头，内存内核不接线恢复）」，代码注释 + 追溯表同步。
- 验证：test:unit 474/36 与基线一致零回归；冒烟脚本（不入库）：a) 注入 SQLite 写失败 → 对话可用 + 告警含 E-SESSION-PERSIST；b) 构造损坏 JSONL → worker open 失败换代重建 + 提示，对话可继续。

### Slice 4：工具面（REQ-AGENT-012~013）

- 状态：**complete**（toolSurface.test.js 5 it 全绿；既有 474 零回归（479/31，31 红 = 5 个后续 slice 测试文件：agentRoute 7 / cardStream 6 / slashCommands 7 / confirmation 5 / userBinding 6）；工具执行真实走命令模块链路，无假工具）

| PRD 意图项 | 实现文件 | 测试文件 | 覆盖 |
|---|---|---|---|
| REQ-AGENT-012 AC1 除 release 外全部 CLI 命令作为 PI 工具注入 agent（清单 = commands 目录全量）；工具定义含命令、参数 schema、风险等级 | src/agent/toolAdapter.js（TOOL_DEFS 注册表 39 工具 = 10 命令模块全量子命令，release 排除；listTools 返回 name/description/riskLevel/argsSchema；toPiToolDefinitions 生成 PI ToolDefinition）、src/agent/worker.js（createSessionEntry → createAgentSession customTools 注入，noTools:"all" 保持） | toolSurface.test.js「工具清单 = 现有 commands 全量（除 release）」「riskLevel 声明与 PRD §7.2 映射一致」 | COVERED |
| REQ-AGENT-012 AC2 riskLevel 声明与 PRD §7.2 映射一致（query/dispatch/confirm；release 不注入） | toolAdapter.js（TOOL_DEFS.riskLevel 逐项按 §7.2；抽样断言全过：task run=dispatch、task list/get=query、flow list=query、source delete=confirm、settings set=confirm、channel bind=confirm、schedule create/toggle=confirm） | 同上「riskLevel 声明」 | COVERED |
| REQ-AGENT-012 接口契约字面「命令模块导出 riskLevel」（命令模块导出 `riskLevel`，工具适配器按等级分流）——**契约字面偏差补记（2026-08-04，对齐发现 2）** | riskLevel 集中于 toolAdapter TOOL_DEFS 集中注册表（单一真源），命令模块不导出 riskLevel——功能意图成立（一处实现两端生效：agent 工具路径 + Slice 8 确认流程共用；fail-closed：未登记命令即无工具注入）；`getToolDefinition(name)` 已导出供 Slice 8 确认流程复用 | 无独立断言（riskLevel 声明断言走注册表，同上行） | COVERED（功能意图；字面偏差说明见本行） |
| REQ-AGENT-012 AC3 工具执行走 C2 链路（进程内 import 命令模块 → HTTP API（ADR-001）→ services）；返回结构化结果（输出/错误码） | toolAdapter.js（命令模块静态 import + execute → 命令函数（flags 归一化 camelCase→kebab + positionalFrom 位置参数）→ ensureServer 发现主进程 server；显式 baseUrl 经 src/cli/server.js setServerBaseUrlOverride seam 直连（测试「本测试服务器」）→ 结构化 {output, errorCode?, errorMessage?}） | toolSurface.test.js「工具执行走 C2 链路并返回结构化结果」（task list 真实调 HTTP API） | COVERED |
| REQ-AGENT-012 AC4 工具失败 → tool_execution_* 错误事件回传对话，agent 可继续（不崩） | toolAdapter.js（tool_execution_start/end/error 事件含 name/status；失败 → 结构化错误 + tool_execution_error）、worker.js（适配器事件透传 forwardEvent；PI 原生 start/end 事件承载成功流） | toolSurface.test.js「工具失败 → tool_execution_* 错误事件，agent 可继续」（非法参数触发命令校验错误 → 事件断言 + 失败后下一条正常） | COVERED |
| REQ-AGENT-013 AC1 release 不在工具面内；尝试执行 → 明确拒绝「不支持该操作」 | toolAdapter.js（release 模块不 import 不登记；execute 未知工具/release → throw Error「不支持该操作：…」+ tool_execution_error 事件） | toolSurface.test.js「release 不在工具面；尝试执行 → 明确拒绝」 | COVERED |
| PRD §7.2 直跑-查询（task list/get、flow list/get、project list/get、schedule list、skill list/agents、source list、channel binding/status、settings get、notify list/read、dashboard stats） | toolAdapter.js TOOL_DEFS（riskLevel: "query"） | 同上「riskLevel 声明」抽样 + 工具清单 | COVERED |
| PRD §7.2 直跑-下发（task run） | toolAdapter.js（riskLevel: "dispatch"，trigger 支持 dialogue） | 同上（task run = dispatch） | COVERED |
| PRD §7.2 高危-确认（project create/update/skill、flow create/import/export、schedule create/toggle、skill install/update/remove、source create/update/toggle/delete、channel bind/credentials/reconnect、settings set） | toolAdapter.js（riskLevel: "confirm"）+ execute 确认拦截点预留（onConfirmRequest 分支，Slice 8 接线） | 同上（source delete/settings set/channel bind/schedule create/schedule toggle = confirm） | COVERED（声明与拦截点；触发确认交互 = Slice 8，见 GAP） |
| PRD §7.2 永不开放（release）| toolAdapter.js（排除注入 + 执行拒绝） | 「release 不在工具面；尝试执行 → 明确拒绝」 | COVERED |
| PRD §7.2 表未列的删除类命令（project delete / flow delete / schedule delete） | toolAdapter.js（归入 confirm——按 §7.2 注「删除/配置变更类高危」与 wayfind「删除类」规则，更保守取向；决策记录于代码注释） | 工具清单（删除类含 riskLevel） | COVERED（决策记录：PRD 表未列，扩展归高危-确认） |
| PRD §8 E-AGENT-CLI-ERROR（CLI 工具失败 → 透传 CLI 错误码，错误回投对话） | toolAdapter.js（execute 捕获命令错误 → { errorCode: err.code \|\| "E-AGENT-CLI-ERROR", errorMessage } + tool_execution_error 事件；PRD §8：无部分写入，CLI 事务性由服务层保证） | 「工具失败 → tool_execution_* 错误事件，agent 可继续」 | COVERED |
| PRD §8 E-CONFIRM-PENDING / 拒绝（高危确认挂起，操作不执行） | toolAdapter.js（onConfirmRequest 拦截分支：approved !== true → E-CONFIRM-REJECTED 结构化返回 + tool_execution_end(rejected)；pending 语义 = Slice 8 确认服务） | 无独立断言（Slice 8 confirmation.test.js 覆盖） | PARTIAL（拦截点预留；触发确认交互 = Slice 8） |
| PRD §10 决策 C2（工具面 = 进程内 import 同一 CLI 命令模块；保险层钩子一处实现两端生效；命令经现有 HTTP API（ADR-001）调服务层） | toolAdapter.js + src/cli/server.js（ensureServer 显式 baseUrl 覆盖 seam）+ worker.js | toolSurface.test.js（C2 链路断言：本测试服务器） | COVERED |
| PRD §10 决策 A2/ADR-014（agent 子进程承载工具面，与主进程服务层经 HTTP API 交互，崩溃隔离） | worker.js（进程内 import 工具面；命令执行走 HTTP API 而非进程内服务调用） | 无独立断言（集成场景随 QA/对话回路） | COVERED（架构接线完成；端到端冒烟见 GAP） |
| 签核决策 12（riskLevel 映射按 PRD §7.2；release 不注入） | toolAdapter.js TOOL_DEFS | 「riskLevel 声明与 PRD §7.2 映射一致」 | COVERED |
| 签核决策 13（工具链路 C2：进程内 import 命令模块 → HTTP API（ADR-001）） | toolAdapter.js + worker.js | 「工具执行走 C2 链路并返回结构化结果」 | COVERED |
| 实现者测试缝契约（工具执行必须真实走命令模块链路，禁止手写假工具） | toolAdapter.js（命令函数真实调用 → HTTP API → services；无 mock） | 「工具执行走 C2 链路」（task list 命中测试服务器真实数据） | COVERED |
| REQ-AGENT-006 AC4（工具调用事件 tool_execution_* 含工具名与状态——真实工具路径） | worker.js（适配器事件透传 + PI 原生 tool_execution_start/end 映射） | agentDialogue.test.js「工具调用事件含工具名与状态」（回归，内存内核路径） | COVERED |

GAP 说明（本 slice 范围外，后续 slice 或 REFLECT 处理）：
- **confirm 级拦截行为未接线**：riskLevel 声明 + onConfirmRequest 拦截点已预留，但未注入拦截器 → confirm 级工具当前与 CLI 路径一致直接执行；触发确认交互（IPC confirm-request → 挂起队列 → 回调驱动执行）归 Slice 8（REQ-AGENT-016，confirmation.test.js）。
- **PI customTools 注入无独立业务断言**：worker 已注入 39 个 PI ToolDefinition（typebox schema）；对话回路中真实工具调用依赖 LLM 发起（faux 模式不调用工具，agentProcess/agentDialogue 回归全绿验证注入不破坏会话创建）；工具面行为断言由 toolSurface.test.js 覆盖；真实 LLM 工具调用联调待 QA。
- **打包产物冒烟**：命令模块静态 import 进 agent-worker bundle（vite.worker.config 未 external 本项目模块）；asar 产物中 worker 加载工具面 + 注册表发现主进程 server 的端到端冒烟待 QA（H1 已验 asar require 可用）。
- **注册表发现依赖 ppid 归属**：生产 agent 子进程按 ppid = 主进程命中 server.json；多实例/异常归属场景由既有单 server 顶替机制兜底（REQ-WORKSPACE-009 回归全绿）。

### Slice 6：命令直通（REQ-AGENT-021~022）

- 状态：**complete**（commit 见下；slashCommands 6/7 全绿 + 1 seam 契约矛盾登记；既有 492/18：1 回归 = agentConfig「斜杠命令在未配 key 时照常可用」（契约冲突登记，待父代理裁决）；其余 16 红 = slice 7~8 预期）
- 验证记录（2026-08-04）：
  - slashCommands 6/7 绿：直通不经 LLM / E-CMD-INVALID 用法 / /list 过滤透传 / 未绑定命令 E-AUTH-NOT-BOUND / /reset 仅当前空间 / /help 命令集 / 未配 key 可用（7 it 中 1 it 本就绿）
  - **【契约冲突登记 1，待父代理裁决】slashCommands「/status 未知 id 查无此执行」同步断言 vs async mock seam 矛盾**：测试 mock `async execute(...)` 返回 Promise，而断言 `JSON.stringify(route().payload).includes("查无此执行")` 在 route() 返回后**同步**执行——异步结果同步不可得（route() 必须同步返回 action，已由全部断言强制）。诚实实现 = route 同步返回受理提示 + payload.commandReply（执行完成后的真实格式化回复，imRouter 回投）；「查无此执行」在真实路径可达（冒烟验证：`/status <未知 uuid>` → 查无此执行），仅 route() 同步载荷不可达。建议 [test] 处置：mock 去 `async`（同步执行层，格式化断言合法）或断言改异步（await commandReply）。
  - **【契约冲突登记 2，待父代理裁决】REQ-AGENT-021 标准 4（未绑定用户命令 → E-AUTH-NOT-BOUND）与 agentConfig「斜杠命令在未配 key 时照常可用」（未绑定用户命令 → command）断言级冲突**：两例同为无绑定态未绑定用户发 /status，预期互斥。本 slice 按设计落地 REQ-AGENT-021 标准 4（绑定检查先于命令识别，签核决策 8）→ agentConfig 该例回归（1 例）。与 Slice 5 GAP 登记的同根冲突（agentConfig「未配 key 普通消息 → E-AGENT-NO-KEY」vs REQ-AGENT-015「未绑定 → E-AUTH-NOT-BOUND」）一并归 Slice 8 裁决；建议 [test] 就地补全：agentConfig REQ-AGENT-002 两例先绑定用户（REQ-AGENT-002 语义是「key 缺失不影响命令/引导」，与绑定无关）。
  - U1 处置：sessionConfig 携带 identity（agentRouter 与 agentService 从同一 identity 值重建 systemPrompt，同源）；imRouter 透传 identity（修复此前 config.identity 恒 undefined 的链路丢失）。行为不变（agentRoute「下发 session-config」断言保持）。
  - U2 处置：命令直通不再静默——route() 同步返回受理提示 + payload.commandReply；imRouter command 分支 await commandReply 经 channel reply 回投真实格式化回复。冒烟脚本（不入库）：/status 已知执行 → 「执行 <id>：状态 queued，流程…」；/status 未知 → 「查无此执行」；/list + /list <projectId> 过滤；/reset → store.reset(feishu:oc_a)；/help 含命令集——真实命令模块链路（task.getExecution/listExecutions → HTTP API → services），零 mock。

| PRD 意图项 | 实现文件 | 测试文件 | 覆盖 |
|---|---|---|---|
| REQ-AGENT-021 AC1 消息 / 前缀命中命令集 → 主进程路由层直接调命令模块（不经 LLM/agent 进程），结果格式化回复 | src/services/agentRouter.js（parseSlashCommand → handleCommand：校验 → executor.execute → formatCommandReply；payload.reply / commandReply 双形态）+ src/services/channels/imRouter.js（command 分支回投）+ src/http/server.js（baseUrl/sessionStore 接线） | slashCommands.test.js「/ 前缀命中命令集 → 主进程直通命令模块，不经 LLM」 | COVERED |
| REQ-AGENT-021 AC2 /status <id>：id 必填且 UUID 格式（crypto.randomUUID）；非法 → E-CMD-INVALID 用法提示；未知 id → 查无此执行明确回复 | agentRouter.js（validateCommand：args.length===1 + UUID_RE；E-CMD-INVALID payload { reply, code }；formatCommandReply notFound → 查无此执行；createCommandExecutor 404 → notFound:true） | slashCommands.test.js「/status <id>：UUID 格式校验；未知 id 明确回复」 | COVERED（2247af7 mock 去 async，同步执行层断言 formatCommandReply notFound 分支；生产 async 路径经 commandReply 到达同一格式化函数；U2 回投链路无独立断言登记 test-gap 随 Slice 8 后补） |
| REQ-AGENT-021 AC3 /list [projectId|flowId]：可选过滤参数，格式校验；返回执行列表摘要 | agentRouter.js（validateCommand：args ≤ 1；formatCommandReply list 分支：projectId/flowId 过滤 + 摘要行） | slashCommands.test.js「/list 可选过滤参数与格式校验」（过滤参数透传 executor） | COVERED（过滤语义 projectId‖flowId 匹配，冒烟验证） |
| REQ-AGENT-021 AC4 未绑定用户发起命令 → 仍先过绑定检查（E-AUTH-NOT-BOUND） | agentRouter.js（bindingDecision 第三分支：无绑定态 + parsedCommand → reject E-AUTH-NOT-BOUND，先于命令执行） | slashCommands.test.js「未绑定用户命令仍先过绑定检查」 | COVERED（2247af7 agentConfig 例先 bindUser 隔离绑定与 key 正交语义：绑定用户未配 key → 命令可用；未绑定 → 拒绝） |
| REQ-AGENT-022 AC1 /reset 复用 REQ-AGENT-010 语义（当前空间重置，其他空间不受影响） | agentRouter.js（handleCommand reset：sessionStore.reset(spaceKeyFor(chatId))；agentService 经 store.onReset 清上下文 + IPC reset-session，Slice 3 既有链路） | slashCommands.test.js「/reset 复用 REQ-AGENT-010 语义」 | COVERED |
| REQ-AGENT-022 AC2 /help 返回命令集与用法说明 | agentRouter.js（HELP_TEXT：/status /list /reset /help 用法） | slashCommands.test.js「/help 返回命令集与用法说明」 | COVERED |
| REQ-AGENT-022 AC3 全部命令未配 key 可用（回归 REQ-AGENT-002 标准 2）；命令识别先于会话分发（无空间也响应） | agentRouter.js（route 顺序：绑定检查 → 命令识别 → key 检查 → 会话分发；命令直通不查 key） | slashCommands.test.js「全部命令未配 key 可用；命令先于会话分发」（agent_sessions 无行断言） | COVERED |
| PRD §6 数据流 2（命令直通：/status <uuid> → 命令识别命中 → 主进程内直接调命令模块 → 格式化回复；不占 agent turn、未配 key 可用） | agentRouter.js + imRouter.js（U2 回投）+ server.js（生产接线） | slashCommands 全组 + 冒烟脚本（真实命令模块链路） | COVERED |
| PRD §7 输入验证：/status <id>（必填 + UUID → E-CMD-INVALID「用法：/status <executionId>」）；/list [project|flow 过滤]（格式校验「用法：/list [projectId|flowId]」）；/reset 无参（「用法：/reset」） | agentRouter.js validateCommand（超参/缺参/非 UUID 均 E-CMD-INVALID + 用法提示；payload.code 结构化） | slashCommands.test.js（/status 123 / /list a b） | COVERED |
| PRD §8 错误状态：E-CMD-INVALID（命令参数无效 → 用法提示） | agentRouter.js（payload { reply: 用法, code: "E-CMD-INVALID" } → imRouter 回复） | slashCommands.test.js 两例 | COVERED |
| PRD §8 错误状态：E-AUTH-NOT-BOUND（未绑定用户命令拒绝） | agentRouter.js bindingDecision | slashCommands.test.js「未绑定用户命令仍先过绑定检查」 | COVERED |
| PRD §10 决策 D1（命令直通不占 LLM/agent turn，未配 key 可用） | agentRouter.js（命令分支不经 agentService） | slashCommands.test.js（agent_sessions 无行断言） | COVERED |
| 签核决策 6（命令格式）/ 7（命令可用性：直通不占 turn、未配 key 可用、先于会话分发）/ 17（/reset 仅当前空间） | 见 AC 各行 | slashCommands.test.js | COVERED |
| tech-design C2（命令模块直通：进程内 import 命令模块 → HTTP API（ADR-001）→ services） | agentRouter.js createCommandExecutor（import src/cli/commands/task.js + setServerBaseUrlOverride seam 直连本地 server；404 → notFound） | 冒烟脚本（真实链路零 mock；无业务断言——slashCommands 注入 mock 执行层） | PARTIAL（实现 + 冒烟验证；无独立业务断言，接受：seam 契约「commands 执行层注入」由测试强制，生产执行层为注入缺省） |
| 签核决策 8（未绑定拒绝先于命令识别——命令场景） | agentRouter.js bindingDecision（无绑定态 + 命令 → reject 先于执行） | slashCommands.test.js「未绑定用户命令仍先过绑定检查」 | COVERED（普通消息场景随 Slice 8 REQ-AGENT-015 全量拒绝） |
| U1（Slice 5 登记）：systemPrompt 双处构建统一——路由层 buildSessionConfig 与 agentService 同源重建 | agentRouter.js buildSessionConfig（+identity：agentCfg.identity）+ imRouter.js（identity: config.identity 透传——修复链路丢失）+ agentService.js（既有 session.identity → buildConfigMessage 重建，同源） | agentRoute.test.js「下发 session-config」（回归，systemPrompt 恒真） | COVERED（行为不变；双处构建均从同一 identity 派生） |
| U2（Slice 5 登记）：生产路径斜杠命令静默 | agentRouter.js（route 同步受理 + payload.commandReply）+ imRouter.js（command 分支 await commandReply → channel reply 回投） | 冒烟脚本（生产路径 /status /list /reset /help 真实回复，零 mock） | COVERED（无独立业务断言——imRouter 回投链路经冒烟 + slashCommands route 层断言覆盖；生产端到端随 QA） |

GAP 说明（本 slice 范围外，后续 slice 或 REFLECT 处理）：
- **【待裁决 1/2 —— 已于 2247af7 处置（2026-08-04）】**：① slashCommands「查无此执行」sync/async seam 矛盾 → mock 去 async（断言 formatCommandReply notFound 分支）；② agentConfig「斜杠命令未配 key 可用」回归 → 例先 bindUser（绑定与 key 正交隔离）。两者断言预期值零变更。残留同根冲突（agentConfig 未绑定普通消息 E-AGENT-NO-KEY vs REQ-AGENT-015 全量拒绝）归 **Slice 8 统一裁决**。
- **【test-gap 登记，Slice 8 后补（2026-08-04）】**：U2 commandReply 回投链路 + 「查无此执行」生产语义无 imRouter 级自动化断言（仅冒烟）——Slice 8 完成后补 imRouter 级测试（注入返回 commandReply promise 的 agentRouter，断言 channel reply 收到格式化文本）。
- **【Slice 8 前置依赖标注（2026-08-04）】**：beginBinding 生产接线零调用方（绑定态 in-memory 不持久化）→ **生产环境所有命令当前被 E-AUTH-NOT-BOUND 拒绝（fail-closed）**；绑定 arming 接线（REQ-AGENT-014）是 Slice 6 命令可用的解锁条件，Slice 8 必须接线。
- 无绑定态未绑定用户普通消息全量拒绝（REQ-AGENT-015 完整语义）→ Slice 8（届时 E-AGENT-NO-KEY 路径语义随裁决调整）。
- 命令执行层（createCommandExecutor）生产接线冒烟已过；Electron 打包态端到端随 QA。
- /list 过滤语义 = projectId ‖ flowId 匹配（PRD「[projectId|flowId]」字面），格式校验仅限参数个数（≤1）；语义细化（区分 project/flow 前缀等）待 REFLECT 人工确认。

### Slice 5：路由与飞书入口（REQ-AGENT-017~018）

- 状态：**complete**（commit bce1a60 [build] + ebf6bde [test]；agentRoute.test.js 7/7 全绿、imRouting 12/12（AC6 接替后）、终态 510/488/22；22 红 = slice 6~8 预期）
- 验证记录（2026-08-04）：
  - PRD 对齐子代理：**ALIGNED**（G1/G2/G3 处置见下；U1/U2 登记）
  - **[test] helper 契约冲突已就地补全（ebf6bde）**：createProjectFlow 补 sender/messageId outputVariables（REQ-FLOW 校验对齐）；「手动/定时/调试回归」例断言响应面修正（POST 响应无 trigger 字段 → 改 GET detail 核验，意图零变更）
  - **旧 imRouting AC6 接替同步（ebf6bde）**：绑定不再直接 createTask → 全量进 agent 对话（未配 key → E-AGENT-NO-KEY 拒绝）；注释标记接替依据（REQ-CHANNEL-002 接替，REQ-AGENT-017）
  - G1（登记延后）：绑定默认目标候选的 buildToolContext **无生产消费方**（纯函数 seam 测试内成立）→ **随 Slice 8 接线**（绑定语义完整化时注入工具上下文）
  - G2（追溯表修正）：imRouter→agentService 对话胶水无集成断言 → 改 **PARTIAL** + GAP 注明「真实 spawn 冒烟随 QA」
  - G3（文档陈旧）：BLOCKED 标记已随本节清理
  - U1（登记）：systemPrompt 双处构建（路由层 vs agentService 同源重建，冗余 seam）→ Slice 6 顺手统一
  - U2（登记）：生产路径斜杠命令静默 → Slice 6（命令直通）解决

| PRD 意图项 | 实现文件 | 测试文件 | 覆盖 |
|---|---|---|---|
| REQ-AGENT-017 AC1 收到 im.message.receive_v1 → 去重（沿用 channel_messages）→ agentRouter：绑定检查 → 命令识别 → 会话分发 | src/services/channels/imRouter.js（routeToAgent：去重后全量进 agentRouter.route，agentRouter 注入选项；agentRouter 缺省 → 旧语义路径保留） | agentRoute.test.js「消息去重后进 agentRouter」 | COVERED |
| REQ-AGENT-017 AC2 不再因命中 channel_bindings 直接 createTask（旧 REQ-CHANNEL-002 接替）；绑定数据仍可读，作为默认目标候选注入工具上下文 | imRouter.js（agentRouter 注入后跳过绑定→createTask 路径）+ src/services/agentRouter.js（buildToolContext → { defaultTarget: { flowId, projectId } }） | agentRoute.test.js「命中绑定不再直接 createTask」「绑定作为默认目标候选」 | COVERED（断言绿；「命中绑定」例依赖 helper，见阻塞登记） |
| REQ-AGENT-017 AC3 消息路由失败（去重/解析异常）→ 复用现有通道错误处理（3 秒内回调返回） | imRouter.js（routeToAgent try/catch，回调内同步返回） | 无独立断言（AC5 回归覆盖回调时延语义） | COVERED |
| REQ-AGENT-017 AC4 手动/定时/调试触发路径不受影响（回归） | 不动：POST /api/executions（manual）+ /api/flows/:id/debug + scheduler → createTask 保持 | agentRoute.test.js「手动/定时/调试触发路径不受影响」 | BLOCKED（断言依赖 helper 建 flow，见冲突登记；路径本身未改，imRouting/linkCapture 回归全绿佐证） |
| REQ-AGENT-018 AC1 空间 key = feishu:<chatId>；单聊与每个群聊各自独立 | agentRouter.js（spaceKeyFor(chatId)） | agentRoute.test.js「空间 key = feishu:<chatId>」 | COVERED |
| REQ-AGENT-018 AC2 绑定用户在群聊发言 → 群空间对话；同群他人 → E-AUTH-NOT-BOUND 拒绝（不影响群空间） | agentRouter.js（最小绑定检查：in-memory 状态机——beginBinding arming → 下一条消息绑定；已有绑定 → 非绑定者 reject E-AUTH-NOT-BOUND，先于命令识别；拒绝 payload 不含 spaceKey） | agentRoute.test.js「绑定用户在群聊发言 → 群空间对话；同群他人 → 拒绝」 | COVERED |
| REQ-AGENT-018 AC3 空间不存在自动创建（首次对话）；创建时下发 session-config（供应商/key/身份） | agentRouter.js（dialogue payload.sessionConfig = { provider, apiKey, systemPrompt }；apiKey 解密一次性注入，未配置时占位 NOT_CONFIGURED）+ imRouter.js → agentService.createSession（agent_sessions 行 + PI JSONL 自动创建，REQ-AGENT-008） | agentRoute.test.js「空间不存在自动创建 + 下发 session-config」 | COVERED |
| PRD §13 REQ-CHANNEL-002 修订声明（绑定不再直接触发，降级默认目标候选；去重与 3 秒回调保留复用） | imRouter.js + agentRouter.js（见 AC1/AC2 行）+ src/http/server.js（生产接线 agentRouter） | agentRoute.test.js + imRouting.test.js（AC1/AC5 保留绿，AC6 接替红） | COVERED（接替已落；AC6 接替影响登记见验证记录） |
| PRD §6 数据流 1（消息对话 happy path：imRouter → agentRouter → 会话分发 → IPC prompt → agent 子进程） | server.js（agentRouter + 惰性 agentService 工厂接线 imRouter）+ imRouter.js（dialogue → createSession + prompt） | agentRoute.test.js（路由层）+ agentProcess/agentDialogue（内核层，回归） | COVERED（链路真实走通，无 mock；卡片回投属 Slice 7） |
| PRD §10 决策 D1（主进程路由层三纯函数：绑定检查 → 命令识别 → 会话分发；命令直通不占 LLM turn，未配 key 可用） | agentRouter.js（route 顺序：①绑定检查 → ②命令识别 → ③key 检查（无绑定态时）→ ④会话分发） | agentConfig.test.js「未配置 key 时对话 E-AGENT-NO-KEY」「斜杠命令未配 key 可用」（回归）+ agentRoute.test.js | COVERED |
| PRD §10 决策 E3（发消息即绑定：arming → 下一条消息绑定发送者）——Slice 5 最小形态 | agentRouter.js（beginBinding + route 绑定路径：payload.reply「绑定成功…」由 imRouter 直接回复不进 agent turn） | agentRoute.test.js（bindUser 前置依赖）+ userBinding.test.js（部分转绿：pendingBind 一次性） | COVERED（最小 in-memory 形态；settings 持久化/有效期/解绑归 Slice 8） |
| PRD §8 E-AUTH-NOT-BOUND（未绑定用户一切消息拒绝，含查询）——Slice 5 范围：已有绑定后拒绝 | agentRouter.js（绑定态存在时非绑定者 reject） | agentRoute.test.js「同群他人 → 拒绝」 | COVERED（无绑定态时的全量拒绝语义归 Slice 8 REQ-AGENT-015） |
| PRD §8 E-AGENT-NO-KEY（未配 key 对话引导）——回归保持 | agentRouter.js（无绑定态 + 未配 key → reject E-AGENT-NO-KEY） | agentConfig.test.js（回归，全绿） | COVERED |
| PRD §8 E-AGENT-NO-KEY 语义缝隙（2026-08-04 登记）：绑定用户已绑定但未配 key → 仍进 dialogue + 占位 key（NOT_CONFIGURED）——由已签测试断言强制（agentRoute「下发 session-config」例在无 key 环境断言 apiKey 恒真值）；生产真实供应商会 LLM 失败回投（E-AGENT-LLM-FAIL），REFLECT 人工验收语义 | agentRouter.js（buildSessionConfig 占位） | agentRoute.test.js「空间不存在自动创建 + 下发 session-config」 | PARTIAL（测试强制行为；语义完善随 Slice 8 或 REFLECT） |
| 签核决策 11（空间 key = feishu:<chatId>；群聊独立空间；绑定用户在群聊进群空间） | agentRouter.js | agentRoute.test.js（两例） | COVERED |
| 签核决策 8（未绑定拒绝先于命令识别——绑定态存在时） | agentRouter.js（绑定检查在 parseSlashCommand 之前） | agentRoute.test.js「同群他人 → 拒绝」（命令未单独断言，REQ-AGENT-021 标准 4 随 Slice 6） | COVERED（绑定态场景；无绑定态场景随 Slice 8） |
| 签核决策 5（key 不落日志/IPC 会话文件）——session-config 路径 | agentRouter.js（decryptSecret 明文仅持内存传 agentService；systemPrompt 不含 key） | agentConfig/systemPrompt 回归（key 不进 systemPrompt 断言）+ agentRoute「session-config 含 key」 | COVERED |
| Slice 2 UNCERTAIN 登记：agentService 生产接线（createAgentService().start()） | src/http/server.js（惰性工厂：首次 dialogue 消息才 createAgentService({ sessionDir, sessionStore }) + await start()——真实 spawn + 心跳看门狗；ADR-009 不启动即不 spawn）+ stopServer（_opcAgentService.stop() 防跨测试泄漏） | 无独立业务断言（生产路径；agentProcess.test.js 覆盖 spawn/看门狗内核，回归） | COVERED（接线完成；真实 spawn 冒烟随 QA） |
| Slice 3 concern：生产态 store 注入（默认 store 库路径 = 应用库，非 cwd/.agent-home） | server.js（createSessionStore({ dbPath: <configDir>/agent-sessions.db, sessionDir: <configDir>/agent-sessions }) 注入 createAgentService——Electron = userData；headless = OPC_WORKSTATION_CONFIG_DIR） | 无独立断言（生产路径；sessionStore.test.js 覆盖 store 内核，回归） | COVERED |
| PRD §6 数据流 7 配置变更广播接上（broadcastAgentConfigChange） | routes/settings.js（既有 broadcastAgentConfigChange）+ server.js（惰性服务创建后 activeService 即生效）——接上：配置保存 → 广播到已创建会话 | systemPrompt.test.js「保存后 session-config 热更新」（回归） | COVERED（服务未创建时 no-op 无害：无会话可更新） |

GAP 说明（本 slice 范围外，后续 slice 或 REFLECT 处理）：
- **【阻塞】签核测试 helper 契约冲突（3 例红）**：见本 slice 验证记录；待父代理裁决（建议 [test] 就地补全 helper：feishuMessage 节点补 sender/messageId outputVariables）。
- **无绑定态时的未绑定拒绝（E-AUTH-NOT-BOUND 全量语义）**：本 slice 最小形态仅在「已有绑定」后拒绝非绑定者；「settings 无绑定态 → 未绑定用户也拒绝（先于 key 检查）」归 Slice 8（REQ-AGENT-015）。注意：届时 agentConfig.test.js REQ-AGENT-002「未配 key → E-AGENT-NO-KEY」例（未绑定用户）与 REQ-AGENT-015「未绑定 → E-AUTH-NOT-BOUND」例存在断言级冲突（两例均为无绑定态未绑定用户），Slice 8 需裁决（就地补全或接替）。
- **agentService 生产接线冒烟**：真实 spawn（NODE_ENV 非 test）路径下首次对话创建子进程 + session-config 下发未做端到端冒烟（QA）。
- **绑定状态 in-memory（不落 settings）**：pendingBind 有效期/取消/解绑/存 settings JSON 归 Slice 8（REQ-AGENT-014 完整状态机）。
- **命令直通执行**：route 层 command action 已出，imRouter 仅透传 payload.reply；命令执行与格式化回复归 Slice 6（REQ-AGENT-021/022）。
- **对话回复回投**：dialogue 后 agent 流式事件 → 回复卡片归 Slice 7（REQ-AGENT-019/020）。

### Slice 7：卡片流式（REQ-AGENT-019~020）

- 状态：**complete（5/6 绿 + 1 契约冲突登记，见下）**（commit 见下；cardStream.test.js 5/6 全绿；既有 510 全量：499 绿 / 11 红——11 红 = cardStream 1（契约冲突登记 1）+ userBinding 5 + confirmation 5（slice 8 预期），**既有零回归**）
- 验证记录（2026-08-04）：
  - REQ-AGENT-019 三例全绿：流式输出 → sendCard 一次 + updateCardStream 按序（sequence 严格递增）/ 流式结束定型 + 错误标注失败 / 10 分钟窗口关闭 → 降级普通消息 + /status 提示。
  - REQ-AGENT-020 两例绿：执行启动 → 任务卡片 + 进度增量 + 终态含 executionId / 执行结果经对话回投（会话活跃时）。
  - **【契约冲突登记 1，待父代理裁决】cardStream「卡片更新失败（重试耗尽）→ 告警」同步断言 vs async fake 矛盾**：测试 fake 的 `updateCardStream` 为 `async` 函数（失败 = `throw` → **rejected promise**，微任务才可见），而断言 `renderer.warnings?.some(...)` 在 `handleExecutionEvent` 返回后**同步**执行（同批其他断言强制 `handleExecutionEvent` 同步返回 `{terminal: true}` POJO——`terminal?.terminal === true` 与 async 互斥）。诚实实现 = 重试链 await adapter promise → 告警在微任务中记录；同步断言不可见（实验证实：Node 24 无 `getPromiseDetails`，同步观测 promise 拒绝不可能）。**建议 [test] 处置（断言预期值零变更）**：fake 的 `updateCardStream` 失败路径改为同步抛出（去掉该方法 `async` 关键字即可——渲染器同步重试路径同步告警，诚实成立；sendCard/send 保持 async）。不改则 1 it 恒红。
  - **【GAP 登记 1，Slice 8 或后续接线】eventBus 执行事件 → 任务卡片端到端缺 sessionKey 映射**：taskService 已补 execution:started/progress/completed 发布（本次新增，既有零回归）；server.js 已接线订阅 + `resolveSessionKey = e.variables?.spaceKey`——但工具面 task run（toolAdapter）未记录 originating spaceKey（执行行无空间字段），非对话执行（手动/定时）本就无会话 → 当前生产路径任务卡片不路由（渲染器 seam 全绿，端到端缺映射；对话下发的任务卡片随 Slice 8 补 spaceKey 记录或 REFLECT 评估）。
  - 挂起陷阱（Slice 6 教训）：本 slice 无命令执行/服务发现新 seam；server.js 惰性接线（ADR-009：首次事件才 createCardRenderer），imRouting/agentRoute 回归全绿佐证无副作用。

| PRD 意图项 | 实现文件 | 测试文件 | 覆盖 |
|---|---|---|---|
| REQ-AGENT-019 AC1 agent 流式输出 → 渲染器构建回复卡片 → sendCard → 增量经 updateCardStream 按序更新（sequence 递增，断言请求序列） | src/services/cardRenderer.js（createCardRenderer：handleStreamEvent 同步推进——首次 text_delta 发卡 + 每次增量/结束按累计全文派发更新，sequence 每事件 +1 严格递增）、src/services/channels/feishuChannelAdapter.js（sendCard/updateCardStream，H4 契约） | cardStream.test.js「流式输出 → sendCard + updateCardStream 按序更新」 | COVERED |
| REQ-AGENT-019 AC2 流式结束 → 卡片定型（停止更新）；流式错误 → 卡片标注失败状态 | cardRenderer.js（text_end → final=true 定型，后续事件丢弃；error → 内容追加【失败】+ reason + 定型） | cardStream.test.js「流式结束卡片定型；错误标注失败状态」 | COVERED |
| REQ-AGENT-019 AC3 流式窗口 10 分钟自动关闭（H4）→ 降级普通文本消息 + 提示可用 /status 查询 | cardRenderer.js（streamWindowMs 默认 10min 可注入；窗口过期 → adapter.send 降级消息（含 E-CARD-STREAM-CLOSED 提示文案）+ 定型丢弃后续增量） | cardStream.test.js「流式窗口 10 分钟关闭 → 降级普通消息 + /status 提示」 | COVERED |
| REQ-AGENT-019 接口契约：adapter sendCard({chatId, cardJson}) / updateCardStream({cardId, content, sequence})（sequence 严格递增）；CardKit streaming_mode | feishuChannelAdapter.js（sendCard：cardkit/v1/cards 建实体 + im/v1/messages interactive 发送 → {cardId}；updateCardStream：PUT cardkit/v1/cards/:id/elements/:element_id/content，content 1~100,000 校验 + sequence 正整数校验 + uuid 幂等；cardId 缺失竞态 → 跳过不报错——content 全量累计不丢内容）、channelManager.js（sendCard/updateCardStream 透传） | cardStream.test.js（fake 断言结构 + sequence） | COVERED（真实凭据联调待 QA，H4 已声明） |
| REQ-AGENT-020 AC1 flow 执行启动（eventBus 执行事件）→ 任务卡片发送；执行进度（状态/日志摘要/产物）增量更新卡片 | cardRenderer.js（handleExecutionEvent：started → 任务卡片（含 executionId）；progress → 追加日志/状态增量更新）、src/services/taskService.js（execution:started/progress 发布） | cardStream.test.js「执行启动 → 任务卡片；进度增量更新」 | COVERED（渲染器 seam + 事件发布；端到端 sessionKey 映射见 GAP 1） |
| REQ-AGENT-020 AC2 执行成功/失败 → 卡片终态（含执行 id，可 /status 复核） | cardRenderer.js（completed → 终态行含 executionId + status + /status 提示） | cardStream.test.js「…终态含执行 id」 | COVERED |
| REQ-AGENT-020 AC3 执行结果同时经对话回投（agent 生成摘要，若对话会话活跃） | cardRenderer.js（sessions[sessionKey]?.onExecutionResult(result) 同步调用，result 含 executionId/status/output） | cardStream.test.js「执行结果经对话回投（会话活跃时）」 | COVERED（sessions 注入 seam；agent 摘要生成 = agent turn 语义，REFLECT 人工验收） |
| REQ-AGENT-020 AC4 卡片更新失败（E-CHANNEL-SEND 重试耗尽）→ 告警日志，不阻断执行（回归 REQ-CHANNEL-003 语义） | cardRenderer.js（updateCardWithRetry：同步抛出 + promise 拒绝双路径重试（≤ retries），耗尽 → warnings 记录 E-CHANNEL-SEND；终态仍返回 {terminal:true}，流式/执行推进不阻断） | cardStream.test.js「卡片更新失败（重试耗尽）→ 告警不阻断执行」 | **PARTIAL（诚实实现下告警异步记录；测试同步断言 vs async fake 契约冲突——登记见验证记录，待父代理 [test] 裁决）** |
| PRD §6 数据流 3（下发任务 + 流式：对话 → task run → 执行开始 → eventBus 执行事件 + agent 流式事件 → 卡片渲染器 → 任务卡片流式更新 → 完成卡片） | cardRenderer.js + taskService.js（执行事件）+ imRouter.js（onSessionEvent：session-event → handleStreamEvent）+ server.js（惰性接线：执行事件订阅 + 回复卡片转发） | cardStream.test.js（渲染器 seam）+ imRouting/agentRoute 回归 | PARTIAL（数据流接线完整落地；执行→spaceKey 映射缺口见 GAP 1；真实飞书联调待 QA） |
| PRD §8 E-CARD-STREAM-CLOSED（流式窗口关闭 → 降级普通消息 + 提示 /status） | cardRenderer.js（窗口过期降级文案含 /status） | cardStream.test.js「流式窗口 10 分钟关闭 → 降级」 | COVERED |
| PRD §8 E-CHANNEL-SEND（卡片更新失败 → 告警重试 ≤3，不阻断对话/执行） | cardRenderer.js（retries 默认 3 + warnings 告警）+ feishuChannelAdapter.js（sendWithRetry ≤3 复用） | cardStream.test.js「告警不阻断执行」 | PARTIAL（同 AC4 冲突登记） |
| PRD §10 决策 F1（卡片能力入通道适配器：sendCard/updateCardStream；channelManager 唯一入口） | feishuChannelAdapter.js + channelManager.js（sendCard/updateCardStream 透传） | cardStream.test.js（fake 契约对齐）+ feishuChannel.test.js 回归 | COVERED |
| 签核决策 19（回复卡片：sendCard + sequence 严格递增；10 分钟窗口降级普通消息 + /status 提示） | cardRenderer.js + feishuChannelAdapter.js | cardStream.test.js（REQ-AGENT-019 三例） | COVERED |
| 签核决策 20（任务卡片：事件驱动、终态含 executionId；卡片失败不阻断执行（E-CHANNEL-SEND 告警）） | cardRenderer.js + taskService.js | cardStream.test.js（REQ-AGENT-020 三例） | PARTIAL（同 AC4 冲突登记） |
| H4 契约（spike-report）：cardkit.v1 端点、content 1~100,000、sequence 严格递增（300317）、流式期间不限流、10 分钟自动关闭 | feishuChannelAdapter.js（端点/校验按 H4）+ cardRenderer.js（窗口/上限常量） | 无独立断言（fake 断言结构；真实端点联调待 QA） | COVERED（实现按契约；联调 QA） |
| tech-design 会话卡片渲染器 → adapter（两类卡片：回复卡片、任务卡片；10 分钟窗口降级） | cardRenderer.js（两类卡片 + 降级路径） | cardStream.test.js | COVERED |

GAP 说明（本 slice 范围外，后续 slice 或 REFLECT 处理）：
- **【待裁决 1】cardStream「告警不阻断执行」warnings 同步断言 vs async fake 矛盾**：见验证记录契约冲突登记 1——诚实实现 = 异步告警；测试同步断言需 [test] 处置（fake updateCardStream 改同步抛出），断言预期值零变更。不改则 1 it 恒红。
- **【GAP 1】执行 → 对话空间（spaceKey）映射缺失**：taskService 执行事件已发布、server.js 已订阅，但工具面 task run 未记录 originating spaceKey（执行行无空间字段）→ 生产路径任务卡片不路由（`resolveSessionKey` 恒 undefined 时静默跳过，无副作用）。补法：toolAdapter task run 变量注入 spaceKey（Slice 8 或独立补全）。
- **真实飞书凭据联调**（sendCard/updateCardStream 端点、sequence 300317、10 分钟窗口行为）→ QA（H4 已声明「契约 PASS / 联调待 QA」）。
- **执行结果回投的 agent 摘要生成**：onExecutionResult seam 已就绪（回投含 executionId/status/output），「agent 生成自然语言摘要」属 agent turn 语义，REFLECT 人工验收。
- **卡片视觉/流式打字机效果**：纯审美判断，REFLECT 人工验收（test-plan.md 已显式接受）。




### Slice 8：绑定与确认（REQ-AGENT-014~016）——收口

- 状态：**complete**（commit 见下；userBinding 6/6 + confirmation 5/5 + commandReply 2/2（test-gap 补测）全绿；全量 514：509 绿 / 5 红——**5 红 = 父代理已登记裁决的断言级契约冲突（待父代理 [test] 就地补全，见「待父代理 [test] 处置」），无其他回归**；既有零意外回归）
- 验证记录（2026-08-04）：
  - **全量拒绝语义裁决落地（父代理拍板：以 userBinding.test.js 断言为准）**：无绑定态未绑定用户一切消息（含查询与命令）→ E-AUTH-NOT-BOUND（先于命令识别与会话分发，不创建会话行）；已绑定用户未配 key → 对话（非命令）回复 E-AGENT-NO-KEY 引导。E-AGENT-NO-KEY 路径语义 = 已绑定操作者未配 key（REQ-AGENT-002 接替）。
  - **绑定状态机完整化**：pendingBind（一次性 + 10 分钟有效期，签核修订②）与 boundOpenId 持久化于 settings JSON（跨实例可见，冒烟验证）；解绑/取消后重走引导；now 时钟注入断言。
  - **确认服务 + toolAdapter onConfirmRequest 接线（Slice 4 预留兑现）**：worker 工具面 confirm 级 → IPC confirm-request → 主进程确认服务入队（agent_confirmations pending + 确认卡片）→ confirm-request-ack → 工具返回 E-CONFIRM-PENDING（不执行）；确认回调驱动同一命令模块执行（executeToolCommand，C2）→ notify-result IPC → agent 自然语言回投（真实 spawn 冒烟：text_end 含执行结果）；confirmId 幂等；重启后 pending 可确认。
  - **G1 接线（Slice 5 登记兑现）**：buildToolContext（绑定默认目标候选）→ imRouter → createSession toolContext → session-config toolContext → worker 工具面 getDefaultTarget 惰性读取（task run 缺省目标注入）。冒烟：无 project-id/flow-id 的 task run 命中绑定 flow + trigger=dialogue。
  - **GAP 1 接线（Slice 7 登记兑现）**：toolAdapter task run 记录 originating spaceKey 到执行 variables（task.js run 透传 variables）→ 任务卡片路由激活（resolveSessionKey = variables.spaceKey）。冒烟：execution.variables.spaceKey = feishu:<chatId>。
  - **test-gap 补测（Slice 6 登记兑现）**：commandReply.test.js（imRouter 级）——真实 agentRouter（异步命令执行层）+ 真实 imRouter + mock 通道：查无此执行 / 格式化状态文本经 channel reply 回投。
  - **生产连接切换隐患修复（Slice 5 遗留，本 slice 接线暴露）**：getDb() 单连接按路径切换会关闭捕获引用（"database is not open"）——sessionStore 与 confirmationService 改为按操作 `getDb(dbPath)` 重取（路径一致时零开销）；确认回调（卡片点击）与任务卡片在跨库切换后仍可用（冒烟：approve 前先走 data.db 请求）。
  - **beginBinding 生产接线（Slice 6 前置依赖标注兑现）**：POST /api/settings/agent/binding/begin（+ cancel / DELETE 解绑；GET /api/settings/agent 含 binding 状态）——Settings「开始绑定」入口 → agentRouter.beginBinding；绑定成为命令/对话可用的解锁条件。

| PRD 意图项 | 实现文件 | 测试文件 | 覆盖 |
|---|---|---|---|
| REQ-AGENT-014 AC1 Settings 显示绑定状态 +「开始绑定」入口（置 pendingBind） | src/services/agentRouter.js（beginBinding：pendingBind { createdAt, expiresAt } 落 settings JSON）、src/http/routes/settings.js（POST /api/settings/agent/binding/begin + GET /api/settings/agent 含 binding） | userBinding.test.js「状态机…」（arming 断言）+ 冒烟（HTTP 端点） | COVERED |
| REQ-AGENT-014 AC2 置位后下一条未绑定消息 → 绑定发送者 + 清除标记 + 回复「绑定成功」；仅此一条生效 | agentRouter.js（bindingDecision：pendingBind 有效 + 未绑定 → boundOpenId=senderId + 清除 + 绑定成功回执；后续未绑定消息拒绝） | userBinding.test.js「状态机…」「pendingBind 一次性」 | COVERED |
| REQ-AGENT-014 AC3 未置 pendingBind 时未绑定消息 → 拒绝引导卡片（提示去 Settings），不执行绑定 | agentRouter.js（无绑定态 → E-AUTH-NOT-BOUND + 「请先在设置中绑定操作者」） | userBinding.test.js「未 arming 时未绑定消息 → 拒绝 + 引导卡片」 | COVERED |
| REQ-AGENT-014 AC4 已绑定可解绑（Settings），解绑回未绑定态可重走引导 | agentRouter.js（unbind：boundOpenId/pendingBind 清空）+ routes/settings.js（DELETE /api/settings/agent/binding） | userBinding.test.js「状态机…」（解绑重绑段）+ 冒烟 | COVERED |
| REQ-AGENT-014 AC5 pendingBind 有效期 10 分钟（签核修订②）/ 可取消 | agentRouter.js（PENDING_BIND_TTL_MS=10min；now 时钟注入；过期不生效；cancelBinding） | userBinding.test.js「pendingBind 有效期 10 分钟 / 取消」（clock 注入断言 ttl=600000） | COVERED |
| REQ-AGENT-015 AC1 未绑定用户一切消息（含查询）→ E-AUTH-NOT-BOUND，不启动会话不执行命令 | agentRouter.js（bindingDecision 无绑定态分支先于命令识别与 key 检查；agent_sessions 无行） | userBinding.test.js「未绑定用户一切消息（含查询）→ E-AUTH-NOT-BOUND，不启动会话不执行命令」（agent_sessions COUNT=0 断言） | COVERED |
| REQ-AGENT-015 AC2 拒绝先于命令识别与会话分发 | agentRouter.js（route 顺序 ①绑定检查 → ②命令 → ③key → ④分发；命令模块零调用） | userBinding.test.js「拒绝先于命令识别与会话分发」（commands.called=0） | COVERED |
| REQ-AGENT-016 AC1 confirm 级命令被工具适配器拦截 → confirm-request → 确认服务入队（pending）+ 确认卡片（命令摘要+确认/拒绝按钮）；agent 回复「操作待确认」 | src/services/confirmationService.js（submit：agent_confirmations INSERT + sendCard + replyText 待确认）、src/agent/toolAdapter.js（onConfirmRequest 拦截：pending → E-CONFIRM-PENDING 返回不执行）、src/agent/worker.js（confirm-request IPC 发送 + ack 等待）、src/services/agentService.js（confirm-request 处理 → 注入的 onConfirmRequest）、src/http/server.js（getConfirmationService 惰性工厂接线） | confirmation.test.js「confirm 级命令拦截 → 挂起队列 + 确认卡片 + agent 回复待确认」 | COVERED |
| REQ-AGENT-016 AC2 确认回调 → 确认服务驱动同一命令模块执行（不经 agent turn）→ notify-result 注入会话 → agent 自然语言回投 | confirmationService.js（approve：状态 approved → execute(row.command, args) → notifyResult）、toolAdapter.js（executeToolCommand 导出：同一 TOOL_DEFS 注册表 + 同一命令模块，C2）、agentService.js（notifyResult：IPC notify-result）、worker.js（handleNotifyResult：会话 prompt 回投）、server.js（execute=executeToolCommand / notifyResult=agentService） | confirmation.test.js「确认回调驱动执行（不经过 agent turn）+ notify-result 回投自然语言」+ 真实 spawn 冒烟（text_end 含执行结果） | COVERED |
| REQ-AGENT-016 AC3 拒绝 → 不执行 + 回投「已取消」 | confirmationService.js（reject：状态 rejected + notifyResult cancelled 回执） | confirmation.test.js「拒绝 → 不执行 + 回投已取消」 | COVERED |
| REQ-AGENT-016 AC4 confirmId 幂等：同一回调只执行一次 | confirmationService.js（approve/reject 非 pending 忽略；submit 重复 confirmId 返回既有状态） | confirmation.test.js「confirmId 幂等：重复回调只执行一次」 | COVERED |
| REQ-AGENT-016 AC5 挂起队列持久化（SQLite）：重启后 pending 项仍可确认 | db.js（agent_confirmations DDL，initSchema + migrateSchema + resetDb）、confirmationService.js（同库真相，重启新实例同路径可读） | confirmation.test.js「挂起队列持久化：重启后 pending 项仍可确认」（svc1/svc2 同 dbPath） | COVERED |
| PRD §6 数据流 4（高危确认解耦：拦截 → 挂起 → 确认卡片 → 回调驱动执行 → notify-result 注入 → 自然语言回投） | 见 REQ-AGENT-016 各行（主进程确认服务 + worker IPC + 工具面拦截全链路） | confirmation.test.js + 真实 spawn 冒烟 | COVERED（飞书卡片动作 → HTTP 端点桥接待 QA/REFLECT，见 GAP） |
| PRD §6 数据流 5（绑定 E3 + arming：Settings 引导 → 开始绑定置 pendingBind → 下一条消息绑定 → 回复成功 → Settings 显示已绑定 + 解绑） | agentRouter.js（完整状态机）+ routes/settings.js（begin/cancel/unbind/状态） | userBinding.test.js（5 例全路径）| COVERED |
| PRD §8 E-AUTH-NOT-BOUND（未绑定用户消息拒绝，含查询——读也拒） | agentRouter.js（无绑定态 + 已绑定态非绑定者统一拒绝） | userBinding.test.js（两 describe）| COVERED |
| PRD §8 E-CONFIRM-PENDING（高危确认挂起，操作不执行，幂等） | confirmationService.js（pending 语义）+ toolAdapter.js（E-CONFIRM-PENDING 返回） | confirmation.test.js + toolSurface 回归 | COVERED |
| PRD §8 E-AGENT-NO-KEY（对话引导文案，不启动会话）——**Slice 8 裁决后语义 = 已绑定用户未配 key** | agentRouter.js（③key 检查在绑定检查之后：已绑定未配 key → 引导） | 无独立绿断言（agentConfig「E-AGENT-NO-KEY」例为未绑定用户——契约冲突登记，待 [test] bindUser 后转绿） | **PARTIAL（实现完成；断言前置绑定待父代理 [test]）** |
| PRD §8 E-AGENT-CLI-ERROR（确认执行失败 → 错误回投对话） | confirmationService.js（approve 执行失败 → error 结果仍 notifyResult） | 无独立断言（失败注入难；语义经 execute 抛错路径实现） | PARTIAL（实现完成；注入断言待评估） |
| 签核决策 8（未绑定拒绝先于命令识别）/ 9（pendingBind 一次性 + 10 分钟 + 可取消）/ 10（解绑重绑）/ 18（确认解耦 + confirmId 幂等 + 重启可确认） | agentRouter.js / confirmationService.js | userBinding.test.js + confirmation.test.js | COVERED |
| tech-design E3（发消息即绑定）/ b（确认与执行解耦，SQLite 真相）/ W-1（pendingBind arming）/ W-2（notify-result 回投自然语言） | 见上各行 | 见上各行 | COVERED |
| Slice 4 登记（confirm 级拦截未接线 → Slice 8 确认服务） | toolAdapter.js onConfirmRequest（接线）+ worker IPC + server.js 确认服务 | confirmation.test.js + toolSurface 回归（未注入拦截器时行为不变） | COVERED |
| Slice 6 前置依赖标注（beginBinding 零调用方 → 生产命令全部 E-AUTH-NOT-BOUND）→ 接线解锁 | routes/settings.js（binding begin/cancel/DELETE 端点）+ server.js（agentRouter 上下文传入） | 冒烟（HTTP 端点全流程）+ userBinding.test.js | COVERED |
| Slice 5 G1 登记（buildToolContext 无生产消费方 → 注入工具上下文） | imRouter.js（dialogue → buildToolContext → createSession toolContext）、agentService.js（toolContext 句柄 + buildConfigMessage 携带 + 变更重发）、worker.js（toolContexts 惰性读取）、toolAdapter.js（getDefaultTarget：task run 缺省目标注入；argsSchema 放宽 project-id/flow-id 非必填） | 冒烟（无目标 task run 命中绑定 flow）| COVERED（无独立业务断言——REQ-AGENT-017 标准 2 断言仅覆盖 buildToolContext 本身；生产消费冒烟验证） |
| Slice 7 GAP 1 登记（task run 未记录 spaceKey → 任务卡片不路由）→ 接线 | toolAdapter.js（task run 注入 variables.spaceKey）、src/cli/commands/task.js（run 透传 variables） | 冒烟（execution.variables.spaceKey = feishu:<chatId>）| COVERED（生产路径激活；卡片端到端随 QA） |
| Slice 6 test-gap 登记（U2 commandReply 回投 + 查无此执行无 imRouter 级断言）→ 补测 | 无实现变更（Slice 6 已实现）；新增测试文件 | commandReply.test.js（2 it：异步执行层查无此执行 / 格式化状态文本经 channel reply 回投） | COVERED |
| Slice 5 遗留隐患（getDb 单连接路径切换关闭捕获引用） | sessionStore.js（db() 按操作重取）、confirmationService.js（同模式） | 冒烟（approve 前跨库切换仍可确认）+ 既有 509 回归全绿 | COVERED（冒烟；无独立业务断言——连接切换难在业务测试注入） |

GAP 说明（本 slice 范围外，后续或 REFLECT 处理）：
- **【待父代理 [test] 处置，5 例红——父代理裁决的直接后果（断言预期值零变更的接替/前置）】**：
  1. `agentConfig.test.js`「未配置 key 时 agent 对话回复 E-AGENT-NO-KEY」：无绑定态未绑定用户 → 现为 E-AUTH-NOT-BOUND（REQ-AGENT-015 优先，父代理裁决）。**建议**：route 前加 `bindUser(router, "ou_1")`（同文件已声明 bindUser helper）——测试意图（未配 key → E-AGENT-NO-KEY 引导）在已绑定用户下完整成立。
  2. `agentRoute.test.js` REQ-AGENT-018 三例（空间 key / 群聊发言 / 下发 session-config）：已绑定用户未配 key → 现为 E-AGENT-NO-KEY（裁决：已绑定未配 key → 引导）。**建议**：beforeEach 内 `PUT /api/settings/agent` 配置 provider+apiKey（session-config 断言改验真实 key）或断言改 E-AGENT-NO-KEY。
  3. `imRouting.test.js` AC6：未绑定用户 → 现回 E-AUTH-NOT-BOUND「绑定操作者」。**建议**：断言改 E-AUTH-NOT-BOUND 文案（测试意图 = 接替语义：消息进 agent 路由、不 createTask，保持不变）。
- **飞书卡片动作 → 确认回调端点（POST /api/agent/confirmations/:id/approve|reject）桥接**：卡片按钮 value 已携带 confirmId + decision，HTTP 端点已就绪；WS 事件分发（真实卡片点击）属通道集成，QA/REFLECT 验收。
- **确认执行失败注入断言**：execute 抛错路径已实现（错误结果仍回投）；失败注入业务断言待评估（参考 E-SESSION-PERSIST 冒烟模式）。
- **会话工具上下文（G1）变更传播**：toolContext 在会话创建/重发时下发；创建后绑定变更 → 下一次会话重建（provider/key 变更或 /reset）生效（默认目标候选为建议性提示，stale 可接受；REFLECT 可评估热更新）。
- **真实供应商确认链路联调**（LLM 发起 confirm 工具调用 → 卡片 → 点击）→ QA（faux 模式不调用工具，业务断言在服务层 seam 全覆盖）。

---

## Slice 9: Settings 页 tab 化与分区保存（REQ-AGENT-023~025，S10）

- 开始：2026-08-05
- REQ：REQ-AGENT-023（tab 化结构）/ REQ-AGENT-024（分区独立保存去全局保存）/ REQ-AGENT-025（切换保留未保存编辑）
- 测试契约：`tests/capabilities/agent-dialogue/settings/2026-08-02-builtin-agent/e2e/settingsTabs.test.cjs`（11 例，ASSERTIONS-SIGNED: true）+ 三签名套件导航适配（themeLanguage/onboarding/versionDisplay）
- UX 参照：`ux/settings-tabs.html`（approved）
- 实现范围：`src/renderer/pages/Settings.jsx` + i18n 文案 + （如需）样式
- 完成：2026-08-05（implementer subagent）

### PRD→代码 可追溯性表（Slice 9）

| 验收标准 | 实现 | 测试 | 状态 |
|---|---|---|---|
| REQ-AGENT-023 AC1 四 tab + tablist/tab aria 语义 + aria-selected 联动 + 面板显隐 | Settings.jsx（SETTINGS_TABS 常量 + activeTab state + [role='tablist']/[role='tab'][data-tab]/[data-tab-panel] hidden 渲染）；index.css（.tab-bar/.tab-btn/[data-tab-panel][hidden]） | settingsTabs「tab 栏四 tab + aria 语义 + 默认通用选中」「点击 tab 切换面板显隐与 aria-selected 联动」 | COVERED |
| REQ-AGENT-023 AC2 默认通用 tab + 各区归入对应 tab | Settings.jsx（activeTab 初值 "general"；workspace/appearance 卡片入 general 面板、agent-settings-card 入 agent、channel-settings-card 入 channel、update-section 入 about） | settingsTabs「各区内容归入对应 tab」+ 上两条 | COVERED |
| REQ-AGENT-023 AC3 API key placeholder「已加密存储，输入则更换」（zh-CN）+ key 不回显不变 | i18n zh-CN/en-US `settings.agent.apiKeyPlaceholder`；Settings.jsx agent-api-key-input placeholder（en-US 按惯例直译："Encrypted and stored; enter a new key to replace it"） | settingsTabs「tab 中文文案与 API key placeholder（zh-CN）」 | COVERED（en-US 译文观感 → REFLECT 人工验收，签核裁决 2） |
| REQ-AGENT-023 AC4 现存 Settings E2E 适配 tab 导航 | （测试侧接替，无实现改动） | themeLanguage 4/4、onboarding 7/7、versionDisplay 3/3（95c2e0a 适配）+ settingsChannel 3/3（ce90cc4 父代理补 SETTINGS_TAB_CHANNEL 点击，同一 AC4 模式，断言语义不变）——四套件父代理独立复跑全绿 | COVERED |
| REQ-AGENT-024 AC1 全局保存移除 + 三可编辑 tab 区内独立保存 + 关于 tab 只读 | Settings.jsx（删除 page-header 内 save-settings-button；general 面板底部 save-general-settings-button；agent/channel 区沿用 save-agent-config-button/save-channel-credentials-button；about 面板无任何 save 按钮） | settingsTabs「全局保存移除，分区保存各就各位，关于 tab 只读」 | COVERED |
| REQ-AGENT-024 AC2 通用保存仅提交通用字段（无 agent/channelCredentials/apiKey）+ 区内成功反馈 | Settings.jsx handleSubmit（PATCH 体 = workspaceRoot/skillRepoPath/theme/language/density 五字段）+ generalSuccess state + general-settings-success 元素（i18n settings.saved） | settingsTabs「通用保存请求体仅含通用字段，区内显示成功反馈」（拦截 PATCH 断言请求体） | COVERED |
| REQ-AGENT-024 AC3 Agent 保存 keepExistingKey（未输新 key 不含 apiKey）+ 身份一并保存 + 徽章一致 | 未动（handleSaveAgent 一行未改，slice 4 实现沿用） | settingsTabs「Agent 保存 keepExistingKey——未输新 key 请求体不含 apiKey」 | COVERED |
| REQ-AGENT-024 AC4 飞书通道保存语义不变（appId/appSecret）+ 区内成功反馈 | 未动（handleSaveChannel 沿用） | settingsTabs「飞书通道保存提交 appId/appSecret，区内显示成功反馈」（mock 201） | COVERED |
| REQ-AGENT-024 AC5 保存失败沿用各区现有错误提示路径，无新错误码 | 未动（agentError/channelError/saveError 均沿用；saveError 随通用区迁入 general 面板内显示） | settingsTabs「Agent 保存失败，错误显示在 Agent tab 区内」 | COVERED |
| REQ-AGENT-025 AC1 未保存编辑跨 tab 保留且不生效 | Settings.jsx（四面板常驻挂载、仅 hidden 切显隐；表单 state 全在组件内；主题等仅在保存后经 useSettings applyToDocument 生效） | settingsTabs「未保存编辑跨 tab 切换保留且不生效」（主题/身份双区断言 + data-theme 不变） | COVERED |
| REQ-AGENT-025 AC2 tab 切换不触发任何保存请求 | Settings.jsx（tab onClick 仅 setActiveTab，零网络副作用） | settingsTabs「tab 切换不触发任何保存请求」（request 监听非 GET = []） | COVERED |

### 已知 UX 偏差（对照 ux/settings-tabs.html；均非结构/行为偏差，归 REFLECT 人工验收）

1. **通用 tab 保留两张现有卡片**（工作区 + 外观），未按原型合并为单张「通用」卡片；字段集合与 AC2 完全一致，卡片合并属观感优化。
2. **关于 tab 保留现有 update-section 布局**（版本/数据目录/检查更新/引导文案），未改原型 about-row 两列样式；结构与旧版一致。
3. **通用保存成功反馈为持久显示**（再次编辑或保存时清除），未实现原型 2s 淡出动效。
4. **面板 DOM 顺序为 agent/channel/general/about**（边界编辑保卡片原样所致）；任一时刻仅一个面板可见，无用户可见影响。
5. tab 栏下划线选中态已按原型落 --ch-* token（.tab-bar/.tab-btn），间距/动效曲线细节属签核备注的 REFLECT 人工验收项。

### 环境备注

- E2E 前置：better-sqlite3 需 Electron ABI（`npm run rebuild:electron`）；test:unit 会重建为 Node ABI，混跑前需按 `npm run test:e2e` 惯例先 rebuild，否则 E2E 报 E-DB-UNWRITABLE（本 slice 验证期间实测，与实现无关，基线可复现）。

Slice 9: complete (1a10f46..5e3efd9, 父代理独立验证：单元 525/525 + E2E 五套件 28/28 绿；settingsChannel 清单外回归由父代理 [test] ce90cc4 适配收口)
Slice 9: PRD alignment passed (ALIGNED，REQ-AGENT-023~025 全 AC COVERED，零缺口；S10 决策 7/7；既有保存语义 diff 零触碰)
Slice 9: refactor pass done (5e3efd9..0259f7f, TabPanel 容器提取 + 缩进对齐 + 死 CSS 删除；父代理复验 E2E 28/28 + 单元 525/525，无回滚)
