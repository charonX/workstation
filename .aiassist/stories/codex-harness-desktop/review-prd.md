# PRD Review: codex-harness-desktop

> Stage: `prd`
> Reviewer: agent
> Date: 2026-07-04
> Story Phase: `BUILD` (assertion-signoff: passed)

---

## 审查结论

**建议动作：继续推进，但需在结晶下一阶段 REQ 前澄清 2–3 个移动块。**

总体质量较高，PRD 已按 Test-as-Contract 要求区分了稳定块、移动块和范围外项。当前实现（src/ 服务层 + 35 个单元测试）与 PRD 稳定块基本对齐。

| 维度 | 评级 | 说明 |
|---|---|---|
| 痛点锚定 | ✅ PASS | 问题陈述基于真实痛点，而非直接给方案。 |
| 稳定块 | ✅ PASS | 17 个稳定块清晰，可逐条结晶为 REQ-ID。 |
| 移动块 | ⚠️ WARN | 已标注，但部分移动块（节点列表、认证管理）对 MVP 阻塞风险较高。 |
| 可测试性 | ✅ PASS | §7 明确列出测试 seams 和测试类型，覆盖核心稳定块。 |
| 范围 | ✅ PASS | Out of Scope 在 §4.17 和 §8 两处明确列出。 |
| 用户故事 | ⚠️ WARN | 覆盖主路径，但边界/错误路径和故事间边界可更清晰。 |

---

## 详细审查

### 1. 痛点锚定 — ✅ PASS

- PRD §1 明确描述了当前工作流的四个痛点：纯 agent 执行慢、n8n 不灵活、桌面 agent 需人值守、skills 散落。
- 这些痛点导向了"需要人类判断的环节交给 agent，流程化步骤交给应用"的解决方案定位，符合"问题 → 方案"的叙述顺序。
- 建议：无。

### 2. 稳定块 — ✅ PASS

- §4 列出 17 个稳定块，包括技术栈、应用类型、项目模型、Skill 管理、Agent 适配、流程编辑器形态、定时触发、数据存储、Settings、项目导入 UI、Flows 列表页、Tasks 页面、Skill 管理 UI、Workspace 首页、设计系统与主题、Out of Scope。
- 每个稳定块都足够具体，已经结晶为 `requirements.md` 中的 REQ-001 ~ REQ-016。
- 建议：无。

### 3. 移动块 — ⚠️ WARN

- §5 列出 5 个移动块：具体节点列表、流程配置格式、API key / 认证管理、结果展示 UI 形态细化、国产模型替代策略。
- **风险点**：
  - **具体节点列表**：MVP 需要至少 Trigger / Agent / Data / Logic / Output 五类节点的最小集合，否则 Flow Editor 和 FlowEngine 无法验收。
  - **API key / 认证管理**：当前标注为"不需要管"，但实际接入 Claude Code / Codex 必然涉及。如果 MVP 要跑通第一个"热点新闻抓取"流程，此块需要提前落地。
- 建议：在 BUILD 阶段末期或下一 story 中，把"MVP 节点集合"和"Agent 认证配置"从移动块升级为稳定块或范围外项，避免阻塞 First Wedge 验收。

### 4. 可测试性 — ✅ PASS

- §7.1 列出 7 个测试 seams：FlowEngine、AgentAdapter、ProjectService、SkillService、ScheduleService、TaskService、SettingsService。
- §7.2 明确单元 / 集成 / E2E / 手动测试的分层。
- 当前已实现 SettingsService、ProjectService、FlowService、TaskService、SkillService、Theme 的单元测试，与 seams 对应。
- 建议：无。

### 5. 范围 — ✅ PASS

- §4.17 和 §8 均明确 Out of Scope：AI 画布、移动端应用、商业化/多租户、复杂认证、内嵌 comfyui/running hub、飞书集成。
- 范围边界清晰，有助于防止 BUILD 阶段顺手实现范围外功能。
- 建议：无。

### 6. 用户故事 — ⚠️ WARN

- 13 个用户故事覆盖了主路径：项目导入、skill 链接、流程编排、agent 节点、定时触发、日志查看、子流程调用、Settings 配置等。
- **可改进点**：
  - 故事 3（拖拽节点）和故事 4（codex/agent 节点）边界有重叠，建议在 REQ 阶段明确"编辑器框架"与"节点运行时"的边界。
  - 缺少针对错误路径的故事，例如：Git 仓库克隆失败、Agent 节点执行失败、Schedule cron 表达式无效时的处理。
- 建议：不阻塞当前 BUILD，但建议在下一个 story 或 E2E 测试规划时补充 1–2 个错误路径用户故事。

---

## 行动建议

1. **继续 BUILD**：PRD 稳定块已充分结晶，当前实现与契约对齐。
2. **提前处理移动块**：在实现 First Wedge（热点新闻抓取）前，把"MVP 节点集合"和"Agent 认证配置"纳入范围决策。
3. **补充错误路径**：在 E2E 测试计划或下一个 story 中补充 Git 克隆失败、Agent 执行失败等边界场景。
4. **回流决策**：当前无阻塞项，不建议回流；若移动块导致后续契约无法签署，再通过 `/tac-story` 回流到 DESIGN/PRD。

---

## 签字

审查人：agent  时间：2026-07-04

- [ ] 已确认所有 FAIL/WARN 项的后续处理方案
