# 访谈笔记 — 2026-08-16-deepen-channel-sender-seam

## 核心问题
ADR-008 否决的 `context._xxx` shim 模式依然以 `_channelManager` 存在于 execution variables 中；`feishuSendExecutor` 存在动态 import 回退逻辑，绕过了通道在线检查与测试注入机制，导致 debug 直跑、生产运行与测试执行三者的通道解析行为分叉。

## 用户画像
- **开发者 / 测试人员**：编写 flow 自动化流程与调试，希望本地 debug、自动化测试与线上生产环境的通道发送行为严格一致。
- **系统维护者**：避免违反 ADR 架构约束的隐式变量污染变量注册表，保证服务注入接缝（seam）清晰唯一。

## 关键边界
1. **单一注入接缝**：所有通道发送（`send` 与 `reply`）统一经由 `flowEngine` 的 `services.channelSender` 进行，执行器不再从 `context`/`variables` 读取 `_channelManager`，也不再动态 `import("../../services/channelManager.js")`。
2. **离线/未配置统一错误**：若通道未启动、不可用或发送失败，由 `channelSender` 统一返回受控错误（如 `E-CHANNEL-OFFLINE`），执行器规范记录 error log 并标记执行状态，绝不静默失败。
3. **测试 Seam**：测试环境通过 `executionRunner.setTestChannelSender(mockSender)` 注入 mock，无需篡改 variables。
4. **兼容性**：保留原有 `channelReply` 中的 `chatId`/`messageId` 语义，但不再依赖魔术变量传递管理器实例。

## 隐含假设
1. Flow Engine 已支持 `services` 容器并能在运行时传递 `services.channelSender`（已在 ADR-008 中确立规范）。
2. `imRouter` 和外部触发器产生的 `channelReply` payload 结构保持稳定。

## 矛盾/风险
- 存量测试若直接往 `execution.variables._channelManager` 注入 mock 将失效，需要迁移至 `setTestChannelSender`。
- 如果某个外部调用直接调用 executor 而未提供 `services.channelSender`，需明确报错或由 runner 统一兜底。

## 候选方向

### 方向 A：统一收拢至 Services Bag（推荐）
- **适用场景**：全面对齐 ADR-008，彻底清理变量注册表中的 shim。
- **主要取舍**：需要同时调整 `executionRunner.js`、`feishuSendExecutor.js` 以及相关测试用例，但架构彻底统一。
- **推荐度**：首选

### 方向 B：保留 dynamic import 作为兜底
- **适用场景**：担心破坏现有未传入 services 的老调用路径。
- **主要取舍**：继续保留双重路径，违反架构单一源头原则，测试绕过风险依然存在。
- **推荐度**：不推荐

## 确认方向

最终确认的方向：**方向 A（统一收拢至 Services Bag，彻底退役 _channelManager shim）**

确认意图：
- **Outcome**: 移除 `_channelManager` shim 与动态 import 回退，通过 `services.channelSender` 统一通道消息发送与回复接缝。
- **User**: Workstation 开发者与测试系统。
- **Why now**: 架构评审发现多处通道解析分支与潜在分叉隐患（候选 #6）。
- **Success**:
  1. `execution.variables` 中不再出现 `_channelManager`。
  2. `feishuSendExecutor` 中移除动态 `import` 与 `context._channelManager` 引用。
  3. `executionRunner` 在每次执行时注入标准的 `services.channelSender`。
  4. Debug 运行、生产运行与测试注入共用同一接缝，全量测试保持绿灯。
- **Constraint**: 不改变现有的飞书消息发送协议与 `channelReply` 数据结构，对齐 ADR-008。
- **Out of scope**: 不在此 story 中重构飞书 WS 连接或新增其他 IM 平台适配器。

## 最窄的切入点
1. 在 `feishuSendExecutor.js` 中将通道操作改为 `services.channelSender`。
2. 在 `executionRunner.js` 中通过 services 组装 `channelSender`，并清理 `_channelManager` 注入。
3. 更新相关单元测试与 E2E 测试。
