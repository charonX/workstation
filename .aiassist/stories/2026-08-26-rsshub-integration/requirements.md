# Requirements — RSSHub 集成与可扩展服务凭据管理

> 故事 ID：`2026-08-26-rsshub-integration`
> 版本：v1
> 最后更新：2026-08-27
> 来源：`prd.md` v0.2（§4 四大稳定块、§10 技术方案、§10.3 接口契约）
> 移动块：PRD §5 移动块 1（更多小众平台路由规则）、移动块 2（Radar 自动探测）、移动块 3（自定义表单生成）留待后续迭代，不入本 REQ
> 测试目录：`tests/capabilities/collection-pipeline/content-source/2026-08-26-rsshub-integration/` 与 `tests/capabilities/workspace-management/credentials/2026-08-26-rsshub-integration/`

---

## REQ-CRED-001 通用可扩展服务凭据管理与安全加密

- 优先级 P0 / 必须 / cross-module / credentialsService + secretStore + routes/settings / workspace-management / credentials / 单元 + 集成
- 接口契约（PRD §10.3 接口 1 & 接口 2）：
  - 数据模型：`settings.credentials` 存储结构为字典对象 `{ [serviceType: string]: { baseUrl: string, accessKeyEncrypted?: string, enabled?: boolean, updatedAt?: string } }`。
  - 读取 API：`GET /api/settings/credentials`
    - 响应脱敏视图：`{ credentials: { [serviceType: string]: { baseUrl: string, configured: boolean, updatedAt?: string } } }`。绝不返回明文 Key 或密文 Key。
  - 保存 API：`PUT /api/settings/credentials/:service`
    - 输入：`{ baseUrl: string, accessKey?: string }`。
    - 校验规则：`baseUrl` 必须为有效 http/https URL（自动去除尾部 `/`）；`accessKey` 字符串不超过 256 字符；若更新时未提供 `accessKey` 则保留已有密文。
    - 安全存储：敏感 Key 经 `secretStore.encryptSecret` 加密后落盘到 `settings.json`，权限保持 `0o600`。
    - 响应体：`{ service: string, baseUrl: string, configured: boolean, updatedAt: string }`。

验收标准：
1. **基础凭据读写与加密存储（锚点 §6.3 稳定块 1）**：保存 `rsshub` 凭据 `{ baseUrl: "http://localhost:1200/", accessKey: "secret-token" }`，`settings.json` 中保存规范化 `baseUrl: "http://localhost:1200"` 以及 `accessKeyEncrypted` 密文字符串，文件权限为 0o600（单元/集成：fakeSecretBackend 注入）。
2. **脱敏只读契约（锚点 §6.3 稳定块 1）**：发起 `GET /api/settings/credentials`，返回 200 且包含 `{ credentials: { rsshub: { baseUrl: "http://localhost:1200", configured: true } } }`，响应中无 `accessKey` 明文或密文字段（集成）。
3. **部分更新保全已有 Key**：对已有密文的 `rsshub` 服务发起 `PUT /api/settings/credentials/rsshub` 仅更新 `{ baseUrl: "https://rsshub.custom.io" }`（不传 `accessKey`），系统保留原有的 `accessKeyEncrypted`，`configured` 仍为 `true`（单元/集成）。
4. **多服务可扩展性**：支持以不同 `service` 标识（如 `github`、`custom_api`）独立保存和读取不同服务凭据，互不干扰（单元）。
5. **非法 URL 输入校验拦截（§7 表单与输入验证）**：提交非法协议 `ftp://invalid` 或无主机 URL 时，返回 400 及错误码 `E-CONFIG-INVALID`（集成）。

---

## REQ-CRED-002 服务凭据连通性与密钥测试

- 优先级 P0 / 必须 / cross-module / credentialsService + routes/settings / workspace-management / credentials / 集成
- 接口契约（PRD §10.3 接口 3）：
  - 测试 API：`POST /api/settings/credentials/:service/test`
  - 输入：`{ baseUrl: string, accessKey?: string }`（支持测试未保存的表单值；若 `accessKey` 缺省则自动尝试读取已保存的加密 Key 解密测试）。
  - 连通探测机制：针对 `service === "rsshub"`，向 `${baseUrl}/` 发送探测请求（带 `Authorization: Bearer <key>` 或 `?key=<key>`），测量往返耗时 `latencyMs`。
  - 响应体：`{ ok: boolean, latencyMs: number, error?: string }`。
  - 异常处理：连接被拒绝/超时返回 `{ ok: false, error: "ECONNREFUSED" }`；401/403 返回 `{ ok: false, error: "AUTH_FAILED" }`。

验收标准：
1. **测试连接成功（锚点 §6.1 流程 A）**：针对运行正常的 RSSHub Mock Server 发送测试请求，返回 200 且 `{ ok: true, latencyMs: <正整数> }`（集成：本地 Mock Server）。
2. **测试连接鉴权失败识别（§8 E3）**：当目标服务返回 401/403 时，测试接口返回 `{ ok: false, error: "E-CRED-AUTH-FAILED" }`（集成）。
3. **网络不通/不可达识别（§8 E2）**：当目标端口未监听或 DNS 不可达时，测试接口返回 `{ ok: false, error: "E-CRED-CONN-FAILED" }`（集成）。

---

## REQ-SRC-004 社交账号自动映射与带鉴权路由生成

- 优先级 P0 / 必须 / cross-module / contentSourceService + credentialsService / collection-pipeline / content-source / 单元 + 集成
- 业务契约（PRD §4 稳定块 2 & §7 表单与输入验证）：
  - 平台类型扩展：`contentSourceService` 支持 `webpage`、`rss`、`x`、`wechat`、`bilibili`。
  - 账号映射规范：
    - `x` (Twitter)：输入 `@username` 或 `username` $\rightarrow$ 路由路径 `/twitter/user/:username`。
    - `wechat` (微信公众号)：输入 `account_id` $\rightarrow$ 路由路径 `/wechat/mp/msghistory/:account_id`。
    - `bilibili` (B站)：输入 `uid`（纯数字） $\rightarrow$ 路由路径 `/bilibili/user/video/:uid`。
  - 动态路由解析器：`resolveSourceFeedUrl(source)` 函数根据 source 的 type 与 config 以及当前配置的 RSSHub Base URL 自动生成完整请求 URL，并判断是否需要注入 AccessKey。

验收标准：
1. **X 账号路由映射（锚点 §6.3 稳定块 2）**：创建 `type: "x"`, `config: "@elonmusk"` 内容源，解析得到的 feed URL 为 `<rsshubBaseUrl>/twitter/user/elonmusk`（单元）。
2. **Bilibili UID 纯数字校验与映射（锚点 §6.3 稳定块 2 & §7）**：创建 `type: "bilibili"`, `config: "2267573"` 内容源，解析得到的 feed URL 为 `<rsshubBaseUrl>/bilibili/user/video/2267573`；若输入非数字 `UID_abc` 则抛出 400 `E-SRC-CONFIG`（单元）。
3. **普通 RSS 绝对 URL 原样保留**：`type: "rss"`, `config: "https://example.com/feed.xml"` 时，解析得到的 feed URL 原样保持 `https://example.com/feed.xml`（单元）。
4. **未配置 RSSHub 时行为（§7.1 & §8 E4）**：在未配置 RSSHub Base URL 时调用社交类型源的 URL 解析，返回带有 `unconfigured: true` 标记或抛出 `E-RSSHUB-NOT-CONFIGURED`，不产生畸变 URL（单元）。

---

## REQ-SRC-005 带鉴权的 Feed 抓取与标准化 XML 解析

- 优先级 P0 / 必须 / cross-module / feedFetcherService + routes/contentSources / collection-pipeline / content-source / 单元 + 集成
- 接口契约（PRD §10.3 接口 4）：
  - 抓取 API：`POST /api/content-sources/:id/fetch`
  - 抓取与解析逻辑：
    1. 获取内容源定义并调用 `resolveSourceFeedUrl` 获得目标 URL。
    2. 若目标 URL 属于已配置的 RSSHub 域名且存在 AccessKey，请求头自动注入 `Authorization: Bearer <key>` 并添加参数 `?key=<key>`。
    3. 获取 RSS 2.0 / Atom XML 响应文本，解析提取所有条目。
    4. 归一化字段：`title`（标题字符串）、`link`（文章链接）、`pubDate`（ISO 8601 时间戳字符串）、`content`（描述或全文 HTML/文本）、`author`（作者字符串，可为空）。
  - 响应体：`{ ok: true, count: number, items: Array<NormalizedFeedItem> }`。
  - 异常处理：非 XML 内容返回 `E-FEED-PARSE-FAILED`（§8 E5）；目标 404 返回 `E-FEED-NOT-FOUND`。

验收标准：
1. **标准 RSS 2.0 XML 解析（锚点 §6.3 稳定块 3）**：解析含 `<item><title>Hello</title><link>https://a.b</link><pubDate>Mon, 24 Aug 2026 12:00:00 GMT</pubDate><description>World</description></item>` 的 XML 文本，输出包含 `{ title: "Hello", link: "https://a.b", pubDate: "2026-08-24T12:00:00.000Z", content: "World", author: "" }` 的数组（单元）。
2. **标准 Atom XML 解析（锚点 §6.3 稳定块 3）**：解析含 `<entry><title>Atom Title</title><link href="https://a.b/atom"/><updated>2026-08-24T12:00:00Z</updated><summary>Atom Content</summary><author><name>Alice</name></author></entry>` 的 XML 文本，归一化输出相同数据模型（单元）。
3. **AccessKey 自动注入请求头**：当抓取配置了 AccessKey 的 RSSHub 源时，发出的 HTTP 请求中带有 `Authorization: Bearer <key>`（集成：本地 Mock Server）。
4. **抓取端点接口调用（PRD §10.3 接口 4）**：调用 `POST /api/content-sources/<id>/fetch`，返回 200 且 `ok: true`, `count > 0`, `items` 为解析好的数组（集成）。
5. **畸变数据与解析错误容错（§8 E5）**：目标返回普通 HTML 或格式错误的文本时，返回 400 且错误码为 `E-FEED-PARSE-FAILED`（集成）。

---

## REQ-SRC-006 设置凭据与内容源前端交互

- 优先级 P0 / 必须 / intra-module / Settings.jsx + Sources.jsx / collection-pipeline / content-source / 组件 + E2E
- 交互契约：
  - Settings 页新增 `credentials` Tab：展示服务凭据卡片列表（含 RSSHub 卡片），支持输入 Base URL、AccessKey，提供「测试连接」按钮与「保存配置」按钮；测试中展示 loading，测试结果显示成功/失败状态文案。
  - Sources 页面：新增/编辑内容源支持选择 `X (Twitter)`、`微信公众号`、`Bilibili` 等社交媒体类型，根据所选类型动态切换配置项标签与 placeholder 提示；展示快捷抓取/连通测试操作。

验收标准：
1. **Settings 凭据面板存在与 Tab 切换**：设置页 Tab 栏包含「服务凭据」（`data-tab="credentials"`），点击后展示凭据管理面板（组件/E2E）。
2. **RSSHub 凭据输入与测试按钮交互**：在凭据面板中输入 Base URL 并点击测试连接，按钮呈现禁用/加载态，成功后展示绿色的连通成功提示（组件/E2E）。
3. **Sources 页面社交类型表单切换**：在内容源新建弹窗选择 `bilibili`，输入框提示变为 `UID` 且校验纯数字；选择 `x` 提示变为 `@username`（组件/E2E）。
