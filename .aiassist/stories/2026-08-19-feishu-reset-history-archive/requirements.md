# Requirements — 飞书 /reset 历史会话归档与回看

> 故事 ID：`2026-08-19-feishu-reset-history-archive`
> 版本：v2
> 最后更新：2026-08-22
> 来源：`prd.md` v0.1（§4 三大稳定块：飞书 /reset 归档语义、归档条目列表可见、归档条目只读回看；§10 技术方案）
> 移动块：无（PRD §5 移动块 1「孤儿世代文件回填」已归入 §12 范围外，不进入本 REQ）
> UX 参照：N/A（纯后台状态与列表元数据变更，复用既有 SessionList 与只读气泡；DESIGN 阶段跳过）
> ADR：`adr/ADR-037`（已落档，修订 ADR-016 决策 1/4 飞书条款）
> 测试目录：`tests/capabilities/agent-dialogue/conversation-space/2026-08-19-feishu-reset-history-archive/api/`

---

## REQ-AGENT-123 飞书 /reset 归档事务与回执保持

- 优先级 P0 / 必须 / cross-module / sessionStore + agentRouter / agent-dialogue / conversation-space / 单元 + 集成
- 接口契约：
  - `store.reset(spaceKey)`：当 `spaceKey` 为 `feishu:<chatId>` 时，执行单事务原子归档：从旧 `sessionRef` 解析当前世代号 N，旧行 UPDATE 改名为 `feishu:<chatId>:gen<N>`（保留 title、sessionRef、lastActiveAt、createdAt）；INSERT 新活跃行 `feishu:<chatId>`（sessionRef 为世代 N+1 的新 JSONL 文件并 touch 创建，title 为 NULL，provider/model 为 NULL 回落默认配置）。
  - `onReset` 监听通知：维持 `(活跃键, info)` 形态，info 含 `{spaceKey: "feishu:<chatId>", sessionRef: 新, reset: true, ...}`。
  - 回执文案：飞书通道内 `/reset` 命令回复文本恒为 `已重置当前对话空间会话，可以开始新对话了`。

验收标准：
1. **正常世代归档（锚点 §6.3-2）**：`agent_sessions` 含 `feishu:oc_123`（sessionRef=`…/feishu_oc_123.2.jsonl`，title=`你好帮我查一下…`，lastActiveAt=T1）时调用 `store.reset("feishu:oc_123")` → 表中存在两行：① 归档行 `feishu:oc_123:gen2`（title、sessionRef、lastActiveAt 保持原值）；② 新活跃行 `feishu:oc_123`（sessionRef=`…/feishu_oc_123.3.jsonl` 且文件已 touch，title=NULL，createdAt=此刻）；原 `feishu:oc_123` 行被改名不再存在旧 ref（单元：临时 SQLite + 临时 sessionDir）。
2. **首世代归档（契约 §10.4-样例 2）**：旧 sessionRef 为 `…/feishu_oc_123.jsonl`（无 `.gen` 后缀即 gen1）时调用 `store.reset("feishu:oc_123")` → 归档键为 `feishu:oc_123:gen1`，新活跃行 sessionRef 为 `…/feishu_oc_123.2.jsonl`（单元）。
3. **连续归档（锚点 §6.3-5）**：新会话产生活跃消息后再次 `/reset` → 产生 `feishu:oc_123:gen3` 归档行，活跃行 sessionRef 换代为 `…/feishu_oc_123.4.jsonl`；DB 中共存在 3 条该 chat 会话记录（单元）。
4. **onReset 监听与返回值形态不变（契约 §10.4-契约 2）**：`store.reset("feishu:oc_123")` 返回 info 对象，注册的 onReset 回调被触发一次，参数为 `("feishu:oc_123", info)`，`info.spaceKey` 为活跃键，`info.sessionRef` 为新路径，`info.reset === true`（单元）。
5. **回执文案保持（锚点 §6.3-8）**：agentRouter 接收飞书 `/reset` 命令直通调用 `store.reset`，返回消息内容恒为 `已重置当前对话空间会话，可以开始新对话了`（单元：stub store）。

---

## REQ-AGENT-124 飞书 /reset 异常与退化分支处理

- 优先级 P0 / 必须 / intra-module / sessionStore / agent-dialogue / conversation-space / 单元
- 接口契约：`store.reset(spaceKey)` 在空世代、无行、写失败等分支下的退化与容错语义。

验收标准：
1. **空世代不归档（锚点 §6.3-6、§8-4）**：活跃行消息投影为空（JSONL 文件为空或不存在有效用户/助手消息）时调用 `store.reset("feishu:oc_123")` → 不产生 `…:gen…` 归档行，表总行数不变，活跃行原地换代 sessionRef 为新世代 JSONL（单元）。
2. **无行 reset（§6.2 分支 2）**：`agent_sessions` 中无 `feishu:oc_none` 记录时调用 `store.reset("feishu:oc_none")` → 返回 undefined，不插入新行，不产生归档行（单元）。
3. **写失败降级（§8-2）**：SQLite 归档事务（改名+插入）执行抛错时 → 捕获异常、stderr 输出 `E-SESSION-PERSIST` 诊断日志，降级回体现为原地换代（现行为），不产生半成品归档行（单元）。
4. **畸形 sessionRef 兜底（契约 §10.4-样例 3）**：旧 sessionRef 无法解析出世代号时 → 兜底按 gen1 处理归档键（`feishu:oc_123:gen1`），不抛出未捕获异常（单元）。

---

## REQ-AGENT-125 归档条目在会话列表展示与 displayName fallback

- 优先级 P0 / 必须 / intra-module / routes/agentSessions / agent-dialogue / conversation-space / 集成
- 接口契约：`GET /api/agent/sessions` 在 `feishu` 分组中返回归档条目，按 `lastActiveAt` 倒序排序；对 `feishu:<chatId>:gen<N>` 逆解析出 `feishu:<chatId>` 查询 `agent_space_meta` 作为 displayName fallback。

验收标准：
1. **列表包含归档条目与排序（锚点 §6.3-3）**：`GET /api/agent/sessions` 响应中，`feishu` 组同时包含新活跃条目（`spaceKey="feishu:oc_123"`, `title=null`）与归档条目（`spaceKey="feishu:oc_123:gen2"`, `title="你好帮我查一下…"`），按 `lastActiveAt` 降序排列（集成：真实 store + 临时 SQLite）。
2. **displayName fallback 逆解析（契约 §10.4-契约 1）**：`agent_space_meta` 记录 `feishu:oc_123` 的 name 为 `"项目沟通群"`，归档条目 `feishu:oc_123:gen2` 在 title 为 null 时，`displayName` 正确 fallback 为 `"项目沟通群"`（集成）。
3. **归档条目 JSONL 缺失容错（§8-3）**：归档条目的 JSONL 磁盘文件被删除时，`GET /api/agent/sessions` 仍然正常返回 200 与该会话元数据，不 500、不阻断列表加载（集成）。

---

## REQ-AGENT-126 归档条目只读回看与写操作守护

- 优先级 P0 / 必须 / intra-module / routes/agentSessions + sessionDomain / agent-dialogue / conversation-space / 集成
- 接口契约：对 `feishu:<chatId>:gen<N>` 格式 spaceKey，`GET /api/agent/sessions/:spaceKey/messages` 返回历史消息；POST 写端点（messages / reset / provider / mode）均返回 403 `E-SESSION-READONLY`。

验收标准：
1. **历史消息只读回看（锚点 §6.3-4）**：调用 `GET /api/agent/sessions/feishu%3Aoc_123%3Agen2/messages` → 返回 200 `{ messages: [...] }`，包含 gen2 的全部历史消息，messageId、role、createdAt、text 与重置前一致（集成）。
2. **缺失 JSONL 文件回看降级（§8-3）**：归档条目的 JSONL 文件被删除时调用 `GET /api/agent/sessions/feishu%3Aoc_123%3Agen2/messages` → 返回 200 `{ messages: [] }`，不返回 500（集成）。
3. **全写端点 403 守护（锚点 §6.3-7、§8-1）**：向归档键 `feishu:oc_123:gen2` 发起以下写请求：
   - `POST /api/agent/sessions/feishu%3Aoc_123%3Agen2/messages`
   - `POST /api/agent/sessions/feishu%3Aoc_123%3Agen2/reset`
   - `POST /api/agent/sessions/feishu%3Aoc_123%3Agen2/provider`
   - `POST /api/agent/sessions/feishu%3Aoc_123%3Agen2/mode`
   均返回 403 响应，响应体包含 `{ error: "E-SESSION-READONLY" }`（集成；v2 修订：字段名 code→error，与 PRD v0.2 锚点 7 / sendError 封套 / 已签核测试对齐——复审 R2 文档债务清偿）。
