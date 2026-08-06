// src/http/routes/agentConfirmations.js
// 确认回调 HTTP 端点（REQ-AGENT-016，b 解耦）：
// - POST /api/agent/confirmations/:confirmId/approve — 确认 → 确认服务驱动同一
//   命令模块执行（不经过 agent turn）→ notify-result 注入会话（自然语言回投）；
// - POST /api/agent/confirmations/:confirmId/reject — 拒绝 → 不执行 + 回投「已取消」；
// - GET /api/agent/confirmations — 挂起队列可见（M2 移动块基础：待确认项查看）；
//   U-1（2026-08-02-ui-copilot）：扩展返回全量 + status（{ pending, confirmations }，
//   含 approved/rejected——页面重载后已处理确认卡重建数据源）。
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
    // 2026-08-02-ui-copilot U-1：挂起队列可见（既有 { pending } 形态保留，builtin-agent
    // confirmation.test.js 回归断言 pending 数组）+ 全量确认项（含 approved/rejected，
    // 页面重载后已处理确认卡重建数据源——前端按 status 渲染「已处理」态）。
    return ok(res, { pending: svc.listPending(), confirmations: svc.listAll() });
  }

  const confirmId = rest[0];
  const action = rest[1];
  // 确认/拒绝回调（approve → 驱动同一命令模块执行；reject → 不执行）：同一分发
  // 形态（svc[action]，action 限定在确认服务接口 approve/reject 内——文件头契约）。
  if (req.method === "POST" && confirmId && (action === "approve" || action === "reject")) {
    const result = await svc[action](confirmId);
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
