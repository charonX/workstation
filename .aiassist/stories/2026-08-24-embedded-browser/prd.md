# 内置浏览器面板与 agent 受控浏览器

> 状态：BUILD 完成 / QA（review 修复中）
> 故事 ID：`2026-08-24-embedded-browser`
> 最后更新：2026-08-30

---

## 1. 问题陈述

agent 在 workstation 里起了 web 服务或产出页面后，用户要切到外部浏览器、手动找端口输地址才能验证效果，「对话 → 看结果」的闭环被打断；agent 访问网页只有无头抓取——用户看不到它在看什么，agent 自己也没有可视化浏览器可用（无法操作需要渲染/交互的页面）。此外，本地数据采集与后台 Agent 需要复用目标站点（B站、X、知乎等）的登录态，手工抓包维护 Cookie 繁琐且有泄露风险——浏览器登录态与工作台采集能力之间缺一座受控的桥（2026-08-28 人裁决增补初衷，见 §13）。

## 2. 解决方案

在会话区右侧内置一个可收起的浏览器面板（`WebContentsView` 主进程托管）：用户可手动输 URL 交互浏览；同一浏览器实例作为 agent 的读取工具面——agent 通过 query 级 CLI 工具导航/读取/滚动/截图，用户实时看到 agent 在看什么。`persist:browser` 分区的登录态同时作为工作台统一身份池，经受控 Cookie 导出接口供本地采集引擎与 Agent 复用（人机协同登录引导见流程 D）。浏览器既是人的预览窗口，也是 agent 的眼睛。

## 3. 用户故事

1. 作为用户，我想要在 app 内直接打开 agent 产出的 web 页面并交互操作，以便不打断对话就能验证效果。
2. 作为用户，我想要手动输入任意 URL 在面板内浏览（含外网），以便查资料不离开 workstation。
3. 作为用户，我想要看到 agent 正在浏览的页面画面，以便监督它在看什么。
4. 作为用户，我想要随时接管面板（我的操作永远生效）并能一键停止 agent 控制，以便 agent 乱导航时立刻夺回浏览器。
5. 作为 agent，我想要一组浏览器读取工具（导航/读取/滚动/截图），以便完成需要真实渲染的网页查看任务。
6. 作为用户与 Agent，我想要在内置浏览器中手动扫码/登录目标站点（如 B站、X/Twitter、知乎、GitHub），系统自动持久化 Cookie 并允许本地数据采集与后台 Agent 跨模块安全复用该登录态，以便在不手动抓包、不泄露明文密码的情况下完成带鉴权的数据分析与内容采集。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| 1 | 浏览器面板骨架与手动浏览：会话区右侧内嵌、可收起/展开、地址栏导航（协议自动补全）、页面可交互、外链/弹窗拦截（target=_blank 转面板内导航，绝不劫持主窗口） | 访谈三轮确认；方向 B（WebContentsView 主进程托管）已拍板 |
| 2 | agent 浏览器读取工具集：navigate/read/scroll/screenshot + 面板展开/收起控制，经 toolAdapter 声明 riskLevel=query 接入现有工具面；**无写入动作**（click/type 本期砍，见 §12） | 访谈 Q3 确认「工具由 agent 自主调用、自主决定是否展开面板」；TECH-DESIGN 裁决本期只做预览/读取 |
| 3 | 人机共驾与可见性规则：人操作永远优先（不加锁）；「agent 控制中」指示 + 一键停止控制（断控制后 agent 工具返回 E-BROWSER-DENIED，页面保持当前状态）；收起面板浏览器不断连 | 访谈 Q2/Q3（第三轮）显式确认 |
| 4 | 聊天链接集成：会话消息中 http(s) 链接默认在面板打开，提供「在系统浏览器打开」入口 | 访谈 Q5（第三轮）确认 |
| 5 | 登录态持久化、Cookie 导出与身份桥接：`persist:browser` 隔离持久存储；`GET/DELETE /api/browser/cookies` 受控导出与清理；`browser auth-check` 供 Agent 检测登录态并在需要时展开面板引导用户手动登录（Human-in-the-Loop Auth） | 2026-08-28 用户增补；ADR-039 决策 7/8 确立 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| 1 | read 快照的格式细节与截断策略（元素清单字段、体积上限） | **已稳定于 §10.4 接口 2**（golden 形态 + 4000 字符/50 元素阈值锚定，2026-08-28 结晶消费）；此行保留作历史记录，不再移动 |

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

**流程 A：手动浏览（稳定块 1）**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 点击会话区「浏览器」按钮 | 面板展开，地址栏聚焦 | 面板可见，初始为空白页 + 地址栏 |
| 2 | 地址栏输入 `example.com` 回车 | 自动补协议并加载 | 实际加载 URL = `https://example.com/` |
| 3 | 在页面上点击、滚动、填表 | 页面正常交互 | 交互未被拦截 |
| 4 | 点击页面上 target=_blank 链接 | 面板内导航到目标 URL | 无新窗口、主窗口不跳转 |
| 5 | 点击收起 | 面板隐藏，浏览器实例保留 | 重新展开仍为原页面 |

**流程 B：agent 驱动浏览（稳定块 2/3）**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 对话中要求 agent「看一下 http://localhost:3000 的效果」 | agent 调用 `browser navigate` | 工具返回 `{ok:true, url, title}` |
| 2 | （agent 决定展开面板） | 面板自动展开并加载该 URL | 面板可见且地址栏显示最终 URL |
| 3 | 无 | 面板顶部显示「agent 控制中」指示 | 指示可见，含「停止控制」按钮 |
| 4 | agent 调用 `browser read` | 返回当前页结构化快照 | 返回含 title/url/可交互元素列表 |
| 5 | 用户在面板里点击别处 | 用户操作生效，agent 下次操作前重读快照适应 | 用户点击不被拒绝 |

**流程 C：停止控制（稳定块 3）**

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 点击「停止控制」 | 控制指示消失，页面保持当前状态 | 页面 URL 不变，指示条消失 |
| 2 | agent 再调用任何 browser 工具 | 返回拒绝错误 | 错误码 E-BROWSER-DENIED |
| 3 | 用户手动在面板导航一次 | 控制状态解除，agent 工具恢复可用 | 后续 `browser read` 返回 ok:true |

**流程 D：人机协同登录与 Cookie 导出（稳定块 5）**

| 步骤 | 参与方 | 动作与响应 | 验收锚点 |
|---|---|---|---|
| 1 | Agent / 采集服务 | 调用 `browser auth-check --domain .bilibili.com` | 返回 `{authenticated: false}` |
| 2 | Agent | 调 `browser navigate --url "https://passport.bilibili.com/login" --expand` 并发送引导卡片 | 面板自动展开，加载登录页 |
| 3 | 用户 | 在内置浏览器中手动扫码/登录成功 | Chromium 原生持久化 Cookie 至 `persist:browser` |
| 4 | 后台数据采集服务 | 调用 `GET /api/browser/cookies?domain=.bilibili.com` | 返回包含 `SESSDATA` 等完整 Cookie 字符串，直接发起本地 API 抓取 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 地址栏输入非 http(s) 协议（如 `javascript:...`） | 拒绝导航，地址栏提示 | §8-E1 |
| 导航失败（DNS/连接拒绝/超时） | 面板内错误页，显示失败原因，可重试 | §8-E2 |
| agent 工具调用时浏览器实例未就绪 | 工具返回错误，agent 收到可读消息 | §8-E3 |
| WebContents 崩溃（render process gone） | 面板显示崩溃态 + 重载按钮；agent 工具返回崩溃错误 | §8-E4 |
| 面板收起时 agent 继续调用工具 | 正常执行（不断连），仅画面不可见 | 正常路径，非错误 |
| 用户点击「停止控制」 | agent 后续工具调用直接失败（E-BROWSER-DENIED），页面保持当前状态；用户手动导航一次后解除 | §8-E5 |

### 6.3 预期值锚点（Expected-Value Anchors）

| 稳定块 | 输入 | 预期输出/结果 | 依据 |
|---|---|---|---|
|---|---|---|---|
| 1 | 地址栏输入 `example.com` | 加载 URL `https://example.com/`（补 https） | 访谈确认 + 浏览器惯例 |
| 1 | 地址栏输入 `localhost:3000` | 加载 URL `http://localhost:3000/`（localhost 补 http） | 本地 dev server 主场景 |
| 1 | 应用启动后面板初始状态 | 收起（不展示） | 面板按需出现，不抢主界面 |
| 1 | 页面内 target=_blank 链接点击 | 面板内导航至目标 URL；`window.open`/新窗口事件被拦截 | 访谈 Q5：绝不劫持主窗口 |
| 2 | `browser navigate --url http://localhost:3000` | 返回 JSON 含 `"ok":true`、`"url":"http://localhost:3000/"`、`"title":<页面标题>` | 工具面现有 JSON 回执先例（toolAdapter） |
| 2 | toolAdapter 声明 | `browser navigate`/`browser read`/`browser scroll`/`browser screenshot`/`browser auth-check` riskLevel 均=`query`（本期无 confirm 级工具） | §7.2 风险映射先例 + TECH-DESIGN 裁决（砍 click/type） |
| 3 | 面板收起状态下 `browser read` | 返回 `ok:true`（浏览器不断连） | 访谈 Q3：可见性解耦 |
| 3 | agent 工具驱动中面板指示 | 可见「agent 控制中」+「停止控制」按钮 | 访谈 Q2（第三轮） |
| 3 | 停止控制后 agent 调 `browser read` | 返回 `{"ok":false,"error":{"code":"E-BROWSER-DENIED"}}`；用户在面板手动导航一次后恢复 ok:true | 流程 C（用户手动导航解除 = 显式收回又归还控制） |
| 4 | MarkdownRenderer 渲染 `[x](https://a.b/c)` 点击 | 面板打开并加载 `https://a.b/c`（非系统浏览器） | 访谈 Q5 |
| 4 | 链接「在系统浏览器打开」入口（右键菜单/外链按钮） | 调用 `shell.openExternal(<url>)` 在系统浏览器打开；面板状态不变 | 访谈 Q5 |
| 4 | 非 http(s) 协议链接（`mailto:a@b.c`）点击 | 不触发面板导航、不拦截，保持系统默认处理 | 访谈 Q5 边界 |
| 5 | `GET /api/browser/cookies?domain=.bilibili.com` | 返回 `{ok:true, cookieString:"SESSDATA=...; bili_jct=...", cookies:[...]}` | ADR-039 决策 7 |
| 5 | `GET /api/browser/cookies?domain=.bilibili.com&name=SESSDATA` | 单名过滤：cookies 仅含 SESSDATA 一条，cookieString=`SESSDATA=...` | 接口 4 golden |
| 5 | `browser auth-check --domain .bilibili.com --required-cookies SESSDATA` | 存在对应有效 Cookie 返回 `{authenticated:true}`，不存在返回 `{authenticated:false}` | ADR-039 决策 8 |
| 5 | `GET /api/browser/cookies?domain=.bilibili.com`（实例从未导航过该域） | `{ok:true, domain:".bilibili.com", cookieString:"", cookies:[]}`（空态合法，不报错） | 接口 4 空态 |
| 5 | `DELETE /api/browser/cookies?domain=.bilibili.com`（该域有 12 条 Cookie） | `{ok:true, deletedCount:12}`；再次 GET 同域返回空态 | 接口 4 清理幂等 |
| 5 | Cookie 导出值脱敏底线 | 回执中 `value` 字段为**完整明文**（采集引擎直用）；JSON 日志行/工具折叠块展示时 cookieString 一律脱敏为 `SESSDATA=<redacted>`（禁止全值入日志） | ADR-039 决策 7 安全边界 |

## 7. 表单与输入验证（Form / Input Validation）

| 输入字段 | 规则 | 有效例子 | 无效例子（→错误提示） | 错误状态 |
|---|---|---|---|---|
| 地址栏 URL | 仅允许 http/https 协议（缺省自动补全：localhost/127.0.0.1 补 http，其余补 https）；去空白后非空 | `example.com` → `https://example.com/`；`localhost:3000` → `http://localhost:3000/`；`https://a.b/c?d=e` 原样 | `javascript:alert(1)` → 拒绝，提示「仅支持 http/https 地址」；``（空）→ 不导航；`http://`（无主机）→ 提示「地址不完整」 | §8-E1 |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 例子（触发 → 期望结果） | 错误状态 |
|---|---|---|---|
| agent 工具 url 参数同样过协议白名单 | 每次 navigate | `browser navigate --url "file:///etc/passwd"` → 拒绝，E-BROWSER-BAD-URL | §8-E1 |
| cookies 接口 domain 参数必填且以 `.` 开头（域后缀语义） | GET/DELETE cookies | `?domain=.bilibili.com` → 有效；`?domain=`（空）/`?domain=bilibili.com`（无前导点）→ E-BROWSER-BAD-DOMAIN | §8-E7 |
| auth-check required-cookies 逗号分隔名单可为空 | auth-check | 空 = 仅检查该域下是否存在任意 Cookie；非空 = 名单内全部存在才算 authenticated | §8-E8 |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| E1 非法 URL | 协议不在白名单/无主机/空 | E-BROWSER-BAD-URL | 地址栏内联提示（手动）；agent 收到错误回执（工具） | 无导航，当前页不变 |
| E2 导航失败 | DNS 失败/连接拒绝/超时 | E-BROWSER-NAV-FAILED（reason 透传 Chromium 错误码，如 ERR_CONNECTION_REFUSED） | 面板内错误页 + 重试按钮 | 无 |
| E3 浏览器未就绪 | 工具调用时实例未创建/已销毁 | E-BROWSER-NOT-READY | agent 收到错误回执 | 无 |
| E4 WebContents 崩溃 | render-process-gone | E-BROWSER-CRASHED | 面板崩溃态 + 「重新加载」按钮 | 浏览器实例可重建，登录态依 partition 策略 |
| E5 停止控制后工具调用 | 用户已点「停止控制」，agent 再调任何 browser 工具 | E-BROWSER-DENIED | agent 收到拒绝回执并自然语言告知用户 | 动作不执行，浏览器状态不变；用户手动导航一次后解除 |
| E6 主/渲染进程 bounds 同步异常 | resize/收起时视图定位失败 | 日志记录 | 面板内容暂时隐藏而非错位遮挡 | 下帧重算恢复 |
| E7 cookies 接口 domain 参数非法 | 缺失/空/无前导点 | E-BROWSER-BAD-DOMAIN | agent 收到错误回执 | 无 |
| E8 auth-check 判定失败 | required-cookies 名单内任一 Cookie 不存在 | 非错误：`{authenticated:false, missing:["SESSDATA"]}` | agent 据此决定引导登录 | 无 |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 触及 6 个模块（主进程视图管理、HTTP 路由、worker 工具面、渲染面板、Markdown 渲染、Cookie/身份桥接），跨三进程（main/renderer/worker）；分支多（崩溃/未就绪/停止控制/共驾/登录引导）；有安全信任边界（agent 驱动用户可见浏览器、协议白名单、**登录凭据导出**）。（2026-08-26 范围收敛：砍 click/type 后确认队列不涉及；2026-08-28 增补稳定块 5 登录态身份桥接，模块数回升为 6，仍 complex） |

结晶路径：`PRD → DESIGN → DOMAIN-MODEL → TECH-DESIGN（必走）→ CRYSTALLIZE`。

## 10. 技术方案（Implementation Decisions）

> complex story：本节由 `/tech-design` 深潜完整填充（2026-08-26，四问四答 + 范围收敛）。

### 10.1 设计目标

- 单一浏览器实例同时服务「人的预览/浏览」与「agent 的读取工具面」：主进程直持 WebContents 保控制保真，可见性与实例生命周期解耦（收起不断连），布局真相归渲染进程。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| browserViewManager（main） | WebContentsView 生命周期（懒创建/崩溃重建）、bounds 哑执行（渲染进程推送）、导航执行 + 协议白名单（will-navigate/setWindowOpenHandler 双闸）、弹窗拦截、agentControlRevoked 状态与导航来源标记、`persist:browser` 分区持有与 Cookie 读写 | 是 |
| browser 路由（http） | `/api/browser/*` REST（含 `/api/browser/cookies` GET/DELETE）：worker 工具面与渲染进程共用（ADR-001 先例）；日志脱敏收口 | 是 |
| toolAdapter browser 命令（agent worker） | `browser navigate/read/scroll/screenshot/auth-check` 声明，riskLevel 均=query | 是 |
| BrowserPanel（renderer） | 面板 UI：地址栏（协议白名单前置校验）、控制中指示、收起/展开、崩溃/错误页、登录引导提示；布局真相持有（ResizeObserver → 节流 IPC 推 bounds） | 是 |
| MarkdownRenderer（renderer） | http(s) 链接点击 → `openBrowserPanelWithUrl`（renderer store）→ preload navigate IPC（source=user）默认面板打开；「在系统浏览器打开」入口登记 `shell.openExternal` 副作用（面板状态不变）；非 http(s)（mailto: 等）不拦截、走系统默认（改） | 否 |
| Cookie/身份桥接（宿主：browserViewManager + browser 路由，非独立文件） | `persist:browser` 分区 Cookie 读取/单名过滤/删除、auth-check 登录探测、凭据日志脱敏收口 | 是（寄生既有新模块） |

> **稳定块 4 契约补全（2026-08-30 review 增补）**：聊天链接点击属**用户手势**——经 preload navigate IPC 以 source=user 进入 navigate 状态机，对 agentControlRevoked 的清除是**有意语义**（用户点链接 = 显式接管，与地址栏导航同级）。
>
> **路由工程约束**：`/api/browser/*` 路由遵循 ADR-035（ServiceContainer DI、server.js 瘦身为纯传输层）与 ADR-036（统一从 `responders.js` 导入响应助手，禁止路由内联 ok/notFound）。

#### 模块关系图

```
[agent worker: toolAdapter "browser navigate"]          [用户: BrowserPanel 地址栏]
        │ HTTP /api/browser/navigate                            │ HTTP /api/browser/navigate
        ▼                                                       ▼
[main: browser 路由] ──────────────► [main: browserViewManager ─ WebContentsView]
        │                                   │  ▲ setBounds（哑执行）
        │ 事件转发                            │  │ opc-browser-bounds（节流 IPC）
        ▼                                   ▼  │
[mainWindow.webContents.send "opc-browser-event"] ◄── [renderer: BrowserPanel（布局真相）]
        │
        ▼
[worker 工具 JSON 回执]（经 CLI HTTP 客户端，OPC_AGENT_SERVER_BASE_URL 直连，BUG-007 先例）
```

### 10.3 数据流

**agent 驱动浏览（流程 B）**：
1. **触发**：agent 调 `browser navigate --url <u>`（toolAdapter → CLI HTTP 客户端）。
2. **输入校验**：路由层过协议白名单（http/https only），非法 → E-BROWSER-BAD-URL。
3. **核心处理**：browserViewManager 检查 agentControlRevoked（true → E-BROWSER-DENIED）→ 懒创建 WebContentsView（partition `persist:browser`，无 preload，nodeIntegration 关）→ 标记本次导航来源=agent → loadURL → 等 did-finish-load / did-fail-load。
4. **副作用**：若面板当前收起且工具带 expand 意图 → `mainWindow.webContents.send("opc-browser-event", {type:"panel-request-open"})`，渲染进程展开面板并开始推 bounds；导航完成 → send `{type:"navigated", url, title, source:"agent"}`（渲染进程显示控制指示）。
5. **输出**：工具回执 `{ok:true, url, title}`；导航失败 → `{ok:false, error:{code:"E-BROWSER-NAV-FAILED", reason:"ERR_*"}}`。

**手动浏览（流程 A）**：渲染进程地址栏前置校验（同白名单，共享 normalize 逻辑）→ preload navigate IPC（source=user）→ 主进程 navigate 状态机 → 导航来源=user → 若 agentControlRevoked 为 true 则清除（停止控制解除契约——仅地址栏/面板 chrome 级手势；页内链接点击经 will-navigate 的导航不清除）。

**read/scroll/screenshot**：read → executeJavaScript 注入自包含序列化器 → 裁剪 JSON；scroll → executeJavaScript scrollBy；screenshot → `webContents.capturePage` → PNG 落**应用配置目录** `<configDir>/browser-shots/browser-<n>.png`（n 跨会话全局递增——浏览器为跨会话单例，截图不归 agent 会话目录；2026-08-29 人裁决修订）→ 回执含文件路径（agent 按路径读图）。

**登录引导与 Cookie 桥接（流程 D）**：
1. **探测**：agent 调 `browser auth-check --domain <d> [--required-cookies <c1,c2>]` → 主进程从 `persist:browser` session 读该域 Cookie → `{authenticated, missing[]}`（非错误语义，E8）。
2. **引导**：未登录 → agent 自主决定 `browser navigate --url <登录页> --expand`（面板展开）+ 对话内发引导文案；用户在面板内手动扫码/登录（人操作优先契约不变）。
3. **持久化**：登录成功 → Chromium 原生写入 `persist:browser`（零自研持久层）；分区 `cookies` changed 监听发射 `opc-browser-event {type:"cookie-updated"}`（域级无值负载）通知渲染进程刷新状态——事件与「登录成功」无因果绑定，任何分区 Cookie 变更均发射。
4. **导出**：采集引擎/Agent 调 `GET /api/browser/cookies?domain=.bilibili.com[&name=SESSDATA]` → 回执含完整明文 cookieString；日志与工具折叠块展示一律脱敏。`DELETE` 清理指定域会话。

### 10.4 接口契约

#### 接口 1：HTTP `POST /api/browser/navigate`

| 项目 | 说明 |
|---|---|
| 调用方 | worker CLI 工具（HTTP，source 恒=agent）/ 渲染进程地址栏与面板 chrome（preload navigate IPC，source=user） |
| 被调用方 | browserViewManager |
| 输入 | `{url: string, expand?: boolean}`——**source 由调用通道决定，不由请求体声明**：HTTP 面一律记为 agent（请求体 source 字段无效，防本机进程伪造 user 解除停止控制，2026-08-30 review 安全决策）；source=user 仅来自渲染进程 IPC 导航 |
| 输出 | `{ok:true, url, title}` / `{ok:false, error:{code, reason}}` |
| 业务错误 | E-BROWSER-BAD-URL（协议白名单外/无主机）；E-BROWSER-DENIED（agentControlRevoked 且 source=agent）；E-BROWSER-NAV-FAILED（did-fail-load，reason 透传 Chromium 错误码） |
| 系统错误 | E-BROWSER-CRASHED（实例崩溃中） |
| 副作用 | 懒创建实例；source=agent 且 expand → 通知渲染进程展开面板；source=user（仅 IPC 通道的地址栏/chrome 手势导航）→ 清除 agentControlRevoked；**页内链接点击导航（will-navigate 路径）不解除 revoked** |
| 幂等性 | 否（导航是状态迁移） |

**样例（golden values）**：

| 场景 | 请求/输入 | 期望响应/输出 |
|---|---|---|
| 正常 | `{url:"http://localhost:3000", expand:true}` | `{ok:true, url:"http://localhost:3000/", title:"My App"}` |
| 协议补全（渲染进程前置） | 地址栏输入 `example.com` | 实际加载 url=`https://example.com/`；localhost/127.0.0.1 补 `http://` |
| 白名单拒绝 | `{url:"file:///etc/passwd"}` | `{ok:false, error:{code:"E-BROWSER-BAD-URL"}}` |
| 停止控制中 | `{url:"https://a.b"}`（revoked=true，HTTP 面恒为 agent 来源） | `{ok:false, error:{code:"E-BROWSER-DENIED"}}` |
| 连接失败 | `{url:"http://localhost:59999"}`（无监听） | `{ok:false, error:{code:"E-BROWSER-NAV-FAILED", reason:"ERR_CONNECTION_REFUSED"}}` |

#### 接口 2：HTTP `POST /api/browser/read`

| 项目 | 说明 |
|---|---|
| 调用方 | worker CLI 工具 |
| 被调用方 | browserViewManager → executeJavaScript 自包含序列化器 |
| 输入 | `{}` |
| 输出 | `{ok:true, url, title, text, elements, truncated}` |
| 业务错误 | E-BROWSER-DENIED；E-BROWSER-NOT-READY（实例未创建/无页面） |
| 系统错误 | E-BROWSER-CRASHED；注入被 CSP 拒 → 退化返回 `{url, title, text:"", elements:[], truncated:false}` 不报错 |
| 副作用 | 无 |
| 幂等性 | 是 |

**样例（golden values）**：

| 场景 | 请求/输入 | 期望响应/输出 |
|---|---|---|
| 正常（stub 页） | `{}` | `{ok:true, url:"http://localhost:3000/", title:"My App", text:"<正文摘要>", elements:[{tag:"a", text:"立即开始", selector:".md-cta", rect:{x,y,width,height}}, …], truncated:false}` |
| 截断 | 正文 >4000 字符或元素 >50 个 | `text` 截断至 4000 字符、`elements` 截断至 50 个，`truncated:true` |
| 未就绪 | 实例从未导航 | `{ok:false, error:{code:"E-BROWSER-NOT-READY"}}` |

#### 接口 3：HTTP `POST /api/browser/scroll` / `POST /api/browser/screenshot` / `GET /api/browser/state`

| 接口 | 输入 | 输出（golden） | 副作用 | 错误 |
|---|---|---|---|---|
| scroll | `{dx?:number, dy?:number}` | `{ok:true, scrollX:0, scrollY:480}` | 改当前页滚动位置 | 继承接口 2 错误集：E-BROWSER-DENIED / E-BROWSER-NOT-READY / E-BROWSER-CRASHED |
| screenshot | `{}` | `{ok:true, path:"<configDir>/browser-shots/browser-<n>.png", width, height}`（PNG 经 capturePage；跨会话单例全局序号，重启扫描目录续号；agent 按路径读图） | 落盘写文件 + 全局序号递增——**方法定 POST**（非幂等副作用，GET 语义违规） | 继承接口 2 错误集：E-BROWSER-DENIED / E-BROWSER-NOT-READY / E-BROWSER-CRASHED |
| state | — | `{ok:true, open:true, url:"http://localhost:3000/", title:"My App", agentControl:true, agentControlRevoked:false, crashed:false}` | 无 | 无（实例未创建时返回 open:false 等空态字段） |

#### 接口 4：HTTP `GET|DELETE /api/browser/cookies`

| 项目 | GET | DELETE |
|---|---|---|
| 调用方 | 本地采集引擎 / worker CLI 工具（auth-check 后端） | 用户/agent 发起的会话清理 |
| 被调用方 | browserViewManager（session.cookies.get） | browserViewManager（session.cookies.remove 逐条） |
| 输入 | `?domain=.bilibili.com[&name=SESSDATA]`（domain 必填，前导点=域后缀语义） | `?domain=.bilibili.com` |
| 输出 | `{ok:true, domain, cookieString, cookies:[{name, value, domain, path, expires, httpOnly, secure}]}` | `{ok:true, deletedCount}` |
| 业务错误 | E-BROWSER-BAD-DOMAIN（缺/空/无前导点） | 同左 |
| 系统错误 | 实例未创建 → 读分区 session（分区可无实例独立读取，非错误） | 同左 |
| 副作用 | 无 | 删除该域全部匹配 Cookie（登录态失效） |
| 幂等性 | 是 | 是（重复删返回 deletedCount:0） |
| 安全 | value 为完整明文（采集直用）；JSON 日志/工具折叠块展示一律脱敏为 `NAME=<redacted>` | 删除动作落日志（域级，不含值） |

**样例（golden values）**：

| 场景 | 请求/输入 | 期望响应/输出 |
|---|---|---|
| 已登录 | `GET /api/browser/cookies?domain=.bilibili.com` | `{ok:true, domain:".bilibili.com", cookieString:"SESSDATA=...; bili_jct=...", cookies:[…]}` |
| 空态 | 同上（从未访问过该域） | `{ok:true, domain:".bilibili.com", cookieString:"", cookies:[]}` |
| 单名过滤 | `GET ...?domain=.bilibili.com&name=SESSDATA` | cookies 仅含 SESSDATA 一条；cookieString=`SESSDATA=...` |
| 非法 domain | `GET ...?domain=bilibili.com`（无前导点） | `{ok:false, error:{code:"E-BROWSER-BAD-DOMAIN"}}` |
| 清理幂等 | `DELETE ...?domain=.bilibili.com`（12 条）→ 再 DELETE | 第一次 `{ok:true, deletedCount:12}`；第二次 `{ok:true, deletedCount:0}` |

#### 接口 5：IPC（渲染进程 ↔ 主进程，preload `window.opc.browser*`）

| 通道 | 方向 | 载荷 | 语义 |
|---|---|---|---|
| `opc-browser-bounds` | renderer → main（send，rAF 节流） | `{x, y, width, height, visible}` | 布局真相推送；visible=false（收起/遮挡）时 main 隐藏视图但保活 webContents |
| `opc-browser-navigate` | renderer → main（invoke） | `{url, expand?}` → 进接口 1 同一 navigate 状态机，**source 恒=user** | 地址栏/聊天链接等用户手势导航；清除 agentControlRevoked 的唯一通道 |
| `opc-browser-event` | main → renderer（on） | `{type:"navigated"\|"panel-request-open"\|"cookie-updated"\|"crashed"\|"load-failed", …}` | 状态同步：地址栏回显、控制指示、崩溃页/错误页；`cookie-updated` 由分区 `cookies` changed 监听发射（域级无值负载，任何分区 Cookie 变更均发射，非「登录成功后」语义） |
| `opc-browser-control` | renderer → main（invoke） | `{action:"stop-agent-control"}` → main 置 agentControlRevoked=true | 停止控制按钮 |

#### 接口 6：toolAdapter CLI 声明

| 命令 | riskLevel | 说明 |
|---|---|---|
| `browser navigate --url <u> [--expand]` | query | 接口 1，source=agent |
| `browser read` | query | 接口 2 |
| `browser scroll [--dx n] [--dy n]` | query | 接口 3 |
| `browser screenshot` | query | 接口 3 |
| `browser auth-check --domain <d> [--required-cookies <c1,c2>]` | query | 接口 4 后端包装：检查目标站点是否已具备有效登录态；未登录回 `{authenticated:false, missing:[...]}`，agent 据此引导用户在面板内手动登录（流程 D） |

### 10.5 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 浏览器承载形态 | A `<webview>` / **B WebContentsView** / C 双实例 | 方向 B 已确认：控制保真最高（主进程直持 webContents、CDP 可用）、可见性解耦天然满足「收起不断连」 | bounds 手动同步成本 |
| 工具接入形态 | 内置 MCP server / **CLI 工具面（toolAdapter）** | 复用「CLI 即控制面」先例与 riskLevel 映射（ADR-001 HTTP 通道） | 已验证：worker CLI 工具经 OPC_AGENT_SERVER_BASE_URL 直连主 server |
| 布局真相归属 | **A 渲染进程持有** / B 主进程持有 | Q1 拍板 A：React 布局单一真相，ResizeObserver 节流推 bounds，主进程哑执行 setBounds；实例「就绪前不 attach」消首帧闪烁 | 高频 IPC 需节流；同步异常按 E6 兜底 |
| agent 页面感知 | **A executeJavaScript 自包含快照** / B CDP 原生快照 | Q2 拍板 A：高频轮询语义下够用且截断可控；跨域 iframe 拿不到记为已知限制 | 严格 CSP 站点注入被拒 → 退化为 title/url only |
| 写入动作（click/type） | **本期砍**（曾推演 CDP Input 方案） | 2026-08-26 人裁决：本期只做预览/读取；CDP debugger 生命周期管理复杂度不付 | 后续 story 恢复时重启此推演 |
| session 分区与身份共享 | **persist:browser + 导出 API** / 内存 session | 登录态跨重启保留；人手动扫码后自动持久化并开放受控 API 给本地抓取服务与 Agent 复用 | 凭据面扩大 → 协议白名单 + 无 preload + 受控端点缓解 + 日志脱敏收口 |
| 停止控制解除 | **手动导航即解除** / 显式恢复按钮 | Q5 拍板：source=user 的导航清除 revoked（2026-08-30 收紧：仅渲染进程 IPC 的地址栏/chrome 手势，页内链接点击不解除）；紧急刹车语义 + 零额外交互 | 用户误导航即恢复（可接受，agent 仍需自主决定继续） |

### 10.6 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| WebContentsView 在 Electron 43 满足全部需求（嵌入、拦截、capturePage 截图） | 退回方向 A（webview） | TECH-DESIGN | 能（spike） |
| 渲染进程 React 布局与主进程 bounds 同步可做到无感 | 面板错位/遮挡 bug 频发 | TECH-DESIGN | 能（spike） |
| executeJavaScript 注入在常见站点不被 CSP 拒 | read 退化为 title/url，agent 感知变弱 | TECH-DESIGN | 能（spike 几个代表站点） |
| session.cookies 可在无实例时从分区独立读取（auth-check 免创建实例） | auth-check 需先懒创建实例（重 but 正确） | TECH-DESIGN | 能（API 文档核实） |
| 127.0.0.1 无认证 + Host/Origin/Sec-Fetch-Site 校验对凭据导出端点（cookies GET/DELETE）足够 | 本机恶意进程或面板内被导航到的恶意网页可经 HTTP 面读走统一身份池登录态（明文 cookieString 外泄） | TECH-DESIGN / ADR-039 增补（token 认证或导出开关） | 能（curl 伪造 Host/Origin 复现——应一律 403） |

### 10.7 安全/性能/可观测性

- 安全：协议白名单双闸（渲染进程前置校验 + 主进程 will-navigate/setWindowOpenHandler 兜底，覆盖重定向链）；视图无 preload、`nodeIntegration=false`、`contextIsolation=true`、webSecurity 默认开；persist:browser 分区与主窗口 session 隔离。**凭据边界**：Cookie 导出接口是本 story 最大新增信任面——明文只走 HTTP 本地回执（ADR-001 单机通道），绝入日志/工具折叠块全文（脱敏收口在 browser 路由）；DELETE 落域级审计日志；不做浏览器内支付/凭据管理器。**导出端点访问控制（2026-08-30 review 增补，ADR-039 决策 10）**：cookies GET/DELETE 仅接受 Host=127.0.0.1/localhost 的本机请求，带跨源 `Origin`/`Sec-Fetch-Site: cross-site|cross-origin` 一律 403，`/api/browser/*` 不输出 `Access-Control-Allow-Origin` 头；token 认证/导出开关留作回流点（§10.6）。
- 性能：bounds 推送 rAF 节流；read 快照 4000 字符/50 元素硬截断；实例懒创建，停止控制不销毁实例；cookies 接口按域过滤后返回（不全量 dump）。
- 可观测性：实例生命周期事件（创建/崩溃/导航失败/停止控制切换/cookie 域级删除）落 JSON 日志行（项目先例）；E6 同步异常记日志不弹错。

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（coverage seams，CLI 优先）

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| 1 面板骨架/手动浏览 | HTTP API（`/api/browser/*`：navigate/state）+ Playwright Electron E2E（面板展开/地址栏/拦截） | 集成 + E2E | 真实（本地 http stub 页面） |
| 2 agent 工具集 | CLI（toolAdapter browser 命令 JSON 回执 + riskLevel 声明） | 单元/集成 | HTTP 层 stub |
| 3 共驾/可见性规则 | HTTP API（收起状态 read 仍 ok；停止控制后 read 返 E-BROWSER-DENIED；手动导航解除）+ E2E（控制中指示/停止控制按钮） | 集成 + E2E | 真实 |
| 4 聊天链接集成 | 组件测试（MarkdownRenderer 链接点击 → 面板打开回调） | 单元/组件 | mock |
| 5 登录态/Cookie 桥接 | HTTP API（cookies GET 空态/单名过滤/BAD-DOMAIN、DELETE 幂等；auth-check authenticated/missing）+ 单元（domain 参数校验、日志脱敏函数） | 集成 + 单元 | 真实分区 session（stub 页种 Cookie） |

测试目录按 `tests/capabilities/embedded-browser/<entity>/2026-08-24-embedded-browser/` 组织（entity 拟 `browser-panel` / `browser-tools`）。

### 11.2 测试策略与先例

- 只测外部行为：URL 规范化结果、工具 JSON 回执、面板可见性、停止控制状态机；不测 WebContentsView 内部。
- 先例：toolAdapter 命令声明测试（riskLevel 映射）、Playwright Electron E2E（既有 `npm run test:e2e`）。

## 12. 范围外

- **提交类动作 click/type（含确认队列集成、CDP Input 保真方案）**——2026-08-26 TECH-DESIGN 中用户裁决本期砍，后续 story 再立；届时重启「提交类细粒度判定」推演
- 标签页、书签、历史记录页、下载管理、多账号分区、移动端模拟
- agent 持续视觉流理解（截图仅按需工具）
- 浏览器内支付/凭据管理器
- 多浏览器实例并存

## 13. 补充说明

- 访谈笔记：`interview-notes.md`（三轮 frontier，方向 B 已确认）。
- 2026-08-26 范围收敛：TECH-DESIGN Q3 推演 CDP Input 方案后，用户裁决本期只做预览/读取（navigate/read/scroll/screenshot），click/type 及其确认集成移入范围外。稳定块从 5 个收敛为 4 个（原块 4「提交类确认」移除，原块 5 改号 4）。
- 2026-08-28 用户增补：新增稳定块 5「登录态持久化、Cookie 导出与身份桥接」（ADR-039 补决策 7/8；流程 D；接口 4 cookies GET/DELETE + `browser auth-check`；错误 E7/E8；凭据日志脱敏底线）。浏览器定位升级为「可视化预览 + 人机协同登录认证中心」。
- 后续 story 伏笔：提交类动作 + 确认集成；agent 浏览跟随增强（语义级风险分级、站点级白名单）。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | §6.1 四条流程覆盖全部 5 个稳定块；§6.2 分支异常完整 |
| 输入验证 | PASS | §7 地址栏 + 工具 url 参数，均有有效/无效例子 |
| 错误状态 | PASS | §8 八类失败模式（E1-E8），含跨进程调用 |
| 预期值锚点 | PASS | §6.3 每稳定块 ≥1 条字面值锚点 |
| 复杂度分级 | complex | §9 理由已给 |
| 技术方案（§10） | PASS | 2026-08-26 /tech-design 深潜完成：10.1-10.7 完整，接口契约含 golden values |
| 覆盖接缝 | PASS | §11.1 每稳定块 ≥1 seam |

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-24 | 初稿 | AI + 人 |
| v0.2 | 2026-08-26 | TECH-DESIGN 深潜：范围收敛（砍 click/type，稳定块 5→4）；§10 完整填充（5 接口契约 + golden values）；ADR-039 落地 | AI + 人 |
| v0.3 | 2026-08-28 | 用户增补稳定块 5「登录态持久化、Cookie 导出与身份桥接」：流程 D、接口 4 完整契约（含空态/幂等/脱敏 golden）、auth-check CLI、E7/E8 错误、§9 复杂度回升 6 模块、§11.1 补 seam；同步修订 §2 解决方案表述 | AI + 人 |
| v0.4 | 2026-08-30 | review 修订：§1 补登录态/采集痛点（块 5 初衷记录）；§5 移动块 1 标注已稳定；§6.3 补块 4「系统浏览器打开/mailto 不拦截」与块 5 name 单名过滤锚点；§8-E2 登记 E-BROWSER-NAV-FAILED、§14 计数改 E1-E8；§10.2 补稳定块 4 契约（openBrowserPanelWithUrl → preload IPC）+ 第 6 模块口径 + ADR-035/036 路由约束；§10.3 手动浏览改 IPC 通道、cookie-updated 改分区变更监听语义；§10.4 接口 1 source 通道决定 + revoked 解除规则（页内点击不解除）、接口 3 补副作用/错误列且 screenshot 定 POST、接口 5 登记 opc-browser-navigate；§10.6 补凭据导出风险行 | AI + 人 |
