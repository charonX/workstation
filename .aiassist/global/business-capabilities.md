# 业务能力地图 — OPC Workstation

> 本文件由 `/crystallize` 和 `/reflect` 维护。
> 把测试按业务实体/能力组织，而不是按 story。
> 每个能力下挂测试文件和 REQ-ID。

---

## 能力清单

### workspace-management
> 配置 Workspace 根目录、Skill 仓库位置，管理项目导入与搜索。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| settings | `tests/capabilities/workspace-management/settings/codex-harness-desktop/api/` | REQ-WORKSPACE-001, REQ-WORKSPACE-002, REQ-WORKSPACE-007, REQ-I18N-002 | `settings.test.js`, `themeLanguage.spec.js` (E2E) |
| project | `tests/capabilities/workspace-management/project/codex-harness-desktop/api/` | REQ-WORKSPACE-003~006 | `project.test.js`, `onboarding.spec.js` (E2E) |

### flow-orchestration
> 设计、保存、执行流程图，支持条件分支与循环。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| flow | `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/api/`, `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/`, `tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/e2e/`, `tests/capabilities/flow-orchestration/flow/2026-07-16-flow-refinement/api/` | REQ-FLOW-001~006, REQ-FLOW-011~022, REQ-FLOW-028（调试弹窗） | `flow.test.js`, `flowRun.test.cjs`, `flowEditor.test.cjs`, `triggerConfig.test.cjs`, `conditionConfig.test.cjs`, `agentConfig.test.cjs`, `nodeErrorHandling.test.cjs`, `variablePicker.test.cjs`, `debugModal.test.cjs`, `triggerConfig.test.js`, `conditionConfig.test.js`, `agentConfig.test.js` |
| flow-engine | `tests/capabilities/flow-orchestration/flow-engine/codex-harness-desktop/api/`, `tests/capabilities/flow-orchestration/flow-engine/2026-07-16-flow-refinement/api/` | REQ-FLOW-007~010, REQ-FLOW-023~027 | `flowEngine.test.js`, `variableRegistry.test.js`, `variableSubstitution.test.js`, `errorHandling.test.js`, `danglingReference.test.js`, `projectPathInjection.test.js`, `claudeAgentAdapter.test.js` |
| execution | `tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/api/`, `tests/capabilities/flow-orchestration/execution/2026-07-16-flow-refinement/e2e/` | REQ-FLOW-028 | `executionLog.test.js`, `executionLog.test.cjs` |

### scheduling-execution
> 手动触发、定时触发、查看执行历史与详情。UI 仅保留执行历史页；任务创建 UI 已移除，Task 在 API/CLI 层作为手动触发的别名保留。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| task | `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/` | REQ-SCHEDULE-001 | `task.test.js` |
| schedule | `tests/capabilities/scheduling-execution/schedule/codex-harness-desktop/api/` | REQ-SCHEDULE-002, REQ-SCHEDULE-004 | `schedule.test.js` |
| execution | `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/`, `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/` | REQ-SCHEDULE-001, REQ-SCHEDULE-003 | `task.test.js`, `flowRun.test.js` (E2E) |

### skill-management
> 集中式 skill repo 管理、多源安装、项目关联。skill repo 作为一级实体，一个 repo 可包含多个 skill。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| skill-repo | `tests/capabilities/skill-management/skill/codex-harness-desktop/api/`, `tests/capabilities/skill-management/skill/codex-harness-desktop/e2e/` | REQ-SKILL-001, REQ-SKILL-003, REQ-SKILL-004 | `skill.test.js`, `skillInstall.test.cjs` (E2E) |
| skill | `tests/capabilities/skill-management/skill/codex-harness-desktop/api/`, `tests/capabilities/skill-management/skill/codex-harness-desktop/e2e/` | REQ-SKILL-001, REQ-SKILL-002 | `skill.test.js`, `skillInstall.test.cjs` (E2E) |

### information-aggregation
> Dashboard 展示关键指标与最近活动。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| dashboard | `tests/capabilities/information-aggregation/dashboard/codex-harness-desktop/api/` | REQ-DASH-001 | `dashboard.test.js`, `dashboard.spec.js` (E2E) |

### internationalization-theme
> 语言切换、主题切换、显示密度。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| theme | `tests/capabilities/internationalization-theme/theme/codex-harness-desktop/api/` | REQ-I18N-001 | `theme.test.js`, `themeLanguage.spec.js` (E2E) |
| language | `tests/capabilities/internationalization-theme/language/codex-harness-desktop/api/` | REQ-I18N-002 | `language.test.js`, `themeLanguage.spec.js` (E2E) |

### command-interface
> CLI 产品入口，统一把业务命令映射到本地 HTTP API。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| cli | `tests/capabilities/command-interface/cli/codex-harness-desktop/cli/` | REQ-CLI-001 | `cli.test.js` |

## 能力依赖图

```
command-interface ──> workspace-management ──> flow-orchestration ──> scheduling-execution
                                    │                │
                                    ├─> skill-management ───┘
                                    │
                                    ├─> information-aggregation
                                    │
                                    └─> internationalization-theme
```

## 健康指标

| 能力 | 实体数 | 测试数 | 最后更新 |
|------|--------|--------|----------|
| workspace-management | 2 | 36 | 2026-07-16 |
| flow-orchestration | 3 | 53 | 2026-07-19 |
| scheduling-execution | 3 | 16 | 2026-07-16 |
| skill-management | 2 | 16 | 2026-07-16 |
| information-aggregation | 1 | 7 | 2026-07-16 |
| internationalization-theme | 2 | 13 | 2026-07-16 |
| command-interface | 1 | 3 | 2026-07-16 |
