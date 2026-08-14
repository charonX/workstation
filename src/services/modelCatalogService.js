// src/services/modelCatalogService.js
// 动态模型列表（REQ-AGENT-092 / PRD §10.2）：配置 provider 条目时实时拉取供应商
// 模型列表——无缓存，每次实时拉取（tech-design 决策「实时拉取无缓存」），仅配置时调用。
//
// 契约（providerModelConfig.test.js 签核断言）：fetchModels(provider, apiKey)
// - 拉取成功 → 裸数组 [{model, vision, reasoning}]（REQ-092 接口契约数组形态）；
// - 无 key / 拉取失败 / 列表为空 → { models: [...], fallback: true }
//   （E2「填 key 后自动刷新」/ E3「已使用内置列表」+ 错误标记）。
// - kimi 系（moonshotai / moonshotai-cn）：GET /v1/models——supports_image_in →
//   vision、supports_reasoning → reasoning，能力标志直存（B2）；
// - deepseek：GET /models 仅 id → 内置能力表补全（全系 vision=false、reasoning=true）；
// - 回退源 = pi-ai 内置目录（@earendil-works/pi-ai providers/all 静态目录；
//   input.includes("image") → vision）；
// - 防御（REQ-092 AC5）：id 在 pi-ai 静态目录不可解析（getModel 失败）→ 剔除
//   （BUG-004 教训：目录不存在的模型 worker resolveModel 会抛 E-AGENT-MODEL，
//   会话建不起来）。
//
// ADR-009：本模块无顶层 env/磁盘/electron 读取——builtinModels() 是纯内存静态目录。

import { builtinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

const PROVIDER_ENDPOINTS = {
  deepseek: "https://api.deepseek.com/models",
  moonshotai: "https://api.moonshot.ai/v1/models",
  "moonshotai-cn": "https://api.moonshot.cn/v1/models",
};

const FETCH_TIMEOUT_MS = 10000;

// 纯内存静态目录单例（pi-ai 内置模型常量，非网络；加载即全部 provider 目录就绪）。
const catalog = builtinModels();

// v0.6 catalog 端点排除集（REQ-AGENT-100 / PRD §10.4 接口 6）：
// - OAuth 型 provider（openai-codex / github-copilot）须排除——apiKey 型之外；
// - faux 测试 seam 不出现在 getBuiltinProviders()（本地实证 0.84），排除集保留防御。
const OAUTH_EXCLUDED = new Set(["openai-codex", "github-copilot"]);
const FAUX_EXCLUDED = new Set(["faux"]);

// 静态目录单 provider 能力映射（provider 目录不可解析 → 空列表，调用方兜底）。
function catalogProviderModels(provider) {
  return catalog
    .getModels(provider)
    .map((m) => ({
      model: m.id,
      vision: Array.isArray(m.input) && m.input.includes("image"),
      reasoning: m.reasoning === true,
    }))
    .filter((m) => typeof m.model === "string" && m.model !== "");
}

// provider 是否 apiKey 型可配置（v0.6 单一真源判定，listCatalog / settings 保存
// 校验共用）：pi-ai 静态目录（getBuiltinProviders，不含动态 radius）+ 排除 OAuth
// 型（openai-codex/github-copilot）与 faux 测试 seam。
export function isApiKeyProvider(provider) {
  return (
    typeof provider === "string" &&
    !OAUTH_EXCLUDED.has(provider) &&
    !FAUX_EXCLUDED.has(provider) &&
    getBuiltinProviders().includes(provider)
  );
}

// catalog 端点（REQ-AGENT-100 / PRD §10.4 接口 6，v0.6）：全量 apiKey 型静态
// provider 的 provider/模型/能力/defaultModel/displayName——数据源 = pi-ai 静态
// 目录（getBuiltinProviders 单一真源，本地实证 39 项——不含动态 radius；排除
// OAuth 型与 faux 后 = 37 项）。defaultModel = 目录首项；displayName = pi-ai
// Provider.name（缺失防御回落 id）。只读派生，无副作用（幂等）。
export function listCatalog() {
  const providers = getBuiltinProviders()
    .filter((id) => !OAUTH_EXCLUDED.has(id) && !FAUX_EXCLUDED.has(id))
    .map((id) => {
      const models = catalogProviderModels(id);
      return {
        provider: id,
        displayName: catalog.getProvider(id)?.name || id,
        defaultModel: models.length > 0 ? models[0].model : null,
        models,
      };
    })
    .filter((p) => p.models.length > 0);
  return { providers };
}

// 模型是否存在于 pi-ai 静态目录（PUT /api/settings/agent 校验 seam，REQ-AGENT-090
// 标准 3「模型必须来自拉取结果/内置目录」——服务端离线校验以内置目录为准）。
export function modelInCatalog(provider, model) {
  return (
    typeof provider === "string" && typeof model === "string" && !!catalog.getModel(provider, model)
  );
}

// 内置目录回退列表（无 key / 拉取失败 / 列表为空）：
// 映射 {model: id, vision: input.includes("image"), reasoning}（pi-ai 目录为事实）。
function fallbackModels(provider) {
  return catalogProviderModels(provider);
}

// 回退结果封装（E2/E3 共用：无 key / 未知 provider / 拉取失败 / 列表为空）。
function fallbackResult(provider) {
  return { models: fallbackModels(provider), fallback: true };
}

// kimi 系：/v1/models 能力标志直存（supports_image_in / supports_reasoning）。
// 目录不可解析的 id 剔除（REQ-092 AC5 防御）。
function parseKimiModels(provider, data) {
  const items = Array.isArray(data?.data) ? data.data : [];
  return items
    .filter((m) => m && typeof m.id === "string" && modelInCatalog(provider, m.id))
    .map((m) => ({ model: m.id, vision: m.supports_image_in === true, reasoning: m.supports_reasoning === true }));
}

// deepseek 系：/models 仅 id → 内置能力表补全（全系 text-only、reasoning=true）。
function parseDeepseekModels(data) {
  const items = Array.isArray(data?.data) ? data.data : [];
  return items
    .filter((m) => m && typeof m.id === "string" && modelInCatalog("deepseek", m.id))
    .map((m) => ({ model: m.id, vision: false, reasoning: true }));
}

export async function fetchModels(provider, apiKey) {
  // E2：无 key → 不拉取，直接回退内置目录（UI 提示「填 key 后自动刷新」）。
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    return fallbackResult(provider);
  }
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) {
    // 未知 provider（faux 等测试 seam）：无供应商端点 → 回退内置目录。
    return fallbackResult(provider);
  }
  try {
    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const models = provider === "deepseek" ? parseDeepseekModels(data) : parseKimiModels(provider, data);
    // E3：模型列表为空（供应商无返回 / 全部被目录防御剔除）→ 回退内置目录。
    if (models.length === 0) {
      return fallbackResult(provider);
    }
    // 拉取成功 → 裸数组（REQ-092 接口契约：[{model, vision, reasoning}]）。
    return models;
  } catch {
    // E3：网络/401/超时/解析失败 → 回退内置目录 + 错误标记（不阻塞保存）。
    return fallbackResult(provider);
  }
}
