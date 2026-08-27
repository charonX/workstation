# RSSHub 集成与可扩展服务凭据管理

> 状态：探索期
> 故事 ID：`2026-08-26-rsshub-integration`
> 最后更新：2026-08-27

---

## 1. 问题陈述

用户希望在工作台中订阅并监控社交媒体（X/Twitter、微信公众号、B站等）与各类动态资讯，并将其接入自动化工作流供 AI 处理；但目前手动查找与拼装 RSSHub 复杂路由繁琐易错，且缺乏统一管理和安全存储外部第三方服务端点与访问密钥（如 RSSHub 实例 Base URL、AccessKey 以及未来其他服务凭据）的通用凭据模块，导致外部动态数据源难以安全、低门槛地接入系统。

## 2. 解决方案

1. **设置页新增可扩展的「服务凭据（Credentials）」管理面板**：
   - 建立通用的服务凭据数据契约与存储架构，支持多服务类型（Service Types）的凭据扩展（本期首发支持 RSSHub，底层数据模型与 UI 具备平滑接入后续新服务的扩展能力）。
   - 统一管理服务的连接地址（Base URL）及鉴权密钥（Token/Key），敏感密钥复用底层 `secretStore`（系统安全钥匙串）加密存储，提供服务专有的「测试连接」即时连通性检验。
2. **内容源（Sources）自动路由转换**：
   - 在内容源管理中添加 `x`（Twitter）、`wechat`（微信公众号）、`bilibili`（B站）等社交平台类型时，用户仅需输入账户或 ID（如 `@username`、公众号名或 UID），系统底层基于配置的 RSSHub 实例自动映射为对应标准路由并在请求时自动注入 AccessKey。
3. **标准化 Feed 数据抓取与解析**：
   - 后端实现标准的 RSS 2.0 / Atom 数据抓取与解析服务，输出结构化数据列表（`[{ title, link, pubDate, content, author }]`），可直接在内容源管理中预览，并在工作流（Flow）中被下游节点消费。

## 3. 用户故事

1. 作为用户，我想要在系统设置中有一个独立且可扩展的「服务凭据」面板，以便集中安全配置外部服务（首发支持 RSSHub，未来可扩展其他服务）的端点地址与 AccessKey，并能测试连接。
2. 作为用户，我想要在内容源中添加 Twitter、微信公众号或 B站时，只填写博主/账号 ID 即可自动生成订阅源，以便免除查阅和拼接 RSSHub 路由规则的麻烦。
3. 作为用户，我想要系统在请求自建受保护的 RSSHub 服务时自动附加 AccessKey，以便安全拉取私有化订阅内容。
4. 作为用户，我想要工作台能够自动抓取并解析 RSS/Atom 内容为结构化 JSON 列表，以便在工作流中方便地进行 AI 总结和飞书消息推送。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | **通用可扩展服务凭据管理（Extensible Credentials Settings）**：设置页新增独立的 `credentials` Tab；底层采用以 `serviceType` 为索引的可扩展结构（本期首发 `rsshub`，预留通用凭据扩展能力）；Key 经 `secretStore` 加密落盘（0o600 权限），前端永不返回明文 Key；提供连通性测试接口与 UI 状态反馈。 | 明确要求凭据模块必须具备多凭据扩展能力 |
| 2 | **社交账号到 RSSHub 路由自动映射**：内容源服务识别 `x`、`wechat`、`bilibili` 等社交类型，自动将用户输入的账号/ID 转换为标准的 RSSHub 路由路径（如 `/twitter/user/:id`、`/wechat/mp/msghistory/:id`、`/bilibili/user/video/:uid`）。 | 需求洞察已明确“只输入账号或 ID” |
| 3 | **带鉴权的 Feed 抓取与标准化解析**：实现统一的 Feed 获取与解析引擎，自动根据目标域名决定是否附加 `accessKey`（URL query 或 `Authorization` header），解析 RSS 2.0 / Atom XML 为统一规范的 JSON 条目列表。 | 为内容源管理与 Flow 消费提供单一契约支撑 |
| 4 | **内容源（Sources）交互与连通性验证**：在 Sources 列表与弹窗中适配社交媒体类型，录入时支持即时连通性检验；对未配置 RSSHub 实例时给出友好引导配置提示。 | 闭环用户从录入到生效的操作体验 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| 1 | 更多特定小众平台的路由生成规则扩展（如 Telegram 频道、即刻、小红书等） | 视后续社区需求在后续 story 增量扩展路由映射表 |
| 2 | RSSHub 路由元数据（Radar）在线自动探测 | 待后续评估是否集成 RSSHub Radar 规则库 |
| 3 | 自定义通用 Webhook / 第三方 API 凭据的自定义表单生成 | 凭据基础架构已就绪，自定义表单交互留在后续通用集成 story |

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

**流程 A：配置服务凭据（稳定块 1）**
| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 打开「设置」页面，点击「服务凭据」Tab | 展示服务凭据面板，呈现服务列表（当前展示 RSSHub 服务卡片） | Tab 选中，显示 RSSHub 的 Base URL 输入框与 AccessKey 输入框 |
| 2 | 输入 Base URL（如 `http://localhost:1200`）和 AccessKey，点击「测试连接」 | 发送请求到后端测试端点，向对应服务探测连通性 | 显示「连接成功」提示与实例响应延迟 |
| 3 | 点击「保存配置」 | 密文落盘保存，提示保存成功 | 页面保留 Base URL，Key 字段显示掩码占位 `••••••••`，`configured: true` |

**流程 B：添加社交媒体内容源（稳定块 2/4）**
| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 进入「内容源」页面，点击「新建内容源」 | 弹出新建弹窗，类型下拉列表包含 Web、RSS、X/Twitter、微信公众号、Bilibili | 弹窗展示对应表单 |
| 2 | 选择类型为 `X (Twitter)`，输入名称 `Elon Musk`，配置输入 `@elonmusk`，添加标签 `tech` | 输入框 placeholder 提示 `@username` | 字段校验通过 |
| 3 | 点击保存 | 系统自动基于 RSSHub Base URL 组装路由 `/twitter/user/elonmusk` 并创建记录 | 列表新增一条 X 类型源，URL 指向解析后的路由 |

**流程 C：抓取并解析 Feed 数据（稳定块 3）**
| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 调用内容源拉取接口或在 Flow 中触发抓取 | 系统拉取 XML，带上 AccessKey，解析为 JSON | 返回标准化条目列表 `[{ title, link, pubDate, content, author }]` |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 用户填写的 RSSHub Base URL 格式不合法（非 http/https 协议） | 前端即时拦截并标红提示，阻止提交 | §8-E1 |
| 测试连接时目标服务拒绝连接或超时 | 弹出明确错误提示（如 `无法连接到服务服务端点：ECONNREFUSED`） | §8-E2 |
| 测试连接时 AccessKey 错误（HTTP 401/403） | 提示「认证失败：AccessKey 无效」 | §8-E3 |
| 用户未配置 RSSHub 即尝试创建 X/WeChat 内容源并测试连通 | 提示「请先在设置中配置 RSSHub 服务地址」并提供跳转入口 | §8-E4 |
| 订阅源返回的内容非合法 XML/RSS 格式 | 抓取服务返回解析错误，并记录原始响应摘要 | §8-E5 |

### 6.3 预期值锚点（Expected-Value Anchors）

| 稳定块 | 输入 | 预期输出/结果 | 依据 |
|---|---|---|---|
| 1 | 保存凭据 `PUT /api/settings/credentials/rsshub` 内容 `{ baseUrl: "http://localhost:1200/", accessKey: "my-secret-key" }` | `settings.json` 中保存 `credentials.rsshub = { baseUrl: "http://localhost:1200", accessKeyEncrypted: "..." }` | 规范化与加密标准 |
| 1 | GET `/api/settings/credentials` | 返回 `{ credentials: { rsshub: { baseUrl: "http://localhost:1200", configured: true } } }`（无明文 Key，无密文 Key） | 安全只读契约 |
| 2 | 类型 `x`，输入 `@jack`，Base URL `http://localhost:1200` | 生成 RSSHub 路由路径 `/twitter/user/jack`，完整 URL `http://localhost:1200/twitter/user/jack` | 路由转换规范 |
| 2 | 类型 `bilibili`，输入 `2267573`，Base URL `http://localhost:1200` | 生成 RSSHub 路由路径 `/bilibili/user/video/2267573` | 路由转换规范 |
| 3 | 请求配置了 `accessKey: "k123"` 的 RSSHub 路由 | 请求自动附带 Header `Authorization: Bearer k123` 或 URL 参数 `?key=k123` | RSSHub 鉴权协议 |
| 3 | 标准 RSS 2.0 XML 条目 `<item><title>Hello</title><link>https://a.b</link><pubDate>Mon, 24 Aug 2026 12:00:00 GMT</pubDate><description>World</description></item>` | 解析出 `{ title: "Hello", link: "https://a.b", pubDate: "2026-08-24T12:00:00.000Z", content: "World", author: "" }` | 归一化数据模型 |

## 7. 表单与输入验证（Form / Input Validation）

| 输入字段 | 规则 | 有效例子 | 无效例子（→错误提示） | 错误状态 |
|---|---|---|---|---|
| RSSHub Base URL | 必填（若配置时），合法 http/https URL，自动去除末尾 `/` | `http://localhost:1200`、`https://rsshub.app` | `ftp://127.0.0.1`（协议不支持）、`localhost:1200`（缺少协议） | §8-E1 |
| RSSHub AccessKey | 可选，若填则去前后空白后不超过 256 字符 | `secret-token-123`、``（空为不设） | 超过 256 字符（过长） | §8-E1 |
| X (Twitter) 账号 | 去空白后必须符合用户名格式（字母数字下划线，前缀 `@` 可选），1-32 字符 | `elonmusk`、`@OpenAI` | `@`（无有效用户名）、`user name`（含空格） | §8-E1 |
| Bilibili UID | 纯数字，长度 1-20 位 | `2267573`、`946974` | `UID_123`（含非数字） | §8-E1 |
| 微信公众号 | 非空字符串，1-64 字符 | `机器之心`、`gh_123456` | ``（空） | §8-E1 |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 例子（触发 → 期望结果） | 错误状态 |
|---|---|---|---|
| 保存社交账号内容源时若未配置全局 RSSHub Base URL | 创建/保存社交类型内容源时 | 允许保存记录但标记状态提示「未配置 RSSHub 服务，暂不可抓取」 | 友好提示 |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| E1 输入格式错误 | URL 非法、账号标识不合法 | E-CONFIG-INVALID / E-SRC-CONFIG | 表单字段下方标红提示具体错误 | 阻止保存提交 |
| E2 网络连接失败 | DNS 无法解析、连接被拒绝或超时 | E-CRED-CONN-FAILED | 弹出 Alert 或 Toast：「无法连接到服务端点」 | 无 |
| E3 认证鉴权失败 | 目标服务返回 401 Unauthorized 或 403 Forbidden | E-CRED-AUTH-FAILED | 提示「鉴权失败，请检查密钥/AccessKey 是否正确」 | 无 |
| E4 未配置服务 | 尝试抓取但未配置 Base URL | E-RSSHUB-NOT-CONFIGURED | 提示「请先在设置中配置 RSSHub 服务地址」 | 终止抓取 |
| E5 XML 解析失败 | 目标返回 200 但内容为 HTML 或畸变 XML | E-FEED-PARSE-FAILED | 提示「订阅源返回格式无效，无法解析为 RSS」 | 返回空列表或记录错误 |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **simple**（直接结晶） |
| 判断理由 | 涉及模块边界清晰：凭据管理服务抽象（按 serviceType 读写/测试/脱敏）、内容源服务（路由生成器）、独立的 Feed 抓取与解析器，不触及多进程跨端生命周期同步。可直接由自动链结晶并进入实现。 |

结晶路径：`PRD → CRYSTALLIZE`。

## 10. 技术方案（Implementation Decisions）

### 10.1 设计目标
- **凭据模型通用扩展性**：凭据存储以 `credentials: { [serviceType: string]: ServiceCredential }` 组织，每种凭据包含公共配置（如 `baseUrl`、`enabled`）与加密密钥（`secretEncrypted` / `accessKeyEncrypted`），新增服务只需注册新的 `serviceType` 处理适配器。
- **安全性**：外部凭据敏感信息统一使用系统安全区（Keychain / safeStorage）密文加密落盘，不泄露到 GET 响应中，文件权限保持 `0o600`。
- **模块正交性**：Feed 抓取与解析器作为独立的通用工具库，内容源服务与 Flow 执行器均可无缝调用。
- **用户无感**：社交媒体只输入纯 ID，路由自动映射。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| `credentialsService` / `settingsService` | 通用管理各类型服务凭据（读、写、测试连接、脱敏），首发支持 `rsshub` | 扩展现有 |
| `feedFetcherService` | 负责通用 HTTP 请求（自动注入 AccessKey）、RSS/Atom XML 解析与归一化 | 是 |
| `contentSourceService` | 路由映射器（根据平台类型及账号转换目标 URL）、内容源增删改查与测试连通 | 扩展现有 |
| `Settings.jsx`（Credentials Tab） | 凭据管理前端面板，采用服务卡片列表架构，支持多服务凭据展示与测试 | 扩展现有 |
| `Sources.jsx` | 内容源管理前端，增强社交媒体平台的快捷录入与连通测试 | 扩展现有 |

### 10.3 接口契约

#### 接口 1：`GET /api/settings/credentials`
- **说明**：获取所有已配置的外部服务凭据（脱敏视图）。
- **输出**：`{ credentials: { rsshub?: { baseUrl: string, configured: boolean }, [key: string]: any } }`

#### 接口 2：`PUT /api/settings/credentials/:service`
- **说明**：保存指定服务的凭据配置。
- **输入**：例如 `:service = rsshub` 时输入 `{ baseUrl: string, accessKey?: string }`
- **输出**：`{ service: string, baseUrl: string, configured: boolean }`

#### 接口 3：`POST /api/settings/credentials/:service/test`
- **说明**：测试指定服务的连通性与密钥有效性。
- **输入**：`{ baseUrl: string, accessKey?: string }`
- **输出**：`{ ok: boolean, latencyMs: number, error?: string }`

#### 接口 4：`POST /api/content-sources/:id/fetch`
- **说明**：抓取并解析指定内容源的最新条目。
- **输出**：`{ ok: boolean, items: [{ title, link, pubDate, content, author }], count: number }`

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（Coverage Seams）

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 1 可扩展服务凭据管理 | HTTP API `/api/settings/credentials`（GET / PUT / test）+ 单元测试（多 serviceType 增改查、密文存储与脱敏） | 单元 + 集成测试 | 使用 fakeSecretBackend 注入 |
| 2 路由自动映射 | `contentSourceService` 单元测试（X/WeChat/Bilibili 账号转路由） | 单元测试 | 纯逻辑 |
| 3 Feed 抓取与解析 | `feedFetcherService` 单元测试（RSS 2.0 / Atom XML 解析、AccessKey 注入） | 单元 + 集成测试 | 本地 Mock HTTP Server |
| 4 Sources 页面与连通验证 | Playwright E2E 或 UI 组件测试 | 集成/E2E | Mock API |

测试目录按 `tests/capabilities/rsshub-integration/` 组织。

## 12. 范围外

- 在应用内自动安装或拉起本地 Docker RSSHub 实例；
- 需扫码登录的强反爬社交平台的登录态注入（由用户在自己的 RSSHub 实例中配置）；
- 跨设备云端同步密钥凭据。

## 13. 补充说明

- 需求访谈记录见 `interview-notes.md`。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | §6.1 三条流程覆盖全部 4 个稳定块；§6.2 分支异常完整 |
| 输入验证 | PASS | §7 各字段验证规则与正反样例完整 |
| 错误状态 | PASS | §8 E1-E5 五类错误模式定义明确 |
| 预期值锚点 | PASS | §6.3 提供了明确的预期值字面锚点 |
| 复杂度分级 | simple | 模块边界独立清晰，直接结晶 |
| 技术方案（§10） | PASS | 包含可扩展凭据架构、模块边界、接口契约与数据契约 |
| 覆盖接缝 | PASS | §11.1 覆盖 4 个稳定块的测试 seams |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-27 | 初稿生成 | AI + 人 |
| v0.2 | 2026-08-27 | 强化服务凭据模块的通用扩展性（支持以 serviceType 为索引的多服务凭据架构） | AI + 人 |
