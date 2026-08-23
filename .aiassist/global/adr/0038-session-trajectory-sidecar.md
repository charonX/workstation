# ADR-038: 会话轨迹采用全量自足 Sidecar JSONL

- **状态**: 已接受
- **日期**: 2026-08-23
- **Story**: 2026-08-22-tool-call-review（会话轨迹账本）

## 背景

agent 会话的工具调用明细此前只活在 renderer 内存（BUG-009 刻意决策：历史=对话文本，
工具不落历史投影），重开会话即丢失。需要为轨迹建立独立持久化真相，供「重开可回看」的
ledger/inspector/Timeline 消费。

调研发现两个关键事实：
1. PI SDK SessionManager 写的主 JSONL 本就包含 toolCall/toolResult 全量 payload——
   但它是外部依赖的内部格式，不受我们契约保护；
2. worker 是工具事件的唯一第一现场（turnEventPipeline 已有回合记点/usage 钩子），
   SSE registry 是 session-event 的哑管道。

## 决策

1. **sidecar 文件**：`<sessionDir>/<safeKey>[.N].traj.jsonl`，与主 JSONL 并存、世代对齐
   （session-config 携带 sessionRef，换代时 recorder 同步切换）。每行 JSON 记录
   **全量自足**：input/output/durationMs/usage/ttft/decode 内嵌行内，读取端单文件投影，
   不 join 主 JSONL。
2. **单调 seq 键**：worker 侧每世代从 1 递增、显式写入行内；API 层投影 `traj_<seq>` 字符串 id，
   游标分页与虚拟滚动行键复用。append-only 保证 seq=文件顺序=时间序。
3. **截断同标**：单载体（input/output 各自独立）≤256KB，复用 shrinkToolCarrier 迭代收紧语义，
   与 SSE 出站 limitSize 同源。
4. **单点同源双写**：recorder 把同一行对象 ① appendFileSync 落盘 ② 经既有 send 出站
   `trajectory-record` 事件（SSE 哑管道零改动转发）→ live 与重放天然同一记录模型。

## 替代方案（考虑过，为什么没选）

| 方案 | 为什么没选 |
|---|---|
| 扩展主 JSONL + 投影层区分 type | 重踩 BUG-009 坑：历史投影再次面对混合内容，契约面扩大 |
| sidecar 轻量计时层 + 读取端 join 主 JSONL | Input/Output 耦合 PI 内部格式（第三方包可能变）；join 任一侧缺失记录残废；省的磁盘在诊断场景量级小 |
| SQLite 轨迹表 | 引入 DB schema 迁移面；丢失「人类可 cat 单文件调试」与「随会话目录整体存在」的性质；分页/游标收益对 append-only 场景过剩 |
| 复用对话 SSE 事件 + renderer 补算 timing | live 缺 usage/ttft、重放才有 → 双数据源字段形状不一致，违反单一记录模型正确性要求 |

## 后果

- 正：单文件任何时刻可读（诊断面可靠性）；PI 升级零耦合；live/重放一致性免费获得；
  主 JSONL/历史投影/SQLite 全部零改动。
- 负：payload 双份存储（接受：256KB/载体兜底）；worker 写失败+推送成功的窗口内
  live 有而重放无该行（接受：诊断面宁多勿缺，PRD §8 已登记该状态）。

## 相关文件

- `.aiassist/stories/2026-08-22-tool-call-review/prd.md` §10（技术方案全文）
- `src/agent/trajectoryRecorder.js`（实现落点，BUILD 阶段创建）
- `src/services/sessionDomain.js` / `src/http/routes/agentSessions.js`（读取端扩展）
