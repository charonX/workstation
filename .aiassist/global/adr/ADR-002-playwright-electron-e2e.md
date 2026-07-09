# ADR-002: 前端验收采用 Playwright Electron E2E + feel-signoff

- **状态**: 已接受
- **日期**: 2026-07-09
- **相关 story**: codex-harness-desktop
- **相关 REQ**: REQ-FLOW-002~005、REQ-SKILL-002、REQ-I18N-001~002、REQ-DASH-001、REQ-WORKSPACE-003~006、REQ-SKILL-003

## 背景

attempt-2 的技术方案将前端验收完全交给 feel-signoff（人眼对照 HTML UX 原型），未引入任何可自动化的前端 seams。结果 BUILD 阶段实现了后端/CLI，但 Electron + React 前端界面缺失，导致 feel-signoff 无法通过。

attempt-3 需要一种机制，确保 BUILD 阶段必须交付可启动、可交互的 Electron 前端，而不仅仅是后端 API。

## 决策

采用 **Playwright Electron E2E + feel-signoff** 的双层验收策略：

1. **Playwright E2E** 覆盖 5 条关键用户路径：
   - Settings → Add Project → Configure Skills
   - Create Flow → Edit Nodes → Run → View Execution
   - Install Skill → View Detail
   - Theme / Language 切换 DOM 效果
   - Dashboard 指标渲染
2. **harness**：Playwright 的 `electron.launch()` 直接启动 Electron 应用，覆盖 main/preload/renderer 全链路。
3. **数据准备**：`test.beforeEach` 通过 HTTP API seed 基础数据，UI 只验证目标交互。
4. **feel-signoff** 仍保留，负责纯视觉/审美判断（颜色、间距、动效、排版）。

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| feel-signoff only | 是 attempt-2 失败的原因，无法强制 BUILD 阶段交付前端 |
| Playwright 浏览器 + 独立 backend | 不覆盖 Electron 主进程/preload，可能出现“浏览器通过但 Electron 白屏” |
| Vitest + happy-dom 组件测试 | 不是真实用户流程，无法验证应用可启动 |
| `loop-workflow:browser-verify` (Chrome DevTools MCP) | 运行时验证工具，不是自动化回归测试框架，不能作为 BUILD 门禁 |

## 影响

- `package.json` 需要新增 `@playwright/test` 依赖和 `test:e2e` script。
- 需要新增 `src/e2e/` 目录，包含 fixtures、helpers、specs、`playwright.config.js`。
- `.github/workflows/contract-gate.yml` 需要安装 Playwright 浏览器二进制并运行 E2E。
- 多个 REQ 的测试类型需要从 feel-signoff 调整为 E2E + feel-signoff 或 CLI + HTTP API + E2E。
- BUILD 阶段必须先实现 Electron + React 最小壳，否则 E2E 无法通过。

## 相关文件

- `.aiassist/stories/codex-harness-desktop/tech-design.md`
- `.aiassist/stories/codex-harness-desktop/requirements.md`（待 `/crystallize` 更新）
- `.github/workflows/contract-gate.yml`
- `src/e2e/playwright.config.js`（待实现）
- `src/main/main.js`、`src/preload/preload.js`、`src/renderer/*`（待实现）
