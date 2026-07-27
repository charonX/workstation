# 技术方案 — 嵌套子流程调用（Nested Subflow）Attempt 2

> 故事 ID：`2026-07-23-nested-flow`
> 版本：`v0.3`
> 最后更新：2026-07-27

---

## 设计目标

在 Attempt 1 的基础上，修正一个架构级缺陷：节点输出变量的发现机制是集中式 switch（`upstreamVariables.js`），每新增一种节点类型就要手动补分支，导致 `setVariables` 节点遗漏。Attempt 2 引入**统一节点输出模型**和**节点类型注册表**，使新增节点类型时只需注册一次，变量选择器、配置面板、节点面板自动识别。

## 关键变化（Attempt 2 vs Attempt 1）

| 方面 | Attempt 1 | Attempt 2 |
|---|---|---|
| 输出变量声明 | 异构：`agent.outputVariable`、`trigger.outputVariables`、`callFlow.outputMappings`、`setVariables.assignments` | **统一**：所有节点类型使用 `config.outputVariables: [{ name, type, defaultValue? }]` |
| 变量选择器 | `upstreamVariables.js` 按类型 switch | `upstreamVariables.js` 通读 `outputVariables`，节点类型注册 `deriveOutputVariables` |
| 节点面板/配置面板 | 静态列表 + 硬编码组件分发 | 统一节点类型注册表驱动 |
| setVariables 配置 | `config.assignments: [{ variableName, expression }]` | `config.outputVariables: [{ name, type }]` + `config.expressions: [{ name, expression }]` |
| callFlow 出参 | `config.outputMappings: [{ childVar, parentKey }]` | `config.outputVariables` 由 `flowService` 保存时根据目标子 flow 的 flowOutput 自动补全 |
| 数据迁移 | 需要启动 migration | **开发阶段无历史包袱**：清空旧数据，不 migration |

## 模块与边界

| 模块 | 职责 | 变更 |
|---|---|---|
| `src/renderer/components/flow/nodeRegistry.js` | **新增**：统一节点类型注册表，包含类型元数据、默认配置、配置面板组件、`deriveOutputVariables` | 新增 |
| `src/renderer/components/flow/NodePalette.jsx` | 从注册表读取节点类型列表 | 改造 |
| `src/renderer/components/flow/NodeConfigPanel.jsx` | 从注册表读取配置面板组件；统一输出变量编辑器 | 改造 |
| `src/renderer/components/flow/upstreamVariables.js` | 从注册表调用 `deriveOutputVariables`；移除按类型 switch | 改造 |
| `src/flowEngine/flowEngine.js` | 保持 D10 多输出机制：executor 返回 `outputVariables` plain object，引擎统一写入 | 不变 |
| `src/flowEngine/executors/*.js` | 每个 executor 按统一输出模型返回/写变量 | 部分改造 |
| `src/services/flowService.js` | 统一校验 `outputVariables` 名字规则；callFlow 保存时自动补全 outputVariables | 改造 |
| `src/services/taskService.js` | 不变（invokeSubflow、嵌套执行记录） | 不变 |
| `src/db.js` | 开发阶段不清空表结构；历史执行记录可丢弃 | 不变 |

## 节点类型注册表设计

```js
// src/renderer/components/flow/nodeRegistry.js
export const NODE_REGISTRY = {
  trigger: {
    type: "trigger",
    category: "trigger",
    icon: "⏱",
    defaultConfig: { outputVariables: [] },
    configPanel: DeclaredVariablesFields,
    deriveOutputVariables: (config) => config.outputVariables || [],
  },
  feishuMessage: {
    type: "feishuMessage",
    category: "trigger",
    icon: "✉️",
    defaultConfig: {
      outputVariables: [
        { name: "text", type: "string" },
        { name: "sender", type: "string" },
        { name: "messageId", type: "string" }
      ]
    },
    configPanel: FeishuMessageFields,
    deriveOutputVariables: (config) => config.outputVariables || [],
  },
  flowInput: {
    type: "flowInput",
    category: "trigger",
    icon: "⤵",
    defaultConfig: { outputVariables: [] },
    configPanel: DeclaredVariablesFields,
    deriveOutputVariables: (config) => config.outputVariables || [],
  },
  flowOutput: {
    type: "flowOutput",
    category: "flow",
    icon: "⤴",
    defaultConfig: { outputVariables: [] },
    configPanel: DeclaredVariablesFields,
    deriveOutputVariables: (config) => config.outputVariables || [],
  },
  agent: {
    type: "agent",
    category: "execution",
    icon: "◆",
    defaultConfig: { outputVariables: [{ name: "output", type: "string" }] },
    configPanel: AgentFields,
    deriveOutputVariables: (config) => config.outputVariables || [],
  },
  callFlow: {
    type: "callFlow",
    category: "logic",
    icon: "⎘",
    defaultConfig: { outputVariables: [], inputMappings: [] },
    configPanel: CallFlowFields,
    deriveOutputVariables: (config) => config.outputVariables || [],
  },
  setVariables: {
    type: "setVariables",
    category: "logic",
    icon: "=",
    defaultConfig: { outputVariables: [], expressions: [] },
    configPanel: SetVariablesFields,
    deriveOutputVariables: (config) => config.outputVariables || [],
  },
  // ... 其他节点类型
};
```

### 注册表契约

每个节点类型注册项必须提供：
- `type`：节点类型标识（camelCase，与 flowService 校验白名单对应）
- `category`：在 NodePalette 中的分类
- `icon`：图标
- `defaultConfig`：拖入画布时的默认配置，必须包含 `outputVariables`
- `configPanel`：React 组件，接收 `{ config, onChange, ...context }`
- `deriveOutputVariables(config)`：纯函数，返回 `[{ name, type, defaultValue? }]`

## 统一输出模型

### 输出变量声明契约

所有节点类型的输出变量声明统一为：

```ts
config.outputVariables: Array<{
  name: string;       // 变量名，符合 /^[a-zA-Z][a-zA-Z0-9_]*$/
  type?: string;      // 类型提示，一期不校验
  defaultValue?: any; // 默认值
}>
```

### 运行时写入契约

- 单输出节点（如 agent）：executor 仍返回 `result.output`，引擎按 `config.outputVariables[0].name` 写入 `nodeId.name` 和裸 `name`
- 多输出节点（如 setVariables、flowOutput、callFlow）：executor 返回 `result.outputVariables: { name: value }`，引擎遍历写入
- `lastOutput` 保持兼容：取 `result.output` 或 `result.outputVariables` 的第一个值

### 节点类型私有行为字段

`outputVariables` 只负责"下游可见变量名声明"，节点可以有其他私有字段描述"变量怎么来"：

| 节点类型 | outputVariables 声明 | 私有行为字段 |
|---|---|---|
| agent | `[{ name: "output" }]` | `provider`, `model`, `prompt` |
| setVariables | `[{ name: "text" }, { name: "messageId" }]` | `expressions: [{ name, expression }]` |
| callFlow | `[{ name: "savedUrl" }, { name: "title" }]` | `targetFlowId`, `targetInputNodeId`, `inputMappings` |
| trigger | `[{ name: "topic" }]` | 无 |
| feishuMessage | `[{ name: "text" }, { name: "sender" }, { name: "messageId" }]` | 无 |
| flowInput | `[{ name: "messageText" }]` | 无 |
| flowOutput | `[{ name: "savedUrl" }]` | 无 |

## 数据流

### 场景 1：从 NodePalette 拖入节点

1. `NodePalette` 从 `nodeRegistry` 读取类型列表，按 category 分组渲染。
2. 用户拖入类型 T，`FlowCanvas` 调用 `nodeRegistry[T].defaultConfig` 初始化节点 config。
3. 节点默认已包含正确的 `outputVariables`。

### 场景 2：配置面板编辑节点

1. `NodeConfigPanel` 从 `nodeRegistry` 读取 `configPanel` 组件并渲染。
2. 对于输出变量编辑器，复用通用 `DeclaredVariablesFields`。
3. `setVariables` 的配置面板同时维护 `outputVariables`（声明）和 `expressions`（求值逻辑）。
4. `callFlow` 的配置面板在选择子 flow / 入口后，由前端调用 API 获取子 flow 的 flowOutput 并集，写入 `outputVariables`；保存时 flowService 再次校验/补全。

### 场景 3：下游变量选择器

1. `VariablePicker` 调用 `getUpstreamVariableGroups(nodes, edges, currentNodeId)`。
2. `getUpstreamVariableGroups` 遍历上游节点，对每个节点调用 `nodeRegistry[type].deriveOutputVariables(config)`。
3. 返回的变量名自动以 `${nodeId}.${varName}` 暴露给下游。

### 场景 4：运行时执行

1. `flowEngine` 调用 executor，executor 返回 `result.outputVariables`。
2. 引擎统一写入 `context[nodeId.varName]` 和 `context[varName]`。
3. 节点类型之间的差异被封装在 executor 内部。

## 接口契约

### 接口 1：节点类型注册表

| 项目 | 说明 |
|---|---|
| 位置 | `src/renderer/components/flow/nodeRegistry.js` |
| 输出 | `NODE_REGISTRY: Record<string, NodeTypeRegistration>` |
| 稳定性 | renderer 侧稳定契约；新增节点类型必须在此注册 |

### 接口 2：deriveOutputVariables

| 项目 | 说明 |
|---|---|
| 调用方 | `upstreamVariables.js`、测试 |
| 被调用方 | 每个节点类型的注册项 |
| 输入 | `config: object` |
| 输出 | `Array<{ name: string, type?: string, defaultValue?: any }>` |
| 约束 | 纯函数，不访问外部状态；不抛异常 |

### 接口 3：flowService 保存时补全 callFlow outputVariables

| 项目 | 说明 |
|---|---|
| 调用方 | `flowService.updateFlow` / `createFlow` |
| 被调用方 | `flowService.validateSubflowCalls` 或辅助函数 |
| 输入 | `callFlowNode.config`、目标子 flow 的 nodeList |
| 输出 | 修改后的 callFlowNode.config.outputVariables |
| 行为 | 收集目标子 flow 所有 flowOutput 节点的 outputVariables 并集，按 name 去重，写入 callFlowNode.config.outputVariables |

## 关键决策

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| D11'：节点输出声明统一模型 | A 严格统一 / B 声明统一+私有字段保留 / C/D 其他 | **B（A'）** | `outputVariables` 统一声明下游可见变量名；节点类型保留私有字段描述求值/映射逻辑，避免语义变形 |
| D12：节点类型注册表 | A 只含 deriveOutputVariables / B 统一注册中心 | **B** | 新增节点类型时，NodePalette、NodeConfigPanel、upstreamVariables 都不再需要手动改 |
| D13：callFlow outputVariables 推导 | A renderer 侧 / B main 侧保存时 / C 用户手动 | **B** | callFlow 需要查询子 flow，renderer 侧跨进程查询太重；保存时由 flowService 自动补全 |
| D14：数据迁移 | A 启动 migration / B 懒加载 / C 不保留历史 | **C** | 项目开发阶段无发布历史，清空旧数据成本最低 |

## 测试 seams

| 稳定块 | seam | 测试类型 |
|---|---|---|
| 统一输出模型 | `nodeRegistry.deriveOutputVariables(type, config)` 每个类型 | 单元 |
| 变量选择器通用性 | `getUpstreamVariableGroups` 对任意 outputVariables | 单元 |
| 统一校验 | `flowService.validateNodeList` 对 outputVariables 名字规则 | 单元 |
| callFlow 自动补全 | `flowService.saveFlow` 后 callFlow.config.outputVariables | 集成 |
| setVariables 表达式 | `setVariablesExecutor` 按 expressions 求值返回 outputVariables | 单元 |
| 运行时写入 | `flowEngine.run()` 断言 outputVariables 写入 context | 单元 |
| 画布交互 | Playwright：拖入节点 → 下游变量选择器可见 | E2E |

## 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 快速验证 |
|---|---|---|---|
| 节点类型注册表能覆盖所有现有节点 | 某些节点（condition/forEach/while）输出语义特殊，无法简单用 outputVariables 描述 | TECH-DESIGN | 列出所有节点类型，逐一验证 |
| callFlow outputVariables 保存时补全足够 | 子 flow 在保存后被修改，父 flow 的 outputVariables 不同步 | PRD / TECH-DESIGN | 讨论是否需要在运行时重新推导 |
| 开发阶段清空历史数据可接受 | 用户后续发现需要保留某些测试 flow | 不回流——数据已清空，只能重新创建 | — |
| renderer 注册表不需要访问 main 状态 | 未来某些节点类型推导需要 DB 数据 | TECH-DESIGN | 当前方案预留「main 侧保存时补全」作为兜底 |

## 范围外

- 节点类型注册表不替代 executor 注册（`src/flowEngine/executors/index.js` 保持独立）
- 不引入 JSON Schema 或复杂类型系统
- 不做跨进程注册表同步（main 侧保留 callFlow 特殊处理）
- 不保留历史执行记录（开发阶段决策）

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.3 | 2026-07-27 | Attempt 2：统一节点输出模型 + 节点类型注册表；替换 v0.2 的异构输出字段设计 | AI + 人 |
| v0.2 | 2026-07-26 | Attempt 1：新增 setVariables 节点设计（D11） | AI + 人 |
| v0.1 | 2026-07-23 | Attempt 1 初稿 | AI + 人 |
