# ADR-007: 飞书通道采用官方 SDK WSClient 与独立 channelManager

> 状态：已接受
> 日期：2026-07-19
> 相关 REQ：REQ-CHANNEL-001 ~ REQ-CHANNEL-005

## 上下文

媒体生产线 story（2026-07-19-media-production-line）需要把飞书作为第一 IM 通道：既能接收消息触发链接速存 flow，又能发送执行结果/日报摘要。前期调研（`research/feishu-open-platform-desktop-integration.md`）确认：

- 飞书官方推荐**长连接（WebSocket）**接收事件，无需公网 IP/域名；
- 官方 SDK `@larksuiteoapi/node-sdk` 内置 `WSClient`，自动重连默认开启，同时覆盖 token 缓存、全部 OpenAPI；
- 接收消息事件 `im.message.receive_v1` 需要用 `message_id` 做幂等去重。

BUILD 阶段实现 S5 时，最初采用裸 REST 调用发送/回复消息，未接入真实长连接，导致 PRD 对齐发现 `tech-design-gap`：生产环境无法接收飞书 IM 消息、无真实断线检测与自动重连。因此回流 `/tech-design` 重新明确实现方案。

## 决策

1. **长连接实现**：使用 `@larksuiteoapi/node-sdk` 的 `WSClient` 作为飞书长连接实现，不自行裸写 WebSocket/protobuf 协议。
2. **独立 `channelManager`**：新增 `channelManager` 模块统一管理 `channelAdapter` 生命周期，负责：
   - 按 settings 启动/停止/重启 adapter；
   - 把 adapter 的 `onMessage` 回调桥接到 `eventBus.emit('channel:message-received')`；
   - 把 adapter 的 `onStatusChange` 回调桥接到 `eventBus.emit('channel:status-changed')`。
3. **`channelAdapter` 接口保持通用**：定义 `start/stop/getStatus/send/reply/onMessage/onStatusChange`，未来企业微信/Telegram 可复用同一接口。
4. **保存凭据后自动连接 + 显式 reconnect**：
   - `POST /api/channel/credentials` 保存凭据后异步启动/重启 adapter，响应附带首次连接尝试状态/错误；
   - 提供 `POST /api/channel/reconnect` 与 CLI `channel reconnect` 供手动重连。
5. **状态暴露双通道**：状态变更通过 `eventBus` 实时广播（供 UI/通知中心订阅），同时暴露 `GET /api/channel/status` 同步查询。
6. **测试 seam**：以 adapter 接口注入（`simulateReceiveForTests`）+ fake REST server 断言 send/reply 为主 seam；完整 fake WS server 因 protobuf 协议复杂不进入本期验收。

## 后果

- **正面**：
  - 与官方推荐路径一致，自动重连、token 缓存由 SDK 负责；
  - `channelAdapter` 接口与 eventBus 解耦，未来多通道扩展只需新增 adapter 实现；
  - 状态变更实时广播，UX 与通知中心可即时响应。
- **负面/风险**：
  - 引入新的 npm 依赖 `@larksuiteoapi/node-sdk`，增加打包体积；
  - 真实 WS 路径难以被 fake server 完整覆盖，E2E 覆盖变薄，需依赖 manual 冒烟验证；
  - SDK 行为（domain 配置、protobuf 帧、集群模式）需要实际集成后观察。

## 替代方案

- **裸 WebSocket 自实现**：完全可控，fake server 易写；但重复实现 SDK 已解决的 token 缓存、心跳、重连、protobuf 帧，与调研结论冲突。
- **REST-only + 推迟长连接**：实现简单，但生产环境无法接收飞书消息，场景 B 验收不成立。
- **无 channelManager，adapter 直接 emit eventBus**：更直接，但 adapter 与 eventBus 紧耦合，不利于单元测试和未来替换。

## 相关文件

- `.aiassist/stories/2026-07-19-media-production-line/tech-design.md`
- `.aiassist/stories/2026-07-19-media-production-line/research/feishu-open-platform-desktop-integration.md`
- `src/services/channels/feishuChannelAdapter.js`（待按本 ADR 重写）
- `src/services/channelManager.js`（待新增）
- `src/http/routes/channel.js`
- `src/cli/commands/channel.js`
