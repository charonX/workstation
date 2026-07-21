# QA 报告 — 2026-07-19-media-production-line

> 生成时间：2026-07-21
> Story 阶段：BUILD → QA
> 本次 QA 范围：attempt-3 S13-reflow（`feishuMessage` 输出契约改为 `text/sender/messageId`）及本 story 相关回归。

---

## 单元测试

- 结果：**FAIL**（存在既有失败，S13-reflow 目标测试全绿）
- 命令：`npm run test:unit`
- 输出：
  - 总数：261
  - 通过：254
  - 失败：7
- 失败详情：
  1. `tests/capabilities/collection-pipeline/content-source/2026-07-19-media-production-line/cli/contentSources.test.js:32`
     - `REQ-SRC-001: CLI 创建内容源并出现在 list 输出（机器可读 JSON）`
     - `SyntaxError: Unexpected token 'E', "Execution "... is not valid JSON`
     - 根因：全量并发运行时其他测试日志混入 CLI stdout，导致 JSON 解析失败。单独运行该文件时通过，属并发隔离问题。
  2. `tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/api/executionLog.test.js:80`
     - `引擎安全中止的执行也写入已执行节点的记录`
     - 状态断言 `'queued' !== 'error'`
  3. `tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/api/executionLog.test.js:128`
     - `agent 未声明 outputVariable 时 output 列仍捕获文本输出`
     - 状态断言 `'queued' !== 'success'`
  4. `tests/capabilities/internationalization-theme/language/codex-harness-desktop/api/language.test.js:26`
     - `REQ-I18N-002: default language is English`
     - 断言 `'zh-CN' !== 'en-US'`
  5. `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/task.test.js:38`
     - `REQ-SCHEDULE-001: creates a manual task and starts running`
     - 断言 `undefined !== 'running'`
  6. `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/task.test.js:98`
     - `REQ-SCHEDULE-001: CLI runs a task`
     - 断言 `undefined !== 'running'`
  7. `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/task.test.js:110`
     - `BUG-012: execution runs the flow engine and records real output, logs and nodesRun`
     - 断言 `undefined !== 'running'`

> 上述 7 个失败均为 S13-reflow 之前已存在的既有失败，与本次 `feishuMessage` text 契约改动无关。S13-reflow 目标业务测试 35/35 通过。

---

## E2E/UITests

- 结果：**FAIL**（1 个连续失败，其余通过）
- 命令：`npm run test:e2e -- --workers=1 <story 相关 E2E 文件>`
- 本次运行范围：本 story 5 个 E2E 文件，共 20 个测试
- 通过：19
- 失败：1

### 失败详情

| 测试文件 | 测试名 | 现象 | 根因 |
|---|---|---|---|
| `tests/capabilities/flow-orchestration/flow-engine/2026-07-19-media-production-line/e2e/feishuMessageNode.test.cjs:58` | `feishuMessage 节点配置面板固定展示 text/sender/messageId 且不可删除` | 点击 Save 按钮超时；页面实际存在「保存」按钮 | `tests/e2e/helpers/flowEditor.cjs:63` 使用 `getByRole('button', { name: 'Save', exact: true })` 定位，但产品当前默认语言为中文，按钮文案为「保存」 |

### 重跑结果

- 使用 `--workers=1` 串行重跑 story 相关 E2E：同样的 1 个测试失败。
- 其余 4 个 story E2E 文件（settingsChannel、sourcesPage、artifactsTab、notificationCenter）在串行重跑中全部通过。
- 失败为**连续失败**，非 flaky。

### Playwright 产物

- trace 路径：`test-results/capabilities-flow-orchestr-ed5b0-text-sender-messageId-且不可删除-electron/`
- screenshot 路径：`test-results/capabilities-flow-orchestr-ed5b0-text-sender-messageId-且不可删除-electron/test-failed-1.png`

### flaky 测试列表

- 无。`sourcesPage` 和 `artifactsTab` 在并发运行时各有 1-2 个失败，串行重跑后全部通过，属于并发隔离/时序敏感，未列入 blocker。

---

## 运行时浏览器验证

- 状态：**SKIPPED**
- 说明：Chrome DevTools MCP 未配置，未调用 `/browser-verify`。

---

## Coverage

- 状态：**SKIPPED**
- 说明：项目未配置覆盖率阈值与收集命令。

---

## 手动验证

- 状态：**SKIPPED**
- 说明：未启动 app 做手动流程验证；核心路径已由 API/E2E 测试覆盖。

---

## 不稳定测试

| 测试名 | 现象 | 处理 |
|---|---|---|
| `sourcesPage.test.cjs` 部分用例 | 并发运行时偶发 `ECONNREFUSED` 或页面关闭 | 串行重跑通过；建议后续优化 E2E 并发隔离 |
| `artifactsTab.test.cjs:81` | 并发运行时等待执行终态超时 | 串行重跑通过；建议后续优化 E2E 并发隔离 |

---

## 结论

- [ ] 可进入 `/reflect`（无 open bugs，QA 全绿）
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [x] **有失败，建议调用 `/bug` 或对失败 E2E 测试走 `/test-author` 修正**

### 处理建议

`feishuMessageNode.test.cjs:58` 的连续失败根因是 **E2E helper 中硬编码英文 locator「Save」与产品当前中文默认 UI 不匹配**。该问题本质上属于跨 story 的测试债务：

- `src/services/settingsService.js:24` 与 `src/renderer/i18n/index.js:13` 默认语言为 `zh-CN`；
- 而 `tests/e2e/helpers/flowEditor.cjs:63` 使用英文按钮文案定位；
- 同时 `language.test.js` 期望默认语言为 `en-US`。

因此存在两层不一致：
1. 产品默认语言与 `language.test.js` 契约不一致；
2. E2E helper 文案定位与产品实际 UI 语言不一致。

推荐下一步：**对 `feishuMessageNode.test.cjs:58` 调用 `/bug` 或回流 `/test-author`**，将 Save 按钮定位改为 `data-testid` 或在 E2E setup 中强制语言，避免依赖 UI 文案。修复后重新跑 E2E 即可进入 `/reflect`。

S13-reflow 核心实现（`text/sender/messageId` 契约、路由层不解析 URL、模板/agent 更新、变量选择器暴露）已通过 35/35 目标 API 测试验证，无新增回归。
