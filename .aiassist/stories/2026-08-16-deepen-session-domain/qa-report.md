# QA 报告 — 2026-08-16-deepen-session-domain

> QA 门执行：2026-08-18。BUILD 三切片 + BUG-001/002 修复后，全量回归已 964/964 绿；
> 本次为慢外门终检（全量单测 + E2E 回归面）。

## 单元测试

- **结果：PASS**（本 story 0 回归）
- 全量 `npm run test:unit`：**971 tests / 965 pass / 6 fail**
- 6 fail **全部**来自新 story `2026-08-18-skill-update-diagnostics` 的 seam 门
  （skillUpdateDiagnostics.test.js REQ-SKILL-020/021，BUILD 未开始，预期 RED）——
  **与本 story 无关**。本 story 39 断言（35 直测 + 4 bug 回归）+ 既有回归面全绿。
- 停机条件：BUILD 前 34 fail → 现仅余新 story 6 RED（非本 story 范围）。

## E2E（Playwright + Electron，conversation-space 回归面）

- **结果：PASS**（74/75；1 flaky 经单测复跑通过）
- 命令：`npx playwright test tests/capabilities/agent-dialogue/conversation-space`
- 覆盖：assistantNav/assistantChat/assistantSessions/assistantConfirm/assistantFeishu/
  richRender/streamingRender/toolCallBlock/modeToolbar/modelSelector/imageAttachmentUi/
  assistantStop/userBubbleLink/permissionConfig 等 17 文件 75 测试。
- 本 story 关键回归面（REQ-112 AC4 assistantConfirm E2E / REQ-115 AC5-AC6 流式 /
  REQ-117 AC4 全量）**全绿**。

### flaky 测试

| 测试名 | 现象 | 判定 |
|---|---|---|
| 2026-08-12-pi-mcp-plugin/e2e/assistantStop.test.cjs:74 REQ-AGENT-091 停止流程 | 首跑 5s 等 stop-button 超时；**单测复跑 6.3s 通过** | **FLAKY（非回归）**——同套 assistantChat 流式（走本 story 重构 SSE 路径）稳定过，且该测试属 pi-mcp-plugin story 非本 story 回归面。疑似已知时序竞态（停止窗口窄化，/code-review 亦标记过同源问题），记不稳定单 |

## 运行时浏览器验证

- **状态：SKIPPED**——本 story 无 `ux/`（纯内部架构重构），无浏览器运行时证据需求。

## Coverage

- 本地 `npm run test:unit` 无 coverage 阈值门；本 story 关键路径（sessionDomain 全导出/
  sessionSseRegistry 三方法/server.js 改向/路由瘦身）均有直测或既有回归覆盖。
- 未单独收集行覆盖率；如需 CI coverage 门，见 `.github/workflows/contract-gate.yml`
  既有注释（--experimental-test-coverage 已修正）。

## 手动验证

- 桌面 app 未人工走查（改动为字节级行为保持，无新 UI）；观感面无（本 story 无 UX 增量）。

## 结论

- [x] **可进入 `/reflect`**——本 story 无 open bugs、单测 0 回归、E2E 回归面全绿
  （1 flaky 已标记，不阻塞）。
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [ ] 有失败，建议调用 `/bug`

## 遗留（REFLECT 前备查）

1. **1490292 hook 卷入**：pre-commit hook 把兄弟 story（turn-event-pipeline）signoff.md
   并行改动 13 行卷入 Slice 1 commit——未重写历史，待人裁决。
2. flaky `assistantStop` 时序竞态（pi-mcp-plugin story，非本 story）——如反复出现，
   建议在彼 story 开 `/bug`。
3. 新 story `2026-08-18-skill-update-diagnostics` 在 BUILD 门（6 RED seam 测试），
   待 `/implementer`。
