# Test Plan — 2026-08-19-feishu-reset-history-archive

> 版本：v1（requirements-v1.hash=8a4fce4fe307c46375fff08faf1aac3342adbe8a95b92c97c15fc3886d629003）
> 生成：2026-08-19 /test-author（自动链，无升级点）
> 目录：`tests/capabilities/agent-dialogue/conversation-space/2026-08-19-feishu-reset-history-archive/api/`
> 运行器：node:test（`npm run test:unit` 发现 `*/api/*.test.js`）

## REQ → 测试映射

| REQ | 测试文件 | seam | 类型 | 覆盖 |
|---|---|---|---|---|
| REQ-AGENT-123 飞书 /reset 归档事务与回执保持 | `feishuResetArchive.test.js`、`feishuResetReceipt.test.js` | `sessionStore.reset`、`agentRouter.route` | 单元 | AC1 正常世代归档（旧行改名 `…:gen2` + 新活跃行）；AC2 首世代归档（无 `.gen` 后缀 → `gen1`）；AC3 连续归档键名递增；AC4 `onReset` 回调触发形态与参数；AC5 飞书 /reset 回执文案恒为「已重置当前对话空间会话，可以开始新对话了」 |
| REQ-AGENT-124 飞书 /reset 异常与退化分支处理 | `feishuResetArchive.test.js` | `sessionStore.reset` | 单元 | AC1 空世代不归档（原地换代）；AC2 从未对话过的 chat 发 reset 返回 undefined；AC4 畸形 sessionRef 兜底为 gen1 归档键 |
| REQ-AGENT-125 归档条目在会话列表展示与 displayName fallback | `feishuArchiveSessions.test.js` | `GET /api/agent/sessions` 路由（真实 store + 临时 SQLite） | 集成 | AC1 会话列表包含归档条目并按 `lastActiveAt` 倒序；AC2 归档条目 title 为空时 displayName fallback 逆解析查 `space_meta`；AC3 归档条目 JSONL 文件缺失容错 |
| REQ-AGENT-126 归档条目只读回看与写操作守护 | `feishuArchiveSessions.test.js` | `GET /api/agent/sessions/:spaceKey/messages`、`POST /api/agent/sessions/:spaceKey/*` | 集成 | AC1 历史消息只读回看（GET messages 200 返回全部历史）；AC2 缺失 JSONL 文件回看降级为空数组；AC3 POST 写端点（messages / reset / provider / mode）均返回 403 `E-SESSION-READONLY` |

## 既有测试演进与回归

| 既有测试 | 说明 |
|---|---|
| `tests/capabilities/agent-dialogue/conversation-space/2026-08-02-builtin-agent/api/sessionStore.test.js` | 仅含「上下文清空」例，与归档语义兼容，无需修订（v0.2 更正：原描述误指本文件含世代制例） |
| `tests/capabilities/agent-dialogue/conversation-space/2026-08-02-ui-copilot/api/sessionReset.test.js` | 「REQ-AGENT-027 标准 5 feishu:* /reset 世代制回归」为旧语义例：其场景是 getOrCreate 后立即 reset（空世代），恰好落入新语义「空世代不归档原地换代」分支而自然存活、无需修订；测试名/注释更新为「仅空世代不建行」语义（v0.2 更正文件指向） |
| `tests/capabilities/agent-dialogue/conversation-space/2026-08-02-ui-copilot/api/feishuReadonly.test.js` | 只读守护集成用例，验证 `feishu:` 前缀写操作拦截，天然覆盖新归档键 |

## 签核待确认点（交 /signoff 确认）

- 无 `TODO: HUMAN ASSERTION` 占位；所有断言 expected 值均从 `prd.md` §6.3/§10.4 锚点机械推导。

## 人工验收（REFLECT）

- 无前端界面改动（复用既有 SessionList 与只读气泡）。
