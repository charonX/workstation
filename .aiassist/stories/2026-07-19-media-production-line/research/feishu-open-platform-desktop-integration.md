# Research: 飞书开放平台桌面应用集成

> 调研日期：2026-07-19
> 主题：飞书 OpenAPI 面向本地桌面应用（Node.js、无公网 IP）的集成方式
> 来源：primary sources（见每节引用）

## 执行摘要

- **长连接（WebSocket）是官方一等事件订阅方式，确认无需公网 IP/域名**：只需运行环境能访问公网（出方向连接），"无需提供公网 IP 或域名、无需使用内网穿透工具"；通过集成官方 SDK 建立 WebSocket 全双工通道，鉴权只在建连时进行，后续事件为明文、无需解密验签。**限制：仅支持企业自建应用**（商店应用不支持）；每个应用最多 50 个连接；消息推送为集群模式（多客户端只有一个随机收到）。（[使用长连接接收事件](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-configuration-case)）
- **单个官方 SDK `@larksuiteoapi/node-sdk` 即可覆盖全部需求**：内置 `WSClient`（长连接，≥1.24.0，源码确认 `autoReconnect` 默认开启）、`EventDispatcher`、全部 OpenAPI 的语义化调用（im、docx 等）与 `tenant_access_token` 自动缓存；GitHub main 分支版本 1.71.1，npm 2026 年上半年发布至 1.66.x+，维护活跃。还提供对桌面场景高度相关的 `registerApp`（OAuth 2.0 Device Authorization Grant，扫码即建应用拿凭证）与 `Channel` 高层模块。（[larksuite/node-sdk README](https://github.com/larksuite/node-sdk)、[package.json@main](https://raw.githubusercontent.com/larksuite/node-sdk/main/package.json)、[ws-client 源码](https://raw.githubusercontent.com/larksuite/node-sdk/main/ws-client/index.ts)）
- **Markdown → 云文档有官方 API 通路**：`POST /open-apis/docx/v1/documents/blocks/convert` 将 Markdown/HTML 转为文档块（scope `docx:document.block:convert`），再用"创建嵌套块"插入（单次最多 1000 块）；备选为 `POST /open-apis/drive/v1/import_tasks` 直接导入 .md 文件为 docx（异步任务）。（[Markdown/HTML 内容转换为文档块](https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/convert)、[创建导入任务](https://open.feishu.cn/document/server-docs/docs/drive-v1/import_task/create)）
- **应用身份（tenant_access_token）创建的文档默认 owner 是应用，用户打不开**：必须额外调用权限 API——`POST /open-apis/drive/v1/permissions/{token}/members?type=docx` 把用户加为协作者（member_type=email/openid，perm=view/edit/full_access），或 `PATCH .../public` 设置 `link_share_entity=tenant_readable` 等链接分享。（[增加协作者权限](https://open.feishu.cn/document/server-docs/docs/permission/permission-member/create)、[更新云文档权限设置](https://open.feishu.cn/document/server-docs/docs/permission/permission-public/patch)）
- **版本发布需要"企业管理员"审核，但不需要飞书官方审核**；管理员可对应用开"免审"。官方文档要求开发者"先成为飞书企业用户"，并建议测试阶段自行创建新企业以实现权限/发布免审。**个人（无企业）账号能否创建应用并启用长连接，官方文档未明示——不确定**。（[企业自建应用开发流程](https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process)、[发布与审核自建应用](https://open.feishu.cn/document/home/intro-to-custom-app-review)）

## 详细发现

### 长连接事件订阅

- **建立方式**：通过官方 SDK 建立，非裸协议。Node.js 形态：`new Lark.WSClient({appId, appSecret, loggerLevel})` + `wsClient.start({ eventDispatcher: new Lark.EventDispatcher({}).register({'im.message.receive_v1': async (data) => {...}}) })`。要求 SDK ≥ 1.24.0。事件回调里拿到的 `data` 即事件体（含 `message.chat_id / message.content / message.message_id / sender` 等）。（[使用长连接接收事件 · Node.js 示例](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-configuration-case)、[接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)）
- **协议细节（SDK 源码确认）**：先 `POST {domain}/callback/ws/endpoint`（带 AppID/AppSecret）换取 wss 连接地址与 ClientConfig；传输使用 protobuf 帧（依赖 `ws`、`protobufjs`）；ping/pong 心跳，pong 会下发更新的重连参数。（[ws-client/index.ts](https://raw.githubusercontent.com/larksuite/node-sdk/main/ws-client/index.ts)）
- **断线重连语义（SDK 源码确认）**：构造参数 `autoReconnect` 默认 `true`；ws `close` 事件触发重连；重连次数/间隔/抖动（ReconnectCount/ReconnectInterval/ReconnectNonce）由**服务端下发**，`reconnectCount < 0` 表示无限重连；提供 `onReady / onReconnecting / onReconnected / onError` 回调与 `getConnectionStatus()`（state: connecting/connected/reconnecting/failed/idle）；可选 `pingTimeout` 存活看门狗与 `handshakeTimeoutMs`。（同上源码）
- **支持的事件**：控制台"事件与回调"中勾选的事件均通过长连接推送，`im.message.receive_v1` 在内（官方示例即用它）。事件需先在开发者后台添加并**发布应用版本**后生效。（[事件概述](https://open.feishu.cn/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM)）
- **处理时限与重推**：收到消息后需 **3 秒内处理完成且不抛异常**，否则触发超时重推（15 秒、5 分钟、1 小时、6 小时，最多重试 4 次）；链路为 at-least-once，**可能重复推送，需幂等**——接收消息事件文档明确"用 `message_id` 去重，不要依赖 event_id"。（[事件概述 · 事件推送](https://open.feishu.cn/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM)、[接收消息事件 · 注意事项](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)）
- **是否真不需要公网 IP/域名**：是。官方原文"只需保证运行环境具备访问公网的能力即可，无需提供公网 IP 或域名、无需使用内网穿透工具……无需部署防火墙和配置白名单"。对绑定 127.0.0.1 的桌面应用完全适用（长连接是出方向连接）。（[使用长连接接收事件 · 功能优势](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-configuration-case)）
- **配置位置**：开发者后台 → 应用详情 → **事件与回调 > 事件配置** → 编辑订阅方式 → 选"使用长连接接收事件"。官方文档警告：**保存时需本地长连接客户端已启动在线**（"必须确保本地客户端启动正常，有长连接在线的情况下，才能保存成功"）。（同上，步骤二）
- **个人 vs 企业**：长连接模式**仅支持企业自建应用**（商店应用不支持）。个人账号差异见"不确定"一节。（同上，注意事项）
- 补充：SDK README 提到长连接目前只支持事件订阅、不支持回调订阅（卡片回调在新版本已有变化——README 的 `Channel` 模块与 `CardActionHandler` 处理了卡片交互，`registerApp` 的 addons 支持 `callbacks`，README "Points to Note" 条目可能滞后，**待验证**）。（[node-sdk README](https://github.com/larksuite/node-sdk)）

### 消息收发与 tenant_access_token

- **发送消息**：`POST /open-apis/im/v1/messages`，查询参数 `receive_id_type` ∈ `open_id / union_id / user_id / email / chat_id`；请求体 `{receive_id, msg_type, content, uuid?}`，`content` 为 JSON 序列化字符串。`msg_type` ∈ text/post/image/file/audio/media/sticker/interactive/share_chat/share_user/system。文本结构 `{"text":"..."}`；post 为富文本结构（详见"发送消息内容"文档）。限频：同一用户 5 QPS、同一群共享 5 QPS；文本请求体 ≤150KB、卡片/富文本 ≤30KB。前提：开启机器人能力并发布版本；接收用户须在机器人**可用范围**内；发群消息要求机器人在群内有发言权限。（[发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)）
- **回复消息**：`POST /open-apis/im/v1/messages/:message_id/reply`，体 `{content, msg_type, reply_in_thread?, uuid?}`；**`reply_in_thread: true` 即话题（thread）回复**，返回体含 `root_id/parent_id/thread_id`。（[回复消息](https://open.feishu.cn/document/server-docs/im-v1/message/reply)）
- **所需权限（发送/回复，任一即可）**：`im:message`（获取与发送单聊、群组消息）、`im:message:send_as_bot`（以应用的身份发消息）、`im:message:send`（历史版）。以用户身份发消息另需 `im:message.send_as_user`。（同上两篇"权限要求"）
- **接收消息事件的权限（决定推送范围，任一即可订阅事件）**：单聊 `im:message.p2p_msg:readonly`（或历史版 `im:message.p2p_msg`）、群@机器人 `im:message.group_at_msg:readonly`（或 `im:message.group_at_msg`）、群内全部消息 `im:message.group_msg`（敏感权限）/`im:message.group_msg:readonly`、其他机器人消息 `im:message.group_bot_msg:readonly`、含 bot 的@消息 `im:message.group_at_msg.include_bot:readonly`。（[接收消息事件 · 注意事项](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)）
- **tenant_access_token**：`POST /open-apis/auth/v3/tenant_access_token/internal`，体 `{app_id, app_secret}`，无需任何权限 scope；返回 `tenant_access_token` + `expire`（示例 7200 秒）。**最大有效期 2 小时**；剩余有效期 <30 分钟时再调用会签发新 token（两 token 短暂并存），≥30 分钟返回原 token。（[自建应用获取 tenant_access_token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)）
- **缓存建议（SDK 行为）**：SDK `TokenManager` 自动缓存 token，过期时间按 `expire` **提前 3 分钟**处理，调用 API 时自动注入 `Authorization: Bearer`；可用 `disableTokenCache` 关闭或注入自定义 `cache`。（[token-manager.ts](https://raw.githubusercontent.com/larksuite/node-sdk/main/client/token-manager.ts)、README Client 参数表）

### 云文档 docx API

- **创建文档**：`POST /open-apis/docx/v1/documents`，体 `{folder_token?, title?}`（title 1–800 字符纯文本；**不支持带内容创建**）。权限：`docx:document`（创建及编辑新版文档）或 `docx:document:create`（创建新版文档），任一。注意：用 `tenant_access_token` 时 `folder_token` **只能指定应用自己创建的文件夹**；不传则挂到根目录。单应用限频 3 次/秒。返回 `document_id`，URL 形如 `https://{domain}/docx/{document_id}`。（[创建文档](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/create)）
- **写入内容（blocks）**：文档由 Block 组成（文本、标题 1–9、列表、代码块、引用、待办、图片、表格等，block_type 枚举 1–52）。写入选项：
  - 逐块追加：`POST /open-apis/docx/v1/documents/{document_id}/blocks/{block_id}/children`（创建子块，官方文档存在该接口；本次未逐字核验其页面，标注"待验证"）。
  - 批量嵌套插入：`document-block-descendant/create`（创建嵌套块），**单次最多插入 1000 个块**，超量需分批。（[Markdown/HTML 内容转换为文档块 · 注意事项](https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/convert)）
- **"导入 Markdown"能力（两条官方通路）**：
  1. **转换 API（推荐，同步）**：`POST /open-apis/docx/v1/documents/blocks/convert`，体 `{content_type: "markdown"|"html", content}`（content 最大约 10MB 字符），返回带父子关系的 blocks 与 `first_level_block_ids`（临时 ID），随后调"创建嵌套块"插入目标文档。scope：`docx:document.block:convert`。注意：表格块插入前需删除只读 `merge_info` 字段；图片块需额外走"上传素材 + replace_image"流程。（同上）
  2. **导入任务（异步）**：先 `drive/v1/files/upload_all`（或 media/upload_all）上传 .md 得到 file_token，再 `POST /open-apis/drive/v1/import_tasks`（`file_extension` 须与实际后缀严格一致，支持 "markdown"/"md"；`type: "docx"`；`point.mount_key` 指定挂载文件夹）→ 返回 ticket → `GET import_tasks/{ticket}` 轮询结果。scope：`docs:document:import` 或 `drive:drive`。文件 ≤20MB；上传 token 5 分钟有效。（[创建导入任务](https://open.feishu.cn/document/server-docs/docs/drive-v1/import_task/create)）
- **文档权限（创建后谁可见）**：用 `tenant_access_token` 创建时 owner 为**应用**，普通用户默认不可见。两条开放路径：
  - **加协作者**：`POST /open-apis/drive/v1/permissions/{token}/members?type=docx`，体 `{member_type: "email"|"openid"|"userid"|"openchat"|..., member_id, perm: "view"|"edit"|"full_access", type: "user"|"chat"|...}`。要求调用身份与被授权对象互相可见（同租户可搜索、未屏蔽）。细粒度 scope：`docs:permission.member:create`（或大盘 scope `docs:doc`/`drive:drive` 等）。（[增加协作者权限](https://open.feishu.cn/document/server-docs/docs/permission/permission-member/create)）
  - **链接分享**：`PATCH /open-apis/drive/v1/permissions/{token}/public?type=docx`（v1，有 v2 新版 `drive-v2/permission-public/patch`），体含 `link_share_entity: "tenant_readable"|"tenant_editable"|"anyone_readable"|"anyone_editable"|"closed"` 及 `external_access/share_entity/comment_entity/security_entity` 等。对个人场景 `tenant_readable`（组织内获得链接可阅读）即可让 owner 点开链接。细粒度 scope：`docs:permission.setting:write_only`。（[更新云文档权限设置](https://open.feishu.cn/document/server-docs/docs/permission/permission-public/patch)）

### Node.js SDK 能力

- **包与版本**：`@larksuiteoapi/node-sdk`（MIT，larksuite 官方 org）。GitHub main 分支 `package.json` 版本 **1.71.1**；npm 2026 年发布节奏活跃（2026-05 已见 1.66.x/1.67.0）。运行时依赖：axios、ws、protobufjs、qs、lodash 若干。同时发布 CJS（lib）+ ESM（es）+ 类型（types），TypeScript 原生支持。（[package.json@main](https://raw.githubusercontent.com/larksuite/node-sdk/main/package.json)、[npm 包页](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)）
- **API 覆盖**：`client.{业务域}.{资源}.{方法}` 语义化调用由代码生成覆盖开放平台全部 API（im、docx、drive、contact 等），未生成的老接口可用 `client.request()` 兜底；`tenant_access_token` 获取/缓存内置。示例 `client.im.message.create({params:{receive_id_type:'chat_id'}, data:{...}})`。（[README](https://github.com/larksuite/node-sdk)）
- **长连接客户端**：`Lark.WSClient`（≥1.24.0），API 形态 `wsClient.start({eventDispatcher})`、`wsClient.close({force})`、`getConnectionStatus()`，构造支持 `autoReconnect`、agent（代理）、`onReady/onError/onReconnecting/onReconnected`。（[ws-client 源码](https://raw.githubusercontent.com/larksuite/node-sdk/main/ws-client/index.ts)）
- **桌面场景的高阶能力（README，main 分支）**：
  - `lark.registerApp(...)`：基于 **OAuth 2.0 Device Authorization Grant (RFC 8628)** 的一键建应用——返回验证 URL/二维码，用户在飞书里确认后 SDK 直接拿到 `client_id/client_secret`，**无需用户手工进开发者后台建应用**；`addons` 可增量申请 scopes（tenant/user）、事件（如 `im.message.receive_v1`）、回调；`preset:false` 走最小模板（仅机器人能力）。限制：addons 只能加不能减；事件订阅方式等敏感配置不能经 addons 下发。
  - `createLarkChannel({appId, appSecret})`：`Channel` 高层模块，封装长连接 + 消息规范化 + 发送/流式回复/媒体上传/卡片交互，`channel.on('message', ...)` / `channel.send(chatId, {markdown}, {replyTo})`。
- **维护状态**：高度活跃——近期新增 Channel、registerApp、client-assertion（无 secret 的 keyless 模式）等；版本从 1.24（长连接引入）迭代到 1.71.x。（README、index.ts 导出列表）

### 应用创建与权限最小集

- **创建自建应用要点**：开发者后台（open.feishu.cn/app）创建企业自建应用 → 凭证与基础信息页获取 App ID/App Secret → **添加应用能力：启用"机器人"** → 权限管理开通 scope → （可选）事件与回调添加事件、选订阅方式 → **创建版本并发布**（基本信息/权限/能力/事件订阅任何变更都需发新版）。机器人能力"开启后需要发布版本才能生效"。（[企业自建应用开发流程](https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process)、[发送消息 · 前提条件](https://open.feishu.cn/document/server-docs/im-v1/message/create)）
- **发布与审核**：自建应用**无需飞书官方审核，由企业管理员审核**后生效；管理员可在管理后台为具体应用开"免审"或配置免审策略。官方建议测试阶段"自行创建一个新企业，在新企业中创建应用、添加权限，实现权限免审"。（[发布与审核自建应用](https://open.feishu.cn/document/home/intro-to-custom-app-review)、开发流程文档）
- **权限最小集（按本场景）**：
  - 收消息（事件）：订阅 `im.message.receive_v1` + 至少一个范围 scope：私聊场景 `im:message.p2p_msg:readonly` 即可；群@场景 `im:message.group_at_msg:readonly`。
  - 发消息/回复：`im:message:send_as_bot`（或 `im:message`）。
  - 创建文档：`docx:document:create`（只创建）或 `docx:document`（创建+编辑）。
  - Markdown 写入：`docx:document.block:convert` + 插入块所需的文档编辑权限（`docx:document`）。
  - 文档分享：`docs:permission.member:create`（加协作者）和/或 `docs:permission.setting:write_only`（链接分享）。
  - （备选导入通路：`docs:document:import` + 上传文件相关 drive scope。）
- **事件订阅"长连接"配置位置**：开发者后台 → 事件与回调 → 事件配置 → 订阅方式 → "使用长连接接收事件"（保存时要求客户端在线）。（[使用长连接接收事件 · 步骤二](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-configuration-case)）

## 不确定 / 待验证

1. **个人（无企业）账号能否创建自建应用并启用长连接**：官方"企业自建应用开发流程"写明开发前"必须先成为飞书的企业用户（创建企业或加入企业）"，未直接回答纯个人账号（个人版飞书）的能力边界。社区资料（如 feishu2md README）提到可"创建企业自建应用（个人版）"，但非官方表述。**官方建议的等价路径是个人自行创建一个新企业（自己即管理员，发布免审）**。个人版租户中长连接、`registerApp` 是否受限，官方文档未写明。
2. **`registerApp` 的适用范围与落地细节**：仅见于 SDK main 分支 README（未见对应开放平台文档页）；其创建的应用是否自动启用长连接订阅方式（README 说事件订阅方式属敏感配置、不能经 addons 下发）、生成的应用默认含哪些基础权限、是否仍需发版审核——均待实测验证。
3. **长连接是否支持卡片回调（callback）**：README "Points to Note" 称"长连接只支持事件订阅、不支持回调订阅"，但 `registerApp` addons 与 `Channel` 文档提到 callbacks（`card.action.trigger`），两处表述可能存在版本差，待验证当前行为。
4. **创建子块接口 `document-block-children/create` 的参数细节**（单次块数上限、index 语义）：本次未逐字核验该页（推荐路径已是 convert + descendant/create，后者上限 1000 块已确认）。
5. **`docs:document:import` 等细粒度 scope 的可用性/是否逐步开放**：文档页"权限要求"列出即为可申请，但未验证个人租户下是否全部可勾选。
6. **npm 当前最新发布版本号**：registry 页面无法直接抓取（JS 渲染/JSON 不可提取）；已确认 main 分支 1.71.1、2026-05 发布 ≥1.66.0，安装时以 `npm view` 实测为准。

## 开放问题（留给 /tech-design）

- 凭证获取流程选型：要求用户手工建应用贴 App ID/Secret，还是用 SDK `registerApp` 扫码一键建应用（体验好但依赖 main 分支新能力，需版本基线与回退方案）。
- 长连接的生命周期管理：Electron 主进程驻留？断网/休眠唤醒后依赖 SDK 自动重连是否足够，是否需要 `getConnectionStatus()` + 心跳 UI 反馈；多实例运行时集群模式只投递一个连接的影响。
- 3 秒处理时限下的架构：事件回调内只做入队、异步处理（日报生成/确认流程），避免超时重推；`message_id` 幂等去重的存储设计。
- 文档权限策略：每篇文档 `members create` 定向授权（member_type=email/openid）vs 一次性 `link_share_entity=tenant_readable`；对"个人开发者自建企业"场景两者都可行，取舍待定。
- Markdown 写入通路选型：`blocks/convert`（同步、结构可控、图片需额外流程）vs `import_tasks`（异步、整篇导入、适合大文件）。
- scope 最小集与"免审"引导文案：个人自建企业场景如何引导用户自己审核通过，以及 scope 变更必须发版的产品提示。

## 参考来源清单

| 来源 | URL | 访问日期 | 用途 |
|---|---|---|---|
| 飞书开放平台 · 使用长连接接收事件 | https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-configuration-case | 2026-07-19 | 长连接能力、限制、配置位置、SDK 版本要求 |
| 飞书开放平台 · 事件概述 | https://open.feishu.cn/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM | 2026-07-19 | 订阅方式对比、3 秒时限、重推与幂等 |
| 飞书开放平台 · 接收消息事件 im.message.receive_v1 | https://open.feishu.cn/document/server-docs/im-v1/message/events/receive | 2026-07-19 | 事件体结构、所需 scope、message_id 去重 |
| 飞书开放平台 · 发送消息 | https://open.feishu.cn/document/server-docs/im-v1/message/create | 2026-07-19 | receive_id_type、msg_type、限频、前提条件 |
| 飞书开放平台 · 回复消息 | https://open.feishu.cn/document/server-docs/im-v1/message/reply | 2026-07-19 | reply API、reply_in_thread |
| 飞书开放平台 · 自建应用获取 tenant_access_token | https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal | 2026-07-19 | token 端点、2 小时有效期、双 token 并存语义 |
| 飞书开放平台 · 创建文档（docx） | https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/create | 2026-07-19 | 创建文档参数、folder_token 限制、scope |
| 飞书开放平台 · Markdown/HTML 内容转换为文档块 | https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/convert | 2026-07-19 | convert API、块类型、嵌套插入 ≤1000 块、表格/图片注意 |
| 飞书开放平台 · 创建导入任务 | https://open.feishu.cn/document/server-docs/docs/drive-v1/import_task/create | 2026-07-19 | Markdown 文件导入为 docx、异步流程、scope |
| 飞书开放平台 · 增加协作者权限 | https://open.feishu.cn/document/server-docs/docs/permission/permission-member/create | 2026-07-19 | 文档协作者授权 API |
| 飞书开放平台 · 更新云文档权限设置 | https://open.feishu.cn/document/server-docs/docs/permission/permission-public/patch | 2026-07-19 | link_share_entity 链接分享设置 |
| 飞书开放平台 · 企业自建应用开发流程 | https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process | 2026-07-19 | 建应用流程、企业用户前提、测试企业免审建议 |
| 飞书开放平台 · 发布与审核自建应用 | https://open.feishu.cn/document/home/intro-to-custom-app-review | 2026-07-19 | 管理员审核、免审配置 |
| larksuite/node-sdk · README（GitHub） | https://github.com/larksuite/node-sdk | 2026-07-19 | SDK 能力总览、WSClient、Channel、registerApp |
| larksuite/node-sdk · package.json / ws-client / token-manager 源码 | https://raw.githubusercontent.com/larksuite/node-sdk/main/package.json 等 | 2026-07-19 | 版本 1.71.1、依赖、自动重连与 token 缓存实现 |
| npm · @larksuiteoapi/node-sdk | https://www.npmjs.com/package/@larksuiteoapi/node-sdk | 2026-07-19 | 发布渠道与近期版本节奏 |
