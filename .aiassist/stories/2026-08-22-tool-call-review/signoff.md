# 签核记录 — 2026-08-22-tool-call-review

## Assertion（门 1，2026-08-23）

### 检查清单

- [x] PRD §14 自检查表全 PASS，无 GAP 悬空；PRD §5 移动块 1（压缩区块呈现）与移动块 2（thinking 呈现粒度）已明确留待后续迭代
- [x] 每个 REQ-ID 都有对应自动化测试（REQ-AGENT-127 ~ REQ-AGENT-135 均有单元/集成/E2E 覆盖）
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`（`v1-hash:cd8088309c498ee02824a8f9ff74c5d454bcfe3496be20777990ce134a267fa6`）、`CAPABILITY-TRACE`、`ENTITY-TRACE`、`EXPECTED-TRACE`、`TEST-AUTHOR`、`ASSERTIONS-SIGNED: true`
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致（`agent-dialogue` / `trajectory`）
- [x] 无 `// TODO: HUMAN ASSERTION` 占位，所有断言均已机械推导并锚定
- [x] 预期值来源清晰：每条 expected 值 trace 到 `prd.md` §6.3/§7/§8/§10.4 锚点
- [x] 禁用快照作为判定依据，全部为字段级/字面值/DOM 结构断言
- [x] 边界/错误 case 已覆盖（空态、坏 JSON 行跳过、256KB 截断标注、中断收尾无时长、未知会话 404、写磁盘异常降级）

### expected 值交叉验证（EXPECTED-TRACE ↔ prd.md 锚点）

| 断言组 | 锚点来源 | 值一致 |
|---|---|---|
| REQ-AGENT-127 AC1: 文件创建与格式合规（`<safeKey>.traj.jsonl`，每行合规 JSON，含 `v:1`、递增 `seq`、ISO `ts`、type 枚举） | `prd.md §6.3 T1` | ✅ |
| REQ-AGENT-127 AC2: 工具调用完整性（`toolCallId`、`name: "project_list"`、`durationMs: 42300 > 0`、`isError: false`、`status: "completed"`） | `prd.md §6.3 T2` | ✅ |
| REQ-AGENT-127 AC3: Assistant 时间片与 Token 用量（`ttftMs: 830`、`decodeMs: 2140`、`usage: {input: 1842, output: 156, cacheRead: 512}`） | `prd.md §6.3 T3` | ✅ |
| REQ-AGENT-127 AC4: 中断收尾与零伪造时长（in-flight 状态置 `interrupted`，不写 `durationMs`） | `prd.md §6.3 T4` | ✅ |
| REQ-AGENT-127 AC5: 载体截断保护（超 256KB 标注 `truncated: true`，整行大小受控） | `prd.md §10.4 接口 1` | ✅ |
| REQ-AGENT-127 AC6: 写入异常优雅降级（磁盘写异常时不阻断主链路） | `prd.md §8 错误状态` | ✅ |
| REQ-AGENT-128 AC1: 游标分页基础读取（GET `/trajectory?limit=2` 返回 200，`records.length===2`，`hasMore===true`，`meta.skipped` 数值） | `prd.md §6.3 A1` | ✅ |
| REQ-AGENT-128 AC2: 游标 before 分页窗口（`before=traj_4&limit=2` 返回严格早于 seq 4 的窗口） | `prd.md §6.3 A2` | ✅ |
| REQ-AGENT-128 AC3: 查询参数归一（非法 limit 归一化为 200，超 1000 截断，非法 before 忽略） | `prd.md §7 输入验证` | ✅ |
| REQ-AGENT-128 AC4: 缺失文件空态与损坏行容错（文件缺失返回 200 空数组，坏行跳过并在 `meta.skipped` 统计） | `prd.md §6.2 异常 E-TRAJ-EMPTY, §8` | ✅ |
| REQ-AGENT-128 AC5: 未知会话 404（未知 spaceKey 返回 404 及标准错误响应体） | `prd.md §8 错误状态` | ✅ |
| REQ-AGENT-129 AC1: Tab 切换与视图显隐（点击「轨迹」Tab，`[data-testid="trajectory-view"]` 可见，对话列表隐藏） | `prd.md §6.3 V1` | ✅ |
| REQ-AGENT-129 AC2: 无轨迹空态展示（`[data-testid="traj-empty-state"]` 可见，文案提示没有轨迹记录） | `prd.md §6.2 异常 E-TRAJ-EMPTY` | ✅ |
| REQ-AGENT-130 AC1: Ledger 账本重放（按 sidecar 顺序渲染记录行与粗线回合边界） | `prd.md §6.3 L1` | ✅ |
| REQ-AGENT-130 AC2: In-flight 状态渲染（running 态只显起始标记不伪造时长） | `prd.md §6.3 L2` | ✅ |
| REQ-AGENT-131 AC1: Inspector 行选中展开（点击 tool 行高亮并在本地展开 Inspector 面板展示各节，再点收起） | `prd.md §6.3 I1` | ✅ |
| REQ-AGENT-131 AC2: 截断标注呈现（`truncated: true` 记录展示截断提示徽章） | `prd.md §6.2 异常` | ✅ |
| REQ-AGENT-132 AC1: Timeline 分段投影与 TTFT 拆分（`[data-timeline-segment="ttft"]` 与 `[data-timeline-segment="decode"]`） | `prd.md §6.3 TL1` | ✅ |
| REQ-AGENT-132 AC2: 时间域缩放与选区过滤（拖选区间仅保留区间内账本行，右键清除全量恢复） | `prd.md §6.3 TL2` | ✅ |
| REQ-AGENT-133 AC1: 虚拟滚动挂载节点上界约束（500 条记录长列表挂载节点数 ≤ 50） | `prd.md §6.3 VS1` | ✅ |
| REQ-AGENT-133 AC2: 初始尾部定位与上滑暂停跟随（向上滚动后暂停跟随，新记录不强制跳底） | `prd.md §6.3 VS2` | ✅ |
| REQ-AGENT-134 AC1: 实时流式事件推送与账本增量更新（SSE 推送 `trajectory-record` 即时渲染） | `prd.md §6.3 S1` | ✅ |
| REQ-AGENT-134 AC2: 纯函数 Reducer 状态演化与幂等性（同一 seq 原位更新，React key 保持稳定） | `prd.md §10.2 / §10.5 D4` | ✅ |
| REQ-AGENT-135 AC1: 子执行跳转入口（`name="task run"` 且含 `output.executionId="ex_2041"` 渲染跳转链接） | `prd.md §6.3 J1` | ✅ |
| REQ-AGENT-135 AC2: 路由跳转导航（点击跳转链接导航至 `/executions/ex_2041`） | `prd.md §6.1 步骤 9` | ✅ |

### 升级点结果

| 升级点 | 内容 | 处置 |
|---|---|---|
| 初衷漂移 | intention（工具调用重开后可回看，ui-trajectory 式账本）↔ PRD §1 ↔ REQ-AGENT-127~135 一致 | 无漂移 |
| 跨模块契约歧义 | sidecar JSONL 行格式、GET `/trajectory` HTTP 契约、IPC/SSE `trajectory-record` 在 §10.4 均有明确 golden values | 无歧义 |
| expected 值推导 | 所有断言 expected 值均从 PRD 锚点（§6.3/§7/§8/§10.4）机械推导 | 无未解决 TODO |
| 安全边界 | sidecar 文件位于 `agent-sessions/`，与主 JSONL 同目录同权限，不新增信任边界；API 沿用本地 HTTP 白名单与 redact() | 安全边界已确认 |
| 范围决策 | 嵌套内部展开、thinking 细粒度、Between-turns 压缩呈现明确归入后续 story 或移动块 | 范围明确无悬空 |

### 覆盖摘要

| REQ-ID | 测试文件 | capability/entity |
|---|---|---|
| REQ-AGENT-127 | `api/trajectoryRecorder.test.js` | agent-dialogue/trajectory |
| REQ-AGENT-128 | `api/trajectoryApi.test.js` | agent-dialogue/trajectory |
| REQ-AGENT-129 | `e2e/trajectoryView.test.cjs` | agent-dialogue/trajectory |
| REQ-AGENT-130 | `e2e/trajectoryView.test.cjs` | agent-dialogue/trajectory |
| REQ-AGENT-131 | `e2e/trajectoryView.test.cjs` | agent-dialogue/trajectory |
| REQ-AGENT-132 | `api/trajectoryModel.test.js`, `e2e/trajectoryView.test.cjs` | agent-dialogue/trajectory |
| REQ-AGENT-133 | `e2e/trajectoryView.test.cjs` | agent-dialogue/trajectory |
| REQ-AGENT-134 | `api/trajectoryModel.test.js` | agent-dialogue/trajectory |
| REQ-AGENT-135 | `e2e/trajectoryView.test.cjs` | agent-dialogue/trajectory |

### 签核状态

- 签署者：**AI**（无升级点遗留）
- 阶段：`phase: BUILD`（契约锁定，解锁实现）
