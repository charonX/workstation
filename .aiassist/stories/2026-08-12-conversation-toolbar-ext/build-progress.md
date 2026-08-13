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

### Slice 1（2026-08-13，REQ-AGENT-090/092/099）：DONE

commit：`[build] slice-1-settings-model-config` — `1dfeff8`（仅本 story 文件，7 个：6 src + build-progress.md）。

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

