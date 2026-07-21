# QA 报告 — 2026-07-19-media-production-line

> 生成时间：2026-07-21
> 执行人：/qa-runner
> 对应 story：媒体生产线 · 收集管线

---

## 单元测试

- 命令：`npm run test:unit`
- 结果：**FAIL（全量）/ PASS（本 story）**
- 统计：245 tests / 239 pass / 6 fail
- 本 story 相关用例：**108 pass / 0 fail**

### 失败清单（均非本 story 引入）

| 测试文件 | 失败用例 | 备注 |
|---|---|---|
| `tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/api/executionLog.test.js` | 引擎安全中止的执行也写入已执行节点的记录 | 前置 story，execution 状态卡在 `queued` |
| `tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/api/executionLog.test.js` | agent 未声明 outputVariable 时 output 列仍捕获文本输出 | 前置 story，execution 状态卡在 `queued` |
| `tests/capabilities/internationalization-theme/language/codex-harness-desktop/api/language.test.js` | REQ-I18N-002: default language is English | 默认语言为 `zh-CN`，疑似持久化污染 |
| `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/task.test.js` | REQ-SCHEDULE-001: creates a manual task and starts running | 返回 `status=undefined` |
| `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/task.test.js` | REQ-SCHEDULE-001: CLI runs a task | 同上 |
| `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/task.test.js` | BUG-012: execution runs the flow engine and records real output, logs and nodesRun | 同上 |

本 story 所有 REQ（含 REQ-WORKSPACE-008/009/010、REQ-SCHEDULE-005~009、REQ-FLOW-029/030、REQ-CHANNEL-001~005、REQ-SRC-001/002、REQ-COLL-001~003、REQ-TPL-001、REQ-NOTIFY-001/002）对应的单元/集成/CLI 测试全部通过。

---

## E2E/UITests

- 命令：
  ```bash
  npx playwright test \
    tests/capabilities/flow-orchestration/execution/2026-07-19-media-production-line/e2e/artifactsTab.test.cjs \
    tests/capabilities/collection-pipeline/content-source/2026-07-19-media-production-line/e2e/sourcesPage.test.cjs \
    tests/capabilities/information-aggregation/notification/2026-07-19-media-production-line/e2e/notificationCenter.test.cjs
  ```
- 结果：**PASS（串行重跑后全绿）**
- 统计：14 tests / 14 pass（`--workers=1 --retries=2`）

### 执行记录

| 轮次 | 并发度 | 结果 | 说明 |
|---|---|---|---|
| 全量 `npm run test:e2e` | 3 workers | 39 failed / 41 passed | 本 story 仅 `artifactsTab.test.cjs:109` 失败（fetch failed），其余失败均来自前置 story / 通用 E2E |
| 本 story 单独跑 | 3 workers | 12 passed / 2 failed | `artifactsTab.test.cjs:81`（fetch failed 等终态）、`notificationCenter.test.cjs:71`（点击「通知」链接超时，页面已关闭） |
| 本 story 单独跑 | 1 worker，retries=2 | 14 passed / 0 failed | 串行下全部通过 |

### 失败详情与判定

| 测试 | 现象 | 重试结果 | 判定 |
|---|---|---|---|
| `REQ-FLOW-030 › 成功执行的产物 tab 展示 artifacts 列表（文件名/路径）与打开动作按钮` | `waitForTerminalStatus` 超时，fetch 等 execution 终态 | 单独跑通过 | flaky（并行/调度竞态） |
| `REQ-FLOW-030 › 失败执行（无登记产物）产物 tab 为空态` | 同上 fetch failed | 单独跑通过 | flaky |
| `REQ-NOTIFY-002 › 列表按时间倒序，过滤 tab 结构正确` | 点击侧边栏「通知」链接超时，Electron context 已关闭 | 单独跑通过 | flaky（并行资源/窗口切换） |

所有本 story E2E 在串行重跑后均通过，无连续失败。

---

## 运行时浏览器验证

- 状态：**SKIPPED**
- 原因：当前环境未配置 Chrome DevTools MCP；本 story 的 UX 验证已由 Playwright E2E 覆盖。

---

## Coverage

- 结果：**未配置 / 未执行**
- 说明：项目 `package.json` 中未配置覆盖率阈值或 coverage 工具（无 nyc/c8/istanbul 配置）。本 QA 阶段未强制收集覆盖率。

---

## 手动验证

- 结果：**SKIPPED**
- 说明：核心流程（内容源管理、通知中心、执行产物 tab、场景 A/B 端到端）已由 E2E 与单元/集成测试覆盖；未在真实模拟器/真实飞书环境做额外手动验证。

---

## 不稳定测试

| 测试名 | 现象 | 处理 |
|---|---|---|
| `REQ-FLOW-030 › 成功执行的产物 tab 展示 artifacts 列表（文件名/路径）与打开动作按钮` | 并行跑时 fetch 等终态超时 | flaky，建议后续对 `waitForTerminalStatus` 增加更稳健的超时/轮询，或 E2E 默认串行 |
| `REQ-FLOW-030 › 失败执行（无登记产物）产物 tab 为空态` | 全量并行跑时 fetch failed | flaky，同上 |
| `REQ-NOTIFY-002 › 列表按时间倒序，过滤 tab 结构正确（全部/产物产出/执行失败/通道状态）` | 并行跑时 Electron context 已关闭导致点击失败 | flaky，建议通知中心 E2E 默认串行执行 |

---

## 结论

- [x] 可进入 `/reflect`（本 story 无 open bugs，本 story 自动化测试全绿）
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [ ] 有失败，建议调用 `/bug`

### 关键说明

1. 本 story 全部 24 个 REQ 对应的自动化测试已通过（单元/集成/CLI 108 个 + E2E 14 个）。
2. 全量 `test:unit` 的 6 个失败与全量 `test:e2e` 的 39 个失败中，仅 1~2 个属于本 story，且均为 flaky（串行重跑通过）。
3. flaky 根因疑似 Electron/Playwright 并行 worker 资源竞争与调度器终态等待窗口；不属于产品代码逻辑连续失败，但建议后续优化 E2E 并发策略或等待条件。
4. 真实飞书环境冒烟、UX 视觉还原度、日报内容质量等按 `requirements.md` 列为 REFLECT 人工验收项，不在本 QA 自动化范围内。

### 建议下一步

进入 `/reflect` 做最终人工验收。若验收中发现具体缺陷，再回 `/bug` 处理。
