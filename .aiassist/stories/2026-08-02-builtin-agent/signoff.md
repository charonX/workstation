# Signoff — 2026-08-02-builtin-agent

## Assertion（阶段 1：断言签核）

- 签核日期：2026-08-03
- 签核方式：逐项过 `// TODO: HUMAN ASSERTION`（42 处占位 → 归并为 20 项决策），全部经人拍板后回写测试文件
- 签核修订（人拍板，2026-08-03）：
  1. **API key 不做前缀校验**——仅非空；准确性由用户负责，以"测试连接"功能验证（REQ-AGENT-001 标准 3/4 修订，哈希重算）
  2. **pendingBind 有效期 = 10 分钟**（REQ-AGENT-014 标准 5 定值）
- REQ 版本：`v1-hash:1a95cf23677ba5e4cea1a2eb2157896aeef22713b6de03f9c5119c49f3830e2b`

### 前置验证：spike H1~H4（signoff 前置验证项）

| # | 假设 | 结果 | 备注 |
|---|---|---|---|
| H1 | asar 打包 spawn 路径 | ✅ PASS | `ELECTRON_RUN_AS_NODE=1` + asar 内 require 实测通过 |
| H2 | 会话目录自定义 + JSONL 恢复 | ✅ PASS（8/8） | `SessionManager.create(cwd, sessionDir)` + `SessionManager.open`；authPath 重定向防 ~/.pi 污染 |
| H3 | fauxProvider 注入 | ✅ PASS | `registerNativeProvider` + `model: faux.getModel()`；事件序列完整 |
| H4 | CardKit 卡片流式 | ✅ 契约 PASS / 联调待 QA | 端点/字段/约束已证实；真实凭据联调验收推迟 QA |

详见 `research/spike-report.md`。

### REQ-ID 列表（22 条，全部有自动化测试）

| REQ-ID | capability / entity | 测试文件 |
|---|---|---|
| REQ-AGENT-001 | agent-dialogue / settings | api/agentConfig.test.js |
| REQ-AGENT-002 | agent-dialogue / settings | api/agentConfig.test.js |
| REQ-AGENT-003 | agent-dialogue / settings | api/systemPrompt.test.js |
| REQ-AGENT-004 | agent-dialogue / settings | api/systemPrompt.test.js |
| REQ-AGENT-005 | agent-dialogue / conversation-space | api/agentProcess.test.js |
| REQ-AGENT-006 | agent-dialogue / conversation-space | api/agentDialogue.test.js |
| REQ-AGENT-007 | agent-dialogue / conversation-space | api/agentDialogue.test.js |
| REQ-AGENT-008 | agent-dialogue / conversation-space | api/sessionStore.test.js |
| REQ-AGENT-009 | agent-dialogue / conversation-space | api/sessionRestore.test.js |
| REQ-AGENT-010 | agent-dialogue / conversation-space | api/sessionStore.test.js |
| REQ-AGENT-011 | agent-dialogue / conversation-space | api/sessionStore.test.js |
| REQ-AGENT-012 | agent-dialogue / conversation-space | api/toolSurface.test.js |
| REQ-AGENT-013 | agent-dialogue / conversation-space | api/toolSurface.test.js |
| REQ-AGENT-014 | agent-dialogue / user-binding | api/userBinding.test.js |
| REQ-AGENT-015 | agent-dialogue / user-binding | api/userBinding.test.js |
| REQ-AGENT-016 | agent-dialogue / confirmation | api/confirmation.test.js |
| REQ-AGENT-017 | agent-dialogue / channel | api/agentRoute.test.js |
| REQ-AGENT-018 | agent-dialogue / channel | api/agentRoute.test.js |
| REQ-AGENT-019 | agent-dialogue / channel | api/cardStream.test.js |
| REQ-AGENT-020 | agent-dialogue / channel | api/cardStream.test.js |
| REQ-AGENT-021 | agent-dialogue / channel | api/slashCommands.test.js |
| REQ-AGENT-022 | agent-dialogue / channel | api/slashCommands.test.js |

### capability/entity 覆盖摘要

- **agent-dialogue / settings**（新能力已登记地图）：4 REQ，供应商/key 配置（safeStorage 密文、非空校验、测试连接、key 缺失引导）、身份（内置基础 + 全局自定义热更新）。
- **agent-dialogue / conversation-space**：9 REQ，看门狗生命周期、对话回路（fauxProvider）、LLM 错误结构化、空间模型/持久化/恢复、/reset、滚动摘要、工具面全量命令 + release 拒绝。
- **agent-dialogue / user-binding**（新实体）：2 REQ，E3 绑定状态机（pendingBind 10 分钟一次性）、未绑定全拒绝。
- **agent-dialogue / confirmation**（新实体）：1 REQ，确认挂起 + 解耦执行 + confirmId 幂等 + 重启可确认。
- **agent-dialogue / channel**：6 REQ，agent 优先路由（REQ-CHANNEL-002 接替）、群聊语义、回复/任务卡片流式与降级、斜杠命令直通。
- E2E 暂缺（无 DESIGN 原型）——Settings UI 行为断言已在 API seam 覆盖，test-plan.md 显式接受。

### 20 项已签断言决策（摘要）

1. **错误码**：E-AGENT-NO-KEY / E-AUTH-NOT-BOUND / E-CMD-INVALID / E-CONFIG-INVALID / E-AGENT-LLM-FAIL / E-CONFIRM-PENDING / E-CARD-STREAM-CLOSED（PRD §8 原样签核）。
2. **供应商枚举**：`{deepseek, moonshotai, moonshotai-cn}`；key 仅非空（修订①）。
3. **测试连接**：失败透传原因、不阻止保存。
4. **身份**：≤2000 字符可空；内置+自定义拼接顺序固定。
5. **secret 约束**：key 不落 settings.json 明文、不进日志/JSONL。
6. **命令格式**：/status <UUID>（crypto.randomUUID）、/list [projectId|flowId]、/reset、/help 无参。
7. **命令可用性**：直通不占 agent turn、未配 key 可用、先于会话分发。
8. **未绑定拒绝**：一切消息（含查询），先于命令识别。
9. **pendingBind**：一次性 + 10 分钟有效期（修订②）+ 可取消。
10. **解绑重绑**：Settings 解绑后可重走引导。
11. **空间 key**：`feishu:<chatId>`；群聊独立空间；绑定用户在群聊进群空间。
12. **riskLevel 映射**：按 PRD §7.2（query/dispatch/confirm）；release 不注入。
13. **工具链路**：C2——进程内 import 命令模块 → HTTP API（ADR-001）。
14. **看门狗**：exit/心跳超时 → 重启；恢复只丢半条流式消息；restarting 期间缓存重投。
15. **并发与大小**：同空间排队串行、跨空间并行；IPC 单条 ≤256KB。
16. **会话恢复**：SessionManager.open；JSONL 缺失 → 新建 + 提示。
17. **/reset**：仅当前空间；压缩阈值实现常量可注入断言。
18. **确认解耦**：拦截 → 挂起 → 回调驱动执行 → notify-result 回投自然语言；拒绝不执行；confirmId 幂等；重启后 pending 可确认。
19. **回复卡片**：sendCard + sequence 严格递增；10 分钟窗口降级普通消息 + /status 提示。
20. **任务卡片**：事件驱动、终态含 executionId；卡片失败不阻断执行（E-CHANNEL-SEND 告警）。

### 实现者测试缝契约（已随测试固定，BUILD 必须满足）

- agent 子进程入口：打包 = `spawn(process.execPath, [asar 内 bundle], {env: {ELECTRON_RUN_AS_NODE: "1"}})`；开发 = `node <源码入口>`（H1）。
- PI 集成：`ModelRuntime.create` 为 **async**；**必须传 `authPath` 重定向**（防 ~/.pi 污染）；`SessionManager.create(cwd, sessionDir)` 自定义目录；`SettingsManager.inMemory()` 可用于测试。
- 事件契约：`session.prompt()` 返回 void，回复文本从 `message_update.assistantMessageEvent`（`text_delta.delta` / `text_end.content`）提取；流式中 prompt 需 `streamingBehavior: "followUp"`。
- 测试 seam：对话回路 = `fauxProvider`（`registerNativeProvider` + `model: faux.getModel()`）+ 事件断言，零网络。
- REQ-CHANNEL-002 接替：路由层不再直接 createTask；去重与 3 秒回调保留复用。
