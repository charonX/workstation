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

import { get, post, put } from "./client.js";

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

/** 发送消息（F1）：202 { messageId }；流式回复经 SSE 回传。
 *  附件（REQ-AGENT-098，Slice 5）：attachments = [{name, size, mimeType, kind:"image",
 *  path}]（≤10）——渲染层已做白名单/数量/大小/视觉复核，此处透传 POST。 */
export function sendMessage(spaceKey, text, attachments) {
  const body = { text };
  if (Array.isArray(attachments) && attachments.length > 0) {
    body.attachments = attachments;
  }
  return post(`/api/agent/sessions/${encodeKey(spaceKey)}/messages`, body);
}

/** 确认项全量（U-1）：{ pending, confirmations }——confirmations 含 status
 *  （pending|approved|rejected），页面重载后已处理卡重建依赖它。 */
export function listConfirmations() {
  return get("/api/agent/confirmations");
}

/** 会话 provider（REQ-AGENT-093/094，Slice 5）：GET → { provider, model }——行值
 *  优先（NULL → 默认组合）；工具栏模型选择器取位/回读。 */
export function getSessionProvider(spaceKey) {
  return get(`/api/agent/sessions/${encodeKey(spaceKey)}/provider`);
}

/** 切换会话 provider（REQ-AGENT-093/094）：PUT { provider, model } → { provider,
 *  model }——provider-change 热更新（历史保留，下一条生效）；组合不在已配置条目 →
 *  400 E-MODEL-CONFIG-MISSING；key 解密失败 → 400 E-MODEL-KEY-FAIL。 */
export function setSessionProvider(spaceKey, provider, model) {
  return put(`/api/agent/sessions/${encodeKey(spaceKey)}/provider`, { provider, model });
}

/** 确认（REQ-AGENT-030）：既有端点复用 → 确认服务驱动同一命令模块执行，
 *  结果经 notify-result 注入会话 → SSE 流式回投。 */
export function approveConfirmation(confirmId) {
  return post(`/api/agent/confirmations/${encodeKey(confirmId)}/approve`, {});
}

/** 会话模式（REQ-AGENT-071/072，Slice 4）：GET → { mode }——当前会话模式；
 *  未显式切过 = 全局 lastMode（首次 auto）。进入会话/切换会话/重载时取位。 */
export function getSessionMode(spaceKey) {
  return get(`/api/agent/sessions/${encodeKey(spaceKey)}/mode`);
}

/** 切换会话模式（REQ-AGENT-071/072）：PUT { mode } → { mode }——会话级状态 +
 *  settings lastMode 持久化（新会话初始 = lastMode）；非法值 → 400 E-MODE-INVALID。 */
export function setSessionMode(spaceKey, mode) {
  return put(`/api/agent/sessions/${encodeKey(spaceKey)}/mode`, { mode });
}

/** 全局 lastMode（BUG-001 裁决 A：无会话切模式 = 改全局默认）：PUT
 *  /api/agent/mode/last { mode } → { mode }——无会话（selectedKey 为 null）时
 *  切换落盘 settings lastMode，后续新建会话取位 = 新 lastMode
 *  （REQ-AGENT-072 标准 2）；非法值 → 400 E-MODE-INVALID。 */
export function setLastMode(mode) {
  return put("/api/agent/mode/last", { mode });
}

/** 拒绝：不执行 + 回投「操作已取消」（confirmationService 既有注入）。 */
export function rejectConfirmation(confirmId) {
  return post(`/api/agent/confirmations/${encodeKey(confirmId)}/reject`, {});
}

/**
 * 项目图片读取（REQ-AGENT-051 / I-3 访问机制）：GET /api/agent/files/image——
 * 主进程按 projectId 解析项目目录并做白名单判定（目录边界 + 扩展名）后回传二进制，
 * renderer 转 blob URL 渲染。越权/不存在/非白名单 → 响应非 ok → 抛错（调用方转占位）。
 * @param {string} projectId 项目空间会话的项目 ID（主进程按 registry 解析实际目录）
 * @param {string} imagePath 原始路径（相对按项目目录解析；项目内绝对路径直接请求）
 * @returns {Promise<Blob>}
 */
export async function fetchProjectImage(projectId, imagePath) {
  const qs = new URLSearchParams();
  qs.set("projectId", String(projectId ?? ""));
  qs.set("path", String(imagePath ?? ""));
  const res = await fetch(`${API_BASE()}/api/agent/files/image?${qs.toString()}`);
  if (!res.ok) throw new Error(`IMAGE_FETCH_FAILED:${res.status}`);
  return res.blob();
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
