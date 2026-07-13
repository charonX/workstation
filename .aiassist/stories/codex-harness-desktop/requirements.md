# Requirements: OPC Workstation Desktop App

> 由 PRD 稳定块结晶而成。每条 REQ 带唯一 ID、验收标准、capability/entity、seam 与测试路径。
> REQ 格式：`REQ-<AREA>-<NNN>`，AREA 取自所属业务能力域。
> REQ 版本哈希：`requirements-v1.hash`

---

## REQ-WORKSPACE-001: Workspace 根目录配置

- **来源**：PRD §4.11 Settings 与 Workspace 配置
- **优先级**：P0
- **必须性**：必须
- **capability**: `workspace-management`
- **entity**: `settings`
- **scope**: cross-module
- **modules**: `settingsService`, `src/http/routes/settings.js`, `src/cli/commands/settings.js`
- **interface_contract**:
  - `GET /api/settings` → `{workspaceRoot: string}`
  - `PATCH /api/settings` → body `{workspaceRoot: string}`，返回更新后的 settings
  - CLI: `opc-workstation settings get`, `opc-workstation settings set --workspace-root <path>`
  - 空路径返回 `400 VALIDATION_ERROR`
- **测试类型**: CLI + HTTP API
- **测试路径**: `tests/capabilities/workspace-management/settings/codex-harness-desktop/api/`

**验收标准**：
- [ ] `GET /api/settings` 返回当前 `workspaceRoot`。
- [ ] `PATCH /api/settings` 持久化新路径，重启后保持不变。
- [ ] CLI `settings set --workspace-root ""` 退出码 1 并返回错误信息。

---

## REQ-WORKSPACE-002: Skill 仓库位置配置

- **来源**：PRD §4.11 Settings 与 Workspace 配置
- **优先级**：P0
- **必须性**：必须
- **capability**: `workspace-management`
- **entity**: `settings`
- **scope**: cross-module
- **modules**: `settingsService`, `src/http/routes/settings.js`, `src/cli/commands/settings.js`
- **interface_contract**:
  - `GET /api/settings` → `{skillRepoPath: string}`
  - `PATCH /api/settings` → body `{skillRepoPath: string}`
  - CLI: `opc-workstation settings set --skill-repo-path <path>`
- **测试类型**: CLI + HTTP API
- **测试路径**: `tests/capabilities/workspace-management/settings/codex-harness-desktop/api/`

**验收标准**：
- [ ] `GET /api/settings` 返回当前 `skillRepoPath`。
- [ ] 修改并 Save 后持久化，重启后保持不变。

---

## REQ-WORKSPACE-003: 添加本地项目

- **来源**：PRD §4.12 项目导入 UI
- **优先级**：P0
- **必须性**：必须
- **capability**: `workspace-management`
- **entity**: `project`
- **scope**: cross-module
- **modules**: `projectService`, `src/http/routes/projects.js`, `src/cli/commands/project.js`
- **interface_contract**:
  - `POST /api/projects` → body `{name, localPath, description?}`
  - CLI: `opc-workstation project create --name <name> --local-path <path>`
  - `name` 为空返回 `400 VALIDATION_ERROR`
- **测试类型**: CLI + HTTP API + E2E
- **测试路径**: `tests/capabilities/workspace-management/project/codex-harness-desktop/api/`, `tests/capabilities/workspace-management/project/codex-harness-desktop/e2e/onboarding.spec.js`

**验收标准**：
- [ ] 创建后项目出现在 `GET /api/projects` 列表中。
- [ ] 项目元数据包含 `sourceType=local`、`localPath`、`name`、`updatedAt`。
- [ ] `name` 为空时创建失败。

---

## REQ-WORKSPACE-004: 从 Git 仓库检出项目

- **来源**：PRD §4.12 项目导入 UI
- **优先级**：P0
- **必须性**：必须
- **capability**: `workspace-management`
- **entity**: `project`
- **scope**: cross-module
- **modules**: `projectService`, `src/http/routes/projects.js`, `src/cli/commands/project.js`
- **interface_contract**:
  - `POST /api/projects` → body `{name?, repoUrl, branch?, cloneDirectory?}`
  - CLI: `opc-workstation project create --name <name> --repo-url <url> --branch main`
  - `repoUrl` 为空返回 `400 VALIDATION_ERROR`
  - `name` 为空时，从 `repoUrl` 提取仓库名作为 `name`
  - 项目创建后自动 `git clone` 到 `workspaceRoot/<repo-name>`，`cloneDirectory` 可覆盖相对目录名
- **测试类型**: CLI + HTTP API + E2E
- **测试路径**: `tests/capabilities/workspace-management/project/codex-harness-desktop/api/`, `tests/capabilities/workspace-management/project/codex-harness-desktop/e2e/onboarding.spec.js`

**验收标准**：
- [ ] 创建后项目出现在列表中。
- [ ] 元数据包含 `sourceType=git`、`repoUrl`、`branch`（默认 `main`）、`localPath`。
- [ ] `localPath` 指向 `workspaceRoot` 下真实检出的目录。
- [ ] `repoUrl` 为空时创建失败。
- [ ] `name` 为空时，从 `repoUrl` 提取仓库名并成功创建。

---

## REQ-WORKSPACE-005: Workspace 项目列表与搜索

- **来源**：PRD §4.16 Workspace / Projects 首页
- **优先级**：P0
- **必须性**：必须
- **capability**: `workspace-management`
- **entity**: `project`
- **scope**: cross-module
- **modules**: `projectService`, `src/http/routes/projects.js`, `src/cli/commands/project.js`
- **interface_contract**:
  - `GET /api/projects?q=<filter>`
  - CLI: `opc-workstation project list --q <filter>`
  - 过滤大小写不敏感；空过滤返回全部
- **测试类型**: CLI + HTTP API + E2E
- **测试路径**: `tests/capabilities/workspace-management/project/codex-harness-desktop/api/`, `tests/capabilities/workspace-management/project/codex-harness-desktop/e2e/onboarding.spec.js`

**验收标准**：
- [ ] `GET /api/projects` 返回全部项目。
- [ ] 带 `q` 参数时仅返回名称匹配的项目（大小写不敏感）。
- [ ] 无匹配时返回空数组。

---

## REQ-WORKSPACE-006: Project 详情与 Skill 关联

- **来源**：PRD §4.16 Workspace / Projects 首页
- **优先级**: P0
- **必须性**: 必须
- **capability**: `workspace-management`
- **entity**: `project`
- **scope**: cross-module
- **modules**: `projectService`, `skillService`, `src/http/routes/projects.js`
- **interface_contract**:
  - `GET /api/projects/:id` → `{overview: {flowsCount, runsCount, ...}, skills: [...]}`
  - `PATCH /api/projects/:id/skills` → body `{skillId, linked: boolean}`
  - CLI: `opc-workstation project get --id <id>`, `opc-workstation project link-skill --project-id <id> --skill-id <id>`
- **测试类型**: CLI + HTTP API + E2E
- **测试路径**: `tests/capabilities/workspace-management/project/codex-harness-desktop/api/`, `tests/capabilities/workspace-management/project/codex-harness-desktop/e2e/onboarding.spec.js`

**验收标准**：
- [ ] Project 详情返回 Overview 元数据和可用 skill 列表及关联状态。
- [ ] 关联/取消关联 skill 幂等。
- [ ] 重复关联同一 skill 不重复记录。

---

## REQ-WORKSPACE-007: 显示密度

- **来源**：PRD §4.11 Settings 与 Workspace 配置
- **优先级**: P1
- **必须性**: 应该
- **capability**: `workspace-management`
- **entity**: `settings`
- **scope**: cross-module
- **modules**: `settingsService`, Settings 页面
- **interface_contract**:
  - `PATCH /api/settings` → body `{density: "compact" | "comfortable"}`
  - CLI: `opc-workstation settings set --density <value>`
- **测试类型**: CLI + HTTP API
- **测试路径**: `tests/capabilities/workspace-management/settings/codex-harness-desktop/api/`

**验收标准**：
- [ ] 支持 `compact` / `comfortable`。
- [ ] 默认值为 `comfortable`。
- [ ] 持久化，重启后保持。

---

## REQ-WORKSPACE-008: 删除项目

- **来源**：PRD §4.16 Workspace / Projects 首页
- **优先级**：P0
- **必须性**：必须
- **capability**: `workspace-management`
- **entity**: `project`
- **scope**: cross-module
- **modules**: `projectService`, `src/http/routes/projects.js`, `src/cli/commands/project.js`, renderer ProjectCard/ProjectDetailModal
- **interface_contract**:
  - `DELETE /api/projects/:id`
  - CLI: `opc-workstation project delete --id <id>`
  - 项目不存在返回 `404`
- **测试类型**: CLI + HTTP API + E2E
- **测试路径**: `tests/capabilities/workspace-management/project/codex-harness-desktop/api/`, `tests/capabilities/workspace-management/project/codex-harness-desktop/e2e/onboarding.spec.js`

**验收标准**：
- [ ] 删除后项目从 `GET /api/projects` 列表中消失。
- [ ] 级联删除该项目的 flows、schedules、executions、logs 和 project_skills 关联。
- [ ] 本地 git 检出目录**不**随项目删除而被删除（仅删除元数据）。
- [ ] UI 删除操作需要二次确认。
- [ ] 删除不存在的项目返回 `404`。

---

## REQ-FLOW-001: Flows 列表页

- **来源**：PRD §4.13 Flows 列表页
- **优先级**：P0
- **必须性**：必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: cross-module
- **modules**: `flowService`, `src/http/routes/flows.js`, `src/cli/commands/flow.js`
- **interface_contract**:
  - `GET /api/flows`
  - CLI: `opc-workstation flow list`
- **测试类型**: CLI + HTTP API
- **测试路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/api/`

**验收标准**：
- [ ] 列表返回每个 flow 的 `id`、`name`、`projectId`、`projectName`、`nodeCount`、`scheduleEnabled`、`updatedAt`。
- [ ] 可通过 `GET /api/flows/:id` 获取单个 flow 详情。

---

## REQ-FLOW-002: 创建新流程

- **来源**：PRD §4.13 Flows 列表页
- **优先级**：P0
- **必须性**：必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: cross-module
- **modules**: `flowService`, `src/http/routes/flows.js`, `src/cli/commands/flow.js`
- **interface_contract**:
  - `POST /api/flows` → body `{name, projectId, description?}`
  - CLI: `opc-workstation flow create --name <name> --project-id <id>`
  - `name` 或 `projectId` 缺失返回 `400`
- **测试类型**: CLI + HTTP API + E2E
- **测试路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/api/`, `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/flowRun.spec.js`

**验收标准**：
- [ ] 创建后 flow 出现在列表中。
- [ ] 初始 `nodes` 为空数组，`scheduleEnabled=false`。
- [ ] 缺少 `name` 或 `projectId` 时创建失败。

---

## REQ-FLOW-003: 流程编辑器画布

- **来源**：PRD §4.7 流程编辑器形态、§6.4 关键页面结构
- **优先级**：P0
- **必须性**：必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: intra-module (renderer)
- **modules**: React Flow 画布组件、Node Palette 组件
- **interface_contract**:
  - 从 `GET /api/flows/:id` 获取节点/边数据渲染画布
  - 节点分类：Trigger / Agent / Data / Logic / Output
- **测试类型**: E2E + feel-signoff
- **UX 参照**: `.aiassist/stories/codex-harness-desktop/ux/flow-editor.html`
- **E2E 路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/flowRun.spec.js`

**验收标准**：
- [ ] 左侧 Node Palette 按分类列出节点。
- [ ] 画布渲染节点和连边。
- [ ] 点击节点后 Properties 面板展示节点信息。

---

## REQ-FLOW-004: 流程编辑器节点属性

- **来源**：PRD §6.4 关键页面结构
- **优先级**：P0
- **必须性**：必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: intra-module (renderer)
- **modules**: Properties 面板组件、flowService
- **interface_contract**:
  - `PATCH /api/flows/:id` → body 含 `nodes` 数组
  - Agent 节点配置字段：`model`、`systemPrompt`
- **测试类型**: E2E + feel-signoff
- **UX 参照**: `.aiassist/stories/codex-harness-desktop/ux/flow-editor.html`
- **E2E 路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/flowRun.spec.js`

**验收标准**：
- [ ] 未选中节点时显示占位提示。
- [ ] 选中节点显示 `name`、`outputVariable`。
- [ ] Agent 节点额外显示 `model` 和 `systemPrompt`。

---

## REQ-FLOW-005: 流程编辑器运行与视图控制

- **来源**：PRD §6.4 关键页面结构
- **优先级**：P0
- **必须性**：必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: cross-module
- **modules**: renderer, `src/http/routes/executions.js`, `taskService`
- **interface_contract**:
  - `POST /api/executions` → body `{projectId, flowId}`
  - 运行按钮状态切换由 UI 本地管理
- **测试类型**: CLI + HTTP API + E2E + feel-signoff
- **UX 参照**: `.aiassist/stories/codex-harness-desktop/ux/flow-editor.html`
- **E2E 路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/flowRun.spec.js`

**验收标准**：
- [ ] 点击 Run 后触发 `POST /api/executions`。
- [ ] Schedule 开关调用 `PATCH /api/schedules/:id`。
- [ ] Zoom In/Out/Reset 控制画布缩放。

---

## REQ-FLOW-006: 流程 JSON 配置格式

- **来源**：PRD §4.22 流程配置格式
- **优先级**: P0
- **必须性**: 必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: cross-module
- **modules**: `flowService`, `src/http/routes/flows.js`, `src/cli/commands/flow.js`
- **interface_contract**:
  - 存储格式：JSON，包含 `id`、`projectId`、`name`、`description`、`nodes`、`edges`、`scheduleEnabled`、`updatedAt`
  - CLI: `opc-workstation flow import --file flow.json --project-id <id>`
  - CLI: `opc-workstation flow export --id <id> --file flow.json`
- **测试类型**: CLI + HTTP API
- **测试路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/api/`

**验收标准**：
- [ ] `flow export` 输出合法 JSON，包含 nodes/edges。
- [ ] `flow import` 从 JSON 创建或更新 flow。
- [ ] 导入的 JSON 缺少必填字段时返回 `400`。

---

## REQ-FLOW-007: Condition 节点

- **来源**：PRD §4.8 基础节点类型
- **优先级**: P0
- **必须性**: 必须
- **capability**: `flow-orchestration`
- **entity**: `flow-engine`
- **scope**: intra-module
- **modules**: `flowEngine`, `executors/conditionExecutor`
- **interface_contract**:
  - 输入：`{expression: string, context: object}`
  - 输出：分支 `true` / `false`
- **测试类型**: 服务单元测试
- **测试路径**: `tests/capabilities/flow-orchestration/flow-engine/codex-harness-desktop/api/`

**验收标准**：
- [ ] 表达式为真时走 `true` 分支。
- [ ] 表达式为假时走 `false` 分支。
- [ ] 表达式语法错误返回 `fatal`，execution 失败。

---

## REQ-FLOW-008: ForEach 节点

- **来源**：PRD §4.8 基础节点类型
- **优先级**: P0
- **必须性**: 必须
- **capability**: `flow-orchestration`
- **entity**: `flow-engine`
- **scope**: intra-module
- **modules**: `flowEngine`, `executors/forEachExecutor`
- **interface_contract**:
  - 输入：`{array: any[]}`
  - 输出：对数组每个元素执行 body 子图
- **测试类型**: 服务单元测试
- **测试路径**: `tests/capabilities/flow-orchestration/flow-engine/codex-harness-desktop/api/`

**验收标准**：
- [ ] 遍历数组并执行 body 子图。
- [ ] 上下文按迭代隔离/合并正确。

---

## REQ-FLOW-009: While 节点

- **来源**：PRD §4.8 基础节点类型
- **优先级**: P0
- **必须性**: 必须
- **capability**: `flow-orchestration`
- **entity**: `flow-engine`
- **scope**: intra-module
- **modules**: `flowEngine`, `executors/whileExecutor`
- **interface_contract**:
  - 输入：`{expression: string}`
  - 输出：表达式为真时重复执行 body
- **测试类型**: 服务单元测试
- **测试路径**: `tests/capabilities/flow-orchestration/flow-engine/codex-harness-desktop/api/`

**验收标准**：
- [ ] 表达式为真时重复执行 body。
- [ ] 表达式为假时退出循环。

---

## REQ-FLOW-010: 循环保护

- **来源**：PRD §4.8 基础节点类型
- **优先级**: P0
- **必须性**: 必须
- **capability**: `flow-orchestration`
- **entity**: `flow-engine`
- **scope**: intra-module
- **modules**: `flowEngine`
- **interface_contract**:
  - `options.maxIterations`、`options.maxDepth`
- **测试类型**: 服务单元测试
- **测试路径**: `tests/capabilities/flow-orchestration/flow-engine/codex-harness-desktop/api/`

**验收标准**：
- [ ] 超过 `maxIterations` 时 execution 失败。
- [ ] 超过 `maxDepth` 时 execution 失败。

---

## REQ-FLOW-011: 删除流程（逻辑删除）

- **来源**：PRD §4.13 Flows 列表页
- **优先级**：P0
- **必须性**：必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: cross-module
- **modules**: `flowService`, `src/http/routes/flows.js`, `src/cli/commands/flow.js`, renderer FlowCard/FlowEditor
- **interface_contract**:
  - `DELETE /api/flows/:id`
  - CLI: `opc-workstation flow delete --id <id>`
  - Flow 不存在返回 `404`
  - Flow 标记 `deletedAt` 后从列表/详情中隐藏
- **测试类型**: CLI + HTTP API + E2E
- **测试路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/api/`, `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/flowRun.spec.js`

**验收标准**：
- [ ] 删除后 flow 从 `GET /api/flows` 列表和 `GET /api/flows/:id` 中隐藏（返回 `404`）。
- [ ] 数据库记录保留，新增 `deletedAt` 字段标记删除时间。
- [ ] 已删除 flow 的 schedules 和 executions 记录保留，但后续不再被调度触发。
- [ ] UI 删除操作需要二次确认。
- [ ] 删除不存在的 flow 返回 `404`。

---

## REQ-FLOW-012: 流程编辑器节点连线与保存

- **来源**：PRD §6.3 数据模型（Edge: sourceNodeId/sourcePort/targetNodeId/targetPort）、UX 参照 flow-editor.html 中的 `.port-in`/`.port-out`/`.connection`
- **优先级**：P0
- **必须性**：必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: cross-module
- **modules**: `FlowCanvas`、`flowService`、`src/http/routes/flows.js`、`src/renderer/api/flows.js`、`FlowEditor`
- **interface_contract**:
  - 画布上从一个 node 右侧 source handle 拖曳到另一个 node 左侧 target handle 创建连边
  - 连边数据模型遵循 PRD：`{ id, sourceNodeId, sourcePort?, targetNodeId, targetPort? }`
  - 点击 Save 调用 `PATCH /api/flows/:id`，body 含 `nodeList` 与 `edges`
  - `PATCH /api/flows/:id` 返回更新后的 flow 详情
- **测试类型**: E2E
- **UX 参照**: `.aiassist/stories/codex-harness-desktop/ux/flow-editor.html`
- **E2E 路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/flowRun.test.cjs`

**验收标准**：
- [ ] 添加两个 node 后，可以从一个 node 的 source handle 拖曳到另一个 node 的 target handle 创建连边。
- [ ] 连边创建后画布上显示连接线和箭头。
- [ ] 点击 Save 后，连边随 nodes 一起持久化；刷新 Flow Editor 后连边仍然存在。
- [ ] 保存的 edge 使用 `sourceNodeId`/`targetNodeId` 字段，与 PRD 数据模型和 FlowEngine 一致。

---

## REQ-FLOW-013: 流程编辑器节点删除

- **来源**：PRD §4.7 流程编辑器形态、UX 参照 flow-editor.html 中节点可编辑的预期
- **优先级**：P0
- **必须性**：必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: intra-module (renderer)
- **modules**: `FlowCanvas`、`FlowEditor`
- **interface_contract**:
  - 选中节点后，可通过键盘 `Delete` 键或节点上的删除按钮移除节点
  - 删除节点同时移除与其相连的所有 edge
  - 点击 Save 调用 `PATCH /api/flows/:id`，被删除节点不再出现在 `nodeList` 中
- **测试类型**: E2E
- **UX 参照**: `.aiassist/stories/codex-harness-desktop/ux/flow-editor.html`
- **E2E 路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/flowEditor.test.cjs`

**验收标准**：
- [ ] 选中一个节点并触发删除后，画布上该节点消失。
- [ ] 与该节点相连的 edge 同步从画布上消失。
- [ ] 点击 Save 并刷新页面后，被删除节点不再出现。
- [ ] 删除未选中的节点不改变画布状态（可选实现，但必须有明确行为）。

---

## REQ-FLOW-014: 流程编辑器节点专属配置持久化

- **来源**：PRD §4.8 基础节点类型、§6.3 数据模型（Node: `config`、`outputVariable`）、UX 参照 flow-editor.html 中 Properties 面板
- **优先级**：P0
- **必须性**：必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: cross-module
- **modules**: Properties 面板、`FlowCanvas`、`flowService`、`src/http/routes/flows.js`、`src/renderer/api/flows.js`
- **interface_contract**:
  - 选中节点后 Properties 面板按节点类型展示可编辑字段
  - 节点数据模型扩展 `config` 对象与 `outputVariable` 字段：`{ id, type, name, config, outputVariable, position }`
  - 点击 Save 调用 `PATCH /api/flows/:id`，body 含 `nodeList`（含 `config` 与 `outputVariable`）与 `edges`
  - `PATCH /api/flows/:id` 返回更新后的 flow 详情
- **测试类型**: E2E
- **UX 参照**: `.aiassist/stories/codex-harness-desktop/ux/flow-editor.html`
- **E2E 路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/flowEditor.test.cjs`

**验收标准**：
- [ ] Agent 节点显示可编辑字段：`model`、`systemPrompt`、`outputVariable`。
- [ ] Condition 节点显示可编辑字段：`expression`、`outputVariable`。
- [ ] ForEach 节点显示可编辑字段：`array`（输入数组表达式）、`outputVariable`。
- [ ] While 节点显示可编辑字段：`expression`、`outputVariable`。
- [ ] Output 节点显示可编辑字段：`path`（输出路径）。
- [ ] 修改字段后点击 Save，`config` 与 `outputVariable` 随 `nodeList` 一起持久化。
- [ ] 刷新 Flow Editor 后，Properties 面板仍显示上次保存的值。

---

## REQ-FLOW-015: Condition 节点 true/false 双输出

- **来源**：PRD §4.8 Condition 节点、§6.3 数据模型（Edge: `sourcePort`/`targetPort`）、UX 参照 flow-editor.html 中 Condition 节点两个 `port-out`
- **优先级**：P0
- **必须性**：必须
- **capability**: `flow-orchestration`
- **entity**: `flow`
- **scope**: cross-module
- **modules**: `FlowCanvas`、`flowService`、`FlowEngine`、`executors/conditionExecutor`
- **interface_contract**:
  - Condition 节点在画布右侧渲染两个 source handle，分别对应 `true` 分支与 `false` 分支
  - 从 `true` handle 拖曳创建的 edge 其 `sourcePort='true'`；从 `false` handle 创建的 edge 其 `sourcePort='false'`
  - 存储格式：`{ id, sourceNodeId, sourcePort: 'true' | 'false', targetNodeId, targetPort? }`
- **测试类型**: E2E
- **UX 参照**: `.aiassist/stories/codex-harness-desktop/ux/flow-editor.html`
- **E2E 路径**: `tests/capabilities/flow-orchestration/flow/codex-harness-desktop/e2e/flowEditor.test.cjs`

**验收标准**：
- [ ] Condition 节点渲染两个右侧 source handle（视觉上可区分 true/false）。
- [ ] 从 true handle 拖曳到目标节点创建的 edge，保存后 `sourcePort` 为 `'true'`。
- [ ] 从 false handle 拖曳到目标节点创建的 edge，保存后 `sourcePort` 为 `'false'`。
- [ ] 刷新 Flow Editor 后，两条 edge 仍分别连接在正确的 true/false handle 上。
- [ ] FlowEngine 执行 Condition 节点时，根据表达式结果走对应 `sourcePort` 的下游分支（已由 REQ-FLOW-007 覆盖执行语义；本条验收编辑器侧数据正确性）。

---

## REQ-SCHEDULE-001: 手动创建任务

- **来源**：PRD §4.14 Tasks 页面
- **优先级**：P0
- **必须性**：必须
- **capability**: `scheduling-execution`
- **entity**: `task`
- **scope**: cross-module
- **modules**: `taskService`, `src/http/routes/executions.js`, `src/cli/commands/task.js`
- **interface_contract**:
  - `POST /api/executions` → body `{projectId, flowId, trigger?: "manual" | "schedule"}`
  - CLI: `opc-workstation task run --project-id <id> --flow-id <id>`
  - `projectId` 缺失返回 `400`
- **测试类型**: CLI + HTTP API
- **测试路径**: `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/`

**验收标准**：
- [ ] 提交后创建一条 `running` 的 execution。
- [ ] 完成后状态更新为 `success`/`error`，并记录 `duration`、`nodesRun`。
- [ ] 未选择 `projectId` 时失败。

---

## REQ-SCHEDULE-002: 定时任务管理

- **来源**：PRD §4.14 Tasks 页面
- **优先级**：P0
- **必须性**：必须
- **capability**: `scheduling-execution`
- **entity**: `schedule`
- **scope**: cross-module
- **modules**: `scheduleService`, `src/http/routes/schedules.js`, `src/cli/commands/schedule.js`
- **interface_contract**:
  - `POST /api/schedules` → body `{projectId, flowId, cron}`
  - `PATCH /api/schedules/:id` → body `{enabled: boolean}`
  - CLI: `opc-workstation schedule create/toggle`
  - `cron` 为空返回 `400`
- **测试类型**: CLI + HTTP API
- **测试路径**: `tests/capabilities/scheduling-execution/schedule/codex-harness-desktop/api/`

**验收标准**：
- [ ] 创建后出现在 `GET /api/schedules` 列表，默认 `enabled=true`。
- [ ] 列表显示 `projectId`、`cron`、`enabled` 和人类可读 cron 描述。
- [ ] toggle 后状态同步更新。

---

## REQ-SCHEDULE-003: 任务执行历史与详情

- **来源**：PRD §4.14 Tasks 页面
- **优先级**：P0
- **必须性**：必须
- **capability**: `scheduling-execution`
- **entity**: `task`
- **scope**: cross-module
- **modules**: `taskService`, `src/http/routes/executions.js`, `src/cli/commands/task.js`
- **interface_contract**:
  - `GET /api/executions` → 按时间倒序
  - `GET /api/executions/:id` → `{logs, variables, output, branchPath, iterations}`
  - CLI: `opc-workstation execution list/get`
- **测试类型**: CLI + HTTP API
- **测试路径**: `tests/capabilities/scheduling-execution/task/codex-harness-desktop/api/`

**验收标准**：
- [ ] 执行历史按时间倒序排列。
- [ ] 详情包含 `logs`、`variables`、`output` 三个 Tab 数据。
- [ ] execution 记录 `branchPath` 和 `iterations`。

---

## REQ-SCHEDULE-004: 删除定时任务

- **来源**：PRD §4.14 Tasks 页面
- **优先级**：P0
- **必须性**：必须
- **capability**: `scheduling-execution`
- **entity**: `schedule`
- **scope**: cross-module
- **modules**: `taskService`, `src/http/routes/schedules.js`, `src/cli/commands/schedule.js`, renderer Schedule/Execution 列表
- **interface_contract**:
  - `DELETE /api/schedules/:id`
  - CLI: `opc-workstation schedule delete --id <id>`
  - Schedule 不存在返回 `404`
- **测试类型**: CLI + HTTP API
- **测试路径**: `tests/capabilities/scheduling-execution/schedule/codex-harness-desktop/api/`

**验收标准**：
- [ ] 删除后 schedule 从 `GET /api/schedules` 列表中消失。
- [ ] 已存在的 execution 历史保留。
- [ ] UI 删除操作需要二次确认。
- [ ] 删除不存在的 schedule 返回 `404`。

---

## REQ-SKILL-001: Skills 列表

- **来源**：PRD §4.15 Skill 管理 UI
- **优先级**：P0
- **必须性**：必须
- **capability**: `skill-management`
- **entity**: `skill`
- **scope**: cross-module
- **modules**: `skillService`, `src/http/routes/skills.js`, `src/cli/commands/skill.js`
- **interface_contract**:
  - `GET /api/skills`
  - CLI: `opc-workstation skill list`
- **测试类型**: CLI + HTTP API
- **测试路径**: `tests/capabilities/skill-management/skill/codex-harness-desktop/api/`

**验收标准**：
- [ ] 列表字段包含 `name`、`repoPath`、`version`、`category`，无 `linkedProjects`。
- [ ] 每行包含 skill `id` 作为详情入口。

---

## REQ-SKILL-002: Skill 详情

- **来源**：PRD §4.15 Skill 管理 UI
- **优先级**：P0
- **必须性**：必须
- **capability**: `skill-management`
- **entity**: `skill`
- **scope**: cross-module
- **modules**: `skillService`, `src/http/routes/skills.js`, `src/cli/commands/skill.js`
- **interface_contract**:
  - `GET /api/skills/:id` → `{name, description, author, tags, parameters, examples, readme, tabs}`
  - CLI: `opc-workstation skill get --id <id>`
- **测试类型**: CLI + HTTP API + E2E + feel-signoff
- **UX 参照**: `.aiassist/stories/codex-harness-desktop/ux/skills.html`
- **E2E 路径**: `tests/capabilities/skill-management/skill/codex-harness-desktop/e2e/skillInstall.spec.js`

**验收标准**：
- [ ] 详情返回 `tabs: ["Overview", "Parameters", "Examples", "README"]`。
- [ ] 不包含项目链接/取消链接控制字段。

---

## REQ-SKILL-003: 多源安装 Skill

- **来源**：PRD §4.4 Skill 管理、User Story 18
- **优先级**: P0
- **必须性**: 必须
- **capability**: `skill-management`
- **entity**: `skill`
- **scope**: cross-module
- **modules**: `skillService`, `src/http/routes/skills.js`, `src/cli/commands/skill.js`
- **interface_contract**:
  - `POST /api/skills/install` → body `{source: "npm" | "plugin" | "local", identifier: string}`
  - CLI: `opc-workstation skill install --source <source> --identifier <id>`
- **测试类型**: CLI + HTTP API + E2E
- **测试路径**: `tests/capabilities/skill-management/skill/codex-harness-desktop/api/`, `tests/capabilities/skill-management/skill/codex-harness-desktop/e2e/skillInstall.spec.js`

**验收标准**：
- [ ] 支持 `npm`/`npx`、`plugin`、`local` 三种来源安装。
- [ ] 安装后 skill 出现在列表中，并记录 `installSource`。

---

## REQ-SKILL-004: 删除 Skill

- **来源**：PRD §4.15 Skill 管理 UI
- **优先级**：P0
- **必须性**：必须
- **capability**: `skill-management`
- **entity**: `skill`
- **scope**: cross-module
- **modules**: `skillService`, `src/http/routes/skills.js`, `src/cli/commands/skill.js`, renderer SkillTable/SkillDetailModal
- **interface_contract**:
  - `DELETE /api/skills/:id`
  - CLI: `opc-workstation skill delete --id <id>`
  - Skill 仍被 project 关联时返回 `400 CONFLICT`
  - Skill 不存在返回 `404`
- **测试类型**: CLI + HTTP API + E2E
- **测试路径**: `tests/capabilities/skill-management/skill/codex-harness-desktop/api/`, `tests/capabilities/skill-management/skill/codex-harness-desktop/e2e/skillInstall.spec.js`

**验收标准**：
- [ ] 删除后 skill 从 `GET /api/skills` 列表中消失。
- [ ] 物理删除数据库记录。
- [ ] 若 skill 仍被任何 project 关联，删除失败并返回 `400`，提示先解除关联。
- [ ] UI 删除操作需要二次确认。
- [ ] 删除不存在的 skill 返回 `404`。

---

## REQ-DASH-001: Dashboard 关键指标

- **来源**：PRD §4.17 Dashboard 页面
- **优先级**: P1
- **必须性**: 应该
- **capability**: `information-aggregation`
- **entity**: `dashboard`
- **scope**: cross-module
- **modules**: dashboard aggregator, `src/http/routes/dashboard.js`
- **interface_contract**:
  - `GET /api/dashboard` → `{projectCount, activeScheduleCount, recentRunCount, successRate, recentExecutions, quickProjectLinks}`
- **测试类型**: CLI + HTTP API + E2E + feel-signoff
- **测试路径**: `tests/capabilities/information-aggregation/dashboard/codex-harness-desktop/api/`, `tests/capabilities/information-aggregation/dashboard/codex-harness-desktop/e2e/dashboard.spec.js`

**验收标准**：
- [ ] 返回项目数、活跃调度数、最近运行次数、成功率。
- [ ] 最近执行列表包含 flow、project、status、time。
- [ ] 提供快捷项目入口。

---

## REQ-I18N-001: 主题切换

- **来源**：PRD §4.11 Settings 与 Workspace 配置
- **优先级**: P1
- **必须性**: 必须
- **capability**: `internationalization-theme`
- **entity**: `theme`
- **scope**: intra-module (renderer)
- **modules**: theme 组件、Settings 页面
- **interface_contract**:
  - `PATCH /api/settings` → body `{theme: "dark" | "light"}`
  - DOM `document.documentElement.dataset.theme`
- **测试类型**: E2E + feel-signoff
- **UX 参照**: `.aiassist/stories/codex-harness-desktop/ux/settings.html`
- **E2E 路径**: `tests/capabilities/internationalization-theme/theme/codex-harness-desktop/e2e/themeLanguage.spec.js`

**验收标准**：
- [ ] 切换主题后 `data-theme` 属性更新。
- [ ] 设置持久化，重启后保持。

---

## REQ-I18N-002: 语言切换

- **来源**：PRD §4.18 国际化
- **优先级**: P1
- **必须性**: 应该
- **capability**: `internationalization-theme`
- **entity**: `language`
- **scope**: cross-module
- **modules**: `settingsService`, i18n 层、Settings 页面
- **interface_contract**:
  - `PATCH /api/settings` → body `{language: "en-US" | "zh-CN"}`
  - CLI: `opc-workstation settings set --language <code>`
- **测试类型**: CLI + HTTP API + E2E
- **测试路径**: `tests/capabilities/internationalization-theme/language/codex-harness-desktop/api/`, `tests/capabilities/internationalization-theme/theme/codex-harness-desktop/e2e/themeLanguage.test.js`

**验收标准**：
- [ ] 支持 `zh-CN` / `en-US` 切换。
- [ ] 默认语言为 `en-US`。
- [ ] 持久化，重启后保持。

---

## REQ-CLI-001: CLI 产品入口

- **来源**：PRD §4.20 CLI 入口
- **优先级**: P0
- **必须性**: 必须
- **capability**: `command-interface`
- **entity**: `cli`
- **scope**: cross-module
- **modules**: `src/cli/opc-workstation.js`, `src/cli/server.js`, `src/http/server.js`
- **interface_contract**:
  - 全局 `--json` / `--pretty`
  - 未检测到 server 时自动启动 headless server
  - 退出码：`0` 成功，`1` 业务错误，`2` 系统错误
  - CLI 子命令最终都映射到 `src/http/routes/*` 的 REST 端点
- **测试类型**: CLI
- **测试路径**: `tests/capabilities/command-interface/cli/codex-harness-desktop/cli/`

**验收标准**：
- [ ] `opc-workstation --help` 显示子命令与全局选项。
- [ ] 任意子命令在未启动应用时能自动启动 headless server。
- [ ] 全局 `--pretty` 输出美化 JSON。
- [ ] 业务错误返回退出码 1，系统错误返回退出码 2。

---

## UX / 前端 REQ 可自动化检查结论

按 `/crystallize` 对涉及 `ux/*.html` 的 REQ 的强制检查，结论如下：

| REQ-ID | UX 参照 | 元素存在性 | 状态/交互 | 导航/路由 | API 调用 | 纯审美部分 |
|---|---|---|---|---|---|---|
| REQ-FLOW-003 | `flow-editor.html` | ✅ Node Palette 分类、画布节点 | ✅ 点击节点展开 Properties | ✅ 进入 `/flows/:id` | ✅ `GET /api/flows/:id` | React Flow 默认样式、动效 |
| REQ-FLOW-004 | `flow-editor.html` | ✅ 选中节点字段 | ✅ 未选中/选中状态切换 | ✅ 同页面状态切换 | ✅ `PATCH /api/flows/:id` | 面板排版、字体 |
| REQ-FLOW-005 | `flow-editor.html` | ✅ Run 按钮、Zoom 控件 | ✅ 运行状态切换 | ✅ 页面内交互 | ✅ `POST /api/executions` | 按钮动效、画布缩放动画 |
| REQ-SKILL-002 | `skills.html` | ✅ Tab 切换、README 渲染 | ✅ 弹层打开/关闭 | ✅ 列表 → 详情 | ✅ `GET /api/skills/:id` | 弹层动效、排版 |
| REQ-I18N-001 | `settings.html` | ✅ theme 控件 | ✅ 切换后 `data-theme` 变化 | ✅ Settings 页面 | ✅ `PATCH /api/settings` | 暗色/亮色视觉气质 |
| REQ-DASH-001 | `dashboard-overview.html` | ✅ 指标卡片、最近执行列表 | ✅ 数据加载状态 | ✅ Dashboard 路由 | ✅ `GET /api/dashboard` | 卡片布局、间距、动效 |

**结论**：以上 REQ 的结构与行为均可通过 E2E 自动化测试覆盖；纯颜色/间距/动效/排版审美留给 `/signoff --stage=feel` 验收。
