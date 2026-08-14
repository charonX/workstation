# ADR-027：供应商探针协议族感知派生——pi-ai 目录单一真源

- 状态：已接受
- 日期：2026-08-14
- 相关 REQ：REQ-AGENT-103、REQ-AGENT-104（2026-08-12-conversation-toolbar-ext，BUG-001/002）

## 上下文

v0.6 放出全部 37 个 apiKey 型 provider（REQ-100/101）后，test-connection 与动态
模型拉取需要"对任意供应商发最小校验/列表请求"的能力。第一版假设「目录
baseUrl + `/models` + Bearer 通吃」（REQ-103 v3），被实测推翻：kimi-coding 属
anthropic-messages 协议族——`/coding/models` → 404（端点不存在），
`/coding/v1/models` → 401（端点存在）；pi-ai 对 anthropic 族用 Anthropic SDK
形态（`x-api-key` + `anthropic-version` 头）。

同时存在历史教训：域集合（provider 全集）放出时，散落在各处的枚举表
（保存校验、模型列表、test-connection）必然分叉——BUG-001 即漏改
`AGENT_PROVIDER_ENDPOINTS` 硬编码表所致。

## 决策

1. **协议族派生单一真源 = pi-ai 静态目录**：族 = `catalog.getModels(provider)[0].api`
   （provider 对象不暴露 api，取模型字段）；baseUrl = `getProvider().baseUrl`。
   `modelCatalogService.providerProbe(provider, apiKey) → {url, headers} | null`
   是 test-connection 与 fetchModels 的**同一派生源**（禁止两处各维护端点表）。
2. **族 → 探针形态**（端点存在性已全量假 key 实测 2026-08-14）：
   - openai-completions/responses（23 项）→ `{baseUrl}/models` + Bearer；
   - anthropic-messages（6 项有 baseUrl）→ `{baseUrl}/v1/models` +
     `x-api-key` + `anthropic-version: 2023-06-01`；
   - mistral-conversations → `{baseUrl}/v1/models` + Bearer；
   - google-generative-ai → `{baseUrl}/models?key=<key>`（google 官方唯一形态，
     **key 进 URL——人签安全边界**：透传响应不含 URL、fetch 错误消息不含 URL 已确认；
     风险接受）。
3. **baseUrl 缺失（7 项）→ 不发请求**：test-connection 返 200
   `{ok:false, error:"E-TEST-UNSUPPORTED", message:"该供应商不支持连接测试，可直接保存"}`；
   fetchModels 直接回退内置目录。不阻塞保存（REQ-AGENT-001 AC4 签核语义延伸）。
4. **能力标志**：供应商响应带 `supports_image_in/supports_reasoning` → 直存
   （kimi 系 B2 签核语义）；否则 pi-ai 目录补全（deepseek 模式泛化；目录值与
   既有硬编码逐字一致已实证）。google 族剥 `models/` 前缀。全部过
   `modelInCatalog` 防御（REQ-092 AC5）。

## 后果

- test-connection / 模型拉取对 31 个有 baseUrl 的 provider 真实可用，7 项明确
  中性提示；legacy 3 项端点逐字不变（testConnection 标准 5 守护）。
- 新 provider 随 pi-ai 升级自动获得正确探针（族字段驱动，无需改代码）；
  新协议族出现 → default 走 openai 形态，失败透传不阻塞（可接受降级）。
- 反模式警示：任何「按 provider 硬编码端点/能力表」的写法在本域被禁止——
  一律走 providerProbe / 目录。
