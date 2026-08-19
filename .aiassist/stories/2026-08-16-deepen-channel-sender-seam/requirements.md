# 需求规格说明书（Requirements Specification）

> 故事 ID：`2026-08-16-deepen-channel-sender-seam`
> 对应 PRD：[`prd.md`](./prd.md)
> 版本：v1
> 生成时间：2026-08-19

---

## 需求清单

### REQ-FLOW-054: 移除执行变量注册表中的 _channelManager shim

- **标题**：执行变量中废除 `_channelManager` 属性注入
- **优先级**：P0
- **必须性**：必须
- **所属能力**：`flow-orchestration`
- **核心实体**：`execution`
- **范围（scope）**：`intra-module` (`src/services/executionRunner.js`)
- **测试类型**：单元 / 集成
- **测试文件**：`tests/capabilities/flow-orchestration/execution/2026-08-16-deepen-channel-sender-seam/api/channelSenderSeam.test.js`

#### 验收标准
1. **[AC1] 变量注册表纯净化**：`executionRunner.runOnce` 在拼装 `variablesForRun` 时不再注入 `_channelManager` 属性。
2. **[AC2] 引擎上下文隔离**：无论生产入队执行、debug 直跑还是子流程嵌套调用，flow 执行 context 中的 `variables` 均不包含 `_channelManager`。
3. **[AC3] 存量变量透传不受影响**：`executionCtx.variables` 或 `execution.variables` 中的业务变量正常透传进入引擎执行。

---

### REQ-FLOW-055: feishuSendExecutor 改走 services.channelSender 并移除动态 import

- **标题**：feishuSendExecutor 统一经由 services.channelSender 调用通道能力
- **优先级**：P0
- **必须性**：必须
- **所属能力**：`flow-orchestration`
- **核心实体**：`flow-engine`
- **范围（scope）**：`intra-module` (`src/flowEngine/executors/feishuSendExecutor.js`)
- **测试类型**：单元测试
- **测试文件**：`tests/capabilities/flow-orchestration/flow-engine/2026-08-16-deepen-channel-sender-seam/api/feishuSendExecutor.test.js`

#### 验收标准
1. **[AC1] 移除私有 shim 与动态 import 依赖**：`feishuSendExecutor.js` 源码中彻底移除 `context._channelManager` 读取及 `await import("../../services/channelManager.js")` 语句。
2. **[AC2] 正常回复消息**：当 `context.channelReply` 存在且 `replyToOriginal !== false` 且包含 `messageId` 时，通过 `services.channelSender.reply(channelType, payload)` 发送，payload 包含 `{ messageId, msgType, content }`。
3. **[AC3] 正常主动发送**：当 `replyToOriginal === false` 或无 `messageId` 时，通过 `services.channelSender.send(channelType, payload)` 发送，payload 包含 `{ chatId, msgType, content }`。
4. **[AC4] 变量与输出记录**：发送成功后返回 `{ status: "success", output: JSON.stringify(content), logs: [...], outputVariables: { sent: true, msgType, content } }`。
5. **[AC5] 无 channel 上下文时降级**：若 `context.channelReply` 缺失或无 `chatId`，或者 `content` 为空，返回 `{ status: "success", output: "skipped", logs: [...], outputVariables: { skipped: true } }`。

---

### REQ-FLOW-056: executionRunner 组装 services.channelSender 并提供测试 Seam

- **标题**：executionRunner 构建统一 channelSender 服务并提供测试注入 Seam
- **优先级**：P0
- **必须性**：必须
- **所属能力**：`flow-orchestration`
- **核心实体**：`execution`
- **范围（scope）**：`cross-module` (`src/services/executionRunner.js`, `src/services/channelManager.js`)
- **测试类型**：单元 / 集成
- **测试文件**：`tests/capabilities/flow-orchestration/execution/2026-08-16-deepen-channel-sender-seam/api/channelSenderSeam.test.js`

#### 接口契约
- `services.channelSender`:
  - `send(channelType: string, payload: { chatId: string, msgType: string, content: string }): Promise<any>`
  - `reply(channelType: string, payload: { messageId: string, msgType: string, content: string }): Promise<any>`
- 测试 Seam:
  - `setTestChannelSender(mockSender)`: 设置全局测试 mockSender
  - `resetTestChannelSender()`: 清理测试 mockSender，重置为生产默认

#### 验收标准
1. **[AC1] 生产默认通道组装**：在未设置测试 mock 时，`executionRunner.runOnce` 将 `channelManager.send` / `channelManager.reply` 封装为 `services.channelSender` 注入 flowEngine。
2. **[AC2] 测试 Seam 优先直通**：当通过 `setTestChannelSender(mockSender)` 设置 mock 后，`executionRunner.runOnce` 注入的 `services.channelSender` 自动指向该 mock 对象。
3. **[AC3] 嵌套子流程继承 Seam**：`makeInvokeSubflow` 创建子流程执行时，继承 runner 的 `services.channelSender`，保证子流程中的 feishuSend 节点行为与父流程一致。
4. **[AC4] reset 清理**：调用 `resetTestChannelSender()` 或 `executionRunner.reset()` 后，mock 状态被清理。

---

### REQ-FLOW-057: 通道服务异常时的受控错误处理与日志

- **标题**：feishuSend 遇到通道服务异常时的结构化错误返回
- **优先级**：P0
- **必须性**：必须
- **所属能力**：`flow-orchestration`
- **核心实体**：`flow-engine`
- **范围（scope）**：`intra-module` (`src/flowEngine/executors/feishuSendExecutor.js`)
- **测试类型**：单元测试
- **测试文件**：`tests/capabilities/flow-orchestration/flow-engine/2026-08-16-deepen-channel-sender-seam/api/feishuSendExecutor.test.js`

#### 验收标准
1. **[AC1] channelSender 缺失报错**：当 `services` 或 `services.channelSender` 为空/未提供时，返回 `{ status: "error", error: "feishuSend: channelSender service not available", logs: [...] }`。
2. **[AC2] 底层抛错捕获包装**：当 `channelSender.send` 或 `channelSender.reply` 抛出异常（如 `E-CHANNEL-OFFLINE` 或网络错误）时，捕获该异常并返回 `{ status: "error", error: "feishuSend: send failed: <error message>", logs: [...] }`，logs 中包含该错误消息。
