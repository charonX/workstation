# 访谈笔记 — 2026-08-22-tool-call-review

## 核心问题

重开会话后工具调用不可回看。工具块只实时呈现不落历史（BUG-009 刻意决策：历史=对话文本），
调试/复盘时丢失 agent 实际执行了哪些工具、输入输出、耗时、token 的全部轨迹证据。
用户需要一个 **独立「轨迹」视图的完整会话账本**（deepseek ui-trajectory 全量对标），重开后仍在。

## 用户画像

- 使用者=用户自己（开发者）：开发/排查 agent 工具与命令，定位哪个工具慢/出错。
- 场景：跑完一段对话后切到轨迹视图查账；重开应用/会话后轨迹仍可回看。

## 关键边界（十问收敛）

1. **视图归属**：独立轨迹视图（与对话气泡流并列/可切换），不污染对话历史投影（Q1=A）。
2. **野心层级**：ui-trajectory 全量——ledger + inspector + Timeline Overview
   （TTFT/decoding 拆分、缩放/区间过滤）+ 虚拟滚动 + 嵌套 subtool（Q2=B）。
3. **持久化**：硬要求——重开应用/会话后可回看；数据落盘（Q3=A）。
4. **落盘形态**：侧车文件 `.traj.jsonl`，与主会话 JSONL 并存，物理隔离（Q5=C）。
5. **写入侧**：对话 worker 侧写（第一现场，toolAdapter/turnEventPipeline 处补齐
   toolCallId 后精确归组）；主 JSONL 与历史投影契约不动（Q10=A）。
6. **老会话**：接受空白——只对功能启用后的新会话有轨迹，不回填（Q6=A）。
7. **嵌套语义**：task run → 子 flow → 内部 agent 再调工具（Q7=A）；
   但第一版只做对话 worker 侧单层账本，嵌套子执行保留「入口跳转」到既有
   ExecutionDetail，内部展开留后续 story（Q9=A 修正 Q7 的范围现实性）。
8. **挂载点**：仅对话空间会话内切换「对话/轨迹」两视图；flow 执行详情不嵌
   工具轨迹（Q8=A）。

## 隐含假设

- BUG-009「历史=对话文本」契约保持有效——轨迹是新增平行数据面，不是修订历史投影。
- 轨迹数据与主 JSONL 同生命周期问题（/reset 换代、飞书归档世代）需在 PRD 明确：
  sidecar 按 `<safeKey>[.N].traj.jsonl` 世代对齐主 JSONL 是自然形态（待 PRD 定案）。
- sidecar 单条大小需要截断策略（IPC 有 256KB 上限；文件侧可更宽但必须有限度，
  否则大输出工具一次调用写数 MB）。

## 矛盾/风险

1. **Q2=B（全量）vs Q9=A（第一版剥离嵌套展开）**：野心完整、交付分层——Timeline/
   虚拟滚动在本 story 内做，嵌套内部展开明确 out of scope（跳转入口替代）。
2. **TTFT/decoding 拆分的数据基础**：worker 已有 turnStartedAt（text_start 记点）、
   text_end 延迟到 message_end（携带 usage.input/output）。TTFT = 首 text_delta −
   回合起点；decoding = text_end − 首 delta。事件时间戳在 worker 侧现算现记即可，
   但 sidecar 行需要自带 ts（不能靠文件顺序推断）。
3. **虚拟滚动无现成依赖**（package.json 无 react-virtual 类库）——自实现窗口渲染
   或引小依赖，PRD §11 测试决策要覆盖 prepends 保键（deepseek 语义行键+ARIA 序号）。
4. **live 与重放双数据源统一**：实时段走 SSE 增量，历史段走 sidecar 读——组装层
   必须单一路径归一（参考 deepseek「Trajectory 自行组装记录，不读改 Chat snapshot」）。
5. **compaction 区块**：deepseek 有「Between turns」压缩记录区；我们系统有上下文压缩
   （session-stats tokens null 形态）但无对应事件——v1 不做该区块（PRD 明确不做）。

## 参考实现（已调研）

### deepseek ui-trajectory（对标系）
- ledger 只显示 index/event/content；选中开 inspector（token 用量/耗时/Input/Output/Timing）。
- 粗线=turn 边界、紧凑标记=step；compaction 独立「Between turns」区。
- Timeline Overview：固定条带投影真实 start/duration；assistant span 拆 TTFT/decoding；
  500ms hover 显钟表时间；滚轮缩放时间域、拖拽区间过滤 ledger、右键清除/平移。
- 虚拟滚动：打开定位于尾部、顶触加载上一页、只挂可见窗+overscan、prepends 保
  语义行键与 ARIA 序号；流式内容帧保行键/高度复用测量；上滑暂停跟随。
- in-flight 行不伪造时长（partial/running 只显起始标记）。
- 数据所有权：Trajectory 从共享 Session 窗口自行组装业务记录（取消前缀、chunk-only
  中断兜底、interrupted 工具记录），不读不改 Chat snapshot。

### pi-observability 家族（辅助参考）
- @spences10/pi-observability：本地 web dashboard——trace summary（耗时/blocking/
  错误/token 成本汇总）、session context、waterfall bottlenecks（span 按时长排序）、
  event inspector（懒加载 JSON payload）；SQLite 存储 + 保留天数配置。
  → 借鉴点：waterfall 排序视角、inspector 懒加载 payload、保留策略意识。
- imran-vz/pi-observability：TPS 汇总/每轮分解 → 借鉴 per-turn 分解口径。
- pi-trace-extension：Langfuse 式 execution view（session→interaction→turn→LLM
  generation + tool tree）、events.jsonl + 自包含 trace.html → 借鉴事件文件形态
  （与我们 .traj.jsonl 同构）与树状工具分组。
- 本地已装 @earendil-works/pi-telemetry（vendor-neutral span/attribute/event/status
  契约）——PRD 可评估是否借其 schema 思路，但不强制引入依赖。

## 本地事实（已查证）

| 事实 | 出处 |
|---|---|
| 工具事件契约字段齐全：start{toolCallId,name,input} / end{toolCallId,output,isError} / error{toolCallId?,errorCode,errorMessage} | `src/agent/turnEventPipeline.js` mapToContractEvent |
| 回合起点已有记点（text_start→turnStartedAt），message_end 携带 usage{input,output}，text_end 延迟冲刷 | 同上 flushPendingTextEnds |
| SDK 层有 agent_start/end、turn_start/end、message_update 可订阅（现仅计数） | worker.js SDK_COUNTED_EVENT_TYPES |
| durationMs 现为 renderer 内存计算（reduceToolEvent startedAt 差值），未落盘 | Assistant.jsx |
| worker 侧已有 safeKeyFor/generationFromRef/sessionRefFor 镜像实现（子进程零耦合） | worker.js L478-492 |
| 历史投影只认 type==="message" 且 role∈{user,assistant}——sidecar 独立文件则投影零改动 | sessionDomain.js projectLine |
| flow agent 节点（第二条路径）只有节点级明细，无工具级事件——嵌套内部展开成本高 | ExecutionNodeList/agentExecutor |

## 确认方向

最终确认的方向：**C（全量 ui-trajectory 对标，分阶段交付：本 story 含 ledger+inspector+
Timeline+虚拟滚动+worker 侧落盘；嵌套内部展开剥离到后续 story，v1 提供跳转入口）**
+ 参考 pi-observability 的 waterfall/inspector/保留策略实践。

确认意图（步骤 7 显式 yes，用户原话「我选方向C」）：

- Outcome: 会话内独立「轨迹」视图，重开可回看工具调用明细；ledger+inspector+
  Timeline Overview（TTFT/decoding、缩放/区间过滤）+虚拟滚动；task run 子执行跳转入口
- User: 开发者本人（调试 agent 工具与命令）
- Why now: 工具证据随会话重开丢失（BUG-009 决策的盲区），调试定位慢/错工具无凭据
- Success: 重开新会话 → 切轨迹视图 → 完整工具账本（含耗时/错误/token）按时间序
  浏览；Timeline 可缩放过滤定位慢段；重载后一致
- Constraint: 历史投影契约不动；sidecar 与主 JSONL 并存且世代对齐；老会话空白；
  第一版不动 flow 执行器；in-flight 行不伪造时长
- Out of scope: 嵌套 subtool 内部展开（扩展 flow 执行器）、flow 执行详情内嵌工具轨迹、
  老会话回填、Between-turns compaction 区块

确认理由：用户明确选 C 并点名 pi-observability 参考；嵌套范围经 Q9 现实化修正后接受。

## 最窄的切入点

先立 sidecar 写入链（worker 侧：工具事件+回合边界+usage 带 ts 落盘）——它是全部
UI 能力的数据前提；随后 ledger 重放读通，再叠 inspector/Timeline/虚拟滚动。

## 待确认问题

- [ ] sidecar 截断上限取值（建议沿用 256KB/条或单独定标，PRD 定）
- [ ] sidecar 保留策略：是否跟随会话删除/世代清理（PRD §10 定案）
- [ ] 虚拟滚动自实现 vs 引依赖（tech-design 决策）
- [ ] Timeline 缩放/过滤交互的最小验收集（PRD §6.3 锚点细化）
