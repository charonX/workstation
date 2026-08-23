# Requirements — 会话轨迹账本（Trajectory Ledger）

> 故事 ID：`2026-08-22-tool-call-review`
> 版本：v1
> 最后更新：2026-08-23
> 来源：`prd.md` v0.2（§4 九大稳定块、§10 技术方案、§10.4 三大接口契约）
> 移动块：PRD §5 移动块 1（Between-turns 压缩区块呈现）与移动块 2（thinking 载体呈现粒度）留待后续迭代，不入本 REQ
> UX 参照：`ux/trajectory.html`（单屏一体原型：双 tab、Timeline Overview、Ledger、Inspector、虚拟滚动、执行跳转）
> ADR：`adr/0038-session-trajectory-sidecar.md`（会话轨迹采用全量自足 sidecar JSONL）
> 测试目录：`tests/capabilities/agent-dialogue/trajectory/2026-08-22-tool-call-review/`

---

## REQ-AGENT-127 轨迹落盘（sidecar 写入链）

- 优先级 P0 / 必须 / cross-module / worker + trajectoryRecorder / agent-dialogue / trajectory / 单元
- 接口契约（PRD §10.4 接口 1）：
  - sidecar 文件格式：`<sessionDir>/<safeKey>[.N].traj.jsonl`，JSONL 格式每行一记录，自足不依赖物理行号。
  - 公共字段：`v: 1`（schema 版本）、`seq`（≥1 单调递增整数）、`ts`（ISO 8601 格式时间戳）、`type`（记录类型枚举）。
  - type 枚举与载体：
    - `turn_boundary`: `{ turn: number }`
    - `user_message`: `{ text: string }`
    - `assistant_span`: `{ textPreview?: string, ttftMs: number, decodeMs: number, usage: { input: number, output: number, cacheRead?: number, ... } }`
    - `tool_call`: `{ toolCallId: string, name: string, status: "running" | "completed" | "error" | "interrupted", input?: any, output?: any, isError?: boolean, errorCode?: string, errorMessage?: string, durationMs?: number }`
    - `compaction`: `{ reason: string, phase: "start" | "end" }`
  - 截断与时长规则：input/output 载体各自独立截断 ≤256KB（超限带 `truncated: true`）；仅真实 end/error 到达时写入 `durationMs`，`interrupted` 状态恒无 `durationMs`。
  - 隔离性：写 sidecar 文件不污染主 JSONL（主 JSONL 投影仅含 user/assistant 文本消息，保持 BUG-009 契约）。

验收标准：
1. **文件创建与格式合规（锚点 §6.3 T1）**：worker 执行会话回合后，在 `<sessionDir>/<safeKey>.traj.jsonl` 生成 sidecar 文件；每行均为合法 JSON，且按序包含合法 `v: 1`、单调递增 `seq`、ISO 8601 `ts` 及对应的 `type`（turn_boundary、user_message、tool_call 等）（单元：node --test + 临时 tmpDir）。
2. **工具调用记录完整性（锚点 §6.3 T2）**：工具执行完成写入的 `tool_call` 记录行包含非空 `toolCallId`、规范化工具名 `name`（如 `project_list`）、数值 `durationMs`（>0）、`isError: false`、`status: "completed"` 以及对应输入输出对象（单元）。
3. **Assistant 时间片与 Token 用量（锚点 §6.3 T3）**：回合完成时写入的 `assistant_span` 记录行包含数值 `ttftMs`（≥0）、`decodeMs`（≥0）以及包含数值 `input`/`output` 的 `usage` 字典对象（单元）。
4. **中断收尾与零伪造时长（锚点 §6.3 T4）**：流式过程中触发中断（如 stop）时，尚未完成的 in-flight `tool_call` 记录行最终收尾为 `status: "interrupted"`，且不写入 `durationMs`（单元）。
5. **历史投影零污染（锚点 §6.3 R1）**：生成轨迹 sidecar 后，主会话历史消息读取（`readSessionMessages`）仅包含 user 与 assistant 文本消息，不含任何 tool 记录，保持 BUG-009 纯净契约（单元）。
6. **写入异常降级（§8 错误状态）**：worker 写入 sidecar 发生磁盘异常（如 `appendFileSync` 抛错）时，stderr 输出结构化日志并丢弃该记录继续执行，不阻断对话主链路（单元）。

---

## REQ-AGENT-128 轨迹读取 API

- 优先级 P0 / 必须 / cross-module / sessionDomain + routes/agentSessions / agent-dialogue / trajectory / 集成
- 接口契约（PRD §10.4 接口 2）：
  - `GET /api/agent/sessions/:spaceKey/trajectory`
  - 查询参数：`limit`（正整数，缺省 200，上界 1000）、`before`（游标字符串，格式 `traj_<seq>`，可选）。
  - 响应体：`{ records: Array<TrajectoryRecord>, hasMore: boolean, meta: { skipped: number } }`。
  - 排序与窗口：`records` 严格按时间/seq 升序排列；无 `before` 时返回最新的尾部窗口；有 `before` 时返回严格早于该 seq 的窗口。
  - 错误与容错：未知 `spaceKey` 返回 404 `E-SESSION-NOT-FOUND`；sidecar 缺失返回 200 与空 `records: []`（E-TRAJ-EMPTY）；sidecar 某行非法 JSON 时跳过该坏行并累加 `meta.skipped`（E-TRAJ-PARTIAL）。

验收标准：
1. **游标分页基础读取（锚点 §6.3 A1）**：存在 ≥3 条轨迹记录的会话，发起 `GET /api/agent/sessions/<spaceKey>/trajectory?limit=2`，返回 200 状态码，`records.length === 2`，`hasMore === true`，且 `meta.skipped` 为数值（集成：临时 sessionDir + 构造 sidecar 夹具）。
2. **游标 before 分页窗口（锚点 §6.3 A2）**：携带 `before=traj_<seq>` 再次请求，返回严格早于该 seq 的记录窗口，且数组内记录按 seq 升序排列（集成）。
3. **查询参数校验与归一化（PRD §7 表单与输入验证）**：当 `limit` 为 0、负数或非法字符串时，静默归一化为默认值 200；超出 1000 时截断为 1000；非法 `before` 游标作为无游标处理，不返回 400（集成）。
4. **缺失文件空态与损坏行容错（§6.2 异常与 §8 错误状态）**：sidecar 文件不存在时返回 200 `{ records: [], hasMore: false, meta: { skipped: 0 } }`；sidecar 中包含非法 JSON 行时跳过坏行返回其余合法记录，并在 `meta.skipped` 中如实统计跳过行数（集成）。
5. **未知会话 404（PRD §8 错误状态）**：请求未知 `spaceKey` 时返回 404 状态码及标准错误响应体（集成）。

---

## REQ-AGENT-129 视图切换入口与全会话通用支持

- 优先级 P0 / 必须 / intra-module / TrajectoryView + Assistant / agent-dialogue / trajectory / 组件 + E2E
- 交互契约：对话窗顶部展示「对话」与「轨迹」双 Tab（`[data-testid="view-tabs"]`）；点击 Tab 实现视图平滑切换；所有类型会话（通用/项目/飞书/孤儿）均支持打开轨迹视图。
- UX 参照：`ux/trajectory.html`（`[data-testid="view-tabs"]`、`[data-testid="trajectory-tab"]`、`[data-testid="trajectory-view"]`、`[data-testid="traj-empty-state"]`）。

验收标准：
1. **Tab 切换与视图显隐（锚点 §6.3 V1）**：点击「轨迹」Tab 时，`[data-testid="trajectory-view"]` 呈现可见状态，`[data-testid="message-list"]` 隐藏；点击「对话」Tab 时反向切换（E2E / 组件）。
2. **无轨迹记录空态展示（PRD §6.2 异常 E-TRAJ-EMPTY）**：打开无 sidecar 记录的会话（如功能启用前的老会话）并切换到轨迹 Tab，展示空态卡片 `[data-testid="traj-empty-state"]`，提示「该会话没有轨迹记录（功能启用前的会话不追溯）」，对话 Tab 保持不受影响（E2E / 组件）。
3. **全会话类型可访问性（PRD §4 稳定块 3）**：飞书归档会话及已删除项目的孤儿会话均可正常切换并查看轨迹视图，保持只读浏览语义（E2E / 组件）。

---

## REQ-AGENT-130 Ledger 账本行渲染与状态呈现

- 优先级 P0 / 必须 / intra-module / Ledger + trajectoryModel / agent-dialogue / trajectory / 单元 + E2E
- 交互与渲染契约：
  - 行类型覆盖：`turn_boundary`（粗线分隔并标注回合序号）、`user_message`（用户输入摘要）、`assistant_span`（模型回复与时间摘要）、`tool_call`（工具调用状态与摘要）。
  - 收起态展示：显示行序号（index）、事件名、输入输出摘要或时长。
  - In-flight 状态：running 状态工具行显示进行中指示，不伪造渲染时长文本；完成或中断后展示真实终态。
- UX 参照：`ux/trajectory.html`（`[data-testid="trajectory-ledger"]`、`.ledger-row`、`.turn-boundary`、`.status-running`、`.status-interrupted`）。

验收标准：
1. **重放记录行渲染与回合边界（锚点 §6.3 L1）**：历史会话重开进入轨迹视图，账本完整渲染 sidecar 中的所有记录行与回合边界标记，行排列顺序与 sidecar 记录顺序严格一致（E2E / 组件）。
2. **In-flight 状态与真实耗时渲染（锚点 §6.3 L2）**：实时流式中 running 状态的工具行渲染起始标记且无耗时文本；工具完成后更新为 completed 状态并呈现实际 `durationMs`（E2E / 组件）。
3. **中断状态行弱化呈现（PRD §6.2 异常）**：interrupted 状态的工具行呈现中断标记与弱化样式，且不渲染时长（E2E / 组件）。

---

## REQ-AGENT-131 Inspector 详情检查器与截断标注

- 优先级 P0 / 必须 / intra-module / Inspector / agent-dialogue / trajectory / 单元 + E2E
- 交互与渲染契约：
  - 选中状态：点击账本中记录行，该行高亮且在右侧/内联展开 Inspector 面板（`[data-testid="inspector-panel"]`）；再次点击同一行收起面板。
  - 详情分节：Inspector 包含工具名、状态、输入（Input）、输出（Output）、耗时（Timing，起止时间及 durationMs）、Token 用量（Usage）等分节。
  - 截断提示：当记录标记 `truncated: true` 时，展示截断标注徽章。
- UX 参照：`ux/trajectory.html`（`[data-testid="inspector-panel"]`、`[data-testid="truncated-badge"]`）。

验收标准：
1. **行选中展开与详情内容（锚点 §6.3 I1）**：点击 tool_call 记录行，Inspector 面板可见，面板内准确展示工具名、输入参数、输出内容、耗时（Timing）与 Token 用量（Usage）各节，再次点击该行面板收起（E2E / 组件）。
2. **超限截断标注呈现（PRD §6.2 异常）**：对于输入或输出经过 256KB 截断的记录（`truncated: true`），Inspector 在对应内容区域渲染截断提示徽章（`[data-testid="truncated-badge"]`）（E2E / 组件）。

---

## REQ-AGENT-132 Timeline Overview 时间线总览与缩放过滤

- 优先级 P0 / 必须 / intra-module / TimelineOverview + trajectoryModel / agent-dialogue / trajectory / 单元 + E2E
- 交互与渲染契约：
  - 时间线投影：账本上方固定条带区域（`[data-testid="timeline-overview"]`），各记录按绝对起止时间及持续时长左右比例投影。
  - Assistant 双段拆分：assistant 片段拆分为首字延迟段 `[data-timeline-segment="ttft"]` 与解码时长段 `[data-timeline-segment="decode"]`。
  - 交互过滤：支持滚轮缩放时间域、拖拽选区（Brush）过滤账本显示范围；右键单击清除选区恢复全量。
  - 空态自适应：无带时长记录时隐藏条带。
- UX 参照：`ux/trajectory.html`（`[data-testid="timeline-overview"]`、`[data-timeline-segment="ttft"]`、`[data-timeline-segment="decode"]`、`.filter-banner`）。

验收标准：
1. **时间线分段渲染与 TTFT 拆分（锚点 §6.3 TL1）**：Timeline 条带中各记录按真实起止时间投影，assistant 片段渲染为 `[data-timeline-segment="ttft"]` 与 `[data-timeline-segment="decode"]` 两段（E2E / 组件）。
2. **滚轮缩放与选区过滤（锚点 §6.3 TL2）**：在 Timeline 上拖选特定时间区间后，Ledger 账本仅展示落在该区间内的记录；右键单击清除选择后账本恢复全量显示（E2E / 单元：时间域映射纯函数计算 + E2E DOM 过滤断言）。
3. **无时长记录优雅自适应（PRD §6.2 异常）**：当会话无任何带时长记录时，Timeline 区域自动隐藏，不残留空条带（E2E / 组件）。

---

## REQ-AGENT-133 虚拟滚动与跟随状态控制

- 优先级 P0 / 必须 / intra-module / Ledger / agent-dialogue / trajectory / 单元 + E2E
- 交互与性能契约：
  - 虚拟窗口渲染：仅挂载可见窗口及其 overscan 区域内的 DOM 节点。
  - 滚动位置与跟随：打开时默认定位于尾部；向上滚动时暂停跟随（新记录追加不强制跳底）；滚回底部恢复自动跟随。
- 参照：PRD §10.5 D5 自实现虚拟窗口。

验收标准：
1. **挂载节点数量上界（锚点 §6.3 VS1）**：在注入 ≥500 条轨迹记录的长会话中打开轨迹视图，DOM 树中实际挂载的记录行节点数量受限于可见窗+overscan 上界（≤50 个节点）（E2E / 组件 harness 断言）。
2. **尾部初始定位与上滑暂停跟随（锚点 §6.3 VS2）**：轨迹视图加载后初始滚动条位于底部；用户向上滚动后触发暂停跟随状态，此时追加新记录不改变当前滚动位置；滚动到底部后恢复自动跟随（E2E / 组件）。

---

## REQ-AGENT-134 实时流式接入与单一记录模型

- 优先级 P0 / 必须 / cross-module / worker + agentService + trajectoryModel / agent-dialogue / trajectory / 单元 + 集成 + E2E
- 接口与架构契约（PRD §10.4 接口 3、§10.5 D4）：
  - IPC/SSE `trajectory-record`：worker 在第一现场组装行对象，经 IPC 发送 `{ type: "trajectory-record", sessionKey, event }`，主进程转发为 SSE 事件 `data: {"type":"trajectory-record", "record": <行对象>}`。
  - 单一记录模型：live 流式事件与重放读取共用 `trajectoryModel.js` 纯函数 reducer，按 `seq` 幂等合并（已有 seq 原位更新，内容帧更新保持同一 React key）。
- UX 参照：`ux/trajectory.html`。

验收标准：
1. **实时事件推送与账本增量更新（锚点 §6.3 S1）**：在对话中触发工具调用时，前端通过 SSE 实时接收 `trajectory-record` 事件并即时渲染到账本尾部（E2E / 集成）。
2. **纯函数 Reducer 状态演化与幂等性（PRD §10.2 / §11.1）**：`trajectoryModel.js` 纯函数 reducer 接收乱序、重复或状态更新（running → completed）的事件序列时，能够按 `seq` 幂等收敛为正确的有序记录状态，且保证行 key 稳定性（单元：node --test 纯函数断言）。

---

## REQ-AGENT-135 子执行跳转入口

- 优先级 P0 / 必须 / intra-module / Ledger + Inspector / agent-dialogue / trajectory / 组件 + E2E
- 交互契约：对于 `name="task run"` 且 `output.executionId` 存在的工具调用记录，渲染跳转入口（`[data-testid="subexec-link"]`）；点击后路由导航至 `/executions/:id` 详情页。
- UX 参照：`ux/trajectory.html`（`[data-testid="subexec-link"]`）。

验收标准：
1. **子执行入口渲染（锚点 §6.3 J1）**：当工具记录为 `name="task run"` 且包含有效 `output.executionId`（如 `"ex_2041"`）时，Inspector 或 Ledger 行内展示跳转链接 `[data-testid="subexec-link"]`（E2E / 组件）。
2. **路由跳转导航（PRD §6.1 步骤 9）**：点击该跳转链接触发应用路由切换，导航到对应子流程执行详情页面（E2E / 组件）。
