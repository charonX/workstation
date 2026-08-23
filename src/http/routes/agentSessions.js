// src/http/routes/agentSessions.js
// UI Copilot 会话中心 — 会话 REST 端点（tech-design「接口契约」HTTP 会话端点表）。
//
// 空间 key 语法（ADR-016 / CONTEXT.md 对话空间）：ui:copilot:<sessionId>（通用空间）、
// ui:project:<projectId>:<sessionId>（项目空间）；feishu:<chatId> 与 feishu:<chatId>:gen<N>（飞书空间与归档）。
// ADR-030（story 2026-08-16-deepen-session-domain）：会话领域逻辑已收编 services/sessionDomain.js
// 与 services/sessionSseRegistry.js —— 本文件 = HTTP 转发层 + admission 编排。
//
// signoff 裁决：1（错误码 E-SESSION-CREATE/E-SESSION-NOT-FOUND/E-SESSION-READONLY）、
// 3（历史封套 { messages }，条目含 messageId/role/createdAt）、4（title slice(0,40)
// 无省略号）、5（分页：默认最新 limit 条、数组时间升序、before 游标 = messageId）、
// 9（feishu HTTP reset → 403）、10（feishu chat 名 seam = agent_space_meta 侧表，
// 表/行缺失 fallback 到 spaceKey）、11（SSE 事件契约：text_start/text_delta/text_end
// 子序列严格有序 + 拼接一致；允许辅助事件交错）、12（300KB 明确越界 → 400，精确
// 边界不额外断言）、16（孤儿组 projectName = null）、17（条目字段集
// title/lastActiveAt/sessionRef + spaceKey；组内 lastActiveAt 倒序）。
//
// ADR-030（story 2026-08-16-deepen-session-domain）：会话领域逻辑已收编
// services/sessionDomain.js（config 装配/投影分页/key 解析/附件规则/gitState）与
// services/sessionSseRegistry.js（SSE 订阅注册表 per-instance）——本文件 = HTTP
// 转发层 + admission 编排；仅 re-export projectMessagesFromJsonl 保既有测试导入面。

import { randomUUID } from "node:crypto";
import { getDb } from "../../db.js";
import * as settingsService from "../../services/settingsService.js";
import { AGENT_MODES } from "../../services/modeService.js";
import {
  attachmentsError,
  buildSessionConfig,
  gitStateForSpace,
  newUiSpaceKeyFor,
  normalizeLimit,
  paginateMessages,
  projectIdOf,
  projectMessagesFromJsonl,
  readTrajectoryRecords,
} from "../../services/sessionDomain.js";

// re-export 兼容面 1 名（REQ-AGENT-117 AC2 / ADR-030 决策 4）：historyToolFilter
// 既有测试动态 import 本模块直调此函数；其余领域导出名一律经 services 层取。
export { projectMessagesFromJsonl };

// 输入上限（signoff 裁决 12）：300KB 明确越界 → 400（sessionMessage.test.js 超限用例）。
// 单位与 enforceSizeLimit 统一为「字符」：agentService 按 JSON.stringify(event).length
// 与 MAX_IPC_BYTES=256*1024 比较（String.length 字符数，UTF-16 code units；既有回归
// agentDialogue「单条 IPC 消息 ≤ 256KB」同单位断言）。上限值 = 256KB 字符——PRD §7
// 「长度上限沿用 agentService 既有 enforceSizeLimit 限制」。精确边界由既有回归覆盖，
// 此处仅越界兜底。
const MAX_MESSAGE_CHARS = 256 * 1024;

// 附件规则（attachmentsError + IMAGE_MIME_TYPES/MAX_ATTACHMENTS/MAX_ATTACHMENT_BYTES）、
// 空间 key 解析（uiGroupPrefixFor/projectIdOf/newUiSpaceKeyFor + PROJECT_PREFIX_RE）、
// 历史投影/分页（projectMessagesFromJsonl/partText/normalizeLimit/paginateMessages）
// 已逐字节收编 services/sessionDomain.js（ADR-030 决策 1）——本文件经 import 消费。

// —— HTTP 分发（server.js resource="agent"、subPath[0]="sessions" 挂接）——

export async function handleAgentSessions(req, res, body, subPath = [], context = {}) {
  const { getSessionStore } = context;
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
    if (req.method === "POST") return handlePostMessage(res, spaceKey, body ?? {}, store, context);
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

  // 对话手动停止（REQ-AGENT-091，BUG-010）：POST stop → 202 受理。
  if (tail.length === 1 && tail[0] === "stop") {
    if (req.method === "POST") return handleStop(res, spaceKey, store, context);
    return notFound(res);
  }

  // 会话模式（REQ-AGENT-071/072，Slice 4）：GET → { mode }；PUT/POST { mode } → { mode }
  if (tail.length === 1 && tail[0] === "mode") {
    if (req.method === "GET") return handleGetMode(res, spaceKey, context);
    if (req.method === "PUT" || req.method === "POST") return handlePutMode(res, spaceKey, body ?? {}, context);
    return notFound(res);
  }

  // 会话级 provider（REQ-AGENT-093/095，ADR-026）：GET / PUT/POST
  if (tail.length === 1 && tail[0] === "provider") {
    if (req.method === "PUT" || req.method === "POST") return handlePutProvider(res, spaceKey, body ?? {}, store, context);
    if (req.method === "GET") return handleGetProvider(res, spaceKey, store, context);
    return notFound(res);
  }

  // 会话轨迹账本读取（REQ-AGENT-128 / PRD §10.4 接口 2）：GET trajectory
  if (tail.length === 1 && tail[0] === "trajectory") {
    if (req.method === "GET") return handleGetTrajectory(req, res, spaceKey, store);
    return notFound(res);
  }

  return notFound(res);
}

// —— 集合级端点 ——

// 分组会话列表（REQ-AGENT-029 / REQ-AGENT-125）：
// - general = ui:copilot:*；projects = ui:project:<pid>:*；feishu = feishu:*。
// - 项目组 join projects 表取名；pid 不存在 → orphan:true + projectName:null。
// - 飞书条目显示名取 agent_space_meta 侧表，归档条目 (:genN) 逆解析 chat 主键查 fallback。
// - 各组内按 lastActiveAt 倒序。
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
      const chatKey = row.spaceKey.replace(/:gen\d+$/, "");
      item.displayName = spaceMeta.get(chatKey) ?? spaceMeta.get(row.spaceKey) ?? row.spaceKey;
      feishu.push(item);
    }
  }
  // BUG-003：补全现存项目（无会话项目 → 空组）。组排序 = 有会话项目保持既有顺序
  // （首会话出现序）+ 无会话项目追加尾部（projects 表序）；孤儿组不在此列（projects
  // 表已无此 pid），由上面会话遍历产生。
  for (const [pid, name] of projectNames) {
    if (!projects.some((g) => g.projectId === pid)) {
      projects.push({ projectId: pid, projectName: name, orphan: false, sessions: [] });
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

function handleGetTrajectory(req, res, spaceKey, store) {
  const row = store.get(spaceKey);
  if (!row) return sendError(res, 404, "E-SESSION-NOT-FOUND", "会话不存在");
  const { limit, before } = parseTrajectoryPaginationQuery(req);
  const result = readTrajectoryRecords(row.sessionRef, { limit, before });
  return ok(res, result);
}

function parseTrajectoryPaginationQuery(req) {
  let limit;
  let before;
  try {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const rawLimit = params.get("limit");
    if (rawLimit !== null) {
      limit = Number(rawLimit);
    }
    before = params.get("before") ?? undefined;
  } catch {
    // 非法 query → 默认值。
  }
  return { limit, before };
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
// 条件 → 后续消息不更新；纯图片消息（无文本）回落首附件名）。错误映射
// （REQ-AGENT-028 标准 3 / signoff 裁决 1/2/12）：校验顺序 = 400（输入：附件
// E-ATTACH-* 先于文本——signoff 新契约点；文本空/超限）→ 404（会话不存在）→
// 403（只读空间属性，先于 409，裁决 2）→ 409（孤儿空间，空间属性先于 agent
// 配置）→ 409（agent 未配置）。
async function handlePostMessage(res, spaceKey, body, store, context) {
  // 附件（REQ-AGENT-097）：可选数组；存在时先于文本校验（纯图片消息允许空文本，
  // 附件错误码优先——imageAttachment.test.js 契约）。
  const attachments = Array.isArray(body?.attachments) && body.attachments.length > 0 ? body.attachments : undefined;
  const attachError = attachments ? attachmentsError(attachments) : undefined;
  if (attachError) return sendError(res, 400, attachError.code, attachError.message);
  const text = typeof body?.text === "string" ? body.text : "";
  const textError = messageTextError(text, !!attachments);
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
  const config = buildSessionConfig(spaceKey, store);
  if (!config.apiKey) {
    // agent 未配置 / 密钥失效（PRD §8 引导态）：409 E-AGENT-CONFIG，且不启动子进程
    // （ADR-009：配置校验前置）。
    return sendError(res, 409, "E-AGENT-CONFIG", "agent 未配置，请先在设置中配置模型与 API key");
  }
  const svc = await resolveAgentService(context?.getAgentService);
  if (!svc) return notFound(res);
  // fail-fast 前置（BUG-001）：接线缺失在建句柄之前抛——createSession 后抛 = 孤儿会话。
  const registry = sseRegistryOf(context);
  svc.createSession({
    spaceKey,
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    identity: config.identity,
  });
  // SSE 挂起订阅挂接（会话句柄此刻已存在；此前打开的 events 连接从本轮回流事件起收流）。
  // ADR-030：注册表 per-instance，经 context 袋 getSseRegistry 注入（prd §10.4）。
  registry.attachPending(spaceKey, svc);
  try {
    await svc.prompt(spaceKey, text, attachments);
  } catch {
    // 事件即结果：prompt 拒绝（子进程重启中等）不阻断 202 受理，错误经
    // session-error 事件回传（既有 restartingError 语义）。
  }
  // title 首条写入（写入时机允许异步——测试轮询至出现）；纯图片消息回落首附件名。
  store.setTitleIfEmpty(spaceKey, text.slice(0, 40) || attachments?.[0]?.name || "");
  return ok(res, { messageId: randomUUID() }, 202);
}

// 消息文本校验（signoff 裁决 12：空文本 400 不强制错误码）：空/超限 → 错误文案；
// 合法 → undefined。allowEmpty（附件消息）：纯图片消息允许空文本（REQ-AGENT-097）。
function messageTextError(text, allowEmpty = false) {
  if (!allowEmpty && text.trim() === "") return "消息内容不能为空";
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

// 对话手动停止（REQ-AGENT-091，BUG-010）：停止 = 幂等安全操作——store 无行 /
// 子进程未起 / 会话 idle 或已淘汰均 202 no-op（不报错、不因此启动子进程——
// peekAgentService 惰性纪律，与 events/mode 端点同型）。有活跃服务 → 发
// stop-session IPC（fire-and-forget，停止结果经 SSE 事件流自然收尾）。
function handleStop(res, spaceKey, store, context) {
  const row = store.get(spaceKey);
  if (!row) return ok(res, { stopped: false }, 202);
  const svc = peekAgentService(context);
  if (svc && typeof svc.stopSession === "function") {
    svc.stopSession(spaceKey);
  }
  return ok(res, { stopped: true }, 202);
}

// —— 会话模式端点（REQ-AGENT-071/072，Slice 4）——

// 模式读写服务解析（ADR-009 惰性纪律）：优先既有 agentService 实例（未创建 →
// null，不触发子进程启动——与 events 端点 peekAgentService 同型；有实例时经
// setSessionMode/getSessionMode 保证 mode-change IPC 下发 worker，生效于下一个
// 评估）；无实例 → 直接走模式服务单例（getModeService，server.js 注入）——
// 会话尚未创建时模式由 session-config 自然携带（buildConfigMessage 读
// modeService.getMode），等效。两者共用同一 modeService 单例，状态一致。
function resolveModeService(context) {
  const svc = peekAgentService(context);
  if (svc && typeof svc.getSessionMode === "function" && typeof svc.setSessionMode === "function") {
    return {
      getMode: (key) => svc.getSessionMode(key),
      setMode: (key, mode) => svc.setSessionMode(key, mode),
    };
  }
  const ms = typeof context?.getModeService === "function" ? context.getModeService() : null;
  return ms
    ? {
        getMode: (key) => ms.getMode(key),
        // modeService.setMode 无返回值 → 归一化回读（与 agentService.setSessionMode
        // 返回 getMode 的形态一致，PUT 响应恒携带生效值）。
        setMode: (key, mode) => ms.setMode(key, mode) ?? ms.getMode(key),
      }
    : null;
}

function handleGetMode(res, spaceKey, context) {
  const svc = resolveModeService(context);
  if (!svc) return notFound(res);
  return ok(res, { mode: svc.getMode(spaceKey) });
}

function handlePutMode(res, spaceKey, body, context) {
  if (spaceKey.startsWith("feishu:")) {
    return sendError(res, 403, "E-SESSION-READONLY", "飞书会话只读，不支持修改模式");
  }
  const mode = body?.mode;
  if (!AGENT_MODES.includes(mode)) {
    return sendError(res, 400, "E-MODE-INVALID", `非法模式 ${mode}（合法值：${AGENT_MODES.join("/")}）`);
  }
  const svc = resolveModeService(context);
  if (!svc) return notFound(res);
  return ok(res, { mode: svc.setMode(spaceKey, mode) });
}

// —— 会话级 provider 端点（REQ-AGENT-093/095，Slice 2，ADR-026）——

// 同步窥探既有 agentService 实例（未创建 → null，不触发子进程启动——ADR-009 惰性
// 纪律；events/mode/provider 端点同型，四处共用同一取法）。
function peekAgentService(context) {
  return typeof context?.peekAgentService === "function" ? context.peekAgentService() : null;
}

// 会话行取位（SQLite 为真相）：行不存在 → 404 E-SESSION-NOT-FOUND 并返回 null 短路
//（调用方 `if (!row) return;`）。
function getSessionRowOrError(res, store, spaceKey) {
  const row = store.get(spaceKey);
  if (!row) {
    sendError(res, 404, "E-SESSION-NOT-FOUND", "会话不存在");
    return null;
  }
  return row;
}

// 会话 provider 回读（GET /api/agent/sessions/:spaceKey/provider）：
// 行值优先（行带 provider/model → 用行值）；NULL → 默认组合；条目已删/模型不在
// 条目 → 回落默认（E12，不悬空）。无会话行 → 404 E-SESSION-NOT-FOUND。
// 服务实例存在 → 经 getSessionProvider（与 worker 状态同源）；未启动（ADR-009
// 惰性：GET 不触发子进程启动）→ 直连 settings + store 解析（同一单点
// settingsService.resolveSessionModelConfig，无行为差异）。
function handleGetProvider(res, spaceKey, store, context) {
  const row = getSessionRowOrError(res, store, spaceKey);
  if (!row) return;
  const svc = peekAgentService(context);
  if (svc && typeof svc.getSessionProvider === "function") {
    try {
      return ok(res, svc.getSessionProvider(spaceKey));
    } catch (err) {
      return mapProviderError(res, err);
    }
  }
  const resolved = settingsService.resolveSessionModelConfig(row.provider, row.model);
  return ok(res, { provider: resolved.provider, model: resolved.model });
}

// 会话 provider 切换（PUT /api/agent/sessions/:spaceKey/provider {provider, model}）：
// 校验组合 ∈ 已配置条目（400 E-MODEL-CONFIG-MISSING）→ 条目 key 解密（400
// E-MODEL-KEY-FAIL）→ 回写 agent_sessions 行（SQLite 为真相）→ 活跃会话
// provider-change IPC（下一条 prompt 生效；sessionRef 不换代——ADR-026）。幂等：
// 同组合重复 PUT 无副作用。服务实例存在 → 经 setSessionProvider（含 IPC）；未启动
// → 直连 settings + store（校验/行回写，不触发子进程启动；懒恢复/水合按行装配）。
function handlePutProvider(res, spaceKey, body, store, context) {
  if (spaceKey.startsWith("feishu:")) {
    return sendError(res, 403, "E-SESSION-READONLY", "飞书会话只读，不支持修改模型配置");
  }
  const row = getSessionRowOrError(res, store, spaceKey);
  if (!row) return;
  const { provider, model } = body ?? {};
  if (typeof provider !== "string" || provider === "" || typeof model !== "string" || model === "") {
    return sendError(res, 400, "E-MODEL-CONFIG-MISSING", "组合不在已配置条目");
  }
  const svc = peekAgentService(context);
  if (svc && typeof svc.setSessionProvider === "function") {
    try {
      return ok(res, svc.setSessionProvider(spaceKey, { provider, model }));
    } catch (err) {
      return mapProviderError(res, err);
    }
  }
  const resolved = settingsService.resolveSessionModelConfig(provider, model);
  if (resolved.provider !== provider || resolved.model !== model || !resolved.entry) {
    return sendError(res, 400, "E-MODEL-CONFIG-MISSING", "组合不在已配置条目");
  }
  if (settingsService.entryApiKey(resolved.entry) === undefined) {
    return sendError(res, 400, "E-MODEL-KEY-FAIL", "条目 key 不可用（解密失败）");
  }
  if (row.provider !== provider || row.model !== model) {
    store.updateProviderConfig(spaceKey, provider, model);
  }
  return ok(res, { provider, model });
}

// 会话级 provider 端点错误映射：契约错误码透传（400/404），其余抛给上层（500）。
function mapProviderError(res, err) {
  if (err?.code === "E-MODEL-CONFIG-MISSING" || err?.code === "E-MODEL-KEY-FAIL") {
    return sendError(res, 400, err.code, err.message);
  }
  if (err?.code === "E-SESSION-NOT-FOUND") {
    return sendError(res, 404, err.code, err.message);
  }
  throw err;
}

// —— 全局 lastMode（BUG-001 裁决 A：无会话切模式 = 改全局默认）——
// PUT /api/agent/mode/last { mode } → { mode }（server.js resource="agent"、
// subPath[0]="mode" 挂接）：renderer 无会话（selectedKey 为 null）时切换不再
// 静默丢弃——落盘 settings agent.lastMode（modeService.setLastMode），后续新建
// 会话取位 = 新 lastMode（REQ-AGENT-072 标准 2）。无会话即「模式 = 全局默认」态，
// 无 worker 会话可下发 → 只走模式服务单例（getModeService，与与会话级
// resolveModeService 的单例兜底分支共用同一实例，状态一致）；非法值 → 400
// E-MODE-INVALID（与会话级 PUT mode 同契约）。
export function handleAgentLastMode(req, res, body, context = {}) {
  const ms = typeof context?.getModeService === "function" ? context.getModeService() : null;
  if (!ms || typeof ms.setLastMode !== "function" || typeof ms.getLastMode !== "function") {
    return notFound(res);
  }
  if (req.method === "PUT") {
    const mode = body?.mode;
    if (!AGENT_MODES.includes(mode)) {
      return sendError(res, 400, "E-MODE-INVALID", `非法模式 ${mode}（合法值：${AGENT_MODES.join("/")}）`);
    }
    ms.setLastMode(mode);
    return ok(res, { mode: ms.getLastMode() });
  }
  return notFound(res);
}

// —— SSE 事件流（GET .../events，REQ-AGENT-028 标准 2/5/6，D4 流式 = SSE）——

// SSE 注册表取位（ADR-030 §10.4 context 袋契约）：server.js 注入（_opcSseRegistryFactory
// 惰性工厂同型）；未接线 → fail-fast 抛错（生产 server 恒提供，此分支仅在
// 测试/headless 自建 context 时可达）。BUG-001：守卫校验 getter 返回值形状——工厂
// 未赋值时 getter 返回 undefined，只查 typeof 会放行 → 调用方裸 TypeError。
function sseRegistryOf(context) {
  const registry = typeof context?.getSseRegistry === "function" ? context.getSseRegistry() : undefined;
  if (!registry || typeof registry.createSubscription !== "function") throw new Error("getSseRegistry 未接线");
  return registry;
}

// GET .../events → SSE 流（text/event-stream；Node 原生 http：writeHead +
// flushHeaders 首包即达 + write 逐帧推送）。admission 编排留路由（ADR-030 决策 4）：
// 404 检查 → writeHead/flushHeaders → registry.createSubscription → session-git 首帧
// 补推（Slice 8 REQ-AGENT-058：SSE 只推增量不回溯，连接建立即达，不依赖 worker 存活）
// → registerPending + attachPending 组合塌缩「有句柄直接挂接 / 无句柄挂起登记」两分支
//（有句柄 → attachPending 即挂接并清挂起集；无句柄 → no-op，留挂起集等首条消息建句柄
// 后补挂接——ADR-030 授权的本 story 唯一结构性改写点）。peekAgentService 同步窥探，
// 不触发惰性启动（ADR-009：打开 events 连接不启动 agent 子进程）；会话不存在 → 404。
// 订阅生命周期（事件转发/轮次边界 text_start 宣告/15s 心跳/confirmation-pending 过滤/
// 断开清理）逐字节收编于 services/sessionSseRegistry.js（端点契约见该模块头注释）。
function handleGetEvents(res, spaceKey, store, context) {
  const row = store.get(spaceKey);
  if (!row) return sendError(res, 404, "E-SESSION-NOT-FOUND", "会话不存在");

  // fail-fast 前置（BUG-001）：接线缺失在写 SSE 头之前抛——头已提交后抛 = 挂死连接。
  const registry = sseRegistryOf(context);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders(); // 首包立即送达（fetch 依赖头部先到达才 resolve）

  const sub = registry.createSubscription(res, spaceKey);

  // session-git 首帧补推（REQ-AGENT-058；幂等：与 agentService createSession 推送同源同形）。
  sub.pushFrame({ type: "session-git", ...gitStateForSpace(spaceKey) });

  // 挂起登记 + 既有句柄补挂接（重连/续流场景：会话已存在 → attachPending 即挂接，
  // 事件不丢；否则留挂起集等首条消息建句柄）。
  registry.registerPending(spaceKey, sub);
  registry.attachPending(spaceKey, peekAgentService(context));
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
