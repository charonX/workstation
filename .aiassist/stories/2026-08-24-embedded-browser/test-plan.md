# Test Plan — 内置浏览器面板与 agent 受控浏览器（预览/读取）

> 故事 ID：`2026-08-24-embedded-browser`
> 生成：2026-08-28（/test-author 自动链）
> 来源：`requirements.md` v2（REQ-BROWSER-001~006，2026-08-30 errata）、`prd.md` v0.4 §6/§7/§8/§10.4、`ux/browser-panel.html`
> 骨架状态：**已落地**——骨架哨兵与 E2E skip 已全部移除（Slice 1-3，2026-08-30）；review 增补用例（组件 `/many` 流程D 访问控制 续号）由 2026-08-30 review 修复轮补齐。

---

## Seam 映射（capability=embedded-browser）

| REQ-ID | entity | Seam | 测试文件 | 用例数 | 状态 |
|---|---|---|---|---|---|
| REQ-BROWSER-001 | browser-panel | API（/api/browser/navigate、state） | `tests/capabilities/embedded-browser/browser-panel/2026-08-24-embedded-browser/api/browserApi.test.js` | 6 | 骨架（skeletonPending） |
| REQ-BROWSER-003 | browser-panel | API（control/bounds/read/state 状态机 + source 通道决定 AC7） | 同上 | 4 + 1（v2 新增 AC7：HTTP 伪造 source:user 仍 DENIED） | 骨架 |
| REQ-BROWSER-005 | browser-panel | API（cookies GET/DELETE + 日志脱敏 + 访问控制 AC8） | 同上 | 7 + 1（v2 新增 AC8：Host/Origin/Sec-Fetch-Site 校验 + 无 ACAO） | 骨架（空态/无实例/BAD-DOMAIN 三例已可真跑） |
| REQ-BROWSER-002 | browser-tools | CLI 声明（TOOL_DEFS）+ API 回执（含 AC9 截图跨会话续号） | `tests/capabilities/embedded-browser/browser-tools/2026-08-24-embedded-browser/api/browserTools.test.js` | 2 + 7 + 1（v2 新增 AC9：预置 browser-shots 后重启 server 续号） | 声明两例真跑（待实现后随契约翻转）；回执七例骨架 |
| REQ-BROWSER-006 | browser-tools | CLI（auth-check）+ API | 同上 | 4 | 骨架 |
| REQ-BROWSER-004 | browser-panel | 组件（MarkdownRenderer 链接点击） | `tests/capabilities/embedded-browser/browser-panel/2026-08-24-embedded-browser/component/`（计划补：mock preload 断言 `opc.openExternal` 调用参数 + `mailto:` 不拦截不触发面板 navigate） | 2 | 留白待补（review 阻塞项：AC2/AC3 行为断言） |
| REQ-BROWSER-001/002/003/004/006 | browser-panel | E2E（Electron + WebContentsView；含 REQ-001 AC8 崩溃态 dev-only 注入 seam） | `tests/capabilities/embedded-browser/browser-panel/2026-08-24-embedded-browser/e2e/browserPanel.test.cjs` | 7 + 1（v2 新增 AC8：崩溃注入 → E-BROWSER-CRASHED） | skip 占位（流程A×3、弹窗拦截、流程B、流程C、链接集成） |

## HTML 原型映射（ux/browser-panel.html → 自动化）

| 原型结构/行为 | 映射测试 | REQ |
|---|---|---|
| 面板 chrome（open-browser 按钮 / browser-panel / omnibox） | E2E 流程A 展开/收起/地址栏保留 | 001 |
| agent 控制指示条（agent-control-bar / stop-agent-control） | E2E 流程B/C | 003 |
| 收起状态（面板 hidden、重开展示原 URL） | E2E 流程A 步骤5 | 001/003 |
| 崩溃页/重载（crash-page / crash-reload） | E2E 崩溃注入 seam（REQ-001 v2 AC8：dev-only 崩溃注入 → 工具返回 E-BROWSER-CRASHED + 面板崩溃页） | 001（§8-E4） |
| 错误页重试（nav-error-page） | E2E 由集成层 ERR_CONNECTION_REFUSED 断言覆盖（E2E 不重复） | 001 |

## REFLECT 人工验收（纯审美，不自动化）

- 面板 chrome 视觉密度与对齐（对照 `ux/browser-panel.html`）
- 地址栏聚焦环 / agent 指示条配色（info-soft）具体观感
- 确认态、错误页文案语气

## 留白与风险

1. **Cookie 种入 seam**：REQ-BROWSER-005/006 需要向 persist:browser 分区种入测试 Cookie。实现需提供测试 seam（推荐：dev-only HTTP 端点 `POST /api/browser/_test/seed-cookies`，或经 electron session 直接 set——E2E 可走后者）。骨架中 `seedCookie = skeletonPending()` 占位。
2. **WebContentsView 点击驱动**：E2E 弹窗拦截用例需在 WebContentsView 内执行真实点击。Electron `_electron` API 可 `webContentsView.webContents.executeJavaScript` 触发，或由实现暴露调试 seam——实现期定。
3. **崩溃注入（§8-E4）**：`webContents.forcefullyCrashRenderer()` 可注入，但会让 stub 会话不稳定；实现期评估是否纳入 E2E（集成层以 CRASHED 错误码断言兜底）。（2026-08-30 更新：dev-only 崩溃注入 seam 已建，REQ-001 v2 AC8 锚定 E2E 覆盖。）
4. **expected 值全部 trace 到 prd.md §6.3/§7/§8/§10.4**：无 `TODO: HUMAN ASSERTION` 占位；无升级点。
5. **`/many` stub 页（REQ-002 AC4 截断半支，review 重要项）**：>50 个可交互元素的 stub 路由（`/many`），断言 `elements.length === 50 && truncated:true`；4000 字符分支已有 `/long`。/test-author 补。
6. **流程 D E2E（REQ-006 AC6，review 重要项）**：auth-check=false → agent `navigate --expand` → 面板展开且加载登录页 URL；用户登录动作以 stub Cookie 种入替代。注意消除 E2E 文件头 REQ-TRACE 声明 REQ-006 但无用例的虚假追溯。
7. **截图跨会话续号断言方式（REQ-002 v2 AC9）**：测试预置 `<configDir>/browser-shots/browser-1.png`、`browser-2.png`（含已知内容），以同一 configDir 重启 server（或新 server 实例）后调 `browser screenshot`，断言返回 `browser-3.png` 且既有两文件内容不变。
