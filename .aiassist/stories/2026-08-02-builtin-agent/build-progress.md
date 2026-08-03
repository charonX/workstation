# Build Progress — 2026-08-02-builtin-agent

> 由 /implementer 维护。父代理调度、子代理实现、父代理验证。

## 切片计划（8 slices，依赖序）

| Slice | 内容 | REQ-ID | PRD 里程碑 | 状态 |
|---|---|---|---|---|
| 1 | 配置与身份（供应商/key/身份 + session-config IPC） | REQ-AGENT-001~004 | M1 | complete |
| 2 | agent 进程与对话内核（看门狗/回路/LLM 错误） | REQ-AGENT-005~007 | M1 | pending |
| 3 | 会话存储与恢复（空间模型/恢复/重置/压缩） | REQ-AGENT-008~011 | M1 | pending |
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

- 状态：**complete**（commit 34ce870；agentConfig.test.js 6 it + systemPrompt.test.js 5 it 全绿；既有 439 零回归；其余 10 个新测试文件红 = 后续 slice，抽样：userBinding E-AUTH-NOT-BOUND 缺绑定状态机、agentRoute 缺三纯函数路由、slashCommands 缺命令模块直通）

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
