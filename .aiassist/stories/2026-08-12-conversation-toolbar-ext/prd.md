# 对话区工具栏扩展（模型选择 + 附件）

> 状态：探索期
> 故事 ID：`2026-08-12-conversation-toolbar-ext`
> 最后更新：2026-08-12
> 输入：`interview-notes.md`（5 轮访谈 + 2 次外部调研 + pi-ai 本地实证，方向 A）

---

## 1. 问题陈述

对话区底部工具栏（ModeToolbar）目前只有权限模式切换，「模型」「附件」两个槽位
（`toolbar-slot-model` / `toolbar-slot-attach`）灰显占位——**预留了位置却没有任何
功能**。想换模型只能去 Settings 改全局单 provider（改完所有会话重建、历史丢失）；
想给 agent 看个图或 PDF 完全无门——Composer 只能发纯文本。而默认模型 kimi-k2.5
将于 2026-08-31 日落（还有 19 天），硬编码的 `DEFAULT_MODELS` 指向一个即将死掉的
模型：**模型配置不升级，app 的默认对话会在本月内断链**。

## 2. 解决方案

把工具栏两个槽位变成可用功能，并把模型配置从「全局单一」升级为「多 provider 列表」：

- **多 provider 配置**：settings 存 provider 列表（provider + apiKey + 可选模型覆盖 +
  默认标记）；Settings 页升级为列表管理（增删、标记默认、每条目选模型）；存量单条
  配置自动迁移为列表第一条 + 默认；
- **动态模型列表**：配置条目时从供应商 API 拉取可用模型（kimi `/v1/models` 自带
  能力标志直接消费；deepseek `/models` 仅 id，视觉能力硬编码），失败回退内置目录；
- **会话级切换**：工具栏模型选择器列出已配置条目，当前会话切换后**历史保留、只影响
  后续消息**；新会话初始 = 默认；会话的 provider 被删 → 回落默认 + 提示；
- **auto 判断解耦**：auto 模式的模型判断永远用默认 provider/模型（现接线跟随会话
  模型，需解耦）；
- **附件 v1 = 图片**（PDF 本期放弃，2026-08-12 tech-design 人拍板，见 §12）：随消息
  注入上下文并进会话历史（pi-ai 原生持久化，零自定义）；非视觉模型阻止附加图片
  （pi-ai 对非视觉模型传图静默忽略——必须堵住）；附件经文件选择器添加——**选择即
  显式授权，项目外文件不弹确认、无特殊标记**（对齐 Claude Code：确认针对 agent
  主动读取，用户主动附加不弹；agent 工具面照旧从严）；
- **默认模型刷新**：moonshotai 默认 kimi-k2.5 → kimi-k3（在售旗舰，视觉 + 1M 上下文）。

## 3. 用户故事

1. 作为**本机用户**，我想要在 Settings 配置多个 provider（各自 apiKey、可选模型），
   以便不同任务用不同模型而不用反复改全局配置。
2. 作为**本机用户**，我想要在配置 provider 时看到它真实的可用模型列表（自动拉取），
   以便选到一个真实存在、能力匹配的模型，而不是手输一个可能不存在的名字。
3. 作为**本机用户**，我想要在对话区工具栏直接切换当前会话的 provider，
   以便写代码时用 deepseek、看视觉任务时切 kimi，且切换不丢对话历史。
4. 作为**本机用户**，我想要新会话默认用我标记的默认 provider，以便不用每次都手动选。
5. 作为**本机用户**，我想要 auto 模式的判断始终用默认模型，以便判断链路不因会话
   切换漂移、行为可预期。
6. 作为**本机用户**，我想要在对话里附加图片，以便 agent 能直接看到图的内容。
7. 作为**本机用户**，我想要在非视觉模型会话里附加图片时被明确阻止并提示，
   以便不出现「附了图但模型根本没看到」的静默失败。
8. 作为**本机用户**，我想要附加项目外文件时无需额外确认（文件选择器即显式授权），
   以便直接附加 Downloads/Desktop 里的图与文档，不被重复打断（agent 工具面照旧从严）。

## 4. 稳定块（已稳定，可结晶为 REQ）

| # | 稳定块 | 为什么不再推翻 |
|---|---|---|
| B1 | **多 provider 配置列表**：settings.agent 升级为条目列表（provider + apiKey + 可选模型覆盖 + 默认标记，默认唯一）；Settings 管理 UI（增删/标记默认/每条目选模型）进本 story | 访谈 Q2/Q5 人拍板；「模型配置化」是 BUG-004 注释点名的既定方向 |
| B2 | **动态模型列表**：配置条目时从供应商 API 拉取（deepseek `GET /models` 仅 id→能力硬编码；kimi `GET /v1/models` 带 supports_image_in/reasoning 标志直接消费）；无 key/拉取失败回退 pi-ai 内置目录；**catalog 端点**（GET /api/settings/agent/catalog）输出全部 apiKey 型静态 provider 的模型+能力（37 个，排除 OAuth 型 codex/github-copilot；数据源 = pi-ai 静态目录单一真源） | 访谈 Q14a 人拍板要做；官方文档实证两供应商均有端点、kimi 官方建议动态拉取；REFLECT 前扩展（2026-08-14 人拍板：放出全部 apiKey 型 provider，能力数据走服务端 catalog 消除镜像漂移） |
| B3 | **会话级 provider 切换**：工具栏模型选择器（对齐 mode-select 交互先例）；切换保留对话历史、只影响后续消息；工具列表 = 已配置条目 | 访谈 Q6 人拍板；工具栏「可扩展容器」是上 story（B2）预留的 |
| B4 | **默认语义**：新会话初始 = 默认 provider；会话的 provider 被删 → 回落默认 + 提示；存量单条配置迁移 = 列表第一条 + 默认（零操作升级） | 访谈 Q9/Q10/Q12 人拍板 |
| B5 | **auto 判断用默认模型**：autoJudge decide 与会话模型解耦，固定默认 provider/模型 | 访谈 Q7 人拍板；现接线 worker `createSessionDecide(runtime, modelObj)` 跟随会话——实证 |
| B6 | **图片附件**：jpeg/png/gif/webp/bmp/heic/heif 白名单（SVG 拒收）；image content block 随消息注入 + 进会话历史（pi-ai 原生持久化）；非视觉模型阻止 + 提示（附加时判定 + 发送时复核）；项目外文件可直接附加（选择器即授权） | 访谈 A1/Q15 人拍板 + DESIGN 复核（A7 反转）+ tech-design（PDF 放弃，附件 v1=图片）；pi-ai 原生支持 image block、官方视觉格式白名单实证 |
| B8 | **默认模型刷新**：moonshotai 默认 kimi-k2.5 → kimi-k3；DEFAULT_MODELS 同步更新；后续默认值从动态列表结果取 | 访谈 A8 人拍板；kimi 官方 docs/models 实证 k2.5 2026-08-31 日落、k3 在售旗舰 |

## 5. 移动块（还在动，暂不入 REQ）

| # | 还在动的块 | 不确定什么 |
|---|---|---|
| M1 | ~~动态模型列表缓存时机~~ → **已定**（实时拉取无缓存，勾选子集进 settings） | 已解决 |
| M2 | ~~会话切换 worker 机制~~ → **已定**（provider-change 最小集热更新 + agent_sessions 列，ADR-026） | 已解决 |
| M3 | ~~附件通道~~ → **已定**（路径引用 + worker 侧自读） | 已解决 |
| M4 | ~~附件持久化~~ → **已定**（pi-ai 原生上下文序列化） | 已解决 |
| M5 | 会话列表/状态栏是否展示当前 provider | 设计阶段未定；本期默认不加 |

> 原 M1-M4 已由 /tech-design 定案（2026-08-12），保留一行说明来源，不占 REQ。

## 6. 用户操作流（Operation Flows）

### 6.1 主流程 / Happy Path

#### F1 Settings 多 provider 管理（B1/B2）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | Settings → Agent 配置页 | 显示 provider 列表（存量单条自动成为第一条 + 默认标记）；空列表显示空态 | 集成：GET /api/settings/agent 返回列表形态；迁移后第一条 = 旧 provider + 默认 |
| 2 | 添加 provider（选 provider + 填 key + 选模型） | 填 key 后尝试拉取该 provider 模型列表；成功 → 模型下拉显示真实列表（kimi 项带能力标记）；失败 → 显示内置目录回退 + 提示 | 集成/单元：拉取成功/失败两路径 |
| 3 | 保存条目 | 列表落盘（0o600）；新条目生效 | 集成：PUT 后 GET 回读一致 |
| 4 | 标记默认 / 取消标记 | 默认唯一（新标记者上位，旧者取消） | 集成：默认唯一性断言 |
| 5 | 删除条目 | 列表更新；被删条目正被某会话使用 → 该会话回落默认 + 提示 | 集成/E2E：删除后会话 provider 变默认 |

#### F2 工具栏切换 provider（B3）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 工具栏点「模型」选择器 | 展开已配置条目列表（provider + 模型名），当前会话 provider 高亮 | E2E：locator 契约（对齐 mode-select：trigger/menu/option） |
| 2 | 选择另一个已配置条目 | 当前会话 provider 切换：历史完整保留（消息列表不变），下一条消息用新 provider 回复 | 集成：切换后回读会话 provider；发送消息 → worker 用新模型；E2E：历史消息仍显示 |
| 3 | 新开会话 | 初始 provider = 默认（列表默认标记项） | 集成：新会话 provider = 默认 |
| 4 | 会话的 provider 被删除后打开会话 | 显示默认 provider + 提示「原 provider 已移除，已回到默认」 | E2E：提示可见 + provider 为默认 |

#### F3 auto 判断用默认（B5）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | auto 模式下会话切到非默认 provider | 判断链路仍用默认模型（decide 不随会话漂移） | 集成：切换后判断请求落到默认模型 fixture |
| 2 | Settings 修改默认 provider | 后续判断用新默认 | 集成：默认变更后判断落点更新 |

#### F4 附件（B6）

| 步骤 | 用户动作 | 系统响应 | 验收锚点 |
|---|---|---|---|
| 1 | 工具栏点「附件」→ 选图片（视觉模型会话，项目内路径） | 图片 chip 出现在输入区；发送后 image content block 随消息注入；JSONL 落路径引用 + 内容快照（pi-ai 原生序列化） | 集成：消息协议含附件块；worker 侧收到 image block；JSONL 重放可见 |
| 2 | 选图片（**非视觉模型**会话，如 deepseek） | **阻止附加** + 提示「当前模型不支持图片，请切换到 kimi 或移除图片」 | E2E：附加被拒 + 提示可见；无图片块进入消息 |
| 3 | 选**项目外**图片（如 ~/Downloads） | 直接附加（选择器即显式授权，不弹确认、无特殊标记） | E2E：附加成功 |
| 4 | 附加后切换模型（视觉 → 非视觉）再发送 | **发送时复核**：非视觉模型下带图消息被阻止并提示（不静默忽略） | E2E：发送被拒 + 提示 |

### 6.2 分支与异常

| 触发条件 | 分支结果 | 对应错误状态 |
|---|---|---|
| 动态拉取无 apiKey | 不拉取，用内置目录 + 提示「填 key 后自动刷新」 | E2 |
| 动态拉取失败（网络/401） | 回退内置目录 + 提示；条目仍可保存（模型按内置目录选） | E3 |
| kimi 站 key 不通用（.ai vs .cn 401） | 拉取失败提示，引导核对站点 | E3 |
| 切换 provider 后新 provider 校验失败（401/key 失效） | 切换失败，保持原 provider + 错误提示 | E4 |
| 模型列表为空（供应商无返回） | 内置目录回退 | E3 |
| 附件数量 > 10 | 阻止本次附加 + 提示数量上限 | E5 |
| 附件类型不在白名单（含 SVG） | 拒绝 + 提示支持类型 | E6 |
| 图片文件不可读（IO 错误/TCC） | 拒绝 + 提示（经会话事件回 UI） | E8 |
| 会话切换时 worker 正在运行 | 切换生效于下一条消息（当前操作不受影响）——对齐 mode-change 语义 | 无 |
| 附加后切到非视觉模型再发送 | 发送时复核拦截 + 提示（不静默忽略） | E11 |

## 7. 表单与输入验证（Form / Input Validation）

| 输入字段 | 规则 | 错误提示 | 错误状态 |
|---|---|---|---|
| Settings provider 条目：provider | 从内置 provider 列表选（deepseek / moonshotai / moonshotai-cn / faux），必选 | 「请选择 provider」 | E1 |
| Settings provider 条目：apiKey | 与 provider 成对提交（对齐现状）；编辑已有条目可不重填 | 「请输入 API Key」 | E1 |
| Settings provider 条目：模型 | 从动态拉取/内置目录列表选，非自由文本 | 「模型不存在」 | E9 |
| 默认标记 | 全局唯一（列表中最多一个默认） | 新标记自动上位，旧标记取消（无错误） | 无 |
| 附件：类型 | 图片白名单 jpeg/png/gif/webp/bmp/heic/heif；SVG/其他拒绝 | 「仅支持图片（jpeg/png/gif/webp/bmp/heic/heif）」 | E6 |
| 附件：数量 | 每消息 ≤10 个 | 「每条消息最多附加 10 个文件」 | E5 |
| 附件：大小 | 单图 ≤10MB（API 硬边界），超限拒绝 | 「图片过大（单图 ≤10MB）」 | E10 |
| 附件：视觉能力 | 图片仅视觉模型会话可附加 | 「当前模型不支持图片…」 | E11 |
| 附件：来源 | 项目外文件直接附加（选择器即授权，无确认/无标记）；agent 工具面照旧从严 | 无（不弹确认） | 无 |

### 7.1 跨字段/业务规则

| 规则 | 触发时机 | 错误状态 |
|---|---|---|
| provider 列表为空时工具栏模型选择器禁用（灰显，title 引导去 Settings） | 列表空 | 无（禁用态） |
| 模型选择器仅列已配置条目；settings 变更后选择器即时反映 | 列表增删/默认变更 | 无 |
| 会话 provider 被删 → 回落默认（列表仍空 → 禁用态 + 提示去配置） | 删除条目 | E12 |

## 8. 错误状态与失败响应（Error States / Failure Responses）

| 场景 | 触发条件 | 错误码/消息 | 用户可见状态 | 副作用/回滚 |
|---|---|---|---|---|
| E1 | Settings 条目缺 provider/key | 「请选择 provider」/「请输入 API Key」 | 表单行内错误 | 不落盘 |
| E2 | 动态拉取无 key | 「填 key 后自动刷新」 | 模型下拉用内置目录 | 无 |
| E3 | 动态拉取失败（网络/401/超时） | 「模型列表拉取失败，已使用内置列表」 | 内置目录 + 提示 | 无（不阻塞保存） |
| E4 | 会话切换 provider 校验失败（key 失效/401） | 「切换失败：provider 校验失败」 | 保持原 provider | 无（不切换） |
| E5 | 附件超数量（>10） | 「每条消息最多附加 10 个文件」 | 本次附加被拒 | 无 |
| E6 | 附件类型不支持（含 SVG） | 「仅支持图片（jpeg/png/gif/webp/bmp/heic/heif）」（v0.4 砍 PDF 后文案修订） | 本次附加被拒 | 无 |
| E7 | （已删：PDF 本期放弃） | — | — | — |
| E8 | 图片读取失败（IO/权限/TCC） | 「文件读取失败」 | attachment-error 事件回 UI；消息不发送 | 无 |
| E9 | 模型不在真实列表（防御：仅静态目录回退时可能） | 「模型不存在，请从列表选择」 | 表单行内错误 | 不保存 |
| E10 | 图片超 10MB（API 硬边界；分辨率边界由 API 层处理，产品层不做像素预检） | 「图片过大（单图 ≤10MB）」 | 本次附加被拒 | 无 |
| E11 | 非视觉模型附加图片 | 「当前模型不支持图片，请切换到 kimi 或移除图片」 | 附加被拒 + 引导 | 无 |
| E12 | provider 列表为空 | 「未配置模型，请到设置添加」 | 选择器禁用/会话回落 | 会话回落默认（列表空则禁用） |
| E13 | 存量迁移异常（settings 损坏） | 迁移失败 → 空列表 + 错误提示，不破坏原文件 | Settings 显示错误 | 保留原文件（不覆盖） |

## 9. 复杂度分级

| 维度 | 取值/说明 |
|---|---|
| 复杂度 | **complex** |
| 判断理由 | 模块数：settingsService / Settings 页 / ModeToolbar / Assistant 页 / agentService（会话配置、切换、auto 解耦）/ worker（decide、provider 热更新）/ HTTP 路由 ×2 / 新附件链路（抽取、确认、协议）≈ 9+；外部依赖 2（供应商模型列表 API、PDF 解析库）；分支多（错误状态 13 类）；跨模块契约多（B3 切换、B6/B7 附件协议） |

- 结晶路径：`PRD → DESIGN → DOMAIN-MODEL → TECH-DESIGN（深潜补全 §10）→ CRYSTALLIZE`。

## 10. 技术方案（Implementation Decisions）

> complex story：由 `/tech-design` 深潜定案（2026-08-12，8 轮单题对抗式）。

### 10.1 设计目标

- 模型配置从「全局单 provider」升级为「多 provider 条目（每条目多模型）+ 全局默认组合」，
  会话级切换**不丢历史**（provider-change 热更新，不走 rebuildSession 换代）。
- auto 判断链路与会话模型解耦，永远锚定默认组合（defaultJudge 随 session-config 注入 +
  默认变更广播）。
- 图片附件走路径引用 + worker 侧读取（字节不出 worker，绕开 256KB/300KB 通道上限），
  持久化由 pi-ai 原生上下文序列化承担（零自定义）。
- 动态模型列表实时拉取无缓存；「不静默放行」底线：非视觉模型阻止附加（附加时判定 +
  发送时复核）。

### 10.2 模块与边界

| 模块 | 职责 | 是否新增 |
|---|---|---|
| settingsService | settings.agent 段升级：`{identity, providers:[{provider, apiKeyEncrypted, models[]}], defaultModel:{provider, model}}`；存量迁移（旧单条 → 第一条 + 默认，失败不动原文件 E13）；apiKey 条目级加解密（secretStore 复用） | 改 |
| modelCatalogService | `fetchModels(provider, apiKey)`：kimi `/v1/models` 能力标志直存、deepseek `/models` 仅 id + 内置能力表补全；失败/无 key 回退 pi-ai 内置目录；**无缓存，每次实时拉取** | 新 |
| agentService | provider-change 分发（校验条目 → key 解密 → keyRef → IPC → 回写 `agent_sessions` 列）；水合/懒恢复按行 provider/model 重装 session-config；defaultJudge 装配 + 默认变更广播（judge-config）；E12 删除回落默认 | 改 |
| worker | provider-change 处理（resolveModel 替换会话 modelObj，下一条 prompt 生效）；judge 独立 modelObj（createSessionDecide 改注入 defaultJudge）；图片附件：prompt 时按路径读文件 → base64 → image content block；**视觉复核 = renderer 主防线**（worker 侧按 pi-ai 库语义——附加的唯一合法路径是 UI 文件选择器，HTTP 直连构造载荷属契约外滥用面；未来出 CLI/API 客户端再补 worker 防线）；attachment-error 事件回 UI | 改 |
| HTTP 路由 | `GET/PUT /api/settings/agent` 新形态；新 `PUT /api/agent/sessions/:key/provider`；`POST messages` 扩展 attachments 字段 | 改 |
| renderer（Settings 页） | provider 条目列表管理（增删/模型勾选子集/默认组合星标） | 改 |
| renderer（Assistant 页） | ModeToolbar 模型选择器（替代灰显槽位，平铺所有组合）；Composer 附件按钮 + chips 行 + 文件选择器 + 非视觉阻止提示 + 发送复核 | 改 |

#### 模块关系图

```
[Settings 页] ──PUT settings──> [settingsService] ──apiKey──> [modelCatalogService] ──> 供应商 /models
      │                              │                              │
      │                              └──── providers + defaultModel（settings.json，0o600）
      │
[ModeToolbar 模型选择器] ──PUT :key/provider──> [agentService] ──provider-change IPC──> [worker]
      │                                                  │ 回写 agent_sessions 列           │ resolveModel 替换
      │                                                  └──── 水合/懒恢复按行重装 ─────────┘
[Composer 附件] ──POST messages{attachments:path}──> [agentService] ──prompt──> [worker] ──读文件──> image block ──> LLM
      │                                                                                        │
      └────────────────────────── attachment-error 事件 ◄──────────── worker ◄───────── 失败回 UI
[settings 默认组合] ──> session-config{defaultJudge} / judge-config 广播 ──> [worker] judgeModelObj
```

### 10.3 数据流

1. **F1 配置条目**（B1/B2）：Settings 填 provider+key → renderer 调 `fetchModels` 实时拉取
   （kimi 能力标志 / deepseek 硬编码）→ 勾选要使用的模型子集 → `PUT /api/settings/agent`
   → settingsService 校验（provider 必选、key 与条目成对、模型 ∈ 拉取结果、≥1）→ 落盘
   （0o600，apiKey 加密）→ 默认组合指针唯一性维护（新增条目为空列表时首个组合成为默认；
   删除默认条目 → 指针重定向剩余首个组合）。
2. **F2 会话切换**（B3）：工具栏选组合 → `PUT /api/agent/sessions/:key/provider {provider, model}`
   → agentService 查 settings 条目 + 解密 key（失败 → 400 E4）→ 生成新 keyRef
   （`key:<provider>:<gen>`，gen 复用 generation 递增；**sessionRef 不换代**）→ IPC
   `provider-change {sessionKey, provider, model, keyRef, apiKey}` → worker resolveModel
   替换该会话 modelObj（下一条 prompt 生效；进行中操作不受影响）→ 回写
   `agent_sessions.provider/model` 列 → renderer 更新触发器。
3. **水合/懒恢复**（B3/B4）：按 `agent_sessions` 行读 provider/model（NULL → 默认组合）→
   从 providers 数组按 provider 找条目解密 key（条目缺失 → 回落默认 E12）→ 重装
   session-config（含 defaultJudge）。
4. **F4 附件**（B6）：选择器 → renderer 校验（白名单/数量 ≤10/大小 ≤10MB、8000px → E5/E6/E10；
   非视觉模型阻止 E11）→ chips 行 → 发送时二次视觉复核 → `POST messages {text,
   attachments:[{name, size, mimeType, kind:"image", path}]}` → worker prompt 时按 path
   读文件（失败 → attachment-error 事件回 UI，E8）→ base64 → image content block 注入
   本条 user message → pi-ai SessionManager 原生序列化进 JSONL（快照进历史，后续轮次
   随历史重发——官方语义实证）。
5. **auto judge**（B5）：session-config 携带 `defaultJudge {provider, model, keyRef, apiKey}`
   → worker 独立 resolve judgeModelObj（缺失 → auto 档 fail-safe defer，REQ-AGENT-073
   标准 4）→ `createSessionDecide(runtime, judgeModelObj, ...)`；Settings 改默认组合 →
   主进程广播 `judge-config` IPC（全部活跃会话热更新，无滞后窗口）。

### 10.4 接口契约

#### 接口 1：`PUT /api/agent/sessions/:spaceKey/provider`（新端点）

| 项目 | 说明 |
|---|---|
| 调用方 | renderer（ModeToolbar 模型选择器） |
| 被调用方 | agentService |
| 输入 | `{ provider, model }`（组合必须存在于 settings providers 条目） |
| 输出 | 200 `{ provider, model }` |
| 业务错误 | 400 E-MODEL-CONFIG-MISSING（条目不存在/模型不在条目）；400 E-MODEL-KEY-FAIL（key 解密失败） |
| 系统错误 | 500（worker 无响应） |
| 副作用 | agent_sessions 列回写；worker modelObj 替换（下一条生效） |
| 幂等性 | 是（同组合重复 PUT 无操作） |

#### 接口 2：provider-change IPC（主进程 → worker）

| 项目 | 说明 |
|---|---|
| 输入 | `{type:"provider-change", sessionKey, provider, model, keyRef, apiKey}` |
| 语义 | resolveModel 替换该会话 modelObj；key 一次注入仅内存（同 session-config 安全语义，不落日志/JSONL）；sessionRef 不动 |
| 生效 | 下一条 prompt（进行中操作不受影响） |

#### 接口 3：judge-config IPC（主进程 → worker，广播）

| 项目 | 说明 |
|---|---|
| 输入 | `{type:"judge-config", defaultJudge: {provider, model, keyRef, apiKey}}` |
| 触发 | Settings 默认组合变更 |
| 语义 | 全部活跃会话 judgeModelObj 热更新；懒恢复会话随 session-config 自然带新值 |

#### 接口 4：`POST /api/agent/sessions/:spaceKey/messages` 扩展

| 项目 | 说明 |
|---|---|
| 输入 | 既有 `{text}` + 可选 `{attachments: [{name, size, mimeType, kind:"image", path}]}`（≤10） |
| 校验 | 白名单（jpeg/png/gif/webp/bmp/heic/heif，SVG 拒收）、size ≤10MB、path 存在性 |
| 输出 | 202 `{messageId}`；400 E-ATTACH-*（超限/类型/大小） |
| 副作用 | worker 读文件注入 image block；JSONL 序列化（pi-ai 原生） |

#### 接口 5：agent_sessions 列扩展

| 项目 | 说明 |
|---|---|
| 列 | `provider TEXT NULL`、`model TEXT NULL`（迁移补列，旧行 NULL → 默认组合） |
| 真相 | SQLite；provider-change 回写；水合/懒恢复读取；条目删除 → 回落默认（不落 NULL） |

#### 接口 6：`GET /api/settings/agent/catalog`（v0.6 新增）

| 项目 | 说明 |
|---|---|
| 调用方 | renderer（Settings 下拉 + 视觉判定 + 添加表单内置目录回退） |
| 被调用方 | settingsService/modelCatalogService |
| 输入 | 无 |
| 输出 | 200 `{providers: [{provider, displayName, defaultModel, models: [{model, vision, reasoning}]}]}`——37 个 apiKey 型静态 provider（排除 OAuth 型 openai-codex/github-copilot 与 faux 测试 seam）；数据源 = pi-ai 静态目录（`getBuiltinModels`，单一真源）；defaultModel = 目录首项 |
| 业务错误 | 无 |
| 系统错误 | 500（目录读取失败） |
| 副作用 | 无（只读派生数据，无缓存——数据量小） |
| 幂等性 | 是 |

### 10.5 关键决策

| 决策 | 选项 | 选择理由 | 风险 |
|---|---|---|---|
| 会话级 provider 持久化 | agent_sessions 加列（SQLite 为真相）vs JSONL 头 vs 内存 | 「SQLite 为真相」既有原则；懒恢复必须按行装配 key | 迁移补列（title 列先例） |
| 切换机制 | provider-change 热更新（对齐 mode-change）vs rebuildSession 换代 | 换代 = 丢历史，违反契约 | worker 模型替换的隐藏问题 → 见 10.6 |
| 条目粒度 | 每 provider 多模型（共享 key）vs 每条目一模型 | 拉取列表 → 勾选子集进 settings（人拍板）；工具栏平铺所有组合 | — |
| 默认落点 | 全局 defaultModel 指针 vs 条目内嵌标记 | 唯一性由结构保证；跨 provider 查询一次读完 | — |
| 附件字节通道 | 路径引用 + worker 自读 vs 字节直传双转发 | 绕开 256KB/300KB 上限；字节不出 worker；PDF 场景已砍 | macOS TCC（未沙箱，低风险；退路 = 字节直传） |
| 附件持久化 | pi-ai 原生上下文序列化（快照进 JSONL）vs 仅路径 | 官方语义实证（README + SessionManager JSONL stringify）；零自定义 | 图片每轮重发 token 成本（v1 接受，compaction 留后续） |
| 动态模型列表 | 实时拉取无缓存 vs 缓存文件 | 拉取结果只是「可选池」，勾选子集进 settings——无缓存必要（人拍板） | 每次打开表单要拉一次（可接受） |
| 默认模型 | moonshotai → kimi-k3 | k2.5 8/31 日落；k3 在售旗舰（视觉+1M） | 在售状态变化由动态列表自然吸收 |

> 满足 ADR 三条件的决策（会话级持久化 + 热更新机制）→ **ADR-026**。

### 10.6 风险与回流点

| 假设 | 如果错了会怎样 | 回流到 | 能否快速验证 |
|---|---|---|---|
| worker 侧 modelObj 热替换可行（mode-change 先例证明 IPC 通道，但模型对象替换无先例） | provider-change 后 worker 用旧模型回复 | TECH-DESIGN（改换代 + 历史迁移——代价大） | 能（implementer 早期 spike） |
| 图片 base64 注入不触发 pi-ai/供应商限制（≤10MB/8000px 硬边界） | 大图报错 | PRD（降采样从范围外拉回） | 能（fixture 图单测） |
| macOS TCC 不拦截 worker 子进程读 Downloads（未沙箱） | 项目外图片读取失败 E8 高频 | TECH-DESIGN（退回字节直传 B） | 能（本地验证） |
| kimi `/v1/models` 能力标志字段名稳定（实证过） | 解析失败 → 回退内置目录 | PRD（能力硬编码化） | 能（单测 mock） |

### 10.7 安全/性能/可观测性

- **安全**：key 明文仅内存（provider-change/judge-config 载荷同 session-config 语义——不落日志、不进 JSONL）；附件注入 = 用户显式选择（选择器即授权，A7）；非视觉模型阻止 + 发送复核 = **renderer 主防线**（UI 是唯一合法附加入口；堵住「静默丢图」的用户路径；agent 工具面权限不受附件影响（envelope 照旧从严）。
- **性能**：图片字节零转发（renderer → 元数据、worker 自读）；每轮重发 token 成本 v1 接受（无降采样，10MB/8000px 硬边界拦截超限）；动态拉取仅配置时发生。
- **可观测**：provider-change 日志（对齐 mode-change log）；attachment-error 会话事件；judge-config 广播日志；水合按行重装日志（provider NULL → 默认 的迁移路径可查）。

## 11. 测试决策（Testing Decisions）

### 11.1 覆盖接缝（coverage seams，CLI 优先）

| 稳定块 | Seam | 测试类型 | 依赖处理 |
|---|---|---|---|
| B1 多 provider 列表 | `GET/PUT /api/settings/agent`（providers 列表形态、迁移、defaultModel 唯一性、删除条目） | 集成 | 真实 settings 文件（测试 configDir） |
| B1 Settings UI | Settings 页 provider 条目管理（增删/勾选子集/默认星标） | E2E | 真实 app |
| B2 动态模型列表 | modelCatalogService（kimi 标志直存 / deepseek 能力补全 / 失败回退内置目录） | 单元 + 集成 | mock fetch + pi-ai 真实目录 |
| B3 会话切换 | `PUT /api/agent/sessions/:key/provider`（切换成功 + 历史保留断言：JSONL 不变 + 下条消息新 provider） | 集成 | faux provider |
| B3 工具栏选择器 | ModeToolbar 模型选择器 locator 契约（复用 mode-select 先例；平铺所有组合 + 当前高亮） | E2E | 真实 app |
| B4 默认语义/迁移/删除兜底 | agent_sessions 列回写与懒恢复重装（行读 provider/model，NULL→默认）；删除条目回落默认 | 集成 | faux + settings fixture |
| B5 auto 解耦 | worker judge（注入 defaultJudge fixture，断言不随会话漂移）；judge-config 广播热更新 | 单元 + 集成 | 注入 decide / faux judge |
| B6 图片附件 | messages 附件协议（attachments 元数据 → worker 读文件 → image block → JSONL 快照重放）；非视觉阻止（附加 + 发送复核）；E8 attachment-error 事件 | 集成 + 单元 | faux worker + 测试图片 fixture |
| B8 默认模型刷新 | DEFAULT_MODELS 断言（moonshotai=kimi-k3；指向 pi-ai 目录存在模型） | 单元 | 真实目录 |

### 11.2 测试策略与先例

- 只测外部行为：切换/附件/拉取都走 HTTP 契约（`tests/capabilities/` 下按
  capability/entity 组织），worker 侧行为经 faux provider 断言（对齐
  `2026-08-11-pi-agent-modes` 的 modeToolbar E2E + autoJudge 单测先例）。
- 先例：`tests/capabilities/agent-dialogue/…/2026-08-11-pi-agent-modes/`（mode 切换
  API 集成 + E2E）、`2026-08-02-builtin-agent`（消息协议集成）。
- 视觉能力判定用 pi-ai 真实目录（deepseek 纯文本 / kimi-k3 视觉——能力是目录事实，
  不 mock）。

## 12. 范围外

- **PDF 附件**（本地抽取注入）：本期放弃（2026-08-12 tech-design 人拍板）；OCR（kimi
  Files API）与文本抽取均留后续 story。
- 供应商能力探测的 deepseek 侧（能力硬编码，不做额外探测）。
- 图片拖拽/粘贴/`@` 引用入口（v1 仅文件选择器）。
- 文本/代码文件附件（v1 只有图片）。
- 图片发送前降采样（v1 依赖 API 硬边界 10MB/8000px；成本优化留后续）。
- 并行多 provider（一条消息同时调多个模型）。
- 会话级模型选择的持久记忆（新会话一律从默认开始）。
- 附件生命周期管理（compaction/过期清理）。
- 会话列表/状态栏的 provider 展示（M5，设计阶段再定）。
- 动态模型列表之外的模型能力 UI 展示（kimi 能力标志只用于能力开关，不做模型对比页）。

## 13. 补充说明

**调研依据（tech-design / review 引用）**：

- Claude Code 附件机制（官方文档）：code.claude.com/docs/en/common-workflows
  （`@` 引用 full content in conversation）、interactive-mode（粘贴 [Image #N] chip）、
  tools-reference（Read 工具 PDF 分页）、terminal-config（大文本折叠）、permissions
  （工作目录外 Read 必弹确认）；platform.claude.com vision（格式/大小限制）。
- pi-ai 0.83 本地实证：image content block `{type:'image',data,mimeType}`；
  `model.input.includes('image')` 判定视觉；非视觉模型传图静默忽略（README）；
  deepseek/moonshot 静态内置目录（`refresh()` no-op）；deepseek 全模型 text-only，
  kimi-k2.5/2.6/2.7-code/k3 支持 text+image。
- DeepSeek API：api-docs.deepseek.com/api/list-models（`GET /models` 仅
  id/object/owned_by）；官方 API 无视觉、无 PDF。
- Moonshot/Kimi API：platform.kimi.ai/docs/api/list-models（能力标志，官方推荐动态
  拉取）；use-kimi-vision-model（格式白名单、仅 base64 data URL、请求体 ≤100MB、
  建议 ≤4K）；files-upload + file-based-qa（`purpose="file-extract"` 抽文本 + OCR
  注 system message，100MB/文件——本期不做，OCR 留后续）；models 页（kimi-k2.5
  **2026-08-31 日落**、kimi-k3 在售旗舰 1M 视觉；CN 站 api.moonshot.cn 与国际站
  api.moonshot.ai key 不通用）。

## 14. PRD 完整性自检查

| 检查项 | 状态 | 备注 |
|---|---|---|
| 操作流 | PASS | 8 个稳定块均有 happy path（F1-F4）+ 分支异常表 |
| 输入验证 | PASS | §7 字段级 + 跨字段规则（默认唯一、空列表禁用、删除回落） |
| 错误状态 | PASS | 12 类（E1-E6、E8-E13；E7 随 PDF 放弃删除） |
| 复杂度分级 | complex | 模块 9+ / 外部依赖 2 / 错误分支 12 |
| 技术方案（§10） | PASS | /tech-design 深潜定案（8 轮单题对抗）：§10.2-10.7 完整（模块/数据流/接口契约/关键决策/风险/安全），ADR-026 落档 |

> GAP 处置：无悬空项。M1-M4 已定案移出移动块；PDF 放弃归 §12。

---

## 版本记录

| 版本 | 日期 | 变更 | 作者 |
|---|---|---|---|
| v0.1 | 2026-08-12 | 初稿（访谈方向 A 合成） | AI + 人 |
| v0.2 | 2026-08-12 | DESIGN 复核：**A7 反转**——移除「项目外附件确认弹窗」（选择器即显式授权，对齐 Claude Code 用户主动附加不弹；agent 工具面照旧从严）；B6/B7/F4/§7 同步更新；原型同步 | AI + 人 |
| v0.3 | 2026-08-12 | DESIGN 复核：移除项目外文件的「外部」来源标签（无特殊标记；选择器即授权语义不变） | AI + 人 |
| v0.4 | 2026-08-12 | tech-design 定案：**条目粒度 = 每 provider 多模型**（拉取列表→勾选子集进 settings，实时拉取无缓存）；**PDF 附件本期放弃**（附件 v1 = 图片，E7 删除、E10 改 10MB/8000px）；附件增「发送时复核」分支 | AI + 人 |
| v0.5 | 2026-08-13 | BUILD 对齐修订（S4 PRD 对齐子代理）：① §10.2/§10.7 视觉复核明确为 **renderer 主防线**（人拍板 A——UI 是唯一合法附加入口，worker 按 pi-ai 库语义，未来出 CLI 再补 worker 防线）；② §7/§8 陈旧文案修订（E6 去掉「与 PDF」、E10 去掉 8000px/改 10MB 单一硬边界） | AI + 人 |
| v0.6 | 2026-08-14 | REFLECT 前扩展（人拍板）：**放出全部 37 个 apiKey 型 provider**（排除 OAuth 型 openai-codex/github-copilot）；**catalog 端点**（GET /api/settings/agent/catalog：pi-ai 静态目录单一真源 → provider/模型/能力/defaultModel）；Settings 下拉与视觉判定（modelCapabilities.js）改消费 catalog——镜像漂移根治（GAP-3 关闭）；动态拉取维持已适配 provider（kimi/deepseek），其余走内置目录 | AI + 人 |
