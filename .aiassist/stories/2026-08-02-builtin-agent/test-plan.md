# 测试计划 — 2026-08-02-builtin-agent

> 生成：/test-author（2026-08-03）
> 增量：REQ-AGENT-023~025 E2E 骨架（2026-08-05，S10 Settings tab 化）
> 输入：requirements.md v1（22 REQ + 023~025 增量）+ tech-design v1.1 + business-capabilities.md（agent-dialogue）+ ux/settings-tabs.html

## 增量：Settings tab 化（2026-08-05，REQ-AGENT-023~025）

| 测试文件 | seam | REQ-ID | 测试类型 | 依赖处理 |
|---|---|---|---|---|
| `settings/.../e2e/settingsTabs.test.cjs` | Playwright Electron + HTTP API 拦截 | REQ-AGENT-023~025 | E2E | 临时 userData；channel 保存 mock 201（避免真实外连飞书）；agent 保存失败 mock 400 |

**UX 原型映射**（ux/settings-tabs.html → 测试）：tab 栏结构/aria 语义（AC1）→ 结构断言 2 例；四 tab 中文文案（拍板稿）→ zh-CN 文案断言；面板显隐联动 → 切换遍历断言；分区归属 → 各区 testid 存在性断言；placeholder「已加密存储，输入则更换」→ 属性断言；分区保存/去全局保存 → 按钮存在性 + 请求体隔离断言；编辑保留 → 跨 tab 值断言 + 零变更请求网络断言。

**测试侧接替**（REQ-AGENT-023 AC4，导航适配、断言语义不变）：
- `themeLanguage.test.cjs`（REQ-I18N-001/002）：全局保存 → 通用 tab 区内保存（6 处 locator 替换）。
- `onboarding.test.cjs`（REQ-WORKSPACE-003/004/007/008 等）：同上（7 处）。
- `versionDisplay.test.cjs`（REQ-DIST-002~004）：关于/更新区断言前切「关于与更新」tab（3 处）。

**待签核占位**：
- `TODO: HUMAN ASSERTION` — en-US 下四 tab 名称与 API key placeholder 的英文译文（i18n 英文文案，本文件只签 zh-CN 拍板文案）。
- `TODO: HUMAN ASSERTION` — Agent 保存失败错误文案透传内容由 API 层覆盖，E2E 只签「错误显示在对应 tab 区内」。

**留给 REFLECT 人工验收**（纯审美，合法跳过）：tab 栏视觉细节（下划线样式、选中态、间距），已登记 requirements.md REFLECT 备注。

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
