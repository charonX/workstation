# Test Plan — 内置浏览器面板与 agent 受控浏览器（预览/读取）

> 故事 ID：`2026-08-24-embedded-browser`
> 生成：2026-08-28（/test-author 自动链）
> 来源：`requirements.md` v2（REQ-BROWSER-001~006，2026-08-30 errata）、`prd.md` v0.4 §6/§7/§8/§10.4、`ux/browser-panel.html`
> 骨架状态：**已落地**——骨架哨兵与 E2E skip 已全部移除（Slice 1-3，2026-08-30）；review 增补用例（组件 `/many` 流程D 访问控制 续号）由 2026-08-30 review 修复轮补齐。

---

## Seam 映射（capability=embedded-browser）

| REQ-ID | entity | Seam | 测试文件 | 用例数 | 状态 |
|---|---|---|---|---|---|
| REQ-BROWSER-001 | browser-panel | API（/api/browser/navigate、state） | `tests/capabilities/embedded-browser/browser-panel/2026-08-24-embedded-browser/api/browserApi.test.js` | 6 | 已落地（Slice 1） |
| REQ-BROWSER-003 | browser-panel | API（control/bounds/read/state 状态机 + source 通道决定 AC7） | 同上 | 4 + 1（v2 AC7 已测：HTTP 伪造 source:user 仍 DENIED） | 已落地（Slice 1 + review 轮） |
| REQ-BROWSER-005 | browser-panel | API（cookies GET/DELETE + 日志脱敏 + 访问控制 AC8） | 同上 | 7 + 4（v2 AC8 已测：伪造 Host/跨源 Origin/Sec-Fetch-Site→403、CLI 形态→200 无 ACAO） | 已落地（Slice 1 + review 轮） |
| REQ-BROWSER-002 | browser-tools | CLI 声明（TOOL_DEFS）+ API 回执（含 AC9 截图跨会话续号） | `tests/capabilities/embedded-browser/browser-tools/2026-08-24-embedded-browser/api/browserTools.test.js` | 2 + 7 + 1（v2 AC9 已测：预置 browser-7.png → 续号 8/9 不覆盖） | 已落地（Slice 2 + review 轮） |
| REQ-BROWSER-006 | browser-tools | CLI（auth-check）+ API | 同上 | 4 | 已落地（Slice 2） |
| REQ-BROWSER-004 | browser-panel | 组件（mdLinkDispatch 纯模块，mock 桥函数断言） | `tests/capabilities/embedded-browser/browser-panel/2026-08-24-embedded-browser/component/mdLinkDispatch.test.js` | 3 | 已落地（review 轮：openExternal 参数断言 + mailto passthrough） |
| REQ-BROWSER-001/002/003/004/006 | browser-panel | E2E（Electron + WebContentsView；含 REQ-001 AC8 崩溃态 dev-only 注入 seam） | `tests/capabilities/embedded-browser/browser-panel/2026-08-24-embedded-browser/e2e/browserPanel.test.cjs` | 19（流程A/B/C/D、弹窗拦截、链接集成、错误/崩溃页、/many 截断、AC8 崩溃注入） | 已落地（Slice 3 + review 轮） |

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

1. ~~Cookie 种入 seam~~：已落地（dev-only `POST /api/browser/_test/seed-cookies`，NODE_ENV=test 门控；E2E 经 session 直种）。
2. ~~WebContentsView 点击驱动~~：已落地（dev-only `_testClick` seam，main.js development 门控）。
3. **崩溃注入（§8-E4）**：`webContents.forcefullyCrashRenderer()` 可注入，但会让 stub 会话不稳定；实现期评估是否纳入 E2E（集成层以 CRASHED 错误码断言兜底）。（2026-08-30 更新：dev-only 崩溃注入 seam 已建，REQ-001 v2 AC8 锚定 E2E 覆盖。）
4. **expected 值全部 trace 到 prd.md §6.3/§7/§8/§10.4**：无 `TODO: HUMAN ASSERTION` 占位；无升级点。
5. ~~`/many` stub 页~~：已落地（review 轮，60 个 `<a>` stub + `elements.length===50 && truncated:true` 断言；暴露并修复了注入脚本恰收 50 致 truncated 永假的 code-defect）。
6. ~~流程 D E2E~~：已落地（review 轮：auth-check=false → navigate --expand → 面板展开加载登录页；REQ-006 头部追溯名实相符）。
7. ~~截图跨会话续号断言方式~~：已落地（review 轮：预置 browser-7.png → 续号 8/9、既有文件字节不变）。
