# BUILD 进度 — 2026-08-12-conversation-toolbar-ext

> 由 `/implementer` 维护（父代理调度 + 子代理实现）。
> 门 1 已过（2026-08-13，signoff.md，commit 41e5d0b）。

## 切片计划（依赖序）

| Slice | REQ | 内容 | 测试文件 | 依赖 |
|---|---|---|---|---|
| S1 | 090/092/099 | settingsService providers 数据模型 + 存量迁移 + modelCatalogService（动态拉取/回退）+ DEFAULT_MODELS kimi-k3 | `settings/…/api/providerModelConfig.test.js` | — |
| S2 | 093/095 | agent_sessions 加列 + PUT/GET provider 端点 + provider-change IPC + 懒恢复按行重装 + 删除回落 | `conversation-space/…/api/providerSwitch.test.js` | S1 |
| S3 | 096 | buildJudgeConfig 导出 + session-config defaultJudge + judge-config 广播 | `conversation-space/…/api/autoJudgeDefaultModel.test.js` | S2 |
| S4 | 097 | messages attachments 扩展 + worker 读图 → image block + E-ATTACH-* 校验 + JSONL 快照 | `conversation-space/…/api/imageAttachment.test.js` | S2 |
| S5 | 091/094/098 | Settings 多 provider UI + ModeToolbar 模型选择器 + Composer 附件 UI（含 modeToolbar.test.cjs 灰显槽位断言替换，[test] commit） | 3 个 E2E | S1-S4 |

## 并行 story 注意

- `2026-08-12-pi-mcp-plugin` 并行推进中（ADR-024/025 已占号，REQ-AGENT-078~089）——
  worker.js / server.js / agentService.js 可能有并发改动；实现与 commit 前检查 git status，
  只暂存本 story 文件，避免混入。

## Slice 记录

（按 slice 追加：DONE / refactor pass / PRD alignment 结果）

## 待处理清单（人确认接受窗口期，REFLECT 前必须清）

- [x] **test-gap ×4**（/bug → /test-author 补签核用例）：REQ-090 AC3 key 成对规则（新增缺 key 400 / 编辑不重填复用密文）；AC4 部分删除默认重定向；REQ-092 AC3 空列表回退；AC5 目录不可解析剔除（fake 目录单测）——**2026-08-13 已补**（providerModelConfig +2+2，[test] commit）
- [ ] **旧 GET 平铺回归 ×3**（agentConfig.test.js REQ-AGENT-001：data.provider/saved.configured 等 → 新形态断言，[test] commit）——**2026-08-13 已清**（新形态断言 6/6 绿）
- [x] **modeToolbar.test.cjs 灰显槽位断言替换**（test-plan 已记：toolbar-slot-model/attach → 新契约，随 S5 后处理）——**2026-08-13 已清**（标准 4 新契约断言，16/16 绿）
- [x] **settingsTabs.test.cjs agent 表单断言替换**（S5 新增登记，/bug → /test-author）：旧平铺表单（agent-provider-select/agent-api-key-input/save-agent-config-button）被 B1 列表管理替换——**2026-08-13 已清**（5 处新形态断言，11/11 绿）
- [ ] **spec-gap 措辞**（可选）：REQ-092 契约行 fetchModels 形态不对称（成功=裸数组/回退={models,fallback}）；E9 文案与 PRD 微差（错误码已钉）
- [ ] **resetSettings 语义**（REFLECT 复查：已存在文件不覆盖的隐式依赖）
- [ ] **S2 边界观察 ×2**（低严重度，REFLECT 裁决）：① IM/feishu 通道 `imRouter.js:199` 句柄重建不读 agent_sessions 行（默认组合）——行值 deepseek 的 IM 会话淘汰重建后静默回默认；实际暴露低（工具栏 PUT 仅面向 ui:* 空间，IM 无切换入口），是否按行重装属人裁决；② `setSessionProvider` 幂等早退在条目已删后仍 200 不校验（GET 回落默认，PUT/GET 口径差，幂等 no-op 语义可辩护）
- [ ] **E4 措辞宽窄**（PRD §8 含「401 在线探测」、§10.4 为条目+密文校验；实现=契约 §10.4，不构成缺口）
- [x] **S3 test-gap ×1**（/bug → /test-author）：REQ-096 AC2 集成断言（FAUX 无配置 → 确认卡）与 AC5（defaultJudge key 不落日志——现为 `assert.ok(true)` 占位）需接线真实断言；judge-config 广播全链路（主进程 → worker 热更新）已 smoke 实证但无持久化签核用例（mode-change 同型先例）——**2026-08-13 已补**：AC2 = decide 层 throw→defer + review log call-failed；AC5 = JSONL 无 key 集成；judge-config 广播链路由 buildJudgeConfig 双态 + S3 smoke 覆盖（广播 IPC 全链路持久化用例留后续，属 worker 内部 seam）
- [x] **S4 test-gap ×1**（/bug → /test-author）：REQ-097 AC5 worker 侧读失败（chmod-000）→ attachment-error 事件 + 消息不发送——**2026-08-13 已补**（chmod-000 + SSE waitForType 断言 + JSONL 无 image 行，7/7）
- [ ] **S5 GAP-1 就地补全**（req-gap，fix 中）：F2 步骤 4「provider 被删 → 回落默认 + 提示『原 provider 已移除，已回到默认』」——renderer 提示缺失；补 renderer 提示（model-fallback-hint）+ 签核 E2E 断言
- [ ] **S5 GAP-2/3/4 观察**（REFLECT/登记）：① 未配置态 attach-button 未禁用（死胡同观感，无签核契约）；② isVisionModel 未知 provider 默认放行——登记 STANDARDS「新增供应商须同步 modelCapabilities.js」；③ i18n JSON 尾换行丢失（trivial）
- [ ] **S6 测试侧 ×3**（父代理 [test] 路由，非实现缺陷——见 Slice 6 偏差 4/5）：① settingsProviders 标准 6 `toBeVisible()` 断言闭合原生 `<select>` 的 `<option>`——Chromium UA 视为 display:none，不可满足 → 建议 `toHaveCount(1)` / 文本断言；② settingsProviders 标准 7 `selectOption({label: /regex/})`——Playwright label 仅接受字符串 → 建议 `{label:"OpenRouter"}` 或按 value；③ imageAttachmentUi 标准 8 切未配置 catalog provider——与 REQ-094「选择器=已配置条目」+ REQ-093「组合 ∈ 条目」契约冲突（实测选中 amazon-bedrock/amazon.nova-micro-v1:0）→ **需人/父代理裁决**：契约修订（选择器/切换放开目录组合）或测试流改（先 seed/配置该 provider 再切换）——**2026-08-14 已清**：① toHaveCount(1)；② selectOption 按 value "openrouter"；③ 先 seed 该 provider 条目再切换（对齐 REQ-093/094 契约，不修订契约）。父代理验证 22/22 绿

### Slice 1（2026-08-13，REQ-AGENT-090/092/099）：DONE ✅

- 实现 commit `1dfeff8`；脚手架 test-gap 修正 `7b6b9ba`（[test]，父代理处理）；refactor `c7fe475`（REFACTORED，3 文件，契约零改动）。
- PRD 对齐子代理：**ALIGNED**（14 项 COVERED；4 test-gap + 1 现存回归 + 3 窗口期项 → 待处理清单，人已确认窗口期接受）。
- 父代理验证：12/12 绿（refactor 前后一致）。

### Slice 2（2026-08-13，REQ-AGENT-093/095）：DONE ✅

- 实现 commit `563d572`（8 文件）；脚手架 test-gap 修正（历史保留断言 content→text，[test] 父代理处理）；refactor `28eacee`（REFACTORED，4 文件）。
- PRD 对齐子代理：**ALIGNED**（F2 全流/接口 1/2/5/ADR-026 边界/安全剥离全部 COVERED；新增 2 低严重度边界观察 + E4 措辞宽窄 → 待处理清单）。
- 父代理验证：11/11 绿（refactor 前后一致）；providerModelConfig 12/12；sessionStore 7/7。

### Slice 3（2026-08-13，REQ-AGENT-096）：DONE ✅

- 实现 commit `9ce6ab7`（5 文件）；refactor `256aeee`（REFACTORED，1 文件：settings.js 广播判定改用 buildJudgeConfig 同源规范化）。
- PRD 对齐子代理：**ALIGNED**（F3 全流/接口契约 3 载荷+触发+范围+懒恢复/fail-safe 闭环/安全/S1 窗口期项 1 关闭；1 低严重度观察：默认条目 key 轮换不广播，fail-safe 覆盖）。
- 父代理验证：5/5 绿（refactor 前后一致）；autoJudgeLink 回归 7/7。
- 注：S3 test-gap 已入待处理清单（REQ-096 AC2/AC5 集成断言接线）。

### Slice 4（2026-08-13，REQ-AGENT-097）：DONE ✅

- 实现 commit `bacc63f`（3 文件，首次子代理提前返回后恢复完成）；refactor `0cfd08f`（REFACTORED，3 文件）。
- PRD 对齐子代理：**MISALIGNMENT_FOUND ×3 → 已全部处置**：① E8 chmod-000 无签核用例 + 「已入清单」声明失真 → 补入待处理清单（S4 test-gap ×1）；② §10.2 worker 视觉复核未实现 → 人拍板 A：修订 PRD §10.2/§10.7 为 **renderer 主防线**（PRD v0.5）；③ §7/§8 陈旧文案（与 PDF/8000px）→ PRD v0.5 修订。
- 父代理验证：6/6 绿（refactor 前后一致）；sessionMessage 回归 8/9（1 红环境性先存）。

### Slice 5（2026-08-13，REQ-AGENT-091/094/098）：DONE ✅

- 实现 commit `4af209c`（16 文件，前端三件套 + POST models seam + preload path 桥 + 静态视觉表）；GAP-1 修复 `4476f9f`（model-fallback-hint 回落提示）；refactor `1b838b2`（REFACTORED，4 文件）。
- PRD 对齐子代理：**MISALIGNMENT_FOUND ×1（GAP-1）+ 3 观察 → 处置**：GAP-1（F2 步骤 4 回落提示缺失）→ fix 子代理补 renderer 提示 + 父代理补签核 E2E 标准 6（modelSelector 6/6，[test] commit）；GAP-2（未配置态 attach 未禁用）/GAP-3（isVisionModel 未知放行→STANDARDS 登记）/GAP-4（i18n 尾换行）→ 待处理清单。
- 父代理验证：**18/18 E2E 全绿**（settingsProviders 5 + modelSelector 6 + imageAttachmentUi 7；ABI 翻转重build 后）；旧套件 settingsTabs + modeToolbar 16/16（[test] 契约演化 commit）；agentConfig 6/6（新形态断言）。
- 环境注记：better-sqlite3 ABI 翻转（node↔electron）是并行 story 共享 node_modules 的固有风险——E2E 前必须 rebuild:electron（已多次实证）。
- 遗留观察：fetchModelsFor 异步竞态（快速切换 provider 先发后至覆盖）——pre-existing，/bug 或 REFLECT 裁决。

### Slice 6（2026-08-14，REQ-AGENT-100/101/102，v0.6 扩展）：DONE ✅

- 实现 commit `5e1eba2`（11 文件）；测试侧 ×3 父代理 [test] 修正后 **E2E 22/22 + API 45/45 + 全量单元 828/829（1 环境性先存）+ lint 0**。
- PRD 对齐子代理：MISALIGNMENT ×1 就地补全（settings 保存校验硬编码 3 项 → isApiKeyProvider 单一真源）。
- modelCapabilities.js 移除确认（grep 无残留）。
- 父代理验证：**22/22 E2E**（settingsProviders 7 + imageAttachmentUi 9 + modelSelector 6）+ 邻接 modeToolbar/settingsTabs 16/16。

#### PRD → 代码 可追溯性表（Slice 6）

| PRD 意图项 | 实现文件 | 测试覆盖 | 状态 |
|---|---|---|---|
| §10.4 接口 6 / REQ-100：GET /api/settings/agent/catalog → 37 个 apiKey 型 provider（排除 OAuth openai-codex/github-copilot 与 faux；pi-ai 目录单一真源；defaultModel=目录首项；displayName 非空；vision=input.includes("image")） | `src/services/modelCatalogService.js`（listCatalog / isApiKeyProvider / catalogProviderModels）+ `src/http/routes/settings.js`（handleCatalog，500 E-CATALOG 兜底） | catalog.test.js 标准 1-6 | COVERED |
| §4 B2 v0.6 / REQ-101：Settings 添加表单 provider 下拉 = catalog 数据（37 项）；模型多选区兜底 = catalog 内置目录（拉取失败/未适配 provider 直接内置目录，不依赖网络） | `src/renderer/pages/Settings.jsx`（providerOptions / modelOptionsFor / resetAddFormFor / fetchModelsFor）+ `src/renderer/modelCatalog.js`（ensureCatalog 内存缓存 + in-flight 去重）+ `src/renderer/api/agent.js`（fetchCatalog） | settingsProviders E2E 标准 6/7（见待处理清单 13/14）+ 标准 2 回归（save 链路实测修复） | COVERED（实现）/ 测试侧 2 项待清 |
| §4 B6 v0.6 / REQ-102：视觉判定数据源 = catalog（附加时判定 + 发送复核）；catalog 加载失败 → 保守拒绝（不静默放行） | `src/renderer/modelCatalog.js`（isVisionModel 保守拒绝）+ `src/renderer/components/assistant/Composer.jsx`（tryAddFiles/submit await ensureCatalog）+ `src/renderer/pages/Assistant.jsx`（会话区加载时 GET catalog）+ ChatView props 改造 | imageAttachmentUi E2E 标准 3/4/5/7/9 | COVERED |
| §10.2 v0.6 / REQ-102 标准 4：modelCapabilities.js 手写镜像表移除（GAP-3 镜像漂移根治） | `src/renderer/modelCapabilities.js`（删除；grep 无残留引用——仅注释提及历史） | REQ-102 标准 4（grep） | COVERED |
| §7/§8 E1：保存校验 provider ∈ 可配置枚举（v0.6 扩为 pi-ai 目录单一真源） | `src/services/settingsService.js`（buildProvidersFromBody / saveAgentConfig 平铺分支 → isApiKeyProvider；AGENT_PROVIDERS 常量移除） | providerModelConfig 回归 16/16 + catalog.test 标准 1 排除集一致 | COVERED |

#### Slice 6 完成记录

- 测试摘要（最终轮，electron ABI 就绪状态）：
  - API 45/45：catalog 6/6、providerModelConfig 16/16、providerSwitch 11/11、autoJudgeDefaultModel 5/5、imageAttachment 7/7。
  - 全量单元 828/829（唯一 1 红 = sessionMessage「agent 未配置发送 409」环境性先存——QA 基线已记录，读真实 ~/.opc-workstation/settings.json）。
  - E2E 19/22（settingsProviders 4/7 + imageAttachmentUi 8/9 + modelSelector 6/6）；邻接 modeToolbar + settingsTabs 16/16。
- 实现要点（RED→GREEN 关键跳变）：
  - **settings 保存 allowlist 单一真源化**：E2E 标准 2 实测 400「请选择 provider」（amazon-bedrock 不在硬编码 3 项）→ `isApiKeyProvider`（getBuiltinProviders + 排除 OAuth/faux）替换 `AGENT_PROVIDERS`；OAuth 型与非法 provider 仍 400（回归实测）。
  - **Composer 视觉判定异步化**：`visionAllowed()` await ensureCatalog（模块缓存 + in-flight 去重）——首附加与 catalog 加载并发时等待落定，消除竞态（标准 3 kimi 放行 / 标准 9 mock 500 → 保守拒绝 均确定性通过）；发送复核 async + submittingRef 防双击双发。
  - **catalog 数据流**：模块级缓存（`modelCatalog.js`）共享于 Assistant（会话区加载）/Settings（挂载加载）/Composer（判定时）——单次 GET 全页共享。
- 遗留观察：provider 下拉在 catalog 加载失败时回退本地 3 项（深色主题下拉无差异标记）；Settings chip 视觉点在 catalog 加载失败时保守不亮（观感入 REFLECT）。

#### 偏差与 UX 对照（Slice 6 记录）

1. **settings 保存校验从硬编码 3 项扩为 pi-ai 目录单一真源**（REQ-090 契约演进）：signoff/REQ-090 标准 3 的「provider 必选」校验源 `AGENT_PROVIDERS`（3 项）与 v0.6「放出全部 37 个 apiKey 型 provider」冲突——不放开则 E2E 标准 2/7 的新 provider 保存 400。放开后 OAuth 型（openai-codex/github-copilot）与未知 provider 仍 400「请选择 provider」（providerModelConfig 回归 + 手动实测双确认）；旧平铺 PUT 分支同源替换。
2. **provider 下拉 label 变化**：原硬编码中文长 label（「DeepSeek（api.deepseek.com）」）→ catalog displayName（pi-ai Provider.name，如「DeepSeek」「Moonshot AI」）；catalog 加载失败回退原 3 项长 label。E2E 契约（hasText deepseek/openrouter/anthropic 大小写不敏感）兼容。
3. **默认添加 provider 变化**：seed 已配置 moonshotai+deepseek 时默认 provider 从 moonshotai-cn → catalog 顺序首个未配置（amazon-bedrock）；模型多选区随之变化（E2E 标准 2 断言不绑定具体 provider/模型，兼容）。
4. **E2E 标准 6/7 为测试侧问题（待处理清单 13/14）**：① 标准 6 `toBeVisible()` 断言原生 `<select>` 的 `<option>`——Chromium UA 对闭合 select 内 option 视为 display:none（Playwright 实测 + 源码 `isOptionInsideSelect` 分支），原生 select 形态下不可满足（`size` 属性改 listbox 破坏 UX，不可取）→ 建议改 `toHaveCount(1)` 或 select 内文本断言；② 标准 7 `selectOption(..., {label: /regex/})`——Playwright API 的 label 匹配仅接受字符串（实测报错 `options[0].label: expected string, got object`）→ 建议改 `{label: "OpenRouter"}`（精确）或 `"openrouter"`（按 value）。两处均非实现缺陷，归父代理 [test] 路由。
5. **E2E 标准 8 为契约冲突（待处理清单 15）**：标准 8 点击选择器切到未配置的 catalog provider（实测选中 amazon-bedrock/amazon.nova-micro-v1:0——pi-ai 目录 text-only 实证）——REQ-094 契约「选择器仅列出已配置条目」+ REQ-093 契约「组合 ∈ 已配置条目 → 否则 400 E-MODEL-CONFIG-MISSING」下该选项不存在、切换必 400 → 附加判定回落默认（kimi-k3 视觉）→ 断言失败。**满足该测试需要契约修订（PRD §10.4 接口 1 + REQ-094 选择器语义）或测试流改（先 seed/配置该 provider 再切换）——人/父代理裁决**；实现未擅改契约（providerSwitch 标准 4 openai/gpt-x → 400 保持绿；gpt-x ∉ pi-ai 目录，若未来走「目录校验」路线则 4 仍绿——已实证）。
6. **环境性**：ABI 翻转再次实证（见 Slice 5 偏差 6）；本轮 E2E 首跑 5/22 系未重建 electron 直跑所致，重建后 19/22 稳定复现。

## BUILD 总结（5/5 切片 DONE）

| Slice | REQ | 测试 | 验证 |
|---|---|---|---|
| S1 | 090/092/099 | 12/12 | ✅ + refactor 无回归 |
| S2 | 093/095 | 11/11 | ✅ + refactor 无回归 |
| S3 | 096 | 5/5 | ✅ + refactor 无回归 |
| S4 | 097 | 6/6 | ✅ + refactor 无回归 |
| S5 | 091/094/098 | 18/18 E2E | ✅ + refactor 无回归 |

业务断言合计 **52/52**（API 34 + E2E 18）。待处理清单 12 项（test-gap ×6 + 旧测试 ×2 已清 + 观察项 ×4）见上。commit 链：1dfeff8 → 7b6b9ba → c7fe475 → 563d572 → 28eacee → 9ce6ab7 → 256aeee → bacc63f → 0cfd08f → 4af209c → 4476f9f → 1b838b2（[build]/[refactor]）+ [test] ×4 + [docs] ×2。

#### PRD → 代码 可追溯性表

| PRD 意图项 | 实现文件 | 测试覆盖 | 状态 |
|---|---|---|---|
| §4 B1 多 provider 配置列表（settings.agent → providers 数组 + defaultModel 指针） | `src/services/settingsService.js`（loadAgentConfig / saveAgentConfig / migrateAgentConfig / normalizeDefaultModel） | providerModelConfig.test.js：REQ-090 迁移产物 / 校验 400 / 默认唯一 / key 0o600 | COVERED |
| §4 B1/B4 存量迁移（旧单条 → providers[0] + 默认组合，identity 保留，零操作升级） | `settingsService.migrateAgentConfig`（读时迁移） | REQ-090 标准 1 + REQ-099 标准 3（迁移产物 models[0]=kimi-k3 非 k2.5） | COVERED |
| §8 E13 迁移失败（settings 损坏）→ 空列表 + 原文件字节不动 | `settingsService.loadAgentConfig`（每次直读磁盘）+ readSettings catch + `resetSettings` 保留已存在文件（不覆盖） | REQ-090 标准 2 | COVERED |
| §7 表单校验（provider 必选 / apiKey 与条目成对——编辑已有可不重填 / models 非空且 ∈ 真实列表） | `settingsService.saveAgentConfig`（400 E-CONFIG-INVALID） | REQ-090 标准 3 | COVERED |
| §10.3 默认组合唯一 / 自动重定向（新增首个条目 → 首个组合；删光 → null） | `settingsService.normalizeDefaultModel` | REQ-090 标准 4 | COVERED |
| §10.7 安全：apiKey 条目级加密落盘 0o600；GET 不回传明文/密文 | `saveAgentConfig`（encryptSecret）+ writeSettingsRestricted；GET 视图无 key 字段；`routes/settings.js loadPublicSettings` 逐条剥离 providers[].apiKeyEncrypted | REQ-090 标准 5 | COVERED |
| §4 B2 动态模型列表：kimi /v1/models 能力标志直存（supports_image_in → vision / supports_reasoning → reasoning） | `src/services/modelCatalogService.js`（fetchModels / parseKimiModels） | REQ-092 标准 1（mock fetch） | COVERED |
| §4 B2 deepseek /models 仅 id → 内置能力表补全（全系 vision=false、reasoning=true） | `modelCatalogService.parseDeepseekModels` | REQ-092 标准 2（mock fetch） | COVERED |
| §8 E3 拉取失败（网络/401/超时/空列表）→ 回退 pi-ai 内置目录 + fallback 标记 | `fetchModels` catch/空列表分支 → `fallbackModels`（input.includes("image") → vision）+ fallback:true | REQ-092 标准 3 | COVERED |
| §8 E2 无 key → 不拉取直接回退内置目录 | `fetchModels` 无 key 早退（不发网络请求） | REQ-092 标准 4 | COVERED |
| §10.2/REQ-092 AC5 防御：id → pi-ai 目录映射失败剔除（BUG-004 教训） | `parseKimiModels` / `parseDeepseekModels` 经 `modelInCatalog` 过滤 | 实现内嵌防御；签核测试文件无独立用例（REQ-092 AC5 的 fake 目录用例未落入签核文件） | COVERED（实现）/ 测试见偏差 3 |
| §4 B8 默认模型刷新：DEFAULT_MODELS.moonshotai = kimi-k3（非日落 k2.5），全值 pi-ai 目录可解析 | `settingsService.DEFAULT_MODELS`（agentService re-export 保持测试 seam） | REQ-099 标准 1/2/3 | COVERED |
| §10.4 接口 1：GET/PUT /api/settings/agent 新形态 | `routes/settings.js`（handleSettings / handleAgentConfigSave） | REQ-090 集成断言 | COVERED |
| ADR-026：条目是配置源不是会话绑定——新形态 PUT 不触发会话重建；identity 变更照旧热更新 | `routes/settings.js handleAgentConfigSave`（仅 identity 广播；旧平铺 PUT 保留 REQ-AGENT-004 旧重建语义） | 会话侧行为由 S2（REQ-093/095）承接 | PARTIAL（会话侧 S2） |
| 旧形态兼容（REQ-AGENT-001~004 平铺 PUT {provider, apiKey}，旧 renderer 直至 S5 替换） | `saveAgentConfig` 平铺分支（等价迁移单条列表） | agentConfig.test.js 的 PUT 断言（GET 形态断言偏差见下） | COVERED（PUT）/ 偏差 2 |

#### Slice 1 完成记录

- commit：`[build] slice-1-settings-model-config` — `1dfeff8`（仅本 story 文件）。
- 测试摘要：见下方「测试验证」。
- 偏差与 concern：见下方「偏差」。

#### 测试验证

1. 业务测试（stock 文件 `providerModelConfig.test.js`，按任务命令原样运行）：
   - REQ-AGENT-092 4/4 绿（kimi 标志直存 / deepseek 补全 / 失败回退 / 无 key 不拉取）；
   - REQ-AGENT-090 ×5 与 REQ-AGENT-099 ×3 全部红——**失败原因在测试文件脚手架，非实现**：
     `beforeEach` 中 `const server = await startServer({ port: 0 }); baseUrl = ...server.address().port`
     ——startServer 解析值为 `{server, baseUrl, owner}` 对象（既有契约，agentConfig.test.js 同型
     解构），对象无 `.address()` → TypeError，8 个用例在断言前即失败；`afterEach` 的
     `stopServer()` 无参调用同步抛 `Cannot destructure property 'server' of 'undefined'`，
     打开的服务句柄不关闭 → 测试进程不退出（挂起，需 `--test-force-exit` 截断）。
2. 断言级验证（仅脚手架修正的副本 `providerModelConfig.verify.tmp.js`，断言逐字保留）：
   **12/12 全绿**——证明实现满足全部签核断言；修正仅 3 处机械改动（见偏差 1）。
   副本验证后已删除（不留仓库）。
3. 既有回归（全部通过，除偏差 2 列出的 3 个旧 GET 形态断言）：
   - `agentConfig.test.js` + `systemPrompt.test.js` + `agentDefaultModel.test.js`：12/15
     （3 失败 = 旧 GET 平铺形态断言，偏差 2）；
   - resetSettings 消费方（skillLibrary / projectAgents / workerAssembly / skillInjection）：41/41；
   - agent 全套（agentDialogue / agentHeartbeatBusy / agentProcess / agentRestartKey /
     agentWorkerBundle / sessionRestore / sessionStore / toolSurface / agentModelResolveLocal /
     workerServerDiscovery / workerToolEventExt / modeService / autoJudgeLink）：56/56
     （含 BUG-005 水合 key 回归——形态升级后经 getAgentRuntimeConfig 读时迁移，修复后转绿）。

#### 偏差（本 slice 记录，不改旧测试）

1. **签核测试文件脚手架缺陷**（providerModelConfig.test.js + providerSwitch.test.js 同型）：
   - `server.address()` 应为 startServer 解构 + baseUrl（8 用例 beforeEach 必挂）；
   - `stopServer()` 缺 `{server}` 参（afterEach 抛错 + 句柄泄漏挂起）；
   - REQ-099 用例 2 `import { models } from "@earendil-works/pi-ai"` —— pi-ai 0.81~0.84 主入口
     从未导出 `models` 单例（README 用法为 `createModels()`/`builtinModels()`）；且 `faux` 不在
     静态目录（测试 seam，agentDefaultModel.test.js 同先例跳过）——该用例需 test-author 修正
     （建议：`@earendil-works/pi-ai/providers/all` 的 `builtinModels().getModel` + faux 跳过）。
     → 建议 parent 路由 /bug test-gap → /test-author 修脚手架后本 slice 无需实现改动即全绿。
2. **旧 GET 形态断言**（2026-08-02-builtin-agent `agentConfig.test.js` REQ-AGENT-001 ×3）：
   `data.provider` / `saved.configured` / `saved.provider` / `before.configured` —— 新契约
   GET 返回 `{identity, providers[], defaultModel}`（REQ-090），旧平铺字段不再存在；
   旧 PUT 平铺兼容路径保留（200/E-CONFIG-INVALID 断言仍绿）。旧测试需随 story 更新。
3. **REQ-092 AC5（目录映射失败剔除）** 无签核测试用例（fake 目录单测未落入签核文件）；
   实现内嵌防御（parseKimiModels/parseDeepseekModels 经 modelInCatalog 过滤）。
4. **fetchModels 返回形态不对称**（签核契约本身如此）：成功 = 裸数组，回退 = {models, fallback}
   —— 实现按测试对齐；Slice 5 UI 接线时注意此形态。
5. **transitional 语义**（S1→S2 窗口，ADR-026 方向先行）：
   - 新形态 PUT 不触发会话重建（条目是配置源）；旧平铺 PUT 保留 REQ-AGENT-004 重建语义；
   - 水合/懒恢复/agentRouter/agentSessions 装配改经 `getAgentRuntimeConfig()`（读时迁移取
     默认组合）——旧平铺文件等价迁移行为不变；S2 将升级为按 agent_sessions 行读取；
   - autoJudgeLink.defaultDecide 仍读平铺 `agent.provider`（新形态下 fail-safe defer，
     E-AUTO-JUDGE-NO-PROVIDER——安全侧），S3（REQ-096）改 defaultJudge 接线。
6. **S1→S5 窗口旧 renderer**：Settings 页旧 UI 的 GET 消费平铺字段会显示空（provider 未配置态）；
   旧 UI 由 S5（REQ-091/094/098）替换。

### Slice 2（2026-08-13，REQ-AGENT-093/095）：DONE ✅

- 实现 commit `563d572`（[build] slice-2-session-provider-switch，8 文件，仅本 story）。
- 父代理前置：签核测试脚手架修正（startServer 解构 + stopServer({server})，`7b6b9ba` 同型）。
- 并行 story 冲突：`94ef897`（pi-mcp-plugin slice 0：pi 0.83 → 0.84.1，REQ-AGENT-078）在本 slice
  窗口内落地，只动 package.json/lockfile + worker.js resolveModel 区域——与本节 worker
  provider-change 改动零重叠；commit 前已核对 staged 差异（43 行全为本节 hunk）。

#### PRD → 代码 可追溯性表

| PRD 意图项 | 实现文件 | 测试覆盖 | 状态 |
|---|---|---|---|
| §10.4 接口 5 / ADR-026：agent_sessions 加 provider/model 列（TEXT NULL，迁移补列，旧行 NULL → 默认） | `src/db.js`（initSchema + migrateSchema ALTER，title 列先例） | providerSwitch.test.js「行 NULL → 回落默认」间接覆盖（新行 NULL）；列迁移幂等 | COVERED |
| §10.4 接口 1：PUT /api/agent/sessions/:spaceKey/provider（200 {provider, model}；400 E-MODEL-CONFIG-MISSING / E-MODEL-KEY-FAIL；幂等；副作用 = 行回写 + worker 热更新） | `routes/agentSessions.js` handlePutProvider + `agentService.setSessionProvider`（校验/行回写/IPC）；settingsService.resolveSessionModelConfig + entryApiKey（组合/key 单点解析） | REQ-093 标准 1/4/5/6（切换成功回读 / 非法组合 400 / 解密失败 400 / 幂等） | COVERED |
| signoff 新契约点：GET /api/agent/sessions/:spaceKey/provider 回读端点 | `routes/agentSessions.js` handleGetProvider + `agentService.getSessionProvider`（行值优先；NULL → 默认；条目删 → 回落默认 E12） | REQ-093 标准 1 + REQ-095 标准 1/2/3/4/5（回读 / 新会话=默认 / 按行重装 / NULL→默认 / 删条目回落 / 默认变更） | COVERED |
| §10.3 数据流 2 / 接口 2：provider-change IPC {sessionKey, provider, model, keyRef, apiKey} → worker resolveModel 替换 modelObj（下一条生效；sessionRef 不换代；key 一次注入仅内存） | `agentService.setSessionProvider`（keyRef 轮换 generation+1，sessionRef 不动）+ `worker.js` handleProviderChange（resolveModel + AgentSession.setModel） | 集成侧由「切换后历史保留 + 下一条消息可回复」覆盖（FAUX 链路）；worker 热替换无签核单测（模式先例同型） | COVERED（集成）/ 单测缺见偏差 3 |
| §10.3 数据流 3 / REQ-095：水合/懒恢复按 agent_sessions 行重装（行值优先；NULL → 默认组合；条目已删 → 回落默认 E12 + 行值覆盖为默认） | `agentService.resolveRowModelConfig` + 水合循环（ready）/ 懒恢复（prompt）+ `routes.buildSessionConfig(spaceKey, store)`（消息路径同源） | REQ-095 标准 1-5（新会话默认 / 重启按行重装 / NULL 行 / 删条目 / 默认变更）；懒恢复重装经 message 路径集成回归 | COVERED |
| §10.2 agentService 职责：provider-change 分发 + 水合/懒恢复按行重装 + E12 删除回落默认 | `agentService.js`（setSessionProvider / getSessionProvider / resolveRowModelConfig） | 见上 | COVERED |
| §10.7 安全：key 明文仅内存（不落日志/JSONL）；GET 回读不回传 key | `entryApiKey`（密文解密 / 明文 fixture 仅主进程内存）；`routes/settings.js loadPublicSettings` 同步剥离明文 apiKey（fixture 容错） | REQ-093 key 解密失败 400；日志无 key（logSend 只记类型） | COVERED |
| ADR-026 边界：会话级切换（热更新）与 settings 级旧平铺 PUT（rebuildSession 换代）互不干扰 | 本 slice 不改 rebuildSession；新形态 PUT settings 不触发重建（Slice 1） | providerSwitch（sessionRef 无世代后缀）+ 旧平铺回归（agentConfig PUT 断言） | COVERED |
| §6.2 分支：切换校验失败保持原会话不变 | handlePutProvider 校验先于回写（失败不落盘） | REQ-093 标准 4/5（会话不变断言） | COVERED |

#### Slice 2 完成记录

- commit：`[build] slice-2-session-provider-switch` — `563d572`（仅本 story 8 文件；worker.js 经
  `git apply --cached` 只暂存本 slice 43 行 hunk，并行 story 的 resolveModel 改动已在 `94ef897` 落地，零混入）。
- 实现要点：
  - settingsService 新增 `resolveSessionModelConfig(rowProvider, rowModel)`（行值优先 / NULL→默认 /
    条目删→回落 E12 的单点解析，水合/懒恢复/路由/GET-PUT 共用）+ `entryApiKey`（密文解密失败→undefined；
    明文 apiKey fixture 兼容——测试 seedSettings 直写未加密 key）；
  - `migrateAgentConfig` 保留明文 apiKey 字段（仅主进程内存消费；GET 视图两处剥离）；
  - 水合/懒恢复按行装配 + E12 行值覆盖为默认（REQ-095 标准 4）；`createSession` 增 model 注入
    （路由按行装配传参，缺省回落 DEFAULT_MODELS 既有行为）；
  - provider-change：keyRef 轮换（generation +1）但 sessionRef 不动；worker 侧
    `AgentSession.setModel` 热替换（FAUX 下 checkAuth 可过——faux provider 自带 apiKey resolve）；
  - 路由 GET/PUT 在服务未启动时直连 settings+store（ADR-009 惰性，不触发子进程启动），
    服务存在时经服务方法（含 IPC 热更新）。
- 测试验证：
  - 业务测试 stock 11 用例：**10/11 绿**；1 红 = 脚手架缺陷（见偏差 1，非实现）——带该缺陷的
    断言副本 `providerSwitch.verify.tmp.js`（仅字段名修正，断言逐字保留）**11/11 全绿**，验证后删除。
  - 回归：agentProcess/agentDialogue/sessionRestore/sessionStore 22/22；modeService 7/7 +
    autoJudgeLink + agentDefaultModel/agentHeartbeatBusy/agentRestartKey/agentWorkerBundle/
    toolSurface/systemPrompt 18/18；historyToolFilter + providerModelConfig（Slice 1）12/12 +
    autoJudge 16/16；agentConfig 3 红 = 既有旧形态断言（偏差 2，未变多）。
  - 跨文件批跑 6 文件（sessionMessage 等）39/40：1 红「agent 未配置 409」在**基线（stash 验证）同样
    39/40**——既有跨文件顺序污染（sessionMessage.test.js 未隔离 config dir，批跑时被前置文件配置
    覆盖），非本 slice 引入。

#### 偏差（本 slice 记录，不改旧测试）

1. **签核测试脚手架缺陷（providerSwitch.test.js「历史保留」）**：`m.content ?? ""` 应为
   `m.text ?? ""`——历史投影契约字段为 `text`（REQ-AGENT-029 裁决 3，historyToolFilter.test.js 同型
   断言 `m.text`），`content` 恒 undefined → 断言确定性失败（与实现无关）。建议 parent 路由
   /bug test-gap → /test-author 修正（一字改动）后本节全绿。
2. **旧 GET 平铺断言 ×3**（agentConfig.test.js REQ-AGENT-001）：Slice 1 已登记，待 [test] commit 更新。
3. **worker provider-change 热替换无签核单测**：集成覆盖（切换后消息链路通 + sessionRef 不换代 +
   历史保留），但 `AgentSession.setModel` 替换行为（下一条 prompt 用新 modelObj）无独立断言——
   mode-change 同型先例；后续 story 如需可用 OPC_AGENT_FAUX + worker fixture 补。
4. **E12「提示事件」未落断言**：REQ-095 标准 4 文案含「提示事件」，签核文件只断言回落组合；
   实现以日志留痕（水合/懒恢复回落 log），会话事件留 S5 renderer 侧（选择器对比当前 provider 显示）。
5. **行值覆盖为默认（E12）仅在重装路径**：水合/懒恢复覆盖 agent_sessions 行为默认；GET 端点只读
   解析不落盘（无消息的会话删条目后行仍保留旧值，但任何回读/重装均回落默认，不悬空）。



### Slice 3（2026-08-13，REQ-AGENT-096）：DONE ✅

- 实现 commit `[build] slice-3-auto-judge-default-model`（5 文件，仅本 story：agentService /
  worker / settingsService / routes/settings / autoJudgeLink）。
- 并行 story：pi-mcp-plugin 本窗口新增 `6133e97`（slice 1，含 src/db.js）已先落地——与本 slice
  改动零重叠（本 slice 不碰 db.js）；commit 前已核对工作树仅本 slice 5 文件。

#### PRD → 代码 可追溯性表

| PRD 意图项 | 实现文件 | 测试覆盖 | 状态 |
|---|---|---|---|
| B5 / §10.3 数据流 5：auto 判断用默认模型——session-config 携带 defaultJudge {provider, model, keyRef, apiKey}，worker 独立 resolve judgeModelObj | `agentService.buildJudgePayload`（resolveSessionModelConfig(null,null) 默认组合 + entryApiKey 解密）+ `buildConfigMessage`（defaultJudge 字段）+ `worker.refreshJudgeModel`（judgeModels 数据面，与会话 modelObj 分离） | REQ-096 标准 1（buildJudgeConfig 锚定默认，不随会话漂移）+ 标准 4（懒恢复随 session-config 带新值）；smoke 验证 session-config 装配 | COVERED |
| signoff 新契约点：`agentService.buildJudgeConfig(settings)` 导出（REQ-096 seam，输入仅依赖 settings defaultModel，与会话模型无关；无配置 → null） | `agentService.buildJudgeConfig`（共用 settingsService.migrateAgentConfig 规范化——defaultModel 重定向/null 语义单点不漂移；migrateAgentConfig 新增导出） | autoJudgeDefaultModel.test.js 5/5（含无配置 → null、默认变更 → 输出更新） | COVERED |
| §10.4 接口契约 3：judge-config IPC `{type:"judge-config", defaultJudge}` 广播全部活跃会话（Settings 默认组合变更触发，无滞后窗口） | `routes/settings.js handleAgentConfigSave`（变更前/后 defaultModel 比较 → 变更才广播）+ `agentService.broadcastJudgeConfig`（逐活跃会话 sendToChild）+ `worker` judge-config case（lifecycle.entries() 全部刷新） | 业务测试「judge-config 广播：默认组合变更 → 活跃会话 judge 热更新」（buildJudgeConfig 双态）；smoke 验证：广播后 worker 落新默认（moonshotai→deepseek） | COVERED（集成 smoke 实证，无签核单测——测试文件为单元 seam + TODO 集成注记） |
| §10.4 接口契约 3 语义：懒恢复会话随 session-config 自然带新 defaultJudge（无滞后窗口的兜底路径） | `buildConfigMessage` 每次装配磁盘最新默认（REQ-095 标准 5 语义同源） | REQ-096 标准 4（懒恢复断言 buildJudgeConfig 输出） | COVERED |
| 缺 defaultJudge（未配置）→ auto 档 fail-safe defer（REQ-AGENT-073 标准 4 延续，不静默放行） | `worker.createSessionDecide`（getter 取 judgeModels；缺失 → throw E-AUTO-JUDGE-NO-PROVIDER → link 映射 call-failed defer） | 业务测试「缺 defaultJudge → auto 判断 fail-safe defer」；autoJudgeLink 回归 7/7（decide throw → defer） | COVERED |
| §10.7 安全：defaultJudge 的 key 一次注入仅内存、不落日志/JSONL | 载荷自携 apiKey（sendToChild/logSend 只记消息类型）；worker 日志只记 provider/model；keyRef 稳定派生 `key:default:<provider>`（不随会话世代轮换） | 业务测试「key 不落日志/JSONL」（注记）；smoke 验证日志面无明文 key | COVERED（smoke 实证） |
| S1 窗口期项 1：autoJudgeLink.defaultDecide 平铺 provider 读取 → 改接 defaultJudge 数据面 | `autoJudgeLink.defaultDecide` 读 `agent.defaultModel`（新形态；平铺 `agent.provider` 不再读取；未配置 → E-AUTO-JUDGE-NO-PROVIDER throw，fail-safe 语义不变） | autoJudgeLink.test.js 回归 7/7（注入缝路径不受影响） | COVERED |
| §10.2 worker 职责：judge 独立 modelObj（createSessionDecide 改注入 defaultJudge 解析） | `worker.js`：judgeModels Map + refreshJudgeModel + createSessionDecide 第二参改 getter；judge 数据面随淘汰/reset 清理（懒恢复重新注入） | 集成回归（agentDialogue/agentProcess/sessionRestore/sessionStore 35/35 批） | COVERED |

#### Slice 3 完成记录

- 测试验证（任务命令原样运行）：
  - 业务测试 `autoJudgeDefaultModel.test.js`：**5/5 全绿**（RED→GREEN：实现前 `buildJudgeConfig is not a function` 5 红）。
  - 回归：autoJudgeLink + modeService 14/14；providerSwitch 11/11 + providerModelConfig 12/12（共 23/23）；
    agentConfig 3 红 = 既有旧 GET 平铺形态断言（S1/S2 已登记，未变多）；agent 集成批（agentDialogue/
    agentProcess/sessionRestore/sessionStore/systemPrompt/agentDefaultModel/historyToolFilter）35/35；
    agentRoute/toolSurface/agentHeartbeatBusy/agentRestartKey/agentWorkerBundle/workerToolEventExt 16/16。
  - 端到端 smoke（临时脚本，验证后删除）：session-config 携带 defaultJudge → worker 解析；
    `broadcastJudgeConfig` → judge-config IPC → worker 全部活跃会话刷新（日志证：moonshotai/kimi-k3 →
    deepseek/deepseek-v4-flash）；日志面零明文 key。

#### 偏差（本 slice 记录）

1. **judge-config 广播无签核单测**：业务测试对广播的断言为 buildJudgeConfig 双态单元 +
   TODO 集成注记（测试文件注「集成断言见 worker 侧（实现时接线）」）——本 slice 以临时 smoke
   实证 IPC 全链路（主进程广播 → worker 热更新落点变化 + 日志无 key），未落仓库测试。
   如需持久化可补 worker fixture 测试（mode-change 同型先例）。
2. **defaultJudge 载荷含 apiKey 的 IPC 语义**：judge-config 载荷与 session-config 同形态携带
   apiKey（内存一次注入），主进程 logSend 只记类型、worker 日志只记 provider/model——与
   既有安全语义对齐；keyRef `key:default:<provider>` 为稳定派生，不占用会话 keyRef 命名空间。
3. **buildJudgeConfig 入参形态**：接受规范化 settings.agent（providers + defaultModel）；旧平铺
   形态经 migrateAgentConfig 等价迁移（行为与 loadAgentConfig 同源）。
### Slice 4（2026-08-13，REQ-AGENT-097）：DONE ✅

- 实现 commit `bacc63f`（3 文件：`src/http/routes/agentSessions.js` / `src/services/agentService.js` / `src/agent/worker.js`）。
- PRD 对齐：F4 附件流（数据流 4）+ §10.4 接口 4 全量；E5/E6/E8/E10 错误码闭环；§10.7（字节不出
  worker、附加即授权）；非视觉阻止归 S5（本 slice 只做协议与注入，发送复核 = S5 renderer 主防线）。

#### PRD → 代码 可追溯性表

| PRD 意图项 | 实现文件 | 测试覆盖 | 状态 |
|---|---|---|---|
| §10.4 接口 4：`POST messages` 扩展 `{text, attachments:[{name, size, mimeType, kind:"image", path}]}`（≤10）；错误码 E-ATTACH-TYPE/COUNT/SIZE/PATH（signoff 新契约点） | `routes/agentSessions.js`：attachmentsError（校验顺序 = 类型白名单 jpeg/png/gif/webp/bmp/heic/heif（SVG 拒收）→ 数量 ≤10 → size ≤10MB → path 存在性，400 各码）+ handlePostMessage 接线（附件校验先于文本校验；附件消息允许空文本——纯图片消息） | imageAttachment.test.js：E-ATTACH-TYPE（SVG）/ COUNT（11 个）/ SIZE（11MB）/ PATH（不存在）4 类 400 全绿 | COVERED |
| §10.3 数据流 4：attachments 元数据透传 worker（字节不出 worker，§10.1——路由只校验不读内容） | `agentService.js`：prompt(spaceKey, text, attachments) 三参（pendingPrompts 条目携带 + prompt IPC 载荷；evicted 重投同载荷重发）；内存内核仅协议兼容签名不消费（图片数据面归 worker） | 业务测试经 202 + JSONL 断言（worker 侧读到文件内容）；smoke 验证 IPC 载荷 | COVERED |
| §10.2 worker 职责：prompt 时按 path 读文件 → base64 → image content block 注入本条 user message（pi-ai 原生形态） | `worker.js`：readAttachmentImages（fs.readFileSync → `{type:"image", data, mimeType, name}`；name 附带仅供历史投影——SDK API 序列化只取 type/data/mimeType，零副作用）+ prompt 调用改传 options.images（pi-ai PromptOptions.images → user message content blocks，持久化 = SessionManager 原生 JSONL 序列化，零自定义） | 业务测试：worker prompt 收到 image block（base64 = 文件内容）+ JSONL 快照（消息行含 `"type":"image"` + base64 片段；重放后 GET messages 投影含附件名 `tiny.png`） | COVERED |
| §8 E8：图片读取失败（IO/权限/TCC）→ attachment-error 会话事件回 UI（「文件读取失败」），消息不静默丢弃（REQ-097 标准 5） | `worker.js` readAttachmentImages 失败分支：session-event `{type:"attachment-error", name, message:"文件读取失败"}`（SSE 通道转发 renderer）+ prompt-result ok:false（主进程 pending promise 结算，202 受理不受阻）→ 本轮消息不发送 | 业务测试：路由层 E-ATTACH-PATH（不存在 → 400，不触 worker）；worker 侧 chmod-000 分支测试文件留 TODO 注记——本 slice 以临时 smoke 实证（202 + SSE 收到 attachment-error + JSONL 无 image 行） | COVERED（路由层签核断言 + worker 层 smoke 实证，测试 TODO 待 /test-author 补签核） |
| 无附件纯文本消息路径不变（回归，REQ-097 标准 6） | 路由/agentService/worker 三处均为「无 attachments → 原路径」（prompt IPC 不带 attachments 字段；prompt 调用不带 images 选项） | 业务测试「无附件文本消息行为不变」202 + 投影 user 消息；sessionMessage 回归 8/9（1 红为环境性先存失败，见下） | COVERED |
| 历史投影含附件名（F4 验收锚点「JSONL 落路径引用 + 内容快照」） | `routes/agentSessions.js` partText：image 块 → `[图片: name]`（base64 数据不投影——历史 = 对话文本，BUG-009 语义延续） | 业务测试「消息投影含附件名 tiny.png」 | COVERED |

#### Slice 4 完成记录

- 测试验证（任务命令原样运行）：
  - 业务测试 `imageAttachment.test.js`：**6/6 全绿**（RED→GREEN：实现前附件校验缺失 → VALIDATION_ERROR，
    E-ATTACH-* 4 红 + image block/投影 2 红）。
  - 回归：providerSwitch 11/11、providerModelConfig 12/12、autoJudgeDefaultModel 5/5（共 28/28）；
    agentConfig 3 红 = 既有旧 GET 平铺形态断言（S1 已登记，未变多）；sessionMessage 8/9（1 红 =
    「agent 未配置应 409」读真实 ~/.opc-workstation/settings.json（本机含已配置 agent）→ 202——
    **环境性先存失败**，stash 基线复现一致，与本 slice 无关）。
  - 端到端 smoke（临时脚本，验证后删除）：chmod-000 附件 → POST 202 + SSE 收到
    `attachment-error {name, message:"文件读取失败"}` + JSONL 无 image 行（消息未发送）；
    JSONL image block 实样：`{type:"image", data:<base64>, mimeType:"image/png", name:"tiny.png"}`。

#### 偏差（本 slice 记录）

1. **worker 侧读失败（E8）无签核持久化测试**：业务测试对 worker 侧读取失败的断言为 TODO 注记
   （chmod-000 fixture → 事件流断言）；本 slice 以临时 smoke 实证全链路（202 + attachment-error
   事件 + 消息不落 JSONL），未落仓库测试——已入待处理清单（/bug → /test-author 补签核用例）。
2. **image block 附带 name 字段**：pi-ai ImageContent 原生三字段（type/data/mimeType）之外附带
   name（附件名）——SessionManager JSONL 原样持久化（快照含附件名），API 序列化（anthropic-messages
   等）只取三原生字段，name 零副作用；历史投影经 partText 读 name 显示 `[图片: name]`。
   备选（投影侧 map 附件名 → JSONL 外映射表）更重且引入双源，未采用。
3. **附件消息允许空文本**：PRD §10.4 接口 4「既有 {text} + 可选 {attachments}」——附件存在时
   空文本放行（纯图片消息；错误码优先级：附件校验先于文本校验，imageAttachment 契约如此钉死）；
   无附件时空文本 400 不变（sessionMessage 回归通过）。
4. **title 回落**：纯图片消息（空文本）首条 title = 首附件名（slice(0,40) 无省略号契约不变）。
5. **发送时复核（E11）归 S5**：本 slice 只做协议与注入；非视觉模型传图行为按 pi-ai 语义
   （静默忽略）+ S5 renderer 主防线（附加时判定 + 发送复核），worker 侧不下沉防线（任务简报默认）。

### Slice 5（2026-08-13，REQ-AGENT-091/094/098）：DONE ✅

- 实现 commit（本 slice）：`[build] slice-5-frontend-toolbar`（见 git log）。
- 涉及文件：`src/renderer/pages/Settings.jsx`（agent 配置区 → provider 条目列表管理）、
  `src/renderer/components/assistant/ModeToolbar.jsx`（模型选择器 + 附件按钮替代灰显槽位）、
  `src/renderer/components/assistant/Composer.jsx`（附件 chips + 文件选择器 + 非视觉阻止 +
  发送复核）、`src/renderer/pages/Assistant.jsx`（会话 provider 取位/切换 + 视觉判定 + 附件发送）、
  `src/renderer/components/assistant/ChatView.jsx` + `MessageList.jsx`（msg-attachment 附件块）、
  `src/renderer/api/agent.js` + `agentSessions.js`（fetchProviderModels / GET+PUT provider /
  sendMessage attachments）、`src/renderer/modelCapabilities.js`（新增：视觉能力静态表）、
  `src/preload/preload.js`（getPathForFile 桥接）、`src/http/routes/settings.js`（新增
  POST /api/settings/agent/models seam）、i18n ×2（saveIdentity）、index.css + assistant.css。
- 父代理验证：3 个 E2E 17/17 全绿（settingsProviders 5/5、modelSelector 5/5、
  imageAttachmentUi 7/7）；API 回归 34/34（providerModelConfig 12/12、providerSwitch 11/11、
  autoJudgeDefaultModel 5/5、imageAttachment 6/6）。
- 旧测试影响（断言红，非环境红——随本 story 行为变更，由父代理 [test] 更新）：
  - `2026-08-11-pi-agent-modes/e2e/modeToolbar.test.cjs`：**1 红**（标准 4 灰显槽位
    toolbar-slot-model 存在性——已按 test-plan 登记替换）；其余 4 绿（含标准 2/3/5、lastMode）。
  - `2026-08-02-builtin-agent/e2e/settingsTabs.test.cjs`：**5 红**（AC1 zh-CN placeholder
    agent-api-key-input、AC2 agent-provider-select/agent-api-key-input 可见性、AC1 全局保存
    save-agent-config-button、AC3 keepExistingKey 平铺保存、AC5 错误区内展示——旧平铺表单
    被 B1 列表管理替换，属预期契约变更，**待补入待处理清单路由 [test]**）；6 绿（tab 显隐/
    通用保存/通道/关于/跨 tab 保留 agent-identity-input + 绑定区可见性——identity/binding
    区保留）。
  - `2026-08-02-builtin-agent/api/agentConfig.test.js` 旧 GET 平铺形态断言 3 红（S1 已登记，
    未变多）。

#### PRD → 代码 可追溯性表（Slice 5）

| PRD 意图项 | 实现文件 | 测试覆盖 | 状态 |
|---|---|---|---|
| §4 B1/B6 F1 Settings 多 provider 管理 UI（条目列表/增删/勾选子集/默认星标/迁移提示） | `pages/Settings.jsx`（provider-list + add-panel + migrate-note + 星标/删除处理） | settingsProviders E2E 标准 1-5 | COVERED |
| §4 B3 F2 工具栏模型选择器（替代灰显槽位，平铺已配置组合 + 高亮 + 默认徽标 + 空配置禁用） | `ModeToolbar.jsx`（model-select/trigger/option/empty-hint） | modelSelector E2E 标准 1-5 | COVERED |
| §10.4 接口 1 PUT /api/agent/sessions/:key/provider（renderer 接线：取位 + 切换乐观更新 + 失败回退） | `api/agentSessions.js` getSessionProvider/setSessionProvider + `pages/Assistant.jsx` | modelSelector 标准 3（回读断言）+ providerSwitch API | COVERED |
| §7 空列表禁用 + E12「未配置模型，请到设置添加」 | `ModeToolbar.jsx`（disabled + model-empty-hint） | modelSelector 标准 4 | COVERED |
| §4 B6 F4 附件 UI：attach-button 替代灰显槽位 / chips 行（名称+大小+移除）/ msg-attachment 消息附件块 | `ModeToolbar.jsx` attach-button + `Composer.jsx` chips/移除 + `MessageList.jsx` 附件块 | imageAttachmentUi 标准 1/2 | COVERED |
| §7/§8 E11 非视觉阻止（附加时判定 + 发送时复核，不静默丢图——renderer 主防线 v0.5） | `Composer.jsx`（tryAddFiles vision 校验 + submit 复核）+ `modelCapabilities.js`（pi-ai 目录镜像静态表） | imageAttachmentUi 标准 3/4/5 | COVERED |
| §7/§8 E5 数量上限（>10 第 11 个拒 + 提示） | `Composer.jsx`（attachmentsRef 同步真相计数） | imageAttachmentUi 标准 7 | COVERED |
| §7/§8 E6 类型白名单（SVG 拒收）/ E10 单图 ≤10MB | `Composer.jsx`（mimeOf 白名单 + 大小预检） | 实现内嵌（E2E 未覆盖 SVG/大图——服务侧 E-ATTACH-* 已签核） | COVERED（实现） |
| A7 反转：项目外文件直接附加（选择器即授权，无确认弹窗、无特殊标记） | `Composer.jsx`（无 dialog 代码）+ preload getPathForFile | imageAttachmentUi 标准 6（dialog 零触发断言） | COVERED |
| §10.2 renderer（Settings）拉取动态模型列表（实时无缓存；失败回退内置目录 + 提示） | `api/agent.js` fetchProviderModels + `routes/settings.js` POST /api/settings/agent/models（fetchModels seam）+ Settings.jsx（乐观内置目录 + fetch 替换，勾选集保留） | settingsProviders 标准 2（拉取结果出现 + 保存）；E3 文案分支实现内嵌 | COVERED |
| §7.1 settings 变更后选择器即时反映 | `pages/Assistant.jsx`（agentConfig 前台轮询 → providers 直通 ModeToolbar） | modelSelector 标准 2（seed 后 reload 反映） | COVERED |
| §8 E13/迁移提示（存量迁移 → 第一条 + 默认徽标） | `Settings.jsx`（migratedShape 启发式 + migrate-note） | settingsProviders 标准 5 | COVERED（见偏差 2） |

#### Slice 5 完成记录

- 测试摘要（最终轮，better-sqlite3 Electron ABI 就绪状态下）：
  - E2E 17/17：settingsProviders 5/5、modelSelector 5/5、imageAttachmentUi 7/7。
  - API 回归 34/34：providerModelConfig 12/12、providerSwitch 11/11、autoJudgeDefaultModel 5/5、
    imageAttachment 6/6（node ABI 轮次执行；ABI 交替见偏差 6）。
  - 旧测试影响量化：modeToolbar 1 红（预期替换项）、settingsTabs 5 红（预期替换项）——均断言红
    非环境红，父代理 [test] 更新路径。
- 实现要点（RED→GREEN 关键跳变）：
  - **File 路径解析**：Playwright setInputFiles 注入的 File 无 `.path` 属性（实测 File 无任何
    path 相关自有属性）→ 首轮 E2E 5 红（全部「文件读取失败」）→ 经 preload 暴露
    `webUtils.getPathForFile`（Electron 官方替代 API，FileData 内部路径解析，覆盖原生对话框与
    CDP 注入两种来源）→ 全绿。E2E 注释「真实文件路径 + File.path 语义」以此实现。
  - **添加条目默认 provider** = 首个未配置供应商（seed 已含 moonshotai+deepseek →
    默认 moonshotai-cn，规避服务端「provider 重复」400——E2E 标准 2 契约推导）。
  - **数量判定同步真相**：attachmentsRef 镜像 + 快速连续 setInputFiles（标准 7 循环）不依赖
    已提交渲染状态，11th 拒绝无竞态。
  - **migrate-note 启发式**：服务端 GET 无迁移标记（见偏差 2）。

#### 偏差与 UX 对照（本 slice 记录）

1. **POST /api/settings/agent/models 端点新增**（slice 边界外扩）：signoff/REQ-092 的
   fetchModels 是主进程服务，renderer 无调用通道；E2E 标准 2「填 key → 拉取列表」必须有
   HTTP seam——在 `routes/settings.js` 加 POST /api/settings/agent/models {provider, apiKey}
   → {models, fallback?}（成功裸数组 wrap 归一；apiKey 走请求体不落 URL）。属 §10.2「HTTP
   路由：改」范围内最小扩展，不影响既有端点契约（providerModelConfig 12/12 回归通过）。
2. **migrate-note 由 renderer 启发式判定**：signoff 契约写「GET 返回迁移标记时显示」，但
   S1 服务端（loadAgentConfig/saveAgentConfig）无迁移持久化标记——旧格式 PUT 即被归一化落盘，
   GET 无法区分「迁移产物」与「单条新配置」。renderer 按迁移产物形态判定（单条目 + 单模型 +
   默认组合 = 旧版单条迁移结果）——settingsProviders 标准 5 通过；副作用：单条配置在删除
   条目缩减后也会显示迁移提示（无测试断言，观感入 REFLECT，建议后续 [test]+服务端补标记）。
3. **视觉能力判定 = renderer 静态表**（modelCapabilities.js）：GET /api/settings/agent 不回传
   能力数据（签核契约无该字段），signoff「pi-ai 目录 input.includes('image') 或服务端能力数据」
   的 renderer 侧实现取 **pi-ai 目录镜像静态表**（2026-08-13 目录核对：deepseek 全系 text-only；
   kimi k2 时代 preview 系 text-only、k2.5 起全视觉）；未知模型回退保守拒绝（宁阻不静默丢图）。
   与 Settings 拉取路径（fetchModels 实时能力标志）双源并存——模型目录变更需同步本表（注释已
   标注镜像来源）。
4. **工具栏模型选项无能力标签**：UX conversation-toolbar.html 选项带「视觉✓/推理✓」cap-tag，
   但已配置条目的能力数据 renderer 侧不可得（同偏差 3 根因）；选项仅 provider · model + 默认
   徽标（E2E 契约未断言 cap-tag）。Settings 条目 chip 有视觉圆点（isVisionModel 静态表）。
5. **Settings 旧平铺表单替换**（B1 预期）：agent-provider-select/agent-api-key-input/
   save-agent-config-button 移除，改 provider 列表 + 添加表单 + save-provider/delete-provider/
   星标；identity 区保留（独立保存 save-agent-identity-button，PUT {identity} 不重建会话）；
   test-connection 移入添加表单（复用 agent-test-connection-button testid）；绑定区原样。
   → settingsTabs 5 红为预期契约变更（待父代理 [test] 路由，见待处理清单）。
6. **环境性：better-sqlite3 ABI 交替**（非本 slice 引入）：本机 node_modules 的
   better-sqlite3 二进制在「node 单元测试」与「Electron E2E」交替执行时被反复重建
   （test:unit 前置 rebuild:node、test:e2e 前置 rebuild:electron 即为此设计）；本次 E2E 期间
   一度出现 session 创建 500（ERR_DLOPEN_FAILED / E-DB-UNWRITABLE）——均为 ABI 环境红，
   重建后全绿（17/17 证据已取）。并行 story 跑 node 测试会翻转 ABI，E2E 前需确保
   `npm run rebuild:electron` 刚执行。
7. **历史消息附件以文本标记呈现**：重放（GET messages 投影）无附件结构（partText →
   `[图片: name]`），msg-attachment 块仅发送时乐观气泡携带（E2E 契约如此；观感入 REFLECT）。
