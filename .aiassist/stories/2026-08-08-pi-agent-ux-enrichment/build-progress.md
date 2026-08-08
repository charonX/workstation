# Build Progress — 2026-08-08-pi-agent-ux-enrichment

> 阶段：BUILD（门 1 已签核，1464be4）
> REQ：REQ-AGENT-047~055（requirements v1，hash dfd35b8a）
> 测试契约：4 文件 16 用例（已签核，实现者只读）

## 切片规划（依赖序）

| # | REQ-ID | 内容 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | REQ-AGENT-047/053 | 依赖引入 + Markdown 管线（react-markdown+remark-gfm+HTML 转义）+ 消息模型 kind:text 接入 MessageList | — | done（2026-08-09） |
| 2 | REQ-AGENT-048 | 代码高亮（highlight.js 围栏+auto+双主题 CSS） | 1 | done（2026-08-09） |
| 3 | REQ-AGENT-055 | worker 工具事件转发加法扩展（start+input/end+output+isError） | — | done（2026-08-09；实现+harness 验证完成，业务测试 seam 待 [test] 微调，见 Slice 3 记录） |
| 4 | REQ-AGENT-052 | 工具折叠块（消息模型 kind:tool + SSE 消费 + ToolCallBlock 三态） | 1,3 | done（2026-08-09） |
| 5 | REQ-AGENT-049/050 | Mermaid（securityLevel strict + 流式字面量）+ KaTeX | 1 | pending |
| 6 | REQ-AGENT-051 | 图片（主进程 HTTP API + 白名单 + 裸路径识别） | 1 | pending |
| 7 | REQ-AGENT-054 | E2E 接线（3 个 E2E 跑绿）+ 主题切换 + 历史统一管线验证 | 全部 | pending |

## 关键 seam 契约速记（供子代理简报引用）

- MarkdownRenderer（tech-design 接口 2）：`{text, streaming?, projectDir?}` → 安全 React 元素树；react-markdown 默认转义 HTML（无 rehype-raw）。
- 消息模型（接口 1）：text 元素 `{kind:"text", id, role, text, streaming?}`；tool 元素 `{kind:"tool", id:toolCallId, name, status, input?, output?, errorCode?, errorMessage?, durationMs?}`。
- 工具事件：start 创建（id=toolCallId）/ end|error 按 id 更新 / error 终态（其后 end 不降级）/ error 无 id 匹配最近 running / text_end 时 running 块 interrupted。
- OPC_FAUX_TOOL_SEQUENCE 注入缝（上 story Slice 6）：FAUX 下 worker 按序列发起真实工具调用。
- startElectronApp({extraEnv}) 夹具：E2E 注入缝透传（签名实现时确认）。
- 图片：主进程 HTTP API 读文件 → blob URL；白名单判定在主进程（项目目录 + 扩展名 png/jpg/jpeg/gif/webp/svg）；相对路径按 projectDir 解析、项目内绝对路径可渲染、外占位；裸路径识别（text 后处理：项目内存在 + 图片扩展名）。
- mermaid：`securityLevel:'strict'` 显式；streaming 时未闭合围栏显示字面量。
- locator 约定（E2E 契约）：`[data-tool-block]`/`[data-tool-header]`/`[data-tool-body]`/`[data-tool-error-badge]`；消息既有 `[data-message-role]`/`[data-testid='composer-input']`/`[data-session-item]`。

## Slice 记录

（每个 slice 完成后追加：实现 commit、测试结果、PRD→代码 可追溯性表、refactor 结果）

### Slice 1（REQ-AGENT-047/053 地基）— 2026-08-09

**实现 commit**：`[build] slice1: ...`（见版本记录）＋ `[docs] slice1 收尾`（本记录）

**依赖清单**（signoff 裁决 6，仅本切片需要的两个）：

| 依赖 | 版本 | 用途 | 后续切片 |
|---|---|---|---|
| `react-markdown` | ^10.1.0 | GFM 渲染（默认 HTML 转义——无 rehype-raw） | Slice 2 高亮 components 注入 |
| `remark-gfm` | ^4.0.1 | GFM 扩展（表格/任务列表/删除线/自动链接） | 不变 |
| （未引入） | — | remark-math/rehype-katex/katex/mermaid/highlight.js | Slice 2/5 |

**实现文件**：

| 文件 | 变更 | 说明 |
|---|---|---|
| `src/renderer/components/assistant/MarkdownRenderer.jsx` | 新增 | 接口 2 组件：react-markdown+remark-gfm、HTML 全转义、.md 类、React.memo、错误边界（E5/标准 4） |
| `src/renderer/components/assistant/MessageList.jsx` | 改 | text 消息 `{m.text}` → `<MarkdownRenderer text streaming>`；kind 分流（tool → Slice 4 预留） |
| `src/renderer/pages/Assistant.jsx` | 改 | 消息模型 5 处补 `kind:"text"`（历史对齐/text_start/text_delta 兜底/用户气泡/发送失败） |
| `src/renderer/components/assistant/assistant.css` | 改 | `.md` 样式块（对齐 assistant-rich.html：h1-h3/table/blockquote/ul/pre>code/任务列表，--ch-* token；pre>code 用 --ch-code-bg/--ch-code-text） |
| `package.json` / `package-lock.json` | 改 | + react-markdown、remark-gfm |

**测试摘要**：

- lint：0 error（新增/改动文件零告警；既有 warnings 不动）。
- `vite build`（renderer）：通过——react-markdown/remark-gfm 打包兼容（tech-design 隐含假设 1 验证点 ✅，213ms）。
- SSR 行为自验（react-dom/server fixture）：h1/h2/table(th/td)/blockquote/ul/pre>code 渲染正确；`<script>alert('xss')</script>` → 转义源码文本（无 script 元素）；未闭合 `**` → 字面量；任务列表 → `ul.contains-task-list > input[type=checkbox]`。
- 单元回归 `npm run test:unit`（rebuild:node + 全量）：**tests 666 / pass 662 / fail 4**——662 既有水位全绿（水位不退 ✅）；fail 4 = 本 story `workerToolEventExt.test.js`（REQ-AGENT-055，Slice 3 seam 依赖实现，与切片规划一致；基线同构——改动前同测同 4 例红，非本切片回归）。
- 组件链自验（vite ssrLoadModule 走真实 MessageList→MarkdownRenderer）：8/8 PASS（h1/table 渲染、script 转义、未闭合 `**` 字面量、streaming 透传、.md 类、tool 分支占位 null 不崩）。
- E2E 回归 `assistantChat.test.cjs`（真实 Electron + Vite dev）：**2/2 绿**（AC4 发送→流式→toContainText；AC5 断线重连→历史完整）——Markdown 渲染接入未破坏既有 toContainText 契约（纯文本消息渲染后文本一致）。

**PRD→代码 可追溯性表**（B1/B7 本切片范围，逐条）：

| PRD 条目 | 落点（文件/机制） | 说明 |
|---|---|---|
| B1 GFM 全量渲染 | MarkdownRenderer（react-markdown + remark-gfm） | 标题/列表/表格/引用/链接/代码块/任务列表 → DOM |
| B1 HTML 全转义 | MarkdownRenderer（无 rehype-raw） | react-markdown 默认 raw→转义文本节点（源码实证 node_modules/react-markdown/lib/index.js post()）；F1 步骤 4 / E2E richRender 标准 2 语义 |
| B1 历史与新消息同一管线 | MessageList kind:"text" → MarkdownRenderer；Assistant.jsx align() 补 kind | 历史 GET messages 全走 Markdown 渲染（兼 B8 面，无 tool 元素） |
| B7 流式实时增量渲染 | Assistant.jsx rAF 缓冲不动 + MessageList streaming 透传 + MarkdownRenderer memo | 每帧完整累积文本喂渲染器；未闭合语法字面量→闭合即渲染（SSR 自验）；F5 步骤 1 |
| F1 步骤 1 GFM 渲染 DOM | assistant.css `.md` 块 | h1-h3/table/th/td/blockquote/ul/ol/pre>code 样式（--ch-* token，双主题随 data-theme） |
| F1 步骤 4 script 转义 | react-markdown 默认行为 | `<script>` 显示为源码文本，不出现元素（E2E 断言面） |
| F5 步骤 1 流式期间不崩 | React.memo + react-markdown 任意输入鲁棒 | 中间态字面量显示，完成态正确 |
| E5 渲染依赖加载失败 | MarkdownRenderer 内 MarkdownErrorBoundary | 组件内回退纯文本不白屏（REQ-AGENT-047 标准 4：任意输入不抛错） |
| E6 流式中间态 | react-markdown 天然行为 | 未闭合语法显示字面量，闭合即渲染 |
| REQ-AGENT-047 标准 3 任务列表 | remark-gfm 产物 `ul.contains-task-list > input[type=checkbox]` | CSS accent-color 跟随 --ch-accent（E2E 断言 input[type=checkbox]） |
| REQ-AGENT-047 标准 4 渲染失败不崩 | MarkdownErrorBoundary | 见 E5 行 |
| REQ-AGENT-053 标准 1-3 | rAF 既有缓冲不动 + 全量喂入 + memo | 高速流不冻结（rAF 既有机制不变）、完成态无半渲染残留 |
| 接口 2 props | MarkdownRenderer `{text, streaming?, projectDir?}` | streaming/projectDir 预留（Slice 5 W-1 / Slice 6 图片），本切片未消费 |
| 接口 1 消息模型 | Assistant.jsx 5 处 `kind:"text"`；MessageList kind 分流 | text 元素类型化；tool 分支 ternary 占位（Slice 4 接 ToolCallBlock） |
| 硬约束：事件流/存储零改动 | 未触碰 agentSessions API/worker/存储 | 渲染层纯前端替换 |

**refactor**：本切片无独立 refactor 轮（改动面小：1 新组件 + 2 文件接线 + 1 CSS 块；memo/边界为组件内置形态）。

---

### Slice 2（REQ-AGENT-048 代码高亮）— 2026-08-09

**实现 commit**：`[build] slice2: 代码高亮（highlight.js 围栏+auto 检测+双主题 token 映射）(REQ-AGENT-048)`（8c086dd）＋ `[docs] slice2 收尾`（本记录）

**依赖清单**（signoff 裁决 6）：

| 依赖 | 版本 | 用途 | 说明 |
|---|---|---|---|
| `highlight.js` | ^11.11.1 | 代码高亮（围栏标记 + highlightAuto 兜底） | 只用 `lib/core` + 26 常用语言注册，不整包引入（tech-design 性能项）；别名覆盖 js/jsx/mjs/cjs、ts/tsx/mts/cts、py、sh/zsh、console/shellsession、yml、md、text/txt |

**实现文件**（Rule 0.5：仅此三处）：

| 文件 | 变更 | 说明 |
|---|---|---|
| `src/renderer/components/assistant/MarkdownRenderer.jsx` | 改 | components 注入 `pre`/`code`：围栏语言标记 → hljs.highlight（ignoreIllegals:true）；无标记 → highlightAuto（AUTO_DETECT_SUBSET 23 语言）；无匹配/未注册 → plaintext 兜底（E4）；行内代码不高亮（InPreContext 区分）；输出走 dangerouslySetInnerHTML（安全路线见下） |
| `src/renderer/components/assistant/assistant.css` | 改 | `.md pre code .hljs-*` → var(--ch-code-kw/str/fn/num/cmt) 五色 token 映射（kw: keyword/selector-tag/built_in/type；str: string/regexp/doctag；fn: title/function_/class_/params/attr；num: number/literal/symbol/meta；cmt: comment/quote 斜体）——双主题随 data-theme 三块自动切换（tokens.css 浅/暗/@media），观感对齐原型 .hl-kw/.hl-str/.hl-fn/.hl-num/.hl-cmt |
| `package.json` / `package-lock.json` | 改 | + highlight.js |

**高亮安全路线（确认并落地）**：`dangerouslySetInnerHTML` + 依赖 hljs 自身转义，**不做手工预转义**。
- 实证：hljs v11 `lib/core.js:61 escapeHTML` / `:157 addText → buffer += escapeHTML(text)`——HTMLRenderer 对全部文本先转义（& < > "），value 输出 = 库生成 span + 已转义文本，无原始 HTML。
- 实测：`<script>alert('xss')</script>` 代码内容 → 输出 `&lt;...&gt;` 实体（span 内），DOM 无 script 元素（SSR 断言）。
- 若手工先转义再喂 hljs 会双重转义 `&`（`&amp;` → `&amp;amp;`），故不预转义。
- 检测失败/任何异常 → try/catch 回退 plaintext 原文渲染（React 转义），不抛错（E4 / REQ-AGENT-048 标准 3）。

**测试摘要**：

- lint：0 error（改动文件零告警；既有 warnings 不动）。
- `vite build`（renderer）：通过——highlight.js core+26 语言打包兼容（150ms；renderer 总包 895.60kB/gzip 268.16kB，含 hljs 增量约 +100kB gzip，chunk>500kB 警告为既有量级，非回归）。
- SSR 自验（vite ssrLoadModule 真实 MarkdownRenderer）：**10/10 PASS**——```js → code 保留 language-js 类 + hljs-keyword/hljs-number span；无标记 js 代码 → auto 检测出 hljs span；```html 内 `<script>` → 转义实体零注入（无 script 元素）；无标记 `<script>` 块 → 同安全（auto 判 xml + 嵌套 js span）；裸命令（npm install && node build.js）→ 不崩 plaintext；裸日志 → 不崩；行内代码 → 无 hljs span；未知语言围栏 → 不崩兜底；```mermaid 围栏（Slice 5 前）→ 不崩；纯文本段落正常。
- 单元回归 `npm run test:unit`（rebuild:node + 全量）：**tests 666 / pass 662 / fail 4**——662 既有水位全绿（水位不退 ✅）；fail 4 = 本 story `workerToolEventExt.test.js`（REQ-AGENT-055，Slice 3 seam 依赖实现，与切片规划一致，非本切片回归）。
- E2E：richRender 高亮用例依赖其他 slice（Mermaid/KaTeX/图片），按规划留 Slice 7 统一接线（054 标准 4 主题切换同仓）。

**PRD→代码 可追溯性表**（B2 本切片范围，逐条）：

| PRD 条目 | 落点（文件/机制） | 说明 |
|---|---|---|
| B2 围栏语言标记为主 | MarkdownRenderer `components.code` + hljs.highlight | `language-xxx` → getLanguage（含别名 js/ts/py/sh…）→ 按语言高亮；ignoreIllegals:true 兜 LLM 输出非法语法不抛错 |
| B2 无标记自动检测兜底 | highlightAuto + AUTO_DETECT_SUBSET | 无语言类围栏块自动检测着色（rel>0）；裸命令/日志低相关命中保留基础着色（B2 目标），完全无匹配 rel=0 → plaintext |
| B2 浅/暗双主题 | assistant.css .hljs-* → var(--ch-code-*) | 五色语义 token 映射，随 data-theme 浅/暗/@media 三块自动切换（F6 步骤 2 / REQ-048 标准 4 断言面） |
| F1 步骤 2 代码块高亮 | code 元素保留 language-js 类 + hljs span | E2E richRender 标准 1/2 断言面（`.hljs-keyword` 可见 + `span[class*='hljs']`） |
| E4 自动检测失败兜底 | try/catch → plaintext 原文 + language-plaintext 类 | 未注册语言/检测无匹配/任何异常 → 不报错、无着色（REQ-048 标准 3 "plaintext 类"） |
| M2 自动检测质量（验证点） | AUTO_DETECT_SUBSET 设计 | 实测依据见下"M2 初判"；不达标收窄点 = 子集删语言或 rel 阈值上调（一行改动） |
| §12.1 范围外 1 HTML 不渲染 | dangerouslySetInnerHTML 仅喂 hljs 转义产物 | 零原始 HTML 入 DOM（见安全路线实证） |
| 接口 2 components 注入 | react-markdown `components={{pre, code}}` | pre>code 围栏块经 InPreContext 与行内 code 区分；行内代码不高亮 |
| 硬约束：事件流/存储零改动 | 未触碰 worker/存储/API | 纯渲染层加法 |

**M2 自动检测质量初判**（实测 16 语料，子集 23 语言）：

| 语料类型 | 检测结果 | 判定 |
|---|---|---|
| 多行真实代码（bash/rust/json/sql/yaml/css/diff） | 正确语言，rel 4-15 | 达标：着色稳定 |
| 短 js 片段 `const x = 1;` / `git status && git diff` | javascript/bash rel 1 | 正确但低相关（留着色） |
| 纯命令串 `npm install ... && node build.js` | rel 0 → plaintext | 达标（E4 兜底路径） |
| py 函数 `def parse(data): ...` | **kotlin rel 5（误判）** | 已处理：kotlin 移出 auto 子集 → python rel 4 正确（```kotlin 围栏仍显式命中） |
| 裸日志 `INFO: task ...` / 错误日志 / 英文散文 | yaml/css 误判 rel 2-3 | 低相关误染（有基础着色但语义错）；属 hljs 启发式固有边界，QA/REFLECT 观察，不达标再收窄 |
| go/swift 短片段 | javascript/rust 误判 rel 3-5 | 同上：短片段歧义，多行真实代码正确率明显更高 |

**M2 结论**：多行真实代码检测可靠（高价值面达标）；裸命令 → plaintext 兜底达标；短日志/散文低相关误染为已知边界（B2 已允许"基础着色"语义）。收窄开关：AUTO_DETECT_SUBSET / rel 阈值，均在 `highlightCode()` 一处。

**refactor**：本切片无独立 refactor 轮（改动面：1 组件注入 + 1 CSS 块 + 1 依赖；try/catch 兜底与 memo 为组件内置形态）。

---

### Slice 3（REQ-AGENT-055 worker 工具事件转发加法扩展）— 2026-08-09

**实现 commit**：`[build] slice3: worker 工具事件转发加法扩展（start+input/end+output+isError）(REQ-AGENT-055)`（见 git log）＋ `[docs] slice3 收尾`（本记录）

**改动文件**：`src/agent/worker.js`（唯一实现改动；toolAdapter 未动——其自身事件契约无字段可补，见下实证）

**PI 原生字段实证**（node_modules 实际源码，非仅 tech-design 引用）：

| 事件 | 原生字段（实证位置） | 本次映射 |
|---|---|---|
| `tool_execution_start` | `{ type, toolCallId, toolName, args }`（`pi-agent-core/dist/agent-loop.js` `executeToolCallsSequential/Parallel`：`args: toolCall.arguments`，恒含） | + `input: ev.args` |
| `tool_execution_end` | `{ type, toolCallId, toolName, result, isError }`（同 `emitToolExecutionEnd`：`result: finalized.result` / `isError: finalized.isError`，恒含；成功 false / 错误 true） | + `output: ev.result`（ToolResult 子集完整透传）+ `isError: ev.isError` |
| toolAdapter 契约事件 | `{ type, name, status, errorCode?, errorMessage? }`（toolAdapter emitToolError；**无 args/result**） | 透传分支原样——实证：到达 mapToContractEvent 的带 `name` 事件仅有 tool_execution_error（worker 只从 toolSurface 转发 error；PI 原生事件恒为 toolName 不落该分支），无字段可补 |

**实现语义**：
- 纯增量：start/end 映射各补 2 字段；`text_delta/text_end/confirmation-pending` 及 error 事件（无 toolCallId 保持现状，I-2 的 isError 处理在 end 上）零改动。
- 截断（`limitSize` 加法分支）：tool 事件数据载体（input=args / output=result）超 256KB → **文本化截断 + truncated 标记**（对象载体 JSON 字符串化后 slice），保留契约字段 toolCallId/name/status/isError——不再整条降级为 `{type, truncated}`（否则渲染层无法关联工具块）。沿用既有 MAX_IPC_BYTES 语义（content/delta 同型）。

**测试摘要**（等价 seam 自验 harness，23/23 PASS——真实 spawn + session 句柄监听 + `process.env.OPC_FAUX_TOOL_SEQUENCE` 注入缝）：
- 成功例（settings get）：start 含 `input`（=PI args 对象）+ toolCallId；end 含 `output`（ToolResult `{content,details}`）+ `isError === false`；start/end toolCallId 一致。
- 失败例（project list 无参数）：tool_execution_error 携带 errorCode/errorMessage；isError end 携带错误 output。
- 零感知：text_delta 字段集 `["delta","type"]`、text_end `["content","type"]` 不变。
- 截断例（project profile read 300KB 文件）：end 事件 ≤256KB、`truncated: true`、output 为截断字符串、toolCallId/name/status/isError 全保留、isError 值不丢。

**全量单测**：`npm run test:unit`（rebuild:node + 全量）——结果见本 slice 验证节（662 既有水位 + workerToolEventExt 4 例）。

**⚠️ workerToolEventExt.test.js seam 三缺陷（本 slice 报告项，留 parent 裁决 [test] 微调；实现已验证契约满足，见 harness 23/23）**：
1. 监听 `agentService.on("session-event")`——服务级 emitter 仅发 ready/spawn-error（agentService.js 实证），session 事件发在**会话句柄**（`session.on("session-event")`，SSE 路由同 seam）→ 4 例全部超时（含标准 3 的 text_end——即使 FAUX 回声正常）。
2. 未注入 `OPC_FAUX_TOOL_SEQUENCE`（createAgentService 无 env 注入选项；worker 继承 spawn 时 process.env）→ 无工具事件。且各用例需不同序列（成功/失败/无），需在每例 `createAgentService` 前设 `process.env.OPC_FAUX_TOOL_SEQUENCE`（若用 write 工具还需项目行存在——`ui:project:tool-ext:*` 无项目 → default profile 无 FS 工具 → E-AGENT-UNSUPPORTED；可改用 query 级 CLI 工具如 settings get）。
3. 标准 3 字段集断言 `["delta","sessionKey","type"]` 与现状契约不符：SSE 路由「事件 = 会话句柄 session-event 原样转发（不增删字段），sessionKey 仅订阅侧过滤用，不出现在事件帧」（routes/agentSessions.js 实证）→ 实际 text_delta 字段集 = `["delta","type"]`。

**PRD→代码 可追溯性表**（I-1 / REQ-AGENT-055，逐条）：

| PRD/REQ 条目 | 落点（文件/机制） | 说明 |
|---|---|---|
| REQ-AGENT-055 标准 1 start 含 input | worker.js mapToContractEvent `tool_execution_start` → `input: ev.args` | = PI 原生 args（agent-loop.js 实证恒含） |
| REQ-AGENT-055 标准 2 end 含 output + isError | worker.js mapToContractEvent `tool_execution_end` → `output: ev.result` + `isError: ev.isError` | result 完整透传（256KB 上限由 limitSize 截断）；isError 不再丢弃（I-2 依赖） |
| REQ-AGENT-055 标准 3 零感知 | 其余分支零改动（text_delta/text_end/error/透传原样） | harness 字段集断言验证 |
| 硬约束：事件流零改动 | 纯加法 + 截断分支扩展 | 无字段删除；E2E（confirmChain*）不断言事件字段集，留 Slice 7 统一回归 |
| 接口 1 tool 元素消费面 | 本 slice 仅转发侧；renderer 消费 = Slice 4 | output 截断为文本载体（ToolCallBlock 以文本展示语义一致） |

**refactor**：本切片无独立 refactor 轮（改动面：1 文件 2 处函数加法分支；与既有 content/delta 截断语义同构）。

---

### Slice 4（REQ-AGENT-052 工具折叠块）— 2026-08-09

**实现 commit**：`[build] slice4: ...`（见 git log）＋ `[docs] slice4 收尾`（本记录）

**实现文件**（Rule 0.5：仅此四处）：

| 文件 | 变更 | 说明 |
|---|---|---|
| `src/renderer/pages/Assistant.jsx` | 改 | SSE 消费 tool_execution_start/end/error（现零消费 → 新增分支，纯归约函数 reduceToolEvent 模块级导出）；text_end 内 markInterruptedTools 防御 |
| `src/renderer/components/assistant/ToolCallBlock.jsx` | 新增 | 接口 3 组件：三态渲染（收起=工具名+摘要+chevron / 展开=输入/输出/耗时 / 错误=默认展开+error 色+「执行失败」徽标）；interrupted 弱化态；locator 契约 4 项 |
| `src/renderer/components/assistant/MessageList.jsx` | 改 | kind:"tool" → ToolCallBlock（原占位 null 替换）；tool 气泡独立类 tool-bubble |
| `src/renderer/components/assistant/assistant.css` | 改 | tool-block 样式块（对齐 assistant-rich.html：border/radius/header hover/chevron 旋转/error 色 --ch-error/超长输出折叠内滚动 max-height 240px） |

**SSE 消费语义**（tech-design 数据流 3/4 / 接口 1 全落）：

| 事件 | 处理 |
|---|---|
| `tool_execution_start` | append `{kind:"tool", id:toolCallId, name, input, status:"running", startedAt}`（输入摘要截断 ≤80 在展示层）；id 缺失防御兜底 `tool-<ts>` |
| `tool_execution_end` | 按 toolCallId 更新 `{output, status: isError? "error" : "completed", durationMs = now - startedAt, interrupted:false}`；**isError:true → error 态**（I-2）；**error 终态**：块已 error 时其后 completed end 不降级（保留 errorCode/errorMessage） |
| `tool_execution_error` | 无 toolCallId（toolAdapter.js:359 实证）→ **倒序扫匹配该 turn 最近 running 块**；SSE 未来补 toolCallId 则优先精确匹配（双分支）；error 更新带 errorCode/errorMessage/durationMs |
| `text_end` | **markInterruptedTools**：仍 running 的块标记 `interrupted:true`（状态枚举保持签核契约 running/completed/error 不变——以 running+interrupted 表达，视觉态由组件渲染"已中断"；迟到 end/error 仍可正确收尾并清除标记） |

**interrupted 表达决策**（实现者定项）：状态枚举 `"running"|"completed"|"error"` 是签核契约（接口 1），不新增 `"interrupted"` 枚举值——以 `running + interrupted:true` 标记表达。理由：① 契约枚举零偏离；② 迟到 end/error 语义更正确（interrupted 块仍可被迟到 error 命中升级为 error、被迟到 end 收尾为 completed）。E2E 只断言视觉态（非 running），不触碰状态值。

**测试摘要**：

- lint：0 error（改动文件零告警）。
- `vite build`（renderer）：通过——ToolCallBlock 打包兼容（899.06kB/gzip 269.06kB，较 Slice 2 基线 +3.5kB，chunk 警告为既有量级）。
- **组件链自验**（vite ssrLoadModule + react-dom/server + 纯归约函数断言）：**13/13 PASS**，覆盖：
  - 消息模型演化：start→end 成功（id/status/input/output/durationMs）／isError:true end → error 态／**start→error→end 序贯后块仍 error（error 终态）**／**error 无 id 匹配最近 running（多块逐次命中）**／error 带 id 精确匹配（未来优先分支）／**text_end 中断 + 迟到 end 收尾**／防御路径（缺 id 兜底、无匹配 no-op）。
  - 三态渲染 SSR：收起态（无 open 类、body 隐藏类、无徽标）／展开态（输入/输出/耗时 sections）／**错误态默认展开 + error 类 + 「执行失败」徽标 + 错误 section**／interrupted 弱化态（「已中断」提示）／摘要截断 ≤80 字符／MessageList 分流（tool→ToolCallBlock、text→MarkdownRenderer、**历史无 tool 块**）。
  - 点击展开/收起与 running→error 自动展开的交互路径由真实浏览器 E2E（toolCallBlock 用例，Slice 7 接线）覆盖——SSR 已断言错误态默认展开的渲染契约。
- 单元回归 `npm run test:unit`（rebuild:node + 全量）：**tests 666 / pass 666 / fail 0 全绿**（workerToolEventExt 补全后基线全绿，本切片零回归）。
- E2E：toolCallBlock 3 用例按规划留 Slice 7 统一接线（startElectronApp extraEnv 注入缝确认）。

**PRD→代码 可追溯性表**（B6 / REQ-AGENT-052，逐条）：

| PRD/REQ 条目 | 落点（文件/机制） | 说明 |
|---|---|---|
| B6 / F4 步骤 1 折叠块出现+默认收起 | Assistant.jsx reduceToolEvent start 分支 + ToolCallBlock 收起态 | start 创建 tool 元素；无 open 类 → body display:none（E2E 标准 1 断言面） |
| F4 步骤 2 点击展开显示输入/输出/耗时 | ToolCallBlock header onClick 切换 + body sections | 纯组件状态；E2E 标准 2 断言面（body 含 "hello"） |
| F4 步骤 3 错误默认展开标红 | ToolCallBlock isError → open 初值 + useEffect 自动展开 + error 类/徽标 | start→error 状态迁移也强制展开（useEffect on isError）；E2E 标准 3 断言面 |
| REQ-AGENT-052 标准 4 error 终态 | reduceToolEvent end 分支 `m.status === "error" → 不降级` | start→error→end 序贯后仍 error（I-2 双保险，harness 断言） |
| REQ-AGENT-052 标准 5 error 无 id 匹配最近 running | reduceToolEvent error 分支倒序扫 | toolAdapter.js:359 实证无 toolCallId；工具串行执行语义安全；未来补 id 精确匹配优先 |
| REQ-AGENT-052 标准 6 text_end 中断 | Assistant.jsx text_end → markInterruptedTools | running 块标 interrupted；组件渲染"已中断"弱化态（非 running 视觉态）；迟到 end 收尾 |
| 接口 1 tool 元素生命周期 | reduceToolEvent / markInterruptedTools（模块级导出，SSR 自验 seam） | start 创建 → end|error 更新 → error 终态 → interrupted 防御；状态枚举契约零偏离 |
| 接口 3 ToolCallBlock props | ToolCallBlock.jsx `{tool, defaultOpen?}` | 三态渲染 + 交互；props 签名与 tech-design 一致 |
| 数据流 3/4 SSE 消费 | Assistant.jsx handleEvent tool 分支 | 离散增量不经 rAF 缓冲（text 路径不变）；切会话 setMessages 全量替换自然清理（无需额外清理） |
| locator 约定（signoff 裁决 3） | ToolCallBlock `data-tool-block/header/body/error-badge` | 与 e2e/toolCallBlock.test.cjs 常量逐一对应（实现时对齐验证） |
| B8 历史无 tool 元素 | 历史对齐只产 kind:"text"（Slice 1 既有）+ MessageList 分流 | 渲染面断言：历史消息 SSR 无 data-tool-block（richRender 054 标准 3 断言面） |
| 硬约束：事件流/存储零改动 | 未触碰 worker/存储/API | 渲染层纯前端加法；Slice 3 事件字段直接消费 |

**refactor**：本切片无独立 refactor 轮（改动面：1 新组件 + 2 文件接线 + 1 CSS 块；归约函数/组件 memo 为内置形态）。

---

## 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-08-09 | 初始化：切片规划 + seam 速记 |
| v2 | 2026-08-09 | Slice 2 完成记录：高亮安全路线实证、M2 初判（16 语料）、PRD→代码 可追溯性表 |
| v3 | 2026-08-09 | Slice 3 完成记录：055 转发加法扩展（实证 + 实现 + harness 23/23 + seam 三缺陷报告） |
| v4 | 2026-08-09 | Slice 4 完成记录：052 工具折叠块（SSE 消费 + 三态组件 + error 终态 + interrupted 防御，harness 13/13 + 666 全绿） |
