# 测试计划 — 2026-07-23-nested-flow

> REQ-VERSION: v1-hash:12fcb37250dd27d709796ef80459b1e5fca506df2f2ae756b1537eeb3501c8e4

## 测试总览

| REQ | Seam | 测试文件 | 类型 |
|---|---|---|---|
| FLOW-032 | engine unit | `tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/subflowNodeTypes.test.js` | 单元 |
| FLOW-033 | engine unit | same file | 单元 |
| FLOW-034 | API integration | `tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/api/callFlowValidation.test.js` | 集成(API) |
| FLOW-035 | engine unit | `tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/subflowIsolation.test.js` | 单元 |
| FLOW-036 | engine unit | same file | 单元 |
| FLOW-037 | engine unit | `tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/subflowFailure.test.js` | 单元 |
| FLOW-038 | API integration | `tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/api/circularReference.test.js` | 集成(API) |
| FLOW-039 | engine/task integration | (runner: 在 subflowLatestVersion 下；本次未单独建文件，可由 implementer 在 taskService 层补一个集成 test 或和 FLOW-040 合并) | 集成 |
| FLOW-040 | API integration | `tests/capabilities/flow-orchestration/execution/2026-07-23-nested-flow/api/nestedExecution.test.js` | 集成(API) |
| FLOW-041 | API integration | `tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/api/callflowCandidates.test.js` | 集成(API) |
| FLOW-042 | engine unit | `tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/executorSignature.test.js` | 单元 |
| FLOW-043 | E2E | `tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/e2e/subflowConfig.spec.cjs` | E2E (Playwright Electron) |
| FLOW-044 | E2E | `tests/capabilities/flow-orchestration/execution/2026-07-23-nested-flow/e2e/nestedExecutionDetail.spec.cjs` | E2E (Playwright Electron) |
| FLOW-045 | E2E | same as FLOW-043 | E2E |
| FLOW-046 | engine unit | `tests/capabilities/flow-orchestration/flow-engine/2026-07-23-nested-flow/api/foreachCallflow.test.js` | 单元 |

## 测试类型分布

- **单元 (engine 层)**：6 个文件 — FLOW-032/033/035/036/037/042/046
- **集成 (API/server 层)**：4 个文件 — FLOW-034/038/040/041
- **E2E (Playwright Electron)**：2 个文件 — FLOW-043/044/045
- **FLOW-039 注**：调最新语义的验证放在 FLOW-040 嵌套执行集成测试里（构造执行-修改子-再执行的场景），或由 implementer 在 taskService 层添加

## Mock 策略

- **单元测试**：flowEngine.run() 直接构造 flow JSON fixture；invokeSubflow 通过 options.services 传 stub（不依赖 DB/server）
- **集成测试**：使用 `startServer()`/`stopServer()` 现有 helper（内存 DB）；通过 fetch 调 API
- **E2E**：`startElectronApp()` fixture，seed helper 直接建数据

## HUMAN ASSERTION 待签核

每个测试文件中 `// TODO: HUMAN ASSERTION` 标记处需要人填预期值。主要在：

1. 错误消息文案精确匹配（validateNodeList 返回的 message 文本）
2. agent prompt 替换后的具体字符串
3. Playwright locators（节点/按钮/面板的 ARIA role/文案）—— 实现 UI 时根据实际 i18n 文案确定
4. flowOutput 从 context 收集变量的精确 key 形式

## REFLECT 人工验收项（纯审美）

本期不涉及颜色/间距/动效等纯审美判断，无 `人工(仅视觉)` 项。UX 交互（展开动画、图标样式）属实现阶段，但可在 REFLECT 验收时提出观感调整。

## 范围外验证

- 不测试异步派发/扇出（上层节点能力，本期未做）
- 不测试 try-catch 错误分支（本期失败即中止）
- 不测试版本绑定（不存在）
- 不测试跨项目调用（不存在）

## 版本

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1 | 2026-07-23 | 初版，覆盖 FLOW-032~046 全部 REQ | agent |
