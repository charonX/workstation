# Technical Design Review: codex-harness-desktop

> Stage: `tech`
> Reviewer: agent
> Date: 2026-07-04
> Story Phase: `BUILD`

---

## 审查结论

**建议动作：修复 2 个 WARN 项后继续推进；无阻塞 FAIL 项，不建议回流。**

技术方案整体清晰，模块边界、接口契约、测试 seams 都已明确。主要问题是：全局标准文档未同步 Electron 切换、FlowEngine 对循环图的处理未说明、事件总线与回调的调用路径存在轻微不一致。

| 维度 | 评级 | 说明 |
|---|---|---|
| 对齐 PRD | ✅ PASS | 覆盖 PRD 所有稳定块，技术栈已从 Tauri 同步为 Electron。 |
| 模块边界 | ✅ PASS | 各模块职责单一，TaskService/FlowEngine/ScheduleService 边界清晰。 |
| 接口契约 | ⚠️ WARN | 契约四要素基本齐全，但事件总线表与数据流图对 LogService 的消费路径描述不一致。 |
| 测试 seams | ✅ PASS | 每个稳定块都有明确 seam 和测试方式。 |
| 复杂度 | ✅ PASS | 方案与 MVP 范围匹配，无过度设计。 |
| 风险 | ⚠️ WARN | 风险表完整，但 FlowEngine 拓扑排序未说明循环图处理；agent 错误统一重试可能浪费调用。 |
| 标准 | ⚠️ WARN | `.aiassist/global/STANDARDS.md` 仍提到"Tauri command 层"，与 Electron 决策不一致。 |

---

## 详细审查

### 1. 对齐 PRD — ✅ PASS

- `tech-design.md` §1 技术栈与 PRD §4.1 一致（Electron + React + TypeScript + TailwindCSS + React Flow）。
- §2 模块边界覆盖 PRD 所有服务模块（Project/Skill/Flow/Schedule/Task/Log/Settings）。
- §6 SQLite Schema 覆盖 PRD 数据模型（§6.3）。
- §7 测试 seams 覆盖 PRD §7.1 的所有测试 seams。
- 建议：无。

### 2. 模块边界 — ✅ PASS

- **TaskService 作为 Execution 唯一入口**：避免 ScheduleService 和手动触发两条路径重复维护历史逻辑。
- **FlowEngine 纯函数**：不读 SQLite、不写日志、不感知 UI，测试性极佳。
- **AgentAdapter 对 FlowEngine 透明**：通过 `agentExecutor` 注入，符合"缺陷下沉"原则。
- **ScheduleService 只发事件**：职责单一，不越界执行流程。
- 建议：无。

### 3. 接口契约 — ⚠️ WARN

**问题：LogService 的消费路径在两张图里不一致。**

- §3.1 数据流图中，`onEvent` 回调直接做两件事：`LogService.write(event)` 和 `IPC to renderer`。
- §5 事件总线表中，`LogService` 是 `execution:*` 事件的订阅者。

这两个描述只能二选一，否则会引入混淆：LogService 到底是被回调直接调用，还是订阅事件总线？

**影响**：实现时容易出现双重日志写入，或事件总线与回调两套机制并存。

**建议**：明确统一路径。推荐方案：
- `FlowEngine` 只通过 `onEvent` 回调输出事件；
- `TaskService` 在回调里统一 `EventBus.publish(event)`；
- `LogService` 和 UI 都作为 `EventBus` 订阅者消费事件。

这样 FlowEngine 不感知 LogService，事件总线成为唯一观测面。

### 4. 测试 seams — ✅ PASS

- 每个核心模块都有独立 seam（SettingsService、ProjectService、SkillService、FlowEngine、AgentAdapter、ScheduleService、TaskService、theme）。
- Electron IPC 也预留了集成测试 seam（playwright-electron / 自定义 harness）。
- 建议：无。

### 5. 复杂度 — ✅ PASS

- 事件总线 + 纯函数 FlowEngine + 注入 executors 是合理设计，没有过度工程化。
- SQLite Schema 简洁，符合 MVP 需求。
- 建议：无。

### 6. 风险 — ⚠️ WARN

**问题 A：FlowEngine 未说明循环图处理。**

- §2/§3 提到"按拓扑顺序执行节点"，但流程图理论上可能出现环（用户误连、条件分支回环）。
- 如果 edges 构成有向环，拓扑排序会失败或无限循环。
- **建议**：在 `FlowEngine.run` 契约中明确：
  - MVP 阶段是否限制为 DAG？
  - 如果出现环，是抛错、忽略环、还是限制执行深度？
  - 可以在 §4.1 或 §8 风险表中补充说明。

**问题 B：agent 错误统一重试一次可能浪费调用。**

- §4.2 规定 `status === "error"` 重试一次。
- 但 Agent 调用成本较高（API 费用 + 时间），某些错误明显不可重试，例如：
  - API key 无效
  - 模型不存在
  - 用户配额耗尽
- **建议**：在 `AgentAdapter` 返回的 status 中区分 `retryable` / `fatal`（或让 `agentExecutor` 做一层翻译），`fatal` 直接失败不重试。

### 7. 标准 — ⚠️ WARN

**问题：`.aiassist/global/STANDARDS.md` 未同步技术栈变更。**

- §3 编码规范第 3 行仍写："Tauri command 层写集成测试"。
- 但 PRD 和 architecture.md 已确认技术栈改为 Electron。
- **影响**：后续开发者可能按旧标准写 Rust/Tauri 集成测试，造成误解。
- **建议**：将 "Tauri command 层" 改为 "Electron main process" 或 "Electron IPC 层"。

---

## 行动建议

1. **修复 WARN-接口契约**：统一事件输出路径，让 `FlowEngine` → `onEvent` callback → `EventBus` → `LogService` / UI。
2. **修复 WARN-风险 A**：在 `tech-design.md` 中补充 FlowEngine 对循环图的处理策略（如 MVP 限制为 DAG，出现环时抛错）。
3. **修复 WARN-风险 B**：在 `AgentAdapter` / `agentExecutor` 层区分可重试与不可重试错误，避免无意义重试。
4. **修复 WARN-标准**：更新 `.aiassist/global/STANDARDS.md`，将 Tauri 引用改为 Electron。

以上均为小修，不需要回流。修复后可继续 BUILD。

---

## 签字

审查人：agent  时间：2026-07-04

- [ ] 已确认所有 WARN 项的后续处理方案
