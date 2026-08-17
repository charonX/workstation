// src/agent/turnEventPipeline.js
// 回合事件管线模块（ADR-029；story 2026-08-16-deepen-turn-event-pipeline）。
//
// 从 worker.js 抽取的「一回合的事件状态机」：转发（forwardEvent）/ 映射
// （mapToContractEvent）/ 尺寸截断（limitSize）/ 延迟 text_end（pendingTextEnds +
// 5s 兜底）/ abort 合成收尾 / 回合状态 Map（lastReplies / turnEventCounts /
// sdkEventCounts / turnStartedAt / pendingTextEnds）+ 会话状态注册表统一清理。
// 行为语义与 worker.js 逐行对应（契约由既有 REQ-AGENT-006/009/012/035/055/
// 057/091 锁定；本模块只搬移归属，不改事件形状/转发顺序/abort 语义/淘汰副作用）。
//
// 工厂模式（同 sessionLifecycle 先例）：每测试独立实例；import 无副作用——
// 模块顶层不调用任何注入函数、不起任何定时器。
//
// 注入集 { send, log, touch, setTimeout, clearTimeout, now }：
// - send：出站（{type:"session-event", sessionKey, event: limitSize(mapped)}）；
// - log：诊断日志（abort 合成「abort 收尾」）；
// - touch：事件实际映射出站时调用（review B2）——恒 clearPending:false 语义由
//   注入方（worker lifecycle.touch）承担；未知 sessionKey 照常调用（review B3：
//   消息乱序容忍 = 事件不丢失，no-op 由注入方内部承担）；
// - setTimeout/clearTimeout/now：时钟注入（5s 兜底定时器 unref；durationMs 精确差）。
//
// 注册表：registerSessionScopedMap(map) 纯 Map 登记；registerSessionCleanup(fn)
// 特殊清理钩子（pendingTextEnds 定时器 clear）；clearSessionState(sessionKey) 一条
// 路径清全部登记项——淘汰/重置统一走它（修「两份手抄清单抄岔」+ 计数泄漏）。

import { getOriginalToolName } from "./toolAdapter.js";

// 单条 IPC 消息上限（签核决策 15：≤ 256KB，先行约束来自飞书文本消息 150KB 上限）。
export const MAX_IPC_BYTES = 256 * 1024;

// 兜底定时器：message_end 缺失（异常中断）→ 超时照发（仅 durationMs，不悬挂）。
const PENDING_TEXT_END_FALLBACK_MS = 5000;

// 单条事件 ≤ 256KB：超限截断文本载体 + truncated 标记（REQ-AGENT-006 标准 5）。
// 加法扩展（REQ-AGENT-055）：tool_execution 事件数据载体（input=PI args /
// output=PI result）同样按「截断数据载体、保留契约字段」语义处理——对象载体
// JSON 字符串化后截断（renderer 以文本展示输出，ToolCallBlock 语义一致），
// 不再整条降级为 { type, truncated }（否则 toolCallId/name/status/isError 全丢，
// 渲染层无法关联工具块）。
// 截断单真源（ADR-029 决策 5，人拍板 Q2）：worker 强实现成为唯一实现，主进程
// agentService 三调用点（emitErrorEvent / inMemory runTurn / 子进程消息回传）
// import 本函数。
// 文本载体截断（content/delta 共用）：slice 到 MAX_IPC_BYTES − 256 预算内 + truncated 标记。
function truncateTextCarrier(out, carrier) {
  out[carrier] = out[carrier].slice(0, MAX_IPC_BYTES - 256);
  out.truncated = true;
}

// 工具事件数据载体截断（input=PI args / output=PI result）：迭代收紧保证出站 JSON
// 恒 ≤ MAX_IPC_BYTES。JSON 序列化转义（引号/控制字符 → \uXXXX）可能使截断后仍超限
// （旧主进程 enforceSizeLimit 对 tool 事件无数据载体分支，超限会整条降级丢契约字段）。
function shrinkToolCarrier(out, carrier) {
  const value = out[carrier];
  let text = typeof value === "string" ? value : JSON.stringify(value);
  while (JSON.stringify({ ...out, [carrier]: text }).length > MAX_IPC_BYTES && text.length > 1) {
    text = text.slice(0, Math.floor(text.length / 2));
  }
  out[carrier] = text;
  out.truncated = true;
}

export function limitSize(event) {
  const size = JSON.stringify(event).length;
  if (size <= MAX_IPC_BYTES) return event;
  const out = { ...event };
  if (typeof out.content === "string") {
    truncateTextCarrier(out, "content");
  } else if (typeof out.delta === "string") {
    truncateTextCarrier(out, "delta");
  } else if (out.input !== undefined || out.output !== undefined) {
    // 工具事件数据载体（input=PI args / output=PI result）超限 → 文本化截断 +
    // truncated 标记（renderer 以文本展示输出，ToolCallBlock 语义一致），保留
    // 契约字段 toolCallId/name/status/isError——不整条降级为 {type, truncated}
    // （否则渲染层无法关联工具块）。
    shrinkToolCarrier(out, out.input !== undefined ? "input" : "output");
  } else {
    return { type: event.type, truncated: true };
  }
  return out;
}

// PI 事件 → 签核事件契约（session-event：text_delta/text_end/tool_execution_*）。
// 工具面适配器事件（REQ-AGENT-012：tool_execution_start/end/error，含 name/status）
// 已是契约形态 → 直接透传；PI 原生事件（toolName 字段）走下方映射。
// 透传分支实证（REQ-AGENT-055）：到达本函数、带 name 字段的 tool_execution_* 事件
// 仅有 toolAdapter 的 tool_execution_error（worker 只从 toolSurface 转发 error——
// adapter 的 start/end 不经 onEvent 转发；PI 原生事件恒为 toolName 字段不落本分支），
// 且 adapter 事件不含 args/result → 无字段可补，透传原样（BUG-006 起 error 携带
// toolCallId——渲染层精确归块；无 id 的旧形态保持回退关联，I-2 的 isError 处理在
// end 上）。
function mapToContractEvent(ev) {
  if (
    typeof ev?.type === "string" &&
    ev.type.startsWith("tool_execution") &&
    typeof ev.name === "string"
  ) {
    return ev;
  }
  switch (ev.type) {
    case "message_update": {
      const a = ev.assistantMessageEvent;
      if (!a) return null;
      if (a.type === "text_delta") return { type: "text_delta", delta: a.delta };
      if (a.type === "text_end") return { type: "text_end", content: a.content };
      return null;
    }
    case "tool_execution_start":
      // 加法扩展（REQ-AGENT-055，review I-1）：start 补 input = PI 原生 args
      // （实证：pi-agent-core agent-loop.js tool_execution_start 恒含
      // args = toolCall.arguments；缺失时 undefined）。
      return {
        type: "tool_execution_start",
        name: getOriginalToolName(ev.toolName),
        status: "running",
        toolCallId: ev.toolCallId,
        input: ev.args,
      };
    case "tool_execution_end":
      // 加法扩展（REQ-AGENT-055）：end 补 output = PI 原生 result（ToolResult
      // 子集完整透传，256KB 上限由 limitSize 按数据载体截断）+ isError = PI
      // 布尔透传（实证：emitToolExecutionEnd 恒含 result/isError，成功 false/
      // 失败 true——不再丢弃，I-2 依赖）。超限截断见 limitSize。
      return {
        type: "tool_execution_end",
        name: getOriginalToolName(ev.toolName),
        status: "completed",
        toolCallId: ev.toolCallId,
        output: ev.result,
        isError: ev.isError,
      };
    default:
      return null;
  }
}

// 回合事件管线工厂（ADR-029 决策 1；注入集 review B2 补 touch）：
// import 无副作用——所有注入函数仅在事件处理/清理时被调用，工厂构造不 arm
// 任何定时器、不产生任何出站。
export function createTurnEventPipeline({
  send = () => {},
  log = () => {},
  touch = () => {},
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
  now = Date.now,
} = {}) {
  // 每会话最近一轮回复最终文本（text_end.content）——prompt-result 回传主进程，
  // 供调用方拿到本轮回复文本（REQ-AGENT-006/009 断言用）。
  const lastReplies = new Map(); // sessionKey → 最近一轮 text_end.content
  // BUG-002 诊断（2026-08-09）：每轮事件计数（text_delta/text_end/tool_execution）——
  // prompt-result 日志实锤事件链完整性；清时机人拍板 B（beginTurn 幂等清 + 取出即删）。
  const turnEventCounts = new Map(); // sessionKey → { delta, end, tool }
  // BUG-002 诊断 4（2026-08-09）：SDK 层事件到达计数（agent_start/end、turn_start/end、
  // message_update）——由 worker 侧 subscribe 维护（本模块只存/取/清）。
  const sdkEventCounts = new Map(); // sessionKey → { agent_start?, agent_end?, ... }
  // —— Slice 8（REQ-AGENT-057）：消息元数据（B10 数据面，接口 6）——
  // text_end 转发加 `meta { durationMs, tokensIn, tokensOut }`：
  // - durationMs：回合起点 = PI assistantMessageEvent 的 text_start（缺失形态兜底
  //   首个 text_delta）记录时间戳，text_end 时按起止计算（注入 now）；
  // - tokensIn/Out：从 message_end 的 assistant message usage 读取 → text_end
  //   **延迟到 message_end 后转发**（usage 完备；事件顺序不变）；
  // - FAUX usage 空/0 → tokensIn/Out 按值原样带（0 → renderer 显示「-」，057 标准 4）；
  // - 兜底定时器：message_end 缺失（异常中断）→ 超时照发（仅 durationMs，不悬挂）。
  const turnStartedAt = new Map(); // sessionKey → 回合起点时间戳
  const pendingTextEnds = new Map(); // sessionKey → Array<{ content, startedAt, timer }>

  // —— 会话状态注册表（ADR-029 决策 2；接口 5/6）——
  // 登记项：装配态 Map（toolContexts/sessionQueues/sessionModes/judgeModels）由
  // worker 登记、worker 持有；本模块回合态 Map 全部自登记。keySecrets /
  // confirmAcks / permissionDecisions 不登记（保留语义）。
  const registeredMaps = new Set(); // 纯 Map 登记（clearSessionState → map.delete(key)）
  const registeredCleanups = new Set(); // 特殊清理钩子（pendingTextEnds 定时器 clear）

  function registerSessionScopedMap(map) {
    registeredMaps.add(map); // Set 幂等：重复登记同一实例无副作用
  }

  function registerSessionCleanup(fn) {
    registeredCleanups.add(fn); // Set 幂等：重复登记同一 fn 无副作用
  }

  // 自登记：管线内部回合态全部进注册表（clearSessionState 一条路径清全部——
  // 修「两份手抄清单抄岔」+ 计数泄漏：淘汰/重置必清两诊断计数）。
  registerSessionScopedMap(lastReplies);
  registerSessionScopedMap(turnEventCounts);
  registerSessionScopedMap(sdkEventCounts);
  registerSessionScopedMap(turnStartedAt);
  registerSessionScopedMap(pendingTextEnds);
  registerSessionCleanup(clearPendingTextEnds); // 定时器 clear 必须先于 map.delete

  // 取出该会话 pending text_end 列表并做清理（清定时器 + 删表项）——clearPendingTextEnds
  // 与 flushPendingTextEnds 共用，免两份手抄「清定时器 + map.delete」。
  function drainPendingTextEnds(sessionKey) {
    const list = pendingTextEnds.get(sessionKey);
    if (!list) return [];
    pendingTextEnds.delete(sessionKey);
    for (const pending of list) clearTimeout(pending.timer);
    return list;
  }

  function clearPendingTextEnds(sessionKey) {
    drainPendingTextEnds(sessionKey); // 定时器 clear + 表项删除；无出站
  }

  // 冲刷该会话的 pending text_end（正常路径 = message_end 到达；兜底 = 定时器超时）。
  // usage 缺失（兜底路径）→ meta 仅 durationMs（renderer 显示「-」）。
  function flushPendingTextEnds(sessionKey, usage) {
    const list = drainPendingTextEnds(sessionKey);
    if (list.length === 0) return;
    turnStartedAt.delete(sessionKey);
    for (const pending of list) {
      const meta = {};
      if (pending.startedAt !== undefined) meta.durationMs = Math.max(0, now() - pending.startedAt);
      if (usage?.input !== undefined) meta.tokensIn = usage.input;
      if (usage?.output !== undefined) meta.tokensOut = usage.output;
      const event = { type: "text_end", content: pending.content };
      if (Object.keys(meta).length > 0) event.meta = meta;
      lastReplies.set(sessionKey, event.content);
      send({ type: "session-event", sessionKey, event: limitSize(event) });
    }
  }

  // BUG-002 诊断（2026-08-09）：事件计数（text_delta/text_end/tool_execution）——
  // prompt-result 日志实锤「LLM 生成了但事件链断」vs「模型空转无输出」。
  function countTurnEvent(sessionKey, ev) {
    const mappedType = ev?.assistantMessageEvent?.type ?? ev?.type;
    if (mappedType !== "text_delta" && mappedType !== "text_end" && !(mappedType ?? "").startsWith("tool_execution")) {
      return;
    }
    const c = turnEventCounts.get(sessionKey) ?? { delta: 0, end: 0, tool: 0 };
    if (mappedType === "text_delta") c.delta += 1;
    else if (mappedType === "text_end") c.end += 1;
    else c.tool += 1;
    turnEventCounts.set(sessionKey, c);
  }

  // 消息元数据（REQ-AGENT-057）：回合起点记录 + text_end 延迟转发（message_end
  // 冲刷时统一转发，事件顺序与既有契约一致——text_delta 后 text_end）。
  // 返回 true 表示 text_end 已入延迟队列（本分支不转发、不 touch）。
  function maybeDelayTextEnd(sessionKey, ev) {
    if (ev?.type !== "message_update" || !ev.assistantMessageEvent) return false;
    const a = ev.assistantMessageEvent;
    if ((a.type === "text_start" || a.type === "text_delta") && !turnStartedAt.has(sessionKey)) {
      turnStartedAt.set(sessionKey, now());
    }
    if (a.type !== "text_end") return false;
    const timer = setTimeout(() => flushPendingTextEnds(sessionKey, undefined), PENDING_TEXT_END_FALLBACK_MS);
    timer.unref?.(); // 注入时钟返回数字 id 时（fake clock）可选链跳过
    const list = pendingTextEnds.get(sessionKey) ?? [];
    list.push({ content: a.content, startedAt: turnStartedAt.get(sessionKey), timer });
    pendingTextEnds.set(sessionKey, list);
    return true;
  }

  // message_end 处理：abort 合成（REQ-AGENT-091，BUG-010）+ 冲刷（usage 完备 → meta 三字段）。
  function handleMessageEnd(sessionKey, ev) {
    const msg = ev.message;
    const hasPending = (pendingTextEnds.get(sessionKey) ?? []).length > 0;
    if (msg?.stopReason === "aborted" && !hasPending) {
      // abort 中断（stopReason=aborted）时流被掐断、SDK 不发 text_end → 若本轮
      // text_end 缺失则合成收尾（content = 中断消息已生成文本——「已生成保留」语义），
      // 否则 lastReplies 无值（prompt-result 丢 reply）且 UI streaming 永不复位
      // （text_end 是回合收尾的唯一权威信号）。正常路径（text_end 已到、pending 非空）
      // 不受影响——不合成。
      const content = (msg.content ?? [])
        .filter((c) => c?.type === "text")
        .map((c) => c.text ?? "")
        .join("");
      const list = pendingTextEnds.get(sessionKey) ?? [];
      list.push({ content, startedAt: turnStartedAt.get(sessionKey), timer: undefined });
      pendingTextEnds.set(sessionKey, list);
      log(`abort 收尾：合成 text_end session=${sessionKey} 已生成=${content.length} 字符`);
    }
    // message_end 携带完整 assistant message（usage 必填——research 实证）→ 冲刷。
    flushPendingTextEnds(sessionKey, ev.message?.usage);
  }

  // 接口 1：onSessionEvent(sessionKey, ev)（forwardEvent 本体，worker.js:651 搬移）。
  // 输入 = PI SDK 事件形态（message_update{assistantMessageEvent} / message_end
  // {message} / tool_execution_*（toolName 字段））；未知 sessionKey 无守卫——
  // 事件照常计数/转发/延迟收尾/出站（review B3：消息乱序容忍 = 事件不丢失）。
  // 阶段顺序（契约锁定）：计数 → text_end 延迟（提前 return）→ message_end 冲刷
  // （提前 return）→ 映射出站（touch + limitSize + send）。
  function onSessionEvent(sessionKey, ev) {
    countTurnEvent(sessionKey, ev);
    if (maybeDelayTextEnd(sessionKey, ev)) return; // 延迟分支不转发、不 touch
    if (ev?.type === "message_end") {
      handleMessageEnd(sessionKey, ev);
      return; // message_end 不映射出站（mapToContractEvent 对 message_end 恒 null）
    }
    const mapped = mapToContractEvent(ev);
    if (!mapped) return;
    // 事件实际映射出站 → 调用注入 touch（review B2）：恒 clearPending:false 语义
    // 由注入方（worker lifecycle.touch）承担——会话自身事件刷新 lastActiveAt 但
    // 不清组冷却延迟淘汰标记（M1）；未知 sessionKey 照常调用（review B3：no-op
    // 由注入方内部承担）。
    touch(sessionKey);
    // 注：mapped 恒为 text_delta / tool_execution_*——message_update 的 text_end 在
    // maybeDelayTextEnd 已入延迟队列并 return，不落本段；lastReplies 只由
    // flushPendingTextEnds 冲刷时更新（含 abort 合成路径）。
    send({ type: "session-event", sessionKey, event: limitSize(mapped) });
  }

  // 接口 2：beginTurn(sessionKey)——prompt 开始前幂等清两诊断计数（人拍板 B：
  // 失败轮残留不混轮；幂等：已空时再清不抛）。
  function beginTurn(sessionKey) {
    turnEventCounts.delete(sessionKey);
    sdkEventCounts.delete(sessionKey);
  }

  // 接口 3：takeLastReply(sessionKey) → string | undefined——读取不删（现状语义）；
  // evict/reset 由 clearSessionState 清。
  function takeLastReply(sessionKey) {
    return lastReplies.get(sessionKey);
  }

  // 接口 4：takeTurnDiagnostics(sessionKey) → { turnStats: {delta, end, tool},
  // sdkStats }——取出即删（两计数 Map；人拍板 B）。缺省 {delta:0,end:0,tool:0} / {}。
  function takeTurnDiagnostics(sessionKey) {
    const counts = turnEventCounts.get(sessionKey);
    const turnStats = {
      delta: counts?.delta ?? 0,
      end: counts?.end ?? 0,
      tool: counts?.tool ?? 0,
    };
    turnEventCounts.delete(sessionKey);
    const sdkStats = sdkEventCounts.get(sessionKey) ?? {};
    sdkEventCounts.delete(sessionKey);
    return { turnStats, sdkStats };
  }

  // 接口 6：clearSessionState(sessionKey)——淘汰/重置统一清理路径：遍历全部登记
  // 项（map.delete + cleanup fn）。cleanup 钩子先于 map 清——pendingTextEnds 定时器
  // clear 依赖 map 条目仍在（clearPendingTextEnds 读列表取 timer）。
  function clearSessionState(sessionKey) {
    for (const fn of registeredCleanups) fn(sessionKey);
    for (const map of registeredMaps) map.delete(sessionKey);
  }

  return {
    onSessionEvent,
    beginTurn,
    takeLastReply,
    takeTurnDiagnostics,
    registerSessionScopedMap,
    registerSessionCleanup,
    clearSessionState,
  };
}
