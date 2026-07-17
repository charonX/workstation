# 访谈笔记 — 2026-07-16-flow-refinement

## 核心问题

当前 Workstation 的 FlowEngine 已经能跑基础顺序执行 + condition/foreach/while，但**节点配置面板信息严重缺失**——节点画出来了，却说不清“输入从哪里来、条件怎么写、输出到哪里去、失败怎么办”。这导致稍微复杂的 flow 就写不下去。

本次 story 的目标：把 flow 的入口、判断、执行三个核心节点（Trigger / Condition / Cloud Agent）的配置体验系统化重做，让 flow 能承载真实自动化场景。

## 用户画像

- 主要用户：开发者/技术型用户，在本地工作站上编排 agent 工作流。
- 使用场景：把重复性工作（代码处理、文件操作、agent 调用）串成可执行的 flow。
- 能力假设：能写简单 JS 表达式，不需要可视化条件构建器。

## 关键边界

1. **只改三个节点**：Trigger、Condition、Cloud Agent。
   - Trigger：flow 入口，声明输入变量。
   - Condition：分支判断，写 JS 表达式。
   - Cloud Agent：通过 cloud agent SDK 调用云端模型执行实际工作。
2. **Codex App Server 节点单独做**：不在本 story 范围内，后续单独开 story。
3. **错误处理只到节点级**：重试次数 + 失败时忽略/继续；不做复杂错误分支图。
4. **输出解析不做**：Cloud Agent 的 API response 文本作为字符串输出。
5. **变量类型只做基础四种**：string / number / array / object。
6. **初始只支持 cloud agent**：通过 cloud agent SDK 写一个 adapter；本地 CLI agent 扫描放到后续 story。

## 隐含假设

1. 用户能接受节点输出变量名自动拼接节点 ID（如 `n3.result`），UI 上按节点分组展示友好名称。
2. 用户愿意为 cloud agent 维护一个内置 adapter（基于 cloud agent SDK），初始只支持 cloud 这一种 agent 来源。
3. 变量作用域采用“节点命名空间 + 覆盖”模型，而不是严格只读或强制唯一命名。
4. 当前 FlowEngine 的纯函数执行模型和发布/草稿快照机制保持不变。

## 矛盾/风险

1. **适配器维护成本**：cloud agent SDK 的接口和参数可能变化，需要维护 adapter。但比支持多个本地 CLI agent 要可控。
2. **API key / 凭证管理**：cloud agent 需要 API key，如何安全存储（settings JSON？环境变量？系统 keychain？）需要在 PRD/tech-design 中明确。
3. **变量命名空间可读性**：自动拼接 `节点ID.变量名` 在复杂 flow 中可能变得冗长，需要 UI 强力分组/搜索。
4. **字符串输出的局限**：无法直接提取 agent 返回的结构化字段，后续很可能需要再补一个“输出解析”story。
5. **工作目录语义**：cloud agent SDK 不一定需要本地工作目录，但如果 prompt 要求操作文件，则需要明确 cwd 为 flow 所属项目的本地路径。

## 候选方向

### 方向 A：最小可行（只改 Condition）

- 建立变量注册表，重做 Condition 节点配置面板。
- 优点：工作量最小，最快验证变量选择器 + JS 表达式交互。
- 缺点：Trigger 和 Cloud Agent 仍是旧体验，整体割裂。
- 推荐度：备选

### 方向 B：三个核心节点系统化改造（推荐）

- 统一建立带类型的变量注册表。
- 重做 Trigger / Condition / Cloud Agent 三个节点的配置面板。
- 增加节点级重试/失败忽略配置。
- 基于 cloud agent SDK 实现一个内置 Cloud Agent adapter。
- 优点：flow 核心环节体验一致，一次到位；cloud agent 比本地 CLI agent 更容易统一实现。
- 缺点：工作量比 A 大，但比 C 可控。
- 推荐度：首选

### 方向 C：完整 flow 平台

- 在 B 的基础上新增 Data/Output/HTTP/Delay 节点、可视化数据流管线、执行调试面板。
- 优点：长期价值最大。
- 缺点：远超本次“细化”范围，容易做一半没验收点。
- 推荐度：不推荐本次做

## 确认方向

最终确认的方向：**方向 B**

确认意图：

- **Outcome**：Trigger / Condition / Cloud Agent 三个节点的配置面板能清楚表达“输入从哪里来、条件怎么写、输出到哪里去、失败怎么办”。
- **User**：在 Workstation 里编排 agent 工作流的技术型用户。
- **Why now**：现有 flow 骨架能跑，但节点配置语义缺失，复杂流程写不下去。
- **Success**：
  - Trigger 可声明带类型的输入变量（名称 / 类型 / 默认值）。
  - Condition 可用变量选择器写 JS 表达式，画布和配置面板清楚标识 true/false 分支。
  - Cloud Agent 可配置 prompt（支持变量插入）、选择模型/参数、声明输出变量，API response 文本作为字符串输出。
  - 所有节点可配置重试次数和失败时是否忽略/继续。
  - 基于 cloud agent SDK 实现一个内置 Cloud Agent adapter。
- **Constraint**：只动 Trigger/Condition/Cloud Agent；不改 FlowEngine 底层执行模型大架构；错误处理只到节点级；输出只做字符串；默认工作目录为 flow 所属项目的本地路径。
- **Out of scope**：本地 CLI Agent 扫描、Codex App Server 节点、复杂错误分支图、可视化条件构建器、Data/Output/HTTP/Delay 等新节点、输出结构化解析、执行调试面板、节点分组/注释。

确认理由：方向 B 系统性解决了当前最痛的配置体验问题，范围明确且可在一个 story 内验收；cloud agent SDK 方案比本地 CLI 扫描更简单可控；Codex App Server / 本地 CLI 扫描等更复杂能力拆到后续 story。

## 最窄的切入点

建议按以下顺序实现，每个 slice 都可独立验收：

1. **变量注册表 + 类型系统**：FlowEngine 执行时维护 `nodeId.variableName` 命名空间，API/前端能读取当前 flow 可用变量列表。
2. **Trigger 节点配置**：新增/编辑 Trigger 时声明输出变量（名称、类型、默认值）。
3. **Condition 节点配置**：JS 表达式输入 + 变量选择器 + true/false 分支显式标识。
4. **Cloud Agent adapter**：基于 cloud agent SDK 实现一个 adapter，支持 prompt、模型选择、输出文本捕获；默认工作目录为 flow 所属项目的本地路径。
5. **Cloud Agent 节点配置**：选择模型/参数、统一 prompt 文本框支持变量插入、声明输出变量、API response 文本作为输出。
6. **节点级错误处理**：重试次数 + 失败忽略/继续配置，失败忽略时输出变量按配置的 fallback 处理（默认空字符串），FlowEngine 执行时生效。

## 待确认问题

- [x] 初始内置支持的 agent 来源：cloud agent SDK，写一个内置 adapter。
- [x] Cloud Agent 的工作目录：默认使用 flow 所属项目的本地路径。
- [x] 失败“忽略”时，该节点的输出变量：按配置的 fallback 处理，默认空字符串。
- [ ] Cloud Agent adapter 具体使用哪个 SDK？Anthropic Messages API / Claude SDK？OpenAI Responses API？还是抽象一个 provider 模型同时支持多个？
- [ ] 变量选择器中是否显示变量类型图标/标签？
- [ ] 是否需要在 Condition 表达式输入框中提供实时语法高亮或简单校验？
- [ ] API key / 凭证如何存储？（settings JSON、环境变量、还是系统 keychain？）
