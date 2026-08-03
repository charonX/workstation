# Research: pi-ai 对 DeepSeek 与 Kimi（Moonshot）provider 的支持细节

> 调研日期：2026-08-03
> 主题：pi-ai（earendil-works/pi 的 LLM 统一层）对 DeepSeek 与 Kimi（Moonshot）两个 provider 的配置方式、模型目录、function calling 支持、限流/错误语义、模型注册机制与工具判定
> 来源：primary sources（GitHub 源码 main @ f0deb8d、npm `@earendil-works/pi-ai@0.83.0` 发布包内模型数据、models.dev API 当日快照、DeepSeek 官方文档 api-docs.deepseek.com）

## 执行摘要

1. **DeepSeek provider**：pi-ai 内置 `deepseek` provider，环境变量 `DEEPSEEK_API_KEY`，baseUrl `https://api.deepseek.com`（OpenAI 兼容格式，无独立海外/国内之分），走 `openai-completions` API。**模型目录只有两个硬编码模型** `deepseek-v4-flash` 与 `deepseek-v4-pro`（reasoning: true，1M 上下文）——**不含** `deepseek-chat`/`deepseek-reasoner`（旧名）。两模型官方文档确认支持 Tool Calls（✓），pi 在请求中无条件透传 `tools` 参数。[packages/ai/src/providers/deepseek.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/deepseek.ts)、[packages/ai/scripts/generate-models.ts:2250-2292](https://github.com/earendil-works/pi/blob/main/packages/ai/scripts/generate-models.ts)、[api-docs.deepseek.com pricing](https://api-docs.deepseek.com/quick_start/pricing)
2. **Kimi（Moonshot）provider**：pi-ai 有**三个** Kimi 系 provider——`moonshotai`（`https://api.moonshot.ai/v1`，海外）、`moonshotai-cn`（`https://api.moonshot.cn/v1`，国内），两者共用环境变量 `MOONSHOT_API_KEY` 与相同模型集（K2 系列 + kimi-k3）；以及 `kimi-coding`（`https://api.kimi.com/coding`，Kimi 编程订阅，`KIMI_API_KEY` 或 OAuth 登录，走 anthropic-messages API）。全部模型 `tool_call=true`，工具调用由 openai-completions API 层透传。[packages/ai/src/providers/moonshotai.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/moonshotai.ts)、[moonshotai-cn.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/moonshotai-cn.ts)、[kimi-coding.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/kimi-coding.ts)
3. **工具支持判定是"目录门槛"而非"模型标志"**：pi-ai 的 `Model` 类型**没有** `supportsTools` 字段；模型生成脚本对每个 provider 强制过滤 `if (m.tool_call !== true) continue;`（"Loaded N tool-capable models from models.dev"），pi-ai README 明确"只收录支持 function calling 的模型"。pi-agent（原 pi-agent-core，现 `packages/agent`）把注册的工具**无条件**经 `context.tools` 传给任意目录模型——**DeepSeek/Kimi 目录内模型全部允许挂工具**。[packages/ai/scripts/generate-models.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/scripts/generate-models.ts)、[packages/ai/README.md:5](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)、[packages/agent/src/harness/agent-harness.ts:438-450](https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/agent-harness.ts)
4. **限流/错误语义统一处理**：provider 层 `retryProviderRequest` 统一重试 408/409/429/5xx（尊重 `retry-after`/`retry-after-ms` 头，上限 60s）；agent 层 `retryAssistantCall` 按错误文本分类重试（rate limit/429/5xx/网络错误），默认 `retry.enabled=true, maxRetries=3, baseDelayMs=2000`（2s/4s/8s 指数退避）；超时经 `timeoutMs`（OpenAI/Anthropic SDK 默认 10 分钟，可配 `retry.provider.timeoutMs`）。流式错误不抛异常，统一编码为 `AssistantMessage`（stopReason `error`/`aborted` + errorMessage）。[packages/ai/src/utils/provider-retry.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/provider-retry.ts)、[packages/ai/src/utils/retry.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/retry.ts)、[packages/coding-agent/docs/settings.md:140-174](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)
5. **限制点（tool 标记缺失之外的实质限制）**：(a) DeepSeek 目录不含 `deepseek-chat`/`deepseek-reasoner` 旧名，且 `deepseek` 无 CN/国际变体；DeepSeek V4 无图像输入（`input: ["text"]`），thinking level 只有 high/max。(b) Moonshot K2 系 `supportsStrictMode: false`（不支持 strict JSON-schema tools）、`supportsReasoningEffort: false`；K3 例外（reasoning effort + `deferredToolsMode: "kimi"` 延迟工具加载）。(c) `kimi-coding` 为订阅制（device-code OAuth），文档 providers.md 未列出 Moonshot AI 两 provider 的 env 行、且 GitHub 链接指向不存在的 `earendil-works/pi-mono` 仓库（文档过时）。

## 详细发现

### 1. DeepSeek provider 配置

- **注册**：`deepseekProvider()` 定义于 [packages/ai/src/providers/deepseek.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/deepseek.ts)：`id: "deepseek"`，`baseUrl: "https://api.deepseek.com"`，auth 为 `envApiKeyAuth("DeepSeek API key", ["DEEPSEEK_API_KEY"])`，API 层为 `openAICompletionsApi()`（OpenAI SDK Chat Completions）。
- **环境变量 / 配置键**：`DEEPSEEK_API_KEY`；`auth.json` 键 `deepseek`（`{"deepseek": {"type": "api_key", "key": "..."}}`）。源码 [packages/ai/src/env-api-keys.ts:86](https://github.com/earendil-works/pi/blob/main/packages/ai/src/env-api-keys.ts)、文档 [packages/coding-agent/docs/providers.md（API Keys 表）](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)。
- **模型名**：目录仅两个（[npm 包 dist/providers/data/deepseek.json，@earendil-works/pi-ai@0.83.0](https://registry.npmjs.org/@earendil-works/pi-ai)；生成源头为**硬编码**于 [generate-models.ts:2250-2292](https://github.com/earendil-works/pi/blob/main/packages/ai/scripts/generate-models.ts)）：
  - `deepseek-v4-flash`：reasoning: true，contextWindow 1,000,000，maxTokens 384,000，cost $0.14/$0.28 每 M token（cacheRead $0.0028）
  - `deepseek-v4-pro`：reasoning: true，1M/384K，$0.435/$0.87
  - 两者 `compat`: `{ requiresReasoningContentOnAssistantMessages: true, thinkingFormat: "deepseek" }`；`supportsStore: false`、`supportsDeveloperRole: false`；`input: ["text"]`（无图像）；thinkingLevelMap 仅 `high: "high"`, `max: "max"`（minimal/low/medium 为 null）。
  - **注意**：DeepSeek 官方定价页当前也只列 V4-Flash-0731 / V4-Pro，旧名 deepseek-chat/deepseek-reasoner 已不在官方定价页；models.dev 上游仍列 `deepseek-chat`、`deepseek-reasoner`（tool_call=true），但 pi 生成脚本**不从 models.dev 加载 deepseek**，因此这两个旧名不在 pi 目录中。官方端点：OpenAI 格式 `https://api.deepseek.com`，另有 Anthropic 格式 `https://api.deepseek.com/anthropic`（pi 未使用）。[api-docs.deepseek.com pricing](https://api-docs.deepseek.com/quick_start/pricing)、[models.dev/api.json（deepseek）](https://models.dev/api.json)
- **function calling**：官方文档特征表两模型 Tool Calls 均为 ✓；pi 的 openai-completions 实现 `buildParams()` 在 `context.tools` 非空时无条件 `params.tools = convertTools(activeTools, compat)`（含 `tool_choice` 透传），**无按模型的工具开关**。[api-docs.deepseek.com pricing](https://api-docs.deepseek.com/quick_start/pricing)、[packages/ai/src/api/openai-completions.ts:717-737](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-completions.ts)
- **thinking 语义**：`thinkingFormat: "deepseek"` 表示用 `thinking: { type: ... }` 顶层参数（supportsReasoningEffort 时附加 reasoning_effort）；`requiresReasoningContentOnAssistantMessages: true` 要求多轮回放 assistant 消息时必须带空 `reasoning_content` 字段（[types.ts:539](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts) 注释）。V4 强制 thinking 层级映射（高/最大），不能"关 thinking"。

### 2. Kimi（Moonshot）provider 配置

三个 provider（源码目录 [packages/ai/src/providers/](https://github.com/earendil-works/pi/tree/main/packages/ai/src/providers)）：

| Provider | baseUrl | 环境变量 | auth.json 键 | API 层 | 模型 |
|---|---|---|---|---|---|
| `moonshotai`（Moonshot AI，海外） | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` | `moonshotai` | openai-completions | kimi-k2-0711-preview / kimi-k2-0905-preview / kimi-k2-thinking / kimi-k2-thinking-turbo / kimi-k2-turbo-preview / kimi-k2.5 / kimi-k2.6 / kimi-k2.7-code / kimi-k2.7-code-highspeed / kimi-k3 |
| `moonshotai-cn`（Moonshot AI 中国） | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` | `moonshotai-cn` | openai-completions | 同上（同一模型集） |
| `kimi-coding`（Kimi For Coding，订阅） | `https://api.kimi.com/coding` | `KIMI_API_KEY`（另有 OAuth：Kimi Code 订阅登录，device-code） | `kimi-coding` | anthropic-messages | k3 / k3-256k / kimi-for-coding / kimi-for-coding-highspeed |

- 源码：[moonshotai.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/moonshotai.ts)、[moonshotai-cn.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/moonshotai-cn.ts)、[kimi-coding.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/kimi-coding.ts)；env 映射 [env-api-keys.ts:100-107](https://github.com/earendil-works/pi/blob/main/packages/ai/src/env-api-keys.ts)。
- **数据来源**：Moonshot/Kimi 模型从 models.dev 拉取并过滤 `tool_call === true`（[generate-models.ts:1907-1975](https://github.com/earendil-works/pi/blob/main/packages/ai/scripts/generate-models.ts)）；Kimi Coding 从 models.dev `kimi-for-coding` 键拉取（同样过滤，并把 k2p5/k2p6/k2p7 别名归一化为 `kimi-for-coding`）。当日 models.dev 快照：moonshotai 10 个模型、moonshotai-cn 10 个模型、kimi-for-coding 4 个模型，**全部 `tool_call: true`**。
- **function calling**：与 DeepSeek 同一 openai-completions `buildParams` 透传逻辑（`params.tools`）。Moonshot 无 strict 工具（`supportsStrictMode: false`）；K3 支持 `deferredToolsMode: "kimi"` 延迟工具加载（工具结果带 `addedToolNames` 时后续请求把工具以"含工具但省略 content 字段的 system message"形式加载，[openai-completions.ts:1260-1280](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-completions.ts)）。
- **thinking 语义差异**：K2 系 `thinkingFormat: "deepseek"`（顶层 `thinking` 参数）且 `supportsReasoningEffort: false`；`kimi-k3` 为 `thinkingFormat: "openai"` + `supportsReasoningEffort: true` + `requiresReasoningContentOnAssistantMessages: true`（[generate-models.ts:1938-1946](https://github.com/earendil-works/pi/blob/main/packages/ai/scripts/generate-models.ts)）。kimi-coding 走 anthropic-messages：`forceAdaptiveThinking: true`（adaptive thinking），K3 与 kimi-for-coding 另有 `allowEmptySignature: true`，请求带 `User-Agent: KimiCLI/1.5` 静态头；订阅无官方价格（models.dev 报 0），按 Moonshot API 等价价估算成本。
- **文档缺口**：providers.md 的 API Keys 表只列 `Kimi For Coding | KIMI_API_KEY | kimi-coding`，**没有 Moonshot AI / Moonshot AI CN 两行**（源码里有，文档漏了）；且该页的 GitHub 源码链接指向 `earendil-works/pi-mono`（GitHub API 2026-08-03 查询该仓库不存在，应为迁移中的过时链接）。[providers.md:75-95](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)

### 3. 限流/错误语义（统一处理）

- **provider 层**（所有 API 共用，[utils/provider-retry.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/provider-retry.ts)）：SDK `maxRetries: 0`，外包 `retryProviderRequest()`——可重试状态码 408/409/429/≥500，或 `x-should-retry: true` 头；退避优先 `retry-after-ms`/`retry-after` 头（超过 `maxRetryDelayMs` 默认 60s 立即失败并报错），否则指数退避 `0.5*2^n` 秒上限 8s（±25% 抖动）；休眠可被 AbortSignal 中断。
- **agent 层**（[utils/retry.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/retry.ts) 的 `retryAssistantCall`）：错误文本分类——可重试（`rate limit`/`too many requests`/`429`/`500`/`502`/`503`/`504`/`524`/`overloaded`/`service unavailable`/`provider returned error`/网络类 `connection refused`/`ENOTFOUND`/`socket hang up` 等），不可重试（`insufficient_quota`/`quota exceeded`/`out of budget`/`billing`、OpenCode Go 免费额度等）。策略来自 coding-agent `settings.retry`：`enabled=true, maxRetries=3, baseDelayMs=2000`（2s/4s/8s）。[settings.md:140-173](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)
- **超时**：`timeoutMs`（OpenAI/Anthropic SDK 默认 10 分钟，见 [types.ts:162-166](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts) 注释；settings 示例 3600000）；流空闲超时 `httpIdleTimeoutMs` 默认 300000；WebSocket 连接超时默认 15000。
- **错误面**：流契约规定失败必须编码进流——`AssistantMessage` 带 `stopReason: "error"|"aborted"` 与 `errorMessage`，不抛异常（[types.ts:312-324](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts)）；abort 后支持"继续"（`abortId` 续传，README Error Handling 章节）。**DeepSeek/Kimi 与其他 provider 无差异化错误处理**。

### 4. Provider 注册机制与"支持工具调用"判定

- **注册**：每个 provider 一个工厂函数（如 `deepseekProvider()`），`createProvider({ id, name, baseUrl, auth, models, api })`（[models.ts:533-634](https://github.com/earendil-works/pi/blob/main/packages/ai/src/models.ts)）；`builtinProviders()` 在 [providers/all.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/all.ts) 一次性注册全部 37 个 provider 到 `Models` 集合（`createModels()` + `setProvider()`）；`models.generated.ts` 汇总各 provider 模型常量。
- **模型目录**：生成脚本 [packages/ai/scripts/generate-models.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/scripts/generate-models.ts) 从 **models.dev API（https://models.dev/api.json）**拉取目录（DeepSeek 例外：硬编码 V4 两模型；Anthropic/Google/OpenAI/Groq/Cerebras/Bedrock/MiniMax/Moonshot/Kimi Coding/Xiaomi/Qwen 等从 models.dev 拉取），**每个 provider 段都执行 `if (m.tool_call !== true) continue;`**——`tool_call` 是 models.dev 的能力字段（当日快照：deepseek 四模型、moonshotai/moonshotai-cn 各 10 模型、kimi-for-coding 4 模型全部为 true）。OpenRouter 额外过滤 `supported_parameters.includes("tools")`（[generate-models.ts:979-980](https://github.com/earendil-works/pi/blob/main/packages/ai/scripts/generate-models.ts)）。
- **判定结论**：pi-ai 的目录即"工具支持白名单"，`Model` 接口无 tools 字段（[types.ts:761-788](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts)）；pi-agent harness 构建 `context.tools` 后对**任意**目录模型调用 `models.streamSimple(model, context, ...)`（[agent-harness.ts:436-462](https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/agent-harness.ts)）——**DeepSeek V4 与全部 Kimi 目录模型在 pi-agent 中均可挂工具**；模型不存在"目录内但禁工具"的状态。运行时远端目录刷新经 `ModelsStore`（`~/.pi/agent/models-store.json`，ETag/Last-Modified 缓存，[models-store.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/models-store.ts)、[providers.md 开头](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)）。
- **结构变更提示**：调研时 main 分支已将原 `packages/agent-core`（npm 名 pi-agent-core）重命名为 `packages/agent`；仓库仍为 `earendil-works/pi`（2026-08-02 仍有提交），但部分文档/CHANGELOG 已引用不存在的 `pi-mono` 仓库名——引用源码时以 main 分支当前路径为准。

### 5. 对两者的限制汇总

| 维度 | DeepSeek | Moonshot (moonshotai / moonshotai-cn) | Kimi Coding |
|---|---|---|---|
| 工具调用 | 支持（透传 tools；deepseek 未被 isNonStandard 命中，`supportsStrictMode` 默认 true 未禁用） | 支持（透传 tools；`supportsStrictMode: false`，无 strict JSON-schema 工具；K3 另有 deferredToolsMode kimi） | 支持（anthropic-messages；forceAdaptiveThinking） |
| 目录外模型 | **deepseek-chat / deepseek-reasoner 不在目录**（models.dev 有、pi 未收录） | 全部 K2/K3 在目录 | 4 个订阅模型 |
| 推理参数 | thinkingFormat deepseek；thinking level 仅 high/max；无法关 thinking | K2 无 reasoning_effort；K3 有 | adaptive thinking 强制 |
| 图像输入 | 无（text only） | K2.5/K2.6/K2.7-code 与 K3 支持 text+image | 全部 text+image |
| 多轮约束 | requiresReasoningContentOnAssistantMessages=true（需回放 reasoning_content） | K2 无此要求；K3 有 | allowEmptySignature（K3/for-coding） |
| 端点 | 单一 api.deepseek.com（官方另提供 /anthropic 格式，pi 未用） | 海外 api.moonshot.ai/v1 + 国内 api.moonshot.cn/v1 双端点，同一把 MOONSHOT_API_KEY | api.kimi.com/coding（订阅 OAuth 或 KIMI_API_KEY） |

**可配置性补充**：pi 支持自定义 provider / 覆盖 baseUrl——`models.json`（或扩展）中按 provider 或按模型 `baseUrl` 覆盖（"Override baseUrl for existing provider"，[custom-provider.md:60-120](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)）；openai-completions 的 compat 按 baseUrl 自动探测，可显式覆盖。因此把 DeepSeek 指向国内镜像/代理或把 Moonshot 切到 CN 端点都有官方机制（moonshotai-cn 已是内置双端点之一）。

## 不确定 / 待验证

- **pi-mono 仓库**：providers.md/CHANGELOG 引用 `earendil-works/pi-mono`，GitHub API 当日返回不存在；若仓库后续改名，上述 main 分支链接会 301 或失效（调研基于 2026-08-03 的 `earendil-works/pi` main @ f0deb8d）。
- **DeepSeek V4 的 OpenAI-format 端点路径**：pi 用 `https://api.deepseek.com` + OpenAI SDK（自动拼 `/chat/completions`）；DeepSeek 官方文档同时认可 `https://api.deepseek.com/v1` 写法，未逐一验证 `/v1` 变体在 pi 内的行为（pi 的 baseUrl 可按自定义 provider 覆盖，影响很小）。
- **严格工具（strict）对 DeepSeek 的实际效果**：deepseek 未被 `isNonStandard` 集合命中，`supportsStrictMode` 默认 true；但 V4 目录 JSON 未显式声明该字段，实际请求是否发送 `strict` 取决于 `convertTools` 与调用方（pi-agent 默认不要求 strict）——未做线上请求实证。
- **Kimi 延迟工具的运行时行为**：`deferredToolsMode: "kimi"` 的加载协议（system message 含工具但省略 content）仅在 K3 上启用，未在真实 K3 请求中验证。
- **限流实测**：重试策略为源码/文档事实，未对 DeepSeek/Moonshot 429 响应头做真实请求实证。

## 开放问题（留给 /tech-design）

- 若平台要求 `deepseek-chat`/`deepseek-reasoner` 旧模型名，需要自定义 provider 覆盖（pi 目录只给 V4）；是否接受 V4 作为唯一 DeepSeek 选择。
- Moonshot 双端点（ai/cn）选择策略：pi 把国内/海外做成两个独立 provider（共用一个 key），平台侧需决定默认路由与用户可选性。
- `kimi-coding` 订阅制 OAuth（device-code）在企业/桌面场景的凭证管理方式是否纳入范围，还是仅用 API key 类 provider。
- DeepSeek thinking 不可关（仅 high/max）对平台"快速问答"场景的影响是否需要降级策略（换模型/换 provider）。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| deepseek.ts / moonshotai.ts / moonshotai-cn.ts / kimi-coding.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/{deepseek,moonshotai,moonshotai-cn,kimi-coding}.ts | 2026-08-03 | provider 定义（baseUrl/auth/API 层） |
| generate-models.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/ai/scripts/generate-models.ts | 2026-08-03 | 模型目录生成、tool_call 过滤、compat 探测、DeepSeek 硬编码 |
| env-api-keys.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/ai/src/env-api-keys.ts | 2026-08-03 | 环境变量映射 |
| types.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts | 2026-08-03 | Model 接口（无 tools 标志）、compat 语义、流错误契约 |
| openai-completions.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-completions.ts | 2026-08-03 | tools 透传、timeout/retry 接线、Kimi 延迟工具 |
| provider-retry.ts / retry.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/ai/src/utils/provider-retry.ts | 2026-08-03 | 429/重试/退避语义 |
| agent-harness.ts（源码，packages/agent） | https://github.com/earendil-works/pi/blob/main/packages/agent/src/harness/agent-harness.ts | 2026-08-03 | agent 侧无条件挂工具、streamSimple 调用 |
| all.ts / models.ts / models-store.ts（源码） | https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/all.ts | 2026-08-03 | provider 注册机制、运行时目录刷新 |
| pi-ai README | https://github.com/earendil-works/pi/blob/main/packages/ai/README.md | 2026-08-03 | "只收录支持 tool calling 的模型" |
| npm @earendil-works/pi-ai 0.83.0 发布包 | https://registry.npmjs.org/@earendil-works/pi-ai | 2026-08-03 | dist/providers/data/{deepseek,moonshotai,moonshotai-cn,kimi-coding}.json 模型数据（含 compat/成本） |
| models.dev API | https://models.dev/api.json | 2026-08-03 | 上游目录（tool_call 能力字段，deepseek/moonshotai/moonshotai-cn/kimi-for-coding） |
| DeepSeek 官方文档（定价/能力页） | https://api-docs.deepseek.com/quick_start/pricing | 2026-08-03 | 官方模型名（V4 双模型）、base_url、Tool Calls ✓ |
| providers.md / settings.md / custom-provider.md（文档） | https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/{providers,settings,custom-provider}.md | 2026-08-03 | env 表、retry 策略默认值、baseUrl 覆盖 |
| GitHub API（仓库元数据） | https://api.github.com/repos/earendil-works/pi | 2026-08-03 | 仓库名/分支确认；pi-mono 不存在确认 |
