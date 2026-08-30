# Requirements — 内置浏览器面板与 agent 受控浏览器（预览/读取）

> 故事 ID：`2026-08-24-embedded-browser`
> 版本：v2
> 最后更新：2026-08-30
> 修订记录：v2（2026-08-30 errata，依据 STANDARDS「hash 锁定契约的笔误勘误走版本化修订」）——REQ-BROWSER-002 截图路径/序号语义对齐 PRD v0.3 人裁决（`<configDir>/browser-shots/`、跨会话全局递增）与 review 增补 AC（REQ-001 AC8 崩溃态、REQ-002 AC6 断言确定性化 + AC9 跨会话续号、REQ-003 source 通道决定、REQ-005 AC8 导出端点访问控制）；版本哈希见 `requirements-v2.hash`（v1 文件保留）
> 来源：`prd.md` v0.3（§4 五大稳定块、§10 技术方案、§10.4 六大接口契约）
> 移动块：PRD §5 移动块 1（read 快照字段细节：元素清单字段名以 §10.4 接口 2 golden 为准，截断阈值 4000 字符/50 元素已锚定）随实现细化，不入独立 REQ
> UX 参照：`ux/browser-panel.html`（单屏一体原型：面板 chrome、地址栏、agent 控制指示、停止控制、崩溃/错误页、六状态开关）
> ADR：`adr/0039-browser-panel-webcontentsview.md`（WebContentsView 主进程托管 + 人机共享单实例 + 渲染进程持布局真相；决策 7/8 Cookie 导出与 Human-in-the-Loop Auth）
> 范围裁决（2026-08-26）：click/type 写入动作本期砍（PRD §12）；全部工具 riskLevel=query
> 测试目录：`tests/capabilities/embedded-browser/browser-panel/2026-08-24-embedded-browser/` 与 `tests/capabilities/embedded-browser/browser-tools/2026-08-24-embedded-browser/`

---

## REQ-BROWSER-001 浏览器面板骨架与手动导航

- 优先级 P0 / 必须 / cross-module / browserViewManager(main) + BrowserPanel(renderer) + routes/browser / embedded-browser / browser-panel / 集成 + E2E
- UX 参照：`ux/browser-panel.html`（面板 chrome：导航键 + 全圆角地址栏 + 外链/收起按钮；宽度 = token `--ch-right-panel-width`）
- 接口契约（PRD §10.4 接口 1、4）：
  - `POST /api/browser/navigate`，输入 `{url, expand?: boolean}`；**source 由调用通道决定**：HTTP 面一律记为 agent（请求体 source 字段无效），source=user 仅来自渲染进程 IPC 导航（地址栏/面板 chrome 手势）。
  - URL 规范化（共享 normalize 逻辑，主进程路由为真源）：仅 http/https；缺省补全——localhost/127.0.0.1 补 `http://`，其余补 `https://`。
  - 响应：`{ok:true, url, title}` / `{ok:false, error:{code, reason}}`。
  - 错误码：E-BROWSER-BAD-URL（白名单外/无主机/空）；E-BROWSER-NAV-FAILED（did-fail-load，reason 透传 Chromium 错误码如 `ERR_CONNECTION_REFUSED`）；E-BROWSER-CRASHED。
  - 面板行为契约：应用启动后面板初始收起；「⧉ 浏览器」按钮展开；收起只隐藏视图（webContents 保活）；target=_blank / window.open 一律转面板内导航（setWindowOpenHandler 拦截），绝不打开新窗口、绝不劫持主窗口。
  - 安全基线：视图无 preload、nodeIntegration=false、contextIsolation=true、partition=`persist:browser` 与主窗口隔离。

验收标准：
1. **协议补全（锚点 §6.3 块1）**：`POST /api/browser/navigate {url:"example.com"}` 返回 `{ok:true, url:"https://example.com/"}`；`{url:"localhost:3000"}` 返回 `{ok:true, url:"http://localhost:3000/"}`（集成：本地 http stub 页面当 title 提供方）。
2. **白名单拒绝（锚点 §6.3 块1 / §7）**：`{url:"file:///etc/passwd"}` 与 `{url:"javascript:alert(1)"}` 均返回 `{ok:false, error:{code:"E-BROWSER-BAD-URL"}}`，且当前页不变（集成）。
3. **空/无主机输入（§7）**：`{url:""}` 不导航返回 BAD-URL；`{url:"http://"}` 返回 BAD-URL（集成）。
4. **导航失败透传（锚点 §8-E2）**：对无监听端口 `{url:"http://localhost:59999"}` 返回 `{ok:false, error:{code:"E-BROWSER-NAV-FAILED", reason:"ERR_CONNECTION_REFUSED"}}`（集成）。
5. **弹窗拦截（锚点 §6.3 块1）**：stub 页面含 `<a target="_blank" href="/next">`，点击后（E2E 驱动真实用户点击）无新 BrowserWindow 创建，面板内导航至 `/next`；`window.open()` 调用同样被拦截（E2E）。
6. **面板初始收起与展开（锚点 §6.3 块1 / UX 结构）**：应用启动后浏览器面板不可见（collapsed）；点击「⧉ 浏览器」按钮后面板可见且地址栏聚焦；点击收起按钮后面板隐藏，重新展开后地址栏仍显示收起前的 URL（E2E）。
7. **主窗口不被劫持（§6.2）**：面板内任意导航后，主窗口（会话区）路由 hash 不变、无新顶层窗口（E2E）。
8. **崩溃态工具拒绝（锚点 §8-E4）**：WebContents 崩溃后（dev-only 崩溃注入 seam），agent 工具（navigate/read/scroll/screenshot）返回 `{ok:false, error:{code:"E-BROWSER-CRASHED"}}`（E2E：崩溃注入 seam 覆盖）。

---

## REQ-BROWSER-002 agent 浏览器读取工具集

- 优先级 P0 / 必须 / cross-module / toolAdapter(worker) + routes/browser + browserViewManager / embedded-browser / browser-tools / 单元 + 集成
- 接口契约（PRD §10.4 接口 1/2/3、6）：
  - toolAdapter 声明四命令，riskLevel 均=`query`：`browser navigate --url <u> [--expand]`、`browser read`、`browser scroll [--dx n] [--dy n]`、`browser screenshot`。
  - navigate（source=agent 固定）：同接口 1 校验；额外检查 agentControlRevoked（true → E-BROWSER-DENIED）；`--expand` → 通知渲染进程展开面板（`opc-browser-event {type:"panel-request-open"}`）。
  - read：`{ok:true, url, title, text, elements, truncated}`；快照经 executeJavaScript 自包含序列化器；`text` 截断至 4000 字符、`elements` 截断至 50 个，超限 `truncated:true`；注入被 CSP 拒 → 退化 `{url, title, text:"", elements:[], truncated:false}` 不报错；实例未创建/无页面 → E-BROWSER-NOT-READY。
  - scroll：`{ok:true, scrollX, scrollY}`（executeJavaScript scrollBy 后回读位置）。
  - screenshot（HTTP 端点定 `POST /api/browser/screenshot`——落盘是非幂等副作用，GET 语义违规）：`{ok:true, path, width, height}`；PNG 经 capturePage 落 `<configDir>/browser-shots/browser-<n>.png`（n 跨会话全局递增：重启后扫描 browser-shots/ 目录取 max+1 续号，不重置、不覆盖既有文件；2026-08-29 人裁决，PRD §10.3/§10.4）。
  - 工具回执 JSON 与 toolAdapter 既有先例同构（`{ok:…}` / `{ok:false, error:{code, reason}}`）。

验收标准：
1. **riskLevel 声明（锚点 §6.3 块2）**：toolAdapter TOOL_DEFS 中 `browser navigate`/`browser read`/`browser scroll`/`browser screenshot` 四命令 riskLevel 均为 `"query"`，模块/函数映射存在（单元：对齐 §7.2 先例测试形态）。
2. **navigate 工具回执（锚点 §6.3 块2）**：`browser navigate --url http://localhost:3000`（stub 页）返回 `{ok:true, url:"http://localhost:3000/", title:<stub标题>}`（集成：worker CLI HTTP 客户端 → 本 server）。
3. **read 快照结构（锚点 §10.4 接口 2 golden）**：stub 页（含 `<a class="md-cta">立即开始</a>` 等）上 `browser read` 返回 `ok:true`，`url`/`title` 与 stub 一致，`elements` 数组含 `{tag:"a", text:"立即开始", selector:".md-cta", rect:{x,y,width,height}}` 形态条目，`truncated:false`（集成）。
4. **read 截断（锚点 §6.3 块2 阈值）**：正文 >4000 字符的 stub 页 → `text` 长度 === 4000 且 `truncated:true`；>50 个可交互元素的 stub 页 → `elements.length === 50` 且 `truncated:true`（集成）。
5. **read 未就绪（锚点 §8-E3）**：实例从未创建时 `browser read` 返回 `{ok:false, error:{code:"E-BROWSER-NOT-READY"}}`（集成）。
6. **scroll 回执（锚点 §10.4 接口 3 golden）**：stub 高页 `browser scroll --dy 480` 返回 `{ok:true, scrollX:0, scrollY:480}`——确定性断言 `scrollY === min(480, 页面可达下限)`；stub 页高度契约由测试层保证 480 可达，故断言精确值 480（集成）。
7. **screenshot 回执与落盘（锚点 §10.4 接口 3）**：`browser screenshot` 返回 `{ok:true, path:"<configDir>/browser-shots/browser-1.png", width:>0, height:>0}`，文件存在且 PNG 魔数 `\x89PNG`（集成）；同一会话第二次调用文件名为 `browser-2.png`（n 递增）。
8. **expand 事件**：`browser navigate --url … --expand` 在面板收起状态下执行后，渲染进程收到 `opc-browser-event {type:"panel-request-open"}` 并展开面板（E2E）。
9. **截图序号跨会话续号（锚点 §10.3，2026-08-29 人裁决）**：应用重启后首次 `browser screenshot` 扫描 `<configDir>/browser-shots/` 取既有最大序号 +1 续号，不重置为 1、不覆盖既有文件（集成：预置 browser-1.png/browser-2.png 后以同一 configDir 重启 server，断言新截图序号为 3 且既有文件内容不变）。

---

## REQ-BROWSER-003 人机共驾与可见性规则（停止控制状态机）

- 优先级 P0 / 必须 / cross-module / browserViewManager + BrowserPanel + preload / embedded-browser / browser-panel / 集成 + E2E
- 接口契约（PRD §10.4 接口 1/3/5）：
  - agentControlRevoked 状态机：`browser navigate --expand`（source=agent）执行 → 置 revoked=false 且渲染进程显示「agent 控制中」指示（`opc-browser-event {type:"navigated", source:"agent"}`）；`opc-browser-control {action:"stop-agent-control"}` → revoked=true；source=user 的导航 → revoked=false（手动导航解除——仅限地址栏/面板 chrome 级手势经渲染进程 IPC 发起的导航；页内链接点击导航（will-navigate 路径）不解除）。
  - revoked=true 期间：**所有** agent 来源 browser 工具调用返回 E-BROWSER-DENIED（含 read/scroll/screenshot/navigate）；页面状态不变。
  - 收起面板（bounds visible=false）时工具照常可用（可见性解耦，ADR-039 决策 3）。
  - 用户操作不加锁：revoked 状态不影响用户在面板内的一切操作。

验收标准：
1. **停止控制后拒绝（锚点 §6.3 块3）**：正常导航后经 `opc-browser-control stop-agent-control` 置 revoked，`browser read` 返回 `{ok:false, error:{code:"E-BROWSER-DENIED"}}`；`browser navigate --url …`（source=agent）同样 DENIED；`GET /api/browser/state` 显示 `agentControlRevoked:true`（集成）。
2. **手动导航解除（锚点 §6.3 块3 / 流程 C）**：revoked 状态下用户经面板地址栏导航一次（渲染进程 IPC，source=user）成功后，revoked 自动清除，后续 `browser read` 返回 `ok:true`（集成/E2E：经 IPC 导航 seam）；页内链接点击导航（will-navigate 路径）不解除 revoked。
3. **收起不断连（锚点 §6.3 块3）**：面板收起（bounds visible=false）状态下 `browser read` 返回 `ok:true` 且 url 与收起前一致；`GET /api/browser/state` 显示 `open:false`（集成）。
4. **停止控制不关页面（流程 C 步骤 1）**：stop-agent-control 后 `GET /api/browser/state` 的 url/title 与停止前一致，实例未销毁（集成）。
5. **控制指示可见性（锚点 §6.3 块3 / UX 结构）**：agent navigate 后面板内「agent 控制中」指示条与「停止控制」按钮可见（data-testid=`agent-control-bar` / `stop-agent-control`）；点击「停止控制」后指示条消失（E2E）。
6. **state 接口契约（锚点 §10.4 接口 3）**：`GET /api/browser/state` 返回 `{ok:true, open, url, title, agentControl, agentControlRevoked, crashed}` 字段齐备且为契约类型（集成）。
7. **source 由通道决定（锚点 §10.4 接口 1 + 2026-08-30 review 安全决策）**：HTTP 面 navigate 一律按 source=agent 处理，请求体 source 字段无效——revoked 状态下 `POST /api/browser/navigate` 即使带 `{source:"user"}` 仍返回 E-BROWSER-DENIED（不能经 HTTP 伪造 user 解除停止控制）；source=user 仅来自渲染进程 IPC 导航（集成）。

---

## REQ-BROWSER-004 聊天链接面板集成

- 优先级 P1 / 必须 / intra-module / MarkdownRenderer(renderer) + BrowserPanel / embedded-browser / browser-panel / 组件
- 接口契约（PRD §10.2）：
  - MarkdownRenderer 渲染的 http(s) 链接点击 → 默认在浏览器面板打开（经同一 `/api/browser/navigate`，source=user，expand），不在系统浏览器打开；提供「在系统浏览器打开」入口（shell.openExternal）。
  - 仅限 http/https；其他协议（mailto: 等）保持系统默认处理。

验收标准：
1. **链接面板打开（锚点 §6.3 块4）**：助手消息含 `[x](https://a.b/c)` 渲染后点击链接，浏览器面板展开且地址栏显示 `https://a.b/c`（组件 + E2E：stub 环境断言 navigate 调用参数）。
2. **系统浏览器入口**：链接关联菜单/按钮触发 `opc.openExternal("https://a.b/c")`（组件：mock preload 断言）。
3. **非 http(s) 协议不走面板**：`mailto:a@b.c` 点击不触发面板 navigate（组件）。

---

## REQ-BROWSER-005 登录态持久化与 Cookie 受控导出

- 优先级 P0 / 必须 / cross-module / browserViewManager(session persist:browser) + routes/browser / embedded-browser / browser-panel / 集成
- ADR：ADR-039 决策 7（Cookie 提取、导出与身份桥接——统一会话池）
- 接口契约（PRD §10.4 接口 4）：
  - `GET /api/browser/cookies?domain=<d>[&name=<n>]`：domain 必填、前导点语义（`.bilibili.com` = 域后缀匹配）；响应 `{ok:true, domain, cookieString, cookies:[{name, value, domain, path, expires, httpOnly, secure}]}`；cookieString 为 `NAME=value; NAME2=value2` 分号拼接（完整明文，供采集引擎直用）。
  - `DELETE /api/browser/cookies?domain=<d>`：逐条 remove 该域全部匹配 Cookie，响应 `{ok:true, deletedCount}`；幂等（重复删 → deletedCount:0）。
  - domain 校验：缺失/空/无前导点 → E-BROWSER-BAD-DOMAIN。
  - 实例未创建时仍可读/删（分区 session 独立于视图实例）。
  - **日志脱敏底线**：cookieString/value 全值禁止写入 JSON 日志行与工具折叠块——日志展示一律 `NAME=<redacted>`；DELETE 落域级审计日志（仅域，不含值）。

验收标准：
1. **空态（锚点 §6.3 块5）**：`GET /api/browser/cookies?domain=.bilibili.com`（从未访问该域）返回 `{ok:true, domain:".bilibili.com", cookieString:"", cookies:[]}`，HTTP 200（集成）。
2. **读取已种 Cookie（锚点 §6.3 块5）**：向 persist:browser 分区种入 `{name:"SESSDATA", value:"abc123", domain:".bilibili.com"}` 与 `{name:"bili_jct", value:"xyz", domain:".bilibili.com"}` 后 GET 返回 cookieString 含 `SESSDATA=abc123` 与 `bili_jct=xyz`，cookies 数组含 name/value/domain/path/expires/httpOnly/secure 七字段（集成：session.cookies.set stub）。
3. **单名过滤**：`?domain=.bilibili.com&name=SESSDATA` 仅返回 SESSDATA 一条，cookieString=`SESSDATA=abc123`（集成）。
4. **BAD-DOMAIN 校验（锚点 §7.1 / §8-E7）**：`?domain=`（空）与 `?domain=bilibili.com`（无前导点）均返回 `{ok:false, error:{code:"E-BROWSER-BAD-DOMAIN"}}`（集成）。
5. **删除与幂等（锚点 §6.3 块5）**：种 12 条该域 Cookie 后 DELETE 返回 `{ok:true, deletedCount:12}`；再 GET 返回空态；再次 DELETE 返回 `{ok:true, deletedCount:0}`（集成）。
6. **无实例可读**：不创建浏览器实例直接 GET cookies 正常返回（非 E-BROWSER-NOT-READY）（集成）。
7. **日志脱敏（锚点 §6.3 块5）**：GET/DELETE 处理过程中产生的 JSON 日志行不含 `abc123` 等明文值，Cookie 名与 `<redacted>` 占位允许出现（单元：日志收集器断言）。
8. **导出端点访问控制（锚点 §10.7 凭据边界 + ADR-039 增补决策 10）**：cookies 导出/删除端点仅接受 Host=127.0.0.1/localhost 的本机请求；带跨源 `Origin` 或 `Sec-Fetch-Site: cross-site`/`cross-origin` 的请求一律 403；`/api/browser/*` 响应不输出 `Access-Control-Allow-Origin` 头（集成：伪造 Host/Origin 断言 403 与响应头缺失）。

---

## REQ-BROWSER-006 agent 登录探测与人机引导（auth-check）

- 优先级 P1 / 必须 / cross-module / toolAdapter(worker) + routes/browser + browserViewManager / embedded-browser / browser-tools / 集成 + E2E
- ADR：ADR-039 决策 8（Human-in-the-Loop Auth）
- 接口契约（PRD §10.4 接口 6）：
  - `browser auth-check --domain <d> [--required-cookies <c1,c2>]`，riskLevel=query。
  - 返回 `{authenticated: boolean, missing?: string[]}`——**探测失败是正常回执非错误**（§8-E8）：required-cookies 全部存在 → `{authenticated:true}`；任一缺失 → `{authenticated:false, missing:[<缺失名单>]}`；required-cookies 缺省 → 该域存在任意 Cookie 即 `{authenticated:true}`，否则 `{authenticated:false, missing:[]}`。
  - domain 参数同样过前导点校验（非法 → E-BROWSER-BAD-DOMAIN）。
  - 未登录引导链路（agent 自主编排）：auth-check=false → agent 调 `browser navigate --url <登录页> --expand`（面板展开加载登录页）→ 用户在面板内手动登录（人操作优先）→ 后续 auth-check=true，任务接续。

验收标准：
1. **已登录判定（锚点 §6.3 块5）**：种入 SESSDATA 后 `browser auth-check --domain .bilibili.com --required-cookies SESSDATA` 返回 `{authenticated:true}`（集成）。
2. **未登录判定与 missing 名单（锚点 §8-E8）**：仅种入 bili_jct 时同命令返回 `{authenticated:false, missing:["SESSDATA"]}`（集成）。
3. **空 required-cookies 语义（§7.1）**：`browser auth-check --domain .bilibili.com`（无名单）在该域有任意 Cookie 时 `{authenticated:true}`，无任何 Cookie 时 `{authenticated:false, missing:[]}`（集成）。
4. **riskLevel 声明（锚点 §6.3 块2）**：`browser auth-check` 在 TOOL_DEFS 中 riskLevel=`"query"`（单元）。
5. **BAD-DOMAIN 透传**：`browser auth-check --domain bilibili.com` 返回 E-BROWSER-BAD-DOMAIN（集成）。
6. **引导流程 E2E（流程 D）**：stub 登录页场景——auth-check=false → agent navigate --expand 后面板展开且加载登录页 URL（E2E：面板可见 + 地址栏 = 登录页；用户手动登录后 auth-check 转真的完整闭环依赖真实站点，E2E 以 stub Cookie 种入替代登录动作）。

---

## 范围与追溯备注

- **capability**：`embedded-browser`（本次新增至 business-capabilities.md）。
- **entity**：`browser-panel`（面板实体：骨架/共驾/链接集成/登录态）、`browser-tools`（agent 工具实体：读取工具集/auth-check）。
- **移动块不入 REQ**：read 快照字段细节（REQ-BROWSER-002 锚定 golden 形态，字段命名实现期定）；浏览器 session partition 的多账号扩展（PRD §12 范围外）。
- **click/type 及确认队列集成**：范围外（PRD §12，2026-08-26 人裁决）。
- **纯视觉项（REFLECT 人工验收）**：面板 chrome 视觉密度、地址栏聚焦环样式、控制指示条配色（info-soft）、确认态文案——UX HTML 为参照，不设自动化断言。
