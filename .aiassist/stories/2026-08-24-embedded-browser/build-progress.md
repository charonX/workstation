# Build Progress — 内置浏览器面板与 agent 受控浏览器（预览/读取）

> 故事 ID：`2026-08-24-embedded-browser`
> 开始：2026-08-28（/implementer 子代理调度模式）
> 契约：`requirements.md` v1（hash 28b4d678…）、`signoff.md`（auto 签核 2026-08-28）

## 切片计划

| Slice | REQ-ID | 内容 | 依赖 |
|---|---|---|---|
| 1 | REQ-BROWSER-001/003/005 | browserViewManager（main）+ `/api/browser/*` 路由（navigate/state/read/scroll/control/bounds/cookies）——主进程核心与 HTTP 契约层 | 无 |
| 2 | REQ-BROWSER-002/006 | toolAdapter `browser navigate/read/scroll/screenshot/auth-check` 五命令声明（riskLevel=query）——agent 工具面 | Slice 1（HTTP 端点） |
| 3 | REQ-BROWSER-001/003 | BrowserPanel（renderer）：面板 UI、地址栏、控制指示、崩溃/错误页、ResizeObserver→bounds IPC、preload 扩展；MarkdownRenderer 链接集成（REQ-BROWSER-004） | Slice 1（事件与端点） |

执行顺序：1 → 2 → 3（2、3 无相互依赖，可先后并行，但按顺序串行执行以保验证清晰）。

---

## Slice 1: browserViewManager + /api/browser/* 路由

状态：**complete**（679a1d0..b0d6bf0，tests green，PRD alignment passed after 2 gaps resolved，refactor pass done，no rollback）

- 实现 commit：`679a1d0`（[build]，含前一个被限流中断子代理的接线）→ GAP-1 fix `5480ab7`（[build]，cookies Electron 路径统一 adapter）→ refactor `b0d6bf0`（[refactor]，5 项安全清理，17/17 绿无回滚）
- 测试落地 commit：`42b498f`（[test]，骨架哨兵移除，expected 零改动）
- 业务测试：`browserApi.test.js` **17/17 绿**；全量单元回归 **1108/1109**（唯一失败 = browserTools import 期失败，Slice 2 范围）
- PRD 对齐检查：MISALIGNMENT_FOUND → 已闭环——GAP-1（cookies Electron 路径 cookiesGet 不存在 → 500）已修；GAP-2（接口 5 IPC vs HTTP）人裁决：按 PRD 补 IPC 通道，归 Slice 3
- commit 纪律核验：3 个 [build]/[refactor] commit 均未触碰 tests/
- refactor 遗留观察（留 /review）：notifier 双通道注入路径重叠；runNavigation 三分支策略分发；_seedCookiesForTest 可达性依赖 session.isFallback 内部标记

### PRD→代码 可追溯性表

| PRD 意图 | 实现 | 测试 | 状态 |
|---|---|---|---|
| §6.3 块1 协议补全（example.com→https / localhost→http） | browserViewManager.normalizeBrowserUrl | browserApi「协议补全」 | COVERED |
| §6.3 块1/§7.1 白名单拒绝（file:/javascript: → BAD-URL，当前页不变） | normalizeBrowserUrl + navigate | 「白名单拒绝」 | COVERED |
| §7 空/无主机拒绝 | normalizeBrowserUrl | 「空输入与无主机」 | COVERED |
| §8-E2/§10.4 接口1 导航失败透传 ERR_CONNECTION_REFUSED | chromiumReasonFromError + fallbackNavigateExecutor | 「导航失败透传」 | COVERED |
| §6.3 块1 启动后面板收起 open=false | getState | 「初始收起」 | COVERED |
| §10.4 接口3 state 七字段契约 | getState | 「state 字段」 | COVERED |
| §6.3 块3/§8-E5 停止控制 → agent 全 DENIED、页面不变 | stopAgentControl + assertAgentAllowed | 「停止控制」 | COVERED |
| §6.3 块3 手动导航解除 revoked | navigate(source=user) 清除 | 「手动导航解除」 | COVERED |
| §6.3 块3 可见性解耦（visible=false read 照常） | setBounds + read headless 快照 | 「面板收起 read 照常」 | COVERED |
| §8-E3 read 未就绪 NOT-READY | read crashed/view 判定 | 「read 未就绪」 | COVERED |
| §6.3 块5 Cookie 空态 | getCookies | 「空态」 | COVERED |
| §6.3 块5 已种读取（cookieString 明文 + 七字段） | getCookies + 内存 session | 「读取已种 Cookie」 | COVERED |
| §10.4 接口4 单名过滤 | getCookies name 参数 | 「单名过滤」 | COVERED |
| §8-E7 BAD-DOMAIN（空/无前导点） | domain 校验 | 「BAD-DOMAIN」 | COVERED |
| §6.3 块5 删除幂等 12→0 | deleteCookies | 「删除与幂等」 | COVERED |
| §10.4 接口4 分区独立于实例 | session 独立创建 | 「无实例可读」 | COVERED |
| §6.3 块5 日志脱敏（域级/计数，禁值） | 域级审计日志 | 「日志脱敏」 | COVERED |
| §8-E4 崩溃恢复（agent → CRASHED / user → 重建） | render-process-gone + navigate 重建分支 | E2E 覆盖（崩溃注入留 QA） | PARTIAL |
| §6.3 块1 弹窗拦截（setWindowOpenHandler deny + 面板内导航） | createView 拦截器 | E2E 覆盖 | PARTIAL（待 Slice 3 E2E） |
| §10.3 expand → panel-request-open 事件 | navigate expand 通知 | E2E 覆盖 | PARTIAL（待 Slice 3） |

---

## Slice 2: toolAdapter browser 命令组（navigate/read/scroll/screenshot/auth-check）

状态：**complete**（3d2a2c9..0f24e6f，tests green，PRD alignment passed after 2 gaps resolved，refactor pass done，no rollback）

- 实现 commit：`3d2a2c9`（[build]，仅 src/：TOOL_DEFS 加 export + 五命令声明（riskLevel=query）+ `surface.invoke` + `cli/commands/browser.js` + CLI 注册 + selector 生成修正（`a.md-cta`→`.md-cta` 对齐接口 2 golden））
- 测试落地 commit：`35f510c`（[test]，哨兵移除 + seedCookie 接 seed seam + 4 个 Electron-only 用例迁移至 E2E）+ `0aa3e47`（[test]，auth-check 空名单正半支，PRD 对齐缺口 1）
- PRD 修订 commit：`5f9187b`（[docs]，screenshot 落盘锚点 <sessionDir>/shots/ → <configDir>/browser-shots/，人裁决）
- 业务测试：`browserTools.test.js` **10/10 绿**；`browserApi.test.js` **17/17** 无回归；全量 1117/1117（缺口 1 补测后）
- PRD 对齐检查：MISALIGNMENT_FOUND → 2 缺口闭环（缺口 1 missing-test 补测；缺口 2 spec-gap 人裁决修 PRD 措辞）
- refactor：`0f24e6f`（提取 postBrowserApi helper + pickSelector 命名函数）
- refactor 遗留观察（留 /review）：authCheck 与其余四命令形态不同构（登录判定可下沉 server 端，新 story/ADR 层面决策）；parseCommandLine 与 parseArgs 两套 flag 解析并行（跨模块漂移风险）
- commit 纪律核验：2 个 [build]/[refactor] commit 均未触碰 tests/

- 实现 commit：`3d2a2c9`（[build]，仅 src/：TOOL_DEFS 加 export + 五命令声明（riskLevel=query）+ `surface.invoke` + `cli/commands/browser.js` + CLI 注册 + selector 生成修正（`a.md-cta`→`.md-cta` 对齐接口 2 golden））
- 测试落地 commit：`35f510c`（[test]，哨兵移除 + seedCookie 接 seed seam + 4 个 Electron-only 用例（read 结构/截断、scroll、screenshot）迁移至 E2E——req-gap 就地补全）
- 业务测试：`browserTools.test.js` **9/9 绿**；`browserApi.test.js` **17/17** 无回归；**全量 1117/1117**
- PRD 对齐子代理进行中

### PRD→代码 可追溯性表（初稿，对齐检查后定稿）

| PRD 意图 | 实现 | 测试 | 状态 |
|---|---|---|---|
| §10.4 接口6 五命令声明 + riskLevel=query | toolAdapter TOOL_DEFS | browserTools 声明×2 | COVERED |
| §6.3 块2 navigate 回执 {ok,url,title} | cli/commands/browser.js → POST /navigate | browserTools「navigate 回执」 | COVERED |
| §10.4 接口2 read 未就绪 NOT-READY | 透传 | browserTools「read 未就绪」 | COVERED |
| §10.3 expand → panel-request-open | navigate --expand → Slice 1 通知 | browserTools「expand 事件」 | COVERED（E2E 深验证待 Slice 3） |
| §6.3 块5 auth-check authenticated/missing/空名单/BAD-DOMAIN | cli/commands/browser.js authCheck | browserTools auth-check×4 | COVERED |
| §7.1 row3 空名单正半支（有任意 Cookie → true） | authCheck 空名单分支 | browserTools「空 required-cookies：有任意 Cookie」 | COVERED |
| §10.4 接口2 read 结构/截断 + 接口3 scroll/screenshot | browserViewManager（Slice 1 已有） | 迁移至 E2E（skip，Slice 3 驱动） | PARTIAL |

---

## Slice 3: BrowserPanel 渲染层 + preload IPC + 链接集成 + E2E 驱动

状态：**complete**（e5f05e2..f2c4e53，tests green，PRD alignment passed after 4 gaps resolved，refactor pass done，no rollback）

- 实现 commit：`e5f05e2`（[build] BrowserPanel + browserPanelStore + preload `window.opc.browser*` + main.js IPC handlers + MdLink 链接集成 + i18n 18 键 + manager 修复 did-fail-load 后误报 navigated 的潜伏 bug）+ `f6f7d83`（[build] fix：expandPending 状态对账修事件竞态 + screenshot 收起态临时顶挂修 0×0 + getWindow 接线）+ `c762ec6`（[build] dev-only 崩溃注入 seam）+ refactor `f2c4e53`（parkedBounds/imageSize/notReadyResult 提取 + test seam 样板收敛 + store setOpen 收敛）
- 测试落地 commit：`a401a59`（[test]，E2E skip 全移除 + stub 页扩展）+ `962cfbc`（[test]，PRD 对齐缺口 1-3 补测 7 用例）
- E2E：**17/17 全绿**（refactor 后父代理独立复跑确认）；单元 **1118/1118**；lint 0 errors
- PRD 对齐检查（2026-08-30）：MISALIGNMENT_FOUND → 4 缺口全部闭环；5 项已知偏差全部 acceptable
- commit 纪律核验：`e5f05e2`/`f6f7d83`/`c762ec6`/`f2c4e53` 均未触碰 tests/
- refactor 遗留观察（留 /review）：scheme 判定三处平行实现（BrowserPanel.hasForbiddenScheme / normalizeBrowserUrl / openExternal 白名单——规则漂移风险）；expandPending 清除时机耦合 bounds 首帧推送；screenshot 重试固定 15×100ms 硬编码
- 留 /reflect 观察项：backgroundThrottling:false 隐藏态持续合成开销；`cookie-updated` 事件在接口 5 表中但 manager 未发射且无 REQ 锚定（spec-gap 观察，/reflect 决定补发射或删行）

- 实现 commit：`e5f05e2`（[build] BrowserPanel + browserPanelStore + preload `window.opc.browser*` + main.js IPC handlers + MdLink 链接集成 + i18n 18 键 + manager 修复 did-fail-load 后误报 navigated 的潜伏 bug）+ `f6f7d83`（[build] fix：expandPending 状态对账修事件竞态 + screenshot 收起态临时顶挂修 0×0 + getWindow 接线）+ `c762ec6`（[build] dev-only 崩溃注入 seam）
- 测试落地 commit：`a401a59`（[test]，E2E skip 全移除 + stub 页扩展）+ `962cfbc`（[test]，PRD 对齐缺口 1-3 补测 7 用例）
- E2E：**17/17 全绿**（含 window.open 第二触发面 / 聚焦 / E1 内联提示 / E2 错误页 / E4 崩溃页 / REQ-004 AC2 右键菜单 / AC3 mailto）
- 单元回归：1118/1118；lint 0 errors
- PRD 对齐检查（2026-08-30）：MISALIGNMENT_FOUND → 4 缺口全部闭环（1-3 补测落地 + 4 文档回填）；5 项已知偏差全部 acceptable
- 对齐代理发现的重要实证：E2E 曾暴露 `getWindow` 从未接线（视图从未真正 attach）——纯 node 测试与 DOM 断言都照不出，只有真实 E2E 可见
- 留 /reflect 观察项：backgroundThrottling:false 隐藏态持续合成开销；`cookie-updated` 事件在接口 5 表中但 manager 未发射且无 REQ 锚定（spec-gap 观察，/reflect 决定补发射或删行）

### PRD→代码 可追溯性表

- 实现 commit：`e5f05e2`（[build] BrowserPanel + browserPanelStore + preload `window.opc.browser*` + main.js IPC handlers + MdLink 链接集成 + i18n 18 键 + manager 修复 did-fail-load 后误报 navigated 的潜伏 bug）+ `f6f7d83`（[build] fix：expandPending 状态对账修事件竞态 + screenshot 收起态临时顶挂修 0×0 + getWindow 接线）
- 测试落地 commit：`a401a59`（[test]，E2E skip 全移除 + stub 页扩展）
- E2E：**10/10 全绿**（父代理独立复跑确认）；单元 1118/1118；lint 0 errors
- PRD 对齐检查（2026-08-30）：MISALIGNMENT_FOUND → 4 缺口（1-3 missing-test 补测中：REQ-004 AC2/AC3 组件断言、window.open 触发面、聚焦/E1/E2/E4 UI 断言；4 文档过期已回填）；5 项已知偏差全部 acceptable（后退前进占位 / 沉底恒 attach / 截图顶挂一帧 / i18n 混排 / navigated 双峰）
- 对齐代理发现的重要实证：E2E 曾暴露 `getWindow` 从未接线（视图从未真正 attach）——纯 node 测试与 DOM 断言都照不出，只有真实 E2E 可见
- 留 /reflect 观察项：backgroundThrottling:false 隐藏态持续合成开销；`cookie-updated` 事件在接口 5 表中但 manager 未发射且无 REQ 锚定（spec-gap 观察，/reflect 决定补发射或删行）

### PRD→代码 可追溯性表

- 实现 commit：`e5f05e2`（[build]，仅 src/：BrowserPanel + browserPanelStore + preload `window.opc.browser*` + main.js IPC handlers + MdLink 链接集成 + i18n 18 键 + manager 修复 did-fail-load 后误报 navigated 的潜伏 bug）
- 测试落地 commit：`a401a59`（[test]，E2E skip 全移除 + stub 页扩展）
- E2E 首轮：**7/10 通过**，3 红归因 2 个实现缺陷（fix 子代理处理中）：
  1. **事件就绪竞态**：`opc-browser-event` 在渲染进程订阅前发送被静默丢弃（panel-request-open 丢失 → 流程 B/C 红）
  2. **收起态截图 0×0**：visible=false 视图 detach 后 capturePage 返空（违反可见性解耦契约）
- 单元回归：1118/1118；lint 0 errors
- 冒烟（实现侧自建）：真实 Electron 15/15 PASS

### PRD→代码 可追溯性表

| PRD 意图 | 实现 | 测试 | 状态 |
|---|---|---|---|
| 流程A 初始收起/展开/聚焦/保活 | browserPanelStore + BrowserPanel | E2E 流程A×3（绿） | COVERED |
| §6.3 块1 协议补全回显 / 白名单 / 错误页 | omnibox + main normalize | E2E 流程A（绿） | COVERED |
| §6.3 块1 弹窗拦截（面板内导航、无新窗口） | setWindowOpenHandler + _testClick seam | E2E 弹窗拦截（绿） | COVERED |
| 流程B agent expand 自动展开 + 控制指示 | panel-request-open 事件 + expandPending 对账 | E2E 流程B（绿） | COVERED |
| 流程C 停止控制按钮 | opc.browser.stopAgentControl IPC | E2E 流程C（绿） | COVERED |
| REQ-004 链接点击面板打开 | MdLink → openBrowserPanelWithUrl | E2E REQ-004（绿，FAUX 回声） | COVERED |
| REQ-004 AC2 右键菜单双入口 / AC3 mailto 不拦截 | MdLink 关联菜单 + HTTP_LINK_RE | E2E AC2/AC3（绿） | COVERED |
| §10.4 接口2 read 结构/截断（真实 DOM） | buildReadScript | E2E（绿） | COVERED |
| §10.4 接口3 scroll / screenshot（收起态顶挂） | manager scroll/screenshot | E2E（绿） | COVERED |
| E1 内联提示 / E2 错误页 / E4 崩溃页 | omnibox-hint / nav-error-page / crash-page | E2E（绿） | COVERED |
| §6.3 块1 window.open 第二触发面 | setWindowOpenHandler | E2E（绿） | COVERED |
| UX 原型偏差 | 后退/前进 disabled 占位；指示条无工具名后缀；错误页时 bounds visible=false | — | 已记录（对齐判定 acceptable） |

