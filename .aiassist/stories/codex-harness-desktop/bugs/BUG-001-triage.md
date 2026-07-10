# BUG-001 Triage Report

> bug: `BUG-001`  
> story: `codex-harness-desktop`  
> date: 2026-07-10

---

## 分类决策

**最终分类：`code-defect`**（附带 `test-gap`）

## 判定理由

### 1. 为什么不是 `req-gap`

全局 TopBar 虽然没有被单独结晶成一条 REQ，但它满足以下条件：

- PRD §6.4 明确说明“基于当前交互原型，应用主要页面如下”，而所有主要页面的 UX HTML 原型（`dashboard-overview.html`、`workspace-home.html`、`flows.html`、`tasks.html`、`skills.html`、`settings.html`、`flow-editor.html`）均采用同一套 `.topbar` 结构。
- REQ-DASH-001 的 UX 参照即为 `dashboard-overview.html`，该文件顶部包含 Logo、搜索框、语言/主题/通知/设置图标。因此 TopBar 结构属于该 REQ 的 feel-signoff 验收范围。
- REQ-I18N-001 / REQ-I18N-002 要求支持主题/语言切换与持久化；UX 原型将这两个入口放在 TopBar，实现当前仅在 Settings 页面提供，属于同一能力入口位置不符，而非能力未定义。

因此，问题不是“REQ 没写”，而是“实现没按已签核的 UX 参照完成”。

### 2. 为什么不是 `not-a-bug`

实际行为（空 TopBar）与用户在 feel-signoff 环节提供的 UX 参照截图明显不一致，且该差异涉及功能入口（搜索、语言、主题、设置、通知），不属于主观审美差异。

### 3. 为什么附带 `test-gap`

- `tests/e2e/helpers/locators.cjs` 中没有针对 TopBar 元素的定位器。
- 现有 5 个 E2E spec 均未断言 TopBar 的品牌、搜索框或右上角图标存在性。
- 若仅修复实现而不补测试，同类回归无法被自动捕获。

## 建议修复范围

1. 在 `src/renderer/components/layout/TopBar.jsx` 中实现：
   - 品牌文字 "OPC Workstation"
   - 全局搜索输入框（当前可先作为受控组件，触发搜索行为可占位或路由到 Workspace）
   - 右上角四个图标按钮：语言切换、主题切换、通知、设置
2. 保证所有图标按钮可访问（`aria-label`）并可通过 E2E 定位。
3. 在 `tests/e2e/helpers/locators.cjs` 增加 TopBar 定位器。
4. 新增或扩展 E2E 测试覆盖 TopBar 元素存在性，并验证语言/主题快捷入口能正常跳转/切换。
5. 重新跑全量测试（`npm run test:unit` + `npm run test:e2e`），更新 `qa-report.md`。

## 路由

- 下一步：`/fix-bugs`
- 修复后需重新经过 assertion-signoff（新增/修改测试）→ BUILD → QA → feel-signoff。
