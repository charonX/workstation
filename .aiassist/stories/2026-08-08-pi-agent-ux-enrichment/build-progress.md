# Build Progress — 2026-08-08-pi-agent-ux-enrichment

> 阶段：BUILD（门 1 已签核，1464be4）
> REQ：REQ-AGENT-047~055（requirements v1，hash dfd35b8a）
> 测试契约：4 文件 16 用例（已签核，实现者只读）

## 切片规划（依赖序）

| # | REQ-ID | 内容 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | REQ-AGENT-047/053 | 依赖引入 + Markdown 管线（react-markdown+remark-gfm+HTML 转义）+ 消息模型 kind:text 接入 MessageList | — | done（2026-08-09） |
| 2 | REQ-AGENT-048 | 代码高亮（highlight.js 围栏+auto+双主题 CSS） | 1 | pending |
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

## 版本记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-08-09 | 初始化：切片规划 + seam 速记 |
