# Review 报告 — MCP 注册原生支持 SSE transport / prd+tech+req+test+code+security

> 故事 ID：`2026-09-07-mcp-sse-transport`
> 审查层：`prd, tech, req, test, code` + 条件派发 `security`（PRD §10.7 涉 token 解密信任边界）
> 模式：`panel`（6 specialist 并行）
> 日期：2026-09-07

---

## 审查摘要

- **总体结果**：**FAIL**
- **阻塞项数量**：2（code-F1 范围纪律；test-F1 显式 AC 断言空洞）
- **警告项数量**：4（IMPORTANT：security-F1、tech-F1、test-F2、code-F2 随 code-F1 联动）

---

## 分层发现（panel 模式）

| 层 | 子代理 | 严重 | 重要 | 建议 | 结论 |
|---|---|---|---|---|---|
| prd | prd-reviewer | 0 | 0 | 3 | PASS |
| tech | tech-reviewer | 0 | 1 | 4 | PASS |
| req | req-reviewer | 0 | 0 | 4 | PASS |
| test | test-engineer | 0 | 2 | 7 | **WARN** |
| code | code-reviewer | 1 | 1 | 3 | **FAIL** |
| security | security-auditor | 0 | 1 | 3 | PASS |

### 关键发现（按层）

- [ ] **CRITICAL: 未经签核的范围扩张 + 改写已完成 story 的锁定断言**（code-reviewer，commit `9682aac` + `0c69a02`）
  - 问题：BUILD 阶段移除 crawl4ai CLI 支持（cliRegistry/policyRules/skillService/CliServices UI/builtin skill）并改写了已完成 story 2026-09-06-cli-service-connection 的已签核断言（清单 3→2、删 crawl4ai 用例）。本 story 已签核范围（REQ-MCP-SSE-001~004）无任何一处授权该变更；推翻 ADR-043 决策；无 requirements v2 / 重签记录。
  - 缓和因素：方向与 story 初衷自洽（crawl4ai 改由 MCP SSE 对接）；commit 卫生合格；移除干净彻底（源码零残留，42/42 旧测试绿）——合理的产品决策走了错误的流程。
  - 建议：人裁决二选一——(a) 确认决策：就地补全记录（ADR-043 supersede + cli-service story requirements v2 + 断言重签 + 本 story PRD/signoff 增补范围决议）；(b) 未确认：`git revert 9682aac 0c69a02`，移除另开 story。
- [ ] **IMPORTANT（阻塞）: REQ-MCP-SSE-004 AC3「POST 请求体不含 command/args/env 键」无断言落点**（test-engineer，`e2e/mcpSsePage.test.cjs:73-99`）
  - 问题：用 API 回读观察替代请求体断言，表单若附带多余键测试照样绿。
  - 建议：`page.on("request")` 捕获 POST body 断言三键不存在（首选）；或回 signoff.md 挂账显式降级。
- [ ] **IMPORTANT: auth=bearer 时用户 headers 可经大小写变体制造重复 Authorization**（security-auditor，`mcpService.js:399-410, 52`）
  - 问题：同名精确大小写时托管 token 确定性覆盖；但小写 `authorization` 用户键会与托管 `Authorization` 并存下发，端点取哪个不确定。
  - 建议：auth=bearer 时 validateKeyValue 拒绝大小写不敏感匹配 `authorization` 的键。可后续 story/bug 收口。
- [ ] **IMPORTANT: PRD §11.1 块 3 stub 方案文本漂移**（tech-reviewer）
  - 问题：计划写"SDK SSEServerTransport stub"，实际落地为手写协议 fixture（正确规避了传递依赖风险），文本未对齐。
  - 建议：§11.1 更新为"手写 legacy-SSE 协议 fixture"。
- [ ] **IMPORTANT（随 code-F1 联动）: 全局意图文档失真**（code-reviewer）
  - 问题：ADR-043 / CONTEXT.md / engineering-lessons.md 仍以 claude/codex/crawl4ai 三件套描述 CLI 服务；存量用户 DB 可能残留 crawl4ai 启用行，无清理说明。
  - 建议：随 F1 裁决一并更新。
- [ ] **IMPORTANT（建议补强）: REQ-MCP-SSE-003 AC5 stdio 探测回归半覆盖**（test-engineer）
  - 问题：只测了 http 回归；stdio 回归靠既有 mcpProbeTools.test.js 兜底但不断言 transport 选型。
  - 建议：补 stdio 探测回归用例，或在 signoff.md 显式记录兜底。

### 建议项汇总（不阻塞，19 条择要）

- prd：头部状态/版本记录过时；§6.3 块 2 行标签归属 2/5；块 3「如」字表述
- tech：探测与桥 transport 双实现漂移面入 §10.6；`src/routes/mcp.js`→`src/http/routes/mcp.js`；「http 不回落」REFLECT 时沉淀 ADR-025 后果段；probeTools 契约表补系统错误行
- req：REQ-003 AC4 trace 改指 §6.1 步骤 3；REQ-002 契约表补业务错误/幂等行；adapter 行号引用改符号名；sse 超时注明"既有契约不重复断言"
- test：headers 字段可见性断言；缺 url 键分支；端口竞态改 `127.0.0.1:1` 对齐先例；fixture 超时杀进程；seam 漂移挂账；KEY 弱锚点注明先例；badge 加 testid
- code：mcpService.js:104 注释「仅 http+bearer」→「http/sse+bearer」；validateKeyValue 的 keyRe 提为显式参数；probeTools 两分支 2 行重复可提 helper
- security：probeTools 解密/URL 解析纳入 try（对齐 CLI env 单 key fail-closed 教训）；URL userinfo 拦截；SSE 同源 302 携带 Authorization 沉淀知识库

---

## 阻塞项（建议修复或回流）

- [ ] **层：code（code-F1）**
  - 问题：未经签核移除 crawl4ai CLI + 改写已完成 story 锁定断言
  - 建议：人裁决——确认则补记（ADR-043 supersede + requirements v2 重签），否认则 revert
  - 建议动作：**人裁决后修复**；不需要回流（SSE 本体路径正确）
- [ ] **层：test（test-F1）**
  - 问题：REQ-004 AC3 请求体形状断言空洞
  - 建议：补 `page.on("request")` 断言或 signoff 挂账降级
  - 建议动作：修复（/test-author 补断言）后复核，无需重审全链

---

## 结论

- [ ] 可进入下一阶段
- [x] **需修复阻塞项后重审**（聚焦 code-F1 裁决 + test-F1 补断言，局部复核即可）
- [ ] 建议回流到 `PRD` / `TECH-DESIGN` / `REQ` / `TEST` / `BUILD`

SSE transport 本体（PRD/tech/req/security 四层 PASS，实现 19/19 契约测试 + 40/40 旧 MCP 回归 + 42/42 cli-service 回归全绿）质量达标；FAIL 集中在范围纪律（crawl4ai CLI 移除未经签核）与一处显式 AC 断言空洞。

---

## 审查人决策记录

<!-- 人填写：是否接受本 review 结论，以及理由。 -->

**决策**：接受 / 有条件接受 / 不接受

**理由**：

**下一步动作**：
