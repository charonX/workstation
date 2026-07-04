# Technical Design: codex-harness-desktop

> 由 `/tac-tech-design` 生成。承接 `prd.md`，把 PRD 稳定块翻译成系统语言、模块边界、接口契约和测试 seams。

---

## 1. 技术栈

- **桌面壳**：Electron
- **前端**：React + TypeScript + TailwindCSS + React Flow
- **主进程 / 引擎**：Node.js（复用现有 `src/` 服务层）
- **数据持久化**：
  - 应用配置（Workspace 根目录、Skill 仓库路径、主题）：JSON 文件（`~/.opc-workstation/settings.json`）
  - 项目/流程/任务元数据 + 执行日志：SQLite（`~/.opc-workstation/data.sqlite`）
- **Agent 接入**：
  - Claude Code：Claude Agent SDK
  - Codex：OpenAI app-server / Codex CLI
- **定时调度**：Node.js 主进程内运行（`node-cron` 或 `node-schedule`）

---

## 2. 架构分层

```
┌─────────────────────────────────────────────┐
│  Renderer Process (React + React Flow)      │
│  - Workspace/Project 管理                    │
│  - Flows 列表页与流程编辑器                    │
│  - Tasks 页面                                │
│  - Skills 列表与 Skill 详情                  │
│  - Settings 页面                             │
├─────────────────────────────────────────────┤
│  Electron IPC Bridge                         │
│  - preload 暴露有限 API                      │
│  - main process handlers 调用核心服务         │
├─────────────────────────────────────────────┤
│  Main Process / Engine (Node.js)             │
│  - ProjectService                            │
│  - SkillService                              │
│  - FlowEngine                                │
│  - AgentAdapter                              │
│  - ScheduleService                           │
│  - TaskService                               │
│  - LogService                                │
│  - SettingsService                           │
├─────────────────────────────────────────────┤
│  External Agents                             │
│  - Claude Code (Agent SDK)                   │
│  - Codex (app-server / CLI)                  │
└─────────────────────────────────────────────┘
```

---

## 3. 模块职责与边界

### 3.1 ProjectService

- **职责**：管理 Workspace 和项目元数据；支持本地目录和 git 仓库导入。
- **边界**：
  - 只维护项目元数据（id、name、sourceType、localPath、repoUrl、branch、updatedAt）。
  - 不直接执行 git clone；调用 `git` 子进程或 Node.js git 库。
  - 不感知 UI 表现（如是否显示 local/git 标签）。
- **持久化**：项目元数据写入 SQLite `projects` 表。

### 3.2 SkillService

- **职责**：读取 skill 仓库，维护项目到 skill 的链接关系。
- **边界**：
  - skill 元数据（name、description、repoPath、version、dependencies）只读解析。
  - 链接关系维护在 SQLite `project_skills` 表；实际软链接在应用运行时按需创建/校验。
  - 不直接调用 agent。

### 3.3 FlowEngine

- **职责**：解析流程图，按拓扑顺序执行节点，处理数据流和错误。
- **边界**：
  - 输入：Flow ID + Project ID + trigger context。
  - 输出：Execution 对象（status、duration、nodesRun、logs、variables、output）。
  - 通过事件总线发布执行事件；不直接操作 UI。
- **执行策略**：
  - 节点按拓扑排序执行。
  - 单个节点失败后**重试一次**；再次失败则整个 Execution 标记为 `error`。
  - Agent 节点调用 AgentAdapter；其余节点在进程内同步/异步执行。

### 3.4 AgentAdapter

- **职责**：统一抽象不同 agent 的调用协议。
- **边界**：
  - 输入：agentType（"claude-code" | "codex"）、nodeConfig、inputVariables。
  - 输出：{ status, output, logs }。
  - 内部通过子进程或 SDK 调用实际 agent。
  - 超时、重试、日志收集在 Adapter 内部处理。

### 3.5 ScheduleService

- **职责**：基于 cron 表达式定时触发流程。
- **边界**：
  - 只负责"到点就触发"，不维护 Execution 详情（交给 TaskService）。
  - 调度器随应用启动而启动，随应用关闭而停止；**错过的任务不补执行**。
  - 启用/停用状态持久化在 SQLite `schedules` 表。

### 3.6 TaskService

- **职责**：把"流程 + 项目"组合成一次运行（Execution），支持手动触发和查看历史。
- **边界**：
  - 手动触发：`createTask({ projectId, flowId, trigger })` 创建 Execution 并交给 FlowEngine。
  - 定时触发：ScheduleService 到点后调用 `createTask`。
  - Execution 详情（logs/variables/output）只读暴露给 UI。

### 3.7 LogService

- **职责**：把执行日志写入 SQLite，支持按 execution/project/flow 查询。
- **边界**：
  - 只写结构化日志（time、node、status、message）。
  - 不解析日志内容。

### 3.8 SettingsService

- **职责**：持久化应用级配置。
- **边界**：
  - 配置项：workspaceRoot、skillRepoPath、theme。
  - 使用 JSON 文件持久化；验证规则（如 workspaceRoot 不能为空）内聚在服务中。

---

## 4. 数据模型

### 4.1 SQLite Schema（初稿）

```sql
-- projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sourceType TEXT NOT NULL, -- local | git
  repoUrl TEXT,
  branch TEXT,
  localPath TEXT,
  updatedAt TEXT NOT NULL
);

-- skills
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  repoPath TEXT NOT NULL,
  version TEXT,
  dependencies TEXT -- JSON array
);

-- project_skills
CREATE TABLE project_skills (
  projectId TEXT NOT NULL,
  skillId TEXT NOT NULL,
  PRIMARY KEY (projectId, skillId)
);

-- flows
CREATE TABLE flows (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  nodeList TEXT NOT NULL, -- JSON
  edges TEXT NOT NULL,    -- JSON
  scheduleEnabled INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT NOT NULL
);

-- schedules
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  flowId TEXT NOT NULL,
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

-- executions
CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  flowId TEXT NOT NULL,
  trigger TEXT NOT NULL, -- manual | schedule
  status TEXT NOT NULL,  -- running | success | error
  startedAt TEXT NOT NULL,
  endedAt TEXT,
  duration TEXT,
  nodesRun INTEGER NOT NULL DEFAULT 0,
  variables TEXT, -- JSON
  output TEXT     -- JSON
);

-- logs
CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  executionId TEXT NOT NULL,
  at TEXT NOT NULL,
  node TEXT,
  status TEXT,
  message TEXT
);
```

---

## 5. 事件总线

FlowEngine 通过事件总线与外部模块通信，避免直接耦合。

| 事件 | 发布者 | 订阅者 |  payload |
|---|---|---|---|
| `execution:started` | FlowEngine | TaskService / UI | { executionId, projectId, flowId } |
| `execution:node:started` | FlowEngine | LogService / UI | { executionId, nodeId, nodeType } |
| `execution:node:completed` | FlowEngine | LogService / UI | { executionId, nodeId, output } |
| `execution:node:failed` | FlowEngine | LogService / UI | { executionId, nodeId, error } |
| `execution:completed` | FlowEngine | TaskService / UI | { executionId, status, duration, output } |
| `schedule:triggered` | ScheduleService | TaskService | { scheduleId, projectId, flowId } |

---

## 6. 接口契约示例

### 6.1 FlowEngine.runFlow

```ts
interface RunFlowInput {
  projectId: string;
  flowId: string;
  trigger: "manual" | "schedule";
}

interface RunFlowOutput {
  executionId: string;
  status: "running" | "success" | "error";
}

function runFlow(input: RunFlowInput): Promise<RunFlowOutput>;
```

### 6.2 AgentAdapter.execute

```ts
interface AgentExecuteInput {
  agentType: "claude-code" | "codex";
  systemPrompt?: string;
  model?: string;
  inputVariables: Record<string, unknown>;
}

interface AgentExecuteOutput {
  status: "success" | "error";
  output: unknown;
  logs: Array<{ at: string; message: string }>;
}

function execute(input: AgentExecuteInput): Promise<AgentExecuteOutput>;
```

### 6.3 ScheduleService.start/stop

```ts
function start(): void; // 加载所有 enabled schedules 并注册 cron jobs
function stop(): void;  // 取消所有 cron jobs
function createSchedule(input: { projectId, flowId, cron }): Schedule;
function toggleSchedule(id: string): Schedule | undefined;
```

---

## 7. 测试 seams

| 稳定块 | Seam | 测试方式 |
|---|---|---|
| Workspace/Settings | SettingsService | 单元测试：文件读写 + 验证规则 |
| 项目导入 | ProjectService + git 子进程 mock | 单元测试 + 集成测试（临时目录） |
| Skill 链接 | SkillService | 单元测试：内存/ SQLite |
| Flow 编排 | FlowEngine + mock 节点执行器 | 单元测试：验证拓扑顺序、数据传递、错误重试 |
| Agent 节点 | AgentAdapter + mock SDK/子进程 | 单元测试：验证调用协议 |
| Schedule | ScheduleService + 虚拟时间 | 单元测试：验证 cron 触发逻辑 |
| Execution / Logs | TaskService + LogService | 集成测试：验证事件写入和查询 |
| 主题切换 | theme.ts + DOM mock | 单元测试 |
| Electron IPC | preload + main handlers | 集成测试：使用 playwright-electron 或自定义 harness |

---

## 8. 风险与回退点

| 风险 | 影响 | 验证方式 | 回退方案 |
|---|---|---|---|
| Agent SDK / Codex app-server 调用不稳定 | Agent 节点无法可靠执行 | spike：用最小任务验证调用协议 | 降级为调用本地 Claude Code / Codex CLI 子进程 |
| SQLite 在 Electron 主进程中的并发写入 | 日志丢失或锁冲突 | 集成测试 + 实际并发场景 | 使用单线程事件队列串行化写操作 |
| React Flow 与 Electron 渲染进程兼容性 | 画布交互异常 | 原型验证 | 换用更基础的 SVG/Canvas 自绘 |
| cron 调度器在应用关闭时丢失任务 | 定时任务不执行 | 明确产品决策：错过不补 | 已在 PRD/tech-design 中接受 |

---

## 9. 与 PRD 的反向同步

根据 `/tac-tech-design` 讨论，已更新 `prd.md`：

- 技术栈从 **Tauri** 调整为 **Electron**（§2、§4.1、§6.1、§7.2）。
- 架构图从 "Tauri Commands (Rust Bridge)" 调整为 "Electron Main Process / Node.js 引擎"。

---

## 10. 下一步

1. 在 `architecture.md` 中记录 Electron 决策（已完成）。
2. 引入 SQLite 依赖并迁移 `ProjectService`、`FlowService`、`TaskService`、`SkillService` 到持久化存储。
3. 实现 `FlowEngine` 骨架：拓扑排序、事件总线、节点执行器注册。
4. 实现 `AgentAdapter` 的最小 spike，验证 Claude Code / Codex 调用协议。
5. 实现 `ScheduleService` 和 cron 调度器。
6. 搭建 Electron 主进程 + React 渲染进程的最小可运行壳。
