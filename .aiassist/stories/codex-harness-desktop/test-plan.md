# Test Plan: OPC Workstation Desktop App

> 由 crystallize 阶段生成，由 test-author 阶段实现为可执行测试骨架。每个测试用例反向挂到 REQ-ID。

---

## REQ 版本

- `requirements-v1.hash`: `588f13f5f81efdd54b064c8c8467098f11550d3f3dbe7e1785738c9177d47254`
- 断言签字状态：`ASSERTIONS-SIGNED: false`（等待门 1 人签）

---

## 验收维度

1. **行为正确性**：PRD/REQ 中定义的用户可观察行为。
2. **状态一致性**：数据变更后 UI 各位置同步刷新。
3. **边界与错误**：空值、无效输入、空状态。
4. **主题与观感**：dark/light 主题覆盖全部页面与弹层。

---

## 测试用例

| ID | 目标 | 挂接 REQ | 测试文件 / 方法 | 测试类型 | 验证要点 |
|---|---|---|---|---|---|
| TP-001 | Workspace 根目录配置 | REQ-001 | `tests/settings.test.js` — persists workspace root directory | 集成 | 修改路径 → Save → 重启后路径保持。 |
| TP-002 | Skill 仓库位置配置 | REQ-002 | `tests/settings.test.js` — persists skill repository path | 集成 | 修改 Skill 仓库路径 → Save → 重启后保持。 |
| TP-003 | 添加本地项目 | REQ-003 | `tests/project.test.js` — creates a local project | 单元 | 创建后项目出现在列表中。 |
| TP-004 | 本地项目必填校验 | REQ-003 | `tests/project.test.js` — rejects local project without name | 单元 | Project Name 为空时抛出错误。 |
| TP-005 | 从 Git 检出项目 | REQ-004 | `tests/project.test.js` — creates a project from git checkout | 单元 / 集成 | sourceType=git，记录 repoUrl、branch。 |
| TP-006 | Git 项目必填校验 | REQ-004 | `tests/project.test.js` — rejects git project without repository URL | 单元 | Repository URL 为空时抛出错误。 |
| TP-007 | 项目列表与搜索过滤 | REQ-005 | `tests/project.test.js` — filters projects by name case-insensitively | 单元 | 按名称过滤，大小写不敏感。 |
| TP-008 | Flows 列表展示 | REQ-006 | `tests/flow.test.js` — lists flows with project, node count and schedule status | 单元 | 列表包含项目、节点数、scheduleEnabled。 |
| TP-009 | Flows 列表进入编辑器 | REQ-006 | `tests/flow.test.js` — each flow has an edit entry point | 单元 | 可通过 flow id 获取详情。 |
| TP-010 | 创建新流程 | REQ-007 | `tests/flow.test.js` — creates a new flow | 单元 | 创建后 nodes=0，scheduleEnabled=false。 |
| TP-011 | 创建新流程校验 | REQ-007 | `tests/flow.test.js` — rejects flow without name / project | 单元 | 缺少 name 或 project 时抛出错误。 |
| TP-012 | 流程编辑器画布 | REQ-008 | `tests/flow.test.js` — flow editor exposes a palette of node categories | E2E（当前占位） | Node Palette 分类正确。 |
| TP-013 | 节点属性面板 | REQ-009 | `tests/flow.test.js` — selected node exposes editable properties | E2E（当前占位） | Agent 节点暴露 Model / System Prompt。 |
| TP-014 | 编辑器运行与视图控制 | REQ-010 | `tests/flow.test.js` — run control toggles running state / zoom control | E2E（当前占位） | Run、Schedule、Zoom 行为正确。 |
| TP-015 | 手动创建任务 | REQ-011 | `tests/task.test.js` — creates a manual task and starts running | 单元 | 创建后生成 running 执行记录。 |
| TP-016 | 手动任务必填校验 | REQ-011 | `tests/task.test.js` — rejects task without project | 单元 | Project 未选时抛出错误。 |
| TP-017 | 创建定时任务 | REQ-012 | `tests/task.test.js` — creates a schedule | 单元 | 创建后出现在 Schedules 列表。 |
| TP-018 | Schedule 启用/停用 | REQ-012 | `tests/task.test.js` — toggles schedule enabled state | 单元 | toggle 后状态同步。 |
| TP-019 | 任务执行历史与详情 | REQ-013 | `tests/task.test.js` — execution history ordered newest first / detail tabs | 单元 / E2E | 历史倒序，详情有 Logs/Variables/Output。 |
| TP-020 | Skills 列表 | REQ-014 | `tests/skill.test.js` — lists skills with name, repo path and link status | 单元 | 列表展示名称、路径、链接数。 |
| TP-021 | Skill 详情与项目链接 | REQ-015 | `tests/skill.test.js` — skill detail / link / unlink / idempotent | 单元 | 链接、取消链接、幂等性正确。 |
| TP-022 | 主题切换 | REQ-016 | `tests/theme.test.js` — toggles from dark to light / applyTheme | 单元 / E2E | dark/light 切换正确。 |

---

## 自动化策略

- **单元测试**：`node --test tests/**/*.test.js`。覆盖过滤、校验、状态更新、链接关系等纯逻辑。
- **集成测试**：Settings 持久化、ProjectService 本地/Git 操作、ScheduleService 触发逻辑。
- **E2E 测试**：基于浏览器/App 模拟，覆盖完整用户路径（创建项目 → 创建 flow → 手动触发 → 查看详情 → 创建 schedule）。当前由占位测试标记，待实现层提供 DOM/浏览器驱动后替换。
- **视觉回归（可选）**：以 HTML 原型为视觉参照，对关键页面做快照对比。

---

## 环境要求

- Node.js 运行单元测试与集成测试。
- 浏览器环境（Playwright / Puppeteer）运行 E2E。
- 临时文件系统用于 ProjectService 本地/Git 操作测试。
- SQLite 用于 LogService / Execution 持久化集成测试。
