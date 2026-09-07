# 签核记录 — 2026-09-07-mcp-sse-transport

## Assertion（门 1：断言签核）

- 日期：2026-09-07
- signer：**AI**（auto 签核，无升级点；规格锚点由人定——PRD 方向与范围决策均经需求洞察访谈逐项人确认：type 三选形态、探测同修、UI 本期、http 不回落、WS 出范围）
- REQ 版本：v1（hash `9f20ee0db8e336cc1980dc6d6570aef6dcfb5e8fc0c592387ce1c6f12723465f`）

### REQ-ID 列表与测试覆盖

| REQ-ID | capability / entity | 测试文件 | 状态 |
|---|---|---|---|
| REQ-MCP-SSE-001 | plugin-management / mcp-server | `api/mcpSseRegister.test.js`（9 用例） | ✅ |
| REQ-MCP-SSE-002 | plugin-management / mcp-server | `api/mcpSseBridge.test.js`（6 用例） | ✅ |
| REQ-MCP-SSE-003 | plugin-management / mcp-server | `api/mcpSseProbe.test.js`（4 用例） | ✅ |
| REQ-MCP-SSE-004 | plugin-management / mcp-server | `e2e/mcpSsePage.test.cjs`（4 用例） | ✅ |

capability/entity 与 `business-capabilities.md` 一致（`plugin-management` / `mcp-server`，测试目录追加 `2026-09-07-mcp-sse-transport/{api,e2e}`，已登记）。

### AI 全量自检结果

- [x] 每个 REQ-ID 至少一个自动化测试（4/4）；无 `人工(仅视觉)` REQ。
- [x] 4 个测试文件头部要素齐全（`REQ-TRACE`/`REQ-VERSION`/`CAPABILITY-TRACE`/`ENTITY-TRACE`/`EXPECTED-TRACE`/`TEST-AUTHOR`/`ASSERTIONS-SIGNED`），`REQ-VERSION` 与 `requirements-v1.hash` 逐字一致。
- [x] 无 `// TODO: HUMAN ASSERTION` 占位；无快照当判定依据。
- [x] 边界/错误 case 覆盖：非法 type（ws）、非法协议（ftp）、空 url、bearer 缺 token、非法 auth、非法 headers KEY、探测已关闭端口、仅全局未项目启用、http 探测回归、stdio 快照无 httpTransport 回归、UI stdio 切换回归。
- [x] 测试可执行性：全部通过 `node --check`；api 19 用例已实跑，RED 基线 17 fail / 2 pass（2 个 pass 均为回归守卫：bridge 标准 3 stdio 无 httpTransport 键、probe 标准 5 既有 http 探测——今日即成立，防实现误改）。
- [x] 新增 fixture `tests/fixtures/mcp-sse-server/server.mjs` 为测试基础设施（手写最小 legacy SSE 协议，对齐既有 mcp-stdio/mcp-http fixture 先例），非实现代码。

### expected 值交叉验证（全量核对）

| 断言 expected | 测试落点 | PRD 锚点（已核对存在且值一致） |
|---|---|---|
| create sse+bearer → `type:"sse"`、url 原样、`auth:"bearer"`；list 同值 | `mcpSseRegister` 标准 1 | PRD §6.3 块 1 row 1 |
| 响应/list 不含 `ck-test` 明文 | `mcpSseRegister` 标准 2 | PRD §6.3 块 1 row 1, 全局约束 |
| `ftp://…` → `URL 不合法: 仅支持 http/https`（恰等） | `mcpSseRegister` 标准 3 | PRD §6.3 块 1 row 2, §7 |
| 空 url → `URL 不合法: url is required`（恰等） | `mcpSseRegister` 标准 4 | PRD §7 url 行（签核时就地补全 PRD 完整字面量） |
| `type:"ws"` → `type 不合法: 仅支持 stdio/http/sse`（恰等） | `mcpSseRegister` 标准 5 | PRD §6.3 块 1 row 3, §7 |
| bearer 无 token → `auth=bearer 必须提供 token（加密存系统凭据库）`（恰等） | `mcpSseRegister` 标准 6 | PRD §7 token 行 |
| `auth:"basic"` → `auth 不合法: 仅支持 none/bearer/oauth`（恰等） | `mcpSseRegister` 标准 7 | PRD §7 auth 行 |
| update 仅改 url → 快照 `bearerToken:"ck-test"` 保留 | `mcpSseRegister` 标准 8 | PRD §7.1 行 2 |
| headers 合法存取 / 非法含 `KEY` 报错 | `mcpSseRegister` 标准 9 | PRD §7 headers 行 |
| sse 快照深等于 `{url, auth:"bearer", bearerToken:"ck-test", httpTransport:"sse"}` | `mcpSseBridge` 标准 1 | PRD §6.3 块 2 row 1 |
| http 快照含 `httpTransport:"streamable-http"` | `mcpSseBridge` 标准 2 | PRD §6.3 块 2 row 2（稳定块 5） |
| stdio 快照无 `httpTransport` 键 | `mcpSseBridge` 标准 3 | PRD §6.3 块 2 row 3 |
| sse+headers 快照 headers 原样 + `httpTransport:"sse"` | `mcpSseBridge` 标准 4 | PRD §6.3 块 2 row 1 扩展 |
| 未项目启用不进快照 | `mcpSseBridge` 标准 5 | 全局约束「两层启用模型不变」 |
| 快照 `bearerToken` = 明文；DB `token_enc` ≠ 明文 | `mcpSseBridge` 标准 6 | 全局约束「凭据安全不变」 |
| 探测 legacy-only SSE stub → tools 含 `echo` 且 description 非空 | `mcpSseProbe` 标准 1+2 | PRD §6.3 块 3 row 1（description 具体值由 fixture 自定，断言其非空——对齐 mcpProbeTools.test.js 先例，非产品契约值） |
| 探测已关闭端口 → 消息以 `连接失败：` 开头 | `mcpSseProbe` 标准 3 | PRD §6.3 块 3 row 2, §8 |
| sse+bearer 探测 → stub 收到 `Authorization: Bearer probe-sse-token` | `mcpSseProbe` 标准 4 | PRD §10.3 步骤 5, 全局约束 |
| http 探测既有 streamable fixture 回归 | `mcpSseProbe` 标准 5 | PRD §8 回归面 |
| seg 三选含 `[data-type='sse']`；sse 隐藏 command/args/env、显示 url/auth | `mcpSsePage` 用例 1-2 | PRD §6.3 块 4 row 1, §6.1 步骤 1 |
| 提交后列表行 badge=`sse`、API 回读 `type:"sse"`、页面不回显 token | `mcpSsePage` 用例 3 | PRD §6.3 块 4 row 1-2, §6.1 步骤 2 |
| 编辑回显：seg 激活 sse、url 回填 | `mcpSsePage` 用例 4 | PRD §6.3 块 4 row 2 |

签核交叉验证中就地补全（AI 自决，非升级点）：PRD §7/§6.2 空 url 错误消息补全为完整字面量 `URL 不合法: url is required`；探测用例的 echo description 由"恰等 fixture 文案"修正为"非空"（fixture 自定值非 PRD 锚点，避免过度断言）。

### 升级点检查

- **初衷漂移**：story `intention`（SSE 端点无法显式配置、探测假阴性、接入不可预期）↔ PRD §1 ↔ 4 条 REQ 完全一致，无漂移。
- **跨模块契约歧义**：REQ-MCP-SSE-002 契约（§10.4 effectiveConfig）锚点齐全；adapter 侧 `httpTransport` 消费契约已读源码核实（`pi-mcp-adapter/types.ts:405` 枚举含 `"sse"`；`server-manager.ts:793/814` 声明后不回落），无歧义。
- **expected trace 失败**：无（全部 trace 到 PRD §6.3/§7/§10.4/全局约束）。
- **安全边界**：无新信任边界——bearer 加密存储、快照唯一解密点、URL 协议白名单均复用既有契约（BUG-006/ADR 体系），sse 同构。
- **范围决策**：WS 出范围、http 取消回落，均为访谈中用户逐项拍板（非 AI 自决）；PRD §14 自检查全 PASS，无悬空 GAP。

**结论：无升级项，AI 全量自检通过，断言签核锁定。BUILD 解锁。**

---

## Assertion v1.1 补记（2026-09-07，review 后）

- **范围扩张追认**：BUILD 阶段的 crawl4ai CLI 移除（commit `9682aac`/`0c69a02`）未经本签核授权，review code-F1 检出后由人裁决**确认**（见 `review.md` 审查人决策记录）；意图真值补记于 ADR-043 修订记录与本 story PRD §13/v0.2。本 story 已签核的 4 条 REQ 与 expected 锚点**不受影响**，requirements v1 哈希不变。
- **测试补强（test-F1/F2/F3 修复）**：`mcpSsePage.test.cjs` 用例 3 补 POST 请求体拦截断言（`type:"sse"` 且不含 command/args/env 键，REQ-004 AC3 落点闭合）；用例 2 补 `mcp-headers-input` 可见性断言；`mcpSseProbe.test.js` 补标准 5b stdio 探测回归（REQ-003 AC5 完整化）。均为对既签 AC 的断言补强，未改动任何 expected 值。
- **挂账**：PRD §11.1 块 4 seam 实际落地为 Electron 真实后端 E2E（高于计划的 stub API 组件测试，置信度更高），已在 review.md 记录。
- **遗留（非阻塞，后续 story/bug 收口）**：security-F1（bearer 时拒绝大小写变体 `authorization` 用户 header）、F2（probeTools 解密纳入 try / effectiveConfig 单 key fail-closed）、F3（URL userinfo 拦截）。
