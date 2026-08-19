// src/services/sessionDomain.js
// 会话领域函数域（ADR-030 / story 2026-08-16-deepen-session-domain 稳定块 1/2/3/5）：
// 从 src/http/routes/agentSessions.js 逐字节剪切收编的纯领域函数——无内部可变状态、
// 不持有连接；含只读 I/O（读 JSONL/DB/settings）。收编面：
//   - config 装配：buildSessionConfig + DEFAULT_PROVIDER（REQ-AGENT-112）；
//   - 空间 key 解析：uiGroupPrefixFor/projectIdOf/newUiSpaceKeyFor + PROJECT_PREFIX_RE
//     （REQ-AGENT-114，ADR-016 语法）；
//   - 历史投影/分页：projectMessagesFromJsonl/partText/normalizeLimit/paginateMessages
//     （REQ-AGENT-113）；
//   - 附件规则：attachmentsError + IMAGE_MIME_TYPES/MAX_ATTACHMENTS/MAX_ATTACHMENT_BYTES
//     （REQ-AGENT-116）；
//   - 会话元数据投影：gitStateForSpace（REQ-AGENT-114 AC4，与 key 解析同源）。
// 签名与语义逐字节保持（prd.md §6.3 锚点为 golden values）；Slice 3 路由瘦身时路由
// 内旧副本删除，本模块成为唯一属主。

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import * as settingsService from "./settingsService.js";
import { readGitBranch } from "./gitBranch.js";
import { expandTilde, realpathBestEffort } from "./pathUtils.js";

const DEFAULT_PROVIDER = "deepseek";

// 图片附件（REQ-AGENT-097 / PRD B6、§10.4 接口 4）：POST messages 扩展
// {text, attachments:[{name, size, mimeType, kind:"image", path}]}（≤10）。
// 白名单 = PRD §7（jpeg/png/gif/webp/bmp/heic/heif，SVG 拒收）；单图 ≤10MB
// （API 硬边界，§7 E10）；path 存在性路由层校验（§10.4 接口 4；worker 侧读取
// 失败——存在但不可读（权限/TCC）——另有 E8 attachment-error 事件，见 worker）。
// 字节零转发：路由层只校验元数据，不读文件内容（字节不出 worker，§10.1）。
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/heic",
  "image/heif",
]);
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// 附件校验（signoff 新契约点 E-ATTACH-TYPE/COUNT/SIZE/PATH；校验顺序 = 类型白名单
// → 数量 → 大小 → path 存在性——四步按序短路，first-fail 语义）。合法 →
// undefined；非法 → { code, message }。
export function attachmentsError(attachments) {
  if (attachments.some((att) => typeof att?.mimeType !== "string" || !IMAGE_MIME_TYPES.has(att.mimeType))) {
    return { code: "E-ATTACH-TYPE", message: "仅支持图片（jpeg/png/gif/webp/bmp/heic/heif）" };
  }
  if (attachments.length > MAX_ATTACHMENTS) {
    return { code: "E-ATTACH-COUNT", message: `每条消息最多附加 ${MAX_ATTACHMENTS} 个文件` };
  }
  if (attachments.some((att) => typeof att?.size !== "number" || att.size > MAX_ATTACHMENT_BYTES)) {
    return { code: "E-ATTACH-SIZE", message: "图片过大（单图 ≤10MB）" };
  }
  if (attachments.some((att) => typeof att?.path !== "string" || !fs.existsSync(att.path))) {
    return { code: "E-ATTACH-PATH", message: "文件不存在" };
  }
  return undefined;
}

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
export function projectIdOf(spaceKey) {
  const m = PROJECT_PREFIX_RE.exec(String(spaceKey ?? ""));
  return m ? m[1] : undefined;
}

// UI 空间 reset 新 key：同分组前缀 + 新 sessionId（F4：不触发世代机制）。
export function newUiSpaceKeyFor(spaceKey) {
  const prefix = uiGroupPrefixFor(spaceKey);
  return prefix ? `${prefix}${randomUUID()}` : undefined;
}

// 飞书归档键判定（ADR-037 / BUG-001）：feishu:<chatId>:gen<N> 归档行只读——
// 不参与重启水合/会话装配（getOrCreate 会刷新 lastActiveAt、缺文件时改写
// sessionRef 毁历史指针）；列表展示与消息回看不经此判定（归档条目照常可见）。
const FEISHU_ARCHIVE_KEY_RE = /^feishu:.+:gen\d+$/;
export function isFeishuArchiveKey(spaceKey) {
  return FEISHU_ARCHIVE_KEY_RE.test(String(spaceKey ?? ""));
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
    // BUG-009：工具不落历史（REQ-AGENT-054 / PRD B8「工具块仅实时呈现不落历史」）。
    // 修复前：role:"toolResult" 行原样投影 → 原始工具输出以纯文本气泡漏进历史
    // （生产实锤 2026-08-10：重开会话后 bash ls 输出/project_list JSON 裸露）；
    // 只含 thinking/toolCall（无 text 段）的 assistant 行投影为空文本气泡。
    // 历史 = 对话文本：只投影 user/assistant，且空文本行（纯工具调用载体）剔除。
    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = entry.message.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content.map(partText).join("");
    }
    if (text.trim() === "") continue;
    messages.push({
      messageId: String(entry.id ?? ""),
      role,
      createdAt: typeof entry.timestamp === "string" ? entry.timestamp : "",
      text,
    });
  }
  return messages;
}

// 文本段归一化：纯字符串原样；{ type:"text", text } 取 text；image 块 → 附件名
// 标记（REQ-AGENT-097：历史投影含附件名，如 [图片: tiny.png]——base64 数据不投影）；
// 其余 → ""。
export function partText(part) {
  if (typeof part === "string") return part;
  if (typeof part?.text === "string") return part.text;
  if (part?.type === "image") {
    return typeof part?.name === "string" && part.name !== "" ? `[图片: ${part.name}]` : "[图片]";
  }
  return "";
}

// limit 归一化（signoff 裁决 5）：0/负数/NaN/非整数 → 默认 100。
export function normalizeLimit(limit) {
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

// Slice 8（REQ-AGENT-056/058）：会话 git 分支状态（主进程读取——项目目录边界一致，
// 与图片白名单/项目空间装配同源）。项目空间 → projects.localPath → readGitBranch
// （branch/detached/none 三态 + worktree）；通用/飞书/孤儿（项目已删）→ none。
// 每次 SSE 连接建立（会话打开/切换/重连）补推当前态——SSE 只推增量不回溯，路由层
// 补推保证 renderer 打开会话即达（不依赖 worker 存活与 createSession 推送时机）。
export function gitStateForSpace(spaceKey) {
  const pid = projectIdOf(spaceKey);
  if (!pid) return { state: "none" };
  let localPath = "";
  try {
    const row = getDb().prepare("SELECT localPath FROM projects WHERE id = ?").get(pid);
    localPath = typeof row?.localPath === "string" ? row.localPath : "";
  } catch {
    return { state: "none" };
  }
  if (localPath === "") return { state: "none" };
  return readGitBranch(realpathBestEffort(path.resolve(expandTilde(localPath))));
}

// —— 会话配置（provider/key/identity，一次性注入语义，key 明文不落盘）——
// 导出供 server.js 接线复用（确认回调回投时会话句柄缺失需按空间建句柄——
// 与 handlePostMessage 同源构建，避免双源漂移）。
// REQ-AGENT-090 形态升级后：settings.agent 为 providers 数组 + defaultModel 指针。
// Slice 2（REQ-AGENT-093/095，ADR-026）：按 agent_sessions 行读取 provider/model
// 装配（行值优先；NULL → 默认组合；条目已删 → 回落默认 E12）——与 agentService
// 水合/懒恢复同源（settingsService.resolveSessionModelConfig 单点解析）。无参调用
//（旧接线/无行）→ 默认组合（行为不变）。
export function buildSessionConfig(spaceKey, store) {
  let row;
  if (typeof spaceKey === "string" && spaceKey !== "" && store?.get) {
    row = store.get(spaceKey);
  }
  const resolved = settingsService.resolveSessionModelConfig(row?.provider, row?.model);
  const provider =
    typeof resolved.provider === "string" && resolved.provider !== "" ? resolved.provider : DEFAULT_PROVIDER;
  return {
    provider,
    model: resolved.model,
    apiKey: settingsService.entryApiKey(resolved.entry),
    identity: resolved.identity,
  };
}
