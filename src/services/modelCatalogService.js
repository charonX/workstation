// src/services/modelCatalogService.js
// 动态模型列表（REQ-AGENT-092 / PRD §10.2；REQ-AGENT-104 全协议族化 / BUG-002）：
// 配置 provider 条目时实时拉取供应商模型列表——无缓存，每次实时拉取（tech-design
// 决策「实时拉取无缓存」），仅配置时调用。
//
// 契约（providerModelConfig.test.js 签核断言）：fetchModels(provider, apiKey)
// - 拉取成功 → 裸数组 [{model, vision, reasoning}]（REQ-092 接口契约数组形态）；
// - 无 key / 拉取失败 / 列表为空 / baseUrl 缺失 → { models: [...], fallback: true }
//   （E2「填 key 后自动刷新」/ E3「已使用内置列表」+ 错误标记）。
// - 端点与鉴权按协议族派生（REQ-103/104，族数据源 = pi-ai 目录 model.api 单一真源）；
// - 能力标志：供应商返回带 supports_image_in/supports_reasoning → 直存（kimi 系 B2
//   签核语义）；否则 pi-ai 目录补全（deepseek「仅 id → 补全」模式泛化）；
// - 回退源 = pi-ai 内置目录（@earendil-works/pi-ai providers/all 静态目录；
//   input.includes("image") → vision）；
// - 防御（REQ-092 AC5）：id 在 pi-ai 静态目录不可解析（getModel 失败）→ 剔除
//   （BUG-004 教训：目录不存在的模型 worker resolveModel 会抛 E-AGENT-MODEL，
//   会话建不起来）。
//
// ADR-009：本模块无顶层 env/磁盘/electron 读取——builtinModels() 是纯内存静态目录。

import { builtinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

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

// provider baseUrl 查询（REQ-AGENT-103，v0.7 / BUG-001）：test-connection 端点派生
// 的单一真源 = pi-ai 静态目录 getProvider().baseUrl。目录不可解析 / baseUrl 缺失
// （amazon-bedrock / azure-openai-responses / cloudflare×2 / google-vertex /
// opencode×2）→ null，调用方返 E-TEST-UNSUPPORTED。
export function providerBaseUrl(provider) {
  if (typeof provider !== "string" || provider === "") {
    return null;
  }
  return catalog.getProvider(provider)?.baseUrl ?? null;
}

// 协议族（REQ-AGENT-103/104，v4 / BUG-002）：pi-ai 目录 model.api 单一真源
// （provider 对象本身不暴露 api，取首个模型的 api 字段；目录无模型 → null）。
function providerApiFamily(provider) {
  return catalog.getModels(provider)[0]?.api ?? null;
}

// 供应商探针派生（REQ-AGENT-103 test-connection 与 REQ-104 动态拉取同一派生源）：
// { url, headers } | null（baseUrl 缺失 / provider 不可解析 → null，调用方兜底）。
// 端点形态按协议族分派（存在性已全量实测 2026-08-14）：
// - anthropic-messages → {baseUrl}/v1/models + x-api-key/anthropic-version
//   （pi-ai Anthropic SDK 实证形态；BUG-002：/models → 404 实证推翻初版假设）
// - mistral-conversations → {baseUrl}/v1/models + Bearer
// - google-generative-ai → {baseUrl}/models?key=<key>（google 官方唯一形态，
//   key 进 URL——REQ-103 人签安全边界）
// - openai-completions / openai-responses / 未知族（防御默认）→ {baseUrl}/models + Bearer
export function providerProbe(provider, apiKey) {
  const base = providerBaseUrl(provider);
  if (!base) {
    return null;
  }
  const family = providerApiFamily(provider);
  if (family === "anthropic-messages") {
    return {
      url: `${base}/v1/models`,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    };
  }
  if (family === "google-generative-ai") {
    return { url: `${base}/models?key=${encodeURIComponent(apiKey)}`, headers: {} };
  }
  if (family === "mistral-conversations") {
    return { url: `${base}/v1/models`, headers: { Authorization: `Bearer ${apiKey}` } };
  }
  return { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey}` } };
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

// 响应解析按族分派（REQ-AGENT-104）：
// - google 族：{models: [{name: "models/<id>", ...}]} → 剥 "models/" 前缀；
// - 其余族（openai / anthropic / mistral）：{data: [{id, ...}]} → 取 id。
// 能力标志：item 带 supports_image_in/supports_reasoning → 直存（kimi 系 B2 签核
// 语义）；否则 pi-ai 目录补全（deepseek 模式泛化，目录值与既有硬编码逐字一致）。
// 全部过 modelInCatalog 防御（REQ-092 AC5）。
function parseModelsByFamily(provider, data) {
  const items = [];
  if (Array.isArray(data?.models)) {
    for (const m of data.models) {
      const name = typeof m?.name === "string" ? m.name : "";
      const id = name.startsWith("models/") ? name.slice("models/".length) : name;
      if (id !== "") {
        items.push({ id, direct: null });
      }
    }
  } else if (Array.isArray(data?.data)) {
    for (const m of data.data) {
      if (typeof m?.id !== "string" || m.id === "") {
        continue;
      }
      const hasCaps =
        typeof m.supports_image_in === "boolean" || typeof m.supports_reasoning === "boolean";
      items.push({
        id: m.id,
        direct: hasCaps
          ? { vision: m.supports_image_in === true, reasoning: m.supports_reasoning === true }
          : null,
      });
    }
  }
  return items
    .filter((item) => modelInCatalog(provider, item.id))
    .map((item) => {
      if (item.direct) {
        return { model: item.id, ...item.direct };
      }
      const entry = catalog.getModel(provider, item.id);
      return {
        model: item.id,
        vision: Array.isArray(entry.input) && entry.input.includes("image"),
        reasoning: entry.reasoning === true,
      };
    });
}

export async function fetchModels(provider, apiKey) {
  // E2：无 key → 不拉取，直接回退内置目录（UI 提示「填 key 后自动刷新」）。
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    return fallbackResult(provider);
  }
  const probe = providerProbe(provider, apiKey);
  if (!probe) {
    // baseUrl 缺失（amazon-bedrock 等 7 项）/ 未知 provider（faux 等测试 seam）：
    // 无供应商端点 → 回退内置目录，不发网络请求（REQ-104 标准 7）。
    return fallbackResult(provider);
  }
  try {
    const resp = await fetch(probe.url, {
      headers: probe.headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const models = parseModelsByFamily(provider, data);
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
