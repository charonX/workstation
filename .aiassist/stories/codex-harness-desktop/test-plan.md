# Test Plan: OPC Workstation Desktop App

> 由 loop-workflow `/test-author` 阶段根据 `requirements.md`、`tech-design.md`、`business-capabilities.md`、`CONTEXT.md` 生成。测试按 **capability → entity** 组织。

---

## REQ 版本

- `requirements-v1.hash`: `71624856165d7ccd8e88041a8f92ec3a2c552457e9e514f29ef3eb747ccf1685`
- 断言签字状态：`ASSERTIONS-SIGNED: false`（新结构测试文件等待 assertion-signoff 签核）

---

## Capability / Entity 映射

| Capability | Entity | 测试目录 |
|---|---|---|
| workspace-management | settings | `tests/capabilities/workspace-management/settings/codex-harness-desktop/api/` |
| workspace-management | project | `tests/capabilities/workspace-management/project/codex-harness-desktop/api/` |
| flow-orchestration | flow | `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/api/` |
| flow-orchestration | flow-engine | `tests/capabilities/flow-orchestration/flow-engine/codex-harness-desktop/api/` |
| scheduling-execution | task | `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/` |
| scheduling-execution | schedule | `tests/capabilities/scheduling-execution/schedule/codex-harness-desktop/api/` |
| skill-management | skill | `tests/capabilities/skill-management/skill/codex-harness-desktop/api/` |
| information-aggregation | dashboard | `tests/capabilities/information-aggregation/dashboard/codex-harness-desktop/api/` |
| internationalization-theme | language | `tests/capabilities/internationalization-theme/language/codex-harness-desktop/api/` |
| internationalization-theme | theme | `tests/capabilities/internationalization-theme/theme/codex-harness-desktop/api/` |
| command-interface | cli | `tests/capabilities/command-interface/cli/codex-harness-desktop/cli/` |

---

## 测试用例

| ID | 目标 | Capability / Entity | 挂接 REQ | 测试文件 / 方法 | Seam 类型 | 验证要点 |
|---|---|---|---|---|---|---|
| TP-001 | Workspace 根目录配置 | workspace-management / settings | REQ-WORKSPACE-001 | `settings.test.js` — persists workspace root directory | API / CLI | 修改路径 → Save → 重启后路径保持。 |
| TP-002 | Workspace 根目录空值校验 | workspace-management / settings | REQ-WORKSPACE-001 | `settings.test.js` — rejects empty workspace root | API / CLI | 路径为空时抛出错误。 |
| TP-003 | Skill 仓库位置配置 | workspace-management / settings | REQ-WORKSPACE-002 | `settings.test.js` — persists skill repository path | API / CLI | 修改 Skill 仓库路径 → Save → 重启后保持。 |
| TP-004 | 显示密度配置 | workspace-management / settings | REQ-WORKSPACE-007 | `settings.test.js` — density has a default value / persists density preference | API / CLI | Density 默认 `comfortable`，可切换 `compact`。 |
| TP-005 | 语言偏好持久化 | internationalization-theme / language | REQ-I18N-002 | `language.test.js` — default language is English / persists language preference | API / CLI | 中/英文切换持久化，默认 `en-US`。 |
| TP-006 | 主题切换 | internationalization-theme / theme | REQ-I18N-001 | `theme.test.js` — toggles theme via settings API / CLI sets theme | API / CLI | dark/light 切换持久化。 |
| TP-007 | 添加本地项目 | workspace-management / project | REQ-WORKSPACE-003 | `project.test.js` — creates a local project | API / CLI | 创建后项目出现在列表中，sourceType=local。 |
| TP-008 | 本地项目必填校验 | workspace-management / project | REQ-WORKSPACE-003 | `project.test.js` — rejects local project without name | API / CLI | Project Name 为空时抛出错误。 |
| TP-009 | 从 Git 检出项目 | workspace-management / project | REQ-WORKSPACE-004 | `project.test.js` — creates a project from git checkout | API / CLI | sourceType=git，记录 repoUrl、branch，默认 main。 |
| TP-010 | Git 项目必填校验 | workspace-management / project | REQ-WORKSPACE-004 | `project.test.js` — rejects git project without repository URL | API / CLI | Repository URL 为空时抛出错误。 |
| TP-011 | 项目列表与搜索过滤 | workspace-management / project | REQ-WORKSPACE-005 | `project.test.js` — filters projects by name case-insensitively / returns all when empty | API / CLI | 按名称过滤，大小写不敏感；空过滤返回全部。 |
| TP-012 | Project 详情 Overview | workspace-management / project | REQ-WORKSPACE-006 | `project.test.js` — project detail exposes overview metadata | API | Overview Tab 展示名称、flows/runs 数。 |
| TP-013 | Project 详情 Skills Tab | workspace-management / project | REQ-WORKSPACE-006 | `project.test.js` — toggling skill association is idempotent | API | Skills Tab 关联幂等。 |
| TP-014 | Flows 列表展示 | flow-orchestration / flow | REQ-FLOW-001 | `flow.test.js` — lists flows with project, node count and schedule status | API / CLI | 列表包含项目、节点数、scheduleEnabled。 |
| TP-015 | 创建新流程 | flow-orchestration / flow | REQ-FLOW-002 | `flow.test.js` — creates a new flow | API / CLI | 创建后 nodes=0，scheduleEnabled=false。 |
| TP-016 | 创建新流程校验 | flow-orchestration / flow | REQ-FLOW-002 | `flow.test.js` — rejects flow without name / project | API / CLI | 缺少 name 或 project 时抛出错误。 |
| TP-017 | 流程 JSON 导入导出 | flow-orchestration / flow | REQ-FLOW-006 | `flow.test.js` — exports/imports flow JSON | API / CLI | JSON 包含 nodes/edges；导入后重建 flow。 |
| TP-018 | Condition 节点 true 分支 | flow-orchestration / flow-engine | REQ-FLOW-007 | `flowEngine.test.js` — condition node routes to true branch | 单元 / API | 表达式为真时走 true 分支。 |
| TP-019 | Condition 节点 false 分支 | flow-orchestration / flow-engine | REQ-FLOW-007 | `flowEngine.test.js` — condition node routes to false branch when expression is falsy | 单元 / API | 表达式为假时走 false 分支。 |
| TP-020 | Condition 表达式非法 | flow-orchestration / flow-engine | REQ-FLOW-007 | `flowEngine.test.js` — invalid condition expression returns fatal | 单元 / API | 表达式语法错误时 fatal，Execution 失败。 |
| TP-021 | ForEach 循环 | flow-orchestration / flow-engine | REQ-FLOW-008 | `flowEngine.test.js` — forEach iterates over array | 单元 / API | 遍历数组并执行 body 子图。 |
| TP-022 | While 循环 | flow-orchestration / flow-engine | REQ-FLOW-009 | `flowEngine.test.js` — while loop repeats while expression is true | 单元 / API | 表达式为真时重复执行 body。 |
| TP-023 | 循环保护 | flow-orchestration / flow-engine | REQ-FLOW-010 | `flowEngine.test.js` — maxIterations / maxDepth prevent infinite loops | 单元 / API | 超过 maxIterations / maxDepth 时 Execution 失败。 |
| TP-024 | 手动创建任务 | scheduling-execution / task | REQ-SCHEDULE-001 | `task.test.js` — creates a manual task and starts running | API / CLI | 创建后生成 running 执行记录。 |
| TP-025 | 手动任务必填校验 | scheduling-execution / task | REQ-SCHEDULE-001 | `task.test.js` — rejects task without project | API / CLI | Project 未选时抛出错误。 |
| TP-026 | 执行历史排序 | scheduling-execution / task | REQ-SCHEDULE-003 | `task.test.js` — execution history is ordered newest first | API | 历史按时间倒序排列。 |
| TP-027 | 执行详情 Tab | scheduling-execution / task | REQ-SCHEDULE-003 | `task.test.js` — execution detail exposes logs, variables and output tabs | API | 详情有 Logs / Variables / Output。 |
| TP-028 | 分支路径与循环迭代 | scheduling-execution / task | REQ-SCHEDULE-003 | `task.test.js` — execution records branch path and iteration info | API | Execution 记录分支路径和循环迭代信息。 |
| TP-029 | 创建定时任务 | scheduling-execution / schedule | REQ-SCHEDULE-002 | `schedule.test.js` — creates a schedule | API / CLI | 创建后 enabled=true。 |
| TP-030 | Schedule 必填校验 | scheduling-execution / schedule | REQ-SCHEDULE-002 | `schedule.test.js` — rejects schedule without cron | API / CLI | Cron 为空时抛出错误。 |
| TP-031 | Schedule 启用/停用 | scheduling-execution / schedule | REQ-SCHEDULE-002 | `schedule.test.js` — toggles schedule enabled state | API / CLI | toggle 后状态同步。 |
| TP-032 | Schedules 列表字段 | scheduling-execution / schedule | REQ-SCHEDULE-002 | `schedule.test.js` — schedule list shows project, cron and enabled state | API / CLI | 列表显示 project、cron、enabled。 |
| TP-033 | Skills 列表 | skill-management / skill | REQ-SKILL-001 | `skill.test.js` — lists skills without linked projects column | API / CLI | 表格列包含 Skill、Repo Path、Version、Category，无 Linked Projects。 |
| TP-034 | Skill 行详情入口 | skill-management / skill | REQ-SKILL-001 | `skill.test.js` — skill row exposes a detail entry point | API | 每行有 skill id。 |
| TP-035 | Skill 详情 Overview | skill-management / skill | REQ-SKILL-002 | `skill.test.js` — skill detail exposes overview metadata | API | Overview Tab 展示描述、作者、标签等。 |
| TP-036 | Skill 详情 Tab | skill-management / skill | REQ-SKILL-002 | `skill.test.js` — skill detail provides Overview / Parameters / Examples / README tabs | API | 详情弹层四个 Tab 存在。 |
| TP-037 | Skill 详情无项目链接 | skill-management / skill | REQ-SKILL-002 | `skill.test.js` — skill detail does not expose project link controls | API | Skill 详情不提供 link/unlink 项目入口。 |
| TP-038 | npm/npx 安装 Skill | skill-management / skill | REQ-SKILL-003 | `skill.test.js` — supports npm skill install | API / CLI | npm/npx 来源安装后出现在 Skills 列表。 |
| TP-039 | Claude Plugin 安装 Skill | skill-management / skill | REQ-SKILL-003 | `skill.test.js` — supports Claude Plugin skill install | API / CLI | Plugin 来源安装。 |
| TP-040 | Local Files 安装 Skill | skill-management / skill | REQ-SKILL-003 | `skill.test.js` — supports Local Files skill install | API / CLI | 本地目录来源安装。 |
| TP-041 | Dashboard 关键指标 | information-aggregation / dashboard | REQ-DASH-001 | `dashboard.test.js` — exposes key metric cards | API / CLI | 返回项目数、活跃调度数、最近运行次数、成功率。 |
| TP-042 | Dashboard 最近执行 | information-aggregation / dashboard | REQ-DASH-001 | `dashboard.test.js` — lists recent executions with flow, project, status and time | API / CLI | 最近执行列表包含流程、项目、状态、时间。 |
| TP-043 | Dashboard 快捷入口 | information-aggregation / dashboard | REQ-DASH-001 | `dashboard.test.js` — provides quick project links | API / CLI | 提供项目快捷入口。 |
| TP-044 | CLI 帮助与命令结构 | command-interface / cli | REQ-CLI-001 | `cli.test.js` — --help shows usage and entities | CLI | 显示 usage 与实体列表。 |
| TP-045 | CLI pretty JSON | command-interface / cli | REQ-CLI-001 | `cli.test.js` — global --pretty outputs pretty JSON | CLI | 美化 JSON 输出。 |
| TP-046 | CLI 退出码 | command-interface / cli | REQ-CLI-001 | `cli.test.js` — unimplemented command exits with code 1 | CLI | 未实现命令返回退出码 1。 |

---

## HTML UX 原型映射

以下可验证项来自 `ux/` 的高保真原型，已反向映射到 REQ-ID，由 `/signoff --stage=feel` 验收：

- **Project Detail Modal（REQ-WORKSPACE-006）**：项目卡片提供 "Configure Skills" 入口；弹层含 Overview / Skills 两个 Tab；Skills Tab 为 skill 列表 + checkbox。
- **Skill 列表/详情（REQ-SKILL-001 / REQ-SKILL-002）**：Skills 页面表格无 "Linked Projects" 列；详情弹层为 Tab 切换 Overview / Parameters / Examples / README。
- **Add Skill 弹层（REQ-SKILL-003）**：来源选择 npm/npx、Claude Plugin、Local Files，对应字段不同。
- **Dashboard（REQ-DASH-001）**：指标卡片、最近执行列表、快捷项目入口。
- **顶部栏（REQ-I18N-001 / REQ-I18N-002）**：主题切换按钮、语言切换按钮 EN/中。
- **Settings（REQ-WORKSPACE-001 / REQ-WORKSPACE-002 / REQ-WORKSPACE-007）**：Workspace Root、Skill Repository Path、Density 选项。
- **Tasks 页面（REQ-SCHEDULE-001 / REQ-SCHEDULE-002 / REQ-SCHEDULE-003）**：左侧 Tasks / Executions 两个 Tab；New Task / New Schedule 弹层；右侧 Logs / Variables / Output 详情 Tab。
- **Flow Editor（REQ-FLOW-003 / REQ-FLOW-004 / REQ-FLOW-005）**：Node Palette、画布、Properties 面板、Run / Schedule / Zoom 控制。

---

## 自动化策略

- **CLI 测试**：直接调用 `node src/cli/opc-workstation.js`，断言 stdout/stderr/exit code。
- **HTTP API 测试**：在测试中启动 `src/http/server.js` 的 stub server，使用 `fetch` 调用 REST 端点。
- **服务单元测试**：针对 `src/flowEngine/flowEngine.js` 的纯函数执行逻辑。
- **浏览器 E2E**：本轮不引入；前端观感走 `/signoff --stage=feel`。

---

## 当前运行状态

- 测试已按 loop-workflow 能力/实体结构生成到 `tests/capabilities/...`。
- 当前实现为 stub，预计 `npm test` 全部失败（红色契约），等待 assertion-signoff 后由 implementer 变绿。
- 无 `// TODO: HUMAN ASSERTION` 占位；断言值来自 PRD/REQ 明确约定。
