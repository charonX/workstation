# QA 报告 — codex-harness-desktop

## BUG-016 修复验证

- 症状：Skill Detail Overview 中 version / author / category / tags 全部显示为“—”。
- 根因：
  1. `parseSkillMarkdown` 只按首行 `key: value` 解析，无法解析多行 YAML 列表（如 `tags:`），导致 tags 丢失。
  2. `SkillDetailModal` 无条件渲染所有 meta 行，空值用“—”兜底。
- 修复：
  - `src/services/skillService.js`：新增 `parseFrontmatter` / `parseList` / `parseScalar`，支持多行 frontmatter 与 YAML 列表；`scanRepoSkills` 提取 `tags`。
  - `src/renderer/components/skill/SkillDetailModal.jsx`：Overview tab 只渲染有值的 meta 行，并添加 `data-testid`。
- 回归测试：
  - API 测试断言 detail 返回 version/author/category/tags。
  - E2E 测试断言 npm-fixture-skill（有元数据）展示对应行，helper-skill（无元数据）隐藏对应行。
- 验证结果：
  - `npm run test:unit`：84 通过，0 失败
  - `npm run test:e2e`：43 通过，0 失败

---

生成时间：2026-07-10（BUG-004 目录选择器实现与 BUG-005 竞态修复后重新回归）

---

## 变更摘要

本次 QA 针对 feel-signoff 阶段发现的以下问题进行修复后的全量回归验证：

- BUG-001：顶部导航栏与 UX HTML 不一致
- BUG-002：整体布局结构错误、存在两个 Logo
- BUG-003：ProjectFormModal 文案未国际化
- BUG-004：local path 输入框应使用目录选择器（作为可接受偏差直接实现）
- BUG-005：TopBar 主题/语言切换存在竞态

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
- 统计：28 个测试，0 失败，0 flaky
- 关键用户路径：
  - 主题/语言/密度切换与持久化
  - Dashboard 指标卡片、最近执行、快捷项目链接
  - Flow 创建、编辑器、节点属性、运行、执行详情
  - Skill 安装（本地文件）与 Skill Detail 标签页
  - Workspace 设置、本地项目创建、Project Detail 配置 Skills
  - TopBar 品牌、搜索框、语言/主题/通知/设置图标按钮
  - **Settings 与 ProjectFormModal 目录选择器回填（新增回归测试）**

## Bug 修复验证

| BUG-ID | 修复内容 | 回归测试 | 状态 |
|---|---|---|---|
| BUG-001 | TopBar 实现与 UX HTML 对齐：品牌、搜索框、语言/主题/通知/设置图标按钮 | `topbar.test.cjs`（4 个 case） | ✅ 通过 |
| BUG-002 | 重构全局布局为 TopBar 跨顶 + Sidebar + Main；移除 Sidebar 重复 Logo | `topbar.test.cjs` 布局断言 | ✅ 通过 |
| BUG-003 | ProjectFormModal 全量国际化 | `onboarding.test.cjs` 等 | ✅ 通过 |
| BUG-004 | Settings 与 ProjectFormModal 的本地目录字段使用原生目录选择器 | `directoryPicker.test.cjs`（3 个 case） | ✅ 通过 |
| BUG-005 | SettingsContext 共享状态 + 默认 DOM 属性 + 测试等待，修复 TopBar 切换竞态 | `topbar.test.cjs` 主题/语言切换 | ✅ 通过 |

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

全部 61 个单元测试与 28 个 Playwright Electron E2E 测试通过，无连续失败、无 flaky。BUG-001~005 修复已验证，建议推进到 **feel-signoff** 进行观感验收。

---

# QA 报告 — codex-harness-desktop（skill repo 信息架构 BUILD 后）

生成时间：2026-07-16  
requirements-v1.hash: `670a6a4b8ae51f684c9508a83d4da9c8926197136062216818b2bf4c69e0fc84`

## 变更摘要

本次 BUILD 针对用户反馈的 skill 信息架构问题，将 skill 管理从“单个 skill”调整为“skill repo → 嵌套 skills”：

- 新增 `skill_repos` 数据表，`skills` 表新增 `repoId` 外键并移除 `installSource`。
- 安装时递归扫描 repo 根目录下 `skills/` 目录，命中 `SKILL.md` 的目录创建一个 skill；支持任意层级嵌套。
- 安装仅保留 `npm`/`npx` 与 `plugin` 来源，移除 `local` 来源。
- 列表接口改为 `GET /api/skill-repos`，返回按 repo 分组的结构。
- 删除改为 repo 级别：`DELETE /api/skill-repos/:repoId` 物理删除安装目录并级联删除 skills 与 `project_skills`。
- 前端 Skills 页面按 repo 分组展示，支持 repo 级删除；Install Skill 弹层移除 local 选项。
- CLI 支持 `opc-workstation skill repo-delete --id <repoId>`；`skill list` 输出按 repo 分组。

## 测试结果

| 测试层 | 命令 | 结果 |
|---|---|---|
| 单元 / API / CLI | `npm run test:unit` | ✅ 84 通过，0 失败 |
| E2E (Playwright + Electron) | `npm run test:e2e` | ✅ 42 通过，0 失败 |

## 关键验证点

- API 使用重构后的 `tests/fixtures/npm-skill`（含 `skills/npm-fixture-skill` 与 `skills/utils/helper`）验证递归扫描与分组列表。
- API 验证 npm/plugin 安装、local 来源拒绝、skillRepoPath 缺失校验、安装失败不创建记录、repo 删除级联。
- E2E 验证 npm 安装展示日志面板、列表按 repo 分组、Skill Detail 标签页、repo 删除确认。
- onboarding E2E 改用 npm fixture 预置 skill，验证 Project Detail 配置 skills。

## 已知问题 / 待 feel-signoff 项

- repo 分组视觉细节（repo header 样式、删除按钮位置）进入 feel-signoff 范围。

## 结论

- [x] 可进入 `/signoff --stage=feel`
- [ ] 需回 BUILD
- [ ] 需回 REQ

全量自动化测试通过，无 open bug，建议推进到 **feel-signoff** 进行观感验收。


## 已知问题 / 待 feel-signoff 项

- 日志面板视觉细节（颜色、间距、动效）进入 feel-signoff 范围。

## 结论

- [x] 可进入 `/signoff --stage=feel`
- [ ] 需回 BUILD
- [ ] 需回 REQ

全量自动化测试通过，无 open bug，建议推进到 **feel-signoff**。
