import * as settingsService from "../../services/settingsService.js";
import { fetchModels, listCatalog, isApiKeyProvider, providerBaseUrl } from "../../services/modelCatalogService.js";
import {
  broadcastAgentConfigChange,
  broadcastJudgeConfig,
  buildJudgeConfig,
} from "../../services/agentService.js";

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export async function handleSettings(req, res, body, subPath = [], context = {}) {
  const { agentRouter } = context;
  if (subPath[0] === "agent") {
    if (subPath[1] === "test-connection" && req.method === "POST") {
      return handleAgentTestConnection(req, res, body);
    }
    // 动态模型列表（REQ-AGENT-092 / PRD §10.2，Slice 5 前端 seam）：POST
    // /api/settings/agent/models { provider, apiKey } → { models: [...], fallback? }
    // ——Settings 添加条目表单实时拉取（成功 → 裸数组 wrap 成 {models}；无 key/失败/
    // 空列表 → {models, fallback:true}，E2/E3 提示分支）。apiKey 走请求体（不落 URL）。
    if (subPath[1] === "models" && req.method === "POST") {
      return handleProviderModels(req, res, body);
    }
    // catalog 端点（REQ-AGENT-100 / PRD §10.4 接口 6，v0.6）：GET
    // /api/settings/agent/catalog → {providers: [{provider, displayName,
    // defaultModel, models: [{model, vision, reasoning}]}]}——37 个 apiKey 型
    // 静态 provider 全量（pi-ai 目录单一真源；排除 OAuth 型 openai-codex /
    // github-copilot 与 faux）；renderer 下拉 + 视觉判定数据源。只读幂等。
    if (subPath[1] === "catalog" && req.method === "GET") {
      return handleCatalog(res);
    }
    // 绑定（REQ-AGENT-014，E3 + W-1）：Settings Agent 区「开始绑定」入口 →
    // agentRouter.beginBinding（pendingBind arming，一次性 + 10 分钟有效期）——
    // Slice 8 生产接线（此前零调用方；绑定是 agent 命令可用/对话可用的解锁条件）。
    // 取消 arming（标准 5）/ 解绑（标准 4）端点同形态，runBindingAction 统一分发。
    if (subPath[1] === "binding" && subPath[2] === "begin" && req.method === "POST") {
      return runBindingAction(res, agentRouter, "beginBinding");
    }
    if (subPath[1] === "binding" && subPath[2] === "cancel" && req.method === "POST") {
      return runBindingAction(res, agentRouter, "cancelBinding");
    }
    if (subPath[1] === "binding" && req.method === "DELETE") {
      return runBindingAction(res, agentRouter, "unbind");
    }
    if (req.method === "GET") {
      // 绑定状态随配置状态可查（Settings Agent 区展示；未接线 agentRouter 时兜底
      // 未绑定——agentConfig 等纯配置 seam 不依赖绑定）。
      return ok(res, {
        ...settingsService.loadAgentConfig(),
        binding: agentRouter?.getBindingStatus?.() ?? { bound: false },
      });
    }
    if (req.method === "PUT") {
      return handleAgentConfigSave(req, res, body);
    }
    return notFound(res);
  }

  if (req.method === "GET") {
    return ok(res, loadPublicSettings());
  }

  if (req.method === "PATCH") {
    try {
      const updated = settingsService.saveSettings(body);
      return ok(res, updated);
    } catch (err) {
      if (err.code === "SKILL_REPO_PATH_CONFLICT") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: err.code, conflicts: err.conflicts, message: err.message }));
      }
      return badRequest(res, err.message);
    }
  }

  return notFound(res);
}

// 绑定动作分发（REQ-AGENT-014：begin/cancel/unbind 三端点共用同一形态——
// 未接线 agentRouter 时 404；执行后回传最新绑定状态供 Settings 展示）。
function runBindingAction(res, agentRouter, method) {
  if (typeof agentRouter?.[method] !== "function") return notFound(res);
  agentRouter[method]();
  return ok(res, { ok: true, binding: agentRouter.getBindingStatus() });
}

// 通用 GET /api/settings：剥离 agent 密钥字段——明文或密文均不返回（签核决策 5）。
// loadSettings 返回完整磁盘配置（agentRouter 等内部消费方需要 apiKeyEncrypted），
// 非密钥视图仅经 GET /api/settings/agent（loadAgentConfig）暴露。
// 新形态（REQ-AGENT-090）下 apiKeyEncrypted 下沉到 providers 条目级——逐条剥离；
// 明文 apiKey 同剥（测试 fixture 直写未加密 key 的容错，键值不回传）。
function loadPublicSettings() {
  const settings = settingsService.loadSettings();
  if (settings.agent && typeof settings.agent === "object") {
    // loadSettings 是浅拷贝，agent 子对象仍指向内部状态——先复制再剥离，避免污染。
    settings.agent = { ...settings.agent };
    delete settings.agent.apiKeyEncrypted;
    delete settings.agent.apiKey;
    if (Array.isArray(settings.agent.providers)) {
      settings.agent.providers = settings.agent.providers.map((p) => {
        if (!p || typeof p !== "object") return p;
        const copy = { ...p };
        delete copy.apiKeyEncrypted;
        delete copy.apiKey;
        return copy;
      });
    }
  }
  return settings;
}

// PUT /api/settings/agent：保存 providers 条目列表 + 默认组合 + 身份
// （REQ-AGENT-090 新形态；校验失败 → E-CONFIG-INVALID）。
// 变更广播（ADR-026：条目是配置源，不是会话绑定）：
// - identity 变更 → 存量会话热更新 systemPrompt（REQ-AGENT-004 标准 2：config-ack，
//   不重建上下文）；
// - providers 条目变更（新增/删除/改默认）→ 不触发会话重建——会话级切换与懒恢复
//   按行重装由 REQ-AGENT-093/095（Slice 2）承接；
// - 旧形态平铺 PUT（{provider, apiKey}，旧 renderer 直至 Slice 5 替换）→ 保留旧语义
//   （provider/key 变更 → 存量会话重建 + 新 key 一次性注入，REQ-AGENT-004 旧行为）。
// - 默认组合变更（新形态 defaultModel / 旧形态平铺 provider）→ judge-config 广播
//   （REQ-AGENT-096，B5：全部活跃会话 auto 判断热更新，无滞后窗口；懒恢复会话随
//   session-config 自然带新 defaultJudge）。
// key 明文仅经内存传递（不落日志）。
function handleAgentConfigSave(req, res, body) {
  try {
    // 变更前默认组合（变更判定基准；buildJudgeConfig = REQ-096 签核 seam——判定与
    // worker defaultJudge 装配同源规范化，此处不再手拼 defaultModel 指针）。
    const before = buildJudgeConfig(settingsService.loadAgentConfig());
    const saved = settingsService.saveAgentConfig(body);
    const hasIdentity = hasOwn(body, "identity");
    const hasFlatCreds = hasOwn(body, "provider") && hasOwn(body, "apiKey");
    if (hasIdentity || hasFlatCreds) {
      broadcastAgentConfigChange({
        identity: hasIdentity ? saved.identity : undefined,
        provider: hasFlatCreds ? body.provider : undefined,
        apiKey: hasFlatCreds ? body.apiKey : undefined
      });
    }
    // 默认组合变更（新形态 defaultModel / 旧形态平铺 provider 均经 saveAgentConfig
    // 规范化 → buildJudgeConfig 输出）→ judge-config 广播（懒恢复会话不在此列，
    // 随 session-config 自然带新 defaultJudge）。
    const after = buildJudgeConfig(saved);
    const comboChanged =
      (before?.provider ?? "") !== (after?.provider ?? "") ||
      (before?.model ?? "") !== (after?.model ?? "");
    if (comboChanged) {
      broadcastJudgeConfig();
    }
    return ok(res, saved);
  } catch (err) {
    if (err.code === "E-CONFIG-INVALID") {
      return invalid(res, err.code, err.message);
    }
    return badRequest(res, err.message);
  }
}

// POST /api/settings/agent/test-connection：对当前供应商发最小校验请求。
// 失败透传供应商原因（E-AGENT-LLM-FAIL）且不阻止后续保存（签核决策 3）。
// 输入校验按字段拆分提示：非法 provider →「请选择供应商」，空 key →「API key 不能为空」。
//
// REQ-AGENT-103（v0.7 / BUG-001 req-gap 补全）：provider 合法性 = isApiKeyProvider
// （catalog 单一真源，与保存校验同源——v0.6 放出 37 项后不再用硬编码端点表）；
// 端点 = pi-ai 目录 baseUrl + "/models"（legacy 3 项派生结果与原 AGENT_PROVIDER_ENDPOINTS
// 逐字一致，testConnection.test.js 标准 5 守护）；baseUrl 缺失 provider
// （amazon-bedrock 等 7 项）→ 200 E-TEST-UNSUPPORTED「该供应商不支持连接测试，
// 可直接保存」，不发网络请求（人签 expected 值）。
async function handleAgentTestConnection(req, res, body) {
  const { provider, apiKey } = body ?? {};
  if (!isApiKeyProvider(provider)) {
    return invalid(res, "E-CONFIG-INVALID", "请选择供应商");
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    return invalid(res, "E-CONFIG-INVALID", "API key 不能为空");
  }
  // 端点派生（provider 已确认在 catalog 内）。
  const base = providerBaseUrl(provider);
  if (!base) {
    return ok(res, { ok: false, error: "E-TEST-UNSUPPORTED", message: "该供应商不支持连接测试，可直接保存" });
  }
  const endpoint = `${base}/models`;
  try {
    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000)
    });
    if (resp.ok) {
      return ok(res, { ok: true });
    }
    let reason = `HTTP ${resp.status}`;
    try {
      const data = await resp.json();
      reason = data?.error?.message ?? data?.message ?? reason;
    } catch {
      // 非 JSON 响应体，保留 HTTP 状态文本。
    }
    return ok(res, { ok: false, error: "E-AGENT-LLM-FAIL", message: reason });
  } catch (err) {
    return ok(res, { ok: false, error: "E-AGENT-LLM-FAIL", message: err.message });
  }
}

// 动态模型列表拉取（REQ-AGENT-092，Slice 5）：POST /api/settings/agent/models。
// 响应归一化：拉取成功（裸数组）→ { models }；无 key/失败/空列表 → { models,
// fallback: true }（modelCatalogService 契约原样，仅数组 wrap 统一形态）。
async function handleProviderModels(req, res, body) {
  const provider = body?.provider;
  if (typeof provider !== "string" || provider === "") {
    return badRequest(res, "provider 必选");
  }
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey : "";
  const result = await fetchModels(provider, apiKey);
  return ok(res, Array.isArray(result) ? { models: result } : result);
}

// catalog 端点处理（REQ-AGENT-100）：静态目录派生（纯内存，无 IO）——异常走
// 500 E-CATALOG（§10.4 接口 6 系统错误；目录数据源正常情况下不触发）。
function handleCatalog(res) {
  try {
    return ok(res, listCatalog());
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "E-CATALOG", message: err.message }));
  }
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function badRequest(res, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "VALIDATION_ERROR", message }));
}

function invalid(res, code, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: code, message }));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
}
