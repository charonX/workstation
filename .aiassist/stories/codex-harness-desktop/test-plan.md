# Test Plan: OPC Workstation Desktop App

> 由 loop-workflow `/test-author` 阶段根据 `requirements.md`、`tech-design.md`、`business-capabilities.md`、`CONTEXT.md` 生成。测试按 **capability → entity → story** 组织。

---

## REQ 版本

- `requirements-v1.hash`: `2c79015bd970c381f96e90dfa5950a839b3fdf9b90606fadf73c07c381cbaad8`
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

---

## 测试用例

| ID | 目标 | Capability / Entity | 挂接 REQ | 测试文件 / 方法 | Seam 类型 | 验证要点 |
|---|---|---|---|---|---|---|
| TP-001 | Workspace 根目录配置 | workspace-management / settings | REQ-001 | `settings.test.js` — persists workspace root directory | API / 集成 | 修改路径 → Save → 重启后路径保持。 |
| TP-002 | Workspace 根目录空值校验 | workspace-management / settings | REQ-001 | `settings.test.js` — rejects empty workspace root | API | 路径为空时抛出错误。 |
| TP-003 | Skill 仓库位置配置 | workspace-management / settings | REQ-002 | `settings.test.js` — persists skill repository path | API / 集成 | 修改 Skill 仓库路径 → Save → 重启后保持。 |
| TP-004 | 显示密度配置 | workspace-management / settings | REQ-025 | `settings.test.js` — persists density preference / density has a default value | API / 集成 | Density 选项 Compact / Comfortable 持久化，且有默认值。 |
| TP-005 | 语言偏好持久化 | internationalization-theme / language | REQ-024 | `language.test.js` — persists language preference / default language is English | API / 集成 | 中/英文切换持久化，默认语言为英文。 |
| TP-006 | 主题切换 | internationalization-theme / theme | REQ-016 | `theme.test.js` — toggles from dark to light / applyTheme | API | dark/light 切换与 DOM 属性设置。 |
| TP-007 | 添加本地项目 | workspace-management / project | REQ-003 | `project.test.js` — creates a local project | API | 创建后项目出现在列表中，sourceType=local。 |
| TP-008 | 本地项目必填校验 | workspace-management / project | REQ-003 | `project.test.js` — rejects local project without name | API | Project Name 为空时抛出错误。 |
| TP-009 | 从 Git 检出项目 | workspace-management / project | REQ-004 | `project.test.js` — creates a project from git checkout | API / 集成 | sourceType=git，记录 repoUrl、branch，默认 main。 |
| TP-010 | Git 项目必填校验 | workspace-management / project | REQ-004 | `project.test.js` — rejects git project without repository URL | API | Repository URL 为空时抛出错误。 |
| TP-011 | 项目列表与搜索过滤 | workspace-management / project | REQ-005 | `project.test.js` — filters projects by name case-insensitively / returns all when empty | API | 按名称过滤，大小写不敏感；空过滤返回全部。 |
| TP-012 | Project 详情 Overview | workspace-management / project | REQ-021 | `project.test.js` — project detail exposes overview metadata | API | Project Detail Modal 的 Overview Tab 展示名称、路径、flows/runs 数、更新时间。 |
| TP-013 | Project 详情 Skills Tab | workspace-management / project | REQ-021 | `project.test.js` — skills tab lists available skills and linked state | API | Skills Tab 列出可用 skills，勾选/取消勾选关联当前项目。 |
| TP-014 | Skill 关联幂等性 | workspace-management / project | REQ-021 | `project.test.js` — toggling skill association is idempotent | API | 重复关联同一 skill 不重复记录。 |
| TP-015 | Flows 列表展示 | flow-orchestration / flow | REQ-006 | `flow.test.js` — lists flows with project, node count and schedule status | API | 列表包含项目、节点数、scheduleEnabled。 |
| TP-016 | Flows 列表进入编辑器 | flow-orchestration / flow | REQ-006 | `flow.test.js` — each flow has an edit entry point | API | 可通过 flow id 获取详情。 |
| TP-017 | 创建新流程 | flow-orchestration / flow | REQ-007 | `flow.test.js` — creates a new flow | API | 创建后 nodes=0，scheduleEnabled=false。 |
| TP-018 | 创建新流程校验 | flow-orchestration / flow | REQ-007 | `flow.test.js` — rejects flow without name / project | API | 缺少 name 或 project 时抛出错误。 |
| TP-019 | 流程编辑器画布 | flow-orchestration / flow | REQ-008 | `flow.test.js` — flow editor exposes a palette of node categories | API | Node Palette 分类正确。 |
| TP-020 | 节点属性面板 | flow-orchestration / flow | REQ-009 | `flow.test.js` — selected node exposes editable properties | API | Agent 节点暴露 Model / System Prompt。 |
| TP-021 | 编辑器运行与视图控制 | flow-orchestration / flow | REQ-010 | `flow.test.js` — run control toggles running state / zoom control | API | Run、Schedule、Zoom 行为正确。 |
| TP-022 | Condition 节点 true 分支 | flow-orchestration / flow-engine | REQ-017 | `flowEngine.test.js` — condition node routes to true branch | API | 表达式为真时走 true 分支。 |
| TP-023 | Condition 节点 false 分支 | flow-orchestration / flow-engine | REQ-017 | `flowEngine.test.js` — condition node routes to false branch when expression is falsy | API | 表达式为假时走 false 分支。 |
| TP-024 | Condition 表达式非法 | flow-orchestration / flow-engine | REQ-017 | `flowEngine.test.js` — invalid condition expression returns fatal | API | 表达式语法错误时 fatal，Execution 失败。 |
| TP-025 | ForEach 循环 | flow-orchestration / flow-engine | REQ-018 | `flowEngine.test.js` — forEach iterates over array | API | 遍历数组并执行 body 子图。 |
| TP-026 | While 循环 | flow-orchestration / flow-engine | REQ-019 | `flowEngine.test.js` — while loop repeats while expression is true | API | 表达式为真时重复执行 body。 |
| TP-027 | 循环保护 | flow-orchestration / flow-engine | REQ-020 | `flowEngine.test.js` — maxIterations / maxDepth prevent infinite loops | API | 超过 maxIterations / maxDepth 时 Execution 失败。 |
| TP-028 | 手动创建任务 | scheduling-execution / task | REQ-011 | `task.test.js` — creates a manual task and starts running | API | 创建后生成 running 执行记录。 |
| TP-029 | 手动任务必填校验 | scheduling-execution / task | REQ-011 | `task.test.js` — rejects task without project | API | Project 未选时抛出错误。 |
| TP-030 | 手动任务 Trigger 选项 | scheduling-execution / task | REQ-011 | `task.test.js` — manual task accepts trigger option | API | 支持 manual / schedule trigger 选项。 |
| TP-031 | 手动任务完成状态 | scheduling-execution / task | REQ-011 | `task.test.js` — completed execution shows duration and node count | API | 运行完成后状态 success，显示 duration、nodesRun。 |
| TP-032 | 执行历史排序 | scheduling-execution / task | REQ-013 | `task.test.js` — execution history is ordered newest first | API | 历史按时间倒序排列。 |
| TP-033 | 执行详情 Tab | scheduling-execution / task | REQ-013 | `task.test.js` — execution detail exposes logs, variables and output tabs | API | 详情有 Logs / Variables / Output 三个 Tab，默认 Logs。 |
| TP-034 | 分支路径与循环迭代 | scheduling-execution / task | REQ-013 | `task.test.js` — execution records branch path and iteration info | API | Execution 记录分支路径和循环迭代信息。 |
| TP-035 | Logs Tab 内容 | scheduling-execution / task | REQ-013 | `task.test.js` — logs tab shows execution log entries | API | Logs Tab 显示按节点记录的日志。 |
| TP-036 | Variables Tab 内容 | scheduling-execution / task | REQ-013 | `task.test.js` — variables tab shows execution variables | API | Variables Tab 显示执行变量键值。 |
| TP-037 | Output Tab 内容 | scheduling-execution / task | REQ-013 | `task.test.js` — output tab shows final output | API | Output Tab 显示最终输出 JSON。 |
| TP-038 | 创建定时任务 | scheduling-execution / schedule | REQ-012 | `schedule.test.js` — creates a schedule | API | 创建后出现在 Schedules 列表，enabled=true。 |
| TP-039 | Schedule 必填校验 | scheduling-execution / schedule | REQ-012 | `schedule.test.js` — rejects schedule without cron | API | Cron 为空时抛出错误。 |
| TP-040 | Schedule 启用/停用 | scheduling-execution / schedule | REQ-012 | `schedule.test.js` — toggles schedule enabled state | API | toggle 后状态同步。 |
| TP-041 | Schedules 列表字段 | scheduling-execution / schedule | REQ-012 | `schedule.test.js` — schedule list shows project, cron and enabled state | API | 列表显示 project、cron、enabled。 |
| TP-042 | Cron 人类可读描述 | scheduling-execution / schedule | REQ-012 | `schedule.test.js` — schedule shows a human-readable cron description | API | 根据 cron 表达式生成人类可读描述。 |
| TP-043 | Skills 列表 | skill-management / skill | REQ-014 | `skill.test.js` — lists skills without linked projects column | API | 表格列包含 Skill、Repo Path、Version、Category，无 Linked Projects。 |
| TP-044 | Skill 行详情入口 | skill-management / skill | REQ-014 | `skill.test.js` — skill row exposes a detail entry point | API | 每行有 skill id，可打开详情。 |
| TP-045 | Skill 详情 Overview | skill-management / skill | REQ-015 | `skill.test.js` — skill detail exposes overview metadata | API | Overview Tab 展示描述、作者、标签等。 |
| TP-046 | Skill 详情 Tab | skill-management / skill | REQ-015 | `skill.test.js` — skill detail provides Overview / Parameters / Examples / README tabs | API | 详情弹层四个 Tab 存在。 |
| TP-047 | Skill 详情无项目链接 | skill-management / skill | REQ-015 | `skill.test.js` — skill detail does not expose project link controls | API | Skill 详情不提供 link/unlink 项目入口。 |
| TP-048 | npm/npx 安装 Skill | skill-management / skill | REQ-022 | `skill.test.js` — supports npm/npx skill install | API | npm/npx 来源安装后出现在 Skills 列表。 |
| TP-049 | Claude Plugin 安装 Skill | skill-management / skill | REQ-022 | `skill.test.js` — supports Claude Plugin skill install | API | Plugin 来源安装。 |
| TP-050 | Local Files 安装 Skill | skill-management / skill | REQ-022 | `skill.test.js` — supports Local Files skill install | API | 本地目录来源安装。 |
| TP-051 | Dashboard 关键指标 | information-aggregation / dashboard | REQ-023 | `dashboard.test.js` — exposes key metric cards | API / 聚合 | 返回项目数、活跃调度数、最近运行次数、成功率。 |
| TP-052 | Dashboard 最近执行 | information-aggregation / dashboard | REQ-023 | `dashboard.test.js` — lists recent executions with flow, project, status and time | API / 聚合 | 最近执行列表包含流程、项目、状态、时间。 |
| TP-053 | Dashboard 快捷入口 | information-aggregation / dashboard | REQ-023 | `dashboard.test.js` — provides quick project links | API / 聚合 | 提供项目快捷入口。 |

---

## HTML UX 原型映射

以下可验证项来自 `ux/workspace.html` 与 `ux/workspace-home.html` 的高保真原型，已反向映射到 REQ-ID：

- **Project Detail Modal（REQ-021）**：项目卡片提供 "Configure Skills" 入口；弹层含 Overview / Skills 两个 Tab；Skills Tab 为 skill 列表 + checkbox。
- **Skill 列表/详情（REQ-014 / REQ-015）**：Skills 页面表格无 "Linked Projects" 列；详情弹层为 Tab 切换 Overview / Parameters / Examples / README。
- **Add Skill 弹层（REQ-022）**：来源选择 npm/npx、Claude Plugin、Local Files，对应字段不同。
- **Dashboard（REQ-023）**：指标卡片、最近执行列表、快捷项目入口。
- **顶部栏（REQ-016 / REQ-024）**：主题切换按钮、语言切换按钮 EN/中。
- **Settings（REQ-001 / REQ-002 / REQ-025）**：Workspace Root、Skill Repository Path、Density 选项。
- **Tasks 页面（REQ-011 / REQ-012 / REQ-013）**：左侧 Tasks / Executions 两个 Tab；New Task / New Schedule 弹层；右侧 Logs / Variables / Output 详情 Tab。

---

## 自动化策略

- **API / 服务层测试**：`node --test tests/**/*.test.js`。覆盖过滤、校验、状态更新、Skill-Project 关联、Settings 持久化、FlowEngine 执行逻辑、Dashboard 数据聚合等纯逻辑。
- **集成测试**：Settings 持久化文件、ProjectService 与 SkillService 的 SQLite 关联、TaskService / ScheduleService 的触发与执行记录。
- **E2E 测试（待实现层提供 DOM/浏览器驱动后补充）**：
  - 路径 A：创建项目 → 配置 Skills → 创建 flow → 手动触发 → 查看 Logs/Variables/Output。
  - 路径 B：创建 schedule → 切换启用/停用 → 验证自动触发 → 查看 Dashboard 指标。
  - 路径 C：切换主题 / 语言 / 密度 → 验证全页面同步变化。
- **视觉回归（可选）**：以 HTML 原型为视觉参照，对关键页面做快照对比，走 `/signoff --stage=feel`。

---

## 环境要求

- Node.js 运行 API / 单元测试与集成测试。
- 浏览器环境（Playwright / Puppeteer）运行 E2E。
- 临时文件系统用于 ProjectService 本地/Git 操作测试。
- SQLite 用于服务层持久化测试。

---

## 当前运行状态

- 测试已按 loop-workflow 结构迁移到 `tests/capabilities/...`。
- `npm test`：**62 tests / 62 passed / 0 failed**。
- 无 `// TODO: HUMAN ASSERTION` 占位。
- 旧的 `tests/*.test.js` 已删除。
