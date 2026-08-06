// src/renderer/api/agentSessions.js
// UI Copilot 会话中心 — 会话/消息/确认端点 fetch 封装 + SSE 订阅封装
// （tech-design renderer `api/agentSessions.js`；接口契约 = tech-design「HTTP：
// 会话与消息」端点表 + REQ-AGENT-027/028/029/030）。
//
// 端点：
//   GET  /api/agent/sessions                → { general, projects, feishu }（分组列表）
//   POST /api/agent/sessions                → 202 { spaceKey }（F4 新对话归属）
//   GET  /api/agent/sessions/:key/messages  → { messages: [...] }（JSONL 投影分页）
//   POST /api/agent/sessions/:key/messages  → 202 { messageId }（发送）
//   POST /api/agent/sessions/:key/reset     → 200 { spaceKey: 新 }（UI 空间 /reset = 新会话）
//   GET  /api/agent/confirmations           → { pending, confirmations }（U-1 全量 + status）
//   POST /api/agent/confirmations/:id/approve|reject → 既有端点复用（REQ-AGENT-030）
//   GET  /api/agent/sessions/:key/events    → SSE 流（tech-design F2/D4）
//
// SSE 订阅封装（subscribeSessionEvents）：EventSource 自动重连由浏览器原生保证；
// 断线重连后调用方须先 GET .../messages 全量对齐再续流（F2——SSE 只推增量，
// 不做事件回溯），本封装在每次连接建立（含重连）时触发 onOpen 回调。

import { get, post } from "./client.js";

const API_BASE = () => (typeof window !== "undefined" && window.opc?.apiBaseUrl) || "";

const encodeKey = (spaceKey) => encodeURIComponent(spaceKey);

/** 分组会话列表：{ general, projects: [{ projectId, projectName, orphan, sessions }], feishu } */
export function listSessions() {
  return get("/api/agent/sessions");
}

/** 新建会话（F4）：{ spaceKind: "general" } 或 { spaceKind: "project", projectId } → { spaceKey } */
export function createSession(body) {
  return post("/api/agent/sessions", body);
}

/** UI 空间 /reset（F4）= 同分组新建会话并切换 → { spaceKey: 新 }；旧行保留。 */
export function resetSession(spaceKey) {
  return post(`/api/agent/sessions/${encodeKey(spaceKey)}/reset`, {});
}

/** 历史消息（JSONL 投影）：{ messages: [{ messageId, role, createdAt, text }] } */
export function getMessages(spaceKey) {
  return get(`/api/agent/sessions/${encodeKey(spaceKey)}/messages`);
}

/** 发送消息（F1）：202 { messageId }；流式回复经 SSE 回传。 */
export function sendMessage(spaceKey, text) {
  return post(`/api/agent/sessions/${encodeKey(spaceKey)}/messages`, { text });
}

/** 确认项全量（U-1）：{ pending, confirmations }——confirmations 含 status
 *  （pending|approved|rejected），页面重载后已处理卡重建依赖它。 */
export function listConfirmations() {
  return get("/api/agent/confirmations");
}

/** 确认（REQ-AGENT-030）：既有端点复用 → 确认服务驱动同一命令模块执行，
 *  结果经 notify-result 注入会话 → SSE 流式回投。 */
export function approveConfirmation(confirmId) {
  return post(`/api/agent/confirmations/${encodeKey(confirmId)}/approve`, {});
}

/** 拒绝：不执行 + 回投「操作已取消」（confirmationService 既有注入）。 */
export function rejectConfirmation(confirmId) {
  return post(`/api/agent/confirmations/${encodeKey(confirmId)}/reject`, {});
}

/**
 * SSE 订阅封装（tech-design F2）：EventSource 原生自动重连（断线不崩、重连可再建），
 * 每次连接建立（含首次与断线重连）触发 onOpen —— 调用方在 onOpen 中先 GET .../messages
 * 全量对齐再续流（SSE 只推增量，不做事件回溯）。事件帧 = agentService session-event
 * 原样（text_start/text_delta{delta}/text_end{content}/confirmation-pending 等）。
 * @param {string} spaceKey
 * @param {{ onOpen?: () => void, onEvent?: (ev: object) => void, onError?: () => void }} handlers
 * @returns {() => void} 退订（关闭 EventSource）
 */
export function subscribeSessionEvents(spaceKey, { onOpen, onEvent, onError } = {}) {
  const url = `${API_BASE()}/api/agent/sessions/${encodeKey(spaceKey)}/events`;
  const es = new EventSource(url);
  es.onopen = () => onOpen?.();
  es.onmessage = (msg) => {
    if (typeof msg.data !== "string" || msg.data.trim() === "") return;
    try {
      onEvent?.(JSON.parse(msg.data));
    } catch {
      // 非 JSON 帧（心跳注释帧等）：忽略。
    }
  };
  es.onerror = () => onError?.(); // EventSource 自动重连；错误事件不关闭连接
  return () => es.close();
}
