// src/agent/trajectoryRecorder.js
// 会话轨迹记录器（ADR-038 / story 2026-08-22-tool-call-review Slice 1 / REQ-AGENT-127）
//
// 负责在 worker 第一现场将回合边界、用户消息、assistant 时间片、工具调用、中断收尾等
// 逐条落盘到 sidecar 文件（<sessionDir>/<safeKey>[.N].traj.jsonl），并同行经 IPC 出站。
//
// 关键特性：
// 1. 每会话单调递增 seq（从 1 起；worker 重启后按 sidecar 惰性恢复 maxSeq 基线）；
// 2. 5 种行类型：turn_boundary / user_message / assistant_span / tool_call / compaction；
// 3. 规范化工具名（空格换下划线等）；
// 4. 时间片精确计算（ttftMs, decodeMs, durationMs；interrupted 状态恒无 durationMs；startTs 记录起点）；
// 5. input/output/text 载体各自独立截断 ≤256KB（超限带 truncated: true，单真源收紧）；
// 6. Fail-Safe 容错：写 sidecar appendFileSync 异常时输出结构化日志且不阻断；
// 7. 双写：每行写入 sidecar 的同时通过 send({ type: "trajectory-record", sessionKey, event: record }) 发送 IPC；
// 8. in-flight 状态（L2 锚点）：onToolStart 写入并推送 running 行，end/error/abort 按原 seq 回填更新。

import nodeFs from "node:fs";
import nodePath from "node:path";

export const MAX_TRAJECTORY_BYTES = 256 * 1024;

export function normalizeToolName(name) {
  if (!name) return "";
  return String(name).trim().replace(/[^a-zA-Z0-9_-]+/g, "_").toLowerCase();
}

function safeKeyFor(sessionKey) {
  return String(sessionKey).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getSidecarPath(sessionDir, { sessionKey, safeKey, sessionRef, generation } = {}, pathMod = nodePath) {
  if (sessionRef && typeof sessionRef === "string") {
    if (sessionRef.endsWith(".jsonl")) {
      return sessionRef.replace(/\.jsonl$/, ".traj.jsonl");
    }
    return `${sessionRef}.traj.jsonl`;
  }
  const safe = safeKey || safeKeyFor(sessionKey);
  const genSuffix = generation && generation > 1 ? `.${generation}` : "";
  return pathMod.join(sessionDir, `${safe}${genSuffix}.traj.jsonl`);
}

function shrinkCarrier(record, field) {
  const value = record[field];
  if (value === undefined || value === null) return;
  let text = typeof value === "string" ? value : JSON.stringify(value);
  while (JSON.stringify({ ...record, [field]: text }).length > MAX_TRAJECTORY_BYTES && text.length > 1) {
    text = text.slice(0, Math.floor(text.length / 2));
  }
  record[field] = text;
  record.truncated = true;
}

export function truncateRecord(record) {
  const jsonLen = JSON.stringify(record).length;
  if (jsonLen <= MAX_TRAJECTORY_BYTES) return record;

  if (record.output !== undefined) {
    shrinkCarrier(record, "output");
  }
  if (JSON.stringify(record).length > MAX_TRAJECTORY_BYTES && record.input !== undefined) {
    shrinkCarrier(record, "input");
  }
  if (JSON.stringify(record).length > MAX_TRAJECTORY_BYTES && record.text !== undefined) {
    shrinkCarrier(record, "text");
  }
  return record;
}

export function createTrajectoryRecorder({
  sessionDir = process.env.OPC_AGENT_SESSION_DIR ?? nodePath.join(process.cwd(), "agent-sessions"),
  send = () => {},
  log = (msg) => {
    process.stderr.write(`${msg}\n`);
  },
  now = Date.now,
  fs = nodeFs,
  path = nodePath,
} = {}) {
  // sessionKey -> { seq, seqRecovered, turn, turnStartTime, firstDeltaTime, textPreview, runningTools }
  const sessionStates = new Map();

  function recoverMaxSeqFromSidecar(sidecarPath) {
    try {
      if (!fs.existsSync(sidecarPath)) return 0;
      const content = fs.readFileSync(sidecarPath, "utf8");
      const lines = content.trim().split("\n");
      let maxSeq = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (typeof parsed?.seq === "number") {
            maxSeq = Math.max(maxSeq, parsed.seq);
          }
        } catch {
          // 跳过损坏行
        }
      }
      return maxSeq;
    } catch {
      return 0;
    }
  }

  function getSessionState(sessionKey, sidecarOpts) {
    let state = sessionStates.get(sessionKey);
    if (!state) {
      state = {
        seq: 0,
        seqRecovered: false,
        turn: 0,
        turnStartTime: null,
        firstDeltaTime: null,
        textPreview: null,
        runningTools: new Map(),
      };
      sessionStates.set(sessionKey, state);
    }
    if (!state.seqRecovered && sidecarOpts) {
      const sidecarPath = getSidecarPath(sessionDir, sidecarOpts, path);
      state.seq = Math.max(state.seq, recoverMaxSeqFromSidecar(sidecarPath));
      state.seqRecovered = true;
    }
    return state;
  }

  function writeRecord(opts, rawRecord) {
    const { sessionKey, safeKey, sessionRef, generation } = opts;
    const sessionState = getSessionState(sessionKey, opts);

    let recordSeq = rawRecord.seq;
    if (recordSeq === undefined) {
      sessionState.seq += 1;
      recordSeq = sessionState.seq;
    } else {
      sessionState.seq = Math.max(sessionState.seq, recordSeq);
    }

    const record = {
      v: 1,
      seq: recordSeq,
      ts: rawRecord.ts || new Date(now()).toISOString(),
      ...rawRecord,
    };
    truncateRecord(record);

    const sidecarPath = getSidecarPath(sessionDir, { sessionKey, safeKey, sessionRef, generation }, path);
    try {
      const dir = path.dirname(sidecarPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(sidecarPath, `${JSON.stringify(record)}\n`, "utf8");
    } catch (err) {
      log(`event=trajectory_write_failed session=${sessionKey} err=${err?.message ?? String(err)}`);
    }

    try {
      send({ type: "trajectory-record", sessionKey, event: record });
    } catch (err) {
      log(`event=trajectory_send_failed session=${sessionKey} err=${err?.message ?? String(err)}`);
    }

    return record;
  }

  function onTurnStart({ sessionKey, safeKey, turn, sessionRef, generation }) {
    const state = getSessionState(sessionKey, { sessionKey, safeKey, sessionRef, generation });
    state.turn = typeof turn === "number" ? turn : state.turn + 1;
    state.turnStartTime = now();
    state.firstDeltaTime = null;
    state.textPreview = null;
    state.assistantSpanWritten = false;

    return writeRecord(
      { sessionKey, safeKey, sessionRef, generation },
      {
        type: "turn_boundary",
        turn: state.turn,
      }
    );
  }

  function onUserMessage({ sessionKey, safeKey, text, sessionRef, generation }) {
    return writeRecord(
      { sessionKey, safeKey, sessionRef, generation },
      {
        type: "user_message",
        text: String(text ?? ""),
      }
    );
  }

  function onFirstTextDelta({ sessionKey, textPreview }) {
    const state = getSessionState(sessionKey);
    if (state.firstDeltaTime === null) {
      state.firstDeltaTime = now();
    }
    if (textPreview && !state.textPreview) {
      state.textPreview = String(textPreview);
    }
  }

  function onAssistantMessageEnd({ sessionKey, safeKey, usage, textPreview, sessionRef, generation }) {
    const state = getSessionState(sessionKey, { sessionKey, safeKey, sessionRef, generation });
    state.assistantSpanWritten = true;
    const turnStart = state.turnStartTime ?? now();
    const firstDelta = state.firstDeltaTime ?? now();
    const ttftMs = Math.max(0, firstDelta - turnStart);
    const decodeMs = Math.max(0, now() - firstDelta);
    const usageObj = usage && typeof usage === "object" ? usage : { input: 0, output: 0 };
    const preview = textPreview || state.textPreview;

    return writeRecord(
      { sessionKey, safeKey, sessionRef, generation },
      {
        type: "assistant_span",
        startTs: new Date(turnStart).toISOString(),
        ttftMs,
        decodeMs,
        usage: usageObj,
        ...(preview ? { textPreview: preview } : {}),
      }
    );
  }

  function onToolStart({ sessionKey, safeKey, toolCallId, toolName, args, sessionRef, generation }) {
    const state = getSessionState(sessionKey, { sessionKey, safeKey, sessionRef, generation });
    const startTime = now();

    // 生产环境写入并推送 running 行（L2 锚点）
    const record = writeRecord(
      { sessionKey, safeKey, sessionRef, generation },
      {
        type: "tool_call",
        toolCallId,
        name: normalizeToolName(toolName),
        status: "running",
        ...(args !== undefined ? { input: args } : {}),
      }
    );

    state.runningTools.set(toolCallId, {
      toolCallId,
      toolName,
      args,
      startTime,
      seq: record.seq,
      ts: record.ts,
    });

    return record;
  }

  function onToolEnd({
    sessionKey,
    safeKey,
    toolCallId,
    toolName,
    result,
    isError,
    errorCode,
    errorMessage,
    durationMs,
    sessionRef,
    generation,
  }) {
    const state = getSessionState(sessionKey, { sessionKey, safeKey, sessionRef, generation });
    const running = state.runningTools.get(toolCallId);
    state.runningTools.delete(toolCallId);

    const actualToolName = running?.toolName || toolName;
    const input = running?.args;
    const startTime = running?.startTime;
    const computedDuration =
      typeof durationMs === "number"
        ? durationMs
        : startTime !== undefined
          ? Math.max(0, now() - startTime)
          : undefined;

    const errorFlag = Boolean(isError);
    const status = errorFlag ? "error" : "completed";
    const targetSeq = running?.seq;
    const targetTs = running?.ts;

    return writeRecord(
      { sessionKey, safeKey, sessionRef, generation },
      {
        ...(targetSeq !== undefined ? { seq: targetSeq } : {}),
        ...(targetTs ? { ts: targetTs } : {}),
        type: "tool_call",
        toolCallId,
        name: normalizeToolName(actualToolName),
        status,
        isError: errorFlag,
        ...(computedDuration !== undefined ? { durationMs: computedDuration } : {}),
        ...(input !== undefined ? { input } : {}),
        ...(result !== undefined ? { output: result } : {}),
        ...(errorCode ? { errorCode } : {}),
        ...(errorMessage ? { errorMessage } : {}),
      }
    );
  }

  function onToolError({
    sessionKey,
    safeKey,
    toolCallId,
    toolName,
    error,
    errorCode,
    errorMessage,
    durationMs,
    sessionRef,
    generation,
  }) {
    const state = getSessionState(sessionKey, { sessionKey, safeKey, sessionRef, generation });
    const running = state.runningTools.get(toolCallId);
    state.runningTools.delete(toolCallId);

    const actualToolName = running?.toolName || toolName;
    const input = running?.args;
    const startTime = running?.startTime;
    const computedDuration =
      typeof durationMs === "number"
        ? durationMs
        : startTime !== undefined
          ? Math.max(0, now() - startTime)
          : undefined;

    const code = errorCode || error?.code;
    const msg = errorMessage || error?.message || (typeof error === "string" ? error : undefined);
    const targetSeq = running?.seq;
    const targetTs = running?.ts;

    return writeRecord(
      { sessionKey, safeKey, sessionRef, generation },
      {
        ...(targetSeq !== undefined ? { seq: targetSeq } : {}),
        ...(targetTs ? { ts: targetTs } : {}),
        type: "tool_call",
        toolCallId,
        name: normalizeToolName(actualToolName),
        status: "error",
        isError: true,
        ...(computedDuration !== undefined ? { durationMs: computedDuration } : {}),
        ...(input !== undefined ? { input } : {}),
        ...(code ? { errorCode: code } : {}),
        ...(msg ? { errorMessage: msg } : {}),
      }
    );
  }

  function onTurnAbort({ sessionKey, safeKey, reason: _reason, sessionRef, generation }) {
    const state = getSessionState(sessionKey, { sessionKey, safeKey, sessionRef, generation });
    const inFlight = Array.from(state.runningTools.values());
    state.runningTools.clear();

    for (const running of inFlight) {
      writeRecord(
        { sessionKey, safeKey, sessionRef, generation },
        {
          ...(running.seq !== undefined ? { seq: running.seq } : {}),
          ...(running.ts ? { ts: running.ts } : {}),
          type: "tool_call",
          toolCallId: running.toolCallId,
          name: normalizeToolName(running.toolName),
          status: "interrupted",
          ...(running.args !== undefined ? { input: running.args } : {}),
        }
      );
    }
  }

  function onTurnEnd({ sessionKey, safeKey, sessionRef, generation }) {
    const state = getSessionState(sessionKey, { sessionKey, safeKey, sessionRef, generation });
    if (!state.assistantSpanWritten) {
      onAssistantMessageEnd({ sessionKey, safeKey, sessionRef, generation });
    }
    return writeRecord(
      { sessionKey, safeKey, sessionRef, generation },
      {
        type: "turn_boundary",
        turn: state.turn,
      }
    );
  }

  function onCompaction({ sessionKey, safeKey, reason, phase, sessionRef, generation }) {
    return writeRecord(
      { sessionKey, safeKey, sessionRef, generation },
      {
        type: "compaction",
        reason: String(reason ?? ""),
        phase: phase === "end" ? "end" : "start",
      }
    );
  }

  function onCompactionStart(opts) {
    return onCompaction({ ...opts, phase: "start" });
  }

  function onCompactionEnd(opts) {
    return onCompaction({ ...opts, phase: "end" });
  }

  function clearSessionState(sessionKey) {
    sessionStates.delete(sessionKey);
  }

  return {
    onTurnStart,
    onUserMessage,
    onFirstTextDelta,
    onAssistantMessageEnd,
    onToolStart,
    onToolEnd,
    onToolError,
    onTurnAbort,
    onTurnEnd,
    onCompaction,
    onCompactionStart,
    onCompactionEnd,
    clearSessionState,
    resetSession: clearSessionState,
  };
}
