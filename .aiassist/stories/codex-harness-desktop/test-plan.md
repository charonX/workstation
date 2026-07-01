# Test Plan: OPC Workstation Desktop App

> 由 crystallize 阶段生成。每个测试用例反向挂到 REQ-ID，测试作者据此实现前置验收测试。

---

## 验收维度

1. **行为正确性**：PRD/REQ 中定义的用户可观察行为。
2. **状态一致性**：数据变更后 UI 各位置同步刷新。
3. **边界与错误**：空值、无效输入、空状态。
4. **主题与观感**：dark/light 主题覆盖全部页面与弹层。

---

## 测试用例

| ID | 目标 | 挂接 REQ | 测试类型 | 验证要点 |
|---|---|---|---|---|
| TP-001 | Workspace 根目录配置 | REQ-001 | E2E / 集成 | 修改路径 → Save → 重启后路径保持；空路径给出反馈。 |
| TP-002 | Skill 仓库位置配置 | REQ-002 | E2E / 集成 | 修改 Skill 仓库路径 → Save → 重启后保持；Skills 列表反映新仓库。 |
| TP-003 | 添加本地项目 | REQ-003 | E2E | 打开 Add Project → 填本地信息 → 提交 → Workspace 列表出现新项目。 |
| TP-004 | 本地项目必填校验 | REQ-003 | 单元 / E2E | Project Name 为空时提交按钮禁用或提交失败。 |
| TP-005 | 从 Git 检出项目 | REQ-004 | E2E / 集成 | 切换到 Git → 填 URL、分支 → 提交 → 项目出现在列表且 sourceType=git。 |
| TP-006 | Git 项目必填校验 | REQ-004 | 单元 / E2E | Repository URL 为空时不能提交。 |
| TP-007 | 项目列表与搜索过滤 | REQ-005 | E2E | 输入关键词后只显示匹配项目；无匹配显示空状态。 |
| TP-008 | Flows 列表展示 | REQ-006 | E2E | Flows 页面显示卡片，包含项目、节点数、定时状态、更新时间。 |
| TP-009 | Flows 列表进入编辑器 | REQ-006 | E2E | 点击 Edit Flow 进入编辑器，显示返回列表入口。 |
| TP-010 | 创建新流程 | REQ-007 | E2E | 打开 New Flow → 填写 → 提交 → 列表新增流程，节点数为 0。 |
| TP-011 | 创建新流程校验 | REQ-007 | 单元 / E2E | Flow Name 为空或 Project 未选时不能提交。 |
| TP-012 | 流程编辑器画布渲染 | REQ-008 | E2E | 编辑器渲染 Node Palette、节点、连线；点击节点显示属性。 |
| TP-013 | 节点属性面板 | REQ-009 | E2E | 未选中显示占位；选中 Agent 节点显示 Model + System Prompt 字段。 |
| TP-014 | 编辑器运行与视图控制 | REQ-010 | E2E | Run 按钮状态变化；Schedule 开关切换；Zoom 控件工作。 |
| TP-015 | 手动创建任务 | REQ-011 | E2E | New Task → 选 Project/Flow → 提交 → Run History 新增 running 记录，随后 success。 |
| TP-016 | 手动任务必填校验 | REQ-011 | 单元 / E2E | Project 未选时不能提交。 |
| TP-017 | 创建定时任务 | REQ-012 | E2E | New Schedule → 选 Project/Flow + cron → 提交 → Schedules 列表新增。 |
| TP-018 | Schedule 启用/停用 | REQ-012 | E2E | 点击 Schedule 开关 → 列表状态即时更新。 |
| TP-019 | 任务执行详情 | REQ-013 | E2E | 点击历史记录 → 右侧显示 Logs / Variables / Output Tab 并可切换。 |
| TP-020 | Skills 列表展示 | REQ-014 | E2E | Skills 表格显示名称、路径、链接项目数。 |
| TP-021 | Skill 项目链接 | REQ-015 | E2E | 打开 Skill Detail → 勾选/取消项目 → 列表 Linked Projects 同步。 |
| TP-022 | 主题切换 | REQ-016 | E2E | 点击主题按钮 → 应用切换主题 → 弹层与表格颜色同步变化。 |

---

## 自动化策略

- **单元测试**：校验函数级逻辑（过滤、校验、cron 解析、状态更新）。
- **集成测试**：Settings 持久化、ProjectService 本地/Git 操作、ScheduleService 触发逻辑。
- **E2E 测试**：基于浏览器/App 模拟，覆盖完整用户路径（创建项目 → 创建 flow → 手动触发 → 查看详情 → 创建 schedule）。
- **视觉回归（可选）**：以 HTML 原型为视觉参照，对关键页面做快照对比。

---

## 环境要求

- Node.js 运行单元测试与集成测试。
- 浏览器环境（Playwright / Puppeteer）运行 E2E。
- 临时文件系统用于 ProjectService 本地/Git 操作测试。
- SQLite 用于 LogService / Execution 持久化集成测试。
