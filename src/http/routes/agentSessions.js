// src/http/routes/agentSessions.js
// UI Copilot 会话中心 — 会话 REST 端点（tech-design「接口契约」HTTP 会话端点表）。
//
// Slice 1（REQ-AGENT-027 空间=会话数据层）端点：
//   POST /api/agent/sessions { spaceKind, projectId? } → 200 { spaceKey }；spaceKind 非法 /
//                                                      projectId 无效 → 400 E-SESSION-CREATE
//   POST /api/agent/sessions/:spaceKey/messages { text } → 202 { messageId }；空/超限 → 400；
//                                                      feishu:* → 403 E-SESSION-READONLY
//   POST /api/agent/sessions/:spaceKey/reset           → 200 { spaceKey: 新 }（UI 空间 = 同分组
//                                                      新建会话并切换，旧行保留可读可继续，F4 语义）；
//                                                      feishu:* → 403 E-SESSION-READONLY
// Slice 2（REQ-AGENT-029 分组列表与历史回看）端点：
//   GET  /api/agent/sessions                          → 200 { general, projects, feishu }
//                                                     （完整分组：join projects 取名 / 孤儿标记 /
//                                                       agent_space_meta chat 名 / lastActiveAt 倒序）
//   GET  /api/agent/sessions/:spaceKey/messages?limit&before → 200 { messages: [...] }
//                                                     （JSONL 投影分页；默认 limit=100）
//
// 空间 key 语法（ADR-016 / CONTEXT.md 对话空间）：ui:copilot:<sessionId>（通用空间）、
// ui:project:<projectId>:<sessionId>（项目空间）；feishu:<chatId> 世代制沿用（不套用
// UI 新行语义——世代留给飞书空间与 provider/key 变更重建）。
//
// signoff 裁决：1（错误码 E-SESSION-CREATE/E-SESSION-NOT-FOUND/E-SESSION-READONLY）、
// 3（历史封套 { messages }，条目含 messageId/role/createdAt）、4（title slice(0,40)
// 无省略号）、5（分页：默认最新 limit 条、数组时间升序、before 游标 = messageId）、
// 9（feishu HTTP reset → 403）、10（feishu chat 名 seam = agent_space_meta 侧表，
// 表/行缺失 fallback 到 spaceKey）、16（孤儿组 projectName = null）、
// 17（条目字段集 title/lastActiveAt/sessionRef + spaceKey；组内 lastActiveAt 倒序）、
// 12（空文本 400 不强制 code）。
//
// SSE（GET .../events）属 REQ-AGENT-028（Slice 3），本文件不实现。孤儿/只读会话
// 的发送拦截（E-SESSION-ORPHAN）随 REQ-AGENT-028 错误映射完整化。

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { getDb } from "../../db.js";
import * as settingsService from "../../services/settingsService.js";
import { decryptSecret } from "../../services/secretStore.js";

const DEFAULT_PROVIDER = "deepseek";

// 输入上限（signoff 裁决 12）：300KB 明确越界 → 400（enforceSizeLimit 精确边界值
// 由既有回归覆盖，此处仅越界兜底）。
const MAX_MESSAGE_CHARS = 300 * 1024;

// —— 空间 key 纯函数（ADR-016 语法；Slice 2 分组列表复用）——

// 从既有 ui:* 空间 key 解析分组前缀：ui:copilot:* → "ui:copilot:"；
// ui:project:<pid>:* → "ui:project:<pid>:"；非 ui 空间 → undefined。
export function uiGroupPrefixFor(spaceKey) {
  const key = String(spaceKey ?? "");
  if (key.startsWith("ui:copilot:")) return "ui:copilot:";
  const m = /^ui:project:[^:]+:/.exec(key);
  return m ? m[0] : undefined;
}

// UI 空间 reset 新 key：同分组前缀 + 新 sessionId（F4：不触发世代机制）。
export function newUiSpaceKeyFor(spaceKey) {
  const prefix = uiGroupPrefixFor(spaceKey);
  return prefix ? `${prefix}${randomUUID()}` : undefined;
}

// —— JSONL 历史投影（B1：平台侧不复制全文，运行时真相 = PI JSONL）——
// 兼容两种 message 行形态（同构）：PI SessionManager 与平台内存内核轻量记录
// 均写 { type:"message", id, timestamp, message: { role, content } }——
// content 为文本段数组（{type:"text",text}）或纯字符串。非 message 行（session 头/
// 事件/compaction 等）跳过；单行损坏跳过（不阻断其余历史）；文件缺失 → 空数组。
export function projectMessagesFromJsonl(sessionRef) {
  let raw;
  try {
    raw = fs.readFileSync(sessionRef, "utf8");
  } catch {
    return [];
  }
  const messages = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "message" || !entry.message || typeof entry.message.role !== "string") continue;
    const content = entry.message.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
        .join("");
    }
    messages.push({
      messageId: String(entry.id ?? ""),
      role: entry.message.role,
      createdAt: typeof entry.timestamp === "string" ? entry.timestamp : "",
      text,
    });
  }
  return messages;
}

// 历史分页窗口（REQ-AGENT-029 标准 4 / signoff 裁决 5）：默认取最新 limit 条、
// 数组时间升序返回（JSONL 顺序即时间序，调用方保证）；before 游标 = messageId，
// 返回严格早于游标的窗口；游标不在数组中 → 视为无游标（最新窗口）；limit 非法
// （0/负数/NaN/非数字）→ 默认 100。
export function paginateMessages(messages, { limit = 100, before } = {}) {
  const size = Number.isInteger(limit) && limit > 0 ? limit : 100;
  let window = messages;
  if (typeof before === "string" && before !== "") {
    const idx = messages.findIndex((m) => m.messageId === before);
    if (idx !== -1) window = messages.slice(0, idx);
  }
  return window.slice(-size);
}

// —— HTTP 分发（server.js resource="agent"、subPath[0]="sessions" 挂接）——

export async function handleAgentSessions(req, res, body, subPath = [], context = {}) {
  const { getSessionStore, getAgentService } = context;
  const store = getSessionStore?.();
  if (!store) return notFound(res);

  // server.js resource="agent" 下 subPath 形如 ["sessions", ...]（test seam 契约：
  // 挂接 subPath[0]="sessions"）——首段剥除后按文件头端点契约解析。
  if (subPath[0] !== "sessions") return notFound(res);
  const rest = subPath.slice(1);

  if (rest.length === 0) {
    if (req.method === "GET") return ok(res, listSessions(store));
    if (req.method === "POST") return handleCreateSession(res, body ?? {}, store);
    return notFound(res);
  }

  const spaceKey = decodeParam(rest[0]);
  const tail = rest.slice(1);

  if (tail.length === 1 && tail[0] === "messages") {
    if (req.method === "GET") return handleGetMessages(req, res, spaceKey, store);
    if (req.method === "POST") return handlePostMessage(res, spaceKey, body ?? {}, store, getAgentService);
    return notFound(res);
  }

  if (tail.length === 1 && tail[0] === "reset") {
    if (req.method === "POST") return handleReset(res, spaceKey, store);
    return notFound(res);
  }

  return notFound(res);
}

// —— 集合级端点 ——

// 分组会话列表（REQ-AGENT-029 标准 1~3/5）：
// - general = ui:copilot:*；projects = ui:project:<pid>:*；feishu = feishu:*。
// - 项目组 join projects 表取名（标准 1）；pid 不存在 → orphan:true + projectName:null
//   （标准 2 / signoff 裁决 16，不回填 pid）。
// - 飞书条目显示名取 agent_space_meta 侧表（标准 5 / 裁决 10 候选 A）；表/行缺失 →
//   fallback 到 spaceKey（裁决 10）。
// - 条目字段 = 裁决 17 最小集（title/lastActiveAt/sessionRef + spaceKey 供选中），
//   飞书条目附加 displayName。各组内按 lastActiveAt 倒序（裁决 17）。
function listSessions(store) {
  const projectNames = loadProjectNameMap();
  const spaceMeta = loadSpaceMetaMap(store);
  const general = [];
  const projects = [];
  const feishu = [];
  for (const row of store.list()) {
    const item = {
      spaceKey: row.spaceKey,
      title: row.title ?? null,
      lastActiveAt: row.lastActiveAt,
      sessionRef: row.sessionRef,
    };
    if (row.spaceKey.startsWith("ui:copilot:")) {
      general.push(item);
    } else if (row.spaceKey.startsWith("ui:project:")) {
      const pid = row.spaceKey.slice("ui:project:".length).split(":", 1)[0];
      let group = projects.find((g) => g.projectId === pid);
      if (!group) {
        group = {
          projectId: pid,
          projectName: projectNames.get(pid) ?? null,
          orphan: !projectNames.has(pid),
          sessions: [],
        };
        projects.push(group);
      }
      group.sessions.push(item);
    } else if (row.spaceKey.startsWith("feishu:")) {
      item.displayName = spaceMeta.get(row.spaceKey) ?? row.spaceKey;
      feishu.push(item);
    }
  }
  const byActiveDesc = (a, b) => String(b.lastActiveAt).localeCompare(String(a.lastActiveAt));
  general.sort(byActiveDesc);
  for (const group of projects) group.sessions.sort(byActiveDesc);
  feishu.sort(byActiveDesc);
  return { general, projects, feishu };
}

// projects 表 join（REQ-AGENT-029 标准 1：项目名取 projects.name）。项目表与会话库
// 分属不同库（server.js 接线：会话库 = 配置目录 agent-sessions.db，项目表 = 应用库
// DB_PATH），JS 侧 map 归并。读失败（表缺失等）→ 空 map（全部按孤儿处理，不阻断列表）。
function loadProjectNameMap() {
  try {
    const rows = getDb().prepare("SELECT id, name FROM projects").all();
    return new Map(rows.map((r) => [r.id, r.name]));
  } catch {
    return new Map();
  }
}

// agent_space_meta 侧表 join（signoff 裁决 10 候选 A：飞书 chat 名）。经 store 读
// （侧表与会话同库 = 配置目录）；表缺失 → 空 map（fallback 由调用方兜底）。
function loadSpaceMetaMap(store) {
  const map = new Map();
  try {
    for (const row of store.listSpaceMeta()) map.set(row.spaceKey, row.displayName);
  } catch {
    return map;
  }
  return map;
}

// 新建会话（F4 新对话归属）：{ spaceKind: "general" } → ui:copilot:<sid>；
// { spaceKind: "project", projectId } → ui:project:<pid>:<sid>（projectId 必须在
// projects 表存在，否则 400 E-SESSION-CREATE 且不建行）。
function handleCreateSession(res, body, store) {
  const spaceKind = body?.spaceKind;
  if (spaceKind === "general") {
    return createUiRow(res, `ui:copilot:${randomUUID()}`, store);
  }
  if (spaceKind === "project") {
    const projectId = body?.projectId;
    if (typeof projectId !== "string" || projectId === "" || !projectExists(projectId)) {
      return sessionError(res, 400, "E-SESSION-CREATE", "项目不存在，无法创建项目会话");
    }
    return createUiRow(res, `ui:project:${projectId}:${randomUUID()}`, store);
  }
  return sessionError(res, 400, "E-SESSION-CREATE", "spaceKind 仅支持 general | project");
}

function projectExists(projectId) {
  try {
    return !!getDb().prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  } catch {
    return false;
  }
}

function createUiRow(res, spaceKey, store) {
  // 建 agent_sessions 行 + JSONL 占位落盘（REQ-AGENT-027 标准 1）。
  store.getOrCreate(spaceKey);
  return ok(res, { spaceKey });
}

// —— 会话级端点 ——

function handleGetMessages(req, res, spaceKey, store) {
  const row = store.get(spaceKey);
  if (!row) return sessionError(res, 404, "E-SESSION-NOT-FOUND", "会话不存在");
  const { limit, before } = parsePaginationQuery(req);
  const messages = paginateMessages(projectMessagesFromJsonl(row.sessionRef), { limit, before });
  return ok(res, { messages });
}

// 分页 query 解析（REQ-AGENT-029 标准 4）：limit 非法 → 默认 100；before 缺省/空 →
// 无游标。非法 query 串 → 默认值。
function parsePaginationQuery(req) {
  let limit = 100;
  let before;
  try {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const rawLimit = params.get("limit");
    if (rawLimit !== null) {
      const n = Number(rawLimit);
      if (Number.isInteger(n) && n > 0) limit = n;
    }
    before = params.get("before") ?? undefined;
  } catch {
    // 非法 query → 默认值。
  }
  return { limit, before };
}

// 发送消息（F1 核心处理最小形态）：202 { messageId }（事件即结果，流式回传属
// REQ-AGENT-028 SSE）；title 首条写入（slice(0,40) 无省略号，signoff 裁决 4；
// WHERE title IS NULL 原子条件 → 后续消息不更新）。错误映射（E-AGENT-CONFIG /
// E-SESSION-ORPHAN 等）随 REQ-AGENT-028 完整化。
async function handlePostMessage(res, spaceKey, body, store, getAgentService) {
  const text = typeof body?.text === "string" ? body.text : "";
  if (text.trim() === "") return validationError(res, "消息内容不能为空");
  if (text.length > MAX_MESSAGE_CHARS) return validationError(res, `消息长度超过上限（${MAX_MESSAGE_CHARS} 字符）`);
  const row = store.get(spaceKey);
  if (!row) return sessionError(res, 404, "E-SESSION-NOT-FOUND", "会话不存在");
  if (spaceKey.startsWith("feishu:")) {
    // 飞书空间 UI 只读（signoff 裁决 2 同原则：空间属性，先于 agent 配置检查）。
    return sessionError(res, 403, "E-SESSION-READONLY", "飞书会话只读，请到飞书继续对话");
  }

  const svc = typeof getAgentService === "function" ? await getAgentService() : null;
  if (!svc) return notFound(res);
  const config = buildSessionConfig();
  svc.createSession({
    spaceKey,
    provider: config.provider,
    apiKey: config.apiKey,
    identity: config.identity,
  });
  try {
    await svc.prompt(spaceKey, text);
  } catch {
    // 事件即结果：prompt 拒绝（子进程重启中等）不阻断 202 受理，错误经
    // session-error 事件回传（既有 restartingError 语义）。
  }
  // title 首条写入（写入时机允许异步——测试轮询至出现）。
  store.setTitleIfEmpty(spaceKey, text.slice(0, 40));
  return ok(res, { messageId: randomUUID() }, 202);
}

// UI 空间 /reset = 同分组新建会话并切换（F4）：新 spaceKey 新行 + JSONL 占位，
// 旧行保留（历史可读、可继续发送）。feishu:* → 403 E-SESSION-READONLY
// （signoff 裁决 9：世代制语义保留给飞书通道内部路径，HTTP 面不套用 UI 新行语义）。
function handleReset(res, spaceKey, store) {
  const row = store.get(spaceKey);
  if (!row) return sessionError(res, 404, "E-SESSION-NOT-FOUND", "会话不存在");
  if (spaceKey.startsWith("feishu:")) {
    return sessionError(res, 403, "E-SESSION-READONLY", "飞书会话只读，不支持 HTTP 重置");
  }
  const newKey = newUiSpaceKeyFor(spaceKey);
  if (!newKey) return sessionError(res, 400, "E-SESSION-CREATE", "不支持的空间 key");
  store.getOrCreate(newKey);
  return ok(res, { spaceKey: newKey });
}

// —— 会话配置（provider/key/identity，一次性注入语义，key 明文不落盘）——
function buildSessionConfig() {
  const agentCfg = settingsService.loadSettings()?.agent ?? {};
  const provider =
    typeof agentCfg.provider === "string" && agentCfg.provider !== "" ? agentCfg.provider : DEFAULT_PROVIDER;
  let apiKey;
  if (typeof agentCfg.apiKeyEncrypted === "string" && agentCfg.apiKeyEncrypted.length > 0) {
    try {
      apiKey = decryptSecret(agentCfg.apiKeyEncrypted);
    } catch {
      // 解密失败（后端不可用）→ 不注入，保持「未配置」语义（E-AGENT-CONFIG 引导随
      // REQ-AGENT-028 错误映射接线）。
      apiKey = undefined;
    }
  }
  return { provider, apiKey, identity: agentCfg.identity };
}

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function ok(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sessionError(res, status, code, message) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: code, message }));
}

// 参数类 400（signoff 裁决 12：空文本不强制错误码，避免与 E-SESSION-CREATE 语义混淆）。
function validationError(res, message) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "VALIDATION_ERROR", message }));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message: "Not found" }));
}
