# BUG-002 Triage Report

> bug: `BUG-002`  
> story: `codex-harness-desktop`  
> date: 2026-07-10

---

## 分类决策

**最终分类：`code-defect`**（附带 minor test-gap）

## 判定理由

### 1. 为什么不是 `req-gap`

UX HTML 中所有页面的 `.app-shell` 结构一致：TopBar 跨顶、下方左侧 Sidebar、下方右侧 Main。该结构属于 PRD §6.4 关键页面结构的基础约定，也是多个带 UX 参照的 REQ 的隐含验收条件。问题出在实现未对齐，而非需求未定义。

### 2. 为什么不是 `not-a-bug`

当前布局（左右结构 + 两个 Logo）与用户在 feel-signoff 环节给出的反馈直接冲突，且与 UX 参照明显不一致，属于实现缺陷。

### 3. 为什么附带 `test-gap`

新增的 `topbar.test.cjs` 验证了 TopBar 内容存在性，但未验证：
- TopBar 是否横跨整个顶部（而非嵌套在右侧区域内）。
- Sidebar 是否不再包含独立的品牌 Logo。
- 全局布局是否符合 `.app-shell` 的 grid 结构。

需要在修复时补充这些布局级断言。

## 建议修复范围

1. 重构 `PageLayout.jsx`：使用 `.app-shell` 容器，顺序为 `TopBar` → `Sidebar` → `<main className="app-main">`。
2. 修改 `index.css`：
   - `.app-shell` / `.app-layout` 保持 `grid-template-columns: sidebar-width 1fr; grid-template-rows: topbar-height 1fr;`
   - `.topbar`：`grid-column: 1 / -1;`
   - `.sidebar`：`grid-row: 2; grid-column: 1; height: auto;`
   - `.app-main`：`grid-row: 2; grid-column: 2;`（不再 flex column，因为 TopBar 已移出）。
3. 移除 `Sidebar.jsx` 中的 `sidebar-header` / `sidebar-logo`。
4. 更新 E2E 回归测试，断言 Sidebar 中不存在 "OPC Workstation" 文本，且 TopBar 存在。
5. 全量回归：61 单元测试 + 25 E2E 测试。

## 路由

- 下一步：`/fix-bugs`
- 修复后回到 QA / feel-signoff。
