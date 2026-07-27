# ADR-010: 统一节点输出模型与节点类型注册表

## 状态

已接受

## 日期

2026-07-27

## 上下文

在实现 `2026-07-23-nested-flow`（嵌套子流程调用）过程中，新增 `setVariables` 节点后发现：

- `src/renderer/components/flow/upstreamVariables.js` 使用集中式 `switch` 按节点类型推导下游可见变量；
- 每新增一种节点类型（flowInput、flowOutput、callFlow、setVariables）都要手动到 `upstreamVariables.js` 补分支；
- `setVariables` 节点因此遗漏，导致下游变量选择器选不到它的输出变量（BUG-001）。

同时，现有节点类型的输出变量声明位置各异：

- `agent` 用 `config.outputVariable`（单字符串）；
- `trigger` / `feishuMessage` / `flowInput` / `flowOutput` 用 `config.outputVariables`（数组）；
- `callFlow` 用 `config.outputMappings`（子→父映射）；
- `setVariables` 用 `config.assignments`（表达式+变量名）。

这种异构性导致：变量选择器、配置面板、保存校验、运行时写入四处都需要知道每种类型的特殊字段。

## 决策

1. **统一节点输出声明**：所有节点类型统一使用 `config.outputVariables: [{ name, type?, defaultValue? }]` 声明对下游可见的变量名。
2. **声明与行为分离**：`outputVariables` 只负责"暴露什么变量名"；节点类型可保留私有字段描述"变量怎么算出来"（如 `setVariables.expressions`、`callFlow.inputMappings`）。
3. **引入 renderer 侧节点类型注册表**：`src/renderer/components/flow/nodeRegistry.js` 统一注册节点类型的元数据、默认配置、配置面板组件、输出变量推导函数。
4. **`callFlow` 输出变量由 main 侧保存时补全**：因为推导需要查询目标子 flow，避免 renderer 跨进程查 DB。
5. **开发阶段不保留历史数据**：项目尚未发布，直接清空旧数据，不做 migration。

## 后果

### 正面

- 新增节点类型时只需在 `nodeRegistry.js` 注册一次，无需再改 `upstreamVariables.js`；
- `upstreamVariables.js` 完全通用，只依赖 `outputVariables`；
- 保存校验、变量选择器、配置面板都基于同一契约；
- 未来 agent 节点天然支持多输出（`outputVariables` 数组）。

### 负面

- 需要对现有节点类型做一次重构：`agent` 改 `outputVariable` → `outputVariables`；`callFlow` 移除 `outputMappings`；`setVariables` 改 `assignments` → `outputVariables` + `expressions`；
- 开发阶段历史 flow / 执行记录会被清空；
- `nodeRegistry` 成为 renderer 侧的中心化依赖，需要避免循环依赖。

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| **A. 严格统一所有字段到 outputVariables** | 会把 `expression`、`inputMappings` 等实现细节硬塞进声明层，语义变形 |
| **B. 集中式 switch 换到 flowService** | 只是移动了 switch，没解决"新增节点要改多处"的问题 |
| **C. renderer 通过 IPC 查询 main 推导 callFlow 输出** | 使异步的变量选择器复杂化，且引入跨进程耦合 |
| **D. 启动 migration 保留历史数据** | 项目未发布，migration 成本高、收益低 |

## 相关文件

- `.aiassist/stories/2026-07-23-nested-flow/tech-design.md`
- `.aiassist/stories/2026-07-23-nested-flow/prd.md`
- `src/renderer/components/flow/nodeRegistry.js`（新增）
- `src/renderer/components/flow/upstreamVariables.js`
- `src/renderer/components/flow/NodePalette.jsx`
- `src/renderer/components/flow/NodeConfigPanel.jsx`
- `src/services/flowService.js`
- `src/flowEngine/flowEngine.js`

## 相关 ADR

- ADR-008（子流程内联同步执行 + services 注入模式）：callFlow 运行时仍遵循 ADR-008，仅输出变量声明方式改变。
