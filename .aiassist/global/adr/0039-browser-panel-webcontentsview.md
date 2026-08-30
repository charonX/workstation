# ADR-039: 内置浏览器面板——WebContentsView 主进程托管 + 人机共享单实例 + 渲染进程持布局真相

- **状态**: 已接受
- **日期**: 2026-08-26
- **Story**: 2026-08-24-embedded-browser（内置浏览器面板与 agent 受控浏览器）

## 背景

workstation 需要一个内置浏览器：既承载用户的手动预览/浏览（会话区右侧可收起面板），
又作为 agent 的读取工具面（navigate/read/scroll/screenshot），用户实时看到 agent 在
浏览什么。核心矛盾有三：

1. **控制保真 vs 布局便利**：`<webview>` 跟着 React DOM 走（布局最简）但控制链路要经
   `webContents.fromId` 间接跳转；`WebContentsView` 由主进程直持（agent 工具零跳转），
   但视图几何要自己管。
2. **布局真相归属**：面板几何（宽度/收起/窗口 resize）天然由 React 布局决定，而
   WebContentsView 的 bounds 只能由主进程设置——两处真相必漂移，必须选一处。
3. **可见性与生命周期**：「收起面板」不能成为 agent 浏览器的隐式 kill switch
   （访谈确认：收起不断连）。

同时记录范围裁决（2026-08-26）：**本期不做 click/type 写入动作**——CDP Input 保真
方案（`Input.dispatchMouseEvent`，isTrusted=true）已推演但 debugger 会话生命周期
管理复杂度不付；全部工具 riskLevel=query，确认队列零改动。写入动作恢复时重启该推演。

## 决策

1. **WebContentsView 主进程托管**（非 `<webview>`、非双实例投影）：browserViewManager
   持有唯一浏览器实例，agent 工具（worker CLI → HTTP /api/browser/*，ADR-001 通道）
   与用户地址栏共用同一实例——人看到的画面就是 agent 操作的画面，无双浏览器同步问题。
2. **渲染进程持布局真相**：BrowserPanel 用 ResizeObserver + rAF 节流推送 bounds
   （IPC `opc-browser-bounds`），主进程哑执行 setBounds；实例「就绪前不 attach」消
   首帧闪烁；同步异常按 E6 兜底（隐藏视图而非错位遮挡，下帧重算恢复）。
3. **可见性解耦**：visible=false 只隐藏视图，webContents 保活——agent 工具在面板
   收起时照常可用。
4. **协议白名单双闸**：渲染进程地址栏前置校验（localhost/127.0.0.1 补 http，其余补
   https）+ 主进程 will-navigate/setWindowOpenHandler 兜底（覆盖重定向链与
   target=_blank——弹窗一律转面板内导航，绝不劫持主窗口）。
5. **session 持久分区 `persist:browser`**：登录态跨重启保留；与主窗口 session 隔离；
   视图无 preload、nodeIntegration 关、contextIsolation 开。
6. **人机共驾不加锁**：人操作永远优先；「停止控制」置 agentControlRevoked（agent
   工具一律 E-BROWSER-DENIED），source=user 的导航即解除（手动导航 = 收回并归还控制）。
7. **Cookie 提取、导出与身份桥接（统一会话池）**：
   `persist:browser` 中的登录态（Cookie/Session）不仅供面板内渲染，还作为整个工作台的
   统一身份池：主进程提供受控的 Cookie 导出接口（`GET /api/browser/cookies?domain=...`），
   允许本地数据采集引擎（如 B站/X/微博直连抓取）与后台 Agent 直接复用最新登录 Cookie，
   免去手工抓包与配置维护；支持 `DELETE /api/browser/cookies?domain=...` 清理指定站点会话。
8. **Agent 登录探测与人机引导（Human-in-the-Loop Auth）**：
   提供 `browser auth-check --domain <domain> [--required-cookies <names>]` 工具，允许 Agent
   主动检测目标站点是否已具备登录态；若未登录，Agent 可导航至登录页并请求展开面板（expand=true），
   向用户发出扫码/登录引导提示，用户在内置面板完成登录后，后续请求与采集任务无缝接续。

## 后果

- 主进程新增 browserViewManager + `/api/browser/*` 路由（含 `/api/browser/cookies` 读取与清理）；
  渲染进程新增 BrowserPanel；toolAdapter 新增 browser 命令组（含 `navigate`, `read`, `scroll`, `screenshot`, `auth-check`，全 query 级）。
- 内置浏览器从单纯的“预览窗口”升级为“可视化预览 + 人机协同登录认证中心（Auth Hub）”。
- bounds 同步成为新的跨进程高频通道（rAF 节流），错位类 bug 有 E6 兜底策略。
- read 快照走 executeJavaScript 自包含序列化器（4000 字符/50 元素硬截断）；严格 CSP
  站点退化为 title/url only（已知限制）；跨域 iframe 内容不可读（范围外）。
- click/type 及其确认集成推迟到后续 story；届时需评估 CDP debugger 与用户 DevTools
  的 attach 冲突（E-BROWSER-DEBUGGER-BUSY 预案）。

## 替代方案（考虑过，为什么没选）

| 方案 | 为什么没选 |
|---|---|
| `<webview>` 标签嵌入 | 控制链路多一跳（fromId 间接）；官方不推新；可见性与 DOM 耦合（收起即销毁风险） |
| 面板纯展示 + 独立 headless 浏览器（双实例） | 状态同步是持续复杂度源，「用户看到 ≠ agent 操作」类 bug 会不断出现 |
| 主进程持布局真相（固定几何 + CSS 留白） | 两处几何真相，收起动画/布局变化易漂移 |
| CDP DOMSnapshot/AXTree 作 read 快照 | 快照体积大需主进程裁剪、session 生命周期管理复杂；高频轮询语义下收益不成比例 |
| 内存 session | agent 无法访问任何需登录页面，用户每次重启重登录 |

## 2026-08-30 增补决策（review 修订）

9. **截图落盘 `<configDir>/browser-shots/`（跨会话单例语义，2026-08-29 人裁决正式收编）**：
   浏览器为跨会话单例，截图不归 agent 会话目录；PNG 落应用配置目录
   `browser-shots/browser-<n>.png`，n 跨会话全局递增——应用重启后扫描目录取 max+1
   续号，不重置、不覆盖既有文件；screenshot 端点方法定 POST（落盘写文件是非幂等
   副作用，GET 语义违规）。
10. **Cookie 导出端点访问控制**：`/api/browser/cookies`（GET/DELETE）仅接受
    Host=127.0.0.1/localhost 的本机请求；带跨源 `Origin` 或
    `Sec-Fetch-Site: cross-site/cross-origin` 的请求一律 403；`/api/browser/*`
    响应不输出 `Access-Control-Allow-Origin` 头。明文凭据首次放上 HTTP 面后，
    决策 7 的「本地通道」前提必须显式强制，不能依赖「绑定 127.0.0.1」隐式假设
    （DNS rebinding 可绕过）。token 认证/导出开关方案留作回流点（PRD §10.6 风险表）。
11. **headless fallback fetch 直连任意 http(s) 属显式接受风险**：用户可见浏览器的
    本质即请求任意站点，与安全清单 SSRF 条款的张力按显式豁免处理；私有 IP/元数据
    地址（169.254.169.254 等）拦截留作后续 story。

另随本增补明确（原决策 6 的收紧）：navigate 的 source 由调用通道决定——HTTP 面
一律记为 agent（请求体 source 字段无效），source=user 仅来自渲染进程 IPC 导航；
agentControlRevoked 仅由地址栏/面板 chrome 级手势导航解除，页内链接点击
（will-navigate 路径）不解除。

## 相关文件

- `.aiassist/stories/2026-08-24-embedded-browser/prd.md` §10（接口契约与 golden values）
- `.aiassist/stories/2026-08-24-embedded-browser/ux/browser-panel.html`（UX 参照）
