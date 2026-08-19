# QA 报告 — 2026-08-19-feishu-reset-history-archive

> 结论：**可进入 `/reflect`**（本 story 回归面全绿；无 open bug；6 例 E2E 失败经二分实证为 pre-story 预存失败，属 flow-orchestration 域，建议另起处理）

## 单元测试

- 结果：**PASS**
- 命令：`npm run test:unit`（`rebuild:node` + `node --test` 全量 api/cli）
- 输出：**1051 tests / 253 suites / 1051 pass / 0 fail**（83s）
- 本 story 测试面（全部绿）：
  - `feishuResetArchive.test.js`（8 例：REQ-AGENT-123 AC1-AC4 + REQ-AGENT-124 AC1-AC4，含复审补的 AC3 写失败降级与 AC1 provider/model/createdAt 断言）
  - `feishuArchiveSessions.test.js`（6 例：REQ-AGENT-125/126，含复审补的 messageId/createdAt 一致性断言）
  - `feishuResetReceipt.test.js`（REQ-AGENT-123 AC5）
  - `feishuArchiveHydration.test.js`（2 例：BUG-001 回归，Prove-It 先红后绿）
  - 旧例 `ui-copilot/sessionReset.test.js` 空世代语义正名后存活
- 定向回归：hydrationWindow / hydrationCooling / sessionIdleEviction / agentRestartKey / sessionDomainProjection / sessionDomainKeys / historyToolFilter / sessionStore / sessionMessage 等 56+33 例全绿

## E2E/UITests

- 结果：**PASS（本 story 回归面 21/21；全量 230 过 / 6 预存失败）**
- 命令：`npm run rebuild:electron` 后 `npx playwright test`
- 本 story 无新增 E2E（renderer 零改动）；相关回归面 = conversation-space 全套（assistantSessions / assistantChat / assistantNav / assistantConfirm / assistantFeishu）**21/21 绿**，含「/reset → 同分组新会话出现且旧会话历史仍在」「飞书会话只读回看」等关键流程
- **环境竞态记录（非产品缺陷）**：首轮 subset 14 红，根因 = `test:unit` 的 `rebuild:node` 把 better-sqlite3 翻转为 Node ABI，Electron 加载失败报 `E-DB-UNWRITABLE`（probe 实证 500 响应体）；`rebuild:electron` 后全绿。与 2026-08-12-conversation-toolbar-ext QA 记录的 ABI 翻转竞态同型——**`test:unit` 与 `test:e2e` 不能共享同一份 node_modules 序贯跑而不重建**
- **预存失败（与本 story 无关，二分实证）**：以下 6 例在 pre-story commit `91a6980` 上同样失败：
  - `nestedExecutionDetail.test.cjs` REQ-FLOW-044 AC1/AC2/AC3/AC5（callFlow 展开，4 例）
  - `artifactsTab.test.cjs` REQ-FLOW-030（产物 tab 列表）
  - `debugModal.test.cjs` REQ-FLOW-028（调试弹窗手动运行）
  - 均为 flow-orchestration 域 7 月 story 的 E2E；**建议**：对其调用 `/bug`（在各自 story 域内诊断分类），不阻塞本 story
- flaky：无（重跑稳定复现同一结果，非时绿时红）

## 运行时浏览器验证

- 状态：**SKIPPED**——本 story 无 `ux/` 目录、renderer 零改动；Chrome DevTools MCP 验证不适用

## Coverage

- 项目未配置 coverage 阈值/工具（package.json 无 coverage 脚本）——N/A

## 手动验证

- Electron 桌面应用经 E2E fixture 真实启动 21+230 次（会话列表/飞书只读/reset 流程均真实渲染），等效覆盖核心流程人工走查；观感项无（无 UI 变更）

## 不稳定测试

| 测试名 | 现象 | 处理 |
|---|---|---|
| 无 | — | — |

## 结论

- [x] 可进入 `/reflect`（无 open bugs，QA 本 story 面全绿）
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [ ] 有失败，建议调用 `/bug` —— 仅限 6 例 flow-orchestration 预存失败（非本 story，已在上方建议另行处理）

## 遗留事项（随 /reflect 闭环）

1. REQ 文档债务 ×2（人确认接受）：`requirements.md` `space_meta`→`agent_space_meta` 表名漂移、REQ-AGENT-126 AC3 `{code}`→`{error}` 字段漂移——留 /reflect 随 REQ v2 重哈希一并修订
2. PRD §13 留人决策：mode/provider POST alias 扩面 ui:* 写面（保留现状 or 守护前移）
3. CONTEXT.md 术语同步（/domain-model）：飞书归档条目 / 世代 / 活跃行
