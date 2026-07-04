# Technical Design: codex-harness-desktop

> 由 `/tac-tech-design` 基于当前 PRD 重新推导生成。

---

## 1. 技术栈

- **桌面壳**：Electron
- **前端**：React + TypeScript + TailwindCSS + React Flow
- **主进程 / 引擎**：Node.js（现有 `src/` 服务层演进）
- **数据持久化**：
  - 应用配置：`~/.opc-workstation/settings.json`
  - 项目/流程/任务/执行/日志：SQLite（`~/.opc-workstation/data.sqlite`）
- **Agent 接入**：
  - Claude Code：Claude Agent SDK
  - Codex：OpenAI app-server / Codex CLI
- **定时调度**：Electron 主进程内运行（Node.js cron 库）

---

## 2. 模块边界

```
Renderer Process (React)
    │
    │ Electron IPC
    ▼
Main Process (Node.js)
├── SettingsService      ←→ settings.json
├── ProjectService       ←→ SQLite + file system
├── SkillService         ←→ SQLite + skill repo
├── ScheduleService      ──emits──▶ EventBus
├── TaskService          ◀──subscribes── EventBus
│   │
│   ├── reads Flow + Project from SQLite
│   ├── calls FlowEngine.run({ flow, project, inputVariables, executors, onEvent })
│   └── writes Execution + logs to SQLite
│
├── FlowEngine           (pure, 无外部依赖)
│   ├── 拓扑排序执行 nodes
│   ├── 调用 injected executors
│   ├── 重试策略
│   └── 通过 onEvent 回调报告进度
│
├── AgentAdapter         (被 agentExecutor 封装)
│   ├── Claude Code SDK
│   └── Codex app-server / CLI
│
└── LogService           ←→ SQLite
```

### 2.1 关键边界约定

- **TaskService 是创建 Execution 的唯一入口**。ScheduleService 到点后只发事件，不直接创建 Execution。
- **FlowEngine 是纯函数**：不读 SQLite、不写日志、不感知 UI。输入数据由 TaskService 组装后传入。
- **FlowEngine 不感知 AgentAdapter**：agent 节点只是一个普通 executor，其内部调用 AgentAdapter。
- **ScheduleService 只负责"到点发事件"**，不负责执行流程或写历史。

---

## 3. 数据流

### 3.1 手动触发任务

```
用户点击 "Run"
  → Renderer IPC → TaskService.createTask({ projectId, flowId, trigger: "manual" })
  → TaskService 从 SQLite 读取 Flow + Project
  → TaskService 组装 inputVariables（Project 元数据 + trigger 上下文）
  → TaskService 调用 FlowEngine.run({
        flow,
        project,
        inputVariables,
        executors,
        onEvent: (event) => { LogService.write(event); IPC to renderer; }
    })
  → FlowEngine 按拓扑顺序执行节点
  → 每个 executor 返回 { status, output, logs, error }
  → FlowEngine 合并 output 到上下文
  → 节点失败则重试一次，再次失败则 Execution 失败
  → FlowEngine 返回最终结果
  → TaskService 更新 Execution（status, duration, output）
```

### 3.2 定时触发任务

```
ScheduleService.start()
  → 从 SQLite 加载 enabled schedules
  → 注册 cron jobs
  → 到点后 emit "schedule:triggered"({ scheduleId, projectId, flowId })

TaskService 订阅 "schedule:triggered"
  → TaskService.createTask({ projectId, flowId, trigger: "schedule" })
  → 后续流程与手动触发相同
```

---

## 4. 接口契约

### 4.1 FlowEngine.run

```ts
interface RunFlowInput {
  flow: Flow;              // 包含 nodes、edges、scheduleEnabled 等
  project: Project;        // 项目元数据
  inputVariables: Record<string, unknown>;
  executors: Record<string, NodeExecutor>;
  onEvent: (event: FlowEvent) => void;
}

interface RunFlowOutput {
  status: "success" | "error";
  output?: unknown;
  error?: string;
}

function run(input: RunFlowInput): Promise<RunFlowOutput>;
```

### 4.2 NodeExecutor

```ts
interface NodeExecutorInput {
  node: Node;
  context: Record<string, unknown>; // 当前累积上下文
  project: Project;
}

interface NodeExecutorOutput {
  status: "success" | "error";
  output?: unknown;
  logs?: Array<{ at: string; message: string }>;
  error?: string;
}

type NodeExecutor = (input: NodeExecutorInput) => Promise<NodeExecutorOutput>;
```

**重试策略**：`status === "error"` 时重试一次；再次失败则整个 Execution 标记为 `error`。

### 4.3 AgentExecutor → AgentAdapter

```ts
// AgentExecutor 是 NodeExecutor 的一种实现
async function agentExecutor(input: NodeExecutorInput): Promise<NodeExecutorOutput> {
  const result = await agentAdapter.execute({
    agentType: input.node.config.agentType, // "claude-code" | "codex"
    systemPrompt: input.node.config.systemPrompt,
    model: input.node.config.model,
    inputVariables: input.context
  });
  return {
    status: result.status,
    output: result.output,
    logs: result.logs
  };
}

// AgentAdapter
interface AgentExecuteInput {
  agentType: "claude-code" | "codex";
  systemPrompt?: string;
  model?: string;
  inputVariables: Record<string, unknown>;
}

interface AgentExecuteOutput {
  status: "success" | "error";
  output?: unknown;
  logs: Array<{ at: string; message: string }>;
  error?: string;
}

function execute(input: AgentExecuteInput): Promise<AgentExecuteOutput>;
```

### 4.4 ScheduleService

```ts
function start(): void;   // 加载 enabled schedules，注册 cron jobs
function stop(): void;    // 取消所有 cron jobs
function createSchedule(input: { projectId, flowId, cron }): Schedule;
function toggleSchedule(id: string): Schedule | undefined;
function deleteSchedule(id: string): boolean;
```

** missed schedules 策略**：应用关闭期间错过的任务不补执行。

### 4.5 TaskService

```ts
function createTask(input: {
  projectId: string;
  flowId: string;
  trigger: "manual" | "schedule";
}): Promise<Execution>;

function listExecutions(): Execution[];
function getExecution(id: string): Execution | undefined;
```

---

## 5. 事件总线

ScheduleService 与 TaskService 之间使用轻量级事件总线解耦。

| 事件 | 发布者 | 订阅者 | payload |
|---|---|---|---|
| `schedule:triggered` | ScheduleService | TaskService | `{ scheduleId, projectId, flowId }` |
| `execution:started` | TaskService / FlowEngine callback | UI / LogService | `{ executionId, projectId, flowId }` |
| `execution:node:started` | FlowEngine callback | UI / LogService | `{ executionId, nodeId, nodeType }` |
| `execution:node:completed` | FlowEngine callback | UI / LogService | `{ executionId, nodeId, output }` |
| `execution:node:failed` | FlowEngine callback | UI / LogService | `{ executionId, nodeId, error }` |
| `execution:completed` | FlowEngine callback | UI / LogService | `{ executionId, status, duration, output }` |

---

## 6. SQLite Schema

```sql
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

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  repoPath TEXT NOT NULL,
  version TEXT,
  dependencies TEXT -- JSON array
);

CREATE TABLE project_skills (
  projectId TEXT NOT NULL,
  skillId TEXT NOT NULL,
  PRIMARY KEY (projectId, skillId)
);

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

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  flowId TEXT NOT NULL,
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

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

## 7. 测试 seams

| 稳定块 | Seam | 测试方式 |
|---|---|---|
| Workspace/Settings | SettingsService | 单元测试：JSON 文件读写 + 验证规则 |
| 项目导入 | ProjectService + git 子进程 mock | 单元测试 + 集成测试（临时目录） |
| Skill 链接 | SkillService | 单元测试：SQLite |
| Flow 编排 | FlowEngine + mock executors + callback | 单元测试：验证拓扑、上下文合并、重试 |
| Agent 节点 | agentExecutor + mock AgentAdapter | 单元测试：验证调用协议 |
| Agent 适配 | AgentAdapter + mock SDK/CLI | 单元测试：验证 Claude Code / Codex 协议 |
| Schedule | ScheduleService + 虚拟时间/事件监听 | 单元测试：验证 cron 触发后事件发布 |
| Execution / Logs | TaskService + mock FlowEngine + SQLite | 集成测试：验证事件写入和查询 |
| 主题切换 | theme.ts + DOM mock | 单元测试 |
| Electron IPC | preload + main handlers | 集成测试：playwright-electron 或自定义 harness |

---

## 8. 风险与回退

| 风险 | 影响 | 验证方式 | 回退方案 |
|---|---|---|---|
| Agent SDK / Codex 调用不稳定 | Agent 节点无法可靠执行 | spike：最小任务验证调用协议 | 降级为本地 CLI 子进程调用 |
| SQLite 主进程并发写入冲突 | 日志丢失 | 集成测试 + 单线程事件队列 | 串行化写操作 |
| React Flow 与 Electron 兼容性 | 画布交互异常 | 原型验证 | 自绘 SVG/Canvas |
| cron 调度器应用关闭丢失任务 | 定时任务不执行 | 产品决策已接受 | 已在设计中接受 |
| FlowEngine 拓扑排序错误 | 节点执行顺序错误 | 单元测试覆盖 DAG 场景 | 限制 MVP 只支持线性流程 |

---

## 9. 与 PRD 的同步

当前 `prd.md` 已包含以下技术决策：

- 技术栈：Electron + React + TypeScript + TailwindCSS + React Flow
- 数据存储：JSON（settings）+ SQLite（元数据与日志）
- 架构分层：UI / Electron Main Process / Core Services / External Agents

本 `tech-design.md` 在 PRD 基础上进一步明确了：

- TaskService 是 Execution 创建的唯一入口。
- FlowEngine 为纯函数，由 TaskService 注入数据和 executors。
- ScheduleService 通过事件总线触发 TaskService。
- AgentAdapter 对 FlowEngine 透明，封装在 agentExecutor 中。
- executor 返回显式 status 对象，FlowEngine 执行一次重试。
- 节点接收全量累积上下文。

---

## 10. 下一步

1. 引入 SQLite 并迁移 `ProjectService`、`FlowService`、`TaskService`、`SkillService`。
2. 实现 `FlowEngine.run` 骨架：拓扑排序、上下文合并、executor 调用、重试、事件回调。
3. 实现最小 `AgentAdapter` spike，验证 Claude Code / Codex 调用协议。
4. 实现 `ScheduleService` + 事件总线 + `TaskService` 订阅。
5. 搭建 Electron 主进程 + React 渲染进程最小壳。
