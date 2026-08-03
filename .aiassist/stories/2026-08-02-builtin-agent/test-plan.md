# 测试计划 — 2026-08-02-builtin-agent

> 生成：/test-author（2026-08-03）
> 输入：requirements.md v1（22 REQ）+ tech-design v1.1 + business-capabilities.md（agent-dialogue）

## 测试文件总览

| 测试文件 | seam | REQ-ID | 测试类型 | 依赖处理 |
|---|---|---|---|---|
| `settings/.../api/agentConfig.test.js` | settings HTTP API + safeStorage | REQ-AGENT-001~002 | 单元 | 临时目录；safeStorage fake（TODO 确认） |
| `settings/.../api/systemPrompt.test.js` | settings API + agent 适配层 | REQ-AGENT-003~004 | 单元 | 内存版 IPC 快速路径 |
| `conversation-space/.../api/agentProcess.test.js` | agentService 真实 spawn + kill | REQ-AGENT-005 | 集成 | 真实子进程；**H1 假设**（asar spawn） |
| `conversation-space/.../api/agentDialogue.test.js` | agent 适配层 + fauxProvider | REQ-AGENT-006~007 | 单元+集成 | **H3 假设**（fauxProvider 注入）；不真调 LLM |
| `conversation-space/.../api/sessionStore.test.js` | sessionStore（临时 SQLite） | REQ-AGENT-008, 010, 011 | 单元 | 临时 DB |
| `conversation-space/.../api/sessionRestore.test.js` | 真实子进程两次启动 | REQ-AGENT-009 | 集成 | **H2 假设**（目录自定义 + SessionManager.open） |
| `conversation-space/.../api/toolSurface.test.js` | 工具适配器 + 命令模块 | REQ-AGENT-012~013 | 单元+集成 | 真实命令模块 + 内存 server |
| `user-binding/.../api/userBinding.test.js` | agentRouter 纯函数 + pendingBind 状态机 | REQ-AGENT-014~015 | 单元 | 临时 settings |
| `confirmation/.../api/confirmation.test.js` | 确认服务状态机 + 真 IPC | REQ-AGENT-016 | 单元+集成 | 临时 SQLite；真 IPC 断言回投 |
| `channel/.../api/agentRoute.test.js` | imRouter/agentRouter + fake 消息注入 | REQ-AGENT-017~018 | 单元+集成 | mock adapter（沿用 REQ-CHANNEL fake seam） |
| `channel/.../api/cardStream.test.js` | 卡片渲染器 + adapter 卡片接口 | REQ-AGENT-019~020 | 单元+集成 | **H4 假设**（CardKit 流式）；adapter fake |
| `channel/.../api/slashCommands.test.js` | agentRouter 命令识别 + 命令模块 | REQ-AGENT-021~022 | 单元 | 真实命令模块 |

## 回溯检查（22 REQ → 自动化测试）

全部 REQ-AGENT-001~022 均有至少一个自动化测试落点（见上表），无 REQ 仅依赖人工验收。REFLECT 人工验收项（requirements.md 末尾）：卡片视觉、绑定 flow 行为变化体验、回复语言风格——均为纯审美/体验判断，合法。

## 依赖与前置

| 依赖 | 涉及测试 | 状态 |
|---|---|---|
| H1 asar spawn 路径（spike 1） | agentProcess.test.js | signoff 前置验证项 |
| H2 会话目录自定义 + 恢复（spike 2） | sessionRestore.test.js | signoff 前置验证项 |
| H3 fauxProvider 注入（spike 3） | agentDialogue.test.js | signoff 前置验证项 |
| H4 CardKit 卡片流式（spike 4） | cardStream.test.js | signoff 前置验证项 |
| 内存版 IPC 快速路径 | systemPrompt/agentDialogue | implementer 提供 |
| safeStorage 测试 fake | agentConfig.test.js | implementer 提供 |

## 未生成测试的说明（合法跳过）

- **Settings Agent 配置区 UI E2E**：本 story 未跑 DESIGN 阶段（无 `ux/` HTML 原型），元素选择器不可知。待实现后按 `tests/capabilities/agent-dialogue/settings/2026-08-02-builtin-agent/e2e/` 补 Settings 页 E2E（供应商选择/key 输入/绑定引导），或由 ui-copilot story 覆盖。**不构成 REQ 缺口**——S1/S2/S6 的行为断言全部在 API seam 层覆盖。
- **卡片视觉/间距/动效**：REFLECT 人工验收（requirements.md 已声明）。

## 断言签核状态

- 全部骨架 `ASSERTIONS-SIGNED: false`——预期值占位（`TODO: HUMAN ASSERTION`），待门 1 人签核。
- 占位点总计：各文件 `it()` 内的 TODO 断言 = 待签核的断言清单。
