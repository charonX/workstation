# QA 报告 — 2026-07-23-nested-flow

> 生成时间：2026-07-28
> Story 阶段：QA
> Attempt：2

---

## 1. 单元/API 测试

- **命令**：`NODE_ENV=test node --test $(find tests/capabilities/flow-orchestration -path '*/api/*.test.js' -type f)`
- **结果**：**PASS**
- **统计**：
  - tests: 181
  - suites: 39
  - pass: 181
  - fail: 0
  - skipped: 0
  - duration: ~33s
- **覆盖 REQ**：FLOW-032~047（嵌套子流程调用 + 统一节点输出模型）

### 关键测试套件

| 测试文件 | 状态 | 覆盖 REQ |
|---|---|---|
| `nodeRegistry.test.js` | ✅ PASS | REQ-FLOW-043 / ADR-010 |
| `setVariablesUpstream.test.js` | ✅ PASS | REQ-FLOW-047 |
| `callFlowValidation.test.js` | ✅ PASS | REQ-FLOW-034 |
| `setVariablesValidation.test.js` | ✅ PASS | REQ-FLOW-047 |
| `executorSignature.test.js` | ✅ PASS | REQ-FLOW-042 |
| `setVariables.test.js` | ✅ PASS | REQ-FLOW-047 |
| `subflowIsolation.test.js` | ✅ PASS | REQ-FLOW-035 |
| `subflowFailure.test.js` | ✅ PASS | REQ-FLOW-037 |
| `subflowLatestVersion.test.js` | ✅ PASS | REQ-FLOW-039 |
| `nestedExecution.test.js` | ✅ PASS | REQ-FLOW-040 |
| `circularReference.test.js` | ✅ PASS | REQ-FLOW-038 |
| `subflowNodeTypes.test.js` | ✅ PASS | REQ-FLOW-032 / REQ-FLOW-033 |

---

## 2. E2E / UI 测试

- **命令**：
  - `npx playwright test tests/capabilities/flow-orchestration/execution/2026-07-23-nested-flow/e2e/nestedExecutionDetail.test.cjs`
  - `npx playwright test tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/e2e/subflowConfig.test.cjs`
- **结果**：**PARTIAL (2/13 pass)**
- **统计**：
  - nestedExecutionDetail: 0/5 pass
  - subflowConfig: 2/8 pass
- **修复项**：Electron 启动环境问题已通过 `npm run rebuild:electron` 重建 `better-sqlite3` native binding 解决。
- **Playwright 产物**：
  - trace/screenshot 路径：`test-results/capabilities-flow-orchestr-*/`

### 失败测试列表

| 测试文件 | 失败用例 | 初步原因 |
|---|---|---|
| `nestedExecutionDetail.test.cjs` | AC1~AC5 (5/5) | Flow 执行未到达 `success`，疑似 agent 节点调用真实 Anthropic SDK 因本机未登录/API key 失败 |
| `subflowConfig.test.cjs` | AC4: callFlow config cascades | 子流程选择下拉无选项 |
| `subflowConfig.test.cjs` | AC4: output mappings read-only | 页面提前关闭 |
| `subflowConfig.test.cjs` | AC4: multi-input child pick entry | 入口下拉不可见 |
| `subflowConfig.test.cjs` | REQ-FLOW-045: open subflow | 页面关闭，跳转按钮不可交互 |
| `subflowConfig.test.cjs` | circular ref inline error | 子流程选择下拉无选项 |
| `subflowConfig.test.cjs` | i18n | 语言切换按钮 `lang-toggle` 不存在 |

---

## 3. 运行时浏览器验证

- **状态**：**SKIPPED**
- **原因**：Chrome DevTools MCP 未在当前环境配置；无法对运行中的 Electron 应用执行 Console/DOM/Network/A11y/截图验证。

---

## 4. Coverage

- **状态**：**SKIPPED**
- **原因**：项目未配置覆盖率收集（无 `.nycrc`、无 coverage 脚本）。

---

## 5. 手动验证

- **状态**：**NOT RUN**
- E2E 已能启动；手动验证可在 E2E 稳定后补充。

---

## 6. 不稳定测试

- 未发现 flaky 测试。
- 当前 E2E 失败是稳定复现的，需逐个诊断。

---

## 7. 结论

- [x] 单元/API 测试全绿（181/181）
- [x] Electron 启动环境问题已修复
- [ ] E2E 测试仍有 11/13 失败，需要进一步诊断分类

### 建议下一步

1. **调用 `/bug`** 逐个诊断 E2E 失败：
   - `nestedExecutionDetail` 失败可能是测试数据使用了 `provider: "anthropic"` 的 agent 节点，需要真实 Anthropic 登录态/API key，建议改为 mock provider 或在测试环境中注入 stub agent executor。
   - `subflowConfig` 失败可能是 E2E 脚本与当前 CallFlowFields UI 行为/ data-testid 不一致，需按当前实现更新测试或修复 UI。
2. 或在确认全部为 test-gap 后由 `/test-author` 批量更新 E2E 测试。
3. E2E 全绿后再进入 `/reflect`。

---

## 8. 相关 Commit

| 标签 | Commit | 说明 |
|---|---|---|
| `[build]` | `fcbc631` | S3: runtime engine migration to unified output model |
| `[docs]` | `3538627` | S4: mark regression verification covered |
| `[test]` | `5b633d4` | update circularReference.test.js to REQ v2.0 |
| `[docs]` | `f3bddd2` | build-progress: unblock circularReference |
| `[docs]` | `476dbe7` | workflow-state: BUILD -> QA |
| `[docs]` | pending | QA report: Electron launch fixed, E2E failures need diagnosis |

---

## 9. 环境修复记录

| 问题 | 根因 | 修复命令 | 验证 |
|---|---|---|---|
| Electron 启动 30s 超时 | `better-sqlite3` native binding 未针对 Electron ABI 重建，主进程 `startServer` 中 `getDb` 抛 `E-DB-UNWRITABLE`，导致 `createWindow` 失败，未创建 BrowserWindow | `npm run rebuild:electron` | `firstWindow` 2.5s 内就绪 |
