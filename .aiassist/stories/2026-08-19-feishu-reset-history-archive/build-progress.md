# Build Progress — 2026-08-19-feishu-reset-history-archive

> BUILD 开始：2026-08-19（门 1 断言签核通过后）
> 契约：requirements v1（hash 8a4fce4fe307c46375fff08faf1aac3342adbe8a95b92c97c15fc3886d629003）+ signoff.md + prd.md v0.1 §10
> 硬约束：业务测试只读；commit 纪律（[build] commit 不含测试文件）

## 切片计划

| Slice | REQ | 内容 | 测试载体 | 依赖 |
|---|---|---|---|---|
| 1 | REQ-AGENT-123、REQ-AGENT-124 | `src/services/sessionStore.js`：实现 `reset(spaceKey)` 对 `feishu:*` 的单事务原子归档（旧行改名 `feishu:<chatId>:gen<N>` + 新活跃行 `feishu:<chatId>` touch 世代 N+1 文件）+ 空世代不归档/原地换代 + 无行与畸形 ref 兜底 + SQLite 异常降级 | `feishuResetArchive.test.js`、`feishuResetReceipt.test.js`（直测 seam） | 无 |
| 2 | REQ-AGENT-125、REQ-AGENT-126 | `src/http/routes/agentSessions.js`：会话列表 `listSessions` 对 `feishu:<chatId>:gen<N>` 归档条目在 title 为空时逆解析查 `agent_space_meta` 作为 displayName fallback；确保只读守护覆盖所有写端点（messages / reset / provider / mode） | `feishuArchiveSessions.test.js`（集成 seam） | Slice 1 |

## 基线

- BUILD 前单测状态（2026-08-19）：14 tests / 8 pass / 6 fail（本 story 6 条预期的 RED 状态：归档事务未实现、displayName fallback 逆解析未实现、只读端点守护完善）。

## Slice 进度

### Slice 1: REQ-AGENT-123 & REQ-AGENT-124 飞书 /reset 单事务归档与异常分支

- **状态**：COMPLETED
- **改动文件**：
  - `src/services/sessionStore.js`
- **测试结果**：
  - `tests/capabilities/agent-dialogue/conversation-space/2026-08-19-feishu-reset-history-archive/api/feishuResetArchive.test.js` (7/7 PASS)
  - `tests/capabilities/agent-dialogue/conversation-space/2026-08-19-feishu-reset-history-archive/api/feishuResetReceipt.test.js` (1/1 PASS)
  - 回归测试（builtin-agent / ui-copilot）：全部 PASS

#### PRD → 代码可追溯性表

| PRD 锚点 / 契约 | REQ / 验收项 | 实现位置 | 逻辑说明 |
|---|---|---|---|
| PRD §6.3 锚点 2 / §10.3 数据流 3 | REQ-AGENT-123 AC1 正常世代归档 | `src/services/sessionStore.js` `reset()` | `feishu:*` 空间非空世代下执行单事务：旧行改名 `archiveKey`（`${spaceKey}:gen${currentGen}`），新活跃行 `INSERT` 换代 `nextRef` 并 `touchSessionFile` |
| PRD §10.4 契约 1 样例 2 | REQ-AGENT-123 AC2 首世代归档 | `src/services/sessionStore.js` `reset()` + `generationFromRef()` | 首世代 sessionRef 无 `.N` 后缀时解析为 1，归档为 `:gen1`，新活跃行为世代 2（`.2.jsonl`） |
| PRD §6.3 锚点 5 | REQ-AGENT-123 AC3 连续归档 | `src/services/sessionStore.js` `reset()` + `sessionRefFor()` | 每次归档按旧世代号递增命名与建新行，键名与文件名递增不碰撞 |
| PRD §10.4 契约 2 | REQ-AGENT-123 AC4 onReset 监听保持 | `src/services/sessionStore.js` `notifyReset()` | 触发 `(spaceKey, info)` 保持活跃键与新 sessionRef 形态，不影响外部监听者 |
| PRD §6.3 锚点 8 | REQ-AGENT-123 AC5 回执文案保持 | `src/services/agentRouter.js`（既有） | 飞书通道命令直通调用 `store.reset`，回执文本保持不变 |
| PRD §6.3 锚点 6 / §8-4 | REQ-AGENT-124 AC1 空世代不归档 | `src/services/sessionStore.js` `reset()` | `projectMessagesFromJsonl(row.sessionRef).length === 0` 时退回既有原地换代 `bumpGeneration`，表行数不变 |
| PRD §6.2 分支 2 | REQ-AGENT-124 AC2 无行 reset | `src/services/sessionStore.js` `reset()` | `!row` 时返回 `undefined`，不操作 DB |
| PRD §8-2 | REQ-AGENT-124 AC3 写失败降级 | `src/services/sessionStore.js` `reset()` | 归档事务抛错时捕获、调用 `degradePersistFailure("reset 归档事务", err)` 并在 catch 分支降级为原地换代 `bumpGeneration` |
| PRD §10.4 契约 1 样例 3 | REQ-AGENT-124 AC4 畸形 ref 兜底 | `src/services/sessionStore.js` `generationFromRef()` | 无法解析世代号时兜底按 gen1 处理生成 `:gen1` 归档行，不抛异常 |

