# Requirements: OPC Workstation Desktop App

> 由 PRD 稳定块结晶而成。每条 REQ 带唯一 ID、验收标准，并反向挂到测试计划。

---

## REQ-001: Workspace 根目录配置

**来源**：PRD §4.10 Settings 与 Workspace 配置、User Story 8

**描述**：用户可以在 Settings 页面配置 Workspace 根目录，应用从该目录加载项目。

**验收标准**：
- [ ] 导航到 Settings 页面可见 "Workspace Root Directory" 输入框，默认显示当前路径。
- [ ] 修改路径后点击 Save，配置被持久化，重新打开应用后仍显示新路径。
- [ ] Workspace 首页的项目列表从配置的根目录（或当前 mock）加载。
- [ ] 路径为空时 Save 按钮给出提示或不保存。

---

## REQ-002: Skill 仓库位置配置

**来源**：PRD §4.10 Settings 与 Workspace 配置、User Story 8

**描述**：用户可以在 Settings 页面配置 Skill 仓库位置。

**验收标准**：
- [ ] Settings 页面可见 "Skill Repository Path" 输入框。
- [ ] 修改路径并 Save 后持久化，重启后保持不变。
- [ ] Skills 页面从配置的仓库路径（或当前 mock）读取技能列表。

---

## REQ-003: 添加本地项目

**来源**：PRD §4.11 项目导入 UI、User Story 9

**描述**：用户可以通过 "Add Project" 弹层从本地目录导入项目。

**验收标准**：
- [ ] Workspace 首页顶部提供 "Add Project" 按钮，点击打开模态框。
- [ ] 模态框默认显示本地目录表单：Project Name、Directory Path、Description。
- [ ] Project Name 为空时不能提交。
- [ ] 提交后新项目出现在 Workspace 项目列表中，显示名称、描述、更新时间。
- [ ] 项目元数据记录 `sourceType=local` 和 `localPath`。

---

## REQ-004: 从 Git 仓库检出项目

**来源**：PRD §4.11 项目导入 UI、User Story 9

**描述**：用户可以在 Add Project 弹层切换到 Git Repository，填写仓库信息并检出。

**验收标准**：
- [ ] Add Project 弹层提供 "Local Directory" / "Git Repository" 切换。
- [ ] 选择 Git 后显示字段：Project Name、Repository URL、Branch（可选，默认 main）、Clone Directory。
- [ ] Repository URL 为空时不能提交。
- [ ] 提交后新项目出现在 Workspace 列表中。
- [ ] 项目元数据记录 `sourceType=git`、`repoUrl`、`branch`、`localPath`。
- [ ] Workspace 项目卡片不显示 "local" 或 "git" 来源标签。

---

## REQ-005: Workspace 项目列表与搜索

**来源**：PRD §4.15 Workspace 首页

**描述**：Workspace 首页以卡片网格展示项目，并支持按名称过滤。

**验收标准**：
- [ ] 页面展示项目卡片网格，每张卡片包含项目名称、描述、更新时间。
- [ ] 提供搜索/过滤输入框，输入关键词后仅显示名称匹配的项目（不区分大小写）。
- [ ] 无匹配项目时显示空状态提示。

---

## REQ-006: Flows 列表页

**来源**：PRD §4.12 Flows 列表页、User Story 10

**描述**：Flows 页面以卡片列出所有流程，展示关键元数据并提供编辑入口。

**验收标准**：
- [ ] Flows 页面默认展示流程卡片列表，非直接进入编辑器。
- [ ] 每张卡片显示：流程名称、所属项目名称、节点数、定时状态（Scheduled/Manual）、更新时间。
- [ ] 每张卡片提供 "Edit Flow" 按钮，点击后进入该流程的编辑器。
- [ ] 页面提供 "New Flow" 按钮，点击打开创建弹层。

---

## REQ-007: 创建新流程

**来源**：PRD §4.12 Flows 列表页、User Story 10

**描述**：用户可以通过弹层创建新流程，指定名称、项目和描述。

**验收标准**：
- [ ] New Flow 弹层包含字段：Flow Name（必填）、Project（下拉选择）、Description（可选）。
- [ ] Flow Name 为空或 Project 未选择时不能提交。
- [ ] 提交后新流程出现在 Flows 列表中，节点数初始为 0，定时状态为 Manual。
- [ ] 创建成功后弹层关闭。

---

## REQ-008: 流程编辑器画布

**来源**：PRD §4.7 流程编辑器形态、§6.4 关键页面结构

**描述**：流程编辑器提供画布，可查看节点和连边，并按类别使用节点面板。

**验收标准**：
- [ ] 编辑器左侧显示 Node Palette，按 Trigger / Agent / Data / Logic / Output 等类别列出节点。
- [ ] 画布区域渲染流程节点和节点间的连线（边）。
- [ ] 节点显示标题、子类型摘要和类型色条。
- [ ] 点击节点后在右侧 Properties 面板展示该节点信息。
- [ ] 编辑器顶部显示返回 Flows 列表的入口。

---

## REQ-009: 流程编辑器节点属性

**来源**：PRD §6.4 关键页面结构

**描述**：选中节点后，右侧面板展示可编辑的属性，Agent 节点有特殊字段。

**验收标准**：
- [ ] 未选中节点时右侧显示 "Select a node to edit properties"。
- [ ] 选中节点后显示 Node Name 输入框和 Output Variable 输入框。
- [ ] 选中 Agent 类型节点时额外显示 Model 下拉框和 System Prompt 文本框。
- [ ] 提供 Save 和 Delete 按钮（当前原型 Delete 为占位，只需存在即可）。

---

## REQ-010: 流程编辑器运行与视图控制

**来源**：PRD §6.4 关键页面结构

**描述**：流程编辑器提供运行触发、定时开关和画布缩放控制。

**验收标准**：
- [ ] 编辑器顶部提供 Run 按钮，点击后按钮文案变为 "Running..."，运行结束后恢复。
- [ ] 顶部提供 Schedule 开关，切换时更新运行状态视觉反馈。
- [ ] 画布右下角提供 Zoom Out / 当前百分比 / Zoom In 控制。
- [ ] 点击 Reset Zoom 恢复到 100%。

---

## REQ-011: 手动创建任务

**来源**：PRD §4.13 Tasks 页面、User Story 11

**描述**：用户可以在 Tasks 页面手动创建一个任务（选择项目和流程后立即运行）。

**验收标准**：
- [ ] Tasks 页面顶部提供 "New Task" 按钮，点击打开弹层。
- [ ] 弹层包含 Project 下拉框、Flow 下拉框、Trigger 选项（Manual run now / Use flow schedule）。
- [ ] 未选择 Project 时不能提交。
- [ ] 提交后在 Run History 列表顶部新增一条运行记录，状态为 running。
- [ ] 运行完成后状态更新为 success 或 error，并显示持续时间、节点数。

---

## REQ-012: 定时任务管理

**来源**：PRD §4.13 Tasks 页面、User Story 12

**描述**：用户可以创建、查看和启用/停用定时任务（Schedule）。

**验收标准**：
- [ ] Tasks 页面顶部提供 "New Schedule" 按钮，点击打开弹层。
- [ ] 弹层包含 Project 下拉框、Flow 下拉框、Cron Expression 输入框，并显示人类可读的 cron 描述。
- [ ] Cron 表达式为空或 Project/Flow 未选择时不能提交。
- [ ] 提交后新 Schedule 出现在 Tasks 页面左侧 Schedules 列表中。
- [ ] 每条 Schedule 提供启用/停用开关，切换后状态立即更新。
- [ ] Schedules 列表显示所属项目、cron 表达式和当前启用状态。

---

## REQ-013: 任务执行历史与详情

**来源**：PRD §4.13 Tasks 页面、User Story 6

**描述**：Tasks 页面展示运行历史，并支持查看单次执行的日志、变量和输出。

**验收标准**：
- [ ] Tasks 页面左侧下半部分展示 Run History，按时间倒序排列。
- [ ] 每条历史显示流程名、项目名、开始时间、持续时间、节点数、状态。
- [ ] 点击历史记录后，右侧详情面板展示 Logs / Variables / Output 三个 Tab。
- [ ] Logs Tab 显示时间、节点、状态、消息。
- [ ] Variables Tab 显示执行变量键值表。
- [ ] Output Tab 显示最终输出（当前为 JSON 示例）。

---

## REQ-014: Skills 列表

**来源**：PRD §4.14 Skill 管理 UI、User Story 2

**描述**：Skills 页面以表格展示技能仓库中的技能及其项目链接情况。

**验收标准**：
- [ ] Skills 页面展示表格，列包括 Skill、Repository Path、Linked Projects、操作。
- [ ] Skill 行显示名称、描述、仓库路径。
- [ ] Linked Projects 列显示已链接项目数量或 "Not linked"。
- [ ] 提供 "Details" 按钮打开 Skill 详情弹层。

---

## REQ-015: Skill 详情与项目链接

**来源**：PRD §4.14 Skill 管理 UI、User Story 13

**描述**：用户可以在 Skill 详情弹层查看元数据并把技能链接到项目。

**验收标准**：
- [ ] Skill 详情弹层显示技能名称、描述、仓库路径、版本、依赖信息。
- [ ] 弹层中列出所有项目，每个项目前提供 checkbox。
- [ ] 勾选项目后，该技能链接到对应项目；取消勾选后移除链接。
- [ ] 关闭弹层后，Skills 列表的 Linked Projects 列同步更新。
- [ ] 提供 Save 和 Delete Skill 按钮（Delete 当前为占位）。

---

## REQ-016: 深色/浅色主题切换

**来源**：PRD §4.16 设计系统与主题

**描述**：应用支持 dark / light 主题切换，并通过 design tokens 驱动界面样式。

**验收标准**：
- [ ] 顶部栏提供主题切换按钮，点击后在 dark 与 light 之间切换。
- [ ] 切换后整个应用（侧边栏、页面、弹层、表格）颜色同步变化。
- [ ] 主题偏好持久化，重新打开应用后保持上次选择。
- [ ] 样式使用 CSS 自定义属性（design tokens），不直接写死颜色值。

---

## 原始需求（保留上下文）

> 见 PRD §1 Problem Statement。核心动机：把需要人类判断的环节交给 codex/agent 节点，把流程化步骤交给应用稳定执行，实现可定时触发、可远程观察的自动化工作流。
