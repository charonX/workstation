# Assertion Signoff: OPC Workstation Desktop App

> 门 1。逐条验收点签字确认后，才能进入 test-author 把占位写实、再由 implementer 实现。
>
> 状态图例：`- [ ]` 待签 · `- [x]` 已签 · `[PLACEHOLDER]` 当前测试为同义反复占位，需先签断言契约再写实 · `[E2E]` 当前为 E2E 占位，待实现层提供驱动后替换。
>
> 断言契约来源：`requirements.md` (v1-hash `588f13f5…d47254`)、`test-plan.md`、`tests/*.test.js`。

---

## REQ-001: Workspace 根目录配置

- [x] 1.1 Settings 页可见 "Workspace Root Directory" 输入框，默认显示当前路径 `[E2E]`
- [x] 1.2 修改路径 → Save → 持久化，重启后保持 `TP-001 settings.test.js`
- [x] 1.3 空字符串应被拒绝（抛 `Workspace root is required`） `TP settings.test.js [PLACEHOLDER]`
- [x] 1.4 Workspace 首页项目列表从配置根目录加载 `[E2E]`

**占位断言契约 (1.3)**：`saveSettings({ workspaceRoot: "" })` 抛 `/Workspace root is required/`。

---

## REQ-002: Skill 仓库位置配置

- [x] 2.1 Settings 页可见 "Skill Repository Path" 输入框 `[E2E]`
- [x] 2.2 修改路径 → Save → 持久化，重启后保持 `TP-002 settings.test.js`
- [x] 2.3 Skills 页从配置仓库路径读取技能列表 `[E2E]`

---

## REQ-003: 添加本地项目

- [x] 3.1 Workspace 顶部 "Add Project" 按钮 → 打开模态框 `[E2E]`
- [x] 3.2 模态框默认显示本地表单：Name / Directory Path / Description `[E2E]`
- [x] 3.3 Name 为空时不能提交（抛 `/required/`） `TP-004 project.test.js`
- [x] 3.4 提交后新项目出现在列表，显示名称/描述/更新时间 `TP-003 project.test.js`
- [x] 3.5 元数据记录 `sourceType=local`、`localPath` `TP-003 project.test.js`

---

## REQ-004: 从 Git 仓库检出项目

- [x] 4.1 Add Project 弹层提供 "Local Directory"/"Git Repository" 切换 `[E2E]`
- [x] 4.2 Git 表单字段：Name / Repository URL / Branch（默认 main）/ Clone Directory `[E2E]`
- [x] 4.3 Repository URL 为空时不能提交（抛 `/Repository URL is required/`） `TP-006 project.test.js`
- [x] 4.4 未提供 branch 时默认 `main` `TP project.test.js`
- [x] 4.5 提交后新项目出现在 Workspace 列表 `TP-005 project.test.js`
- [x] 4.6 元数据记录 `sourceType=git`、`repoUrl`、`branch`、`localPath` `TP-005 project.test.js`
- [x] 4.7 项目卡片**不**显示 local/git 来源标签 `[E2E]`

---

## REQ-005: Workspace 项目列表与搜索

- [x] 5.1 卡片网格展示：名称、描述、更新时间 `[E2E]`
- [x] 5.2 搜索框按名称过滤，大小写不敏感 `TP-007 project.test.js`
- [x] 5.3 空过滤返回全部 `TP project.test.js`
- [x] 5.4 无匹配时显示空状态提示 `[E2E]`

---

## REQ-006: Flows 列表页

- [x] 6.1 默认展示流程卡片列表，非直接进编辑器 `[E2E]`
- [x] 6.2 卡片显示：名称、项目名、节点数、定时状态、更新时间 `TP-008 flow.test.js`
- [x] 6.3 每卡 "Edit Flow" 入口，可按 id 获取详情 `TP-009 flow.test.js`
- [x] 6.4 "New Flow" 按钮 → 打开创建弹层 `[E2E]`

---

## REQ-007: 创建新流程

- [x] 7.1 弹层字段：Flow Name（必填）/ Project（下拉）/ Description（可选） `[E2E]`
- [x] 7.2 Name 为空抛 `/Flow name is required/` `TP-011 flow.test.js`
- [x] 7.3 Project 未选抛 `/Project is required/` `TP-011 flow.test.js`
- [x] 7.4 创建后 nodes=0、scheduleEnabled=false `TP-010 flow.test.js`
- [x] 7.5 创建成功弹层关闭 `[E2E]`

---

## REQ-008: 流程编辑器画布

- [x] 8.1 左侧 Node Palette 分类：Trigger / Agent / Data / Logic / Output `TP-012 flow.test.js [PLACEHOLDER]`
- [x] 8.2 画布渲染节点与连线 `[E2E]`
- [x] 8.3 节点显示标题、子类型摘要、类型色条 `[E2E]`
- [x] 8.4 点击节点 → 右侧 Properties 展示 `[E2E]`
- [x] 8.5 顶部返回 Flows 列表入口 `[E2E]`

**占位断言契约 (8.1)**：`getNodeCategories()` 返回 `["Trigger","Agent","Data","Logic","Output"]`（确认 5 类 + 顺序）。

---

## REQ-009: 流程编辑器节点属性

- [x] 9.1 未选节点显示 "Select a node to edit properties" `TP-013 flow.test.js [PLACEHOLDER]`
- [x] 9.2 选中节点显示 Name + Output Variable 输入框 `TP-013 flow.test.js [PLACEHOLDER]`
- [x] 9.3 Agent 节点额外显示 Model 下拉 + System Prompt 文本框 `TP-013 flow.test.js [PLACEHOLDER]`
- [x] 9.4 提供 Save / Delete 按钮（Delete 可占位） `[E2E]`

**占位断言契约 (9.1–9.3)**：
- `EMPTY_SELECTION_MESSAGE === "Select a node to edit properties"`
- `getEditableFields({type:"agent"}) === ["name","outputVariable","model","systemPrompt"]`
- `getEditableFields({type:"trigger"}) === ["name","outputVariable"]`（确认非 Agent 仅此两项）

---

## REQ-010: 流程编辑器运行与视图控制

- [x] 10.1 Run 按钮点击后文案 → "Running..."，结束后恢复 "Run" `TP-014 flow.test.js [PLACEHOLDER]`
- [x] 10.2 Schedule 开关切换更新视觉反馈 `[E2E]`
- [x] 10.3 画布右下角 Zoom Out / 当前百分比 / Zoom In `TP-014 flow.test.js [PLACEHOLDER]`
- [x] 10.4 Reset Zoom 回到 100% `TP-014 flow.test.js [PLACEHOLDER]`

**占位断言契约 (10.1, 10.3–10.4)**：
- `toggleRun(false) === {running:true,label:"Running..."}`；`toggleRun(true) === {running:false,label:"Run"}`
- 步长 0.1，范围 `[0.5, 1.5]`：`zoomIn(1.0)=1.1`、`zoomIn(1.5)=1.5`、`zoomOut(1.0)=0.9`、`zoomOut(0.5)=0.5`
- `resetZoom() === 1.0`

---

## REQ-011: 手动创建任务

- [x] 11.1 顶部 "New Task" 按钮 → 弹层 `[E2E]`
- [x] 11.2 弹层含 Project / Flow 下拉、Trigger 选项 `[E2E]`
- [x] 11.3 未选 Project 抛 `/Project is required/` `TP-016 task.test.js`
- [x] 11.4 提交后 Run History 顶部新增 running 记录 `TP-015 task.test.js`
- [x] 11.5 完成后状态 success，显示 duration + nodesRun + endedAt `TP task.test.js`

---

## REQ-012: 定时任务管理

- [x] 12.1 "New Schedule" 按钮 → 弹层 `[E2E]`
- [x] 12.2 弹层含 Project / Flow 下拉、Cron 输入 + 人类可读描述 `[E2E]`
- [x] 12.3 Cron 空 或 Project/Flow 未选抛错（Cron → `/Cron expression is required/`） `TP-017 task.test.js`
- [x] 12.4 提交后出现在 Schedules 列表，enabled=true `TP-017 task.test.js`
- [x] 12.5 启用/停用开关切换，状态立即更新 `TP-018 task.test.js`
- [x] 12.6 Schedules 列表显示项目、cron、启用状态 `TP-017/018 task.test.js`

---

## REQ-013: 任务执行历史与详情

- [x] 13.1 Run History 倒序（newest first） `TP-019 task.test.js`
- [x] 13.2 每条历史显示：流程名、项目名、开始时间、duration、节点数、状态 `[E2E]`
- [x] 13.3 点击历史 → 右侧详情 Logs / Variables / Output 三 Tab `TP task.test.js [PLACEHOLDER]`
- [x] 13.4 Logs Tab 显示时间/节点/状态/消息 `[E2E]`
- [x] 13.5 Variables Tab 显示键值表 `[E2E]`
- [x] 13.6 Output Tab 显示最终输出（JSON 示例） `[E2E]`

**占位断言契约 (13.3)**：`getExecutionDetailTabs() === ["logs","variables","output"]`；`getDefaultDetailTab() === "logs"`（确认默认 Tab = logs）。

---

## REQ-014: Skills 列表

- [x] 14.1 表格列：Skill / Repository Path / Linked Projects / 操作 `TP-020 skill.test.js`
- [x] 14.2 行显示名称、描述、仓库路径 `TP-020 skill.test.js`
- [x] 14.3 Linked Projects 显示数量或 "Not linked" `[E2E]`
- [x] 14.4 "Details" 按钮打开详情弹层 `[E2E]`

---

## REQ-015: Skill 详情与项目链接

- [x] 15.1 详情弹层显示名称/描述/仓库路径/版本/依赖 `TP-021 skill.test.js`
- [x] 15.2 列出所有项目，每项前有 checkbox `[E2E]`
- [x] 15.3 勾选 → 链接；取消 → 移除 `TP-021 skill.test.js`
- [x] 15.4 重复链接幂等 `TP-021 skill.test.js`
- [x] 15.5 关闭弹层后 Linked Projects 列同步更新 `[E2E]`
- [x] 15.6 Save / Delete Skill 按钮（Delete 占位） `[E2E]`

---

## REQ-016: 深色/浅色主题切换

- [x] 16.1 顶部栏主题切换按钮，dark ⇄ light `TP-022 theme.test.js`
- [x] 16.2 切换后全应用颜色同步（侧边栏/页面/弹层/表格） `[E2E]`
- [x] 16.3 偏好持久化，重启保持 `[E2E]`
- [x] 16.4 样式用 CSS 自定义属性，不写死颜色 `[E2E]`
- [x] 16.5 `applyTheme` 在目标元素设置 `data-theme` `TP-022 theme.test.js [PLACEHOLDER]`

**占位断言契约 (16.5)**：`applyTheme("light", target)` 返回 `"light"` 且 `target` 被调用 `setAttribute("data-theme","light")`；省略 target 时 no-op（Node 无 `document`）。

---

## REQ-017: 条件分支节点

- [ ] 17.1 Node Palette 提供 Condition 节点类型 `[E2E]`
- [ ] 17.2 Condition 节点配置包含 JavaScript 表达式输入框 `[E2E]`
- [ ] 17.3 Condition 节点有两个出口：true / false `[E2E]`
- [ ] 17.4 表达式为真时走 true 分支 `TP-023 flowEngine.test.js [PLACEHOLDER]`
- [ ] 17.5 表达式为假时走 false 分支 `TP-024 flowEngine.test.js [PLACEHOLDER]`
- [ ] 17.6 表达式非法时节点返回 fatal，Execution 失败 `TP-025 flowEngine.test.js [PLACEHOLDER]`
- [ ] 17.7 Execution 日志记录实际分支名 `[E2E]`

**占位断言契约 (17.4–17.6)**：
- `run({ flow: condition-true })` 返回 `{ status: "success", output: "high" }`
- `run({ flow: condition-false })` 返回 `{ status: "success", output: "low" }`
- `run({ flow: condition-invalid })` 返回 `{ status: "error" }`

---

## REQ-018: ForEach 循环节点

- [ ] 18.1 Node Palette 提供 ForEach 节点类型 `[E2E]`
- [ ] 18.2 ForEach 节点配置包含数组变量名 `[E2E]`
- [ ] 18.3 ForEach 节点有两个出口：body / exit `[E2E]`
- [ ] 18.4 遍历数组并为每个元素执行 body 子图 `TP-026 flowEngine.test.js [PLACEHOLDER]`
- [ ] 18.5 数组遍历完成后走 exit 分支 `TP-026 flowEngine.test.js [PLACEHOLDER]`
- [ ] 18.6 Execution 日志记录迭代次数 `[E2E]`

**占位断言契约 (18.4–18.5)**：`run({ flow: forEach-3-items })` 执行 3 次 body 后从 exit 退出，最终 status 为 success。

---

## REQ-019: While 循环节点

- [ ] 19.1 Node Palette 提供 While 节点类型 `[E2E]`
- [ ] 19.2 While 节点配置包含 JavaScript 表达式输入框 `[E2E]`
- [ ] 19.3 While 节点有两个出口：body / exit `[E2E]`
- [ ] 19.4 表达式为真时重复执行 body 子图 `TP-027 flowEngine.test.js [PLACEHOLDER]`
- [ ] 19.5 表达式为假时走 exit 分支 `TP-027 flowEngine.test.js [PLACEHOLDER]`
- [ ] 19.6 表达式非法时节点返回 fatal，Execution 失败 `TP-027 flowEngine.test.js [PLACEHOLDER]`
- [ ] 19.7 Execution 日志记录迭代次数 `[E2E]`

**占位断言契约 (19.4–19.6)**：
- `run({ flow: while-counter-lt-3 })` 执行 3 次 body 后从 exit 退出
- `run({ flow: while-invalid-expression })` 返回 `{ status: "error" }`

---

## REQ-020: 循环图保护与执行限制

- [ ] 20.1 FlowEngine 不要求 DAG，允许循环图 `[E2E]`
- [ ] 20.2 FlowEngine.run 支持 `options.maxDepth`，默认 100 `TP-028 flowEngine.test.js [PLACEHOLDER]`
- [ ] 20.3 FlowEngine.run 支持 `options.maxIterations`，默认 1000 `TP-028 flowEngine.test.js [PLACEHOLDER]`
- [ ] 20.4 超过 maxDepth 时 Execution 失败 `TP-028 flowEngine.test.js [PLACEHOLDER]`
- [ ] 20.5 超过 maxIterations 时 Execution 失败 `TP-028 flowEngine.test.js [PLACEHOLDER]`
- [ ] 20.6 失败时返回明确的错误信息 `[PLACEHOLDER]`

**占位断言契约 (20.4–20.6)**：
- `run({ flow: self-loop, options: { maxDepth: 3 } })` 返回 `{ status: "error", error: /Max execution depth exceeded/ }`
- `run({ flow: infinite-while, options: { maxIterations: 5 } })` 返回 `{ status: "error", error: /Max iterations exceeded/ }`

---

## 结论

- [ ] PASS — 全部验收点（含占位断言契约）已签，可进入 test-author 把占位写实。
- [ ] FAIL — 存在未达一致的标准，回 PRD/REQ 修订。
- [ ] BLOCKED — 依赖外部信息未澄清。

---

## 签字

签核人：______________  时间：______________
