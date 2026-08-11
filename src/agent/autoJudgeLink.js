// src/agent/autoJudgeLink.js
// PI Agent auto 档模型判断 link（2026-08-11-pi-agent-modes，Slice 2；REQ-AGENT-073/075/076）。
//
// 职责（PRD §10.2/§10.4「auto-judge link」）：注册到 gotgenes authorizerChain 的
// 模型判断 link——配置 ask 的操作由模型代问：判安全 allow / 判危险 deny（teaching
// reason 回 agent）/ 不确定 defer（落回下个 link → 既有确认卡）。本切片只做 link
// 本身（worker 侧），不做 worker 接线（S3）与 renderer（S4）。
//
// link 契约（gotgenes Authorizer，authorizer.ts 实证）：
//   authorize(details, query, log) → { kind: "allow" | "deny" | "defer", reason? }
//   details 含 surface / toolName / input（本切片契约面；gotgenes 原生 details 的
//   surface 在 accessIntent.surface，toolName 同字段，input 分散在 command/path/
//   target——读取时双形态兼容）。
//
// 判定映射（fail-safe，deny-first 对齐 model-judge 实证）：
//   decide → allow → { kind:"allow" }（重置熔断计数）
//   decide → deny → { kind:"deny", reason }（连续计数 +1，达阈值触发 onTripped）
//   decide → defer / 模型失败 / 超时 / 回复不可解析 → { kind:"defer" }（不确定一律
//   defer——判错最坏回人工，不静默放行）
//
// 熔断（REQ-AGENT-075，B6）：连续 deny 计数（denyThreshold 可注入，默认 5）；
// allow 重置；达阈值 → onTripped() 回调（S3 接模式服务降级 standard）。计数是
// link 实例级——每会话独立实例（对齐 permissionBridge H4 每会话独立）。
//
// review log（REQ-AGENT-076，B7）：每次判断写 JSONL
//   { requestId, surface, toolName, input?, verdict, reason?, deferReason?, latencyMs, ts }
//   reviewLogPath 可注入，默认对齐 gotgenes permission review log 路径
//   （<agentHome>/extensions/pi-permission-system/logs/pi-permission-system-
//   permission-review.jsonl，config-paths.ts 实证）；defer 记录 deferReason
//   （model-unresolved/timeout/call-failed/decide-deferred）；写失败不致命（E4，
//   try/catch 警告，不影响判定与执行）。
//
// decide 注入缝：decide 为异步函数 (details) => { kind, reason? }；默认实现
// defaultDecide（S2 骨架）读 settings agent provider 配置（<configDir>/settings.json
//  agent.provider）——未配置 → throw（link 映射 call-failed defer，REQ-AGENT-073
// 标准 4）；已配置 → 真实模型调用链路（组装 prompt → 调模型 → 解析 verdict）由
// S3 接线（worker 内 provider 复用），接线前 fail-safe 显式 defer（decide-deferred，
// 不静默放行）。本切片验收面 = 注入缝 + 判定映射 + 熔断 + 日志。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

// 熔断阈值初值（PRD B6：连续 5 次降级回 standard，可注入——REQ-AGENT-075 标准 1）。
const DEFAULT_DENY_THRESHOLD = 5;
// 模型判断超时兜底（对齐 model-judge 的 timeoutMs 默认 5000；超时 → defer fail-safe）。
const DEFAULT_DECIDE_TIMEOUT_MS = 5000;
// deferReason 枚举（review log 契约；非枚举值回落 decide-deferred）。
const DEFER_REASONS = new Set(["model-unresolved", "timeout", "call-failed", "decide-deferred"]);

// settings.json 路径（对齐 settingsService.configDir：OPC_WORKSTATION_CONFIG_DIR 注入 /
// 默认 ~/.opc-workstation；worker 零耦合不 import 主进程模块，镜像实现）。
function settingsFilePath() {
  const configDir = process.env.OPC_WORKSTATION_CONFIG_DIR ?? path.join(os.homedir(), ".opc-workstation");
  return path.join(configDir, "settings.json");
}

// 默认 review log 路径：对齐 gotgenes permission review log（config-paths.ts：
// REVIEW_LOG_FILENAME + getGlobalLogsDir）。agentHome 契约同 worker（OPC_AGENT_HOME
// 注入 / 默认 cwd/.agent-home）。
function defaultReviewLogPath() {
  const agentHome = process.env.OPC_AGENT_HOME ?? path.join(process.cwd(), ".agent-home");
  return path.join(agentHome, "extensions", "pi-permission-system", "logs", "pi-permission-system-permission-review.jsonl");
}

// 默认 decide（S2 骨架）：读 settings agent provider 配置 → 组装判断 prompt → 调模型
// → 解析 verdict。真实调用链路由 S3 接线（worker 内 provider 复用）；本切片只交付
// 骨架 + settings 读取。provider 未配置 → throw（link 映射 call-failed defer——
// REQ-AGENT-073 标准 4「provider 未配置 → auto 不可用」）；已配置 → S3 接线前
// fail-safe 显式 defer（decide-deferred，不静默放行）。
// _details：判断上下文（surface/toolName/input/agentName/cwd），S3 组装 prompt 时使用。
async function defaultDecide(_details) {
  let provider;
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFilePath(), "utf8"));
    provider = parsed?.agent?.provider;
  } catch {
    provider = undefined;
  }
  if (!provider) {
    throw new Error("E-AUTO-JUDGE-NO-PROVIDER: auto 判断不可用——settings agent provider 未配置");
  }
  // S3 接线点：组装判断 prompt（details.surface/toolName/input）→ 调 provider 模型 →
  // 解析 verdict（allow/deny/reason；回复不可解析 → { kind:"defer", reason:"model-unresolved" }）。
  return { kind: "defer" };
}

// 超时兜底：decide 悬挂 → 超时即 reject（link 映射 timeout defer）。ms <= 0 → 不包。
function withTimeout(promise, ms) {
  if (!(ms > 0)) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error("E-AUTO-JUDGE-TIMEOUT: auto 判断超时");
        err.code = "E-AUTO-JUDGE-TIMEOUT";
        reject(err);
      }, ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

// surface 读取（gotgenes 双形态：gate 权威 accessIntent.surface 优先，回退展示 surface）。
function surfaceOf(details) {
  return details?.accessIntent?.surface ?? details?.surface ?? null;
}

// input 读取（本切片契约面 details.input；gotgenes 原生形态分散在 command/path/target）。
function inputOf(details) {
  return details?.input ?? details?.command ?? details?.path ?? details?.target ?? null;
}

export function createAutoJudgeLink(options = {}) {
  const {
    decide = defaultDecide,
    denyThreshold = DEFAULT_DENY_THRESHOLD,
    onTripped = () => {},
    reviewLogPath = defaultReviewLogPath(),
    decideTimeoutMs = DEFAULT_DECIDE_TIMEOUT_MS,
  } = options;

  // 熔断计数（link 实例级：每会话独立实例——对齐 permissionBridge H4）。
  let denyStreak = 0;

  // gotgenes link 契约形态（authorizer.ts：authorize(details, query, log)）：
  // query（PermissionQuery）与 log（AuthorizerLog）为本链注入 seam——本切片按
  // reviewLogPath 自写 review log（REQ-AGENT-076 契约），query/log 留待 S3 接线
  // 评估（如需 gate 对齐查询 / gotgenes 原生 review 落点）。
  async function authorize(details, _query, _log) {
    const t0 = Date.now();

    // 1. decide 调用（注入缝）：失败/超时 → 判定为 null（fail-safe defer）。
    let verdict;
    let failure = null;
    try {
      verdict = await withTimeout(decide(details), decideTimeoutMs);
    } catch (err) {
      failure = err;
    }

    // 2. 判定映射（allow/deny/defer；其余一切 → defer fail-safe）。
    let result;
    let reason;
    let deferReason;
    const kind = failure ? null : verdict?.kind;
    if (kind === "allow") {
      result = { kind: "allow" };
      denyStreak = 0; // allow 重置连续计数（REQ-AGENT-075 标准 3）
    } else if (kind === "deny") {
      result =
        typeof verdict.reason === "string" && verdict.reason.length > 0
          ? { kind: "deny", reason: verdict.reason }
          : { kind: "deny" };
      reason = result.reason;
      denyStreak += 1; // 连续 deny 计数（REQ-AGENT-075 标准 1）
      if (denyStreak === denyThreshold) {
        // 跨过阈值首次触发熔断回调（S3 接模式服务降级 standard + 提示）。
        // 达阈值后继续 deny 不重复触发，直到 allow 重置（熔断后由用户手动切回恢复）。
        onTripped();
      }
    } else {
      // defer / 模型失败 / 超时 / 回复不可解析 → defer（不确定一律 defer）。
      result = { kind: "defer" };
      deferReason = failure
        ? failure?.code === "E-AUTO-JUDGE-TIMEOUT"
          ? "timeout"
          : "call-failed"
        : kind === "defer"
          ? pickDeferReason(verdict?.reason)
          : "model-unresolved";
    }

    // 3. review log（REQ-AGENT-076）：每次判断一条决策记录；写失败不致命（E4）。
    writeReviewLog(reviewLogPath, {
      requestId: details?.requestId ?? randomUUID(),
      surface: surfaceOf(details),
      toolName: details?.toolName ?? null,
      ...(inputOf(details) !== null ? { input: inputOf(details) } : {}),
      verdict: result.kind,
      ...(reason !== undefined ? { reason } : {}),
      ...(deferReason !== undefined ? { deferReason } : {}),
      latencyMs: Date.now() - t0,
      ts: new Date().toISOString(),
    });

    return result;
  }

  return { authorize };
}

// deferReason 归一：仅枚举值有效（review log 契约），其余一律 decide-deferred。
function pickDeferReason(value) {
  return typeof value === "string" && DEFER_REASONS.has(value) ? value : "decide-deferred";
}

// JSONL 追加写（对齐 permission review log 形态：逐行 JSON，ts 为 ISO 时间戳）。
// 写失败不致命：仅警告，不影响判定与执行（E4，PRD §8）。
function writeReviewLog(reviewLogPath, entry) {
  try {
    fs.mkdirSync(path.dirname(reviewLogPath), { recursive: true });
    fs.appendFileSync(reviewLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    console.warn(`auto-judge review log 写入失败 err=${err?.message ?? String(err)}`);
  }
}
