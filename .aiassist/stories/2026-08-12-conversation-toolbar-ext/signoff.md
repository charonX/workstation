# 签核记录 — 2026-08-12-conversation-toolbar-ext

> 门 1（ASSERTION-SIGNOFF）：2026-08-13。
> 断言归人：本节签核 = 人对"什么算对"承担最终责任。

---

## Assertion（门 1）

### REQ-ID 与覆盖

| REQ-ID | 实体 | 测试文件 | 断言要点 |
|---|---|---|---|
| REQ-AGENT-090 | settings | providerModelConfig.test.js | 迁移产物（kimi-k3）/ E13 原文件不动 / 校验 400 / 默认唯一 / key 0o600 |
| REQ-AGENT-091 | settings | settingsProviders.test.cjs (E2E) | 条目列表 / 勾选子集 / 星标默认 / 删除重定向 / 迁移提示 |
| REQ-AGENT-092 | settings | providerModelConfig.test.js | kimi 标志直存 / deepseek 补全 / fallback / 无 key 不拉取 |
| REQ-AGENT-093 | conversation-space | providerSwitch.test.js | 切换 + 回读 + sessionRef 不换代 / 历史保留 / E-MODEL-* / 幂等 |
| REQ-AGENT-094 | conversation-space | modelSelector.test.cjs (E2E) | 旧槽位移除 / 展开高亮 / 切换 PUT / 空配置禁用 / 收起 |
| REQ-AGENT-095 | conversation-space | providerSwitch.test.js | 新会话=默认 / 按行重装 / NULL→默认 / 删条目回落 / 默认变更 |
| REQ-AGENT-096 | conversation-space | autoJudgeDefaultModel.test.js | buildJudgeConfig 锚定默认 / 缺省 fail-safe / 广播更新 |
| REQ-AGENT-097 | conversation-space | imageAttachment.test.js | image block + JSONL 快照 / E-ATTACH-TYPE/COUNT/SIZE/PATH / 回归 |
| REQ-AGENT-098 | conversation-space | imageAttachmentUi.test.cjs (E2E) | chip 生命周期 / 视觉/非视觉阻止 / 发送复核 / 项目外直接附加 / 数量上限 |
| REQ-AGENT-099 | settings | providerModelConfig.test.js | DEFAULT_MODELS.moonshotai=kimi-k3 / pi-ai 目录可解析 |

### 人确认（高风险项）

- [x] **初衷锚定**：PRD §1 痛点（工具栏槽位无功能 + 单 provider + k2.5 日落）未漂移。
- [x] **跨模块接口契约**（§10.4 接口 1-5）：PUT provider / provider-change IPC（四字段不换代，ADR-026）/ judge-config 广播 / messages attachments / agent_sessions 列——全部经人逐项确认。
- [x] **expected 值来源**：迁移产物、错误码、默认唯一、视觉阻止文案——来自 PRD/REQ 验收标准 + pi-ai 目录实证，非代码输出。
- [x] **安全边界**：key 明文仅内存；非视觉阻止 + 发送复核（不静默丢图）；附加即授权但 agent 工具面照旧从严。
- [x] **PRD §14 GAP 去处**：全 PASS；M1-M4 定案；PDF 归 §12；无悬空。

### AI 自检（人抽查）

- [x] 10/10 REQ 有自动化测试覆盖。
- [x] 7 测试文件头部含 REQ-TRACE / REQ-VERSION（v1-hash:ff3ce6…）/ CAPABILITY-TRACE / ENTITY-TRACE。
- [x] capability/entity 与 business-capabilities.md 一致（agent-dialogue / settings + conversation-space）。
- [x] 无 `TODO: HUMAN ASSERTION` 占位。
- [x] 无快照当判定依据。
- [x] 边界/错误 case 已覆盖（400 ×6、fail-safe defer、E12 回落、幂等、迁移失败保护）。

### 新契约点（BUILD 对齐）

- `GET /api/agent/sessions/:spaceKey/provider` 回读端点（REQ-093 标准 1）。
- 错误码 `E-MODEL-CONFIG-MISSING` / `E-MODEL-KEY-FAIL` / `E-ATTACH-TYPE` / `E-ATTACH-COUNT` / `E-ATTACH-SIZE` / `E-ATTACH-PATH`。
- `agentService.buildJudgeConfig(settings)` 导出（REQ-096 seam）。
- 新 testid：`model-select/model-trigger/model-option`、`attach-button/attachment-chip/msg-attachment/attach-blocked`、`provider-entry/model-chip/add-provider-button/save-provider/delete-provider/migrate-note/model-option`、`model-empty-hint`。
- 既有 E2E 替换：`2026-08-11-pi-agent-modes/e2e/modeToolbar.test.cjs` 的 `toolbar-slot-model/attach` 灰显断言随本 story 更新。

### 签名

- 人（2026-08-13）：批量确认所有 expected 值 + 本清单。
- AI（2026-08-13）：AI 自检全绿。
