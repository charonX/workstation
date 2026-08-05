# 需求规格 — 内置对话 Agent（飞书入口）

> Story: `2026-08-02-builtin-agent`
> 版本: v1（2026-08-03，/crystallize）
> 增量: REQ-AGENT-023~025（2026-08-05，PRD 稳定块 S10「Settings 页 tab 化与分区保存」结晶，UX 参照 ux/settings-tabs.html 已拍板）
> 输入: PRD v0.3 + tech-design v1.1 + ADR-013/014 + CONTEXT.md（2026-08-03 登记）

## 契约修订声明（REQ-CHANNEL-002 接替）

本 story 拍板 **agent 优先路由**（2026-08-03），对已签核契约 REQ-CHANNEL-002（2026-07-19-media-production-line）的触发语义做显式接替：

- 旧语义：IM 消息命中 `channel_bindings` → `createTask` 直接触发绑定 flow。
- 新语义：IM 消息**全量进 agent 对话**（REQ-AGENT-017 路由），`channel_bindings` 不再直接触发，降级为 agent 下发任务的**默认目标候选**。
- 旧 REQ-CHANNEL-002 验收标准 2（绑定 → createTask）由 REQ-AGENT-017 接替；去重（验收标准 1）、3 秒回调返回（验收标准 5）保留复用。
- 绑定 flow 的触发能力仍存在（经 agent 识别下发意图，trigger="dialogue"），旧绑定用户在 agent 场景下行为变化在 REFLECT 人工验收确认。

## 假设与验证方式（spike 1~4，signoff 前置验证项）

以下假设在 BUILD 前必须经 spike 验证，结论记录于 signoff 检查项；失败则回流 TECH-DESIGN：

| # | 假设 | 涉及 REQ | 验证方式 |
|---|---|---|---|
| H1 | asar 打包下 agent 子进程入口可 spawn（解包 or 独立入口） | REQ-AGENT-005 | 打包后实际 spawn 冒烟 |
| H2 | PI 会话目录可自定义（避开 `~/.pi`）且 `SessionManager.open` 可恢复上下文 | REQ-AGENT-009 | spike 脚本：创建→崩溃→恢复 |
| H3 | `fauxProvider()` 可注入 `createAgentSession`（测试 seam） | REQ-AGENT-006 | 最小示例：faux 流式对话 |
| H4 | CardKit 卡片流式最小调用可用（发送 + sequence 递增更新 + 10 分钟窗口） | REQ-AGENT-019/020 | spike 脚本：卡片生命周期 |

## REQ-AGENT-001 供应商与 API key 配置

- 优先级 P0 / 必须 / intra-module / settings, agentService / agent-dialogue / settings / 单元+E2E
- 验收标准：
  1. Settings Agent 区供应商选择器枚举 `deepseek`（DeepSeek 官方端点）、`moonshotai`（Kimi 海外）、`moonshotai-cn`（Kimi 国内），切换时校验对应 key 格式。
  2. API key 经 Electron `safeStorage` 加密存储；`settings.json` 及其快照中**无明文 key**；key 值不进入日志与 IPC 会话文件。
  3. key 校验：仅**非空**（前缀不校验——key 准确性由用户负责，2026-08-03 签核拍板）；空 key 报 `E-CONFIG-INVALID`。
  4. 保存支持"测试连接"（对当前供应商发最小校验请求），失败报 `E-AGENT-LLM-FAIL` 透传原因；测试连接失败不阻止保存（仅提示）。
  5. 配置状态可查（已配置/未配置 + 供应商名），HTTP API 暴露读取/保存端点。
- seam/测试：`tests/capabilities/agent-dialogue/settings/2026-08-02-builtin-agent/api/agentConfig.test.js`（safeStorage fake 断言密文）+ E2E Settings 页。

## REQ-AGENT-002 key 缺失引导

- 优先级 P0 / 必须 / intra-module / agentRouter, settingsService / agent-dialogue / settings / 单元
- 验收标准：
  1. 未配置 key 时，agent 对话（非命令消息）回复引导文案 `E-AGENT-NO-KEY`（指向 Settings Agent 区），不启动 agent 会话。
  2. 斜杠命令直通（/status /list /reset /help）在未配 key 时**照常可用**（不依赖 LLM）。
- seam/测试：同 REQ-AGENT-001 目录。

## REQ-AGENT-003 内置基础身份

- 优先级 P0 / 必须 / intra-module / agent 子进程, agentService / agent-dialogue / settings / 单元
- 验收标准：
  1. 内置 system prompt 恒注入：平台助手身份 + 工具面说明（CLI 命令清单与用法）+ 行为规则（授权边界、高危需确认、进度流式汇报、查询优先）。
  2. 内置身份经 `session-config` 在会话创建/配置变更时下发子进程；子进程以 `systemPromptOverride` 生效（PI SDK 支持项）。
  3. 内置身份内容不含 secret（key 永不在 system prompt 中）。
- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-02-builtin-agent/api/systemPrompt.test.js`（agent 适配层注入断言）。

## REQ-AGENT-004 全局自定义身份

- 优先级 P0 / 必须 / cross-module / settings, agentService, agent 子进程 / agent-dialogue / settings / 单元+集成
- 接口契约：`session-config { systemPrompt }`（tech-design IPC）。
- 验收标准：
  1. Settings Agent 区可输入自定义身份（名称/语气/额外指令），≤2000 字符，可空（空=仅内置身份）；超长报 `E-CONFIG-INVALID`。
  2. 保存后经 `session-config` 热更新存量会话（子进程回 `config-ack`）；provider/key 未变则**不重建**会话上下文。
  3. 自定义身份与内置身份拼接顺序固定（内置在前，自定义在后），可注入断言验证最终 system prompt 内容。
- seam/测试：同上目录 + 集成（session-config 消息断言）。

## REQ-AGENT-005 agent 子进程生命周期（看门狗）

- 优先级 P0 / 必须 / cross-module / agentService, agent 子进程 / agent-dialogue / conversation-space / 集成
- 接口契约：IPC 心跳 `ping/pong`（tech-design IPC 语义）。
- 验收标准：
  1. 主进程 spawn agent 子进程（H1 假设：asar 打包路径可 spawn）；子进程就绪后回 `ready`。
  2. 心跳超时或子进程 exit（任何退出码）→ 看门狗判定崩溃 → 自动重启子进程。
  3. 重启后各活跃空间按 `agent_sessions` 引用 + JSONL 恢复（`SessionManager.open`），只丢崩溃时流式中的半条消息（有断言）。
  4. 重启期间到达的 prompt 返回 `session-error {code:"restarting"}` 并提示稍后重发（2026-08-04 签核就地补全：不做缓存自动重投——重启窗口短、手动重发可接受；原"缓存+就绪后重投"语义由本修订接替）。
  5. 子进程异常日志（stderr）进主进程日志，不包含 key 值。
- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-02-builtin-agent/api/agentProcess.test.js`（真实 spawn + kill 断言重启恢复）。

## REQ-AGENT-006 对话回路与流式事件

- 优先级 P0 / 必须 / cross-module / agent 子进程, agentService, 会话卡片渲染器 / agent-dialogue / conversation-space / 单元+集成
- 接口契约：IPC `prompt` / `session-event`（tech-design IPC）。
- 验收标准：
  1. `prompt` 到达子进程 → PI `AgentSession` 处理（H3 假设：fauxProvider 注入）→ 回复文本经 `session-event` 回传主进程。
  2. 同空间并发 prompt **排队串行**（`streamingBehavior: followUp` 语义）；跨空间并行互不阻塞（有断言）。
  3. 流式增量事件（`text_delta`）按序回传，主进程按序消费。
  4. 工具调用事件（`tool_execution_*`）含工具名与状态，可供卡片渲染器展示。
  5. 单条 IPC 消息 ≤ 256KB；超限截断或降级文件引用（有断言）。
- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-02-builtin-agent/api/agentDialogue.test.js`（fauxProvider + 内存版 IPC 快速路径）+ 集成（真子进程慢速路径）。

## REQ-AGENT-007 LLM 错误结构化

- 优先级 P0 / 必须 / intra-module / agent 子进程 / agent-dialogue / conversation-space / 单元
- 验收标准：
  1. 供应商失败/超时/限流（429 等）→ 编码为 `session-event` 错误消息（`E-AGENT-LLM-FAIL` 透传原因），agent 会话存活可继续；进程不崩。
  2. pi 内置重试语义生效（408/409/429/5xx 重试、尊重 retry-after）；重试耗尽后进入错误消息路径。
  3. 错误响应含可展示给用户的文案与内部错误码（区分业务/系统错误）。
- seam/测试：同上目录（fauxProvider 注入失败响应）。

## REQ-AGENT-008 对话空间模型与持久化

- 优先级 P0 / 必须 / cross-module / sessionStore, agentService / agent-dialogue / conversation-space / 单元
- 接口契约：`agent_sessions` 表（spaceKey/sessionRef/createdAt/lastActiveAt/summaryRef）；spaceKey 规范 `feishu:<chatId>`。
- 验收标准：
  1. `agent_sessions` 表结构如上；spaceKey 唯一；SQLite 为**真相**，主进程会话注册表仅为活跃句柄缓存（崩溃重启后从表重建）。
  2. 空间首次对话 → 建表行 + 创建 PI 会话（JSONL 落自定义目录，H2 假设）；已有空间 → 复用/恢复。
  3. 空间间上下文隔离断言：A 空间对话历史不进入 B 空间的 prompt 上下文。
  4. 对话消息经 PI JSONL 持久化（`message_end` 落盘）；平台侧不复制消息全文（B1）。
- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-02-builtin-agent/api/sessionStore.test.js`（临时 SQLite）+ 隔离集成断言。

## REQ-AGENT-009 会话恢复

- 优先级 P0 / 必须 / cross-module / sessionStore, agent 子进程 / agent-dialogue / conversation-space / 集成
- 验收标准：
  1. 应用/子进程重启后，按 `agent_sessions.sessionRef` + `SessionManager.open` 恢复上下文（H2 假设验证）；恢复后对话能引用重启前的上下文（有断言：问"刚才的任务"得到正确回应）。
  2. 恢复失败（JSONL 缺失/损坏）→ 新建会话 + 提示用户"历史不可恢复"，不阻塞对话。
- seam/测试：同上目录（真实子进程 + 临时目录，重启两次断言）。

## REQ-AGENT-010 显式重置会话

- 优先级 P0 / 必须 / intra-module / agentRouter, agentService / agent-dialogue / conversation-space / 单元
- 验收标准：
  1. `/reset` 后当前空间会话上下文清空（新建 JSONL 或清空引用），回复确认"已重置"。
  2. 重置仅作用于当前对话空间，其他空间不受影响。
  3. 重置后首条消息不携带任何历史上下文（注入断言）。
- seam/测试：同上目录。

## REQ-AGENT-011 滚动摘要压缩

- 优先级 P1 / 应该 / intra-module / agent 子进程, agentService / agent-dialogue / conversation-space / 单元
- 验收标准：
  1. 对话上下文超过压缩阈值（H 假设：token 预算阈值，实现常量可配）→ 旧消息折叠为摘要注入后续 prompt，回复语义不丢关键信息（注入断言：摘要含关键实体）。
  2. 压缩后 `agent_sessions.summaryRef` 更新；压缩过程对用户无感（不打断对话）。
  3. 压缩由平台侧逻辑驱动（PI 无原生摘要，复用 LLM 单轮摘要或确定性截断，实现自选但必须可注入断言）。
- seam/测试：同上目录。

## REQ-AGENT-012 工具面全量命令与风险等级

- 优先级 P0 / 必须 / cross-module / CLI 命令模块, agent 子进程 / agent-dialogue / conversation-space / 单元+集成
- 接口契约：命令模块导出 `riskLevel: "query" | "dispatch" | "confirm"`（PRD §7.2 映射表）；工具适配器按等级分流。
- 验收标准：
  1. 除 `release` 外全部 CLI 命令作为 PI 工具注入 agent（命令清单 = 现有 commands 目录全量）；工具定义含命令、参数 schema、风险等级。
  2. `riskLevel` 声明齐全且与 PRD §7.2 映射一致（query：task list/get、flow list/get 等；dispatch：task run；confirm：source delete、settings set、channel bind 等；release 不注入）。
  3. 工具执行走 C2 链路：进程内 import 命令模块 → HTTP API（ADR-001）→ services；返回结构化结果（输出/错误码）。
  4. 工具失败 → `tool_execution_*` 错误事件回传对话，agent 可继续（不崩）。
- seam/测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-02-builtin-agent/api/toolSurface.test.js`（工具清单断言 + 每等级抽样执行）。

## REQ-AGENT-013 release 拒绝

- 优先级 P0 / 必须 / intra-module / 工具适配器 / agent-dialogue / conversation-space / 单元
- 验收标准：
  1. `release` 命令不在 agent 工具面内（注入清单断言不含 release）；agent 尝试执行 → 明确拒绝回复"不支持该操作"。
- seam/测试：同上目录。

## REQ-AGENT-014 用户绑定（E3 + arming）

- 优先级 P0 / 必须 / cross-module / agentRouter, settingsService / agent-dialogue / user-binding / 单元+集成
- 接口契约：`pendingBind` 标记（settings，一次性，可带有效期）。
- 验收标准：
  1. Settings Agent 区显示绑定状态；未绑定时提供"开始绑定"入口（置 `pendingBind`）。
  2. `pendingBind` 置位后，下一条来自未绑定用户的飞书消息 → 记录发送者 open_id 为绑定用户 + 清除标记 + 回复"绑定成功"；**仅此一条消息生效**（后续未绑定消息拒绝）。
  3. 未置 `pendingBind` 时，未绑定用户消息 → 拒绝回复引导卡片（提示去 Settings 发起绑定），不执行绑定。
  4. 已绑定后可解绑（Settings 操作），解绑后回到未绑定状态（引导流程可重来）。
  5. `pendingBind` 有有效期（如 10 分钟）或取消入口；过期/取消后不生效。
- seam/测试：`tests/capabilities/agent-dialogue/user-binding/2026-08-02-builtin-agent/api/userBinding.test.js`（状态机断言：未绑定→arming→绑定→解绑→重绑）。

## REQ-AGENT-015 未绑定用户拒绝

- 优先级 P0 / 必须 / intra-module / agentRouter / agent-dialogue / user-binding / 单元
- 验收标准：
  1. 未绑定用户一切消息（含查询意图）→ `E-AUTH-NOT-BOUND` 拒绝回复（"请先在设置中绑定操作者"），不启动 agent 会话、不执行任何命令。
  2. 拒绝逻辑先于命令识别与会话分发（路由层第一道检查，断言顺序）。
- seam/测试：同上目录。

## REQ-AGENT-016 高危确认挂起与解耦执行

- 优先级 P0 / 必须 / cross-module / 命令模块, 确认服务, agent 子进程, 会话卡片渲染器 / agent-dialogue / confirmation / 单元+集成
- 接口契约：`confirm-request` / `confirm-result` / `notify-result`（IPC）；`agent_confirmations` 表（confirmId/会话/命令/参数/状态 pending|approved|rejected）。
- 验收标准：
  1. confirm 级命令被工具适配器拦截 → 发 `confirm-request` → 确认服务入队（pending）+ 发确认卡片（含命令摘要与确认/拒绝按钮）；agent 该轮结束并回复"操作待确认"。
  2. 用户点确认 → 回调置 approved → **确认服务驱动同一命令模块执行**（不经过 agent turn）→ 结果经 `notify-result` 注入 agent 会话 → agent 生成自然语言回投（有断言：回投文本基于执行结果）。
  3. 用户点拒绝 → 置 rejected → 不执行 → 回投"已取消"。
  4. confirmId 幂等：同一确认回调只执行一次；重复回调忽略。
  5. 挂起队列持久化（SQLite）：应用重启后 pending 项仍可确认/拒绝（"稍后处理"语义，07 决议）。
- seam/测试：`tests/capabilities/agent-dialogue/confirmation/2026-08-02-builtin-agent/api/confirmation.test.js`（状态机全路径）+ 集成（真 IPC 断言回投）。

## REQ-AGENT-017 agent 优先路由（REQ-CHANNEL-002 接替）

- 优先级 P0 / 必须 / cross-module / imRouter, agentRouter, channel_bindings / agent-dialogue / channel / 单元+集成
- 接口契约：agentRouter 三纯函数输出 `{ action: "reject" | "command" | "dialogue", payload }`。
- 验收标准：
  1. 收到 `im.message.receive_v1` → 去重（沿用 channel_messages）→ agentRouter：绑定检查（REQ-AGENT-015）→ 命令识别（REQ-AGENT-021）→ 会话分发。
  2. **不再**因命中 `channel_bindings` 而直接 `createTask`（旧 REQ-CHANNEL-002 语义接替）；绑定数据仍可读，作为 agent 下发任务的默认目标候选注入工具上下文（有断言：agent 下发时优先使用绑定 flow）。
  3. 消息路由失败（去重/解析异常）→ 复用现有通道错误处理（3 秒内回调返回）。
  4. 手动/定时/调试触发路径不受影响（回归断言）。
- seam/测试：`tests/capabilities/agent-dialogue/channel/2026-08-02-builtin-agent/api/agentRoute.test.js` + 旧路由回归（`tests/capabilities/channel-integration/channel/2026-07-19-media-production-line/api/` 对应用例更新接替）。

## REQ-AGENT-018 会话分发与群聊语义

- 优先级 P0 / 必须 / cross-module / agentRouter, sessionStore / agent-dialogue / channel / 单元
- 验收标准：
  1. 空间 key = `feishu:<chatId>`：单聊与每个群聊各自独立空间（复用 REQ-AGENT-008 表）。
  2. 绑定用户在群聊中发言 → 进入该群空间对话；同群其他用户消息 → `E-AUTH-NOT-BOUND` 拒绝（不影响群空间）。
  3. 空间不存在 → 自动创建（首次对话）；创建时下发 `session-config`（供应商/key/身份）。
- seam/测试：同上目录。

## REQ-AGENT-019 回复卡片流式

- 优先级 P0 / 必须 / cross-module / 会话卡片渲染器, feishuChannelAdapter / agent-dialogue / channel / 单元
- 接口契约：adapter `sendCard({chatId, cardJson})` / `updateCardStream({cardId, content, sequence})`（sequence 严格递增）；CardKit streaming_mode。
- 验收标准：
  1. agent 对话流式输出 → 渲染器构建回复卡片 → `sendCard` → 增量经 `updateCardStream` 按序更新（sequence 递增，断言请求序列）。
  2. 流式结束 → 卡片定型（停止更新）；流式错误 → 卡片标注失败状态。
  3. 流式窗口 10 分钟自动关闭（H4 假设）→ 降级：普通文本消息 + 提示"可用 /status 查询"。
- seam/测试：`tests/capabilities/agent-dialogue/channel/2026-08-02-builtin-agent/api/cardStream.test.js`（adapter fake 断言卡片结构与 sequence）。

## REQ-AGENT-020 任务卡片流式与降级

- 优先级 P0 / 必须 / cross-module / 会话卡片渲染器, eventBus / agent-dialogue / channel / 单元+集成
- 验收标准：
  1. flow 执行启动（eventBus 执行事件）→ 任务卡片发送；执行进度（状态/日志摘要/产物）增量更新卡片。
  2. 执行成功/失败 → 卡片终态（含执行 id，可 /status 复核）。
  3. 执行结果同时经对话回投（agent 生成摘要，若对话会话活跃）。
  4. 卡片更新失败（E-CHANNEL-SEND 重试耗尽）→ 告警日志，不阻断执行（回归 REQ-CHANNEL-003 语义）。
- seam/测试：同上目录 + 集成（事件总线注入执行事件断言卡片序列）。

## REQ-AGENT-021 命令识别直通（/status /list）

- 优先级 P0 / 必须 / intra-module / agentRouter, 命令模块 / agent-dialogue / channel / 单元
- 验收标准：
  1. 消息以 `/` 开头命中命令集 → 主进程路由层直接调命令模块（不经 LLM/agent 进程），结果格式化回复。
  2. `/status <id>`：id 必填且 UUID 格式（execution.id = `crypto.randomUUID()`），非法 → `E-CMD-INVALID` 用法提示；未知 id → 查无此执行的明确回复。
  3. `/list [projectId|flowId]`：可选过滤参数，格式校验；返回执行列表摘要。
  4. 未绑定用户发起命令 → 仍先过绑定检查（E-AUTH-NOT-BOUND）。
- seam/测试：`tests/capabilities/agent-dialogue/channel/2026-08-02-builtin-agent/api/slashCommands.test.js`。

## REQ-AGENT-022 会话命令（/reset /help）与可用性

- 优先级 P0 / 必须 / intra-module / agentRouter / agent-dialogue / channel / 单元
- 验收标准：
  1. `/reset` 复用 REQ-AGENT-010 语义（当前空间重置，其他空间不受影响）。
  2. `/help` 返回命令集与用法说明（文本卡片）。
  3. 全部命令在未配 key 时可用（回归 REQ-AGENT-002 标准 2）；命令识别先于会话分发（无空间也响应命令）。
- seam/测试：同上目录。

## REQ-AGENT-023 Settings 页 tab 化结构

- 优先级 P1 / 应该 / intra-module / renderer Settings 页 / agent-dialogue / settings / E2E（浏览器）
- UX 参照：`ux/settings-tabs.html`（2026-08-05 拍板 approved）。
- 验收标准：
  1. 设置页主体改为 tab 导航，四个 tab：「通用」「Agent 配置」「飞书通道」「关于与更新」；tab 栏具 aria 语义（`role="tablist"` / `role="tab"`，当前 tab `aria-selected="true"`）；点击 tab 切换显示对应面板，其余面板不可见。
  2. 默认显示「通用」tab；现有各区内容归入对应 tab：通用（工作区根目录/技能仓库路径/主题/语言/密度）、Agent 配置（供应商/API key/测试连接/自定义身份/飞书绑定）、飞书通道（App ID/App Secret/重新连接）、关于与更新（版本信息/检查更新）。
  3. Agent 配置 tab 的 API key 输入框 placeholder 为「已加密存储，输入则更换」；key 不回显不变（REQ-AGENT-001 标准 2、签核决策 5 不变）。
  4. 本 REQ 仅改变 Settings 页导航结构，REQ-AGENT-001/004/014 的配置语义不变；所有现存 Settings 页 E2E 用例适配 tab 导航（测试侧接替，REQ 语义不修订）：REQ-AGENT-001/004/014（本 story）、REQ-I18N-001/002（themeLanguage）、REQ-DIST-002~004（versionDisplay）、REQ-WORKSPACE 相关（onboarding）。
- seam/测试：`tests/capabilities/agent-dialogue/settings/2026-08-02-builtin-agent/e2e/settingsTabs.test.cjs`（Playwright：tab 栏存在性、aria-selected 切换、面板显隐、placeholder 断言）。

## REQ-AGENT-024 分区独立保存（移除全局保存）

- 优先级 P1 / 应该 / intra-module / renderer Settings 页 + settings HTTP API / agent-dialogue / settings / E2E
- 接口契约：沿用现有 settings HTTP API（PATCH 分区字段），不新增端点、不新增错误码。
- 验收标准：
  1. 页面右上角不存在全局保存按钮；「通用」「Agent 配置」「飞书通道」三个可编辑 tab 各自区内有独立保存按钮；「关于与更新」tab 只读，无保存按钮。
  2. 通用 tab 保存仅提交通用字段（workspaceRoot/skillRepoPath/theme/language/density），请求体不携带 agent / channelCredentials 字段（请求体断言）。
  3. Agent 配置 tab 保存语义不变：keepExistingKey（provider 未变且未输入新 key → 请求体不含 apiKey，服务端保留原密文）；identity 一并保存；保存后配置状态徽章与实际一致。
  4. 飞书通道 tab 保存语义不变（提交 appId/appSecret）；三个可编辑 tab 保存成功后区内显示反馈（「已保存」类文案）。
  5. 保存失败沿用各区现有错误提示路径（E-CONFIG-INVALID 等），不引入新错误码。
- seam/测试：同 REQ-AGENT-023 文件（拦截 PATCH /api/settings 断言请求体分 tab 隔离 + 全局保存按钮不存在断言）。

## REQ-AGENT-025 tab 切换保留未保存编辑

- 优先级 P1 / 应该 / intra-module / renderer Settings 页 / agent-dialogue / settings / E2E
- 验收标准：
  1. 任一可编辑 tab 内修改表单未保存 → 切换到其他 tab → 切回 → 修改值仍在（未丢失、未重置为已保存值）。
  2. tab 切换本身不触发任何保存请求（网络断言：切换过程无 PATCH 发出）。
- seam/测试：同 REQ-AGENT-023 文件。
## REFLECT 人工验收备注（不进自动化测试）

- 卡片视觉效果（配色/间距/动效曲线）——纯审美判断，REFLECT 人工验收。
- Settings tab 栏视觉细节（下划线样式、选中态、间距）——纯审美判断，REFLECT 人工验收；结构/行为已由 REQ-AGENT-023~025 自动化覆盖。
- 绑定 flow 用户在 agent 场景下的行为变化（旧 REQ-CHANNEL-002 接替后的体验确认）。
- agent 回复的语言风格/语气自然度。
