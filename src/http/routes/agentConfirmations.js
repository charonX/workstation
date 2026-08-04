// src/http/routes/agentConfirmations.js
// 确认回调 HTTP 端点（REQ-AGENT-016，b 解耦）：
// - POST /api/agent/confirmations/:confirmId/approve — 确认 → 确认服务驱动同一
//   命令模块执行（不经过 agent turn）→ notify-result 注入会话（自然语言回投）；
// - POST /api/agent/confirmations/:confirmId/reject — 拒绝 → 不执行 + 回投「已取消」；
// - GET /api/agent/confirmations — 挂起队列可见（M2 移动块基础：待确认项查看）。
// confirmId 幂等：重复回调一次执行（确认服务内保证）。
// 卡片按钮 value 携带 confirmId + decision（{ decision: "approve"|"reject" }）——
// 飞书卡片动作 → 本端点的桥接（WS 事件分发）属通道集成，随 QA/REFLECT 验收。

export async function handleAgentConfirmations(req, res, body, subPath = [], context = {}) {
  const { getConfirmationService } = context;
  const svc = getConfirmationService?.();
  if (!svc) return notFound(res);

  // server.js 剥掉 /api/ 后 resource="agent"、subPath 形如
  // ["confirmations", confirmId, action]（GET /api/agent/confirmations → ["confirmations"]）。
  // 按文件头文档化端点契约解析：首段必须为 "confirmations"，否则 404——
  // 非文档形态（如 /api/agent/<confirmId>/approve）不再可达。
  if (subPath[0] !== "confirmations") return notFound(res);
  const rest = subPath.slice(1);

  if (req.method === "GET" && rest.length === 0) {
    return ok(res, { pending: svc.listPending() });
  }

  const confirmId = rest[0];
  const action = rest[1];
  if (req.method === "POST" && confirmId && action === "approve") {
    const result = await svc.approve(confirmId);
    return ok(res, result);
  }
  if (req.method === "POST" && confirmId && action === "reject") {
    const result = await svc.reject(confirmId);
    return ok(res, result);
  }

  return notFound(res);
}

function ok(res, data) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
}
