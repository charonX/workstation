# 通道发送接缝深化（Retire the _channelManager shim & Deepen ChannelSender Seam）

> 故事 ID：`2026-08-16-deepen-channel-sender-seam`
> 状态：设计中
> 创建日期：2026-08-16
> 最后更新：2026-08-19

---

## 1. 问题陈述

ADR-008 确立了通过 services bag 注入运行时服务的规范，并明确否决了 `context._xxx` / `variables._xxx` 这类隐式变量注入模式。但在现状中：
1. `executionRunner.js` 仍通过执行变量注册表注入 `_channelManager: buildChannelManagerShim()`；
2. `feishuSendExecutor.js` 优先读取 `context._channelManager`，若无则动态 `import("../../services/channelManager.js")`，且该回退路径绕过了通道在线状态检查与统一测试接缝；
3. 测试用例、生产调度与 debug 运行存在三条语义不同的通道解析路径，隐式变量污染了执行变量注册表。

一句话痛点：**通道适配器解析有三条语义不同的路径，ADR 已否决的 shim 模式仍在生产与测试中存活**。

## 2. 解决方案

1. **废除 `_channelManager` shim**：从 `executionRunner.js` 的变量注入中彻底移除 `_channelManager`，变量注册表恢复纯净。
2. **单一注入接缝（Services Bag）**：`executionRunner.js` 在构建执行上下文时，通过 `services.channelSender` 统一注入通道发送能力（`send` 与 `reply`）；`feishuSendExecutor.js` 仅从 `services.channelSender` 获取发送能力，彻底删除动态 `import` 和 `context._channelManager` 读取。
3. **统一测试 Seam**：在 `executionRunner` 层提供 `setTestChannelSender(mockSender)`，测试环境通过该 Seam 注入 mock，使测试、debug 和生产环境共用同一条唯一的执行路径与在线检查语义。
4. **统一错误表现**：当 `channelSender` 离线或缺失时，统一返回明确的结构化错误码（`E-CHANNEL-OFFLINE` 或 `E-CHANNEL-UNAVAILABLE`），执行器规范记录错误日志并中断节点执行，绝不静默跳过或产生未捕获异常。

## 3. 用户故事

1. 作为 Workstation 开发者，我想要 flow 中发送飞书消息的通道能力经由单一且明确的 services seam 注入，以便生产运行、debug 直跑与测试注入行为严格对齐。
2. 作为自动化测试编写者，我想要通过统一的 runner 测试接口注入通道 mock，以便测试用例不再需要操作隐式变量或依赖模块级副作用。
3. 作为系统维护者，我想要执行变量中没有任何系统级私有 shim（`_channelManager`），以便变量注册表保持干净且符合 ADR-008 的设计契约。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | 移除 `_channelManager` 变量注入 | ADR-008 与架构评审已明确否决 context shim 模式 |
| 2 | `feishuSendExecutor` 改走 `services.channelSender` | 统一通过 flowEngine 的 services bag 契约解耦，消除动态 import 回退 |
| 3 | `executionRunner` 提供 `services.channelSender` 组装与测试 Seam（`setTestChannelSender`） | 与 `testAgentExecutor` 模式一致，生产与测试共用单一入口 |
| 4 | 通道离线/未就绪时的统一错误与日志处理 | 保证故障时有清晰的错误状态（`E-CHANNEL-OFFLINE` / `E-CHANNEL-UNAVAILABLE`） |

## 5. 移动块（还在动，暂不入 REQ）

*当前无移动块，所有决策均已在架构评审与需求洞察中确认。*

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

| 步骤 | 触发动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | Flow 包含 feishuSend 节点，IM 消息触发运行（带 `channelReply`） | `executionRunner` 将 `channelManager` 适配器包装为 `services.channelSender` 传入引擎；`feishuSendExecutor` 调用 `services.channelSender.reply/send` 成功发送 | 消息成功发送，node status 为 success，outputVariables 记录 sent: true |
| 2 | Debug 运行带 feishuSend 节点的 flow（带 `channelReply`） | `executionRunner.runOnce` 注入相同的 `services.channelSender` 并执行发送 | Debug 路径与入队路径通道解析行为完全一致 |
| 3 | 测试环境调用 `setTestChannelSender(mockSender)` 后运行 flow | `executionRunner` 将 `mockSender` 传入 `services.channelSender`，节点发送调用 mock | Mock 收到符合规范的 payload，变量中无 `_channelManager` |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| `channelReply` 不存在或缺少 `chatId` | 节点直接降级为 skipped（非失败） | 记录日志 `feishuSend: no channelReply in context; node skipped`，outputVariables `{ skipped: true }` |
| `content` 变量插值后为空 | 节点降级为 skipped（非失败） | 记录日志 `feishuSend: empty content after interpolation; node skipped`，outputVariables `{ skipped: true }` |
| 通道未配置、离线或 `services.channelSender` 缺失 | 节点执行失败，记录错误日志 | `E-CHANNEL-UNAVAILABLE` 或 `E-CHANNEL-OFFLINE`，node status 为 error |
| 通道底层网络/API 调用抛错 | 节点捕获异常，包装为统一错误日志 | 返回 `{ status: "error", error: "feishuSend: send failed: ..." }` |

### 6.3 锚点例子表

| 场景 | 输入 context / services | 期望行为 / 输出 |
|---|---|---|
| 正常回复消息 | `context.channelReply = { channelType: "feishu", chatId: "oc_123", messageId: "om_456" }`, `services.channelSender` 正常 | 调用 `channelSender.reply("feishu", { messageId: "om_456", msgType: "text", content: "..." })`，返回 status: "success" |
| 正常主动发送（无 messageId） | `context.channelReply = { channelType: "feishu", chatId: "oc_123" }`, `services.channelSender` 正常 | 调用 `channelSender.send("feishu", { chatId: "oc_123", msgType: "text", content: "..." })`，返回 status: "success" |
| 未注入 channelSender | `context.channelReply = { channelType: "feishu", chatId: "oc_123" }`, `services.channelSender = null` | 节点返回 status: "error", error 包含 `E-CHANNEL-UNAVAILABLE` |

## 7. 表单与输入验证（Form / Input Validation）

本 story 无前台表单输入（纯内部架构与执行引擎接缝深化）。执行器入参校验规则如下：

| 输入/配置 | 规则 | 验证失败行为 |
|---|---|---|
| `context.channelReply` | 必须为对象且包含非空 `chatId` | 降级 skipped，不抛错 |
| `node.config.content` / `text` | 插值后必须为非空字符串或有效 JSON 对象 | 降级 skipped，不抛错 |
| `node.config.msgType` | 可选字符串，缺省默认为 `"text"` | 使用缺省值 `"text"` |
| `node.config.replyToMessage` | 可选布尔值，缺省默认为 `true` | 若为 false 则调用 `send` 而非 `reply` |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 节点状态 | 错误日志 |
|---|---|---|---|---|
| 通道服务未注入 | `services.channelSender` 未提供 | `E-CHANNEL-UNAVAILABLE: channelSender service not available` | `error` | `feishuSend: channelSender service not available` |
| 通道离线/未配置凭据 | 通道管理器报告 offline 或抛出 offline 错误 | `E-CHANNEL-OFFLINE: channel feishu is offline` | `error` | `feishuSend: send failed: E-CHANNEL-OFFLINE...` |
| 飞书 API 报错 | 飞书开放平台返回 4xx/5xx | 透传 API 错误信息 | `error` | `feishuSend: send failed: <error message>` |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **simple** |
| 判断理由 | 涉及模块较少（`executionRunner.js`, `feishuSendExecutor.js`, `channelManager.js` 及相关测试），设计目标与接缝完全对齐已有 ADR-008（services bag 规范），无复杂竞态或分布式事务逻辑。可直接结晶并生成测试契约。 |

## 10. 技术方案（Implementation Decisions）

### 10.1 设计目标
1. 消除 `variables._channelManager` 隐式属性注入。
2. 消除 `feishuSendExecutor.js` 内部的动态 `import("../../services/channelManager.js")`。
3. 在 `executionRunner.js` 中将通道适配层注入到 `services.channelSender`。
4. 提供 `setTestChannelSender` / `resetTestChannelSender` 作为测试 Seam。

### 10.2 模块契约与职责

```
┌─────────────────────────────────────────────────────────────┐
│                       ExecutionRunner                       │
│                                                             │
│  - testChannelSender (测试注入变量)                           │
│  - resolveChannelSender(): 构建/返回 channelSender 包装对象    │
│  - runOnce():                                               │
│      services = {                                           │
│        invokeSubflow: ...,                                  │
│        channelSender: resolveChannelSender()                │
│      }                                                      │
└──────────────────────────────┬──────────────────────────────┘
                               │ services.channelSender
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    feishuSendExecutor                       │
│                                                             │
│  - 从 services.channelSender 调用 send / reply              │
│  - 无 _channelManager 依赖，无动态 import 回退                │
└─────────────────────────────────────────────────────────────┘
```

#### 接口契约：
`services.channelSender` 提供：
- `send(channelType, payload)`: Promise<any>
- `reply(channelType, payload)`: Promise<any>

### 10.3 向后兼容与迁移
- 既有单元测试与集成测试中若有直接 mock `variables._channelManager` 的地方，全部迁移至 `executionRunner.setTestChannelSender(...)`。
- 确保 `taskService` 等兼容转发层不受影响。

## 11. 测试决策（Test Decisions & Seams）

### 11.1 覆盖接缝（Seams）
1. **Runner Seam**：`executionRunner.setTestChannelSender(mockSender)`，用于验证 `runOnce` 是否正确将 `channelSender` 传入执行器。
2. **Executor 单元接缝**：直接调用 `feishuSendExecutor({ node, context, services })`，传入 mock `services.channelSender`，断言各种正常与异常分支。
3. **E2E / 集成接缝**：执行完整包含 feishuSend 节点的 flow，断言变量中无 `_channelManager`，且消息经由 mock sender 正确记录。

### 11.2 测试计划
- **单元测试**：`test/unit/flowEngine/feishuSendExecutor.test.js`（重构或新建），验证通过 services 调用的正确性及错误码。
- **集成测试**：`test/unit/services/executionRunner.test.js`，验证 runner 组装的 services 中包含 `channelSender` 且 variables 中无 `_channelManager`。

## 12. 范围外（Out of Scope）

- 不重构飞书 WebSocket 长连接与底层 HTTP 请求逻辑（`feishuChannelAdapter.js`）。
- 不在此 story 中引入飞书以外的其它 IM 通道实现。
- 不修改 `imRouter.js` 派发 flow 的路由策略。

## 13. 补充说明

本 story 是对架构评审候选 #6 的直接落实，完全对齐 ADR-008。

## 14. PRD 完整性自检查

- [x] 每个稳定块至少有一条 happy path（写入第 6 节）。
- [x] 涉及用户输入的稳定块有字段级验证规则（写入第 7 节）。
- [x] 每个稳定块有 ≥1 条具体预期值锚点（例子表，写入第 6.3 节）；§7 每条规则有有效/无效例子。
- [x] 每个稳定块有失败场景或显式 N/A（写入第 8 节）。
- [x] 跨模块/外部依赖调用有错误状态定义（写入第 8 节）。
- [x] 复杂度已分级并给出理由（写入第 9 节，分级为 simple）。
- [x] 第 10 节“技术方案”：simple 高层已完整说明（写入第 10 节）。
- [x] 第 11 节“覆盖接缝”：每个稳定块至少一个 seam（写入第 11.1 节）。

自检结论：**全部通过，满足红线要求**。
