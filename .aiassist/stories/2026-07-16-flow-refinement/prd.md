# Flow 细化

## 1. 问题陈述

当前 Workstation 的 FlowEngine 和 Flow Editor 已经能跑基础顺序执行，但**节点配置面板的语义严重缺失**——节点可以画出来，却说不清“输入从哪里来、条件怎么写、输出到哪里去、失败怎么办”。具体表现为：

- **Trigger 节点**：无法声明 flow 被触发时有哪些输入变量，下游节点没有可用变量。
- **Condition 节点**：画布上看不出哪个出口是 true、哪个是 false；判断条件只能手敲，没有变量辅助；表达式写错只能在运行时才发现。
- **Agent 节点**：输入来源不明确，prompt 里无法引用上游变量；输出变量无法声明，执行结果散落无法被下游使用。
- **错误处理**：节点一旦失败就抛异常终止整个 flow，没有重试、没有忽略、没有降级手段。

结果是：稍微复杂的 flow（例如“读取项目文件 → 让 agent 分析 → 根据结果分支处理”）就写不下去，用户被迫把逻辑拆到外部脚本里，违背了 Workstation 把流程化步骤交给应用稳定执行的初衷。

## 2. 解决方案

系统化重做 **Trigger / Condition / Claude Agent** 三个核心节点的配置体验，并引入带类型的变量注册表：

1. **变量注册表**：FlowEngine 执行时按 `节点ID.变量名` 的命名空间收集所有节点输出变量；前端变量选择器按节点分组展示，用户无需记忆节点 ID。
2. **Trigger 节点**：允许用户声明 flow 入口变量（名称 / 类型 / 默认值），作为整个 flow 的初始 context。
3. **Condition 节点**：提供 JS 表达式输入框 + 变量选择器；画布和属性面板清楚标识 true/false 两个出口。
4. **Claude Agent 节点**：统一 prompt 文本框支持变量插入；可选择模型/参数；声明输出变量；API response 的文本内容作为字符串写入该变量。
5. **节点级错误处理**：每个节点可配置重试次数，以及失败时是终止 flow 还是忽略并继续。
6. **执行日志持久化**：每个节点的输入、输出、分支选择、错误信息、重试次数都写入执行日志；日志默认保留 7 天，到期自动清理。

## 3. 用户故事

1. **作为用户**，我可以在 Trigger 节点声明 flow 的输入变量（如 `repoPath`、`taskDescription`），这样手动触发或调度触发时知道要填什么参数。
2. **作为用户**，我可以在 Condition 节点用变量选择器从下拉列表里选择上游变量，并写 JS 表达式判断，这样不必记忆变量名和节点 ID。
3. **作为用户**，我可以在画布上清楚看到 Condition 节点的两个出口分别对应 true 和 false，这样不会连错分支。
4. **作为用户**，我可以在 Claude Agent 节点写一段 prompt，并用 `{{n1.result}}` 或变量选择器插入上游变量，让 agent 基于上下文工作。
5. **作为用户**，我可以在 Claude Agent 节点声明一个输出变量（如 `summary`），这样下游节点能引用 agent 返回的文本。
6. **作为用户**，我可以为每个节点设置重试次数和失败策略，这样某个 agent 调用偶发失败时不会直接终止整个流程。
7. **作为用户**，我可以在执行日志里看到每个节点的输入变量、输出变量和分支选择，这样调试 flow 时知道数据是怎么流动的。
8. **作为用户**，我可以回看历史执行的日志，包括 agent 调用的完整记录，但日志不会无限膨胀（默认只保留 7 天）。

## 4. 稳定块

以下部分在需求访谈中已经明确，可进入下一阶段结晶为 REQ：

1. **节点范围**：本次只改造 Trigger、Condition、Claude Agent 三个节点；ForEach / While / Data / Output 等节点保持现状。
2. **变量命名空间**：节点输出变量采用 `节点ID.变量名` 格式保证全局唯一；UI 自动处理命名空间，用户看到按节点分组的友好名称。
3. **变量类型**：基础四种 `string` / `number` / `array` / `object`；用于 UI 提示和保存前校验，不做严格运行时类型检查。保存节点配置时，若变量类型与已声明类型不匹配（如表达式引用了未声明的变量、数组被当作字符串使用），前端阻止保存并提示错误；后端 API 拒绝非法配置。
4. **Trigger 节点**：必须支持声明一个或多个输出变量，每个变量包含名称、类型、默认值。
5. **Condition 节点**：使用 JavaScript 表达式判断；结果映射为 `true` / `false` 两个出口；表达式输入支持变量选择器。**本 story 不承诺运行时前的表达式语法校验**；表达式写错仍在运行时按 error/fatal 处理，是否提供静态校验/高亮属于移动块 4 的决策范围。
6. **Claude Agent 节点**：通过统一 adapter 接口调用；具体 provider/SDK 在 tech-design 阶段决策；prompt 支持变量插入；输出为纯字符串；默认工作目录为 flow 所属项目的本地路径。
7. **错误处理**：Trigger / Condition / Claude Agent 三个节点均支持配置“重试次数”和“失败时忽略/继续”；失败忽略时该节点输出变量按配置的 fallback 处理，默认空字符串。
8. **执行日志持久化**：flow 每次执行生成执行记录，包含每个节点的输入变量、输出变量、分支选择、错误信息、重试次数和 agent 调用详情；日志默认保留 7 天，到期自动清理。agent 调用详情的最小字段清单为：`prompt`、`output`、`model`、`provider`、`status`、`error`、`durationMs`、`attemptCount`。完整 prompt 默认脱敏/截断存储（前 4000 字符），敏感信息通过环境变量或 settings 注入时不写入日志。
9. **现有架构不变**：FlowEngine 保持纯函数；发布/草稿快照机制不变；节点数据模型（nodeList / edges）保持兼容，仅在 `config` 中扩展字段。
10. **悬空引用处理**：上游节点删除或重命名变量后，下游节点中引用该变量的表达式/prompt 在保存时不做强制阻断，但执行时按以下规则处理：变量不存在时替换为空字符串，Condition 表达式按 JavaScript 语义处理 `undefined`（通常导致 false 分支），Claude Agent prompt 中显示为空。前端变量选择器实时刷新，删除后不再显示已删除变量。

## 5. 移动块

以下部分还需要在 PRD 审查或 tech-design 阶段进一步决策，暂不结晶为硬性 REQ：

1. **Claude Agent provider/SDK 选择**：使用 Anthropic Messages API / Claude SDK、OpenAI Responses API，还是抽象一个 provider 模型同时支持多个？
2. **API key / 凭证存储方式**：写入 settings JSON、通过环境变量读取、还是使用系统 keychain？
3. **变量选择器 UI 细节**：是否显示变量类型图标/标签？是否支持搜索/筛选？
4. **Condition 表达式编辑体验**：是否提供语法高亮、简单校验、或错误提示？
5. **Claude Agent 可配置参数**：除模型外，是否暴露 temperature、maxTokens、systemPrompt 等参数？
6. **执行日志保留策略**：7 天是按自然日、执行次数，还是大小限制？清理任务是在应用启动时执行，还是后台定时执行？

## 6. 实现决策

### 6.1 模块 / 服务边界

为控制耦合，本次改造按以下边界拆分：

| 模块 | 职责 | 不越界 |
|---|---|---|
| `FlowEngine` | 执行 flow；维护变量注册表；按节点命名空间写入变量；读取节点错误策略并执行重试/忽略。 | 不感知具体 agent SDK；不直接读写数据库。 |
| `claudeAgentAdapter` | 抽象 Claude Agent 调用接口；把统一 prompt/参数翻译成具体 SDK 调用；返回文本输出。 | 不维护变量状态；不决定工作目录（由调用方传入）。 |
| `flowService` | 保存/读取 flow 与节点配置；提供节点类型元数据（可配置字段、端口定义）。 | 不执行 flow；不直接调用 agent。 |
| `projectService` | 提供 flow 所属项目的本地路径，供 Claude Agent 作为工作目录。 | 不感知 flow 节点细节。 |
| `settingsService` | 存储 Claude Agent 所需的 API key / provider 偏好。 | 不直接参与 flow 执行。 |
| 前端 Flow Editor | 渲染画布与属性面板；提供变量选择器；校验字段类型与必填项。 | 不直接执行表达式或调用 agent。 |

### 6.2 关键接口契约

#### 6.2.1 变量注册表（FlowEngine 内部）

```
VariableRegistry := Map<nodeId, Map<variableName, { type, value }>>
FullName         := `${nodeId}.${variableName}`
```

- 每个节点执行成功后，如果声明了 `outputVariable`，则写入 `registry[nodeId][outputVariable]`。
- 下游节点的变量选择器看到的是扁平列表，但每个条目携带 `fullName`、`nodeId`、`nodeName`、`variableName`、`type`。
- Condition 表达式和 Claude Agent prompt 中，变量引用使用 `fullName`；UI 自动插入 `fullName`。

#### 6.2.2 Claude Agent Adapter 接口

```
interface ClaudeAgentAdapter {
  execute(input: {
    prompt: string;           // 已替换变量后的最终文本
    model?: string;           // 模型标识
    projectPath?: string;     // 工作目录
    options?: object;         // 额外参数（temperature 等）
    apiKey?: string;          // 凭证
  }): Promise<{
    status: "success" | "error" | "fatal";
    output?: string;          // 文本输出
    error?: string;
    logs?: Array<{ at: string; message: string }>;
  }>;
}
```

- 适配器负责把统一输入映射到 Claude Agent SDK。
- FlowEngine 只调用统一接口，不依赖具体 SDK 实现细节。

#### 6.2.3 节点配置 schema（config 字段扩展）

**Trigger**
```json
{
  "type": "trigger",
  "config": {
    "outputVariables": [
      { "name": "repoPath", "type": "string", "defaultValue": "" }
    ],
    "retries": 1,
    "onError": "fail" | "ignore"
  }
}
```

**Condition**
```json
{
  "type": "condition",
  "config": {
    "expression": "n1.count > 3",
    "retries": 1,
    "onError": "fail" | "ignore"
  }
}
```

**Claude Agent**
```json
{
  "type": "agent",
  "config": {
    "provider": "anthropic",
    "model": "claude-sonnet-5",
    "outputVariable": "summary",
    "prompt": "Summarize {{n1.result}}",
    "retries": 1,
    "onError": "fail" | "ignore"
  }
}
```

### 6.3 错误处理策略

- 节点执行返回 `error` 时，先按 `retries` 重试；重试耗尽后按 `onError` 处理。
- `onError: fail`：终止整个 flow（现有行为）。
- `onError: ignore`：该节点视为执行成功，但输出变量按 fallback 处理（默认空字符串），flow 继续执行下游。
- 适配器返回 `fatal` 时直接终止，不进入重试逻辑。

### 6.4 变量替换机制

- Claude Agent prompt 中的变量引用语法暂定 `{{fullName}}`，例如 `{{n1.result}}`。
- Condition 表达式直接使用 `fullName`，例如 `n1.count > 3`。
- 执行前由 FlowEngine 或 adapter 调用统一替换器，把 `{{fullName}}` 替换为 registry 中的实际值。

## 7. 测试决策

### 7.1 测试 seams

| seam | 测试类型 | 验证内容 |
|---|---|---|
| FlowEngine 变量注册表 | unit | 节点输出按 `节点ID.变量名` 写入；下游节点可读取；覆盖时更新。 |
| FlowEngine 错误处理 | unit | retries 生效；onError=ignore 时继续执行且输出为 fallback；fatal 直接终止。 |
| Condition 执行 | unit | JS 表达式计算正确；true/false 输出映射到对应分支；表达式异常按 error/fatal 处理。 |
| Claude Agent adapter | unit + 集成 | 用 mock SDK / fixture 验证 prompt 替换、参数传递、文本输出捕获。 |
| 变量选择器前端组件 | component/E2E | 按节点分组显示变量；选中后插入 fullName；类型标签显示正确；上游删除变量后列表实时刷新。 |
| Condition 节点配置面板 | E2E | true/false 出口标识清晰；表达式输入可用；保存后持久化。 |
| Claude Agent 节点配置面板 | E2E | prompt 文本框支持变量插入；输出变量声明；模型选择保存。 |
| Trigger 节点配置面板 | E2E | 可添加/删除/编辑输出变量；类型选择生效。 |
| 端到端 flow 执行 | E2E | 包含 Trigger → Agent → Condition 的 flow 能正确传递变量并分支。 |
| 执行日志持久化 | unit + E2E | 执行记录包含节点输入/输出/分支/错误；日志写入 SQLite；7 天过期记录被清理。 |

### 7.2 测试原则

- 所有业务测试按 `tests/capabilities/<capability>/<entity>/2026-07-16-flow-refinement/` 组织。
- Claude Agent 集成测试必须可离线运行：通过 mock adapter 或 fixture 替代真实 API 调用。
- E2E 测试覆盖变量选择器、分支出口标识、节点配置持久化三个核心交互。

## 8. 范围外

以下明确不在本次 story 范围内：

1. **Codex App Server 节点**：作为单独 story 后续实现。
2. **本地 CLI Agent 扫描**：后续支持调用 `claude` / `codex` 等本地命令时再实现。
3. **复杂错误分支图**：每个节点只支持简单的重试 + 忽略，不支持拉一条 `onError` 边。
4. **输出结构化解析**：Claude Agent 输出为纯字符串，不解析 JSON / YAML / 字段提取。
5. **新节点类型**：Data / Output / HTTP / Delay 等节点保持现状或后续再做。
6. **执行调试面板**：变量可视化、逐步调试、断点等后续再做。
7. **节点分组 / 注释 / 子流程**：保持现状。
8. **ForEach / While 节点的配置体验细化**：保持现状，不扩展。

## 9. 其他说明

- 本 story 继承 `codex-harness-desktop` 已沉淀的 FlowEngine、Flow Editor、发布/草稿快照机制。
- Claude Agent adapter 的具体 provider/SDK 选择是移动块，将在 tech-design 阶段结合已有依赖（项目是否已引入 Anthropic / OpenAI SDK）、API key 存储方案、以及长期扩展性综合决策。
- 变量命名空间机制对现有 flow 数据保持向后兼容：旧 flow 中没有 `outputVariable` 的节点仍然按现有方式执行（输出不写入变量注册表）。
- 执行日志继续沿用现有 SQLite 存储方案；新增清理逻辑需要在 tech-design 中明确是启动时清理、后台定时清理，还是每次执行后触发。
