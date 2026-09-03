# QA 报告 — 2026-08-24-embedded-browser

## 概要
- **故事 ID**：`2026-08-24-embedded-browser`
- **功能目标**：内置浏览器面板与 agent 受控浏览器（预览/读取）
- **QA 结果**：**PASS**（全量单元 1197/1197 绿、Story E2E 21/21 绿、0 open bug）
- **最后验证时间**：2026-09-03

---

## 单元与集成测试
- **结果**：**PASS**
- **执行命令**：`npm run test:unit`
- **统计数据**：**1197 passed / 0 failed** (291 suites)
- **专题测试套件**：
  - `browserApi.test.js`：**17 passed / 0 failed**
    - 协议补全（example.com → https, localhost → http）、白名单拒绝（file://, javascript:）、空输入与无主机
    - 导航失败 Chromium 错误码透传（ERR_CONNECTION_REFUSED）
    - 状态机契约（open 初始收起、state 七字段）
    - 停止控制状态机（agentControlRevoked、全工具 E-BROWSER-DENIED、手动导航解除、可见性解耦）
    - Cookies 接口契约（空态、读取、单名过滤、BAD-DOMAIN、幂等清理、无实例保活）
    - 安全门卫（Loopback Host 校验、跨源 Origin/Sec-Fetch-Site 阻断、无 ACAO）
  - `browserTools.test.js`：**10 passed / 0 failed**
    - TOOL_DEFS riskLevel=query 声明
    - navigate / read / scroll / screenshot 回执
    - auth-check 判定逻辑与空名单语义
  - `mdLinkDispatch.test.js`：**3 passed / 0 failed**
    - 聊天 Markdown 链接分发（http/https 走面板、mailto 放行、外部打开）
  - `serverDiscovery.test.js`（BUG-001 回归套件）：**6 passed / 0 failed**
    - 机器级注册表锚点固定（`~/.opc-workstation/server.json` 与 configDir 解耦）
    - app 固定以 owner="app" 注册
    - discoverServer 优先匹配 owner="app"
    - 重启保端口只匹配 owner="app"
    - E2E userData/server.json 纯 fixture 隔离

---

## E2E / 自动化验收测试
- **结果**：**PASS**
- **执行命令**：`npm run rebuild:electron && npx playwright test tests/capabilities/embedded-browser/browser-panel/2026-08-24-embedded-browser/e2e/browserPanel.test.cjs`
- **详细用例结果**（**21 passed / 0 failed**，耗时 45.0s）：
  - ✔ 流程A：面板初始收起 → 点击浏览器按钮展开 → 地址栏导航补全协议 (3.4s)
  - ✔ 流程A 回归：先展开面板后首次导航，原生视图 bounds 非零（白屏回归，commit a1b33a0） (1.8s)
  - ✔ 流程A 回归：收起面板后原生视图不在窗内绘制，不遮挡主 UI（覆盖回归，commit 307bffb） (1.7s)
  - ✔ 流程A：收起面板后重新展开，地址栏保留原 URL（实例保活） (1.7s)
  - ✔ 流程A：target=_blank 链接在面板内导航，主窗口不跳转 (1.7s)
  - ✔ 流程A：window.open() 同样被拦截转面板内导航（REQ-001 AC5 第二触发面） (1.7s)
  - ✔ 流程A：面板展开后地址栏聚焦（REQ-001 AC6 步骤1） (1.5s)
  - ✔ E1：地址栏输入 javascript: 协议 → 内联提示且不导航 (1.6s)
  - ✔ E2：导航失败显示错误页含 ERR 码与重试按钮 (1.8s)
  - ✔ E4：渲染进程崩溃后面板显示崩溃页与重新加载按钮 (1.7s)
  - ✔ 流程B：agent navigate --expand 后面板自动展开并显示控制指示 (1.6s)
  - ✔ 流程C：点击停止控制后指示消失，页面保持 (1.6s)
  - ✔ 流程D：未登录域 auth-check=false → agent navigate --expand → 面板展开加载登录页（REQ-006 AC6） (1.5s)
  - ✔ REQ-004：聊天消息 http(s) 链接点击后面板打开并加载目标 URL (3.2s)
  - ✔ REQ-004 AC2：右键链接出现关联菜单，含「在面板中打开」与「在系统浏览器打开」两个入口 (3.3s)
  - ✔ REQ-004 AC3：mailto: 链接不拦截（保持默认锚点，无 md-link-wrap，点击不开面板） (3.2s)
  - ✔ REQ-BROWSER-002 read 快照结构：elements 含 tag/text/selector/rect (1.4s)
  - ✔ REQ-BROWSER-002 read 截断：>50 可交互元素截断至 50 且 truncated=true（AC4 元素半支） (1.4s)
  - ✔ REQ-BROWSER-002 read 截断：正文 >4000 字符截断且 truncated=true (1.4s)
  - ✔ REQ-BROWSER-002 scroll 回执：{ok:true, scrollX, scrollY} (1.5s)
  - ✔ REQ-BROWSER-002 screenshot 回执与落盘：PNG 文件存在且 n 递增 (5.7s)

---

## 需求项验证矩阵

| REQ ID | 需求描述 | 关键验收锚点 | 测试覆盖 | 验证结果 |
|---|---|---|---|---|
| **REQ-BROWSER-001** | 浏览器面板骨架与手动导航 | §6.3 块1/§7/§8-E2/§10.4 接口1、4（白名单/协议补全/错误透传/弹窗拦截/展开收起保活/崩溃态拒绝） | 集成 (`browserApi.test.js`) + E2E 流程A/E1/E2/E4 | **PASS** |
| **REQ-BROWSER-002** | agent 浏览器读取工具集 | §6.3 块2/§8-E3/§10.4 接口2、3（riskLevel=query/navigate回执/read截断4000与50/scroll/screenshot续号） | 单元 (`browserTools.test.js`) + E2E 快照/截断/截图 | **PASS** |
| **REQ-BROWSER-003** | 人机共驾控制权与一键停止控制 | §6.3 块3/§6.1 流程C/§8-E5/§10.4 接口1、3、5（revoked全拒绝/手动导航解除/可见性解耦/状态机） | 集成 (`browserApi.test.js`) + E2E 流程B/C | **PASS** |
| **REQ-BROWSER-004** | 聊天链接分发与系统浏览器入口 | §6.3 块4/§10.2（消息链接面板打开/右键双入口/mailto放行） | 组件 (`mdLinkDispatch.test.js`) + E2E 链接用例 | **PASS** |
| **REQ-BROWSER-005** | 登录态持久化与 Cookie 受控导出清理 | §6.3 块5/§7.1/§8-E7/§10.4 接口4（persist分区/导出过滤/BAD-DOMAIN/幂等删/安全守卫） | 集成 (`browserApi.test.js`) | **PASS** |
| **REQ-BROWSER-006** | 登录态检测与人机协同登录引导 | §6.3 块5/§7.1/§8-E7、E8/§10.4 接口6（auth-check判定/空名单正半支/流程D引导） | 单元 (`browserTools.test.js`) + E2E 流程D | **PASS** |
| **REQ-BROWSER-007** | server 发现通道（机器级注册表锚点） | ADR-0040 决策 1-4（机器级 server.json/app 固定 owner/精确匹配/重启保端口） | 单元/集成 (`serverDiscovery.test.js`) | **PASS** |

---

## 运行时浏览器验证
- **状态**：**PASS**
- **摘要**：在 Playwright Electron 真实环境下驱动 Chromium 实例完成 DOM 结构、原生视图 bounds 贴合、CSS 样式、协议过滤、弹窗拦截与 Cookie 隔离完整链路，无未捕获异常。
