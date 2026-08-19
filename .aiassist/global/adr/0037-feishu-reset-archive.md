# ADR-037: 飞书 /reset 从「单行世代制」改为「归档 + 新行」——历史会话 UI 可见可回看

- **状态**: 已接受
- **日期**: 2026-08-19
- **相关 story**: 2026-08-19-feishu-reset-history-archive
- **相关 REQ**: REQ-AGENT-123 ~ REQ-AGENT-126
- **修订**: ADR-016 决策 1/4 的飞书条款

## 背景

ADR-016 确立「空间 = 会话」模型时，飞书空间沿用 builtin-agent 的「空间唯一会话 + 世代制」：`agent_sessions` 单行 `feishu:<chatId>` 原地换代（sessionRef 世代 +1），旧世代 JSONL 留盘但无任何入口可达。结果：用户在飞书发 `/reset` 后，之前的历史对话在 UI 会话列表中彻底不可见、不可回看——与 UI 空间「/reset = 新行 + 旧行保留可回看」的语义形成体验断裂。

## 决策

1. **飞书 /reset = 归档 + 新行**：`sessionStore.reset("feishu:<chatId>")` 在单事务内把当前行改名为归档键 `feishu:<chatId>:gen<N>`（N = 被归档世代号；title/sessionRef/lastActiveAt/createdAt 全保留），并新建 `feishu:<chatId>` 活跃行（title=NULL、provider/model=NULL 回落默认、createdAt=lastActiveAt=此刻、sessionRef=世代 N+1 新 JSONL）。
2. **世代编号延续**：新活跃行继续 N+1（同一 safeKey 基名，防文件碰撞）；worker 侧世代命名镜像零改动。
3. **空世代不归档**：活跃行消息投影为空时退回原地换代（不产生无内容归档条目）。
4. **归档条目只读**：归档键仍属 `feishu:` 前缀只读域——HTTP 写面（messages/reset/mode/provider）403 E-SESSION-READONLY 天然覆盖；消息回看复用既有 JSONL 投影，零改动。
5. **写面守护扩面（记录）**：mode/provider 的 `feishu:` 前缀守护对活跃行同样生效（此前活跃 feishu 行可 PUT provider/mode）——与飞书通道单向写入语义一致；POST stop 为幂等 no-op 设计，不列入只读守护。
6. **路由/渲染零改动**：`spaceKeyFor(chatId)` 恒产活跃键；列表分组/排序/SessionItem 渲染对归档键天然成立（displayName 经逆解析 `:gen\d+$` 后缀查 spaceMeta）。

## 后果

- 飞书 /reset 后历史对话以只读条目留在 UI 列表（按 lastActiveAt 倒序），点开可回看全部历史消息；活跃会话上下文仍被清空（onReset 通知形态不变，agentService/worker 零改动）。
- `agent_sessions` 行数随归档增长（与 UI 空间同级，表结构不破——仅 UPDATE 改名 + 同 schema INSERT）。
- 重启水合会把 mtime 1h 窗口内的归档行一并水合（worker 建永不交互的句柄，占 LRU 名额）：无害资源浪费，接受；如需收敛可在水合处过滤 `:gen\d+$`。
- 与既有 ADR 兼容确认：ADR-026（归档行保留 provider/model 快照、新行 NULL 回落默认——语义兼容）、ADR-030（sessionStore 经 import 消费 sessionDomain 投影，方向合规）、ADR-033（`db()` 访问器 + better-sqlite3 transaction，归档原子性成立）。
- 升级前残留的孤儿世代 JSONL（无对应行）不回填为归档条目（story §12 范围外）。

## 替代方案

- **B. 单行 + 列表 API 展开世代**：行不变，listSessions 按 sessionDir 扫描展开历史世代为条目——缺逐世代 title 载体（title 是行级字段），且把持久化事实转成读取期派生，排序/分页语义复杂化。
- **C. 每会话全新 spaceKey + chat→活跃映射**：引入第二级映射表，改动穿透路由层，收益不抵成本。

## 相关文件

- 方案：`.aiassist/stories/2026-08-19-feishu-reset-history-archive/prd.md`（§10）
- 存储：`src/services/sessionStore.js`（reset 归档事务）、`src/http/routes/agentSessions.js`（displayName fallback + 只读守护）
