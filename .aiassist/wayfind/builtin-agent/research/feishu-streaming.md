# Research: 飞书消息流式输出（streaming to Feishu）技术可行性

> 调研日期：2026-08-02
> 主题：飞书开放平台"消息流式输出"的实现路径与限制数字——发送/更新/回复 API 限制、官方流式能力（CardKit 卡片流式）、长连接与 HTTP 发送的限流差异
> 来源：primary sources（open.feishu.cn 官方文档，见每节引用与文末清单）

## 执行摘要

1. **发送消息** `POST /open-apis/im/v1/messages`：文本消息请求体最大 **150 KB**（错误码 230025）；向同一用户 **5 QPS**、向同一群组为群内机器人**共享 5 QPS**；接口级 **1000 次/分钟、50 次/秒**；相同 uuid 的请求 **1 小时内至多成功发送一条**（幂等）— [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)
2. **编辑消息** `PUT /open-apis/im/v1/messages/:message_id` 存在：仅支持编辑文本(text)/富文本(post)消息，**一条消息最多编辑 20 次**（错误码 230072），可编辑时间窗口由企业管理员配置（230075）——**不能支撑打字机式持续流式**，只能做少量状态更新 — [更新消息](https://open.feishu.cn/document/server-docs/im-v1/message/update)
3. **官方已提供专为 AI 打字机效果设计的流式能力：CardKit 卡片流式更新**（`streaming_mode` + `streaming_config`，推送全量文本、平台自动算增量渲染），且官方文档明确"**流式更新不触发接口的频率限制（QPS）**"；更新文本接口 content 上限 **100,000 字符**、sequence 必须严格递增（300317）— [卡片流式更新概览](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/streaming-updates-openapi-overview.md)、[更新卡片元素内容](https://open.feishu.cn/document/cardkit-v1/card-element/content.md)
4. **长连接（WSClient）只负责接收事件**：发送消息一律经 SDK 走 HTTP OpenAPI，因此发送限流与 HTTP 调用**完全相同**（5 QPS/用户、1000 次/分钟）；长连接另有自身限制：每应用最多 **50 个连接**、事件需 **3 秒内**处理完否则重推（15s/5min/1h/6h，最多 4 次）、仅企业自建应用支持 — [Node SDK 处理事件](https://open.feishu.cn/document/server-side-sdk/nodejs-sdk/handling-events)
5. **可行性结论（事实层）**：编辑单条路径被"20 次编辑上限"封死，无法做持续流式；发多条路径受 5 QPS/用户限制且体验为消息轰炸；**官方唯一为流式设计的路径是 CardKit 卡片流式更新**，流式期间不限流、单次更新内容上限 100,000 字符，是最可行路径，但需卡片实体一次性发送、客户端 7.20+、流式模式 10 分钟自动关闭等约束。

## 详细发现

### 1. 发送消息 API（当前通道使用的接口）

`POST https://open.feishu.cn/open-apis/im/v1/messages` — [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)

- 文本消息（msg_type=text）请求体最大 **150 KB**；卡片/富文本消息最大 **30 KB**（卡片模板实际大小含模板数据，样式标签会进一步撑大实际消息体）。
- 频率限制（文档"使用限制"原文数字）：
  - 向**同一用户**发送消息：**5 QPS**
  - 向**同一群组**发送消息：群内机器人**共享 5 QPS**
  - 接口级总限制：**1000 次/分钟、50 次/秒**
- 防重复：相同 `uuid` 的请求在 **1 小时内至多成功发送一条**。
- 发送条件：给用户发消息需用户在该机器人可用范围内；给群发需机器人已在群内且有发言权限。

### 2. 更新/编辑消息 API（"编辑单条"路径的硬限制）

`PUT https://open.feishu.cn/open-apis/im/v1/messages/:message_id` — [更新消息](https://open.feishu.cn/document/server-docs/im-v1/message/update)

- **仅支持编辑文本(text)、富文本(post)消息**；卡片消息需走卡片相关 API。
- **一条消息最多可编辑 20 次**（错误码 230072："消息已达到可编辑次数"）——打字机式流式通常需要几十到上百次更新，**20 次是硬性天花板**。
- 仅可编辑自己发送的消息；**不可编辑**已撤回、已删除、超出可编辑时间的消息；可编辑时间窗口**由企业管理员在管理后台配置**（错误码 230075）——时间窗可能短至几分钟，不可依赖。
- 机密群/第三方加密群内消息不可编辑（230073/230074）。
- 频率限制：接口级 **1000 次/分钟、50 次/秒**（更新不产生新消息，文档未提 5 QPS 接收方限流是否适用，见"不确定"节）。

### 3. 官方"流式"能力：CardKit 卡片流式更新（重点）

官方专门为 AI 助手"打字机效果"提供的机制 — [卡片流式更新 OpenAPI 概览](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/streaming-updates-openapi-overview.md)、[更新卡片元素内容](https://open.feishu.cn/document/cardkit-v1/card-element/content.md)

**机制流程**：
1. 创建卡片实体（卡片 JSON 2.0，`config.streaming_mode: true` + `streaming_config`）→ 得 `card_id`；
2. 用发送消息 API（`im/v1/messages`，msg_type=interactive）把该 `card_id` 发出；
3. 持续调用流式更新文本 API 推送**全量文本**（平台自动计算增量；新文本是旧文本前缀时走打字机效果，前缀不同则全量直接上屏）；
4. 结束时调"更新卡片配置"把 `streaming_mode` 设为 `false`。

**流式更新文本 API**：`PUT https://open.feishu.cn/open-apis/cardkit/v1/cards/:card_id/elements/:element_id/content`
- 参数：`content`（必填，新文本，长度 **1 ～ 100,000 字符**）、`sequence`（必填，同卡片操作必须**严格递增**，错误码 300317）、`uuid`（可选幂等）。
- 支持元素：纯文本元素（`plain_text`）与富文本组件（`markdown`）；卡片构建器创建的卡片仅富文本组件可流式更新。
- 频率限制：接口级 **1000 次/分钟、50 次/秒**。

**streaming_config 参数**：
- `print_frequency_ms`：两次上屏间隔，默认 **70 ms**（支持 default/android/ios/pc 分端配置）；
- `print_step`：每次上屏增量字符数，默认 **1**；
- `print_strategy`：`fast`（默认，旧文本未渲染部分立即上屏再渲染新内容）/ `delay`（旧文本按打字机打完后新内容再开始）；
- `summary`：聊天栏预览文案，默认 `[生成中...]`。

**限流关键声明（原文）**：开启流式模式后，调用卡片和组件接口对卡片"持续进行全量更新、局部更新、文本流式更新，**且不会触发接口的频率限制（QPS）**"。非流式场景下，单个卡片实体的卡片/组件 OpenAPI 操作频率上限为 **10 次/秒**。

**限制与约束**：
- 流式模式在距上次开启 **10 分钟后自动关闭**，建议手动关闭（`card.settings` 设 `streaming_mode: false`）；未关闭则聊天预览一直显示 `[生成中...]`；
- **卡片实体仅支持发送一次**，且必须由创建它的应用发送；实体有效期为 **14 天**；
- 流式模式下的卡片**无法转发**；
- 流式模式下不能用交互回调直接更新卡片（需先关闭流式）；
- 客户端要求：卡片 JSON 2.0 结构需飞书客户端 **7.20+** 展示流式效果；**7.23+** 才支持自定义频率/步长/策略参数（7.20–7.22 用默认参数）；
- 权限：`cardkit:card:write` + `im:message:send_as_bot` 等。

### 4. 长连接（WSClient）与 HTTP API 发送的区别

`@larksuiteoapi/node-sdk` 的 WSClient（本项目 ADR-007 已采用）— [Node SDK 处理事件](https://open.feishu.cn/document/server-side-sdk/nodejs-sdk/handling-events)、本地 [ADR-007](file:///Users/zhanglei/charon/code/workspace/workstation/.aiassist/global/adr/ADR-007-feishu-channel-wsclient-and-channel-manager.md)

- **长连接只用于接收事件推送**；发送消息是 SDK 内独立的 API Client（`client.im.v1.message.create`）调用开放平台 HTTP API——**发送路径与限流和纯 HTTP 调用完全相同**（5 QPS/用户、1000 次/分钟），长连接不豁免、也不额外叠加发送限流。
- 长连接自身限制：每应用最多 **50 个连接**（每初始化一个 client 算一个连接）；集群模式非广播（多 client 时随机一个收到事件）；事件需 **3 秒内**处理完成否则超时重推（间隔 15 秒、5 分钟、1 小时、6 小时，最多 4 次）；仅企业自建应用支持。
- 结论：**当前通道的发送限流 = 官方 HTTP API 限流数字**，与接入方式无关。

### 5. 回复消息 / 话题 thread（"发多条"路径的组织方式）

`POST https://open.feishu.cn/open-apis/im/v1/messages/:message_id/reply` — [回复消息](https://open.feishu.cn/document/server-docs/im-v1/message/reply)

- `reply_in_thread=true` 时以**话题（thread）形式**回复，形成 `root_id/parent_id/thread_id` 结构——可用于把同一任务的多个状态消息组织进一个话题。
- 限制与发送消息相同：文本 150 KB、同用户/同群 5 QPS、接口级 1000 次/分钟、50 次/秒。
- 回复是独立的新消息（每次回复都计入限流与消息条数）。

## 三种实现路径的事实对比

| 路径 | 关键限制数字 | 打字机式流式可行性 |
|---|---|---|
| A. 编辑单条消息（PUT im/v1/messages/:id） | 每条消息**最多编辑 20 次**；仅 text/post；编辑时间窗由企业管理员配置；1000 次/分钟 | **不可行**（20 次硬上限，且时间窗不可控） |
| B. 发多条消息（含 thread 回复） | 同用户/同群 **5 QPS**、每条 150 KB、1000 次/分钟 | 可行但体验差（消息轰炸、无打字机效果），仅适合"阶段状态 + 最终汇总" |
| C. CardKit 卡片流式更新（官方流式） | 流式期间**不触发 QPS 限流**；更新文本 ≤ **100,000 字符**/次；sequence 严格递增；实体一次性发送、14 天有效、10 分钟自动关闭；客户端 7.20+/7.23+ | **可行（官方为打字机效果设计）**，是唯一原生的"流式"路径 |

## 不确定 / 待验证

- **更新消息是否受"同用户 5 QPS"限制**：update 文档只列了接口级 1000 次/分钟，未提接收方 5 QPS（更新不产生新消息，推测不适用），需实测确认。
- **"流式更新不触发 QPS"的精确范围**：官方概览文档原文如此，但流式更新 API 文档仍标注接口级 1000 次/分钟——理解为"豁免接收方打扰式限流（5 QPS 类）+ 卡片 10 次/秒上限"，接口级 1000/分钟仍存在。实践中建议仍按 ≤1000 次/分钟节流（开源实践默认 ~10 次/秒）。
- **编辑时间窗口的具体默认值**：由企业管理员在管理后台配置，无公开默认数字，不能作为方案依据。
- **card.element.content 100,000 字符是全量累计文本**：推送的是累计全文而非 delta，长任务需自行控制最终文本 ≤100,000 字符。
- 第三方资料提到编辑上限"约 20–30 次"，以官方 230072 错误码的 **20 次**为准。

## 开放问题（留给 /tech-design 决策）

- 流式输出的是**纯文本过程日志**（适合卡片富文本 markdown）还是需要结构化（工具调用/进度条/链接）——决定是否值得引入 CardKit 卡片（当前通道只发过 text 消息）。
- 流式卡片对**客户端版本 7.20+ 的依赖**在企业内网是否可接受；低版本用户需要降级路径（如发送普通 text 消息）。
- 卡片实体"只能发送一次、14 天有效期"与现有 channelAdapter `send/reply` 通用接口的适配方式。
- 是否在流式之外保留"任务结束发最终完整消息"的兜底（避免 10 分钟自动关闭 / 进程崩溃导致内容丢失）。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| 发送消息（服务端 API） | https://open.feishu.cn/document/server-docs/im-v1/message/create | 2026-08-02 | 150KB、5 QPS、1000/min、uuid 幂等 |
| 更新消息（服务端 API） | https://open.feishu.cn/document/server-docs/im-v1/message/update | 2026-08-02 | 20 次编辑上限、可编辑时间窗 |
| 回复消息（服务端 API） | https://open.feishu.cn/document/server-docs/im-v1/message/reply | 2026-08-02 | thread 回复、5 QPS、150KB |
| 卡片流式更新 OpenAPI 概览 | https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/streaming-updates-openapi-overview.md | 2026-08-02 | streaming_mode、不限流声明、10 分钟自动关闭、7.20+ |
| 更新卡片元素内容（CardKit） | https://open.feishu.cn/document/cardkit-v1/card-element/content.md | 2026-08-02 | 1~100,000 字符、sequence 严格递增、1000/min |
| Node SDK 处理事件（长连接） | https://open.feishu.cn/document/server-side-sdk/nodejs-sdk/handling-events | 2026-08-02 | WSClient 仅收事件、50 连接、3 秒超时重推 |
| ADR-007（本地） | .aiassist/global/adr/ADR-007-feishu-channel-wsclient-and-channel-manager.md | 2026-08-02 | 当前通道实现背景（WSClient + channelManager） |
