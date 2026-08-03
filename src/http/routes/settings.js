import * as settingsService from "../../services/settingsService.js";
import { broadcastIdentityChange } from "../../services/agentService.js";

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// 供应商 → 最小校验端点（REQ-AGENT-001 AC4「测试连接」，PRD §7 输入验证）。
// 端点域名即测试 seam：agentConfig.test.js 按 deepseek.com / moonshot 前缀 mock。
const AGENT_PROVIDER_ENDPOINTS = {
  deepseek: "https://api.deepseek.com/models",
  moonshotai: "https://api.moonshot.ai/v1/models",
  "moonshotai-cn": "https://api.moonshot.cn/v1/models"
};

export async function handleSettings(req, res, body, subPath = []) {
  if (subPath[0] === "agent") {
    if (subPath[1] === "test-connection" && req.method === "POST") {
      return handleAgentTestConnection(req, res, body);
    }
    if (req.method === "GET") {
      return ok(res, settingsService.loadAgentConfig());
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

// 通用 GET /api/settings：剥离 agent 密钥字段——明文或密文均不返回（签核决策 5）。
// loadSettings 返回完整磁盘配置（agentRouter 等内部消费方需要 apiKeyEncrypted），
// 非密钥视图仅经 GET /api/settings/agent（loadAgentConfig）暴露。
function loadPublicSettings() {
  const settings = settingsService.loadSettings();
  if (settings.agent && hasOwn(settings.agent, "apiKeyEncrypted")) {
    // loadSettings 是浅拷贝，agent 子对象仍指向内部状态——先复制再剥离，避免污染。
    settings.agent = { ...settings.agent };
    delete settings.agent.apiKeyEncrypted;
  }
  return settings;
}

// PUT /api/settings/agent：保存供应商/key/身份（校验失败 → E-CONFIG-INVALID）。
// 身份变更 → 存量会话热更新（REQ-AGENT-004 标准 2：config-ack，不重建上下文）。
function handleAgentConfigSave(req, res, body) {
  try {
    const saved = settingsService.saveAgentConfig(body);
    if (body && hasOwn(body, "identity")) {
      broadcastIdentityChange({ identity: saved.identity });
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
async function handleAgentTestConnection(req, res, body) {
  const { provider, apiKey } = body ?? {};
  if (!AGENT_PROVIDER_ENDPOINTS[provider]) {
    return invalid(res, "E-CONFIG-INVALID", "请选择供应商");
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    return invalid(res, "E-CONFIG-INVALID", "API key 不能为空");
  }
  // 校验通过后取端点（provider 已确认在枚举内）。
  const endpoint = AGENT_PROVIDER_ENDPOINTS[provider];
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
