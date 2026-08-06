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
// Slice 3（REQ-AGENT-028 消息发送 + SSE 流式）端点：
//   POST /api/agent/sessions/:spaceKey/messages 完整错误映射：trim 空 / 超上限 → 400
//                                                     （上限 = enforceSizeLimit 同单位 256KB 字符）；
//                                                     不存在 → 404 E-SESSION-NOT-FOUND；
//                                                     feishu:* → 403 E-SESSION-READONLY（先于 409，
//                                                     裁决 2：只读是空间属性）；孤儿项目空间 →
//                                                     409 E-SESSION-ORPHAN（空间属性先于 agent
//                                                     配置）；agent 未配置 → 409 E-AGENT-CONFIG
//   GET  /api/agent/sessions/:spaceKey/events         → SSE 流（text/event-stream）：会话句柄
//                                                     session-event 原样转发（≤256KB 契约由
//                                                     agentService 源头截断保证）+ 轮次边界
//                                                     text_start 宣告（imRouter stream_start 同型
//                                                     先例：worker 未映射 PI turn_start/turn_end，
//                                                     边界由路由层宣告）+ 15s 心跳注释帧（裁决 11
//                                                     允许辅助事件交错）；断线不崩、重连可再建；
//                                                     confirmation-pending 事件类型由 Slice 4 产生，
//                                                     本切片接通「事件流经 SSE 转发」通道
// Slice 4（REQ-AGENT-030 内联确认卡桥）端点增补：
//   GET  .../events 订阅 eventBus `confirmation-pending`（confirmationService 按空间
//                                                    前缀分流发布：ui:* 空间新建挂起行 → 发布；
//                                                    飞书空间不走此通道）→ 按本连接 spaceKey
//                                                    过滤转发为 SSE confirmation-pending 帧
//                                                    （字段 = 裁决 11：confirmId/operation/
//                                                    description；不依赖特定入队路径——直桥
//                                                    submit 与 worker confirm-request 同构发布）。
//
// 空间 key 语法（ADR-016 / CONTEXT.md 对话空间）：ui:copilot:<sessionId>（通用空间）、
// ui:project:<projectId>:<sessionId>（项目空间）；feishu:<chatId> 世代制沿用（不套用
// UI 新行语义——世代留给飞书空间与 provider/key 变更重建）。
//
// signoff 裁决：1（错误码 E-SESSION-CREATE/E-SESSION-NOT-FOUND/E-SESSION-READONLY）、
// 3（历史封套 { messages }，条目含 messageId/role/createdAt）、4（title slice(0,40)
// 无省略号）、5（分页：默认最新 limit 条、数组时间升序、before 游标 = messageId）、
// 9（feishu HTTP reset → 403）、10（feishu chat 名 seam = agent_space_meta 侧表，
// 表/行缺失 fallback 到 spaceKey）、11（SSE 事件契约：text_start/text_delta/text_end
// 子序列严格有序 + 拼接一致；允许辅助事件交错）、12（300KB 明确越界 → 400，精确
// 边界不额外断言）、16（孤儿组 projectName = null）、17（条目字段集
// title/lastActiveAt/sessionRef + spaceKey；组内 lastActiveAt 倒序）。

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { getDb } from "../../db.js";
import * as settingsService from "../../services/settingsService.js";
import { decryptSecret } from "../../services/secretStore.js";
import { subscribe } from "../../services/eventBus.js";

const DEFAULT_PROVIDER = "deepseek";

// 输入上限（signoff 裁决 12）：300KB 明确越界 → 400（sessionMessage.test.js 超限用例）。
// 单位与 enforceSizeLimit 统一为「字符」：agentService 按 JSON.stringify(event).length
// 与 MAX_IPC_BYTES=256*1024 比较（String.length 字符数，UTF-16 code units；既有回归
// agentDialogue「单条 IPC 消息 ≤ 256KB」同单位断言）。上限值 = 256KB 字符——PRD §7
// 「长度上限沿用 agentService 既有 enforceSizeLimit 限制」。精确边界由既有回归覆盖，
// 此处仅越界兜底。
const MAX_MESSAGE_CHARS = 256 * 1024;

// —— 空间 key 纯函数（ADR-016 语法；Slice 2 分组列表复用）——
// ui:project:<pid>:<sid> 的前缀/pid 解析共用同一模式（ui:copilot 无 pid 段）。
const PROJECT_PREFIX_RE = /^ui:project:([^:]+):/;

// 从既有 ui:* 空间 key 解析分组前缀：ui:copilot:* → "ui:copilot:"；
// ui:project:<pid>:* → "ui:project:<pid>:"；非 ui 空间 → undefined。
export function uiGroupPrefixFor(spaceKey) {
  const key = String(spaceKey ?? "");
  if (key.startsWith("ui:copilot:")) return "ui:copilot:";
  const m = PROJECT_PREFIX_RE.exec(key);
  return m ? m[0] : undefined;
}

// ui:project:<pid>:<sid> → <pid>；其他空间 key → undefined。
function projectIdOf(spaceKey) {
  const m = PROJECT_PREFIX_RE.exec(String(spaceKey ?? ""));
  return m ? m[1] : undefined;
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
      text = content.map(partText).join("");
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

// 文本段归一化：纯字符串原样；{ type:"text", text } 取 text；其余 → ""。
function partText(part) {
  if (typeof part === "string") return part;
  return typeof part?.text === "string" ? part.text : "";
}

// limit 归一化（signoff 裁决 5）：0/负数/NaN/非整数 → 默认 100。
function normalizeLimit(limit) {
  return Number.isInteger(limit) && limit > 0 ? limit : 100;
}

// 历史分页窗口（REQ-AGENT-029 标准 4 / signoff 裁决 5）：默认取最新 limit 条、
// 数组时间升序返回（JSONL 顺序即时间序，调用方保证）；before 游标 = messageId，
// 返回严格早于游标的窗口；游标不在数组中 → 视为无游标（最新窗口）；limit 非法
// （0/负数/NaN/非数字）→ 默认 100。
export function paginateMessages(messages, { limit = 100, before } = {}) {
  const size = normalizeLimit(limit);
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

  if (tail.length === 1 && tail[0] === "events") {
    if (req.method === "GET") return handleGetEvents(res, spaceKey, store, context);
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
      const pid = projectIdOf(row.spaceKey);
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
      return sendError(res, 400, "E-SESSION-CREATE", "项目不存在，无法创建项目会话");
    }
    return createUiRow(res, `ui:project:${projectId}:${randomUUID()}`, store);
  }
  return sendError(res, 400, "E-SESSION-CREATE", "spaceKind 仅支持 general | project");
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
  if (!row) return sendError(res, 404, "E-SESSION-NOT-FOUND", "会话不存在");
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
      limit = normalizeLimit(Number(rawLimit));
    }
    before = params.get("before") ?? undefined;
  } catch {
    // 非法 query → 默认值。
  }
  return { limit, before };
}

// 孤儿空间判定（REQ-AGENT-028 标准 3 / CONTEXT.md 孤儿会话 / PRD §7.1「项目被删除后其会话
// 保留可回看（孤儿会话），但不可发送新消息」）：ui:project:<pid>:* 且 pid 在 projects 表
// 不存在 → 孤儿。通用/飞书空间不适用（projectIdOf 解析不到 pid → false）。
function isOrphanSpace(spaceKey) {
  const pid = projectIdOf(spaceKey);
  return pid !== undefined && !projectExists(pid);
}

// 发送消息（F1 核心处理）：202 { messageId }（事件即结果，流式回传经 SSE，F2）；
// title 首条写入（slice(0,40) 无省略号，signoff 裁决 4；WHERE title IS NULL 原子
// 条件 → 后续消息不更新）。错误映射（REQ-AGENT-028 标准 3 / signoff 裁决 1/2/12）：
// 校验顺序 = 400（输入）→ 404（会话不存在）→ 403（只读空间属性，先于 409，裁决 2）
// → 409（孤儿空间，空间属性先于 agent 配置）→ 409（agent 未配置）。
async function handlePostMessage(res, spaceKey, body, store, getAgentService) {
  const text = typeof body?.text === "string" ? body.text : "";
  const textError = messageTextError(text);
  if (textError) return validationError(res, textError);
  const row = store.get(spaceKey);
  if (!row) return sendError(res, 404, "E-SESSION-NOT-FOUND", "会话不存在");
  if (spaceKey.startsWith("feishu:")) {
    // 飞书空间 UI 只读（signoff 裁决 2：只读是空间属性，与 agent 配置无关 → 先于 409）。
    return sendError(res, 403, "E-SESSION-READONLY", "飞书会话只读，请到飞书继续对话");
  }
  if (isOrphanSpace(spaceKey)) {
    // 孤儿空间：项目已删除，历史可回看但禁止发送新消息（CONTEXT.md 孤儿会话）。
    return sendError(res, 409, "E-SESSION-ORPHAN", "项目已删除，该会话不可发送新消息");
  }
  const config = buildSessionConfig();
  if (!config.apiKey) {
    // agent 未配置 / 密钥失效（PRD §8 引导态）：409 E-AGENT-CONFIG，且不启动子进程
    // （ADR-009：配置校验前置）。
    return sendError(res, 409, "E-AGENT-CONFIG", "agent 未配置，请先在设置中配置模型与 API key");
  }
  const svc = await resolveAgentService(getAgentService);
  if (!svc) return notFound(res);
  svc.createSession({
    spaceKey,
    provider: config.provider,
    apiKey: config.apiKey,
    identity: config.identity,
  });
  // SSE 挂起订阅挂接（会话句柄此刻已存在；此前打开的 events 连接从本轮回流事件起收流）。
  attachPendingSseSubs(spaceKey, svc);
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

// 消息文本校验（signoff 裁决 12：空文本 400 不强制错误码）：空/超限 → 错误文案；
// 合法 → undefined。
function messageTextError(text) {
  if (text.trim() === "") return "消息内容不能为空";
  if (text.length > MAX_MESSAGE_CHARS) return `消息长度超过上限（${MAX_MESSAGE_CHARS} 字符）`;
  return undefined;
}

// 惰性解析 agentService（server.js 工厂，首个消息请求才启动）；未接线 → null
// （404 与未实现端点同语义）。
async function resolveAgentService(getAgentService) {
  return typeof getAgentService === "function" ? getAgentService() : null;
}

// UI 空间 /reset = 同分组新建会话并切换（F4）：新 spaceKey 新行 + JSONL 占位，
// 旧行保留（历史可读、可继续发送）。feishu:* → 403 E-SESSION-READONLY
// （signoff 裁决 9：世代制语义保留给飞书通道内部路径，HTTP 面不套用 UI 新行语义）。
function handleReset(res, spaceKey, store) {
  const row = store.get(spaceKey);
  if (!row) return sendError(res, 404, "E-SESSION-NOT-FOUND", "会话不存在");
  if (spaceKey.startsWith("feishu:")) {
    return sendError(res, 403, "E-SESSION-READONLY", "飞书会话只读，不支持 HTTP 重置");
  }
  const newKey = newUiSpaceKeyFor(spaceKey);
  if (!newKey) return sendError(res, 400, "E-SESSION-CREATE", "不支持的空间 key");
  store.getOrCreate(newKey);
  return ok(res, { spaceKey: newKey });
}

// —— SSE 事件流（GET .../events，REQ-AGENT-028 标准 2/5/6，D4 流式 = SSE）——

// 挂起订阅注册表：spaceKey → Set<sub>。events 连接先于首条消息打开时，agentService
// 会话句柄尚不存在（句柄由 handlePostMessage 的 createSession 创建）——先挂起，
// 句柄创建后经 attachPendingSseSubs 补挂接。sub.detach 时自行从注册表移除。
const pendingSseSubs = new Map();

// 会话句柄创建后挂接挂起订阅（handlePostMessage 在 createSession 之后调用）：
// 事件从下一轮起持续收流（SSE 只推增量、不做事件回溯，F2）。spaceKey 无挂起
// 订阅时为 no-op（常态路径）。导出供 server.js 接线复用（确认回调建句柄后
// 同型挂接——assistantConfirm「稍后处理」场景的流式回投）。
export function attachPendingSseSubs(spaceKey, svc) {
  const subs = pendingSseSubs.get(spaceKey);
  if (!subs || subs.size === 0) return;
  const session = peekSession(svc, spaceKey);
  if (!session) return;
  for (const sub of subs) sub.attach(session); // attach 不增删本集合 → 直接迭代
  pendingSseSubs.delete(spaceKey);
}

// 会话句柄窥探（挂起订阅挂接 / events 既有句柄直接挂接共用）：服务未接线或句柄
// 未创建 → null。getSession 为同步返回既有句柄，不触发惰性创建（ADR-009：打开
// events 连接不启动 agent 子进程）。
function peekSession(svc, spaceKey) {
  return svc?.getSession ? svc.getSession(spaceKey) : null;
}

// GET .../events → SSE 流（text/event-stream；实现用 Node 原生 http：
// writeHead + flushHeaders 首包即达 + write 逐帧推送）：
// - 事件 = 会话句柄 "session-event" 原样转发（不增删字段；≤256KB 截断契约由
//   agentService 源头 enforceSizeLimit 保证，本层不二次截断——confirmation-pending
//   等非文本事件无 content/delta 载体，二次截断会丢字段）；
// - 轮次边界 text_start 由本层宣告（imRouter stream_start 同型先例：worker 未映射
//   PI turn_start/turn_end，边界由触发层宣告）：每轮首个文本事件（text_delta /
//   text_end）前补发 text_start，text_end 后重置——UI 渲染层据此开新气泡；
// - 心跳 = 15s 注释帧（": keep-alive"，裁决 11 允许辅助事件交错；测试客户端解析
//   跳过空 data 帧）；
// - 客户端断开（res close/error）→ 摘除监听 + 清心跳，服务不崩；重连可再建
//   （REQ-AGENT-028 标准 5 端点侧语义）；会话不存在 → 404（tech-design 契约表）。
function handleGetEvents(res, spaceKey, store, context) {
  const row = store.get(spaceKey);
  if (!row) return sendError(res, 404, "E-SESSION-NOT-FOUND", "会话不存在");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders(); // 首包立即送达（fetch 依赖头部先到达才 resolve）

  const sub = createSseSubscription(res, spaceKey);

  // 既有句柄直接挂接（重连/续流场景：会话已存在，事件不丢）；否则挂起等待
  // 首条消息创建句柄。peekAgentService 同步窥探（未创建 → null），不触发惰性
  // 启动（ADR-009：打开 events 连接不启动 agent 子进程）。
  const svc = typeof context?.peekAgentService === "function" ? context.peekAgentService() : null;
  const existing = peekSession(svc, spaceKey);
  if (existing) {
    sub.attach(existing);
  } else {
    let subs = pendingSseSubs.get(spaceKey);
    if (!subs) {
      subs = new Set();
      pendingSseSubs.set(spaceKey, subs);
    }
    subs.add(sub);
  }
}

// SSE 订阅构造（挂起/挂接两用）：连接状态 + 事件转发 + 轮次边界宣告 + 心跳 +
// 断开清理收敛一处；对调用方仅暴露 attach/detach 两个动作。行为语义见
// handleGetEvents 头注释（端点契约）。
function createSseSubscription(res, spaceKey) {
  const HEARTBEAT_MS = 15 * 1000;
  let session = null;
  let attached = false;
  let detached = false;
  let textStarted = false; // 当前轮次是否已宣告 text_start（text_end 后重置）
  let heartbeat = null;

  const writeFrame = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      sub.detach(); // 写失败（连接已死）→ 摘除，服务不崩
    }
  };

  // Slice 4（REQ-AGENT-030）：confirmation-pending 事件通道——confirmationService
  // 对 ui:* 空间新建挂起行发布（eventBus，按空间前缀分流），本连接按 spaceKey
  // 过滤转发（字段 = 裁决 11：confirmId/operation/description；sessionKey 仅订阅
  // 侧过滤用，不出现在事件帧）。与 handle 事件互不干扰（confirmation-pending
  // 非文本事件，不参与轮次边界宣告）；SSE 只推增量（事件发布时连接不在 → 丢失，
  // 渲染层以 GET /api/agent/confirmations 全量对齐——F3「卡片留历史」数据源）。
  const unsubscribePending = subscribe("confirmation-pending", (payload) => {
    if (detached || !payload || payload.sessionKey !== spaceKey) return;
    const { sessionKey: _sessionKey, ...pending } = payload;
    writeFrame({ type: "confirmation-pending", ...pending });
  });

  const onEvent = (ev) => {
    if (detached || !ev || typeof ev.type !== "string") return;
    if (ev.type === "text_start") {
      textStarted = true;
    } else if (!textStarted && (ev.type === "text_delta" || ev.type === "text_end")) {
      // 轮次边界宣告：首个文本事件前补发 text_start（裁决 11 子序列头）。
      textStarted = true;
      writeFrame({ type: "text_start" });
    }
    if (ev.type === "text_end") textStarted = false; // 轮次结束，下一轮重新宣告
    writeFrame(ev);
  };

  const sub = {
    attach(s) {
      if (detached) return;
      session = s;
      attached = true;
      session.on("session-event", onEvent);
    },
    detach() {
      if (detached) return;
      detached = true;
      unsubscribePending(); // 摘除 confirmation-pending 订阅（eventBus 回调先查 detached，幂等）
      if (heartbeat) clearInterval(heartbeat);
      if (attached && session) session.off("session-event", onEvent);
      const subs = pendingSseSubs.get(spaceKey);
      if (subs) {
        subs.delete(sub);
        if (subs.size === 0) pendingSseSubs.delete(spaceKey);
      }
      try {
        res.end();
      } catch {
        // 响应已结束/已销毁：忽略。
      }
    },
  };

  res.on("close", () => sub.detach());
  res.on("error", () => sub.detach());
  heartbeat = setInterval(() => {
    if (detached) return;
    try {
      res.write(": keep-alive\n\n");
    } catch {
      sub.detach();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.(); // 心跳不阻塞进程退出（node --test 生命周期）

  return sub;
}

// —— 会话配置（provider/key/identity，一次性注入语义，key 明文不落盘）——
// 导出供 server.js 接线复用（确认回调回投时会话句柄缺失需按空间建句柄——
// 与 handlePostMessage 同源构建，避免双源漂移）。
export function buildSessionConfig() {
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

// —— JSON 响应（唯一写点：writeHead + end；错误封套 { error, message } 单一构造处）——
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: code, message });
}

function ok(res, data, status = 200) {
  sendJson(res, status, data);
}

// 参数类 400（signoff 裁决 12：空文本不强制错误码，避免与 E-SESSION-CREATE 语义混淆）。
function validationError(res, message) {
  sendError(res, 400, "VALIDATION_ERROR", message);
}

function notFound(res) {
  sendError(res, 404, "NOT_FOUND", "Not found");
}
