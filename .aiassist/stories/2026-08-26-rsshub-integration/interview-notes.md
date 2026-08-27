# 访谈笔记 — 2026-08-26-rsshub-integration

## 核心问题
用户希望在工作台中便捷接入各类社交媒体与资讯动态（如 X/Twitter、微信公众号、B站、GitHub 等），并能将其作为内容源或在工作流中被 AI 节点消费；但目前手动寻找和拼接 RSSHub 路由极其繁琐，且缺乏统一配置和安全存储 RSSHub 实例端点及 AccessKey 访问凭据的入口。

## 用户画像
需要自动化监控社交动态、行业资讯、KOL 言论或开源情报，并通过 AI 进行提炼、翻译并推送到飞书/本地的工作台用户。

## 关键边界
1. **凭据安全**：RSSHub AccessKey 与实例配置必须复用系统底层 `secretStore`（Keychain / safeStorage）加密存储，不输出明文。
2. **零门槛录入**：在内容源（Sources）中添加社交媒体类型（X、WeChat 等）时，用户只需输入账号/ID，系统底层自动通过配置的 RSSHub 实例生成对应路由，不需要用户手动拼装 URL。
3. **工作流消费契约**：抓取到的 RSS 数据必须归一化为标准的 JSON 数组格式（`[{ title, link, pubDate, content, author }]`），方便 Flow 中下游 `forEach` / `agent` / `feishuSend` 节点消费。
4. **Out of scope**：Workstation 不在本地打包或自动编译完整的 RSSHub 源码/Docker 镜像，而是提供连接外部/本地已有 RSSHub 实例的客户端能力与鉴权集成。

## 隐含假设
1. 用户拥有或可以连接到一个 RSSHub 实例（例如自建的 `http://localhost:1200`，或公共实例/第三方实例）。
2. 部分需要特定鉴权（如 X/Twitter、Telegram）的第三方平台 Cookie/Token，主要由用户在 RSSHub 服务端配置，Workstation 负责向 RSSHub 传递实例级 `AccessKey`。

## 候选方向

### 方向 A：轻量配置 + 自动路由映射 + 流水线直通（推荐）
- **一句话概括**：在设置页新增「服务凭据（Credentials）」Tab 统一管理 RSSHub 等外部服务地址与 Key；Sources 页面输入账号即自动映射路由；提供统一的 Feed 解析能力供 Sources 与 Flow 消费。
- **适用场景**：既要保持配置集中清晰（满足凭据独立管理诉求），又能让 Sources 和 Flow 快速顺畅使用。
- **主要取舍**：开发成本适中，架构清晰，扩展性好。
- **推荐度**：首选（★★★★★）

### 方向 B：仅在 Sources 页面内嵌入局部凭据
- **一句话概括**：不新增设置 Tab，在 Sources 页面弹窗或顶部配置 RSSHub 地址和 Key。
- **适用场景**：极简方案。
- **主要取舍**：凭据分散，不符合用户关于“在设置里专门做密钥配置模块”的明确预期。
- **推荐度**：不推荐

---

## 确认方向

最终确认的方向：**方向 A（轻量配置 + 自动路由映射 + 流水线直通）**

确认意图：
- **Outcome**：设置页提供独立的「服务凭据」管理（支持 RSSHub 实例地址与 AccessKey 加密存储与连通性测试）；内容源管理支持输入账号/ID 自动转换为 RSSHub 路由；工作流与内容源具备标准化 Feed 解析拉取能力。
- **User**：需要订阅和自动化处理多源社交与资讯动态的工作台用户。
- **Why now**：当前虽然有 RSS 类型，但社交媒体（X/微信等）无法自动抓取，且自建 RSSHub 的鉴权与路由门槛阻碍了自动化数据流闭环。
- **Success**：
  1. 设置页有独立「服务凭据」面板，可保存 RSSHub BaseURL 和 AccessKey，支持「测试连接」；
  2. Sources 页面添加 X / WeChat / Bilibili 等时，仅需填写账号标识即可测试连通并保存；
  3. 后端提供标准 RSS/Atom 抓取与解析器，Flow 和服务层可直接获取结构化数据。
- **Constraint**：必须遵循项目安全规范，AccessKey 加密存储，权限 `0o600`，前端不回显明文 Key。
- **Out of scope**：不内置安装/拉起 Docker RSSHub 服务；不处理特定平台需要扫码登录的复杂反爬配置（由 RSSHub 自身配置承担）。
