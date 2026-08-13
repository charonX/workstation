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

- [ ] **test-gap ×4**（/bug → /test-author 补签核用例）：REQ-090 AC3 key 成对规则（新增缺 key 400 / 编辑不重填复用密文）；AC4 部分删除默认重定向；REQ-092 AC3 空列表回退；AC5 目录不可解析剔除（fake 目录单测）
- [ ] **旧 GET 平铺回归 ×3**（agentConfig.test.js REQ-AGENT-001：data.provider/saved.configured 等 → 新形态断言，[test] commit）
- [ ] **modeToolbar.test.cjs 灰显槽位断言替换**（test-plan 已记：toolbar-slot-model/attach → 新契约，随 S5 后处理）
- [ ] **spec-gap 措辞**（可选）：REQ-092 契约行 fetchModels 形态不对称（成功=裸数组/回退={models,fallback}）；E9 文案与 PRD 微差（错误码已钉）
- [ ] **resetSettings 语义**（REFLECT 复查：已存在文件不覆盖的隐式依赖）
- [ ] **S2 边界观察 ×2**（低严重度，REFLECT 裁决）：① IM/feishu 通道 `imRouter.js:199` 句柄重建不读 agent_sessions 行（默认组合）——行值 deepseek 的 IM 会话淘汰重建后静默回默认；实际暴露低（工具栏 PUT 仅面向 ui:* 空间，IM 无切换入口），是否按行重装属人裁决；② `setSessionProvider` 幂等早退在条目已删后仍 200 不校验（GET 回落默认，PUT/GET 口径差，幂等 no-op 语义可辩护）
- [ ] **E4 措辞宽窄**（PRD §8 含「401 在线探测」、§10.4 为条目+密文校验；实现=契约 §10.4，不构成缺口）

### Slice 1（2026-08-13，REQ-AGENT-090/092/099）：DONE ✅

- 实现 commit `1dfeff8`；脚手架 test-gap 修正 `7b6b9ba`（[test]，父代理处理）；refactor `c7fe475`（REFACTORED，3 文件，契约零改动）。
- PRD 对齐子代理：**ALIGNED**（14 项 COVERED；4 test-gap + 1 现存回归 + 3 窗口期项 → 待处理清单，人已确认窗口期接受）。
- 父代理验证：12/12 绿（refactor 前后一致）。

### Slice 2（2026-08-13，REQ-AGENT-093/095）：DONE ✅

- 实现 commit `563d572`（8 文件）；脚手架 test-gap 修正（历史保留断言 content→text，[test] 父代理处理）；refactor `28eacee`（REFACTORED，4 文件）。
- PRD 对齐子代理：**ALIGNED**（F2 全流/接口 1/2/5/ADR-026 边界/安全剥离全部 COVERED；新增 2 低严重度边界观察 + E4 措辞宽窄 → 待处理清单）。
- 父代理验证：11/11 绿（refactor 前后一致）；providerModelConfig 12/12；sessionStore 7/7。

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
