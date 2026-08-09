# Requirements — PI Agent 对话富呈现（UX Enrichment）

> 故事 ID：`2026-08-08-pi-agent-ux-enrichment`
> 版本：v1
> 最后更新：2026-08-09
> 来源：`prd.md` v0.2（B1-B8）+ `tech-design.md` v0.2（接口 1-3、数据流 1-6、review-tech 全修复）
> 移动块 M1（长对话性能）/ M2（自动检测质量）留 PRD，验证后消化。
> UX 检查结论：全部稳定块涉及 `ux/assistant-rich.html`（已确认原型），均有可自动验证的结构/行为（渲染 DOM 断言/交互状态/主题切换），无 `人工(仅视觉)` 项；颜色/间距等审美留在 HTML 由 REFLECT 人工验收。

---

## REQ-AGENT-047 GFM Markdown 渲染管线（B1）

- 优先级 P0 / 必须 / intra-module / MarkdownRenderer, MessageList / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：接口 2（MarkdownRenderer props：`{text, streaming?, projectDir?}`）
- UX 参照：`ux/assistant-rich.html`（富文本消息）

验收标准：
1. GFM 全量渲染：标题（h1-h3）/ 列表（ul/ol）/ 表格（table+th/td）/ 引用（blockquote）/ 链接 / 行内代码 / 代码块（pre>code）均渲染为对应 DOM（E2E seed 含全部元素的 markdown 历史消息 → 断言元素存在）。
2. **HTML 全转义**：消息含 `<script>`/`<img onerror>`/`<iframe>` → 渲染为转义源码文本，DOM 中无 script/iframe 元素、无事件处理器执行（E2E XSS 语料断言）。
3. 任务列表（GFM checkbox）渲染为可勾选 checkbox（E2E 断言 input[type=checkbox]）。
4. 渲染失败不崩：任意输入不抛错（组件内兜底）。

## REQ-AGENT-048 代码高亮（B2）

- 优先级 P0 / 必须 / intra-module / MarkdownRenderer / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：highlight.js——围栏语言标记为主 + `highlightAuto` 兜底；双主题 CSS 随 `data-theme`
- UX 参照：`ux/assistant-rich.html`（代码块五色高亮）

验收标准：
1. ```js 围栏 → hljs 高亮渲染（code 元素含 `language-js` 类 + hljs token span，E2E 断言）。
2. 无语言标记代码块 → `highlightAuto` 自动检测着色（E2E 断言 code 元素含 hljs span 非纯文本）。
3. 裸命令/日志片段（自动检测兜底）→ 有基础着色或 plaintext 类（不报错）。
4. 主题切换：`data-theme` light↔dark 切换后高亮配色跟随（E2E 断言 token 变量/类变化）。

## REQ-AGENT-049 Mermaid 图表渲染（B3）

- 优先级 P1 / 应该 / intra-module / MarkdownRenderer / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：```mermaid 围栏 → 懒加载 mermaid 渲染为 SVG；`securityLevel:'strict'`；暗色独立配色类
- UX 参照：`ux/assistant-rich.html`（mermaid-block，浅/暗两套配色）

验收标准：
1. ```mermaid 围栏 → SVG 渲染（E2E 断言 svg 元素出现，非源码文本）。
2. 语法错误 → 回退显示围栏源码文本，不崩溃（E2E 断言）。
3. 暗色主题 → SVG 用暗色独立配色（E2E 断言 `[data-theme="dark"]` 下配色类/变量生效）。
4. `securityLevel:'strict'`：mermaid click 指令/HTML label 不注入 DOM（实现显式 initialize；E2E 用含 click 指令的图断言无事件绑定/无 HTML 元素注入）。
5. 流式期间未闭合 mermaid 围栏 → 显示字面量/骨架，闭合才渲染（W-1；E2E 最终态断言 + 流式期间无错误回退闪烁）。

## REQ-AGENT-050 KaTeX 公式渲染（B4）

- 优先级 P1 / 应该 / intra-module / MarkdownRenderer / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：`$...$` 行内 + `$$...$$` 块 → rehype-katex 渲染；失败回退源码
- UX 参照：`ux/assistant-rich.html`（math-inline/math-display）

验收标准：
1. `$E=mc^2$` 行内 → KaTeX DOM（katex 类元素，E2E 断言非字面量残留）。
2. `$$\int_0^1 x dx$$` 块 → 块级 KaTeX DOM（E2E 断言）。
3. 非法公式 → 回退显示源码文本，不崩溃（E2E 断言）。

## REQ-AGENT-051 图片显示（B5）

- 优先级 P1 / 必须 / cross-module / MarkdownRenderer, 主进程 HTTP API, Assistant.jsx / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：图片识别（Markdown 语法 + 裸路径后处理）；口径（相对路径按 `<projectDir>/<path>` 解析、项目目录内绝对路径可渲染、外占位）；访问机制（主进程 HTTP API 读文件 → blob URL，白名单判定在主进程）
- UX 参照：`ux/assistant-rich.html`（图片 + img-fallback）

验收标准：
1. `![alt](relative/path.png)`（项目内真实文件）→ img 元素渲染，src 为 blob URL（E2E 断言 img 可见 + 内容正确）。
2. 裸路径引用（text 节点中项目目录内存在的图片扩展名路径）→ 包成 img 渲染（I-4；E2E 断言）。
3. 项目目录内绝对路径 → 可渲染（I-5 口径；E2E 断言）。
4. 项目外路径 / 不存在 / 非白名单扩展名 → 占位提示（E2E 断言 img-fallback/占位文本）。
5. 主进程白名单判定：越权路径返回拒绝（HTTP API 层断言 + E2E 占位）。

## REQ-AGENT-052 工具调用折叠块（B6）

- 优先级 P0 / 必须 / cross-module / Assistant.jsx SSE, MessageList, ToolCallBlock / agent-dialogue / conversation-space / 浏览器 E2E + 集成
- 接口契约：接口 1 tool 元素生命周期（start 创建 / end|error 更新 / error 终态 / interrupted 防御）；接口 3（ToolCallBlock props）
- UX 参照：`ux/assistant-rich.html`（tool-block 三态）

验收标准：
1. `tool_execution_start` 事件 → 消息流出现折叠块：工具名 + 输入摘要，默认收起（E2E：OPC_FAUX_TOOL_SEQUENCE 驱动真实工具事件 → 断言块出现 + 收起态）。
2. 点击展开 → 显示完整输入/输出/耗时（E2E：点击后内容可见）。
3. `tool_execution_error`（或 isError:true 的 end）→ 块默认展开 + error 色 + 「执行失败」徽标（E2E 断言）。
4. **error 终态**：`start→error→end` 序贯后块仍保持 error 态，不被 end 降级（I-2；E2E/集成事件序列断言）。
5. error 无 toolCallId → 匹配最近 running 块（事件序列断言）。
6. text_end 时仍在 running 的块标记 interrupted（防御；事件序列断言）。

## REQ-AGENT-053 流式实时增量渲染（B7）

- 优先级 P0 / 必须 / intra-module / Assistant.jsx, MarkdownRenderer / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：rAF 节流缓冲保留；每帧完整累积文本喂 MarkdownRenderer（React.memo 缓存）
- UX 参照：`ux/assistant-rich.html`（stream-cursor / stream-raw）

验收标准：
1. 流式期间 `**` 未闭合 → 显示字面量，闭合后渲染为加粗（E2E：流式期间 bubble 稳定不崩溃 + 完成态断言加粗元素存在、无 `**` 字面量残留）。
2. 高速流（FAUX 1000 事件/秒）期间 UI 不冻结（E2E：流式期间 composer 可输入/滚动可操作）。
3. 完成态渲染正确：最终文本的 Markdown 全部渲染（无半渲染残留）。

## REQ-AGENT-054 历史消息统一管线 + 主题切换（B8）

- 优先级 P1 / 必须 / intra-module / MessageList, MarkdownRenderer / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：历史 GET messages → 全部 kind:"text"（工具不落历史）；旧消息走同一 Markdown 渲染
- UX 参照：`ux/assistant-rich.html`（历史会话 + theme-toggle）

验收标准：
1. 打开含 Markdown 语法的历史会话 → 旧消息渲染为 Markdown（E2E：seed 历史消息 → 打开 → 断言渲染元素）。
2. 纯文本历史消息 → 渲染后显示一致（无异常）。
3. 历史消息不产生 tool 元素（工具不落历史——E2E：历史打开无 tool-block）。
4. 主题切换（data-theme light↔dark）→ 高亮/Mermaid 配色跟随（与 048 标准 4 同断言）。

## REQ-AGENT-055 worker 工具事件转发加法扩展（I-1）

- 优先级 P0 / 必须 / cross-module / worker.js, toolAdapter 契约 / agent-dialogue / conversation-space / 集成
- 接口契约：`tool_execution_start` 转发加 `input`（=PI args）；`tool_execution_end` 转发加 `output`（=PI result 子集）+ `isError`；纯增量（无字段删除、text_*/confirmation-pending 消费方零感知）

验收标准：
1. `tool_execution_start` 事件含 `input` 字段（=PI 原生 args；fake worker 捕获断言）。
2. `tool_execution_end` 事件含 `output` 与 `isError`（isError 透传 PI 原生，不再丢弃；断言成功/失败两例）。
3. 既有事件消费方零感知：text_delta/text_end/confirmation-pending 形态不变（既有 662+ 回归不修改全绿）。

---

## REQ-AGENT-056 顶栏状态栏（B9）

- 优先级 P1 / 必须 / cross-module / worker, agentService, StatusBar / agent-dialogue / conversation-space / 浏览器 E2E + 集成
- 接口契约：接口 7（session-stats 推送）；git 分支读取（主进程，参考 pi footer-data-provider）
- UX 参照：`ux/assistant-rich.html`（composer 上方状态栏：执行状态/git 分支/上下文用量）

验收标准：
1. 状态栏位于 composer 上方，含三区：执行状态（空闲/回复中/工具执行中）、git 分支、上下文用量（tokens/contextWindow/percent 仪表）。
2. 执行状态随 streaming（回复中）与 tool 事件（工具执行中）切换，回复完成回空闲（E2E：FAUX 会话发消息断言状态切换）。
3. git 分支显示当前项目分支（主进程读 `.git/HEAD`，worktree 支持）；分离 HEAD → 显示 detached 态；非仓库 → 「无 git」/隐藏（E2E/单测：临时 git 仓库 fixture 三态）。
4. 上下文用量显示 tokens/contextWindow/percent（worker 周期调 `getContextUsage()` → session-stats 推送）；压缩后 tokens 为 null → percent 或占位。
5. stats 获取失败（worker 未就绪/异常）→ 状态栏隐藏/占位，对话不受阻（E7）。
6. 切会话/项目 → 分支与上下文用量跟随切换。

## REQ-AGENT-057 消息元数据（B10）

- 优先级 P1 / 应该 / cross-module / worker, agentService, MessageList / agent-dialogue / conversation-space / 集成 + 浏览器 E2E
- 接口契约：接口 6（text_end 加 `meta {durationMs, tokensIn, tokensOut}`——pi message_end 的 usage 实证）
- UX 参照：`ux/assistant-rich.html`（消息下方 `· 耗时 · in/out tokens`）

验收标准：
1. agent 回复完成 → 消息下方显示 meta：耗时 + in/out token（text_end 携带的 usage）。
2. 流式期间不显示 meta（完成态才出现）。
3. text_end 的 meta 为加法字段：既有消费方零感知（text_delta/text_end 字段集断言同步——055 标准 3 同 seam 更新）。
4. FAUX provider usage 为空/0 → meta 显示「-」或隐藏（不显示 0 误导）。

## REQ-AGENT-058 worker stats 接入（B11）

- 优先级 P1 / 必须 / cross-module / worker, agentService / agent-dialogue / conversation-space / 集成
- 接口契约：worker 调 `getSessionStats()`/`getContextUsage()`（pi SDK 实证）→ `session-stats` IPC → 主进程缓存推 renderer；git 分支读取（`.git/HEAD` + worktree + detached/非仓库态）

验收标准：
1. worker 周期（周期可注入，测试缩短）调 `getContextUsage()` → 主进程收 `session-stats {contextUsage}` 并缓存（集成：注入周期断言推送）。
2. git 分支读取：临时 git 仓库 fixture——正常分支名 / detached HEAD / 非仓库三态断言（含 worktree 支持）。
3. FAUX provider：stats 无值（usage 空/0）→ 不崩、推送空态（renderer 显示占位——056 标准 5 衔接）。
4. 既有 666 测试不回归（session-stats 为新事件，既有消费方零感知）。

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v1 | 2026-08-09 | 初版结晶：B1-B8 + I-1 → REQ-AGENT-047~055（M1/M2 留 PRD） | AI + 人 |
| v2 | 2026-08-09 | 范围扩展结晶：B9-B11 → REQ-AGENT-056~058（状态栏/消息元数据/stats 接入；cost 只显示 token 人拍板） | AI + 人 |
