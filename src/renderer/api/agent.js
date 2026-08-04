import { get, post, put, del } from "./client.js";

// 内置 Agent 配置（REQ-AGENT-001/004/014）：
// GET 返回 { provider, configured, identity, binding }，永不含密钥（签核决策 5）。
export function getAgentConfig() {
  return get("/api/settings/agent");
}

// PUT body：{ provider, apiKey, identity }——provider+apiKey 成对更新（apiKey 缺省 =
// 保留现有 key），identity 可单独更新；校验失败抛 E-CONFIG-INVALID（400）。
export function saveAgentConfig({ provider, apiKey, identity }) {
  return put("/api/settings/agent", { provider, apiKey, identity });
}

// POST test-connection：{ provider, apiKey } → { ok: true } 或
// { ok: false, error: "E-AGENT-LLM-FAIL", message }（失败不阻止保存）。
export function testConnection({ provider, apiKey }) {
  return post("/api/settings/agent/test-connection", { provider, apiKey });
}

// 绑定 arming（一次性 + 10 分钟有效期）：响应 { ok, binding }。
export function bindingBegin() {
  return post("/api/settings/agent/binding/begin");
}

// 取消 arming：响应 { ok, binding }。
export function bindingCancel() {
  return post("/api/settings/agent/binding/cancel");
}

// 解绑：响应 { ok, binding }。
export function bindingDelete() {
  return del("/api/settings/agent/binding");
}
