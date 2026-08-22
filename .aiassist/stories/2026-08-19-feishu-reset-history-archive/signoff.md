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

### Review 后修订记录（2026-08-19 /review panel，review.md）

签核后经 panel review 发现以下锚点/承接缺口，处置如下（契约测试文件未变，REQ hash 不变）：

| 项 | 发现 | 处置 |
|---|---|---|
| 403 响应体锚点 | prd.md §6.3 row 7 原写 `{code:"E-SESSION-READONLY"}`，实现/测试实际为 sendError 封套 `{error, message}`；本表交叉验证「值一致 ✅」不成立 | **人确认（2026-08-19）**：PRD 锚点修订为 `{ error: "E-SESSION-READONLY" }`（v0.2），实现与测试不变 |
| lastActiveAt 锚定 | 新活跃行 lastActiveAt 未锚定，§6.3 row 3 排序断言依赖该值 | PRD v0.2 锚点 2/§10.3 补「lastActiveAt=createdAt=此刻」；已锁测试的排序断言与该值一致（实现即此语义） |
| §8-5 并发承接 | reset 与入站消息并发无验收断言 | **显式豁免**：归档事务同步执行无 await（code review 实证无交错窗口），单事务原子性由 REQ-AGENT-124 AC3 断言兜底，不单独出并发测试 |
| REQ-AGENT-124 AC3 | 写失败降级零测试覆盖（review CRITICAL） | test-gap：补 DB 层失败注入测试（touch 在 try 外，只读目录注入无效）→ **已补（2026-08-19，commit fb85a6b）**：`feishuResetArchive.test.js` 新增 AC3 例（预存 `…:gen2` 冲突行撞 UNIQUE，断言 stderr `E-SESSION-PERSIST` + 降级原地换代 + 无半成品归档行），14/14 绿 |
| 旧测试语义翻转 | PRD §11.2 预言的「sessionReset 世代制例修订」实际不需要：旧例因空世代分支自然存活 | test-plan.md 指向修正；旧例注释/名称更新为「仅空世代不建行」 |
| requirements.md 表名 | REQ-125/126 文本写 `space_meta`，实际表名 `agent_space_meta`（测试正确） | 接受为文档债务（修订会动 REQ hash 与测试 REQ-VERSION 头），留 /reflect 随下一版本一并修订 |
| requirements.md 403 字段 | REQ-AGENT-126 AC3 文本写响应体 `{ code: "E-SESSION-READONLY" }`，与 PRD v0.2 锚点 7/sendError 封套/已签核测试的 `{ error }` 矛盾（复审 R2） | **人确认（2026-08-19）**：同上先例接受为文档债务——不动 hash 锁定的 REQ 文件，留 /reflect 随 REQ v2 一并修订 |

### REQ v2 修订记录（2026-08-22 /reflect，文档债务清偿）

人确认随 /reflect 清偿上述两笔文档债务，REQ 修订为 **v2**（`requirements-v2.hash` = `507ffe922e1d620d7fe0d6382a3c2d3b359d27085338c3b76769d794f7df5dc1`）：

| 项 | v1 原文 | v2 修订 |
|---|---|---|
| 表名漂移 | REQ-AGENT-125 契约与 AC2 写 `space_meta` | 改为实际表名 `agent_space_meta` |
| 403 字段漂移 | REQ-AGENT-126 AC3 写 `{ code: "E-SESSION-READONLY" }` | 改为 `{ error: "E-SESSION-READONLY" }`（与 PRD v0.2 锚点 7 / sendError 封套 / 已签核测试对齐） |
| ADR 状态 | 头部「待落 adr/0037」 | 更新为 `adr/ADR-037` 已落档 |

4 个测试文件的 `REQ-VERSION` 头同步更新为 `v2-hash:507ffe92…`；断言内容零变化（纯文本勘误，无行为契约改动）。
