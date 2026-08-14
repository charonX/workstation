# Requirements — 对话区工具栏扩展（模型选择 + 附件）

> 故事 ID：`2026-08-12-conversation-toolbar-ext`
> 版本：v5（v0.7 补丁：REQ-103/104 协议族化 + REQ-105 上下文百分比两位小数——BUG-001~003 req-gap 就地补全）
> 最后更新：2026-08-14
> 来源：`prd.md` v0.6（B1-B6、B8 + §10 技术方案）+ BUG-001/BUG-002 req-gap 增量（v0.6 放出 37 provider 时未定 test-connection / 动态拉取的全族语义）+ BUG-003 增量（上下文用量百分比两位小数；症状①分母不随模型变 = not-a-bug，SDK model.contextWindow + provider-change setModel 热更新实证已随模型变化）
> UX 参照：`ux/settings-providers.html`、`ux/conversation-toolbar.html`（已 approved）
> 移动块 M5（会话列表/状态栏 provider 展示）留 PRD，不入 REQ。PDF 附件（原 B7）已放弃归 §12。
> 技术事实（§10/§13）：provider-change 走最小集热更新 IPC 不换代（ADR-026）；附件持久化 = pi-ai 原生上下文序列化（实证）；kimi `/v1/models` 带能力标志、deepseek `/models` 仅 id；pi-ai 对非视觉模型传图静默忽略；**v0.6：37 个 apiKey 型静态 provider + catalog 端点（pi-ai 目录单一真源）**。

---

## REQ-AGENT-090 多 provider 配置列表 + 存量迁移（B1）

- 优先级 P0 / 必须 / cross-module / settingsService + HTTP 路由 / agent-dialogue / settings / 集成
- 接口契约：settings.agent 升级为 `{identity, providers:[{provider, apiKeyEncrypted, models[]}], defaultModel:{provider, model}}`；`GET /api/settings/agent → {identity, providers:[{provider, models[], configured}], defaultModel}`；`PUT /api/settings/agent` 同形态提交
- UX 参照：`ux/settings-providers.html`（条目列表 + 迁移提示）

验收标准：
1. 存量单条配置（旧 `agent.provider + apiKeyEncrypted`）自动迁移：成为 `providers[0]`，`models=[DEFAULT_MODELS[provider]]`，`defaultModel=该组合`；identity 原样保留（集成：旧格式 settings 加载后回读新形态）。
2. 迁移失败（settings 文件损坏/解析失败）→ 不动原文件、返回错误、UI 显示空列表 + 提示（集成：损坏 fixture）。
3. 新增条目校验：provider 必选、apiKey 与条目成对提交（编辑已有条目可不重填）、`models` 非空且 ≥1、模型必须来自该 provider 拉取结果/内置目录（集成：非法载荷 400）。
4. 默认组合唯一：defaultModel 是全局指针，新增首个条目/删除默认条目后指针自动重定向（删除默认条目 → 剩余条目首个组合；集成：增删后回读 defaultModel 一致）。
5. apiKey 条目级加密落盘（0o600）；GET 不回传明文（集成：回读无 apiKey 明文字段）。

## REQ-AGENT-091 Settings 多 provider 管理 UI（B1）

- 优先级 P0 / 必须 / intra-module / Settings 页 / agent-dialogue / settings / 浏览器 E2E
- 接口契约：`[data-testid='provider-entry']` 条目容器 + `[data-testid='entry-models']` 模型区 + 模型 chip 星标（默认）+ 增删按钮
- UX 参照：`ux/settings-providers.html`（条目列表、勾选子集、默认星标）

验收标准：
1. 显示 provider 条目列表：provider 名 + 模型 chips（各带能力标签）+ 默认标记（E2E：条目可见 + 默认徽标唯一）。
2. 添加条目：填 provider+key → 拉取列表 → 勾选模型子集 → 保存 → 新条目出现（E2E：保存后列表更新）。
3. 星标切换默认组合：点击模型 chip 星标 → 默认徽标移动到该组合，全局唯一（E2E：两次点击后旧默认取消、新默认生效）。
4. 删除条目：确认后条目移除；默认条目被删 → 默认重定向剩余条目（E2E：删除 + 默认徽标变化）。
5. 存量迁移提示可见（旧配置成为第一条 + 默认徽标）（E2E：迁移提示文案）。

## REQ-AGENT-092 动态模型列表（B2）

- 优先级 P0 / 必须 / cross-module / modelCatalogService（新）+ 供应商 API / agent-dialogue / settings / 单元 + 集成
- 接口契约：`fetchModels(provider, apiKey) → [{model, vision, reasoning}]`；kimi 走 `GET /v1/models`（能力标志直存）；deepseek 走 `GET /models`（仅 id → 内置能力表补全）；失败/无 key → 回退 pi-ai 内置目录
- 技术事实：实时拉取无缓存；仅配置时调用

验收标准：
1. kimi provider：解析 `/v1/models` 返回（含 `supports_image_in`/`supports_reasoning`）→ 输出带能力标志（单元：mock fetch 响应）。
2. deepseek provider：解析 `/models`（仅 id）→ 输出模型 + 内置能力表补全（deepseek 全系 vision=false）（单元：mock fetch）。
3. 拉取失败（网络/401/超时）→ 回退 pi-ai 内置目录返回 + 错误标记（单元：mock fetch reject；集成：UI 提示「已使用内置列表」）。
4. 无 apiKey → 不拉取，直接返回内置目录（单元：key 为空）。
5. 返回模型必须存在于 pi-ai 静态目录可解析（防御：id → Model 映射失败剔除）（单元：fake 目录）。

## REQ-AGENT-093 会话级 provider 切换（B3）

- 优先级 P0 / 必须 / cross-module / agentService + worker + agent_sessions 列 / agent-dialogue / conversation-space / 集成
- 接口契约：`PUT /api/agent/sessions/:spaceKey/provider {provider, model}` → 200 `{provider, model}`；错误 400 E-MODEL-CONFIG-MISSING（组合不在已配置条目）/ 400 E-MODEL-KEY-FAIL（key 解密失败）；provider-change IPC `{type:"provider-change", sessionKey, provider, model, keyRef, apiKey}`；agent_sessions 加 `provider`/`model` 列（SQLite 为真相，旧行 NULL → 默认组合）
- 技术前提：切换不换代 sessionRef（JSONL 历史保留）；生效于下一条 prompt；进行中操作不受影响（ADR-026）

验收标准：
1. 切换成功：会话 provider/model 更新，agent_sessions 列回写；JSONL sessionRef 不变（集成：切换后读行 + sessionRef 断言）。
2. 历史保留：切换后既有消息仍可回读（集成：切换前后 GET messages 内容一致）。
3. 下一条消息用新 provider 回复（集成：faux provider 切换后回复带新 provider 标记；或 worker fixture 断言 modelObj 替换）。
4. 切换非法组合（不在任何条目）→ 400 E-MODEL-CONFIG-MISSING，会话不变（集成）。
5. 条目 key 解密失败 → 400 E-MODEL-KEY-FAIL，会话不变（集成：损坏密文 fixture）。
6. 幂等：同组合重复 PUT → 200 无副作用（集成）。

## REQ-AGENT-094 工具栏模型选择器（B3）

- 优先级 P0 / 必须 / intra-module / ModeToolbar + Assistant 页 / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：`[data-testid='model-select']` 下拉容器 + `[data-testid='model-trigger']` 触发按钮 + `[data-testid='model-option'][data-provider][data-model]` 选项（平铺所有已配置组合 + 当前高亮）；旧灰显槽位 `toolbar-slot-model` 移除
- UX 参照：`ux/conversation-toolbar.html`（模型选择器替代灰显槽位）

验收标准：
1. 模型选择器替代灰显槽位：`toolbar-slot-model` 不再渲染，`model-select` 存在（E2E：DOM 断言）。
2. 触发按钮显示当前组合（provider · model）；展开列出全部已配置组合，当前项高亮 + 默认组合带「默认」标记（E2E：展开后选项集合 = 配置条目）。
3. 选择另一组合 → 触发按钮更新 + 选项高亮移动 + 调用 PUT provider（E2E：点击后 trigger 文案变化 + 请求断言）。
4. 选择器仅列出已配置条目（无条目 → 选择器禁用 + 「未配置模型，请到设置添加」提示）（E2E：空配置态）。
5. 外部点击收起 + 展开互斥（对齐 mode-select 先例）（E2E：点击别处后菜单关闭）。

## REQ-AGENT-095 默认语义 + 懒恢复重装 + 删除回落（B4）

- 优先级 P0 / 必须 / cross-module / agentService（水合/懒恢复）+ settingsService / agent-dialogue / conversation-space / 集成
- 接口契约：水合/懒恢复按 agent_sessions 行读 provider/model（NULL → 默认组合）；条目缺失 → 回落默认组合 + 提示（E12）
- 技术前提：会话级状态 SQLite 为真相（ADR-026）

验收标准：
1. 新会话初始组合 = defaultModel（集成：新 spaceKey 装配 session-config 断言 provider/model）。
2. 水合/懒恢复：行带 provider/model → 按行重装（集成：改行后重启水合，session-config 用行值）。
3. 行 NULL（旧行）→ 回落默认组合（集成：NULL 行水合断言）。
4. 会话 provider 对应条目被删除 → 回落默认组合 + 提示（集成：删除条目后懒恢复，行值被覆盖为默认 + 提示事件）。
5. 默认组合变更（Settings 改 defaultModel）→ 新会话/懒恢复用新默认（集成）。

## REQ-AGENT-096 auto 判断用默认模型（B5）

- 优先级 P0 / 必须 / cross-module / worker + agentService + settingsService / agent-dialogue / conversation-space / 单元 + 集成
- 接口契约：session-config 携带 `defaultJudge {provider, model, keyRef, apiKey}`；judge-config IPC `{type:"judge-config", defaultJudge}` 广播全部活跃会话；decide 用 defaultJudge 解析的独立 modelObj（缺失 → auto 档 fail-safe defer，REQ-AGENT-073 标准 4）
- 技术前提：createSessionDecide 的 modelObj 来源从「会话模型」改为「defaultJudge 模型」（解耦）

验收标准：
1. session-config 含 defaultJudge → worker judge 用 defaultJudge 模型，**不随会话模型漂移**（单元：会话切 provider 后 judge 调用仍落默认模型 fixture）。
2. session-config 缺 defaultJudge（未配置）→ auto 判断 fail-safe defer（单元：decide 抛 E-AUTO-JUDGE-NO-PROVIDER 等价路径 → defer）。
3. judge-config 广播：默认组合变更 → 活跃会话 judge 热更新为新的默认（集成：广播后判断落点变化）。
4. 懒恢复会话随 session-config 自然带新 defaultJudge（集成：默认变更后新建/恢复会话断言）。
5. defaultJudge 的 key 一次注入仅内存、不落日志/JSONL（集成：日志无 key 断言）。

## REQ-AGENT-097 图片附件注入协议（B6 服务侧）

- 优先级 P0 / 必须 / cross-module / HTTP 路由 + worker / agent-dialogue / conversation-space / 集成 + 单元
- 接口契约：`POST /api/agent/sessions/:spaceKey/messages` 扩展 `{text, attachments:[{name, size, mimeType, kind:"image", path}]}`（≤10）；校验：类型白名单 jpeg/png/gif/webp/bmp/heic/heif（SVG 拒收）、size ≤10MB、path 存在；错误 400 E-ATTACH-*；worker 侧按 path 读文件 → base64 → image content block 注入本条 user message；失败 → attachment-error 会话事件（E8）
- 技术前提：字节不出 worker（路径引用）；持久化 = pi-ai 原生上下文序列化（快照进 JSONL、后续轮次随历史重发）

验收标准：
1. 带附件消息：worker prompt 收到 image content block（base64 = 文件内容）（集成：faux worker 捕获消息断言 image block）。
2. JSONL 快照：消息行含附件内容，重放/懒恢复后仍可见（集成：读 JSONL 断言 content 含 image 块；恢复后历史含附件块）。
3. 白名单外类型（SVG/其他）→ 400 E-ATTACH-TYPE（集成）。
4. 超数量（>10）/ 超大小（>10MB）→ 400 E-ATTACH-COUNT / E-ATTACH-SIZE（集成）。
5. 文件读取失败（IO/权限/TCC）→ attachment-error 事件回 UI 提示「文件读取失败」，消息不发送（集成：不存在的 path）。
6. 无附件文本消息行为不变（回归：既有 messages 契约不破坏）。

## REQ-AGENT-098 图片附件 UI + 非视觉阻止（B6 前端）

- 优先级 P0 / 必须 / intra-module / Composer + ModeToolbar / agent-dialogue / conversation-space / 浏览器 E2E + 组件
- 接口契约：`[data-testid='attach-button']` 附件按钮；`[data-testid='attachment-chip']` chip（输入区上方行，可移除）；`[data-testid='msg-attachment']` 消息附件块；非视觉阻止提示（E11）
- UX 参照：`ux/conversation-toolbar.html`（附件按钮 + chips 行 + 阻止提示）

验收标准：
1. 附件按钮替代灰显槽位 `toolbar-slot-attach`（E2E：旧槽位不渲染、attach-button 存在）。
2. 选图后 chip 出现在输入区上方行（名称 + 大小），可移除；发送后消息含附件块（E2E：chip 生命周期 + msg-attachment 出现）。
3. 视觉模型会话附加图片成功（E2E：kimi 会话选图 → chip 可见）。
4. 非视觉模型（deepseek）会话附加图片 → 阻止 + 提示「当前模型不支持图片…」（E2E：提示可见、无 chip 进入）。
5. 附加后切换到非视觉模型再发送 → **发送时复核**拦截 + 提示，不静默发送（E2E：切换后发送被拒）。
6. 项目外图片直接附加（无确认弹窗、无特殊标记）（E2E：~/Downloads 路径图附加成功）。
7. 附件数量 >10 时第 11 个被拒 + 提示（E2E/组件）。

## REQ-AGENT-099 默认模型刷新（B8）

- 优先级 P0 / 必须 / intra-module / agentService（DEFAULT_MODELS）/ agent-dialogue / settings / 单元
- 接口契约：`DEFAULT_MODELS.moonshotai = "kimi-k3"`（原 kimi-k2.5，8/31 日落）；DEFAULT_MODELS 内模型必须存在于 pi-ai 静态目录
- 技术事实：默认组合在动态列表上线后从 settings defaultModel 取；DEFAULT_MODELS 是迁移与回退的兜底

验收标准：
1. `DEFAULT_MODELS.moonshotai === "kimi-k3"`（单元断言）。
2. DEFAULT_MODELS 全部值在 pi-ai 静态目录可解析（`input.includes` 判定可用）（单元：真实目录）。
3. 存量迁移产物 `models[0] = DEFAULT_MODELS[provider]`（集成：旧配置迁移断言 kimi-k3 而非 k2.5）。

## REQ-AGENT-100 catalog 端点：全部 apiKey 型 provider（v0.6，B2 扩展）

- 优先级 P0 / 必须 / cross-module / modelCatalogService + HTTP 路由 / agent-dialogue / settings / 集成 + 单元
- 接口契约：`GET /api/settings/agent/catalog` → 200 `{providers: [{provider, displayName, defaultModel, models: [{model, vision, reasoning}]}]}`（§10.4 接口 6）；数据源 = pi-ai 静态目录（`getBuiltinModels`，单一真源）
- 技术前提：37 个 apiKey 型静态 provider（排除 OAuth 型 openai-codex/github-copilot 与 faux 测试 seam）；defaultModel = 目录首项；vision 判定 = `model.input.includes("image")`

验收标准：
1. catalog 返回 37 个 apiKey 型 provider：**包含** openrouter/anthropic/groq/google/xai/openai/mistral 等新放出项；**排除** openai-codex / github-copilot（OAuth 型）与 faux（集成：provider 集合断言——用「包含集合 + 排除集合」而非精确计数，防 pi 升级漂移）。
2. 每个 provider 至少 1 个模型；每个模型带 vision/reasoning 能力标志（集成：全量扫描断言）。
3. vision 判定与 pi-ai 目录一致：kimi-k3 vision=true、deepseek 全系 vision=false（集成：抽样断言 + 单元：与 getBuiltinModels 输出逐项一致）。
4. defaultModel = 目录首项（集成：抽样 provider 断言）。
5. displayName 非空（集成）。
6. 只读无副作用：连续两次 GET 结果一致（集成：幂等断言）。

## REQ-AGENT-101 Settings 动态 provider 列表（v0.6，B1 扩展）

- 优先级 P0 / 必须 / intra-module / Settings 页 / agent-dialogue / settings / 浏览器 E2E
- 接口契约：添加表单 provider 下拉选项 = catalog 端点数据（非硬编码 3 项）；添加表单模型多选区在拉取失败时用 catalog 内置目录兜底
- UX 参照：`ux/settings-providers.html`（添加表单）

验收标准：
1. provider 下拉含新放出项（如 openrouter / anthropic），不再只有 3 项（E2E：展开下拉断言）。
2. 选择新 provider（如 openrouter）+ 填 key → 模型多选区出现该 provider 模型（catalog 内置目录兜底，无需网络）（E2E：模型选项非空）。
3. 勾选模型 → 保存 → 条目出现且含勾选模型（E2E：保存后回读）。
4. 既有 3 个 provider 行为不变（回归：deepseek/moonshotai 流程仍绿）。

## REQ-AGENT-102 视觉判定数据源替换为 catalog（v0.6，B6 扩展）

- 优先级 P0 / 必须 / intra-module / renderer（Assistant/Composer）+ catalog 端点 / agent-dialogue / conversation-space / 浏览器 E2E
- 接口契约：renderer 视觉判定（附加时 + 发送复核）数据源 = catalog 端点（加载后内存缓存）；`modelCapabilities.js` 手写镜像表移除（GAP-3 关闭）
- 技术前提：catalog 加载失败 → 视觉判定保守拒绝（不静默放行）

验收标准：
1. catalog 加载后：kimi-k3 会话附加图片成功、deepseek 会话附加被阻止（回归：imageAttachmentUi 标准 3/4 仍绿——数据源切换后行为不变）。
2. 新 provider 的非视觉模型（如 openrouter 下某 text-only 模型）会话附加图片被阻止（E2E：catalog 数据生效——若 openrouter 全模型视觉，用 mistral/其他 text-only 模型）。
3. catalog 加载失败 → 附加图片保守拒绝 + 提示（E2E/组件：mock catalog 失败）。
4. `modelCapabilities.js` 移除（grep：无残留引用）。

## REQ-AGENT-103 test-connection 支持全部 apiKey 型 provider（v0.7，BUG-001 req-gap 就地补全；v4 修正：BUG-002 协议族感知派生）

- 优先级 P0 / 必须 / cross-module / settings HTTP 路由 + Settings 页 / agent-dialogue / settings / 集成 + 浏览器 E2E
- 背景：v0.6（REQ-100/101）把添加表单 provider 放到 37 个 catalog 项，但 test-connection 端点仍用三 provider 时代硬编码端点表（`AGENT_PROVIDER_ENDPOINTS` 仅 deepseek/moonshotai/moonshotai-cn），34 个新 provider 点「测试连接」误报「请选择供应商」（BUG-001）。v3 初版「baseUrl+/models 通吃」假设被 BUG-002 实证推翻（anthropic 族 `/models` → 404 resource_not_found，`/v1/models` → 401 端点存在），v4 修正为协议族感知派生。
- 接口契约：`POST /api/settings/agent/test-connection` `{provider, apiKey}`
  - provider 合法性判定 = `isApiKeyProvider`（catalog 单一真源，与保存校验同源）；非法 → 400 `E-CONFIG-INVALID`「请选择供应商」
  - 端点与鉴权按**协议族**派生（族数据源 = pi-ai 目录 `model.api`，单一真源；端点存在性已全量实测 2026-08-14，假 key 探测 anthropic 族/mistral 全 401、google 400 = 端点存在）：
    - openai-completions / openai-responses（23 项）→ `GET {baseUrl}/models`，`Authorization: Bearer <key>`；legacy 3 项（deepseek/moonshotai/moonshotai-cn）派生结果与原硬编码端点逐字一致（行为不变）
    - anthropic-messages（6 项有 baseUrl：anthropic/kimi-coding/minimax/minimax-cn/fireworks/vercel-ai-gateway）→ `GET {baseUrl}/v1/models`，`x-api-key: <key>` + `anthropic-version: 2023-06-01`（pi-ai Anthropic SDK 实证形态）
    - mistral-conversations（mistral）→ `GET {baseUrl}/v1/models`，`Authorization: Bearer <key>`
    - google-generative-ai（google）→ `GET {baseUrl}/models?key=<key>`（google 官方唯一形态，key 进 URL——人签安全边界 2026-08-14）
  - baseUrl 缺失 provider（amazon-bedrock / azure-openai-responses / cloudflare-ai-gateway / cloudflare-workers-ai / google-vertex / opencode / opencode-go）→ 200 `{ok:false, error:"E-TEST-UNSUPPORTED", message:"该供应商不支持连接测试，可直接保存"}`，不发网络请求（人签 expected 值）
  - 网络/HTTP 失败 → 沿用 `{ok:false, error:"E-AGENT-LLM-FAIL", message: 透传原因}`；测试连接失败不阻塞保存（REQ-AGENT-001 AC4 签核语义不变）
  - 前端：`error === "E-TEST-UNSUPPORTED"` → 中性样式展示 message，不加「连接失败：」前缀（人签 expected 值）

验收标准：
1. `kimi-coding`（anthropic 族）+ key → 对 `https://api.kimi.com/coding/v1/models` 发 GET，`x-api-key: <key>` + `anthropic-version: 2023-06-01`（集成：mock fetch 断言 URL 与请求头）；供应商 200 → `{ok:true}`。
2. `kimi-coding` + 无效 key → 供应商 401 → `{ok:false, error:"E-AGENT-LLM-FAIL", message 透传供应商原因}`（集成：mock fetch 401）。
3. `amazon-bedrock`（baseUrl 缺失）→ 200 `{ok:false, error:"E-TEST-UNSUPPORTED", message:"该供应商不支持连接测试，可直接保存"}`；全程不发网络请求（集成：mock fetch 调用计数为 0）。
4. 非法 provider（faux / 不存在的 id）→ 400 `E-CONFIG-INVALID`「请选择供应商」（集成回归）。
5. legacy 3 项端点逐字不变：deepseek → `https://api.deepseek.com/models`；moonshotai → `https://api.moonshot.ai/v1/models`；moonshotai-cn → `https://api.moonshot.cn/v1/models`（集成：mock fetch 断言 URL + Bearer 头）。
6. 空 key → 400 `E-CONFIG-INVALID`「API key 不能为空」（集成回归，既有行为）。
7. `E-TEST-UNSUPPORTED` 响应 → 前端结果区展示「该供应商不支持连接测试，可直接保存」，无「连接失败」字样（E2E：settingsProviders 添加表单选 amazon-bedrock + 填 key + 点测试连接）。
8. 协议族分派抽样：`openrouter`（openai 族）→ `https://openrouter.ai/api/v1/models` + Bearer；`mistral` → `https://api.mistral.ai/v1/models` + Bearer；`google` → `https://generativelanguage.googleapis.com/v1beta/models?key=<key>`（集成：mock fetch 断言 URL 与头）。

## REQ-AGENT-104 动态模型拉取全协议族化（v0.7，BUG-002 req-gap 就地补全）

- 优先级 P0 / 必须 / cross-module / modelCatalogService / agent-dialogue / settings / 集成
- 背景：REQ-092 动态拉取仅承诺 kimi 系（moonshotai/moonshotai-cn）+ deepseek 三家，v0.6 放出 37 provider 后其余全走内置目录兜底；用户实证 kimi-coding 期望真实拉取（BUG-002 症状①）。
- 接口契约：`fetchModels(provider, apiKey)` 与 `POST /api/settings/agent/models` 形态不变；拉取端点与鉴权按 REQ-103 协议族分派（同一派生源）；无 key / baseUrl 缺失 / 拉取失败 / 空列表 → `{models, fallback:true}` 兜底（E2/E3 既有签核语义不变）
- 响应解析按族分派（能力标志规则：供应商返回带能力字段（supports_image_in/supports_reasoning）→ 直存（kimi 系 B2 签核语义不变）；否则以 pi-ai 目录补全——deepseek 既有「仅 id → 补全」模式的泛化，目录值与既有硬编码逐字一致已实证）：
  - openai 系 / anthropic 系 / mistral：`{data: [{id, ...}]}` 取 id
  - google：`{models: [{name: "models/<id>", ...}]}` 剥 `models/` 前缀取 id
  - 全部过 `modelInCatalog` 防御（REQ-092 AC5 不变）

验收标准：
1. `kimi-coding` 动态拉取：mock `GET https://api.kimi.com/coding/v1/models`（x-api-key 头）返 anthropic 格式 `{data:[{id:"k3"},{id:"kimi-for-coding"}]}` → `[{model:"k3",vision:true,reasoning:true}, {model:"kimi-for-coding",vision:true,reasoning:true}]`（能力目录补全；集成）。
2. `google` 动态拉取：mock `GET .../v1beta/models?key=...` 返 `{models:[{name:"models/gemini-2.5-pro"}]}` → id 剥前缀 + 目录补能力（集成）。
3. openai 系新放出项（openrouter）：mock `{data:[{id:"<目录内 id>"}]}` → 目录补能力（集成）。
4. kimi 系能力标志直存回归：mock moonshotai 返 `{data:[{id:"kimi-k3",supports_image_in:true,supports_reasoning:true}]}` → 直存（既有用例守护，行为不变）。
5. deepseek 回归：`{data:[{id:"deepseek-v4-flash"}]}` → `{vision:false,reasoning:true}`（既有用例守护——目录补全与既有硬编码逐字一致）。
6. 拉取 401/超时/空列表/目录全剔除 → `{models, fallback:true}` 兜底（既有 E3 语义回归）。
7. baseUrl 缺失 provider（amazon-bedrock）→ 直接兜底不发网络请求（集成：mock fetch 计数为 0）。

## REQ-AGENT-105 上下文用量百分比两位小数（v0.7，BUG-003 req-gap 就地补全）

- 优先级 P1 / 必须 / intra-module / StatusBar（format.js 纯函数 seam）/ agent-dialogue / conversation-space / 单元
- 背景：StatusBar 上下文用量百分比直接拼接 pi SDK 全精度浮点（实证：`5041/262144×100 = 1.9222259521484375%`）；已批准参照 `2026-08-08-pi-agent-ux-enrichment/ux/assistant-rich.html` 为整数格式（`6%`），人拍板推翻为**恒定两位小数**（2026-08-14 BUG-003 分类确认）。数据源（SDK percent 全精度）不变，仅展示层格式化。
- 接口契约：`contextText({tokens, contextWindow, percent})`（format.js 纯函数）→ `"5k / 262.1k tokens · 1.92%"`；`meterWidth` 仍由全精度 percent 驱动（0-100 clamp 不变）
- 参照冲突记录：assistant-rich.html 的 `6%` 整数格式以本 REQ 两位小数为准（旧 story 参照文件不回改）

验收标准：
1. `percent = 1.9222259521484375` → 显示 `1.92%`（单元：contextText 纯函数断言）。
2. `percent = 6` → `6.00%`（恒定两位小数，去尾零不做）。
3. `percent = null / NaN` → 不显示百分比段（既有占位语义不变，回归）。
4. `meterWidth` 行为不变：全精度 percent → 0-100 clamp 宽度（回归）。
