# Test Plan — 会话轨迹账本（Trajectory Ledger）

> 故事 ID：`2026-08-22-tool-call-review`
> 版本：v1
> 日期：2026-08-23
> 来源：`requirements.md` v1（哈希：`cd8088309c498ee02824a8f9ff74c5d454bcfe3496be20777990ce134a267fa6`）
> 业务能力：`agent-dialogue`
> 实体：`trajectory`

---

## 1. 测试矩阵

| REQ-ID | 业务能力 / 实体 | 测试类型 / Seam | 测试文件 | 预期断言 / 验证方法 | 锚点依据 |
|---|---|---|---|---|---|
| **REQ-AGENT-127** (落盘) | agent-dialogue / trajectory | 单元 (Node.js tmpDir) | `api/trajectoryRecorder.test.js` | 验证 worker 在第一现场生成 `<safeKey>.traj.jsonl`，按序写入 `turn_boundary`、`user_message`、`tool_call`（状态/耗时/入参出参）、`assistant_span`（TTFT/decode/usage）；验证中断时 in-flight 状态置为 `interrupted` 且无耗时；验证超 256KB 截断标注；验证写入异常不阻断对话 | prd.md §6.3 T1, T2, T3, T4, R1, §8, §10.4 接口 1 |
| **REQ-AGENT-128** (读取 API) | agent-dialogue / trajectory | 集成 (HTTP API) | `api/trajectoryApi.test.js` | 验证 `GET /api/agent/sessions/:spaceKey/trajectory` 端点：支持 limit/before 游标分页；升序返回；缺失 sidecar 时 200 空态；含坏 JSON 行时跳过并在 `meta.skipped` 统计；未知会话 404 | prd.md §6.3 A1, A2, §7, §8, §10.4 接口 2 |
| **REQ-AGENT-129** (视图切换) | agent-dialogue / trajectory | E2E (Electron) | `e2e/trajectoryView.test.cjs` | 验证顶部「对话 / 轨迹」双 Tab 切换显隐；验证无轨迹数据时的空态卡片 `[data-testid="traj-empty-state"]`；验证飞书归档与孤儿会话支持只读回看 | prd.md §6.3 V1, §6.2 E-TRAJ-EMPTY, `ux/trajectory.html` |
| **REQ-AGENT-130** (Ledger 渲染) | agent-dialogue / trajectory | E2E (Electron) | `e2e/trajectoryView.test.cjs` | 验证重放账本完整渲染各记录行与粗线回合边界；验证 live 期间 in-flight 状态只显起始标记不伪造耗时；验证中断行弱化样式 | prd.md §6.3 L1, L2, `ux/trajectory.html` |
| **REQ-AGENT-131** (Inspector) | agent-dialogue / trajectory | E2E (Electron) | `e2e/trajectoryView.test.cjs` | 验证点击 tool 行高亮并在本地展开 Inspector 面板；验证输入/输出/耗时/Token 各节展示；再次点击收起；验证超限截断徽章 | prd.md §6.3 I1, §6.2 异常, `ux/trajectory.html` |
| **REQ-AGENT-132** (Timeline) | agent-dialogue / trajectory | 单元 + E2E | `api/trajectoryModel.test.js`, `e2e/trajectoryView.test.cjs` | 单元验证时间域映射与 Brush 选区纯函数换算；E2E 验证 assistant 片段拆分为 `[data-timeline-segment="ttft"]` 与 `[data-timeline-segment="decode"]` 两段；验证选区过滤账本行及右键清除；验证无时长记录时条带自适应隐藏 | prd.md §6.3 TL1, TL2, `ux/trajectory.html` |
| **REQ-AGENT-133** (虚拟滚动) | agent-dialogue / trajectory | E2E / Harness | `e2e/trajectoryView.test.cjs` | 验证长列表（500+ 记录）下 DOM 实际挂载节点数受限于可见窗+overscan 上界（≤50）；验证初始尾部定位与向上滑动时暂停跟随 | prd.md §6.3 VS1, VS2, §10.5 D5 |
| **REQ-AGENT-134** (实时与单模型) | agent-dialogue / trajectory | 单元 + 集成 | `api/trajectoryModel.test.js` | 验证 `trajectoryModel.js` 纯函数 Reducer 状态演化与幂等性：按 seq 排序、running→completed 原位更新且 React key 保持不变、prepend 历史页保序合并 | prd.md §6.3 S1, §10.4 接口 3, §10.5 D4 |
| **REQ-AGENT-135** (执行跳转) | agent-dialogue / trajectory | E2E (Electron) | `e2e/trajectoryView.test.cjs` | 验证 `name="task run"` 且含 `output.executionId` 的工具记录渲染 `[data-testid="subexec-link"]`；点击导航至 `/executions/:id` 详情页 | prd.md §6.3 J1, §6.1 步骤 9, `ux/trajectory.html` |

---

## 2. HTML 原型映射（ux/trajectory.html）

以下前端行为与结构直接从 `ux/trajectory.html` 提取并映射到自动化测试：
- `[data-testid="view-tabs"]` / `[data-testid="trajectory-tab"]` / `[data-testid="trajectory-view"]` → Tab 切换显隐测试（REQ-AGENT-129 / V1）
- `[data-testid="traj-empty-state"]` → 空态卡片展示测试（REQ-AGENT-129 / E-TRAJ-EMPTY）
- `[data-testid="trajectory-ledger"]` → 账本行与回合边界渲染（REQ-AGENT-130 / L1, L2）
- `[data-testid="inspector-panel"]` → 行详情抽屉与 Input/Output/Timing 节展示（REQ-AGENT-131 / I1）
- `[data-testid="timeline-overview"]` / `[data-timeline-segment="ttft"]` / `[data-timeline-segment="decode"]` → 时间线分段与选区过滤（REQ-AGENT-132 / TL1, TL2）
- `[data-testid="subexec-link"]` → 子执行跳转入口与路由切换（REQ-AGENT-135 / J1）

---

## 3. REFLECT 阶段人工验收范围（纯主观审美判断）

以下项目无法/不适合由自动化机器断言，留待 `REFLECT` 阶段由人类进行感官验收：
- 颜色对比度与深色主题下的视觉层次观感（如 Timeline 各类色块饱和度）。
- Inspector 展开收起的过渡动效流畅度与微小抖动感知。
- 密字体与紧凑间距在不同屏幕分辨率下的阅读舒适度。
