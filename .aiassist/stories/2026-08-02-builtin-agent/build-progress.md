# Build Progress — 2026-08-02-builtin-agent

> 由 /implementer 维护。父代理调度、子代理实现、父代理验证。

## 切片计划（8 slices，依赖序）

| Slice | 内容 | REQ-ID | PRD 里程碑 | 状态 |
|---|---|---|---|---|
| 1 | 配置与身份（供应商/key/身份 + session-config IPC） | REQ-AGENT-001~004 | M1 | complete |
| 2 | agent 进程与对话内核（看门狗/回路/LLM 错误） | REQ-AGENT-005~007 | M1 | complete |
| 3 | 会话存储与恢复（空间模型/恢复/重置/压缩） | REQ-AGENT-008~011 | M1 | complete |
| 4 | 工具面（riskLevel 注入 + release 拒绝） | REQ-AGENT-012~013 | M1 | pending |
| 5 | 路由与飞书入口（agent 优先 + 群聊语义） | REQ-AGENT-017~018 | M1 | pending |
| 6 | 命令直通 | REQ-AGENT-021~022 | M3 | pending |
| 7 | 卡片流式 | REQ-AGENT-019~020 | M2 | pending |
| 8 | 绑定与确认 | REQ-AGENT-014~016 | M3 | pending |

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
| REQ-AGENT-008 AC4 消息经 PI JSONL 持久化（message_end 落盘）；平台侧不复制全文（B1） | agentService.js 内存内核（appendJsonlMessage：PI 兼容 message 行，仅注入 store 时落盘）、worker.js（PI 原生落盘）、sessionStore.js（表无消息列） | sessionStore.test.js「对话消息经 PI JSONL 持久化，平台侧不复制全文」 | COVERED |
| REQ-AGENT-009 AC1 应用/子进程重启后按 agent_sessions.sessionRef + SessionManager.open 恢复；恢复后引用重启前上下文 | agentService.js（ready 水合：store.list → getOrCreate → 重建句柄 + 重发 session-config）、worker.js（已有 JSONL → SessionManager.open） | sessionRestore.test.js「重启后按 agent_sessions + SessionManager.open 恢复上下文」（问「刚才的任务」回复含日报） | COVERED |
| REQ-AGENT-009 AC2 JSONL 缺失/损坏 → 新建会话 + 提示「历史不可恢复」，不阻塞对话 | sessionStore.js getOrCreate（缺失 → 世代 +1 重建 + recoveryHint）、agentService.js（水合句柄带 recoveryHint） | sessionRestore.test.js「JSONL 缺失/损坏 → 新建会话 + 提示历史不可恢复，不阻塞对话」 | COVERED（缺失路径；损坏 = 存在但不可解析 → worker open 失败回 E-AGENT-RUNTIME 兜底，见 GAP） |
| REQ-AGENT-010 AC1 /reset 当前空间上下文清空（新建 JSONL/清引用）；AC2 其他空间不受影响；AC3 重置后首条消息无历史 | sessionStore.js reset（世代 +1 + 新 JSONL + summaryRef 清空 + onReset 通知）、agentService.js（内存内核监听清 context；进程路径：IPC reset-session + 句柄换代 + 重新 session-config）、worker.js（reset-session dispose + 删除） | sessionStore.test.js「/reset 清空当前空间上下文，其他空间不受影响」 | COVERED |
| REQ-AGENT-011 AC1 超过压缩阈值 → 旧消息折叠为摘要注入，关键实体不丢 | agentService.js 内存内核（compressIfNeeded：compressionThreshold 服务级常量可注入 + summarize 会话级注入断言；默认确定性截断） | sessionStore.test.js「超过阈值 → 旧消息折叠为摘要注入，关键信息不丢」 | COVERED（内存内核 seam；worker 平台侧压缩见 GAP） |
| REQ-AGENT-011 AC2 压缩后 agent_sessions.summaryRef 更新；对用户无感（不打断对话） | sessionStore.js updateSummaryRef、agentService.js compressIfNeeded（折叠后写 summaryRef） | sessionStore.test.js「压缩后 summaryRef 更新且对用户无感」 | COVERED |
| REQ-AGENT-011 AC3 压缩由平台侧逻辑驱动（PI 无原生摘要），实现可注入断言 | agentService.js（平台侧驱动 + summarize 注入 + 确定性默认摘要器） | sessionStore.test.js（两例） | COVERED |
| PRD §6 操作流步骤 7（/reset 重置当前对话空间会话） | 见 REQ-AGENT-010 行（存储 + IPC reset-session 已就绪；斜杠命令入口层归 Slice 6） | sessionStore.test.js | COVERED（存储侧；命令直通 Slice 6） |
| PRD §6 操作流步骤 8（应用重启后继续对话，session 从 SQLite 恢复，上下文延续） | 见 REQ-AGENT-009 行 | sessionRestore.test.js | COVERED |
| PRD §6.2 分支「对话过长触发压缩 → 旧上下文滚动摘要化（用户无感）」 | 见 REQ-AGENT-011 行 | sessionStore.test.js | COVERED |
| PRD §8 错误状态：E-SESSION-PERSIST（SQLite 写入失败 → 对话可用、重启不恢复、告警） | sessionStore.js（sessionDir 缺失抛 E-SESSION-PERSIST）、agentService.js（store 异常向上冒泡由调用方降级） | 无独立断言 | PARTIAL（错误码已定义；本地 SQLite 写失败难注入，REFLECT 人工验收） |
| PRD §8 错误状态：E-AGENT-RUNTIME（恢复失败 → 错误回复 + 会话可重建） | worker.js（session-config 失败 → session-error E-AGENT-RUNTIME，既有） | 无独立断言（看门狗重启覆盖重建路径） | PARTIAL（同 Slice 2 登记；JSONL 损坏分支见 GAP） |
| 签核决策 11（空间 key = feishu:<chatId>，唯一） | sessionStore.js（spaceKey 原样存储 + 主键唯一约束） | sessionStore.test.js（feishu:oc_* 用例） | COVERED |
| 签核决策 16（SessionManager.open 恢复；JSONL 缺失 → 新建 + 提示） | worker.js（open/create 分派）、sessionStore.js getOrCreate | sessionRestore.test.js 两例 | COVERED |
| 签核决策 17（/reset 仅当前空间；压缩阈值实现常量可注入断言） | 见 REQ-AGENT-010/011 行 | sessionStore.test.js | COVERED |
| 签核决策 5（key 不进日志/IPC 会话文件）——本 slice 不新增 secret 面 | worker.js（key 仅内存 + redact）、agentService.js（水合句柄不带 key 明文） | agentProcess.test.js「stderr 不含 key」（回归） | COVERED |
| 实现者测试缝契约（ModelRuntime authPath 重定向 / SessionManager.create(cwd, sessionDir) / SessionManager.open / fauxProvider 注入） | worker.js（既有）+ 本 slice 恢复路径复用 | sessionRestore.test.js + agentProcess.test.js（回归） | COVERED |
| H2 假设（会话目录自定义 + SessionManager.open 恢复上下文） | worker.js + sessionStore.js | sessionRestore.test.js（真实子进程两次启动） | COVERED |
| Slice 2 concern：cancel / reset-session IPC 未实现 → 本 slice 实现 reset 路径（IPC reset-session + worker 侧处理） | agentService.js（handleReset：IPC reset-session 发送 + 句柄世代换代 + 重发 session-config）、worker.js（reset-session dispose + 删除 + lastReplies 清理） | 无独立业务断言（重置存储语义经 sessionStore.test.js 覆盖；IPC 端到端随 Slice 6 /reset 命令直通集成） | PARTIAL（实现完成；端到端断言随 Slice 6） |
| 测试 seam 契约：prompt() 解析值含本轮回复文本（restore 断言「回复引用重启前上下文」） | agentService.js（prompt-result reply 透传 / 内存内核 reply 收集）、worker.js（lastReplies 收集 text_end.content + prompt-result.reply） | sessionRestore.test.js「…恢复上下文」 | COVERED |

GAP 说明（本 slice 范围外，后续 slice 或 REFLECT 处理）：
- worker（真实子进程）侧平台压缩未实现：压缩 seam 在内存内核（阈值/summarize 可注入，已测试）；真实路径由 PI 原生 overflow compaction 兜底，平台侧压缩指令（IPC）未建——REQ-AGENT-011 覆盖度 = 内存内核 seam。
- JSONL 损坏（存在但不可解析）→ worker SessionManager.open 失败 → session-error E-AGENT-RUNTIME（会话不可用），未走「新建 + 提示」路径；REQ-AGENT-009 AC2「缺失/损坏」的损坏分支 PARTIAL（测试仅覆盖缺失）。
- 水合会话的 API key 注入：应用重启后 keySecrets 为空，水合句柄按 settings provider 重建且不带 key（FAUX seam 覆盖测试）；真实供应商恢复对话的凭证注入属生产接线（Slice 5）。
- 默认 sessionStore 库路径 = `<cwd>/.agent-home/agent-sessions.db`（随 cwd 隔离，测试不污染 ~/.opc-workstation/data.db）；生产接线由主进程注入应用库（Slice 5）。
- E-SESSION-PERSIST 写失败降级路径无注入断言（本地 SQLite 写失败难注入），REFLECT 人工验收。
- 修复父代理遗留：Slice 2 追溯表原误挂于「Slice 3」标题下，已改归「Slice 2：可追溯性表」。

