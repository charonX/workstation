# 测试计划 — 2026-08-12-conversation-toolbar-ext

> 由 `/test-author` 生成（2026-08-13）。断言未签核（ASSERTIONS-SIGNED: false），
> 门 1 `/signoff --stage=assertion` 时人工确认 expected 值。

## REQ → 测试映射

| REQ-ID | Seam 类型 | capability / entity | 测试文件 | 覆盖内容 |
|---|---|---|---|---|
| REQ-AGENT-090 | 集成（HTTP API） | agent-dialogue / settings | `tests/capabilities/agent-dialogue/settings/2026-08-12-conversation-toolbar-ext/api/providerModelConfig.test.js` | 存量迁移、迁移失败保护、条目校验、默认唯一、key 加密落盘 |
| REQ-AGENT-091 | 浏览器 E2E | agent-dialogue / settings | `tests/capabilities/agent-dialogue/settings/2026-08-12-conversation-toolbar-ext/e2e/settingsProviders.test.cjs` | 条目列表、添加/勾选子集、星标默认、删除重定向、迁移提示（UX: settings-providers.html 映射） |
| REQ-AGENT-092 | 单元 + 集成 | agent-dialogue / settings | `providerModelConfig.test.js`（modelCatalogService） | kimi 标志直存、deepseek 能力补全、失败回退、无 key 不拉取 |
| REQ-AGENT-093 | 集成（HTTP + worker） | agent-dialogue / conversation-space | `tests/capabilities/agent-dialogue/conversation-space/2026-08-12-conversation-toolbar-ext/api/providerSwitch.test.js` | 切换成功+列回写+sessionRef 不变、历史保留、新 provider 生效、E-MODEL-CONFIG-MISSING/KEY-FAIL、幂等 |
| REQ-AGENT-094 | 浏览器 E2E | agent-dialogue / conversation-space | `tests/capabilities/agent-dialogue/conversation-space/2026-08-12-conversation-toolbar-ext/e2e/modelSelector.test.cjs` | 替代灰显槽位、触发/展开/高亮/默认徽标、切换、空配置禁用、外部点击收起（UX: conversation-toolbar.html 映射） |
| REQ-AGENT-095 | 集成（水合/懒恢复） | agent-dialogue / conversation-space | `providerSwitch.test.js`（第二组 describe） | 新会话默认、按行重装、NULL→默认、删除回落+提示、默认变更 |
| REQ-AGENT-096 | 单元 + 集成 | agent-dialogue / conversation-space | `tests/capabilities/agent-dialogue/conversation-space/2026-08-12-conversation-toolbar-ext/api/autoJudgeDefaultModel.test.js` | defaultJudge 不随会话漂移、缺失 fail-safe defer、judge-config 广播、懒恢复带新默认、key 不落日志 |
| REQ-AGENT-097 | 集成 + 单元 | agent-dialogue / conversation-space | `tests/capabilities/agent-dialogue/conversation-space/2026-08-12-conversation-toolbar-ext/api/imageAttachment.test.js` | image block 注入、JSONL 快照重放、白名单 400、数量/大小上限、attachment-error 事件、无附件回归 |
| REQ-AGENT-098 | 浏览器 E2E | agent-dialogue / conversation-space | `tests/capabilities/agent-dialogue/conversation-space/2026-08-12-conversation-toolbar-ext/e2e/imageAttachmentUi.test.cjs` | 附件按钮、chip 生命周期、视觉/非视觉附加、发送时复核、项目外直接附加、数量上限（UX: conversation-toolbar.html 映射） |
| REQ-AGENT-099 | 单元 | agent-dialogue / settings | `providerModelConfig.test.js`（第三组 describe） | DEFAULT_MODELS.moonshotai=kimi-k3、pi-ai 目录可解析、迁移产物 |

## UX 原型 → 自动化测试映射（强制提取）

| 原型 | 提取的结构/行为 | 落入测试 |
|---|---|---|
| `ux/conversation-toolbar.html` | 模型选择器 locator 契约（model-select/trigger/option）、附件按钮、chips 行、阻止提示、消息附件块 | modelSelector.test.cjs、imageAttachmentUi.test.cjs |
| `ux/settings-providers.html` | provider 条目/模型 chip/默认星标/添加表单/勾选子集/迁移提示 | settingsProviders.test.cjs |
| 未自动化的纯审美项 | — | 无（全部结构/行为已自动化） |

## 环境与依赖

- API 测试：`OPC_WORKSTATION_CONFIG_DIR` 临时目录 + `startServer({port:0})` + `OPC_AGENT_FAUX=1`；
  迁移用例用旧格式 settings fixture。
- E2E：`startElectronApp`（既有 fixture）+ FAUX + 新形态 settings seed；文件选择器用
  `setInputFiles` + Electron `File.path` 语义。
- 新 seams（RED 前为动态 import + `assert.ok(mod, "seam 未就绪…")`）：
  `src/services/modelCatalogService.js`、`agent_sessions` provider/model 列、
  `PUT /api/agent/sessions/:key/provider`、provider-change/judge-config IPC、
  `POST messages.attachments`、ModeToolbar model-select、Composer 附件。

## 遗留 REFLECT 人工验收

- 无（本 story 全部验收标准可自动化；观感类变更如 chip 间距/下拉动效由 `/bug` 或
  REFLECT 处理，不占 REQ）。

## 既有测试影响

- `2026-08-11-pi-agent-modes/e2e/modeToolbar.test.cjs`：`toolbar-slot-model`/
  `toolbar-slot-attach` 灰显占位断言（REQ-AGENT-071 标准 4）将被本 story 行为变更
  取代——需同步更新该 E2E（新 locator 契约），归属本 story 的测试改动。
