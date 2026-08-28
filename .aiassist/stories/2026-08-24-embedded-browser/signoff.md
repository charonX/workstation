# 签核记录 — 内置浏览器面板与 agent 受控浏览器（预览/读取）

> 故事 ID：`2026-08-24-embedded-browser`
> 生成日期：2026-08-28
> 签核方式：`auto`（AI 全量自检）

本文件由 `/signoff` 维护，记录 **Assertion 阶段**的签核结果。签核默认由 AI 全量自检完成，仅在升级点（初衷漂移 / 契约歧义 / expected 推导不出 / 安全边界 / 范围决策）停下由人确认。

---

## Assertion 阶段

### 签核声明

- **signer**：`AI`（auto）——无升级点命中，零打断签核。
- 本 story 所有 REQ 的 expected 值均 trace 到 PRD 锚点（§6.3 / §7 / §8 / §10.4），并逐条交叉验证锚点真实存在且值一致。**绝非**从当前代码输出抄写。
- 骨架说明：当前测试为**业务测试骨架**（SKELETON）——`skeletonPending()` / `test.skip` 占位标注实现依赖；expected 值已全部锁定于断言内，/implementer 落地实现时将骨架替换为真实断言（对契约只读）。expected 值锁定不受骨架状态影响。

| REQ-ID | 断言内容摘要 | expected 值 trace | 测试位置 |
|---|---|---|---|
| REQ-BROWSER-001 | 协议补全（example.com→https、localhost→http）；白名单拒绝 file://、javascript:（E-BROWSER-BAD-URL）；空/无主机拒绝；ERR_CONNECTION_REFUSED 透传；启动后面板收起；state 字段齐备 | `prd.md` §6.3 块1 rows 1-4、§7 row1、§8-E2、§10.4 接口1/3 样例 | `tests/capabilities/embedded-browser/browser-panel/2026-08-24-embedded-browser/api/browserApi.test.js`（6 例）+ `.../e2e/browserPanel.test.cjs`（流程A 3 例） |
| REQ-BROWSER-002 | TOOL_DEFS 四命令 riskLevel=query；navigate 回执 {ok,url,title}；read elements 结构（tag/text/selector/rect）；截断 4000/50 + truncated；E-BROWSER-NOT-READY；scroll/screenshot golden；expand 事件 | `prd.md` §6.3 块2 rows 5-6、§8-E3、§10.4 接口2/3 样例、§10.3 副作用 | `tests/capabilities/embedded-browser/browser-tools/2026-08-24-embedded-browser/api/browserTools.test.js`（9 例） |
| REQ-BROWSER-003 | 停止控制后全工具 E-BROWSER-DENIED 且页面不变；手动导航解除；收起不断连（visible=false 下 read ok）；state.agentControlRevoked 状态机 | `prd.md` §6.3 块3 rows 3-4、§6.1 流程C、§8-E5、§10.4 接口1/3/5 | `.../api/browserApi.test.js`（4 例）+ E2E 流程B/C（2 例） |
| REQ-BROWSER-004 | 聊天链接点击 → 面板打开加载目标 URL；系统浏览器入口；mailto 不走面板 | `prd.md` §6.3 块4 row1、§10.2 | `.../e2e/browserPanel.test.cjs`（1 例，链接集成） |
| REQ-BROWSER-005 | cookies 空态 {cookieString:"",cookies:[]}；已种读取（cookieString 明文 + 七字段）；单名过滤；E-BROWSER-BAD-DOMAIN（空/无前导点）；DELETE 12→0 幂等；无实例可读；日志脱敏（禁明文值） | `prd.md` §6.3 块5 rows 1-5、§7.1 row2、§8-E7、§10.4 接口4 全部样例 | `.../api/browserApi.test.js`（7 例） |
| REQ-BROWSER-006 | auth-check 已登录 {authenticated:true}；未登录 {authenticated:false,missing:[...]}（非错误）；空名单语义；BAD-DOMAIN 透传；riskLevel=query | `prd.md` §6.3 块5 row2、§7.1 row3、§8-E7/E8、§10.4 接口6 | `.../api/browserTools.test.js`（4 例）+ 声明 1 例 |

### capability/entity 覆盖摘要

- capability：`embedded-browser`（新登记于 business-capabilities.md，2026-08-28）
- entity：`browser-panel`（REQ-001/003/004/005）、`browser-tools`（REQ-002/006）——与 business-capabilities.md 表格一致。

### 升级点记录

| 升级点 | 触发原因 | 人确认结果 | 是否已解决 |
|---|---|---|---|
| （无） | — | — | — |

### 检查清单

**A. AI 全量自检（默认执行）**

- [x] 每个 REQ-ID 都有对应测试（6/6；REQ-004 归 E2E 链接集成用例）。
- [x] 每个测试文件都有 `// REQ-TRACE`、`// REQ-VERSION`（v1-hash:28b4d678…）、`// CAPABILITY-TRACE`、`// ENTITY-TRACE`、`// EXPECTED-TRACE`。
- [x] 每条 `// EXPECTED-TRACE` 锚点真实存在于 `prd.md` 且值一致（交叉验证：§6.3 块1-5 全部行、§7 两条、§7.1 三条、§8-E2/E3/E5/E7/E8、§10.3 副作用、§10.4 接口1/2/3/4/6 样例——逐一核对通过；golden 值与 REQ 断言字面一致，含 4000/50 截断、`deletedCount:12→0`、`missing:["SESSDATA"]`、ERR_CONNECTION_REFUSED）。
- [x] 无 `// TODO: HUMAN ASSERTION` 占位。
- [x] 无 snapshot 当测试预言。
- [x] 边界/错误场景已覆盖（白名单/空输入/无主机/连接失败/未就绪/停止控制/BAD-DOMAIN/幂等删/日志脱敏）。
- [x] capability/entity 与 business-capabilities.md 一致。

**B. 升级点检查（按需，命中才停下问人）**

- [x] 初衷锚定：PRD §1（闭环打断 + agent 无可视化浏览器）与 story intention 一致；2026-08-28 增补稳定块 5（登录态/Cookie 桥接）为痛点同一主线的自然延伸（同一浏览器实例的价值扩展），未漂移；click/type 砍除是范围收敛非初衷变更。
- [x] 跨模块契约（§10.4 接口1-6）可从 PRD 锚点确认，golden values 齐备，无歧义。
- [x] expected 值 trace 全部成功，无"从代码抄 expected"风险（代码尚不存在，锚点全部来自 PRD）。
- [x] 安全边界已确认：Cookie 明文导出为本 story 最大新增信任面——威胁建模已写入 PRD §10.7（明文只走 ADR-001 本地回执、日志/工具折叠块脱敏收口、DELETE 域级审计、persist 分区隔离、无 preload）并落入 REQ-BROWSER-005 标准 7 日志脱敏断言。用户已在 2026-08-28 增补时确认该边界（ADR-039 决策 7/8 人签）。
- [x] PRD §14 全部 PASS 无悬空 GAP；click/type 范围外归类为 2026-08-26 人裁决（非本次静默带入）。

> BUILD 完成后，将复查 `build-progress.md` 中的 PRD-to-code 可追溯性声明。

⏸ **BUILD 阶段在 `[test] assertion-signoff for 2026-08-24-embedded-browser` commit 前不得开始。**
