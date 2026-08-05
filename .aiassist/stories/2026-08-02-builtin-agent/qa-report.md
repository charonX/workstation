# QA 报告 — 2026-08-02-builtin-agent

> 日期：2026-08-05（增量 QA：slice 9 Settings tab 化 + BUG-001/002/004 修复后全量回归）
> 阶段：QA
> 前次：2026-08-04 首轮 QA（516 单元 / 116 E2E 全绿）

## 单元测试

- **结果：PASS** — 525 tests / 525 pass / 0 fail（`npm run test:unit`，QA 父代理独立重跑确认）
- 覆盖：REQ-AGENT-001~025 全部有自动化断言（含 slice 9 增量 3 REQ + BUG-001 stdioGuard 5 例 + BUG-002 workerBundle 2 例 + BUG-004 defaultModel 2 例）

## E2E/UITests

- **结果：PASS** — `npx playwright test`（Playwright Electron，全量 28 文件）：**127 passed / 0 failed / 0 flaky**（48.2s）
- 本 story 新增：`settingsTabs.test.cjs` 11 例（REQ-AGENT-023~025：tab 结构/aria/zh-CN 文案/placeholder/分区归属/分区保存请求体隔离/keepExistingKey/通道保存 mock/失败区内显示/编辑保留/零变更请求）
- 测试侧接替适配（REQ-AGENT-023 AC4，断言语义零变更）四套全绿：themeLanguage 4、onboarding 7、versionDisplay 3、settingsChannel 3
- Playwright 产物：无失败，无 trace/screenshot
- 环境备注：E2E 需 better-sqlite3 Electron ABI（`npm run rebuild:electron` 前置；test:unit 会重建为 Node ABI，混跑顺序 = rebuild → E2E → unit）

## 运行时浏览器验证

- **状态：SKIPPED** — Chrome DevTools MCP 未配置；Settings tab 视觉/交互观感（tab 下划线选中态、间距、反馈动效、en-US 译文）已登记 REFLECT 人工验收

## Coverage

- **结果：FAIL（收集受阻，登记观察项，不阻塞）**
- 现象（沿用 08-04 登记，未变化）：`node --experimental-test-coverage` 模式挂起不退出；无 coverage 模式全量约 1 分钟正常退出。建议后续单独定位或 CI 侧确认阈值检查不受影响

## 手动验证（待人工，QA 自动范围外）

- **BUG-004 真实环境复验**：重启 app 后飞书发消息应能收到 agent 回复（模型 ID 修复后的端到端确认，用户在 BUG-004 会话中已启动验证）
- **Settings tab 化观感**：四 tab 切换、分区保存反馈、placeholder 文案、en-US 译文（签核裁决 2 → REFLECT 人工验收）
- 真实凭据联调项（沿用 08-04 登记）：CardKit 卡片流式真实渲染（H4）、真实 LLM 对话 + 工具调用、safeStorage 生产加密、asar 打包 spawn（H1）

## 不稳定测试

无（全量单元 + E2E 零 flaky；onboarding 项目创建类 3 例曾因 ABI 混跑报 E-DB-UNWRITABLE，rebuild 后稳定绿，属环境顺序问题非测试不稳定——已记入 build-progress 环境备注）

## 清理项（不阻塞）

| 项 | 说明 | 建议 |
|---|---|---|
| `tests/capabilities/flow-orchestration/flow/2026-07-23-nested-flow/e2e/debug-select.test.cjs` | 未跟踪的一次性调试残留（"debug6: patch React onChange handler"），混入全量套件且通过 | 人确认后删除，避免污染套件计数 |

## 结论

- [x] 可进入 `/reflect`（无 open bugs：BUG-001/002/004 已修复回归绿，BUG-003 not-a-bug 关闭；QA 全绿）
- [ ] 需回 BUILD
- [ ] 需回 REQ
- [ ] 有失败，建议调用 `/bug`
