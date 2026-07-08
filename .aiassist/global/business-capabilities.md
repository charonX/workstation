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
| settings | `tests/capabilities/workspace-management/settings/codex-harness-desktop/api/` | REQ-WORKSPACE-001, REQ-WORKSPACE-002, REQ-WORKSPACE-007 | `settings.test.js` |
| project | `tests/capabilities/workspace-management/project/codex-harness-desktop/api/` | REQ-WORKSPACE-003~006 | `project.test.js` |

### flow-orchestration
> 设计、保存、执行流程图，支持条件分支与循环。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| flow | `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/api/` | REQ-FLOW-001~006 | `flow.test.js` |
| flow-engine | `tests/capabilities/flow-orchestration/flow-engine/codex-harness-desktop/api/` | REQ-FLOW-007~010 | `flowEngine.test.js` |

### scheduling-execution
> 手动触发、定时触发、查看执行历史与详情。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| task | `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/` | REQ-SCHEDULE-001, REQ-SCHEDULE-003 | `task.test.js` |
| schedule | `tests/capabilities/scheduling-execution/schedule/codex-harness-desktop/api/` | REQ-SCHEDULE-002 | `schedule.test.js` |

### skill-management
> 集中式 skill 仓库、多源安装、项目关联。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| skill | `tests/capabilities/skill-management/skill/codex-harness-desktop/api/` | REQ-SKILL-001~003 | `skill.test.js` |

### information-aggregation
> Dashboard 展示关键指标与最近活动。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| dashboard | `tests/capabilities/information-aggregation/dashboard/codex-harness-desktop/api/` | REQ-DASH-001 | `dashboard.test.js` |

### internationalization-theme
> 语言切换、主题切换、显示密度。

| 实体 | 测试目录 | 覆盖的 REQ-ID | 测试文件 |
|------|----------|---------------|----------|
| theme | `tests/capabilities/internationalization-theme/theme/codex-harness-desktop/api/` | REQ-I18N-001 | `theme.test.js` |
| language | `tests/capabilities/internationalization-theme/language/codex-harness-desktop/api/` | REQ-I18N-002 | `language.test.js` |

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
| workspace-management | 2 | 17 | 2026-07-08 |
| flow-orchestration | 2 | 14 | 2026-07-08 |
| scheduling-execution | 2 | 11 | 2026-07-08 |
| skill-management | 1 | 7 | 2026-07-08 |
| information-aggregation | 1 | 4 | 2026-07-08 |
| internationalization-theme | 2 | 5 | 2026-07-08 |
| command-interface | 1 | 3 | 2026-07-08 |
