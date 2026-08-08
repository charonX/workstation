# Review 报告 — 2026-08-08-pi-agent-ux-enrichment / tech

> 故事 ID：`2026-08-08-pi-agent-ux-enrichment`
> 审查阶段：`tech`
> 日期：2026-08-08

---

## 审查摘要

- **总体结果**：WARN
- **阻塞项数量**：0
- **警告项数量**：6 IMPORTANT + 4 WARN + 2 SUGGESTION

> 审查对 tech-design 全部关键代码主张做了源码实证（MessageList/Assistant/worker/toolAdapter/pi-agent-core/tokens.css/UX 原型）。设计方向成立；6 项 IMPORTANT 均属契约/机制/范围缺口，建议进入 CRYSTALLIZE 前在 tech-design 就地补全。

---

## 审查项

| 维度 | 结果 | 说明 |
|---|---|---|
| 对齐 PRD | WARN | B1-B8 全部有模块/测试 seam 落位；但 B6 数据源与「事件流零改动」冲突、B5 裸路径未覆盖、PRD F3 绝对路径示例与 tech-design 规则矛盾（I-4/I-5/I-1/I-2） |
| 模块边界 | PASS | MarkdownRenderer / ToolCallBlock / MessageList / 图片解析小模块职责单一；MessageList 按 kind 分流的改动面最小 |
| 接口契约 | WARN | 接口 1/3 声明的 input/output/durationMs/error 终态与 worker 实际转发字段不匹配（实证 I-1/I-2）；rejected/pending 为死状态 |
| 测试 seams | PASS | B1-B8 每块有 seam；B6 seam 建议补「error 后 end 到达不覆盖」、B5 seam 建议补裸路径 case |
| 复杂度 | WARN | 简化决策合理（highlight.js/每帧全量）；流式每帧全量 + mermaid 围栏有渲染成本缺口（W-1） |
| 风险 | WARN | 库级风险表完整；缺契约/机制级风险（工具数据源、图片文件访问机制、mermaid 流式成本、mermaid securityLevel） |
| 安全 | WARN | HTML 全转义 + 图片白名单方向正确；mermaid 渲染路径不在「零 XSS」卖点内，securityLevel 未约定（I-6）；图片文件访问机制决定安全姿态但未定（I-3） |
| ADR 覆盖 | PASS | ADR-021（对话渲染安全边界）满足三条件、与既有 ADR-002/016/017/018 无冲突；建议把图片文件访问机制 + mermaid securityLevel 一并写入 |
| 术语一致性 | PASS | 会话区/通用空间/项目空间/对话空间、role user/agent 与 CONTEXT.md 及 data-message-role 契约一致 |
| 标准 | WARN | `--ch-code-*` 漏第三块（@media 回退）、手改生成文件（tokens.css:1-2 声明 DO NOT EDIT）、.hl-cmt 死 token（W-3/W-4/S-2） |

---

## 阻塞项（建议修复或回流）

无。

---

## 警告项

### IMPORTANT（进入 CRYSTALLIZE 前在 tech-design 就地补全）

- [x] **I-1 · 对齐 PRD / 接口契约：B6 工具块数据源缺口 ——「输入摘要/输出/耗时」无数据来源，「事件流零改动」硬约束内在矛盾**
  - **问题**：接口 3 承诺收起态「工具名 + 输入摘要（≤80 字符）」（UX 原型已确认）、接口 1 声明 `input/output/durationMs`，但实证 renderer 侧 SSE 契约（`worker.js mapToContractEvent` + `forwardEvent`）交付的字段：
    - `tool_execution_start` → `{type, name, status:"running", toolCallId}`（`worker.js:377`）——**无 args/input**
    - `tool_execution_end` → `{type, name, status:"completed", toolCallId}`（`worker.js:379`）——**无 result/output**，isError 被丢弃
    - `tool_execution_error` → `{type, name, status:"error", errorCode, errorMessage}`（`toolAdapter.js:359` 透传，`worker.js:718`）——无 id
  - PI 原生事件**确实携带**这些字段（`tool_execution_start` 含 `args`、`tool_execution_end` 含 `result`/`isError`，见 `pi-coding-agent/dist/core/agent-session.js:487-516`），是 worker 转发映射处丢弃。tech-design 同时主张「事件流契约零改动（B1 隐含假设 4）」——与 B6 输入摘要直接冲突。
  - **建议**：tech-design 显式声明一次**兼容性加法扩展**：start 加 `input`（=PI args）、end 加 `output`（=PI result 子集）+ `isError`。纯增量，renderer 当前零消费 tool 事件、`text_*`/`confirmation-pending` 消费方零感知，不构成破坏性变更；「零改动」以「无字段删除/无既有消费者破坏」为准绳改写。**或**收起态收窄为仅工具名（偏离已确认 UX，需人拍板）。
  - 建议动作：修复 tech-design 后重审。

- [x] **I-2 · 对齐 PRD（B6）/ 接口契约：工具失败终态会被随后的 end 覆盖，「错误默认展开标红」丢失**
  - **问题**：失败工具事件到达序 = `start(id)` → `error(无id，关联最近 running)` → `end(id)`。worker 把 PI 原生 end 一律映射 `status:"completed"`（丢弃 isError）→ renderer 按 id 把块改回 completed，**错误态被覆盖**。串行工具下是必然路径，非罕见竞态；若 end 先到则 error 匹配不到 running 块被静默丢弃，同样不显示错误。
  - **建议**：(a) worker 转发 isError，end 时 `status:"error"`（配合 I-1 的加法扩展，最优）；或 (b) renderer 把 error 视为终态（error 后的 completed end 不再降级）。B6 seam 补序贯 case：`start→error→end` 后块仍保持 error 态。
  - 建议动作：修复 tech-design 后重审。

- [x] **I-3 · 对齐 PRD（B5）/ 风险 / 安全：图片显示的文件访问机制未定，dev/prod 两条 origin 路径行为不同**
  - **问题**：renderer `sandbox:true, contextIsolation:true`（`main.js:203-208`）。dev 走 `http://localhost:5173`、prod 走 `loadFile`（file:// origin）。`<img src="file:///abs/path">` 在 prod 同 scheme 可用，在 dev 被 Chromium scheme 混合规则**拦截**——图片功能 dev 静默失效。tech-design 未指定文件访问机制（file:// URL vs 主进程 IPC 读→blob/data URL vs 自定义 protocol），「项目目录白名单」门也未明确 renderer 侧判定还是主进程中介。该机制决定安全姿态，风险表无此条目。
  - **建议**：固定机制（IPC 读→blob URL 最稳，同时覆盖 dev/prod；或注册 custom protocol），并把机制纳入 ADR-021 安全边界（白名单判定在 renderer 侧 = 弱防线，可接受但应写明理由）。
  - 建议动作：修复 tech-design 后重审。

- [x] **I-4 · 对齐 PRD（B5）/ 范围：裸路径图片引用未实现 —— D8 已拍板「裸路径均需处理」，tech-design 只覆盖 markdown 图片语法**
  - **问题**：interview-notes.md D8 明确「`![alt](path)` 与裸路径均需处理；本地路径 → 项目/工作区文件读取渲染」（interview-notes.md:60），PRD B5 同文。tech-design 图片解析模块与 B5 seam 只覆盖 `![alt](path)`；react-markdown 不会把裸路径段落变成 `<img>`，裸路径引用被静默当作普通文本。B5 验收不达标。
  - **建议**：tech-design 补裸路径识别（text 节点后处理：匹配项目目录内存在的图片扩展名路径 → 包成 img），测试 seam 补裸路径 case；**或**回流 PRD 收窄为仅 markdown 语法（需人拍板，偏离 D8）。
  - 建议动作：修复 tech-design 后重审。

- [x] **I-5 · 真理向下流：PRD F3 绝对路径示例与 tech-design 图片规则直接矛盾**
  - **问题**：PRD F3 步骤 1 验收锚点示例 `![alt](/abs/path.png)` 要求渲染为 img（prd.md:85），tech-design 数据流 6 却规定「绝对路径/越权/不存在 → 占位提示（E3）」（tech-design.md:51）。按 tech-design 实现后按 PRD F3 写的 E2E 必失败。tech-design 收窄了 PRD 已拍板行为而未回流更新 PRD。
  - **建议**：统一口径——改 PRD F3 示例为相对路径 + 明确「项目目录内绝对路径可渲染 / 否则占位」，或一律相对路径；两者需人确认并同步 PRD/tech-design（ADR-021 同时落档）。
  - 建议动作：修复 tech-design 后重审。

- [x] **I-6 · 安全：Mermaid 渲染未约定 securityLevel，与「HTML 全转义零 XSS 面」卖点存在隐含张力**
  - **问题**：零 XSS 面主张只覆盖 react-markdown 的 HTML 转义路径；mermaid 渲染是独立路径，mermaid 的 click 指令 / HTML label 是已知脚本注入面。实现若未显式 `mermaid.initialize({ securityLevel:'strict' })`（或等价），图元 HTML 标签可能被注入 DOM。security.md 的零 XSS 断言依赖运行库默认值（升级/换库即漂移），tech-design 未将其固化为显式决策。
  - **建议**：tech-design 显式约定 `securityLevel:'strict'`（含验证方式），写入 ADR-021。
  - 建议动作：修复 tech-design 后重审。

### WARN

- [ ] **W-1 · 复杂度 / 性能：流式每帧全量 + mermaid 围栏存在每帧渲染不完整图表的成本缺口**
  - **问题**：D5 策略「未闭合语法显示字面量」只覆盖 `**` 级未闭合；未闭合的 ```mermaid 围栏在 react-markdown 中被解析为延伸到文本末尾的 code block，mermaid 渲染器在流式每个 rAF 帧对不完整语法尝试渲染（mermaid 渲染同步且慢，百 ms 级）→ 掉帧 + 语法错误回退闪烁。M1 描述的是「长消息卡顿」，这是**单条消息流式期间**的独立成本。
  - **建议**：mermaid code renderer 在 streaming 时对「围栏未闭合（code 块延伸到 EOF）」显示字面量/骨架，闭合才渲染；或 debounce/按内容缓存。测试 seam 补 B3+B7 交互 case。

- [ ] **W-2 · 风险：风险表缺契约/机制级风险条目**
  - **问题**：风险表覆盖库级风险，但 I-1/I-3/I-6 对应的三个风险（工具事件数据源、图片文件访问机制、mermaid securityLevel/流式成本）不在表中——它们都「能在 BUILD 验证、有回流点」，应显式入表。
  - **建议**：补三条到风险表（含回流点与快速验证方式）。

- [ ] **W-3 · 标准：`--ch-code-*` 只进浅色/暗色两块，漏 `@media (prefers-color-scheme: dark)` 回退块**
  - **问题**：tokens.css 新增 8 枚 `--ch-code-*` 只在 `:root`（93-99）与 `[data-theme=dark]`（140-146），漏第三个 `@media (prefers-color-scheme: dark)` 块（tokens.css:154）。无显式 data-theme 且 OS 暗色时页面切暗但 `--ch-code-bg` 仍浅色 → 浅底深字横在暗色 UI 上。生产 app 恒设 data-theme（useSettings.jsx:61）暂不触发，但破坏文件「三块全量定义」惯例、HTML 原型/无显式主题场景会踩中。
  - **建议**：补第三块定义。

- [ ] **W-4 · 标准 / 流程：手改生成文件 tokens.css**
  - **问题**：文件头声明「DO NOT EDIT MANUALLY — re-run /tac-design to update」（tokens.css:1-2），本次 diff 手工插入 8 枚 token。任何一次 /tac-design 重跑将覆盖本文件，token 静默丢失、高亮回退无色。
  - **建议**：token 变更落到生成器源定义而非产物文件；本期若以手改交付，需在 commit 说明中标注并确保生成器同步。

### SUGGESTION

- [ ] **S-1 · 接口契约：rejected/pending 为死状态；spike 口径不一致**
  - 接口 1 状态枚举含 `rejected`（数据流又提 `pending`），但 renderer 侧永远收不到——PI 原生 end 被 worker 固定映射为 `completed`，toolAdapter 的 pending/rejected end（`toolAdapter.js:419/422`）在 `worker.js:718` 只转发 error 时被丢弃。确认拒绝/待确认的块会显示为 completed 而非 rejected 语义。建议从接口 1 移除或注明「未来契约扩展预留」。
  - workflow-state 记「依赖 spike PASS（react-markdown 10 兼容 React 19）」，tech-design 风险表却把打包兼容标为 BUILD 首切片验证。建议把 spike 结论限定为「库级 API 兼容已确认」，build 级打包兼容明确留 BUILD。

- [ ] **S-2 · 设计系统：`.hl-cmt` 用 `--ch-text-tertiary` 而非新增 `--ch-code-cmt`，新 token 成死资产**
  - assistant-rich.html:141 注释色走 `--ch-text-tertiary`，新 token `--ch-code-cmt`（浅 #6e7781 / 暗 #8b949e）零引用，与 hl-kw/str/fn/num 高亮色系不统一，实现者无法从原型得知注释该用哪个 token。建议原型改用 `--ch-code-cmt`（配合 W-3 补块）。

---

## 结论

- [ ] 可进入下一阶段
- [x] 需修复警告项后重审（6 项 IMPORTANT 建议在进入 CRYSTALLIZE 前于 tech-design 就地补全）
- [ ] 建议回流到 `PRD` / `TECH-DESIGN` / `BUILD`

**总体判断**：设计方向成立且经代码实证——「渲染层整体替换、消息模型 kind 类型化、highlight.js + 双主题、事件契约 start/end 带 toolCallId / error 无 id → 最近 running 匹配」全部与实现一致，ADR-021 计划合理、无 ADR 冲突，术语/标准基本合规。6 项 IMPORTANT 均属**契约/机制/范围缺口**（工具事件字段被 worker 转发映射丢弃、error 终态被 end 覆盖、图片文件访问机制未定、裸路径未覆盖、PRD F3 与 tech-design 矛盾、mermaid securityLevel 未约定），都可在 tech-design 内就地补全、有清晰回流点，不推倒设计。

---

## 审查人决策记录

<!-- 人填写：是否接受本 review 结论，以及理由。 -->

**决策**：接受 / 有条件接受 / 不接受

**理由**：

**下一步动作**：
