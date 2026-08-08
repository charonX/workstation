# Build Progress — 2026-08-08-pi-agent-ux-enrichment

> 阶段：BUILD（门 1 已签核，1464be4）
> REQ：REQ-AGENT-047~055（requirements v1，hash dfd35b8a）
> 测试契约：4 文件 16 用例（已签核，实现者只读）

## 切片规划（依赖序）

| # | REQ-ID | 内容 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | REQ-AGENT-047/053 | 依赖引入 + Markdown 管线（react-markdown+remark-gfm+HTML 转义）+ 消息模型 kind:text 接入 MessageList | — | done（2026-08-09） |
| 2 | REQ-AGENT-048 | 代码高亮（highlight.js 围栏+auto+双主题 CSS） | 1 | done（2026-08-09） |
| 3 | REQ-AGENT-055 | worker 工具事件转发加法扩展（start+input/end+output+isError） | — | pending |
| 4 | REQ-AGENT-052 | 工具折叠块（消息模型 kind:tool + SSE 消费 + ToolCallBlock 三态） | 1,3 | pending |
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

## 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-08-09 | 初始化：切片规划 + seam 速记 |
| v2 | 2026-08-09 | Slice 2 完成记录：高亮安全路线实证、M2 初判（16 语料）、PRD→代码 可追溯性表 |
