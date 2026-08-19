# ADR-034: 统一通道发送接缝与单一在线检查属主

## 状态
已接受 (Accepted) — 2026-08-19

## 背景与问题
在历史演进中，通道发送与回复能力存在三条语义不一致的路径：
1. **测试路径**：通过 `executionRunner` 中的 `buildChannelManagerShim` 将 `_channelManager` 伪对象注入变量注册表（`context.variables._channelManager`），依赖 `resolveChannelAdapter` 做 `getStatus() === "online"` 检查。
2. **生产路径**：`feishuSendExecutor` 通过动态 `await import("../../services/channelManager.js")` 绕过变量注册表和在线检查，生产路径与测试路径分叉。
3. **终态通知路径**：`deliverTerminalNotification` 使用独立的 `resolveChannelAdapter` 进行三级回退，与节点执行的解析逻辑平行。

这导致：
- 运行时变量污染（`context._channelManager` 不属于业务变量）；
- 在线状态检查属主分散且存在跳过检查的漏洞；
- 测试接缝膨胀（同时存在 `testChannelSender`、`testChannelAdapter`、`setChannelAdapterForTests`、`setChannelAdapter` 等多个接缝）并在运行期引入了 duck-typing 的参数个数（arity）嗅探。

## 决策

1. **唯一通道发送服务（Services Bag）**：
   - 对齐 ADR-008，将通道发送能力收拢到 `services.channelSender`：
     - `send(channelType, payload: { chatId, msgType, content }): Promise<any>`
     - `reply(channelType, payload: { messageId, msgType, content }): Promise<any>`
   - `feishuSendExecutor` 与 `deliverTerminalNotification` 均只从 `services.channelSender` / `resolveChannelSender()` 获取能力。
   - 彻底移除 `variablesForRun` 中的 `_channelManager` shim 与 `feishuSendExecutor` 中的动态 import。

2. **单一在线检查属主（Online check lives in one place）**：
   - 在线状态守卫统一收拢至 `channelManager.dispatchToAdapter` 底层分发入口。
   - 通道离线、未启动或未配置凭据时，统一抛出标准错误 `E-CHANNEL-OFFLINE: channel ${channelType} is offline`。

3. **测试 Seam 边界显式适配（零运行时 Duck-Typing）**：
   - 统一使用 `setTestChannelSender(mockSender)` 作为唯一的测试注入接缝。
   - 存量兼容方法 `setChannelAdapterForTests(adapter)` 在注入边界处做一次性显式包装，运行期 `resolveChannelSender()` 零 duck-typing 嗅探，直接返回 2 参 channelSender。
   - 彻底删除 `server.js` 与 `executionRunner.js` 中的 `setChannelAdapter` 废弃空接缝。

## 后果与影响

### 积极影响
- 执行变量注册表彻底恢复纯净，消除伪变量注入。
- 生产路径与测试路径完全统一，在线检查单一收口，消除离线静默穿透风险。
- 测试注入接缝单一明确，子流程递归继承通道能力，测试生命周期由 `reset()` 统一清理。

### 潜在代价
- 存量测试中若有直接 mock `context._channelManager` 的用例需调整为 `services: { channelSender }` 或调用 `executionRunner.setTestChannelSender(mock)`。
