# ADR-016: UI 多会话采用"空间 = 会话"模型，/reset 等效新开会话

- **状态**: 已修订（飞书条款由 ADR-037 接替：飞书 /reset 改为「归档 + 新行」，世代制不再沿用于飞书行语义；UI 空间条款与表结构决策不变）
- **日期**: 2026-08-06
- **相关 story**: 2026-08-02-ui-copilot
- **相关 REQ**: 待结晶（2026-08-02-ui-copilot S2）

## 背景

builtin-agent 建立的对话持久化模型是「空间唯一会话」：`agent_sessions` 表 spaceKey 唯一，一个空间（飞书单聊/群聊）对应一条活跃会话，/reset 与 provider/key 变更通过**世代机制**（sessionRef 换代 +1，新 JSONL 文件）重置上下文。

ui-copilot 要求 Codex 式多会话：一个项目下嵌套多条独立 chat（会话列表、行内＋新建、"没有聊天"空态），与"空间唯一会话"存在基数张力。

## 决策

1. **空间 = 会话**：每条 chat 是一个独立上下文空间。空间 key 语法：
   - `ui:copilot:<sessionId>`（通用分组）
   - `ui:project:<projectId>:<sessionId>`（项目分组）
   - `feishu:<chatId>`（不变，世代制沿用）
2. `agent_sessions` 表结构不破：仅新增 `title` 附加列（首条用户消息截断写入）；列表 = key 前缀查询 + join projects（pid 缺失 → 孤儿标记）。
3. **UI 空间 /reset（/clear）= 新建同分组会话并切换**（新 sessionId 行），旧会话留列表可回看、可继续。世代机制不用于 UI 空间——UI 每条新 chat 本来就是新空间，无需世代。
4. 世代机制保留给：飞书空间 /reset、provider/key 变更重建（既有行为不动）。

## 后果

- 会话隔离语义清晰：每条 chat 独立上下文（Codex 语义），项目维度的连续性靠列表可见性承载，不靠共享上下文。
- 按空间装配（cwd/skills/权限 profile）自然落在会话粒度：项目空间 cwd=项目目录、挂项目 skills——恰好满足 ui-copilot 工具面分级。
- 持久化/恢复/挂起队列全部零改动复用（空间语义不变，只是行变多）。
- 代价：空间 key 变长且需前缀解析；`ui:copilot` 原预留语义（单一通用空间）被 `ui:copilot:<sid>` 取代。

## 替代方案

- **B. 空间 = 项目，会话 = 空间内多条记录**：放开 spaceKey 唯一约束、改 /reset 与恢复语义、引入第二级上下文隔离——改动穿透内核边界，违反"内核不动"约束，且同项目 chat 共享上下文非 Codex 语义。

## 相关文件

- 方案：`.aiassist/stories/2026-08-02-ui-copilot/tech-design.md`（D1）
- 存储：`src/services/sessionStore.js`、`src/db.js`（agent_sessions 表）
