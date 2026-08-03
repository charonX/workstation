# Research: pi-ai / pi-coding-agent 自定义 provider 与 mock/fake provider 注入

> 调研日期：2026-08-03
> 主题：pi-ai / pi-coding-agent SDK 是否支持注入自定义 LLM provider 或 fake/mock provider（用于对话回路测试不真调 DeepSeek/Kimi API）
> 来源：primary sources（pi.dev 官方文档、earendil-works/pi 源码 @ main f0deb8d（shallow clone，本地路径 /tmp/pi-research）、pi-ai README、npm registry）
> 前置背景：见 `.aiassist/wayfind/builtin-agent/research/pi-toolbox.md`（SDK：createAgentSession、订阅流式事件、--mode rpc）

## 执行摘要

1. **自定义 provider 是官方一等能力，三层注入面**：① `models.json` 配置文件（`~/.pi/agent/models.json`，任意 OpenAI 兼容 baseUrl + `api: "openai-completions"`，支持 `$ENV_VAR` 插值）；② 扩展 API `pi.registerProvider(name, config)` / `pi.registerProvider(provider)`（支持 baseUrl/headers 覆盖、完整自定义 stream 实现、OAuth）；③ pi-ai 代码 API `createProvider()` + `createModels().setProvider()`。SDK 侧通过 `ModelRuntime.create({ credentials, modelsPath, authPath })` 注入路径与凭据。[pi.dev/docs/latest/custom-provider](https://pi.dev/docs/latest/custom-provider)、[pi.dev/docs/latest/models](https://pi.dev/docs/latest/models)、[packages/ai/src/models.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/models.ts)
2. **官方自带 mock provider：`fauxProvider()`（"Faux Provider for Tests"）**——pi-ai 公共导出（`providers/faux.ts`，index.ts 公开 re-export），README 有专节文档。进程内、零网络（baseUrl 恒为 `http://localhost:0`），支持脚本化响应队列（`setResponses`/`appendResponses`，静态消息或基于 context 的响应工厂）、流式仿真（text/thinking/toolcall 增量分块推送、tokensPerSecond 节流）、abort 仿真、callCount 计数、usage/prompt-cache 估算。[pi-ai README "Faux Provider for Tests"](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)、[packages/ai/src/providers/faux.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/faux.ts)
3. **createAgentSession 没有 `provider` 选项，但接受 `modelRuntime` + `model`**：`model` 可以是任意 `Model` 对象（含自定义 provider 的模型，`modelRuntime.getModel("my-provider", "my-model")`）；`modelRuntime` 可注入任意 `CredentialStore`（如 `InMemoryCredentialStore`）和自定义 `modelsPath`/`authPath`；`ModelRuntime` 还有公开方法 `registerNativeProvider(provider)`、`registerProvider(id, config)`、`setRuntimeApiKey(providerId, key)`。因此测试完全可以指向 localhost 的 OpenAI 兼容 mock 端点，也可以完全不发网络请求。[packages/coding-agent/src/core/sdk.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts)、[packages/coding-agent/docs/sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
4. **pi 仓库自身测试用三种策略**：① faux provider（agent 会话级套件 harness `createHarness` 即用它，`coding-agent/test/suite/harness.ts`）；② 手写 Provider 对象指向 `http://localhost:8080/*` 断言 baseUrl 生效（`agent-session-dynamic-provider.test.ts`）；③ API 层用 `node:http` 起真实本地 server 模拟端点（`pi-messages.test.ts:30`、`anthropic-eager-tool-input-compat.test.ts:72`、`llama-extension.test.ts:16` 模拟 llama.cpp router），另有 `fetch?: FetchFunction` 每请求注入（`fetch-option.test.ts` 用 `vi.fn` mock fetch，并断言不碰 ambient fetch）。
5. **结论：对话回路测试无需深 DI——两条官方路径都成立**：A) 零网络：`registerFauxProvider()`/`fauxProvider()` 脚本化响应，完全控制流式事件与 tool call 序列，是官方测试 harness 的做法（最贴合"对话回路不真调 API"）；B) 走真实 HTTP：`models.json` 或 `registerProvider({ baseUrl })` 指向本地 OpenAI 兼容 mock 端点（localhost:PORT/v1），SDK/CLI/`--mode rpc` 全链路都走这条路径（docs 明确给过 `http://localhost:8080/v1` 例子）。两者都不需要修改 pi 源码。

## 详细发现

### 1. provider 注册机制（Q1）

三层官方注册面，均支持"自定义 API 实现"或"自定义 baseURL + 模型名"：

- **配置文件 `models.json`**（默认 `~/.pi/agent/models.json`，SDK 可用 `ModelRuntime.create({ modelsPath })` 重定向）：顶层 `{ "providers": { ... } }`，provider 需 `baseUrl` + `api`；`api: "openai-completions"` 兼容任意 OpenAI Chat Completions 服务器（Ollama/LM Studio/vLLM/代理），官方例子 `"baseUrl": "http://localhost:11434/v1"`（Ollama）与 `"baseUrl": "http://localhost:8080/v1"`（自定义 "local-llm"）。值支持 `"$ENV_VAR"`/`"${ENV_VAR}"` 插值、`!command` 执行、`$$`/`$!` 转义；keyless 本地服务器用占位 apiKey 或 `/login` 或 `--api-key`。模型条目最小只要 `{ "id": "llama3.1:8b" }`（本地模型）。文件在 `/model` 打开时重载，无需重启。其他 `api` 值：`anthropic-messages`、`openai-responses`、`azure-openai-responses`、`openai-codex-responses`、`mistral-conversations`、`google-generative-ai`、`google-vertex`、`bedrock-converse-stream`。不支持 `developer` role 的服务器（Ollama/vLLM/SGLang 等）用 `compat.supportsDeveloperRole: false`。[pi.dev/docs/latest/models](https://pi.dev/docs/latest/models)、[pi.dev/docs/latest/providers](https://pi.dev/docs/latest/providers)
- **扩展 API `pi.registerProvider()`**（两态）：
  - config 态：`pi.registerProvider("anthropic", { baseUrl: "https://proxy.example.com" })`——只给 baseUrl/headers 时保留该 provider 全部既有模型；`pi.registerProvider("my-llm", { baseUrl, apiKey: "$MY_LLM_API_KEY", api: "openai-completions", models: [...] })`——注册新 provider（models 覆盖）。`pi.unregisterProvider(name)` 移除。扩展加载期后调用立即生效，无需 `/reload`。源码类型 `ProviderConfigInput`：`name/baseUrl/apiKey/api/streamSimple/headers/authHeader/oauth/models[]/refreshModels`——**`streamSimple` 允许直接注入自定义流实现**（非标准流式 API 可自写）。[pi.dev/docs/latest/custom-provider](https://pi.dev/docs/latest/custom-provider)、[packages/coding-agent/src/core/provider-composer.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/provider-composer.ts)、[packages/coding-agent/src/core/extensions/loader.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/loader.ts)（L212 registerProvider、L383 registerProvider(providerOrName, config)）
  - 完整 Provider 对象态：`pi.registerProvider(nativeProvider)`——直接注入 pi-ai `Provider`（`{ id, name, baseUrl, auth, getModels, stream, streamSimple }`），底层走 `ModelRuntime.registerNativeProvider()`（coding-agent core/model-runtime.ts L555，公开方法）。[packages/coding-agent/test/agent-session-dynamic-provider.test.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/test/agent-session-dynamic-provider.test.ts)
- **pi-ai 代码 API**：`createProvider(CreateProviderOptions)`（`id/baseUrl/headers/auth/models/api/fetchModels/filterModels`，api 可为单实现或按 `model.api` 分发的 map；built-in 工厂与 models.json 自定义 provider 都走它）；`createModels()` 返回 `MutableModels`，`models.setProvider(provider)` upsert。`fauxProvider()` 返回的 handle 的 `.provider` 就是标准 `Provider`。[packages/ai/src/models.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/models.ts)（L529 createModels、L556 createProvider、L230 setProvider）
- **env**：内置 provider 走标准 `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`DEEPSEEK_API_KEY` 等；运行时可 `modelRuntime.setRuntimeApiKey(providerId, key)`（不持久化）；llama.cpp 走 `LLAMA_BASE_URL=http://127.0.0.1:8080` + `LLAMA_API_KEY`。[packages/coding-agent/docs/sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[pi.dev/docs/latest/llama-cpp](https://pi.dev/docs/latest/llama-cpp)

### 2. 官方 mock/stub 支持（Q2）

- **官方 faux provider 是"为测试而生的 provider"**：pi-ai README 专节 "Faux Provider for Tests"（`fauxProvider()` 构建 in-memory provider，脚本化响应，用于 tests and demos）；公开导出（`export * from "./providers/faux.ts"`，src/index.ts L36）；还有 compat 层 `registerFauxProvider()`（自动挂到 compat 注册表、返回带 `unregister()` 的句柄）。能力：`setResponses`/`appendResponses`（`AssistantMessage | FauxResponseFactory`——工厂可基于 `Context`/`StreamOptions`/`callCount` 生成响应）、`getPendingResponseCount`、`state.callCount`、`tokensPerSecond` 节流、`tokenSize` 控制、流式事件完全按真实协议（`start/text_start/text_delta/text_end/thinking_*/toolcall_*`、`stopReason: "toolUse"` 等）、abort 仿真、usage/prompt-cache 估算。**不发起任何网络请求**（`baseUrl: "http://localhost:0"`）。[pi-ai README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)（L1194 起）、[packages/ai/src/providers/faux.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/faux.ts)、[packages/ai/src/compat.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/compat.ts)（L160 registerFauxProvider）
- **本地真实端点官方支持**：Ollama/LM Studio/vLLM/任意 OpenAI 兼容服务器走 models.json baseUrl；llama.cpp router 走 `/login llama.cpp` + `/llama` + `/model`（默认 `http://127.0.0.1:8080`，`LLAMA_BASE_URL`/`LLAMA_API_KEY` 等效）。注意：llama.cpp 路由**必须是 router 模式**（依赖 `/health`、`/models`、`/llama` 端点），不能指向任意 HTTP 服务——但 OpenAI 兼容路径没有这个限制。**没有官方提供的"mock server"可执行程序**（无 `pi mock` 之类命令）；mock 形态 = faux provider（进程内）+ 自建 localhost 端点（外部）两种官方认可方式。[pi.dev/docs/latest/providers](https://pi.dev/docs/latest/providers)、[pi.dev/docs/latest/llama-cpp](https://pi.dev/docs/latest/llama-cpp)、[pi.dev/docs/latest/models](https://pi.dev/docs/latest/models)

### 3. createAgentSession 的 provider/model 覆盖（Q3）

- `CreateAgentSessionOptions` 无 `provider` 字段；相关选项：`modelRuntime?: ModelRuntime`（"Canonical model/auth runtime. Defaults to a runtime using agentDir/auth.json and models.json"——源码默认 `options.modelRuntime ?? await ModelRuntime.create({ authPath, modelsPath })`）、`model?: Model<any>`（任意模型对象，含自定义 provider 模型）、`thinkingLevel`、`scopedModels`。[packages/coding-agent/src/core/sdk.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts)（L38-52、L176）、[pi.dev/docs/latest/sdk](https://pi.dev/docs/latest/sdk)
- `ModelRuntime.create(options)`：`credentials?`（任意 pi-ai `CredentialStore`，官方示例 `new InMemoryCredentialStore()`）、`authPath?`、`modelsPath?: string | null`（null 禁用）、`modelsStore?`、`allowModelNetwork?`（默认 false，create 不联网刷模型目录）、`catalogBaseUrl?`。[packages/coding-agent/src/core/model-runtime.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/model-runtime.ts)（L65-85 CreateModelRuntimeOptions）
- 取模型：`modelRuntime.getModel("my-provider", "my-model")`（含 models.json 自定义模型）；`modelRuntime.getAvailable()`（仅认证完备的模型）；`modelRuntime.checkAuth(provider.id)`；认证解析优先级：runtime 覆盖 → auth.json 存储凭据 → env → fallback resolver。[packages/coding-agent/docs/sdk.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)（L355-470）
- 结论：测试可 `ModelRuntime.create({ credentials: InMemoryCredentialStore, modelsPath: <tmp>/models.json })` 指向本地 OpenAI 兼容端点；或直接 `registerNativeProvider(provider)`/`registerProvider(id, { baseUrl })`。**指向 localhost mock 端点没有任何障碍。**

### 4. pi 仓库自身测试的 provider 策略（Q4）

- **策略 A：faux provider（agent 回路级）**——官方套件 harness `createHarness`（`coding-agent/test/suite/harness.ts` L103-133）：`registerFauxProvider({ models })` → `setResponses([])` → `modelRegistry.registerProvider(model.provider, { baseUrl: model.baseUrl, apiKey: "faux-key", api: fauxProvider.api, models: [...] })` → 构造 `AgentSession({ modelRuntime, ... })`。会话级测试（compaction/branching/concurrent/retry 等）通过 harness 的 `setResponses`/`appendResponses` 脚本化每轮响应（含 tool call 序列），并可用 `options.modelsJson` 写入临时 models.json 走文件路径。[packages/coding-agent/test/suite/harness.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/test/suite/harness.ts)
- **策略 B：真实 Provider 对象 + localhost baseUrl + 抛错的 stream**——`agent-session-dynamic-provider.test.ts`：手写 `nativeAnthropicProvider(baseUrl)`（`{ id: "anthropic", baseUrl, auth: { apiKey: {...resolve→test-key} }, getModels: () => [model], stream: throw }`），经 `pi.registerProvider(provider)`（顶层/`session_start`/命令时）注册；断言 `session.model?.baseUrl === "http://localhost:8080/..."` 且 `session.prompt()` 时模型 baseUrl 生效（stream 抛错截停，不真发请求）。同时也测 `pi.registerProvider("anthropic", { baseUrl })` 配置态覆盖。该测试还演示了 SDK 三件套：`ModelRuntime.create({ credentials: AuthStorage, modelsPath })` + `DefaultResourceLoader` + `createAgentSession({ model, modelRuntime })`。[packages/coding-agent/test/agent-session-dynamic-provider.test.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/test/agent-session-dynamic-provider.test.ts)
- **策略 C：API 层真实本地 HTTP server**——`node:http` `createServer` 起真实端点：`pi-messages.test.ts:30`、`anthropic-eager-tool-input-compat.test.ts:72`、`openai-completions-thinking-as-text.test.ts:146`、`fireworks-models.test.ts:208`（ai 包）；coding-agent 的 `llama-extension.test.ts:16` 用本地 server 模拟 llama.cpp router（`/models`、`/health`、`/llama` 端点）。**策略 D：fetch 注入**——`SimpleStreamOptions`/`StreamOptions` 带 `fetch?: FetchFunction`（types.ts L126/L259，simple-options.ts L32 透传），`fetch-option.test.ts` 用 `vi.fn` 注入自定义 fetch 并 `vi.stubGlobal` 断言 ambient fetch 不被调用。[packages/ai/test/fetch-option.test.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/test/fetch-option.test.ts)、[packages/coding-agent/test/llama-extension.test.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/test/llama-extension.test.ts)
- pi-ai 单测同样用 faux（`ai/test/faux-provider.test.ts` 616 行：注册→setResponses→complete/stream→断言 content/usage/callCount/stopReason/abort/流式事件序列）。[packages/ai/test/faux-provider.test.ts](https://github.com/earendil-works/pi/blob/main/packages/ai/test/faux-provider.test.ts)

### 5. 结论（Q5）

**可行，无需改 pi 源码或做深 DI**：

- **首选（官方测试范式）：faux provider 注入**——`registerFauxProvider()` 后在 ModelRuntime/会话里注册该 provider，`setResponses` 脚本化"用户问→思考→tool call→工具结果→最终回答"完整序列，流式事件与真实协议一致（text_delta/thinking_delta/toolcall_delta），零网络、确定性、可断言 callCount 与 stopReason。这正是 pi 自己的 agent 回路测试（compaction/branching/retry 等）的做法，覆盖"对话回路不真调 DeepSeek/Kimi"需求的最强形态。
- **备选（真实 HTTP 路径）：本地 OpenAI 兼容 mock 端点 + baseUrl 注入**——models.json（`api: "openai-completions"` + `baseUrl: http://localhost:<port>/v1`，SDK 传 `modelsPath` 指到临时文件）或 `pi.registerProvider("my-llm", { baseUrl, api: "openai-completions", models: [...] })`（扩展或 `modelRuntime.registerProvider`）。覆盖 SDK 进程内、CLI（`--model my-llm/my-model`）、`--mode rpc` 全链路。要求 mock 端点实现 OpenAI Chat Completions 协议（含 SSE 流式与 tool call 响应体）。
- **更细粒度**：`ProviderConfigInput.streamSimple` 可注入自定义流函数（不走 HTTP）；`fetch?: FetchFunction` 可在请求级 mock 任意内置 provider 的 HTTP 层。
- 深度 DI（重写 Provider/Models 接口）**不需要**——Provider 接口本身就是注册面。

## 不确定 / 待验证

- faux provider 是否被 pi.dev 官网文档页收录（README/源码确认，未在 pi.dev/docs 页面见到专门页面；custom-provider/models/sdk 页面未提 faux）。
- `registerFauxProvider` 是 compat 层导出（`@earendil-works/pi-ai/compat`），`fauxProvider` 是主入口导出——SDK 会话测试用 compat 版经 modelRegistry 注册；两者注入路径不同（compat 注册表 vs Models 集合），集成时需按自己的模型运行方式选型。
- 本地 OpenAI 兼容 mock 端点方式下，pi 对"流式响应"有最小格式要求（SSE `data: {...}` 块、role 兼容等），`compat` 字段可缓解部分差异；未逐一验证 DeepSeek/Kimi 官方 SDK 形态与 openai-completions 协议的差异细节。
- 本次调研基于 main 分支 f0deb8d（2026-08-02 前后快照）；npm 0.83.0 与 main 的 API 可能略有出入（`CreateAgentSessionOptions` 字段以发布版 .d.ts 为准）。

## 开放问题（留给 /tech-design 决策）

- 对话回路测试选 faux provider（零网络、确定性、官方范式）还是本地 OpenAI 兼容 mock 端点（真实 HTTP 全链路、实现 OpenAI SSE 协议成本）——取决于要验证的层级（SDK 事件语义 vs HTTP 集成）。
- 若选 faux：经 `registerFauxProvider`（compat 注册表）还是 `fauxProvider` + `ModelRuntime.registerNativeProvider`（Models 集合）注入；测试 harness 是否复刻 pi 的 `createHarness` 模式。
- DeepSeek/Kimi 真实 API 的验证留待什么机制（冒烟/集成测试打真实端点、低频）。

## 参考来源清单

| 来源 | URL/路径 | 访问日期 | 用途 |
|---|---|---|---|
| pi.dev 文档：Custom Providers | https://pi.dev/docs/latest/custom-provider | 2026-08-03 | registerProvider 语义、config 值语法、OpenAI 兼容 api 清单 |
| pi.dev 文档：Custom Models | https://pi.dev/docs/latest/models | 2026-08-03 | models.json 位置/字段、localhost baseUrl 例子、env 插值、compat |
| pi.dev 文档：Providers | https://pi.dev/docs/latest/providers | 2026-08-03 | models.json vs extensions 双路径、llama.cpp |
| pi.dev 文档：llama.cpp | https://pi.dev/docs/latest/llama-cpp | 2026-08-03 | LLAMA_BASE_URL/端口/router 模式限制 |
| pi.dev 文档：SDK | https://pi.dev/docs/latest/sdk | 2026-08-03 | createAgentSession 选项、ModelRuntime.create/InMemoryCredentialStore |
| pi-ai README（源码） | https://github.com/earendil-works/pi/blob/main/packages/ai/README.md | 2026-08-03 | "Faux Provider for Tests" 官方文档 |
| packages/ai/src/providers/faux.ts | /tmp/pi-research/packages/ai/src/providers/faux.ts（github.com/earendil-works/pi/blob/main/...） | 2026-08-03 | faux provider 实现（零网络、响应队列、流式仿真） |
| packages/ai/src/compat.ts | /tmp/pi-research/packages/ai/src/compat.ts | 2026-08-03 | registerFauxProvider（compat 注册表 + unregister） |
| packages/ai/src/models.ts | /tmp/pi-research/packages/ai/src/models.ts | 2026-08-03 | createProvider/createModels/setProvider/Models 接口 |
| packages/ai/src/index.ts | /tmp/pi-research/packages/ai/src/index.ts | 2026-08-03 | faux 为公共导出 |
| packages/ai/src/types.ts（fetch?: FetchFunction） | /tmp/pi-research/packages/ai/src/types.ts | 2026-08-03 | 请求级 fetch 注入 |
| packages/ai/test/faux-provider.test.ts | /tmp/pi-research/packages/ai/test/faux-provider.test.ts | 2026-08-03 | 官方 faux 用法（注册/响应/断言） |
| packages/ai/test/fetch-option.test.ts | /tmp/pi-research/packages/ai/test/fetch-option.test.ts | 2026-08-03 | vi.fn 注入 fetch、ambient fetch 断言 |
| packages/ai/test/pi-messages.test.ts 等 | /tmp/pi-research/packages/ai/test/ | 2026-08-03 | node:http 本地 server 模拟端点 |
| packages/coding-agent/src/core/sdk.ts | /tmp/pi-research/packages/coding-agent/src/core/sdk.ts | 2026-08-03 | CreateAgentSessionOptions（model/modelRuntime）、默认 runtime |
| packages/coding-agent/src/core/model-runtime.ts | /tmp/pi-research/packages/coding-agent/src/core/model-runtime.ts | 2026-08-03 | CreateModelRuntimeOptions、registerProvider/registerNativeProvider/setRuntimeApiKey |
| packages/coding-agent/src/core/provider-composer.ts | /tmp/pi-research/packages/coding-agent/src/core/provider-composer.ts | 2026-08-03 | ProviderConfigInput 类型（streamSimple 注入） |
| packages/coding-agent/src/core/extensions/loader.ts | /tmp/pi-research/packages/coding-agent/src/core/extensions/loader.ts | 2026-08-03 | 扩展 API pi.registerProvider 接线 |
| packages/coding-agent/docs/sdk.md | /tmp/pi-research/packages/coding-agent/docs/sdk.md | 2026-08-03 | SDK 模型/认证文档（models.json 自定义模型、优先级） |
| packages/coding-agent/test/agent-session-dynamic-provider.test.ts | /tmp/pi-research/packages/coding-agent/test/agent-session-dynamic-provider.test.ts | 2026-08-03 | 官方"手写 Provider + localhost baseUrl"SDK 测试范式 |
| packages/coding-agent/test/suite/harness.ts | /tmp/pi-research/packages/coding-agent/test/suite/harness.ts | 2026-08-03 | 官方 agent 回路测试 harness（faux + modelRegistry + AgentSession） |
| packages/coding-agent/test/llama-extension.test.ts | /tmp/pi-research/packages/coding-agent/test/llama-extension.test.ts | 2026-08-03 | 本地 server 模拟 llama.cpp router |
| earendil-works/pi @ main f0deb8d | https://github.com/earendil-works/pi（shallow clone → /tmp/pi-research） | 2026-08-03 | 上述源码的克隆载体 |
