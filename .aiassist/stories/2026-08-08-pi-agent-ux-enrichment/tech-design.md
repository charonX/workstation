# 技术方案 — PI Agent 对话富呈现（UX Enrichment）

> 故事 ID：`2026-08-08-pi-agent-ux-enrichment`
> 版本：`v1`
> 最后更新：2026-08-08
> 输入：`prd.md` v0.1（B1-B8）、`interview-notes.md`（D1-D9）、`ux/assistant-rich.html`（已确认原型）、tokens.css 代码高亮 token 组（模式 A 已补）

---

## 设计目标

把会话区对话从纯文本升级为富呈现：**渲染层整体替换**（消息模型类型化 + Markdown 管线 + 工具折叠块），
事件流与存储契约零改动（B8 硬约束），HTML 全转义零 XSS 面，代码高亮/图表/公式/图片按用户拍板的能力集落地。

## 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| `MarkdownRenderer`（renderer 组件） | GFM 渲染（react-markdown + remark-gfm）+ HTML 全转义（**不引 rehype-raw**）+ 代码高亮（highlight.js：围栏标记 + highlightAuto 兜底，双主题 CSS 随 data-theme）+ KaTeX（remark-math + rehype-katex）+ Mermaid（```mermaid 围栏，动态 import 懒加载，暗色独立配色类）+ 图片（项目目录白名单解析） | 是 |
| `ToolCallBlock`（renderer 组件） | 工具折叠块：收起态（工具名+输入摘要）/ 展开态（输入/输出/耗时）/ 错误态（默认展开+error 色）；toolCallId 关联事件更新 | 是 |
| `MessageList`（改） | 按消息 kind 分流：text → MarkdownRenderer；tool → ToolCallBlock；确认卡逻辑不变 | 否（改） |
| `Assistant.jsx` SSE 处理（改） | `tool_execution_*` 事件消费（现零消费）：start 创建 tool 消息元素 / end|error 按 toolCallId 更新；rAF 节流缓冲保留（text 路径不变） | 否（改） |
| `worker.js` 工具事件转发（改） | **兼容性加法扩展**（review I-1 裁决）：`tool_execution_start` 转发加 `input`（=PI args）、`tool_execution_end` 转发加 `output`（=PI result 子集）+ `isError`（PI 原生字段实证存在，`pi-coding-agent` agent-session.js:487-516）——纯增量，renderer 当前零消费 tool 事件、`text_*`/`confirmation-pending` 消费方零感知 | 否（改） |
| 消息模型（renderer 状态） | `messages[]` 元素类型化：`{kind:"text"|"tool", id, ...}`（见接口 1） | 是（状态形态） |
| 图片路径解析（小模块） | 相对路径按会话项目目录解析 + 图片扩展名白名单；越权占位 | 是 |

### 模块关系图

```
SSE 事件流（text_start/delta/end【既有】+ tool_execution_start/end/error【新增消费】）
   │
   ▼
Assistant.jsx handleEvent（+ tool_execution 分支；rAF 缓冲保留）
   │  messages[] {kind:"text"|"tool"}
   ▼
ChatView → MessageList（按 kind 分流）
   ├─ text  → MarkdownRenderer ── react-markdown+remark-gfm ──┐
   │           ├─ 代码块 → highlight.js（标记+auto，双主题 CSS）│
   │           ├─ mermaid 围栏 → 懒加载 mermaid（暗色配色）    │── 全部 HTML 转义
   │           ├─ 公式 → rehype-katex（katex CSS）             │   （无 rehype-raw）
   │           └─ 图片 → 项目目录白名单解析（越权占位）        ┘
   └─ tool  → ToolCallBlock（收起/展开/错误展开标红）
```

## 数据流

1. **历史对齐（GET messages）**：映射 `{kind:"text", id, role, text, streaming:false}`——纯文本消息全部走 Markdown 渲染（B8 统一管线；工具不落历史 → 无 tool 元素）。
2. **流式文本（text_start/delta/end）**：现状保留（rAF 节流缓冲整条 text）——每帧用**完整累积文本**喂 MarkdownRenderer（天然实时增量：未闭合语法显示字面量，闭合即渲染，D5 策略零额外机制）。
3. **流式工具（tool_execution_start）**：handleEvent 新增分支 → append `{kind:"tool", id:toolCallId, name, input, status:"running"}` 消息元素（input = worker 加法扩展后的 PI args）。
4. **工具完成/失败（tool_execution_end/error）**：按 `toolCallId` 更新对应元素（end → status:"completed" + output + durationMs；**isError:true 的 end → status:"error"**——I-2 修复：错误终态不被随后 end 覆盖；error → status:"error" + errorCode/errorMessage + **默认展开**）。**error 事件无 toolCallId**（toolAdapter.js:359 实证）→ 关联策略 = 匹配该 agent turn 内最近一个 `status:"running"` 的 tool 块；**error 为终态**（error 后到达的 completed end 不再降级——I-2 双保险）。SSE 层若未来补 toolCallId 则优先精确匹配。
5. **渲染**：MessageList 按 kind 分流；MarkdownRenderer 对 text 渲染（React.memo 按 text 缓存——流式每帧重渲染完整文本，结束即稳定；长消息卡顿归 M1 观察）；ToolCallBlock 按 status 渲染三态。
6. **图片解析与访问（I-3/I-4/I-5 裁决）**：
   - **识别**：① Markdown 图片 `![alt](path)`；② **裸路径后处理**（review I-4 裁决）——text 节点中匹配「项目目录内真实存在 + 图片扩展名白名单（png/jpg/jpeg/gif/webp/svg）」的路径 → 包成 img（误判面小：路径必须真实存在且是图片）。
   - **口径**（review I-5 裁决）：白名单按**解析后是否在项目目录内**判定——**相对路径按 `<projectDir>/<path>` 解析，项目目录内的绝对路径同样可渲染**；解析后出项目目录 / 不存在 / 非白名单扩展名 → 占位提示（E3）。
   - **访问机制**（review I-3 裁决）：**主进程中介**——renderer 经本地 HTTP API（ADR-001）读文件 → blob URL 渲染。理由：dev（http://localhost）与 prod（file://）origin 一致可用（`<img src="file://...">` 在 dev 被 Chromium scheme 混合规则拦截）；白名单判定在主进程（renderer 侧判定为弱防线，可接受但写明：主进程按项目目录边界 + 扩展名白名单校验后放行）。

## 接口契约

### 接口 1：消息模型（renderer 状态形态）

| 项目 | 说明 |
|---|---|
| text 元素 | `{ kind:"text", id, role:"user"|"agent", text, streaming?:boolean }`（现状字段 + kind） |
| tool 元素 | `{ kind:"tool", id:toolCallId, name, status:"running"|"completed"|"error", input?, output?, errorCode?, errorMessage?, durationMs?, streaming? }`（`rejected`/`pending` 为**未来契约扩展预留**——当前 worker 固定映射 completed、toolAdapter 的 pending/rejected end 不被转发，S-1 修正） |
| 生命周期 | start 创建（id=toolCallId，input=PI args）→ end 按 id 更新（output + isError:true → status:"error"）/ error 按最近 running 匹配更新；**error 为终态**（其后 end 不降级）；text_end 时仍在 running 的 tool 块标记 interrupted（防御：turn 结束未收到 end） |
| 历史对齐 | 只产出 text 元素（B8：工具不落历史） |

### 接口 2：MarkdownRenderer props

| 项目 | 说明 |
|---|---|
| props | `{ text: string, streaming?: boolean, projectDir?: string }` |
| 输出 | 安全 HTML（React 元素树——react-markdown 默认转义 HTML，无 rehype-raw 即无原始 HTML 进入 DOM） |
| 图片 | `projectDir` 提供解析根；相对路径/项目内绝对路径经**主进程 HTTP API 读文件 → blob URL**（I-3 机制）；无 projectDir（通用空间）→ 仅项目内相对路径，无根则占位 |
| 主题 | 高亮/katex/mermaid 配色随 `document.documentElement[data-theme]`（CSS 变量 + 显式暗色类，D9） |
| 错误回退 | mermaid/katex 语法失败 → 显示围栏源码文本（E1/E2）；**mermaid 显式 `securityLevel:'strict'`**（I-6：click 指令/HTML label 脚本注入面关闭，写入 ADR-021）；高亮库加载失败 → 无高亮纯文本（E4 变体） |
| 流式 mermaid | **streaming 时未闭合 mermaid 围栏（code 块延伸到 EOF）显示字面量/骨架，闭合才渲染**（W-1：避免每帧对不完整语法跑慢速 mermaid 渲染 → 掉帧 + 错误回退闪烁） |

### 接口 3：ToolCallBlock props

| 项目 | 说明 |
|---|---|
| props | `{ tool: ToolElement, defaultOpen?: boolean }` |
| 形态 | 收起态：工具名 + 输入摘要（输入序列化截断 ≤80 字符，原型语义）+ chevron；展开：输入/输出/耗时；status:"error" 默认展开 + error 色 + 「执行失败」徽标 |
| 交互 | 点击 header 切换展开（纯组件状态） |

## 测试 seams

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| B1 GFM + 转义 | MarkdownRenderer 组件渲染（fixture text → DOM 断言：h2/table/ul 存在；`<script>` 不出现） | 组件 | 真实渲染器 |
| B2 代码高亮 | 组件渲染（```js 标记 → hljs 类；无标记 → auto；data-theme 切换 → 双主题 CSS） | 组件 / E2E | 真实 hljs |
| B3 Mermaid | 组件渲染（mermaid 围栏 → svg；语法错 → 源码回退；暗色配色类随 data-theme） | 组件 / E2E | mock 懒加载（或真实 mermaid） |
| B4 KaTeX | 组件渲染（`$`/`$$` → katex DOM；错 → 源码回退） | 组件 | 真实 katex |
| B5 图片 | 组件渲染（相对路径 → img；项目内绝对路径 → img；项目外/不存在/非白名单 → 占位）+ **裸路径识别 case**（I-4：text 节点中项目内存在的图片路径 → img） | 组件 / E2E | 真实文件 fixture |
| B6 工具折叠块 | 组件渲染（三态 fixture）+ Assistant.jsx SSE 事件序列（start→end / start→error / **start→error→end 序贯后块仍 error**（I-2）/ error 无 id 匹配最近 running） | 组件 / 集成 | 事件序列构造 |
| B7 流式实时 | 组件渲染（delta 序列：`**` 未闭合字面量 → 闭合加粗；完成态正确）+ **B3×B7 交互：未闭合 mermaid 围栏流式期间显示字面量、闭合才渲染**（W-1） | 组件 / E2E | 序列构造 |
| B8 历史统一管线 | 组件渲染（历史纯文本 fixture → Markdown 渲染；无 tool 元素） | 组件 | — |
| M1 性能 | E2E 长消息实测（QA） | QA 观测 | 真实 |
| M2 自动检测质量 | 组件渲染（裸命令/日志 fixture → 断言有高亮 span） | 组件 | 真实 hljs |

capability/entity 落位：`agent-dialogue/conversation-space`（渲染组件/消息模型）+ 既有 E2E 目录（assistantChat 同型）。

## 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 消息模型 | 元素类型化（kind: text/tool）✅ / 双数组归并 | 事件序=渲染序单数组统一；历史对齐零工具块无归并复杂度 | tool 元素随会话切换需清理（切会话 setMessages 全量替换，自然清理） |
| 高亮库 | highlight.js ✅ / Shiki / Prism | 自动检测硬需求（D2）+ 轻量 + 双主题 CSS 简单；Shiki 质量溢价在对话场景不值包体 | 复杂语法质量中等于边缘 case（M2 验证） |
| 图片边界 | 项目目录白名单 ✅ / 任意本地路径 | 对话历史长期留存，绝对路径=敏感影像入史；占位保留可发现性 | 引用项目外图片时需手动打开（可接受） |
| HTML 处置 | 全转义（无 rehype-raw）✅ / 白名单渲染 | D3 人拍板；零 XSS 面比 pi-web 的 sanitize 更简 | agent 输出富 HTML 时显示源码（已接受） |
| 流式渲染 | 每帧全量（rAF 既有缓冲 + memo）✅ / 块级增量 | 既有 rAF 缓冲天然承载实时增量；块级增量复杂度不值（M1 触发再优化） | 长消息每帧重解析（M1 观察） |
| error 关联 | 最近 running 块匹配 ✅ / 补 toolCallId | error 事件无 toolCallId（实证）；工具串行执行语义安全；**error 为终态（其后 end 不降级）** | 并发工具（未来）需补 id——记录 tech-design 风险 |
| 工具事件数据源 | worker 转发加法扩展（start+input / end+output+isError）✅ / 收起态仅工具名 | review I-1 裁决；PI 原生字段实证存在；纯增量无消费者破坏 | worker 转发改动（[build] 范畴，事件契约加法） |
| 图片访问机制 | 主进程 HTTP API 读→blob URL ✅ / file:// 直链 / custom protocol | review I-3 裁决；dev/prod origin 一致（file:// 在 dev 被拦截）；白名单判定在主进程 | 新增 HTTP 端点（ADR-001 既有形态） |
| mermaid 安全 | `securityLevel:'strict'` 显式 ✅ / 默认值依赖 | review I-6 裁决；零 XSS 主张覆盖 mermaid 路径；不依赖运行库默认（升级/换库不漂移） | strict 下 click 指令/HTML label 禁用（对话场景可接受） |
| ADR 计划 | **ADR-021 对话渲染安全边界**：LLM 输出 HTML 全转义 + 图片项目白名单（主进程判定 + blob URL 机制）+ mermaid securityLevel:'strict'（三条件满足：安全姿态难逆转/未来渲染面会问为什么/便利 vs 安全真实取舍） | 安全决策落档 | — |

## 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| react-markdown 系 Electron 打包兼容（隐含假设 1） | 渲染管线换替代（如 marked + 自写 React 包装） | TECH-DESIGN（依赖层） | 能（BUILD 首切片 vite build 即验） |
| hljs 自动检测质量可接受（M2） | 收窄为 plaintext 兜底 | TECH-DESIGN（高亮配置） | 能（组件 fixture 即验） |
| Mermaid 懒加载在 vite/forge 打包可用 | 静态 SVG 替代（原型同款） | TECH-DESIGN（B3 降级） | 能（BUILD 验证） |
| 流式每帧全量渲染长消息不卡（M1） | 块级增量或虚拟化 | PRD（M1 入 REQ） | 能（QA 实测） |
| error 无 toolCallId 的最近-running 匹配在并发工具下错配 | 未来补 toolCallId 精确匹配 | TECH-DESIGN（关联策略） | 否（并发工具未出现；记录待办） |
| 图片占位策略影响体验 | 项目外图片频繁引用时用户不便 | PRD（B5 放宽） | 能（使用观察） |
| 工具事件加法扩展与 worker 既有转发冲突（I-1 对应风险） | 转发改动破坏既有 tool 事件消费（当前零消费，风险低） | TECH-DESIGN（加法扩展范围） | 能（BUILD 切片跑既有 662 回归即验） |
| 图片 blob URL 机制（I-3 对应风险） | 主进程 HTTP API 新端点与既有 API 形态冲突 / 大图内存 | TECH-DESIGN（访问机制换 custom protocol） | 能（BUILD 验证） |
| mermaid securityLevel 严格模式行为（I-6 对应风险） | strict 下部分图表（click/HTML label）渲染受限，与原型观感偏差 | TECH-DESIGN（B3 降级为源码显示） | 能（BUILD 组件 fixture 即验） |

## 范围外与约束

- PRD §12 全八条（HTML 渲染/飞书侧/存储升级/历史工具回填/能力层/产品形态层/编辑器/上传）。
- 硬约束：**事件流契约「零改动」= 无字段删除、无既有消费者破坏**（review I-1 语义改写）——tool_execution 转发为**兼容性加法扩展**（start+input / end+output+isError），`text_*`/`confirmation-pending` 及既有消费方零感知；消息存储契约零改动（B8）；既有 E2E 与 662+ 测试不回归。
- 安全（security.md）：HTML 全转义（无原始 HTML 入 DOM）、图片主进程白名单（项目目录边界 + 扩展名白名单 + blob URL）、**mermaid securityLevel:'strict'**（I-6）、无新信任边界（渲染只读展示）。
- 性能（performance.md）：rAF 节流既有、mermaid 懒加载、hljs 按语言动态加载（core + 常用语言注册）、React.memo 渲染缓存。
- 可观测性：渲染层无新 telemetry（组件错误回退不崩即静默）；图片占位/越权可打 console.warn（可观测性面最小）。

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-08 | 初稿（三轮单题收敛：消息模型类型化 / highlight.js / 图片项目白名单 + 工具事件契约实证） | AI + 人 |
| v0.2 | 2026-08-09 | review-tech 修复（WARN，6 IMPORTANT 全裁决）：I-1 工具事件加法扩展（人裁决）/ I-2 error 终态（isError 转发 + 不降级双保险）/ I-3 图片主进程 HTTP API→blob URL（人裁决项目内绝对可渲染）/ I-4 裸路径识别（人裁决）/ I-5 PRD F3 口径同步 / I-6 mermaid securityLevel:'strict'；W-1 mermaid 流式字面量；W-2 风险表 +3；S-1 状态枚举去 rejected + spike 口径修正 | AI + 人 |

---

# 增量 v0.3 — 会话状态可视化（B9/B10/B11，2026-08-09 范围扩展）

> 输入：PRD v0.3（B9-B11）+ research/pi-usage-token-git.md（数据源实证）

## 设计目标（增量）

对话窗呈现会话级与消息级状态：**composer 上方状态栏**（执行状态 + git 分支 + 上下文用量，人确认位置）+ **消息元数据**（耗时 + token）。数据全部来自 pi 官方接口（getSessionStats/getContextUsage），零自造统计。

## 模块与边界（增量）

| 模块 | 职责 | 是否新增 |
|---|---|---|
| `worker.js` stats 接入（改） | 调 `session.getSessionStats()` / `getContextUsage()`（pi SDK 实证）；git 分支读取（参考 pi footer：读 `.git/HEAD` + worktree 支持 + detached/非仓库态）；经既有 IPC 推主进程 | 否（改） |
| 主进程 agentService（改） | 收 stats 数据 → 缓存 + 推 renderer（SSE 事件 / 轮询端点） | 否（改） |
| `StatusBar`（renderer 新组件） | composer 上方：执行状态（空闲/回复中/工具执行中——复用 streaming + tool 事件驱动）+ git 分支 + 上下文用量（tokens/percent 仪表） | 是 |
| `MessageMeta`（renderer 新组件/内联） | 消息下方：耗时 + in/out token（message_end 携带） | 是 |
| 消息模型（扩展） | text 元素加 `meta: {durationMs?, tokensIn?, tokensOut?}`（完成态填充） | 是（状态形态） |

### 数据流（增量）

1. **消息元数据**：worker 收到 PI `message_end`（assistant message 携带 `usage`——调研实证）→ text_end 转发加 `meta {durationMs, tokensIn, tokensOut}`（durationMs 由 turn 起止计算——text_start 记录时间戳）→ renderer 完成态填充消息 meta。
2. **上下文用量**：worker 定时（如每 5s，可注入）调 `getContextUsage()` → `session-context` IPC → 主进程缓存 → SSE/轮询推 renderer → StatusBar 仪表（tokens/contextWindow/percent；压缩后 tokens 为 null → 显示 percent 或占位）。
3. **git 分支**：主进程（项目目录边界一致）读 `<projectDir>/.git/HEAD`（参考 pi footer-data-provider：HEAD 直读 + worktree 支持 + detached/非仓库态）→ 随会话打开/切换推 renderer；500ms debounce 监听 HEAD 变化（可选）。
4. **执行状态**：纯 renderer 推导——streaming（回复中）+ tool 事件（工具执行中）+ 空闲——无需新数据。

### 接口契约（增量）

**接口 6：消息元数据（text_end 扩展）**

| 项目 | 说明 |
|---|---|
| 扩展 | text_end 事件加 `meta: {durationMs?, tokensIn?, tokensOut?}`（pi message_end 的 usage 实证存在；durationMs 主进程/worker 按 text_start 起止） |
| 消费方 | renderer 完成态填充消息 meta（流式期间不显示——原型语义） |
| 兼容 | 加法字段，既有消费方零感知（text_end 字段集断言 `["content","type"]` 需更新——055 标准 3 同 seam 注意） |

**接口 7：session stats（worker → 主进程 → renderer）**

| 项目 | 说明 |
|---|---|
| worker→主 | `session-stats {contextUsage}` IPC（周期推送，周期可注入——测试缩短） |
| 主→renderer | SSE 事件 `session-stats`（或复用轮询端点——实现者按既有 SSE 形态定） |
| renderer | StatusBar 消费（tokens/contextWindow/percent；null → 占位） |
| git 分支 | 会话打开/切换时经会话元数据或单独事件推（`{branch, state: "branch"|"detached"|"none"}`） |

### 测试 seams（增量）

| 稳定块 | Seam | 测试类型 |
|---|---|---|
| B9 状态栏（执行状态/git/上下文） | StatusBar 组件渲染 + E2E（FAUX 会话：状态随流式/工具切换、分支显示、上下文仪表） | 组件 / E2E |
| B10 消息元数据 | text_end meta 断言（fake worker/集成）+ E2E（完成态 meta 出现、流式期间无） | 集成 / E2E |
| B11 数据源 | worker stats 接入（注入缝/真实 FAUX stats——FAUX provider usage 可能为 0/估算）+ git 读取单测（临时 git 仓库 fixture：正常/detached/非仓库） | 单元 / 集成 |

### 关键决策（增量）

| 决策 | 选项 | 选择理由 |
|---|---|---|
| 元数据推送 | message_end 携带（text_end 加 meta）✅ / 轮询 | 调研实证 usage 在 assistant message 上；事件携带零轮询开销 |
| 上下文推送 | 周期轮询（worker 侧 getContextUsage）✅ / 事件 | 无 usage 事件（调研实证）；5s 周期可注入 |
| git 读取位置 | 主进程（项目目录边界一致）✅ / renderer 直读 | 与图片白名单同源（主进程单一权威）；参考 pi footer 实现 |
| 成本显示 | 只显示 token ✅（2026-08-09 人拍板）/ 聚合 cost | 金额敏感 + FAUX 恒 0 测试因扰；getSessionStats 聚合 cost 留作未来项（范围外 10 更新） |

### 风险（增量）

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| FAUX provider 的 usage 非空（stats 有值） | 元数据/仪表在测试环境恒空 → E2E 断言难 | TECH-DESIGN（估算兜底 estimateTokens） | 能（BUILD 首切片即验） |
| getSessionStats/getContextUsage 在 worker 集成形态可调 | 需深路径导入或 RPC（get_session_stats） | TECH-DESIGN（接入机制换） | 能（BUILD 验证） |
| 压缩后 context tokens 为 null | 仪表显示 percent 或占位 | PRD（B9 显示语义） | 能（压缩事件实测） |
| git HEAD 读取与 pi 行为一致 | 分支显示偏差 | TECH-DESIGN（实现对齐 footer） | 能（临时仓库 fixture） |
