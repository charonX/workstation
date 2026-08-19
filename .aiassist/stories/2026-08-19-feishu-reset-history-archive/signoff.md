# 签核记录 — 2026-08-19-feishu-reset-history-archive

## Assertion（门 1，2026-08-19）

### 检查清单

- [x] PRD §14 无 GAP 悬空（全 PASS；§5 移动块 1「孤儿世代文件回填」已显式归入 §12 范围外）
- [x] 每个 REQ-ID 都有对应测试（REQ-AGENT-123~126 → 3 个测试文件全覆盖）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`（v1-hash:8a4fce4fe307c46375fff08faf1aac3342adbe8a95b92c97c15fc3886d629003）、`CAPABILITY-TRACE`、`ENTITY-TRACE`、`EXPECTED-TRACE`、`TEST-AUTHOR`、`ASSERTIONS-SIGNED: true`
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致（`agent-dialogue` / `conversation-space` 已登记）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（全部断言已机械推导并锚定）
- [x] 预期值来源清晰：每条 expected 值 trace 到 `prd.md` §6.3/§8/§10.4 锚点
- [x] 无快照当判定依据（全部为字段级/字面值断言）
- [x] 边界/错误 case 已覆盖（空世代原地换代、未对话 chat 返回 undefined、畸形 sessionRef 兜底、JSONL 文件缺失容错、全 POST 写端点 403 守护）

### expected 值交叉验证（EXPECTED-TRACE ↔ prd.md 锚点）

| 断言组 | 锚点来源 | 值一致 |
|---|---|---|
| REQ-AGENT-123 AC1: 正常世代归档（旧行改名 `feishu:oc_123:gen2`，活跃行 `feishu:oc_123` 换代为 gen3 并 touch，title 置 NULL） | `prd.md §6.3 row 2` | ✅ |
| REQ-AGENT-123 AC2: 首世代归档（无 `.gen` 后缀 → `feishu:oc_first:gen1`，活跃行换代为 gen2） | `prd.md §10.4 contract 1` 样例 2 | ✅ |
| REQ-AGENT-123 AC3: 连续归档（`feishu:oc_chain:gen3` 出现，活跃行换代为 gen4，DB 共 3 行） | `prd.md §6.3 row 5` | ✅ |
| REQ-AGENT-123 AC4: onReset 回调触发且参数形态保持 `("feishu:oc_cb", {spaceKey, sessionRef, reset: true})` | `prd.md §10.4 contract 2` | ✅ |
| REQ-AGENT-123 AC5: 飞书通道 /reset 回执文案恒为「已重置当前对话空间会话，可以开始新对话了」并调用 store.reset | `prd.md §6.3 row 8` | ✅ |
| REQ-AGENT-124 AC1: 空世代 reset 不产生归档行（总行数保持 1，活跃行原地换代 sessionRef） | `prd.md §6.3 row 6, §8 row 4` | ✅ |
| REQ-AGENT-124 AC2: 从未对话过的 chat 发 reset 返回 undefined，不建行 | `prd.md §6.2 branch 2` | ✅ |
| REQ-AGENT-124 AC4: 畸形 sessionRef 兜底为 gen1 归档键（`feishu:oc_malformed:gen1`） | `prd.md §10.4 contract 1` 样例 3 | ✅ |
| REQ-AGENT-125 AC1: GET /api/agent/sessions 列表包含归档条目并按 `lastActiveAt` 倒序 | `prd.md §6.3 row 3` | ✅ |
| REQ-AGENT-125 AC2: 归档条目 title 为空时 displayName fallback 逆解析查 `agent_space_meta` | `prd.md §10.4 contract 1` 逆解析契约 | ✅ |
| REQ-AGENT-125 AC3: 归档条目 JSONL 文件缺失时 GET /api/agent/sessions 依然正常返回 200 | `prd.md §8 row 3` | ✅ |
| REQ-AGENT-126 AC1: GET /api/agent/sessions/:spaceKey/messages 历史消息只读回看（返回 200 与历史消息） | `prd.md §6.3 row 4` | ✅ |
| REQ-AGENT-126 AC2: 缺失 JSONL 文件回看降级为空数组 `{ messages: [] }` | `prd.md §8 row 3` | ✅ |
| REQ-AGENT-126 AC3: 归档条目 POST 写操作端点（messages / reset / provider / mode）全部返回 403 `E-SESSION-READONLY` | `prd.md §6.3 row 7, §8 row 1` | ✅ |

### 升级点结果

| 升级点 | 内容 | 处置 |
|---|---|---|
| 初衷漂移 | intention（飞书 /reset 后历史在 UI 可见可回看）↔ PRD §1 ↔ REQ-123~126 一致 | 无漂移 |
| 跨模块契约歧义 | 归档键形 `feishu:<chatId>:gen<N>` 与 store.reset 对外形态在 §10.4 明确 | 无歧义 |
| expected 值推导 | 所有断言 expected 值均从 PRD 锚点（§6.3/§8/§10.4）机械推导 | 无未解决 TODO |
| 安全边界 | `feishu:` 前缀只读域保持并覆盖归档键，写面 403 守护一致 | 无新增信任边界 |
| 范围决策 | PRD §5 移动块 1（孤儿世代文件回填）归入 §12 范围外 | 已明确 |

### 覆盖摘要

| REQ-ID | 测试文件 | capability/entity |
|---|---|---|
| REQ-AGENT-123 | `api/feishuResetArchive.test.js`, `api/feishuResetReceipt.test.js` | agent-dialogue/conversation-space |
| REQ-AGENT-124 | `api/feishuResetArchive.test.js` | agent-dialogue/conversation-space |
| REQ-AGENT-125 | `api/feishuArchiveSessions.test.js` | agent-dialogue/conversation-space |
| REQ-AGENT-126 | `api/feishuArchiveSessions.test.js` | agent-dialogue/conversation-space |

### 签核状态

- 签署者：**AI**（无升级点遗留）
- 阶段：`phase: BUILD`（契约锁定，解锁实现）
