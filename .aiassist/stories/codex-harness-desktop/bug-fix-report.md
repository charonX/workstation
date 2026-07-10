# Bug Fix Report: codex-harness-desktop

> generated_at: 2026-07-10  
> story: `codex-harness-desktop`  
> workflow: `loop-workflow`

---

## 修复列表

| BUG-ID | 类别 | 严重程度 | 摘要 | 状态 |
|---|---|---|---|---|
| BUG-001 | code-defect (with test-gap) | major | 顶部导航栏内容与 UX HTML 不一致 | fixed |
| BUG-002 | code-defect | major | 应用整体布局结构错误 — TopBar 未跨顶且存在两个 Logo | fixed |
| BUG-003 | code-defect | minor | ProjectFormModal 中 Local Path 等文案未国际化 | fixed |
| BUG-005 | code-defect | minor | TopBar 主题/语言切换存在竞态 | fixed |

### BUG-001 详情

- **症状**：全局 TopBar 组件仅渲染空壳，缺少品牌 Logo、全局搜索框、语言/主题/通知/设置图标。
- **根因**：`src/renderer/components/layout/TopBar.jsx` 实现阶段被创建为占位组件，未按 UX HTML 填充内容。
- **修复范围**：
  - 实现 `TopBar.jsx`：品牌文字 "OPC Workstation"、全局搜索框、语言切换、主题切换、通知、设置图标按钮。
  - 添加 TopBar 专用 CSS（`index.css`）：布局、搜索输入、图标按钮组。
  - 补充 i18n key（`topBar.*`）支持搜索 placeholder、主题/语言按钮 aria-label、通知/设置提示。
  - `Workspace.jsx` 支持 `?q=` URL query，使 TopBar 全局搜索可路由到 Workspace 并自动过滤项目。
  - 补充回归测试：
    - `tests/e2e/helpers/locators.cjs` 增加 TopBar 定位器。
    - 新增 `tests/capabilities/internationalization-theme/theme/codex-harness-desktop/e2e/topbar.test.cjs` 覆盖品牌、搜索框、四个图标按钮、主题/语言快捷切换、设置导航。
- **关联 REQ**：REQ-DASH-001、REQ-WORKSPACE-005、REQ-I18N-001、REQ-I18N-002
- **外部 issue**：GitHub charonX/workstation #2

### BUG-002 详情

- **症状**：BUG-001 修复后，页面仍是左右结构（Sidebar 占左侧全高，右侧区域内再放 TopBar + 内容），且 Sidebar 与 TopBar 各有一个 "OPC Workstation" Logo。
- **根因**：BUG-001 只填充了 TopBar 内容，未重构 `PageLayout` 的 CSS Grid 结构，也未移除 Sidebar 中的 Logo。
- **修复范围**：
  - 重构 `PageLayout.jsx`：使用 `.app-shell` 容器，顺序为 `TopBar` → `Sidebar` → `<main className="app-main">`。
  - 修改 `index.css`：`.topbar` 跨顶（`grid-column: 1 / -1`），`.sidebar` 位于 TopBar 下方左侧，`.app-main` 位于 TopBar 下方右侧。
  - 移除 `Sidebar.jsx` 中的 `sidebar-header` / `sidebar-logo`。
  - 更新 `topbar.test.cjs`：断言 Sidebar 中不存在 "OPC Workstation"；修复 theme toggle 测试以适配默认 dark 主题。
- **关联 REQ**：REQ-DASH-001、REQ-I18N-001、REQ-I18N-002
- **外部 issue**：无（BUG-001 修复后的结构偏差，本地跟踪）

### BUG-003 详情

- **症状**：`ProjectFormModal.jsx` 中所有文案（包括 Local Path 标签）均为硬编码英文，切换语言后不变。
- **根因**：项目创建弹层实现时未接入 i18n。
- **修复范围**：
  - 在 `en-US.json` / `zh-CN.json` 中新增 `projectForm.*` 翻译键。
  - 将 `ProjectFormModal.jsx` 中所有硬编码字符串替换为 `t(...)`。
- **关联 REQ**：REQ-I18N-002

### BUG-005 详情

- **症状**：全量 E2E 回归时，`topbar.test.cjs` 主题切换 case 偶发失败。
- **根因**：`TopBar` 与 `App` 各自调用 `useSettings`，TopBar 的 `settings` state 加载延迟导致 toggle 时使用了错误的当前值。
- **修复范围**：
  - `TopBar.jsx` 的 `toggleTheme` / `toggleLanguage` 优先读取 `document.documentElement` 上已应用的 `data-theme` / `lang` 属性。
- **关联 REQ**：REQ-I18N-001、REQ-I18N-002

---

## 回归测试结果

### 单元测试

```
npm run test:unit
ℙ tests 61
ℙ suites 11
ℙ pass 61
ℙ fail 0
```

### E2E 测试

```
npm run test:e2e
Running 25 tests using 5 workers
25 passed
```

### 新增回归测试

- `TopBar › renders brand, search box and action icons` ✅
- `TopBar › theme toggle in topbar switches data-theme` ✅
- `TopBar › language toggle in topbar cycles language and updates navigation` ✅
- `TopBar › settings icon navigates to settings page` ✅

---

## 需要回补的文档清单

本次修复未改变 PRD/REQ/CONTEXT/ADR 的语义，但新增了一个跨能力的全局布局回归测试。以下文档可视需要更新：

- [ ] `signoff.md` 中 assertion-signoff 表格：新增 topbar.test.cjs 到相关 REQ 的测试覆盖记录（可选，因 feel-signoff 期间主要关注观感）。
- [ ] `engineering-lessons.md`：记录 TopBar 占位组件导致的 feel-signoff 回流教训——所有全局布局组件在 BUILD 阶段必须对照 UX HTML 完整实现，不能留空壳。

---

## 外部 issue 状态

- GitHub issue [#2](https://github.com/github/charonX/workstation/issues/2) 已创建，待用户最终确认后关闭。

---

## 后续步骤

1. 提交 `[test]` 和 `[build]` 修复 commit。
2. 用户确认后关闭 BUG-001 和 GitHub issue #2。
3. 回到 QA / feel-signoff 流程继续观感验收。
