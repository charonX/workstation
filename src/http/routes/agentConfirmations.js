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

  if (req.method === "GET" && subPath.length === 0) {
    return ok(res, { pending: svc.listPending() });
  }

  const confirmId = subPath[0];
  const action = subPath[1];
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
