# 会话轨迹账本（Trajectory Ledger）

> 状态：探索期
> 故事 ID：`2026-08-22-tool-call-review`
> 最后更新：2026-08-23

---

## 1. 问题陈述

用户调试自己开发的 agent 工具与命令时，无法回答「这一轮 agent 到底干了什么、哪个工具慢、哪个工具错了」：

- 工具折叠块只在实时流式期间存在于内存，会话重开即全部丢失（BUG-009 刻意决策：历史=对话文本）；
- 工具耗时是前端临时计算的，token 用量只在回复元数据里，都不落盘；
- 排查慢工具/错工具只能靠翻子进程日志，没有结构化凭据。

## 2. 解决方案

给每个对话空间会话加一个**独立「轨迹」视图**：turn-aware 事件账本（ledger）+ 行级详情检查器（inspector）+ 时间线总览（Timeline Overview），对标 deepseek-harness `ui-trajectory` 的完整交互（含虚拟滚动、TTFT/decoding 拆分、缩放区间过滤）；数据由对话 worker 在第一现场落盘到与会话 JSONL 并存的侧车文件，**重开应用后仍可回看**。实现参考 pi-observability 家族的 waterfall/inspector/保留策略实践。

## 3. 用户故事

1. 作为开发者，我想要在会话重开后仍能浏览每次工具调用的输入/输出/耗时/错误，以便定位哪个工具慢、哪个工具有 bug。
2. 作为开发者，我想要看到每个回合的时间线拆解（模型首字延迟 vs 解码时长 vs 工具耗时），以便知道一轮回复的时间花在哪。
3. 作为开发者，我想要选中任意账本行查看完整 Input/Output/token 明细，以便核对 agent 实际发给工具的参数和拿到的结果。
4. 作为开发者，我想要在长会话中快速滚动/按时间区间过滤账本，以便在几百条记录里找到目标片段。
5. 作为开发者，当 agent 通过 task run 触发了子流程时，我想要从该工具记录一键跳转到子执行的详情页，以便继续下钻。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | **轨迹落盘（sidecar 写入链）**：worker 在第一现场把回合边界、用户消息标记、assistant 时间片（TTFT/decoding/usage）、工具调用（id/名/输入输出/耗时/isError）、中断收尾追加写进 `<sessionDir>/<safeKey>[.N].traj.jsonl`，世代与主 JSONL 对齐 | 用户拍板 Q5=C/Q10=A；数据源与写入位置经代码实证可行（管线已有回合起点记点/message_end usage/工具事件契约字段）；物理隔离保住 BUG-009 契约 |
| 2 | **轨迹读取 API**：HTTP 端点按会话读 sidecar，投影为归一记录列表，支持游标分页与损坏行计数 | REST 风格与既有 agentSessions 路由族一致；分页对齐虚拟滚动「顶部加载一页」 |
| 3 | **视图切换入口**：对话窗内「对话 / 轨迹」双 tab；所有会话可开轨迹视图（飞书归档/孤儿会话天然只读） | 用户拍板 Q1=A/Q8=A；轨迹本身即回看语义，只读约束自然成立 |
| 4 | **Ledger 行渲染**：粗线标回合边界；行类型=user/assistant/tool/turn 标记；收起态只显 index/事件/内容摘要；in-flight 行不伪造时长（running 只显起始标记） | deepseek 语义直接采纳；与现有 ToolCallBlock 三态语义同构 |
| 5 | **Inspector 详情**：选中行展开本地检查器——Input、Output、Timing（起止钟表时间+时长）、token 用量；再点击收起 | deepseek 语义；数据字段稳定块 1 已全量覆盖 |
| 6 | **Timeline Overview**：账本上方固定条带按真实 start/duration 左右投影；assistant 片段拆 TTFT/decoding 两段；hover 500ms 显钟表时间；滚轮缩放时间域、拖拽区间过滤账本、右键清除选择/平移已缩放视口 | 用户拍板 Q2=B 全量对标；交互语义照搬 deepseek，无自定义发明 |
| 7 | **虚拟滚动**：只挂可见窗+overscan；打开定位于尾部；上滑暂停跟随、回底恢复；顶触加载上一页（语义行键与序号在 prepend 后保持） | 长会话可用性硬需求；deepseek 语义 |
| 8 | **实时流式接入**：live 会话期间 SSE 增量并入账本；内容帧更新保行键与已测高度；与重放路径共用同一记录模型 | 双数据源统一是正确性核心；项目已有纯函数 reducer + SSR 自验先例（reduceToolEvent） |
| 9 | **子执行跳转入口**：name=`task run` 的工具记录从其 output.executionId 渲染跳转入口，点击导航到该执行的详情页 | 执行创建返回 `{id, executionId}` 已实证；嵌套内部展开明确范围外（Q9=A） |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| 1 | Between-turns 压缩区块的呈现形态 | compaction_start/end 事件 SDK 已提供、稳定块 1 会采集入库；但「独立 Between turns 区」还是「行内标记」的呈现未定，等用上真实压缩数据后再定 |
| 2 | thinking 载体在账本的呈现粒度 | thinking_* 事件可采集；但逐段展示还是折叠聚合未定（现有对话流也不消费 thinking） |

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 在会话中正常对话（含工具调用） | worker 把回合边界/assistant 时间片/工具调用逐条追加写 sidecar；对话流呈现不变 | 锚点 T1/T2 |
| 2 | 关闭并重开应用，进入该会话 | 对话流照常（历史=文本，不含工具）；默认仍在对话 tab | 锚点 R1 |
| 3 | 点击「轨迹」tab | 加载轨迹视图：账本按时间序渲染全部记录行，定位于尾部 | 锚点 V1/L1 |
| 4 | 点击一条 tool 行 | 该行高亮；inspector 展示 Input/Output/Timing/token | 锚点 I1 |
| 5 | 观察 Timeline 条带 | 各记录按时长投影；assistant 片段呈 TTFT+decoding 两段 | 锚点 TL1 |
| 6 | 在 Timeline 上滚轮缩放、拖拽区间 | 时间域缩放；账本过滤为区间内记录；右键清除/平移 | 锚点 TL2/TL3 |
| 7 | 向上滚动账本 | 跟随暂停（新记录不打断查看）；触顶加载更早一页 | 锚点 VS1/VS2 |
| 8 | 回到对话 tab 发新消息，切回轨迹 | 新回合记录实时出现在账本尾部（跟随恢复时） | 锚点 S1 |
| 9 | 在含 task run 的会话打开轨迹，点击子执行入口 | 导航到该 executionId 的执行详情页 | 锚点 J1 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 打开无 sidecar 的会话（老会话/启用前） | 账本空态：「该会话没有轨迹记录（功能启用前的会话不追溯）」；对话 tab 不受影响 | E-TRAJ-EMPTY |
| sidecar 存在但含损坏行 | 跳过损坏行继续渲染其余；响应 meta 带跳过计数 | E-TRAJ-PARTIAL（非阻断） |
| 单条记录超大小上限 | 写入时截断载体并带 `truncated:true`；inspector 显示截断标注 | 截断标注（非阻断） |
| 轨迹视图停留期间 SSE 断线 | 账本冻结当前态；重连后全量对齐（复用既有 align 模式），补齐缺失记录 | 复用既有断线语义 |
| 会话 /reset | 新世代 sidecar 从空开始；旧世代轨迹随归档行仍可回看 | 世代对齐语义 |
| 流式中用户停止/出错 | running 工具行收尾为 interrupted（不伪造时长）；回合行带中止标记 | 中断收尾语义 |
| 请求不存在的会话轨迹 | 404 既有 notFound 形态 | E-SESSION-NOT-FOUND 族 |
| Timeline 无任何带时长记录 | 条带区隐藏（不留空白条） | 空 Timeline 态 |

### 6.3 预期值锚点（Expected-Value Anchors)

<!-- test-author 从本表机械推导断言 expected 值 -->

| 稳定块 | 输入 | 预期输出/结果 | 依据 |
|---|---|---|---|
| T1 落盘-文件 | FAUX 会话发 1 条消息，`OPC_FAUX_TOOL_SEQUENCE=[{"tool":"project list"},{"tool":"settings get"}]`，回复完成后 | `<sessionDir>/<safeKey>.traj.jsonl` 存在；每行均为合法 JSON；至少含 1 行 `"type":"turn_boundary"`、2 行 `"type":"tool_call"` 且 `"status":"completed"`；每行含 ISO 8601 `"ts"` | worker 第一现场写入 |
| T2 落盘-工具行字段 | 同上序列第 1 个工具 | 对应行含非空 `"toolCallId"`、`"name":"project_list"`、数值 `"durationMs"` 且 `>0`、`"isError":false` | mapToContractEvent 契约字段 |
| T3 落盘-assistant 片段 | 同上一轮回复完成 | 存在 assistant 时间片记录：`"ttftMs"` 与 `"decodeMs"` 均为数值 ≥0；`"usage"` 为对象（含数值 input/output 字段，FAUX 下可为 0） | turnStartedAt 记点 + message_end usage 实证 |
| T4 落盘-中断 | 流式进行中 POST stop，当时有一个 running 工具 | 该工具行最终 `"status":"interrupted"`；中断路径不写出 durationMs（仅在真实 end 到达时才有） | in-flight 不伪造时长 |
| R1 历史投影不受污染 | T1 完成后 GET messages | 返回消息数组只含 user/assistant 文本消息，不含任何 tool 类型条目 | BUG-009 契约保持 |
| A1 读取 API | GET `/api/agent/sessions/<encoded>/trajectory?limit=2`（sidecar 有 ≥3 条记录） | 200；`records.length===2`；`hasMore===true`；`meta.skipped` 为数值 | 游标分页契约 |
| A2 读取 API-游标 | 以上一页末条 id 作 `before` 再取 | 返回严格早于该 id 的窗口，时间升序 | 分页语义 |
| V1 视图切换 | 点击「轨迹」tab | `[data-testid="trajectory-view"]` 可见且 `[data-testid="message-list"]` 不可见；再点「对话」反向 | DOM 结构锚 |
| L1 Ledger-重放 | T1 会话重开应用后进轨迹视图 | 账本恰渲染 4 条记录行（1 user + 1 assistant + 2 tool）+ 回合边界标记；行顺序=sidecar 顺序 | 重放完整性 |
| L2 Ledger-in-flight | 流式中观察最新 tool 行 | running 行显示起始标记、无时长文本；完成后出现时长 | 不伪造时长 |
| I1 Inspector | 点击 L1 中第 1 条 tool 行 | inspector 面板可见，内含工具名字面 `project_list` 与「输入」「输出」「耗时」三节；再点同行收起 | 选中-检查器语义 |
| TL1 Timeline-分段 | L1 会话的 Timeline | assistant 片段渲染两段：`[data-timeline-segment="ttft"]` 与 `[data-timeline-segment="decode"]` 各 ≥1 | TTFT/decoding 拆分 |
| TL2 Timeline-缩放过滤 | 在 Timeline 滚轮缩小时间域后拖选只含第 2 个工具的区间 | 账本只剩区间内记录（第 2 条 tool 行可见、第 1 条不可见）；右键单击清除选择后全部恢复 | 缩放/区间过滤语义 |
| VS1 虚拟滚动-窗口 | 注入 ≥500 条记录的会话打开轨迹 | 同时挂载的行节点数 ≤ 可见窗+overscan 上界（组件级 harness 断言具体上界值） | 只挂可见窗 |
| VS2 虚拟滚动-跟随 | 轨迹视图停留时向上滚动，随后新记录到达 | 账本不自动跳底（跟随暂停态可见）；滚回底部后恢复跟随 | 上滑暂停跟随 |
| S1 实时接入 | 对话 tab 发消息产生 1 次工具调用，切回轨迹 tab | 账本新增对应记录且行键稳定（内容帧更新不换键） | 单一记录模型 |
| J1 子执行跳转 | 会话含 name=`task run` 且 `output.executionId="ex123"` 的工具记录 | 该行渲染跳转入口；点击后应用路由到 ex123 的执行详情 | 执行返回 `{id, executionId}` 实证 |

## 7. 表单与输入验证（Form / Input Validation）

本 story 无用户输入表单。唯一外部输入面是轨迹 API 的查询参数，规则如下：

| 输入字段 | 规则 | 有效例子 | 无效例子（→错误提示） | 错误状态 |
|---|---|---|---|---|
| `limit` | 正整数，缺省 200，上界 1000 | `?limit=50` | `?limit=0`、`?limit=abc` → 按缺省处理（normalizeLimit 先例） | 400 不适用——静默归一（与既有 limit 语义一致） |
| `before` | 记录 id 字符串，可选 | `?before=rec_0042` | 不存在的 id → 视为无游标取最新窗口（paginateMessages 先例） | 同上 |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 例子（触发 → 期望结果） | 错误状态 |
|---|---|---|---|
| 分页参数组合 | limit+before 同时携带 | `?limit=2&before=rec_0010` → 返回严格早于 rec_0010 的至多 2 条 | — |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| 无轨迹数据 | sidecar 文件不存在（老会话/世代刚换代） | E-TRAJ-EMPTY | 账本空态卡：「该会话没有轨迹记录（功能启用前的会话不追溯）」 | 无 |
| 损坏行 | sidecar 某行非法 JSON | E-TRAJ-PARTIAL（响应 meta.skipped=N） | 跳过坏行渲染其余；不阻断 | 无 |
| 写入失败但推送成功 | worker appendFileSync 异常而 IPC 正常 | 进程 stderr 日志（redact 后） | live 账本可见该行、重开后消失——诊断面「宁多勿缺」语义，接受 | 丢弃该条，后续继续尝试 |
| seq 断档/重复 | worker 重启恢复边界异常 | —（防御路径） | renderer 按 seq 幂等并入：重复原位覆盖；断档不影响渲染（seq 仅排序键非密度假设） | 无 |
| 写入失败 | worker 侧磁盘写异常 | 进程 stderr 日志（redact 后） | 用户无感——轨迹是诊断面，绝不影响对话主链路 | 丢弃该条，后续继续尝试 |
| 会话不存在 | API 指向未知 spaceKey | 404 既有形态 | 轨迹视图不打开（列表层已拦截） | 无 |
| SSE 断线 | 轨迹视图停留期连接断 | 复用既有断线语义 | 冻结当前账本；重连后全量对齐补齐 | 无 |
| 中断收尾 | stop/错误打断回合 | —（行为态非错误码） | interrupted 行样式（弱化+标记），无伪造时长 | 无 |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 新增持久化工件（sidecar 格式=难逆转决策）；跨 4 层模块（worker 写入→HTTP 读取→renderer 组装→三个 UI 子系统 ledger/inspector/timeline）；双数据源（重放+流式）一致性；虚拟滚动+时间域缩放两个重前端工程；外部依赖 PI SDK 事件面虽已实证但组合方式多分支 |

## 10. 技术方案（Implementation Decisions）

> complex story，经 `/tech-design` 对抗式深潜完成（2026-08-23，四问四答：全量自足=A、256KB/载体=A、单调 seq=A、trajectory-record 单点同源=B）。

### 10.1 设计目标

- 给 agent 会话建立「重开可回看」的结构化轨迹真相：worker 第一现场落盘 sidecar（唯一真相），读取端单文件投影，renderer 单一记录模型三子系统呈现，全链路可测。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| `src/agent/trajectoryRecorder.js` | worker 侧第一现场记录器（工厂注入 send/fs/sessionDir/now）：消费 PI SDK 事件 + 管线钩子，组装归一轨迹行 → appendFileSync sidecar + 同行经 `send({type:"trajectory-record"})` 出站。持有每会话 seq 计数器（换代清零）、回合起点记点 | 是 |
| `src/services/sessionDomain.js` | 追加轨迹读取投影纯函数：`readTrajectoryRecords(sessionRef)`（读 sidecar→跳损坏行→归一化+截断标注→升序数组）+ 游标分页复用 paginateMessages 形态。ADR-030 会话领域收编惯例的延伸 | 否（扩展） |
| `src/http/routes/agentSessions.js` | 新增 GET `.../trajectory` 端点：404 检查 → limit/before 解析（parsePaginationQuery 复用）→ 投影 → `{records, hasMore, meta:{skipped}}`。响应助手按 STANDARDS 从 responders.js 导入 | 否（扩展） |
| `src/services/sessionSseRegistry.js` | **零改动**——`session-event` 哑管道自动转发新事件类型 `trajectory-record`（≤256KB 截断契约由 agentService 出站侧承担） | 否 |
| renderer `src/renderer/components/trajectory/` | 三子组件 + 一个纯函数 reducer 模块：`trajectoryModel.js`（归一记录模型 + merge/apply 纯函数，node 可导入 SSR 自验）；`TrajectoryView.jsx`（tab 容器+数据编排）；`Ledger.jsx`（虚拟滚动账本）；`TimelineOverview.jsx`（时间域条带）；`Inspector.jsx`（行详情） | 是 |
| `src/renderer/api/agentSessions.js` | 追加 `getTrajectory(spaceKey, {limit, before})` API 封装 | 否（扩展） |

#### 模块关系图

```
[PI SDK AgentEvent/AgentSessionEvent]
        │ subscribe（既有）
        ▼
[worker] ──▶ [turnEventPipeline]（既有 SSE 契约出站，不动）
        │
        └─▶ [trajectoryRecorder ◆新]──① appendFileSync──▶ <safeKey>[.N].traj.jsonl
                    │                                        （唯一轨迹真相）
                    └─② send trajectory-record（同一行对象）
                           ▼
                    [agentService IPC] ── session.emit("session-event")
                           ▼
                    [sessionSseRegistry]（零改动哑管道）──▶ SSE
                           ▼
[TrajectoryView ◆新] ◀─ GET .../trajectory（重放）＋ SSE trajectory-record（live）
        │ trajectoryModel.js 纯函数归一（单一记录模型）
        ├─▶ Ledger.jsx（虚拟滚动）
        ├─▶ TimelineOverview.jsx（缩放/区间过滤）
        └─▶ Inspector.jsx（选中行详情）
```

### 10.3 数据流

1. **触发**：worker 收 prompt → PI SDK 产出 turn_start/message_*/tool_execution_*/compaction_* 事件。
2. **记录组装**：trajectoryRecorder 按事件序列组装归一行——turn_boundary（agent_start 记点）/ user_message / assistant_span（首 text_delta−回合起点=ttftMs；message_end−首 delta=decodeMs；usage 全量入行）/ tool_call（start 建 running 行，end/error 按 toolCallId 回填 output/isError/durationMs；stop 中断由 agent_end 时仍 running 的行收尾为 interrupted）/ compaction（start/end 入库，呈现归移动块）。
3. **双写**：同一行对象 ① appendFileSync 到当前世代 sidecar（写失败仅 stderr 日志，丢弃该条继续）② 经 send 出站 `trajectory-record`（limitSize 截断后 ≤256KB）。
4. **live 并入**：SSE → TrajectoryView reducer 按 seq 追加/回填（seq 已存在则原位更新——running 行收尾路径），保行键。
5. **重放**：打开轨迹视图 → GET trajectory（游标分页从尾部窗口起）→ reducer 以相同模型灌入 → 顶触加载更早页（before=当前最小 seq）。
6. **副作用**：仅 sidecar 文件追加；主 JSONL/SQLite/历史投影零改动。/reset 与 provider-change 换代时主进程重发 session-config（携带新 sessionRef）→ recorder 关旧句柄开新文件，seq 清零。

### 10.4 接口契约

#### 接口 1：sidecar 行 schema（`<sessionDir>/<safeKey>[.N].traj.jsonl`）

| 项目 | 说明 |
|---|---|
| 写方 | worker trajectoryRecorder |
| 读方 | sessionDomain.readTrajectoryRecords / 直接调试（人类可 cat） |
| 格式 | JSONL，每行一记录；行内字段自足（不依赖物理行号/顺序推断） |
| 公共字段 | `v:1`（schema 版本）、`seq`（≥1 单调递增）、`ts`（ISO 8601）、`type` |
| type 枚举 | `turn_boundary{turn}` / `user_message{text}` / `assistant_span{textPreview, ttftMs, decodeMs, usage:{input,output,cacheRead,...}}` / `tool_call{toolCallId, name, status:running\|completed\|error\|interrupted, input?, output?, isError?, errorCode?, errorMessage?, durationMs?}` / `compaction{reason, phase:start\|end}` |
| 截断 | input/output 载体各自独立截断 ≤256KB（shrinkToolCarrier 语义），截断后带 `truncated:true` |
| durationMs 缺省语义 | 仅真实 end/error 到达时写入；interrupted 行恒无 durationMs（in-flight 不伪造时长） |

**样例（golden values）**：

| 场景 | 行内容（关键节选） |
|---|---|
| 工具完成 | `{"v":1,"seq":4,"ts":"2026-08-23T08:00:01.000Z","type":"tool_call","toolCallId":"tc_01","name":"project_list","status":"completed","isError":false,"durationMs":42300,"input":{"limit":100},"output":{...}}` |
| 工具中断 | `{"v":1,"seq":7,"type":"tool_call","toolCallId":"tc_02","name":"bash","status":"interrupted","input":{...}}`（无 durationMs/output） |
| assistant 时间片 | `{"v":1,"seq":3,"type":"assistant_span","ttftMs":830,"decodeMs":2140,"usage":{"input":1842,"output":156,"cacheRead":512}}` |

#### 接口 2：GET `/api/agent/sessions/<encoded>/trajectory`

| 项目 | 说明 |
|---|---|
| 调用方 | renderer TrajectoryView（重放路径） |
| 被调用方 | routes/agentSessions.js → sessionDomain 投影 |
| 输入 | path spaceKey；query `limit`（正整数，缺省 200 上界 1000）、`before`（`traj_<seq>`，可选） |
| 输出 | `{ records:[归一行], hasMore:boolean, meta:{ skipped:number } }`——records 升序、严格早于 before、至多 limit 条 |
| 业务错误 | 会话不存在 → 404 E-SESSION-NOT-FOUND（sendError 既有封套） |
| 系统错误 | sidecar 缺失 → 200 空数组（E-TRAJ-EMPTY 由前端空态承接，不是 HTTP 错误）；损坏行 → 跳过并计入 meta.skipped（E-TRAJ-PARTIAL 非阻断） |
| 副作用 | 无 |
| 幂等性 | 是（纯读） |

**样例（golden values）**：sidecar 有 seq 1..5 → `?limit=2` 返回 `[rec4, rec5]`（尾部窗口）、hasMore=true；`?before=traj_4&limit=2` 返回 `[rec2, rec3]`。

#### 接口 3：IPC/SSE 事件 `trajectory-record`

| 项目 | 说明 |
|---|---|
| 调用方 | worker trajectoryRecorder |
| 被调用方 | agentService.handleChildMessage → session.emit("session-event", limitSize(msg.event)) → SSE registry 原样转发 |
| 输入 | IPC `{type:"trajectory-record", sessionKey, event:<sidecar 行对象>}` |
| 输出 | SSE 帧 `data: {"type":"trajectory-record","record":<行对象>}` |
| 业务错误 | 无（诊断面，转发失败不影响对话） |
| 系统错误 | 出站超限 → limitSize 截断载体（SSE 侧与盘上文件可能不同：盘上是 shrinkToolCarrier 后的完整行，SSE 再过 limitSize 双保险） |
| 幂等性 | 至少一次语义；renderer 按 seq 幂等并入（重复 seq 原位覆盖） |

### 10.5 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| D1 全量自足 sidecar | A 全量 vs B 轻量计时层 join 主 JSONL | 诊断面可靠性优先：单文件任何时刻可读；解耦 PI 内部格式（不受我们契约保护）；B 省 的磁盘量级小且有 256KB 兜底 | payload 双份存储（接受） |
| D2 截断 256KB/载体 | 256KB vs 64KB vs 不设限 | 与 SSE 出站同标（shrinkToolCarrier 先例零新代码）；>256KB 单载体无人工阅读价值 | 超大输出在 inspector 不完整（truncated 标注可见） |
| D3 单调 seq 键 | worker 序号 vs UUID | append-only 文件天然单调；数值比较 O(1) 分页；live 续编无缝（重放 maxSeq+1）；显式写入行内抗损坏行漂移 | 无显著风险 |
| D4 trajectory-record 单点同源 | B 同行下发 vs A 复用对话事件+renderer 补算 | 锁约束 5 单一记录模型的正确性要求：live 与重放字段形状必须一致（A 下 usage/ttft live 缺失、重放才出现）；SSE registry 零改动 | 写失败但推送成功 → live 有而重放无该行（见 §8 补充行，接受：诊断面宁可多不少） |
| D5 虚拟滚动自实现窗口渲染 | 自实现 vs 引 react-window 类依赖 | 现有 renderer 零虚拟化依赖；行高固定 28px 场景下窗口渲染 ~60 行代码量级；避免为单一视图引依赖 | prepends 保键逻辑需测试锚（VS1 harness 断言挂载上界） |
| D6 Timeline 纯 DOM+CSS 变换 | canvas vs DOM | 记录量 ≤ 数千段，DOM 绝对定位足够；hover/右键/拖拽原生事件链简单；与设计 token 直接兼容 | 万级段落性能（超出 v1 场景，区间过滤已兜底） |

**ADR 落地**：D1+D3 合成「会话轨迹采用全量自足 sidecar JSONL」满足难逆转（存储格式+读取端耦合）/不说明会困惑（为什么不用 SQLite/为什么不 join 主 JSONL）/有真实取舍——生成 `adr/0038-session-trajectory-sidecar.md`。

### 10.6 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| PI SDK subscribe 事件面足够组装全部行类型（已实证 AgentEvent/AgentSessionEvent 枚举） | 缺事件 → 对应行类型缺失 | TECH-DESIGN | 能（已验证） |
| ttft 可从「回合起点→首个 text_delta」测得（FAUX 高速流下可能 <1ms，需 settle 语义容忍 0 值） | ttftMs 恒 0 → Timeline TTFT 段不可见 | PRD 锚点 TL1 放宽（0 值合法） | 能（单元注入时钟） |
| sidecar 与主 JSONL 世代切换原子性：reset 重发 config 与在途回合不并发（串行队列保证） | 换代瞬间行写错文件 | TECH-DESIGN | 能（单元模拟 reset 时序） |
| 256KB 截断对 FAUX/真实工具输出足够 | inspector 大面积 truncated | TECH-DESIGN（调常数） | 能 |
| seq 在 worker 重启后延续（惰性恢复时从 sidecar 尾行读取 maxSeq） | 重启后 seq 重置撞号 | TECH-DESIGN | 能（单元） |

### 10.7 安全/性能/可观测性

- **安全**（checklists/security.md）：sidecar 含工具输入输出明文——与主 JSONL 同目录同级敏感度（本就含会话内容），不新增信任边界；无 secrets 注入路径（key 不入轨迹行——recorder 只记工具面数据）；HTTP 端点继承本地 server 既有边界（无新增鉴权面）；日志红线沿用 redact()。
- **性能**（checklists/performance.md）：写入侧 append-only 单次 fsync-free append（PI SessionManager 同款先例），热路径开销 ~µs 级；读取端游标分页 + 上界 1000 条/请求防全量加载；VS1 虚拟窗口断言即渲染性能回归锚；Timeline 段数随区间过滤收敛。
- **可观测性**（checklists/observability.md）：写失败 stderr 结构化日志 `event=trajectory_write_failed session=<key> err=`（redact 后）；meta.skipped 即损坏率信号；端点 RED 由既有 server 日志承接；on-call 问题「这个会话轨迹为什么缺一段」→ 答：skipped 计数 + stderr 写失败日志两处可查。

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（coverage seams，CLI 优先）

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 1 落盘 | trajectoryRecorder 工厂（注入 fs/sessionDir/now/send）：事件序列驱动 → 断言 sidecar 逐行内容与 golden values | 单元（node --test，真实 tmp dir） | 真实 tmp dir |
| 1 落盘-E2E 佐证 | FAUX 注入缝（OPC_FAUX_TOOL_SEQUENCE）跑真回合后读 sidecar 断言 T1-T4 锚点 | 集成（Electron E2E 内 fs/API 断言） | FAUX 零网络 |
| 2 读取 API | HTTP 端点直测（构造临时 sidecar 夹具含损坏行）：分页/游标/skipped/404 | 集成（api 测试，server.test.js 先例） | 夹具文件 |
| 3 视图切换 | Playwright Electron tab 切换断言（V1） | E2E | FAUX |
| 4/5 Ledger+Inspector | 重放渲染断言（重开后 L1/I1）+ reducer 纯函数单元 | E2E + 单元 | FAUX 序列夹具 |
| 6 Timeline | 时间域映射纯函数单元（fracOf/viewFrac/brush 区间换算）+ 分段/过滤 DOM 断言（TL1/TL2） | 单元 + E2E | FAUX + 注入时钟 |
| 7 虚拟滚动 | 窗口 harness：注入 500+ 记录断言挂载节点数上界 + prepend 保键（VS1/VS2） | 单元 + E2E | 注入数组 |
| 8 实时接入 | trajectoryModel.js 纯函数 SSR 自验（事件序列→记录演化断言，reduceToolEvent 先例）+ FAUX E2E S1 | 单元 + E2E | FAUX |
| 9 跳转入口 | subExecutionId→入口映射单元断言 + 路由跳转 E2E（J1） | 单元 + E2E | 夹具记录 |

测试组织：`tests/capabilities/agent-dialogue/trajectory/2026-08-22-tool-call-review/{api,e2e}/`（能力归属 agent-dialogue，新增 trajectory 实体）。

### 11.2 测试策略与先例

- 只测外部行为：sidecar 文件内容（落盘契约）、HTTP 响应形状（分页契约）、DOM 结构/testid（视图契约）；不测内部数据结构。
- 先例：`toolCallBlock.test.cjs`（FAUX 序列驱动真实工具事件的 E2E 形态）、`historyToolFilter.test.js`（投影契约 api 测试）、Assistant.jsx 导出纯 reducer 供 SSR 自验（双源统一测试模式）。
- 性能护栏：VS1 挂载上界断言即性能回归锚（500 条记录不挂 500 个节点）。

## 12. 范围外

- 嵌套 subtool 内部展开（扩展 flow engine agent 执行器产工具级明细）——后续 story，本期只有跳转入口
- flow 执行详情页内嵌工具轨迹
- 老会话轨迹回填
- Between-turns 压缩区块与 thinking 载体的呈现（数据本期已采集）
- 轨迹导出/分享（trace.html 式自包含导出）
- 多会话轨迹横向对比视图

## 13. 补充说明

- 参考系：deepseek-harness `packages/client/ui-trajectory`（ledger/inspector/Timeline/虚拟滚动/in-flight 语义的直接对标）；pi-observability 家族（waterfall 排序、inspector 懒加载、保留策略意识）；本地 `@earendil-works/pi-telemetry`（span/attribute/status 契约思路，是否借 schema 由 tech-design 定，不强制引入依赖）。
- 关键实证记录：PI SDK 事件面（tool_execution_start{toolCallId,toolName,args} / end{result,isError} / message_end.usage{input,output,cacheRead,...} / compaction_start,end）、worker 管线已有回合起点记点与 text_end 延迟冲刷、safeKey/世代镜像实现已存在于 worker、执行创建返回 `{id, executionId, queuePosition}`、fauxProvider 产出数值 usage。
- 访谈全文见 `interview-notes.md`（十问边界 + 方向 C 确认）。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | 9 步 happy path 覆盖全部 9 个稳定块；8 条分支 |
| 输入验证 | PASS | 无表单（N/A 已声明理由）；API 查询参数规则+有效/无效例已给 |
| 错误状态 | PASS | 6 类失败模式含跨模块（磁盘写失败/SSE 断线/会话不存在） |
| 预期值锚点 | PASS | 17 条锚点覆盖 9 个稳定块，全部机器可验字面值 |
| 复杂度分级 | complex | 理由见 §9 |
| 技术方案（§10） | PASS（已深潜） | `/tech-design` 完成 2026-08-23：四问四答落定 D1-D6，ADR-038 已生成 |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-23 | 初稿（基于十问访谈 + 代码实证） | AI + 人 |
| v0.2 | 2026-08-23 | §10 tech-design 深潜完成（D1-D6 决策 + 三接口契约 golden values + 风险表）；§8 补两行错误状态；§11.1 seams 细化到模块级；ADR-038 生成 | AI + 人 |
