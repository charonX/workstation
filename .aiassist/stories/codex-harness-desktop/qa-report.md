# QA 报告 — codex-harness-desktop

生成时间：2026-07-10（BUG-001 修复后重新回归）

---

## 变更摘要

本次 QA 针对 feel-signoff 阶段发现的 BUG-001（顶部导航栏与 UX HTML 不一致）及 BUG-002（整体布局结构错误、存在两个 Logo）进行修复后的全量回归验证。

---

## 单元测试

- 结果：**PASS**
- 命令：`npm run test:unit`
- 统计：61 个测试，11 个 suite，0 失败
- 覆盖范围：
  - CLI（REQ-CLI-001）
  - FlowEngine（REQ-FLOW-007~010）
  - Flows API/CLI（REQ-FLOW-001/002/006）
  - Dashboard（REQ-DASH-001）
  - Language / Theme / Density（REQ-I18N-001/002，REQ-WORKSPACE-007）
  - Schedules（REQ-SCHEDULE-002）
  - Tasks and Executions（REQ-SCHEDULE-001/003）
  - Skills（REQ-SKILL-001/002/003）
  - Projects（REQ-WORKSPACE-003/004/005/006）
  - Settings（REQ-WORKSPACE-001/002）

## E2E / UI Tests

- 结果：**PASS**
- 命令：`npm run test:e2e`
- 统计：25 个测试，0 失败，0 flaky
- 关键用户路径：
  - 主题/语言/密度切换与持久化
  - Dashboard 指标卡片、最近执行、快捷项目链接
  - Flow 创建、编辑器、节点属性、运行、执行详情
  - Skill 安装（本地文件）与 Skill Detail 标签页
  - Workspace 设置、本地项目创建、Project Detail 配置 Skills
  - **TopBar 品牌、搜索框、语言/主题/通知/设置图标按钮（新增回归测试）**

## Bug 修复验证

| BUG-ID | 修复内容 | 回归测试 | 状态 |
|---|---|---|---|
| BUG-001 | TopBar 实现与 UX HTML 对齐：品牌、搜索框、语言/主题/通知/设置图标按钮 | `topbar.test.cjs`（4 个 case） | ✅ 通过 |
| BUG-002 | 重构全局布局为 TopBar 跨顶 + Sidebar + Main；移除 Sidebar 重复 Logo | `topbar.test.cjs` 布局断言 | ✅ 通过 |

## Playwright 产物

- 配置：`playwright.config.cjs`
- 输出目录：`./test-results`（已加入 `.gitignore`）
- 失败证据：无
- trace / screenshot：未生成（无失败）

## 运行时浏览器验证

- 状态：**SKIPPED**
- 原因：Chrome DevTools MCP 未配置；Playwright Electron E2E 已覆盖前端关键路径。

## Coverage

- 状态：**NOT CONFIGURED**
- 说明：项目尚未配置覆盖率阈值与收集工具，建议后续接入 `c8` 或 Playwright coverage。

## 手动验证

- 状态：**SKIPPED**
- 原因：当前为 headless CLI 环境，未启动交互式 Electron 窗口；核心流程已由 Playwright Electron E2E 覆盖。

## 不稳定测试

| 测试名 | 现象 | 处理 |
|---|---|---|
| 无 | — | — |

## 结论

- [x] 可进入 `/signoff --stage=feel`
- [ ] 需回 BUILD
- [ ] 需回 REQ

全部 61 个单元测试与 25 个 Playwright Electron E2E 测试通过，无连续失败、无 flaky。BUG-001 修复已验证，建议推进到 **feel-signoff** 进行观感验收。
