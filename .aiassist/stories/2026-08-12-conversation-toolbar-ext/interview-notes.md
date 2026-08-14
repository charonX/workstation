# 访谈笔记 — 2026-08-12-conversation-toolbar-ext

> 5 轮 frontier 访谈 + 2 次外部调研（Claude Code 附件机制、DeepSeek/Moonshot 供应商 API）+ 本地 pi-ai 目录实证。
> 定稿：2026-08-12。方向：多 provider 会话级切换 + 图片/PDF 附件注入。

## 核心问题

对话区底部工具栏（ModeToolbar）只有权限模式切换，预留的「模型」「附件」两个槽位
（`toolbar-slot-model` / `toolbar-slot-attach`）灰显无功能。深层矛盾：模型配置是**全局
单一**（settings.agent.provider + apiKey，模型由 `DEFAULT_MODELS[provider]` 硬编码派生），
没有会话级选择的余地；且默认模型 kimi-k2.5 将于 2026-08-31 日落，硬编码目录已过时
（BUG-004 注释点名「模型配置化为后续 feature」）。附件则完全没有概念——Composer 只发纯文本。

## 用户画像

本机单用户工作站工具。决策快、偏好「不静默放行」的从严哲学（与 auto 判断 fail-safe
同思路）；交互模式持续对齐 Claude Code（上一 story 的 acceptEdits/auto 即如此）。

## 关键边界

1. **多 provider 列表**：每个配置条目 = provider + apiKey + 可选模型覆盖 + 默认标记；
   Settings 管理 UI（增删/选默认）进本 story。
2. **会话级切换语义**：切换保留对话历史，只影响切换之后的后续消息（worker 机制
   rebuild vs hot-swap 留 tech-design）。
3. **auto 永远用默认**：auto 判断模型不随会话切换漂移（现接线 worker.js:1063
   `createSessionDecide(runtime, modelObj)` 跟随会话模型 → 需解耦）。
4. **存量迁移**：现有单条 agent.provider/apiKey 自动成为列表第一条 + 默认标记，零操作升级。
5. **动态模型列表**：配置时从供应商 API 拉取（deepseek `GET /models` 仅 id、无能力
   元数据 → 视觉能力硬编码；kimi `GET /v1/models` 自带 supports_image_in/reasoning 标志）；
   拉取失败回退 pi-ai 静态目录。
6. **附件 v1 = 图片 + PDF**（文本/代码文件不做）；图片走 pi-ai image content block
   （base64 data URL），PDF 本地抽取文本注入。
7. **非视觉模型阻止附加图片**（pi-ai 对非视觉模型传图静默忽略——必须堵住）。
8. **附加即授权**：文件选择器 = 显式授权，项目外文件不弹确认、无特殊标记（对齐
   Claude Code「用户主动附加不弹、agent 主动读取才弹」）；agent 工具面照旧从严
   （envelope 系统级）。

## 隐含假设

1. 工具栏「模型」槽位实际语义 = provider 选择（provider+模型一体呈现）。
2. 附加 = 数据出境 → 从严确认（A7 已选 b）。
3. 附件随该条消息注入并成为会话历史的一部分（重放可见），不做持久系统上下文
   （对齐 Claude Code 官方语义）。
4. 会话的 provider 被删 → 回落默认 + 提示（不悬空）。

## 矛盾/风险

1. **IPC 256KB 硬约束（签核决策 15）vs 图片体积**（base64 普遍 1-5MB）→ 图片附件须
   独立通道（路径引用 + worker 侧读取，或专用 IPC），tech-design 必须解决。
2. **kimi-k2.5 8/31 日落** → 默认模型换 kimi-k3（本期）；DEFAULT_MODELS 硬编码过时
   机制 → 动态列表上线后默认值从动态结果取。
3. **deepseek 无能力元数据** → 动态列表只有 id，视觉能力探测只能硬编码
   （deepseek 全模型纯文本——事实已定）。
4. **auto decide 解耦**：默认模型变更时 worker 侧如何热更新（mode-change 式 IPC？
   还是重启会话）→ tech-design。
5. **动态拉取依赖 apiKey**：无 key 时回退静态目录；拉取时机（保存时/手动刷新）→ tech-design。
6. **图片持久化体积**：JSONL 存内容快照 vs 路径重读（水合后文件可能移动）→ tech-design。

## 候选方向

### 方向 A：多 provider 列表 + 会话级切换 + 动态模型列表 + 图片/PDF 附件注入（选定）
- 适用场景：用户要在会话间切换模型（deepseek 写作/代码 vs kimi 视觉任务），附件给
  agent 看图和 PDF。
- 主要取舍：范围大（Settings 数据模型 + worker 链路 + 附件协议三线并行）；换来自洽的
  配置体系和紧迫的默认模型修复。
- 推荐度：首选

### 方向 B：仅会话级模型覆盖（沿用全局单 provider）
- 适用场景：只想在固定模型间切。
- 主要取舍：实现小，但解决不了「多 provider 并存」和 k2.5 日落；动态列表也无从谈起。
- 推荐度：不推荐（Q2 被否决）

### 方向 C：附件只做文本/代码文件
- 适用场景：最小附件实现。
- 主要取舍：用户明确要图片+PDF（图是视觉模型的主场景）；文本文件留后续。
- 推荐度：不推荐（用户否决）

## 确认方向

最终确认的方向：**方向 A**

确认意图（人拍板 2026-08-12）：

- Outcome: 工具栏模型/附件槽位成为可用功能——会话级切换已配置 provider（动态模型
  列表），图片/PDF 附件注入上下文。
- User: 本机用户（工作站单人使用）
- Why now: ① 上 story（pi-agent-modes）预留的 M4 移动块；② BUG-004 注释点名「模型
  配置化」为后续 feature；③ **kimi-k2.5 8/31 日落，默认模型必须换**。
- Success: ① 工具栏切换 provider 后下一条消息用新 provider 回复、历史完整保留；
  ② 新会话初始 = 默认 provider；③ auto 判断走默认模型；④ Settings 能增删 provider、
  标记默认、每条目可选模型（动态列表）；⑤ 附件（图/PDF）内容模型可见。
- Constraint: auto 永远用默认；非视觉模型阻止附加图片；IPC 256KB 硬约束（附件独立
  通道）；项目外附件弹确认；模型从真实列表选（非自由文本）。
- Out of scope: 供应商能力探测的 deepseek 侧（能力硬编码）；图片拖拽/粘贴入口；
  文本/代码文件附件；PDF OCR 增强（kimi Files API）；并行多 provider；会话模型记忆；
  附件生命周期管理（compaction）。

确认理由：k2.5 日落制造紧迫性；动态模型列表是 BUG-004 既定方向；附件选图+PDF 是
视觉场景的主流需求。

## 最窄的切入点

Settings 多 provider 数据模型 + 动态模型列表 + 会话切换链路（→ worker 配置）——
这是附件的前置（附件依赖「会话当前模型是否视觉」判断）。附件协议可并行设计。

## 关键决策清单（契约锚点）

| # | 决策 | 值 |
|---|---|---|
| Q1 | story 范围 | 一个 story：模型 + 附件都做（工具栏扩展） |
| Q2/Q5 | 配置形态 | provider 列表（provider+apiKey+可选模型覆盖+默认标记）；Settings 管理 UI 进本 story |
| Q6 | 切换语义 | 保留历史，只影响后续消息 |
| Q7 | auto 模型 | 永远用默认（与会话解耦） |
| Q9 | 迁移 | 存量单条配置 → 列表第一条 + 默认 |
| Q10 | 默认语义 | 新会话初始 = 默认；auto = 默认 |
| Q11 | 模型选择 | 真实模型列表（动态拉取 + 回退），非自由文本 |
| Q12 | 删除兜底 | 会话 provider 被删 → 回落默认 + 提示 |
| Q13 | 成功标准 | 5 条（见上 Success） |
| Q14a | 动态模型列表 | 做：deepseek /models（能力硬编码）+ kimi /v1/models（能力标志直接消费） |
| Q14b-d | 砍掉 | 并行多 provider、会话记忆、图片外附件入口扩展 |
| Q15 | 非视觉附加 | 阻止 + 提示 |
| A1 | 附件类型 | 图片（jpeg/png/gif/webp/bmp/heic/heif，SVG 拒收）；**PDF 本期放弃留后续**（tech-design 2026-08-12 人拍板） |
| A2 | 附件数量 | 每消息 ≤10 个 |
| A3 | 注入 | 随消息注入 + 会话历史（**pi-ai 原生序列化**，零自定义）；JSONL 落路径引用 + 内容快照（实证：pi-ai README Context Serialization + pi-coding-agent JSONL stringify） |
| A4 | 入口 | 工具栏附件按钮 → 文件选择器 |
| A6 | ~~PDF 路径~~ | **放弃**（本期不做；OCR/本地抽取均留后续 story） |
| A7 | 权限面 | **附加即授权**（DESIGN 复核反转：选择器即显式授权，项目外文件不弹确认、无特殊标记——对齐 Claude Code「用户主动附加不弹，agent 主动读取才弹」；agent 工具面照旧从严） |
| A8 | 默认模型 | moonshotai → kimi-k3（在售旗舰，视觉+1M）；DEFAULT_MODELS 本期同步 |

## 调研引用（供 tech-design / PRD 引用）

- Claude Code 附件机制（官方文档）：code.claude.com/docs/en/common-workflows
  （@ 引用 full content in conversation）、interactive-mode（粘贴 [Image #N] chip）、
  tools-reference（Read 工具 PDF 分页）、terminal-config（大文本折叠）、
  permissions（工作目录外 Read 必弹确认）；platform.claude.com vision（格式/大小限制）。
- pi-ai 0.83 本地实证：image content block `{type:'image',data,mimeType}`；
  `model.input.includes('image')` 判定视觉；非视觉模型传图**静默忽略**（README 原文）；
  deepseek/moonshot 为静态内置目录（`models.refresh()` no-op）；deepseek 全模型
  text-only，kimi-k2.5/2.6/2.7-code/k3 支持 text+image。
- DeepSeek API：api-docs.deepseek.com/api/list-models（GET /models，仅
  id/object/owned_by）；无视觉、无 PDF（官方 API 侧栏/更新日志实证）。
- Moonshot/Kimi API：platform.kimi.ai/docs/api/list-models（能力标志，官方推荐动态
  拉取）；use-kimi-vision-model（格式白名单、仅 base64 data URL、请求体 ≤100MB、
  建议 ≤4K 分辨率）；files-upload + file-based-qa（purpose="file-extract" 抽文本 +
  OCR，注入 system message，100MB/文件）；models 页（**kimi-k2.5 2026-08-31 日落**，
  k3 1M 视觉旗舰在售；CN 站 api.moonshot.cn 与国际站 key 不通用）。

## 待确认问题（PRD 阶段需定，不阻塞）

- [ ] 动态模型列表的缓存与刷新时机（保存配置时拉取？手动刷新按钮？）
- [ ] 会话切换的 worker 机制（rebuildSession 式换代 vs 热更新配置）
- [ ] 图片附件独立通道的形态（路径引用 + worker 读取 vs 专用 IPC）
- [ ] auto decide 解耦的注入形态（session-config 携带 defaultJudgeModel vs 主进程预热）
- [ ] 图片 JSONL 持久化（内容快照 vs 路径重读）
