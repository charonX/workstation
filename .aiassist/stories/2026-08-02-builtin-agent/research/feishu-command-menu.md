# Research: 飞书"应用指令/快捷指令"（消息输入框 `/` 唤起指令菜单）能力与配置方式

> 调研日期：2026-08-03
> 主题：飞书开放平台上"斜杠指令/快捷指令"（用户在输入框打 `/` 弹出命令菜单）的能力是否存在、机制名称、配置方式、回调形态、与普通消息的区别、限制
> 来源：primary sources（open.feishu.cn 官方文档，见每节引用与文末清单；部分 API 细节以 larksuite/cli 官方 CLI 的 live-verified 实现为证，已标注）
> 前置背景：`.aiassist/wayfind/builtin-agent/research/feishu-streaming.md`（官方 SDK WSClient 长连接 + 消息收发，ADR-007 已采用）

## 执行摘要

1. **飞书没有面向普通机器人的"输入 `/` 唤起指令菜单"机制；官方输入框增强机制叫「机器人自定义菜单」（bot custom menu）**——把应用常用入口**固定/悬浮在机器人聊天输入框上**，用户**点击按钮**交互（不是敲 `/` 唤起）。两种展示样式：可切换菜单（客户端 5.27+，最多 3 主菜单 × 5 子菜单）、悬浮菜单（7.22+，最多 5 主菜单 × 10 子菜单）；菜单项动作三类：跳转链接 / 发送文字消息（7.22+）/ 推送事件（配唯一标识 event_key）。**仅支持单聊，不支持群聊**。配置在开发者后台，发布版本后约 5 分钟生效，无公开配置 API（权限 `application:bot.menu:write` 存在）。— [机器人自定义菜单](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/bot-customized-menu)、[机器人概述](https://open.feishu.cn/document/client-docs/bot-v3/bot-overview?lang=en-US)
2. **点击菜单项的事件是 `application.bot.menu_v6`（机器人自定义菜单事件）**：payload 含 `operator`（operator_name/operator_id）、`event_key`（开发者配置的菜单唯一标识，1~30 字符）、`timestamp`；**无 chat 字段**（印证仅单聊）。事件订阅支持 **Webhook 与 WebSocket 长连接两种推送方式**（文档示例代码两种都给），Custom App，订阅无需权限。— [机器人自定义菜单事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/application-v6/bot/events/menu)
3. **"斜杠指令"（slash command）是存在的，但挂在「飞书智能体」（Agent）平台名下**：open.feishu.cn 站内搜索索引收录"飞书智能体支持斜杠指令"与"Agent 最佳实践"；官方权限目录有「查询 Slash Command」（`application:app_slash_command:read`）、「编辑 Slash Command」（`application:app_slash_command:write`）；配套管理 API `POST/GET/PATCH/DELETE /open-apis/application/v7/app_slash_commands`（Lark 官方 CLI larksuite/cli 已 live-verified：列表无分页、**每应用最多 100 条**、`command` 不带前导 `/`、description 支持 i18n、icon 默认 `skill_outlined`、名称冲突错误码 40000000、客户端缓存约 5 分钟生效）。**该 API 不在官方 SDK 元数据中**（官方 Node/Go/Python SDK 均无此资源）。— [一键创建飞书智能体应用（权限清单）](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview)、[larksuite/cli](https://github.com/larksuite/cli)
4. **普通消息事件 `im.message.receive_v1` 的 message 对象没有 `command` 字段**：字段为 message_id/chat_id/chat_type(p2p|group)/message_type/content/mentions（含 mentioned_type: user|bot）等；指令识别只能靠 `content.text` 前缀解析 + `mentions` 判断是否 @机器人。订阅方式 Webhook 与长连接都支持。— [接收消息事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive)
5. **结论：基于纯文本解析的降级路径完全可行且是生态主流做法；指令菜单是可配置增强，但有硬约束**。OpenClaw 官方文档明确写："Feishu/Lark does not support native slash-command menus, so send these as plain text messages"（飞书不支持原生斜杠指令菜单，以纯文本消息发送）；真实项目（bifrost 等）也明确决策"不订阅菜单事件、继续用 @机器人 + slash 文本命令"。若要做输入框增强：单聊场景可用机器人自定义菜单（事件走 `application.bot.menu_v6`，与现有 WSClient 长连接兼容）；"/" 输入唤起的斜杠指令依赖智能体平台能力且回调为控制台配置的 http 回调地址（webhook 形态），与长连接方案兼容性未证实，普通自建应用不可依赖。

## 详细发现

### 1. 飞书是否支持"斜杠指令/快捷指令"？机制叫什么？（Q1）

飞书有两类"指令菜单"能力，**命名不同、归属不同**：

**A. 机器人自定义菜单（Bot Custom Menu）——面向机器人应用，点击式，非 `/` 键入** — [机器人自定义菜单](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/bot-customized-menu)（官方）：

- 定义原文："机器人菜单指启用了机器人能力的应用所提供的交互选项的集合。通过为机器人应用配置自定义菜单，你可以将应用的常用入口**固定在机器人聊天的输入框上**。"
- 两种展示样式：
  - **可切换菜单**："菜单选项与输入框在同一位置，用户可通过点击左侧按钮在菜单和输入框之间切换"，支持客户端 **5.27+**；
  - **悬浮菜单**："菜单选项悬浮在输入框上方，用户可直接点击菜单按钮进行交互"，支持 **7.22+**。
- 交互形态是**点击按钮**，官方文档未描述"输入 `/` 唤起"的形态。
- 机器人概述页把悬浮菜单（Floating Menus）列为机器人能力之一 — [机器人概述](https://open.feishu.cn/document/client-docs/bot-v3/bot-overview?lang=en-US)。

**B. 斜杠指令（Slash Command）——挂在「飞书智能体」平台名下，`/` 指令** — 官方索引与权限存在，正文页未定位（见"不确定"节）：

- open.feishu.cn 站内搜索索引收录了「飞书智能体支持斜杠指令」与「Agent 最佳实践」条目（搜索页为 SPA，正文 URL 无法抓取，仅有搜索摘要）。
- 官方文档「一键创建飞书智能体应用」的权限导入清单包含两项 **Slash Command 权限**：「查询 Slash Command」（`application:app_slash_command:read`）、「编辑 Slash Command」（`application:app_slash_command:write`）— [一键创建飞书智能体应用](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview)。
- 管理 API：`/open-apis/application/v7/app_slash_commands`（详见第 2 节）。

**C. 生态共识：普通自建机器人无原生 `/` 菜单** — OpenClaw（主流多平台 Agent 框架）官方飞书通道文档原文："Feishu/Lark does not support native slash-command menus, so send these as plain text messages." — [openclaw/docs/channels/feishu.md](https://github.com/openclaw/openclaw/blob/main/docs/channels/feishu.md)。

### 2. 如何配置？（Q2）

**机器人自定义菜单（后台配置，无公开配置 API）** — [机器人自定义菜单](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/bot-customized-menu)：

- 入口：开发者后台 → 应用详情 → "添加应用能力"→ 机器人 → 机器人能力配置页 → "机器人自定义菜单" → 开启开关 → 选择展示样式 → 配置菜单 → 保存 → **创建应用版本并发布**（"菜单在设备上生效可能有延迟，版本发布成功后，请稍候 5 分钟再查看菜单效果"）。
- 菜单项配置项：**名称**（"机器人菜单名称最多支持配置 60 个字符"）、**动作类型**；动作选"推送事件"时另配**自定义唯一标识（event_key）**，该标识会作为回调中 `event_key` 的值发送给服务器。
- 数量上限：可切换菜单最多 3 个主菜单 × 每主菜单最多 5 个子菜单；悬浮菜单最多 5 个主菜单 × 每主菜单最多 10 个子菜单。
- 动作类型三种：
  1. **跳转至指定链接**：桌面端/移动端分别配置跳转链接，或配置 Applink（打开小程序、打开群聊等客户端内跳转）；
  2. **发送文字消息**："将菜单文案作为消息发送"，仅飞书 7.22+，低版本客户端不展示该项；
  3. **推送事件**：订阅用户点击菜单项的事件，由开放平台推送到服务端。
- Aily（飞书智能伙伴创建平台）创建的 AI 应用：悬浮菜单由 Aily 管理，"开发者后台的配置默认不生效"。

**斜杠指令（后台"更多能力"配置 + API 动态管理）**：

- 管理 API（live-verified，来源 larksuite/cli 官方 CLI 实现，注释标注 "verified live"）— [larksuite/cli shortcuts/application](https://github.com/larksuite/cli/tree/main/shortcuts/application)：
  - `GET /open-apis/application/v7/app_slash_commands` — 列表（"the upstream API returns all commands at once (**max 100 per app**, no pagination)"）；
  - `POST /open-apis/application/v7/app_slash_commands` — 创建，请求体 `{ "command": "<名称，不带前导 />", "description": { "default_value": "...", "i18n": { "<lang>": "..." } }, "icon": { "icon_key": "..." } }`（icon 服务端默认 `skill_outlined`，无效 key 报错 40000031；名称冲突报错码 40000000 "command already exists"）；
  - `PATCH /open-apis/application/v7/app_slash_commands/:command_id` — 字段级部分更新（description 的 i18n map 为整体替换）；
  - `DELETE /open-apis/application/v7/app_slash_commands/:command_id` — 删除。
  - 权限：`application:app_slash_command:read` / `application:app_slash_command:write`；鉴权：tenant（bot）或 user access token。
  - 生效："changes take ~5 minutes to appear in Feishu clients (client-side cache); the server state is already updated"。
- 控制台配置入口（第三方教程一致描述：开发者后台 → 应用能力 → 更多能力 → 斜杠指令；字段：指令名称以 `/` 开头且不可删、25 字符内、不含空格、应用内唯一；指令描述/使用提示均 25 字符内；指令类型当前仅"用户输入内容后生效"；**回调地址**为 http/https，保存时平台发含 challenge 值的请求、需 1 秒内原样返回）——**该控制台形态目前仅第三方来源（cc-haha 接入教程、BOSS直聘帮助文档镜像）一致描述，官方正文页未定位，见"不确定"节**。注意 BOSS直聘文档（histatic.zhipin.com）是另一平台的镜像，仅字段形态一致，**不可作为飞书官方依据**。
- 不在官方 SDK 元数据中：larksuite/cli 注释 "slashCommandBasePath is the raw v7 endpoint (**not in meta_data.json / SDK**)"；官方 Node/Go/Python SDK 均无 slash command 资源（已逐一检查 larksuite/oapi-sdk-nodejs、oapi-sdk-go、oapi-sdk-python 仓库）。

**普通机器人（纯文本路径）：无需任何配置** ——指令即消息文本，识别逻辑在应用侧（见第 4 节）。

### 3. 指令触发后的回调形态（Q3）

**机器人自定义菜单 → 事件推送 `application.bot.menu_v6`** — [机器人自定义菜单事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/application-v6/bot/events/menu)（官方）：

- 事件类型：`application.bot.menu_v6`（"当用户点击类型为事件的机器人菜单时触发"）。
- 事件体：`schema`、`header`（event_id/event_type/create_time/token/app_id/tenant_key）、`event`：
  - `operator`：operator_name（需额外权限 `application:application.bot.operator_name:readonly` 才返回）、operator_id（union_id/user_id/open_id，user_id 需 `contact:user.employee_id:readonly`）；
  - `event_key`："菜单事件的唯一标识"，1~30 字符（开发者配置菜单时填的自定义标识）；
  - `timestamp`：用户点击菜单时间。
- 订阅：Custom App；订阅所需权限：无；**推送方式支持 Webhook 与长连接（WebSocket）**（文档表格标注 Webhook，示例代码同时给出 ws 与 webhook 两种订阅，官方 SDK 事件分发器含该事件）。
- 注意：事件体**没有 chat/chat_id 字段**——与"仅单聊"一致。

**斜杠指令 → 控制台配置的回调地址（http 回调）**：第三方描述为"用户调用命令时，开放平台将用户输入内容以 JSON 结构发送至该 URL；保存时向该地址发送含 challenge 值的请求校验；用户发送后平台 POST 回调、应用需 1 秒内响应 HTTP 200"。**官方主源未定位，是否支持长连接推送未证实**（见"不确定"节）。

**普通消息 → `im.message.receive_v1`** — [接收消息事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive)（官方）：事件订阅推送，Webhook 与长连接都支持（本项目 ADR-007 的 WSClient 即此路径）。

### 4. 与普通消息的区别：如何识别（Q4）

**没有 `command` 字段**。`im.message.receive_v1` 的 message 对象字段（官方文档逐字段确认）：`message_id`、`root_id`/`parent_id`（仅回复消息场景）、`create_time`/`update_time`、`chat_id`、`thread_id`、`chat_type`（`p2p` 单聊 / `group` 群组）、`message_type`、`content`（JSON 序列化字符串，如 `{"text":"@_user_1 hello"}`）、`mentions`（key/id/mentioned_type: `user`|`bot`/name/tenant_key）、`user_agent`（需额外权限）。— [接收消息事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive)

- 斜杠指令文本到达应用时**就是普通 text 消息**，识别手段 = 解析 `content.text` 前缀（如 `/help`）+ `mentions` 判断是否被 @（mentioned_type 为 bot 表示 @ 了机器人）。
- 机器人菜单事件走独立事件类型 `application.bot.menu_v6`，识别靠 `event_key`（开发者自定义唯一标识），与消息流完全分离。
- 文档提醒："特殊情况下可能会收到重复的推送，如有幂等需求请使用 message_id 去重，不要依赖 event_id"。
- 生态中的斜杠命令实现（OpenClaw/cc-feishu 等）均为纯文本解析：在消息进入 AI 队列前拦截 `/` 前缀消息即时响应。

### 5. 限制（Q5）

**机器人自定义菜单**（官方文档原文数字）— [机器人自定义菜单](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/bot-customized-menu)：

- **仅单聊场景，不支持群聊**（"目前，机器人菜单仅支持单聊场景，不支持群聊场景"）；
- 数量：可切换 3×5、悬浮 5×10（主菜单×子菜单）；
- 名称 ≤60 字符；event_key 1~30 字符；
- 客户端版本：可切换菜单 5.27+、悬浮菜单与"发送文字消息"动作 7.22+（低版本不展示）；
- 应用类型：Custom App（事件文档标注）；Aily 创建的 AI 应用悬浮菜单由 Aily 管理；
- 生效：发布版本后约 5 分钟（客户端缓存延迟）。

**斜杠指令**（API 细节来自 larksuite/cli live-verified 实现，官方正文未定位）：

- 每应用最多 **100 条**指令（列表接口无分页）；
- 指令名在 API 侧不带前导 `/`、应用内唯一（冲突报 40000000）；控制台侧限制（第三方描述）：25 字符内、无空格；
- 客户端展示有约 5 分钟缓存延迟；
- 群聊支持：第三方描述称"机器人在群内时群内所有用户都可用"，**未获官方证实**；
- 适用应用类型：官方权限清单出现在"一键创建飞书智能体应用"文档中，推断面向智能体（Agent）应用，是否适用于普通自建机器人应用未证实。

**普通消息（降级路径）**：无指令数量限制（文本即指令），单聊/群聊都可用，限流与普通消息相同（同用户 5 QPS、同群共享 5 QPS、接口级 1000 次/分钟 — 见 [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)，与既有 streaming 调研一致）。

### 6. 结论：纯文本解析降级 vs 指令菜单增强（Q6）

**纯文本解析路径（现状，`im.message.receive_v1` 收 `/` 开头文本）**：

- 完全可行，是生态主流：OpenClaw 官方飞书通道"不支持原生斜杠指令菜单，以纯文本消息发送"；cc-feishu（Claude Code 飞书桥接）的 `/start`、`/status` 等全套指令均为消息拦截解析。
- 无指令数量上限、单聊群聊通用、无需版本发布/后台配置，识别逻辑完全自主可控。
- 代价：无输入框候选菜单、无平台级校验，指令必须依赖消息文本到达（用户在群聊中需 @ 机器人）。

**指令菜单（可配置增强）**：

- **单聊场景**：机器人自定义菜单可用——点击式按钮固定在/悬浮于输入框，事件 `application.bot.menu_v6` 经事件订阅推送（**与 ADR-007 的 WSClient 长连接兼容**，事件文档示例含 WebSocket 订阅方式；官方 Node SDK 事件分发器已内置该事件）。约束：仅单聊、数量上限（3×5 / 5×10）、动作三选一、需后台配置 + 发布版本 + 约 5 分钟生效、客户端版本门槛（7.22+ 才有悬浮菜单/发文字动作）。
- **`/` 输入唤起（斜杠指令）**：属于飞书智能体（Agent）平台能力，有管理 API（最多 100 条）但：① 不在官方 SDK 元数据中；② 回调形态为控制台配置的 http 回调地址（webhook 式，含 challenge 校验，响应需 1 秒内 200），与长连接收事件架构的兼容性未证实；③ 官方正文文档未定位。**普通自建应用不可作为方案依据**。
- 现实项目决策参考：bifrost-proxy/bifrost 设计文档明确"不创建/更新/同步机器人自定义菜单，也不订阅菜单事件；群会话和单聊控制统一继续使用 @机器人 与现有 slash 命令"（原因：避免依赖额外权限、后台发布配置和客户端展示策略）— [bifrost design/feishu-group-agent-session.md](https://github.com/bifrost-proxy/bifrost/blob/main/design/feishu-group-agent-session.md)。

**一句话结论：指令菜单是可配置增强（单聊点击式菜单可行且与长连接兼容；`/` 斜杠指令是智能体平台专属、webhook 回调、不可依赖），纯文本解析是唯一无条件的降级路径，也是生态事实标准。**

## 不确定 / 待验证

- **斜杠指令官方文档正文页 URL 未定位**：open.feishu.cn 站内搜索索引明确收录"飞书智能体支持斜杠指令"+"Agent 最佳实践"（多次检索的搜索摘要一致），但文档站点为 SPA、正文无法抓取，`server-docs/application-v7/`、`uAjLw4CM/.../application-v7/` 等路径猜测均 404。若实现依赖斜杠指令，需人工打开 open.feishu.cn 站内搜索"斜杠指令"取正文。
- **斜杠指令回调 payload 与推送通道**：`command_id`/`command_name` 字段、challenge 校验 1 秒、指令类型"用户输入内容后生效"等细节仅来自第三方描述（cc-haha 接入教程与 BOSS直聘镜像文档，两者一致但与官方正文无交叉验证）；是否支持长连接（WSClient）推送未证实。
- **斜杠指令的群聊支持与应用类型范围**：第三方描述称群聊内可用、可用性同应用可见性；官方未证实；也未知是否仅限智能体（Agent）应用。
- **app_slash_commands 上限 100 条/应用**：来自 larksuite/cli（Lark 官方 CLI，注释 "verified live"），未见官方文档数字。
- **机器人菜单是否有配套管理 API**：权限 `application:bot.menu:write`（创建/更新/删除机器人菜单）出现在官方权限清单中，但本次未定位到对应 API 文档，后台配置是唯一已证实路径。
- **菜单事件双通道确认**：事件文档表格标注"推送方式 Webhook"，但官方 SDK 示例代码与分发器同时提供 WebSocket 订阅——实践中 WSClient 是否推送 `application.bot.menu_v6` 建议实测确认（参考既有 streaming 调研中"长连接只负责接收事件"的结论，事件类应均可订阅）。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| 机器人自定义菜单（开发指南） | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v3/bot-customized-menu | 2026-08-03 | 定义/两种样式/数量上限/动作类型/仅单聊/5 分钟生效/Aily 例外 |
| 机器人自定义菜单事件 | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/application-v6/bot/events/menu （另见 client-docs/bot-v3/events/menu） | 2026-08-03 | application.bot.menu_v6、event_key/operator/timestamp、Custom App、无权限要求、Webhook+WS 示例 |
| 机器人概述（Bot Overview） | https://open.feishu.cn/document/client-docs/bot-v3/bot-overview?lang=en-US | 2026-08-03 | 机器人菜单/悬浮菜单列为机器人能力 |
| 接收消息事件 im.message.receive_v1 | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive （另见 server-docs/im-v1/message/events/receive） | 2026-08-03 | message 对象字段全表、**无 command 字段**、mentions、message_id 幂等 |
| 一键创建飞书智能体应用（MCP 开放工具） | https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview | 2026-08-03 | Slash Command 权限 scope（read/write）、默认 WebSocket 长连接订阅、权限清单 |
| larksuite/cli（Lark 官方开源 CLI） | https://github.com/larksuite/cli/tree/main/shortcuts/application | 2026-08-03 | app_slash_commands 端点 live-verified：list/create/patch/delete、100 条上限、command 不带 /、40000000/40000031、5 分钟缓存 |
| larksuite/oapi-sdk-go（application v7） | https://github.com/larksuite/oapi-sdk-go/tree/v3_main/service/application/v7 | 2026-08-03 | 官方 SDK 无 slash command 资源（对照验证） |
| OpenClaw 飞书通道文档 | https://github.com/openclaw/openclaw/blob/main/docs/channels/feishu.md | 2026-08-03 | "Feishu/Lark does not support native slash-command menus"生态佐证 |
| bifrost 设计文档 | https://github.com/bifrost-proxy/bifrost/blob/main/design/feishu-group-agent-session.md | 2026-08-03 | 真实项目决策：不用菜单事件、用 @机器人 + 文本 slash 命令 |
| 发送消息 API（限流背景） | https://open.feishu.cn/document/server-docs/im-v1/message/create | 2026-08-03 | 降级路径无额外限流（与 streaming 调研一致） |
| 既有调研（背景） | .aiassist/wayfind/builtin-agent/research/feishu-streaming.md | 2026-08-03 | WSClient 长连接 + ADR-007 背景 |
