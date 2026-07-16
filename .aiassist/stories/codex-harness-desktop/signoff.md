# Signoff: OPC Workstation Desktop App

> story: `codex-harness-desktop`
> workflow: `loop-workflow`
> attempt: 3
> requirements-v1.hash: `5d0bdb3d2786189d093861e7afc37e0431ca15d5e7ae871afd42b421bf45f108`

---

## Assertion Signoff

> 状态：**已通过**（2026-07-09），**BUG-011 增量签核通过**（2026-07-14），**REQ-FLOW-016/017 增量签核通过**（2026-07-14），**task/execution UI 契约调整签核通过**（2026-07-15），**REQ-SKILL-003 修订后重新签核通过**（2026-07-16：真实安装到 `skillRepoPath`），**REQ-SKILL skill repo 信息架构调整签核通过**（2026-07-16），**REQ-WORKSPACE-006 增量签核通过**（2026-07-16：用户确认关联 skill 时在项目目录创建软连接，并自动级联关联 dependencies；取消关联时仅删除当前 skill 的软连接；skill repo 删除时清理 dangling symlink）

### 检查清单

- [x] 每个 REQ-ID 都有对应测试或 feel-signoff 映射。
- [x] 每个测试文件都有 `REQ-TRACE`、`REQ-VERSION`、`CAPABILITY-TRACE`、`ENTITY-TRACE`。
- [x] 每个 REQ 的 capability/entity 与 `business-capabilities.md` 一致。
- [x] 无 `// TODO: HUMAN ASSERTION` 占位（或已确认预期值）。
- [x] 预期值来源清晰（来自 PRD/REQ / 本次 assertion 访谈确认，非代码输出）。
- [x] 无快照当判定依据。
- [x] 边界/错误 case 已覆盖（空值、必填校验、非法表达式、循环保护、关联幂等、skill repo 删除级联、嵌套 skills 扫描、project skill 软连接与依赖级联）。
- [x] `signoff.md` Assertion 部分已更新。

### REQ 覆盖

| REQ-ID | Capability / Entity | 测试文件 | 关键断言 |
|---|---|---|---|
| REQ-WORKSPACE-001 | workspace-management / settings | `settings.test.js` | Workspace Root 持久化、空值校验 |
| REQ-WORKSPACE-002 | workspace-management / settings | `settings.test.js` | Skill Repository Path 持久化 |
| REQ-WORKSPACE-003 | workspace-management / project | `project.test.js`, `onboarding.test.js` (E2E) | 本地项目创建、name 必填 |
| REQ-WORKSPACE-004 | workspace-management / project | `project.test.js` | Git 项目创建、URL 必填、默认 branch main |
| REQ-WORKSPACE-005 | workspace-management / project | `project.test.js` | 名称过滤（大小写不敏感）、空过滤 |
| REQ-WORKSPACE-006 | workspace-management / project | `project.test.js`, `onboarding.test.js` (E2E) | Project Detail Overview/Skills Tab、skill 关联幂等 |
| REQ-WORKSPACE-007 | workspace-management / settings | `settings.test.js`, `onboarding.test.js` (E2E) | 密度偏好持久化（compact / comfortable），默认 comfortable |
| REQ-FLOW-001 | flow-orchestration / flow | `flow.test.js` | Flow 列表含 project/node count/scheduleEnabled |
| REQ-FLOW-002 | flow-orchestration / flow | `flow.test.js`, `flowRun.test.js` (E2E) | 创建 Flow、name/project 必填 |
| REQ-FLOW-003 | flow-orchestration / flow | `flowRun.test.js` (E2E) + feel-signoff | Node Palette 分类、画布渲染 |
| REQ-FLOW-004 | flow-orchestration / flow | `flowRun.test.js` (E2E) + feel-signoff | Agent 节点暴露 model/systemPrompt |
| REQ-FLOW-005 | flow-orchestration / flow | `flowRun.test.js` (E2E) + feel-signoff | Run 状态切换、Zoom 控制 |
| REQ-FLOW-006 | flow-orchestration / flow | `flow.test.js` | Flow JSON import/export |
| REQ-FLOW-016 | flow-orchestration / flow | `flow.test.js`, `flowEditor.test.cjs` (E2E) | 默认 draft、发布快照、草稿编辑不影响 published snapshot、定时只触发 published |
| REQ-FLOW-017 | flow-orchestration / flow | `flow.test.js`, `flowEditor.test.cjs` (E2E) | Debug 弹窗/端点、返回结果、不创建 execution 记录 |
| REQ-FLOW-007 | flow-orchestration / flow-engine | `flowEngine.test.js` | Condition true/false 分支、非法表达式 fatal |
| REQ-FLOW-008 | flow-orchestration / flow-engine | `flowEngine.test.js` | ForEach 遍历数组 |
| REQ-FLOW-009 | flow-orchestration / flow-engine | `flowEngine.test.js` | While 循环 |
| REQ-FLOW-010 | flow-orchestration / flow-engine | `flowEngine.test.js` | maxIterations / maxDepth 循环保护 |
| REQ-SCHEDULE-001 | scheduling-execution / task | `task.test.js`, `flowRun.test.js` (E2E) | 手动触发执行、Flow Editor Run 按钮、完成状态 |
| REQ-SCHEDULE-002 | scheduling-execution / schedule | `schedule.test.js` | Schedule 创建/启用停用/cron 描述/必填校验 |
| REQ-SCHEDULE-003 | scheduling-execution / execution | `task.test.js`, `flowRun.test.js` (E2E) | 执行历史倒序、Logs/Variables/Output、分支路径/迭代 |
| REQ-SKILL-001 | skill-management / skill-repo | `skill.test.js`, `skillInstall.test.cjs` (E2E) | Skill repo 分组列表、保留嵌套路径、无 Linked Projects |
| REQ-SKILL-002 | skill-management / skill | `skill.test.js`, `skillInstall.test.cjs` (E2E) + feel-signoff | Skill Detail Overview/Parameters/Examples/README、返回 repoId、无项目链接 |
| REQ-SKILL-003 | skill-management / skill-repo | `skill.test.js`, `skillInstall.test.cjs` (E2E) | npm 真实安装到 `skillRepoPath`；弹层实时展示命令日志；失败保留日志且不创建记录；递归扫描 `skills/` 下 SKILL.md；不再支持 local |
| REQ-SKILL-004 | skill-management / skill-repo | `skill.test.js`, `skillInstall.test.cjs` (E2E) | 删除 repo 物理目录、级联 skills/project_skills、删除前清理项目软连接、404、无单 skill 删除 |
| REQ-DASH-001 | information-aggregation / dashboard | `dashboard.test.js`, `dashboard.test.js` (E2E) + feel-signoff | 指标卡片、最近执行、快捷项目入口 |
| REQ-I18N-001 | internationalization-theme / theme | `theme.test.js`, `themeLanguage.test.js` (E2E) + feel-signoff | dark/light 切换与持久化 |
| REQ-I18N-002 | internationalization-theme / language | `language.test.js`, `themeLanguage.test.js` (E2E) | 语言偏好持久化（zh-CN / en-US），默认 en-US |
| REQ-CLI-001 | command-interface / cli | `cli.test.js` | CLI 入口、`--help`、`--pretty`、退出码 |

### Capability / Entity 覆盖摘要

| Capability | Entities | 测试数 |
|---|---|---|
| workspace-management | settings, project | 19 |
| flow-orchestration | flow, flow-engine | 19 |
| scheduling-execution | task, schedule, execution | 12 |
| skill-management | skill-repo, skill | 10 |
| information-aggregation | dashboard | 5 |
| internationalization-theme | language, theme | 6 |
| command-interface | cli | 3 |

### 当前测试运行状态

- **当前状态**：BUG-016/017 已修复，skill repo 删除时项目软连接清理已实现；88 个 API/CLI 单元测试 + 43 个 E2E 测试全绿；等待 feel-signoff。

---

## Feel Signoff

> 待 BUILD 与 QA 完成后，依据 `.aiassist/stories/codex-harness-desktop/ux/*.html` 与已实现产品进行观感签核。

- [ ] 产品在目标环境启动无崩溃。
- [ ] 关键用户流程可走完。
- [ ] `preview.html` 已生成且能正常渲染。
- [ ] `_d_meta.json` 中所有 asset 状态已确认（needs-review → approved/changes-requested）。
- [ ] 视觉层面对照 HTML UX 参照：结构、元素顺序、颜色、排版、间距、动效。
- [ ] 无系统错误弹窗 / 空白页。
- [ ] 降级/错误状态表达温和、不焦虑。
- [ ] implementer 报告的偏差已被确认。
