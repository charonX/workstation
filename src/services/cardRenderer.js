// src/services/cardRenderer.js
// 会话卡片渲染器（主进程）（tech-design「会话卡片渲染器」+ PRD §10 决策 F1）。
//
// 消费两类事件 → 构建 CardKit 卡片 JSON → adapter 卡片接口（经 channelManager）：
// 1. agent 流式事件（session-event：text_delta / text_end / error）→ 回复卡片
//    （REQ-AGENT-019：sendCard + updateCardStream 按序更新；流式结束定型；
//    错误标注失败；10 分钟窗口关闭 → 降级普通消息 + /status 提示）。
// 2. flow 执行事件（eventBus 执行事件）→ 任务卡片（REQ-AGENT-020：执行启动发卡；
//    进度增量更新；终态含 executionId 可 /status 复核；执行结果经会话回投——
//    sessions[sessionKey].onExecutionResult；卡片更新失败重试耗尽 → E-CHANNEL-SEND
//    告警，不阻断执行）。
//
// H4 契约（spike-report）：CardKit 流式更新 content = 全量累计文本（1~100,000
// 字符）、sequence 严格递增（错误码 300317）、流式窗口 10 分钟自动关闭。
//
// adapter 接口（tech-design F1）：sendCard({chatId, cardJson}) → {cardId}；
// updateCardStream({cardId, content, sequence})；send({chatId, text})。
// 事件驱动（eventBus 执行事件接线由实现定——测试直接驱动 handleExecutionEvent）。
//
// 实现纪律：
// - 事件处理同步（序列/状态推进即时可见），adapter 调用 fire-and-forget：
//   sendCard 异步返回 cardId 后回填流状态；更新立即派发（cardId 未知时携带
//   undefined——真实 adapter 对缺失 cardId 的更新跳过，content 为全量累计文本，
//   跳过不丢内容；cardId 回填后后续更新携带真实 card_id）。
// - 卡片更新失败重试（E-CHANNEL-SEND 语义，重试 ≤ retries）：同步抛出（sync
//   adapter）与 promise 拒绝（async adapter）两条路径均重试；耗尽 → warnings 告警，
//   不阻断执行/流式状态推进（REQ-AGENT-020 标准 4）。
// - ADR-009：惰性初始化，无顶层 env/磁盘读取；模块级无状态。

// CardKit 流式窗口（H4：距上次开启 10 分钟自动关闭；测试可注入压缩窗口）。
const DEFAULT_STREAM_WINDOW_MS = 10 * 60 * 1000;
// 卡片更新失败重试上限（REQ-AGENT-020 标准 4：复用 E-CHANNEL-SEND 重试语义）。
const DEFAULT_UPDATE_RETRIES = 3;
// H4：单次流式更新 content 上限 100,000 字符（长任务自控，超出截断兜底）。
const MAX_CARD_CONTENT_CHARS = 100000;

// 降级提示文案（签核决策 19 / REQ-AGENT-019 标准 3：E-CARD-STREAM-CLOSED）。
function streamClosedHint() {
  return "流式输出已中断（流式窗口关闭），可用 /status 查询执行状态。";
}

// 任务卡片终态标注（REQ-AGENT-020 标准 2：终态含执行 id，可 /status 复核；
// 标准 1/AC1：产物与输出一并呈现——artifacts 路径登记行 + output 摘要行，
// 缺口 4 补全 2026-08-04）。
function taskTerminalLine(executionId, status, { output, artifacts } = {}) {
  let line = `\n\n状态：${status ?? "completed"}\n执行 ID：${executionId ?? ""}\n可用 /status ${executionId ?? ""} 复核`;
  const artifactList = Array.isArray(artifacts) ? artifacts.filter(Boolean) : [];
  if (artifactList.length > 0) {
    line += `\n产物：${artifactList.join("；")}`;
  }
  if (output !== undefined && output !== null) {
    const text = stringifyOutput(output);
    if (text) line += `\n输出：${text}`;
  }
  return line;
}

// 终态输出序列化（字符串原样；对象 → JSON，序列化失败（循环引用等）兜底为空串）。
function stringifyOutput(output) {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return "";
  }
}

// 任务卡片启动行（REQ-AGENT-020 标准 1：执行 id + 流程 id 开场）。
function taskStartLine(executionId, flowId) {
  return `任务执行中…\n\n执行 ID：${executionId ?? ""}${flowId ? `\n流程 ID：${flowId}` : ""}`;
}

// CardKit 流式卡片 JSON（F1/H4：schema 2.0 + streaming_mode 开启）；回复卡片带打印
// 节奏配置（print_frequency_ms/print_step），任务卡片仅 summary。
// BUG-006（code-defect）：print_frequency_ms / print_step 官方 schema 为**分端 object**
// （{default: 70}），发数字会 400 field validation failed；元素标识应为 element_id
// （字母开头≤20字符，供 PUT .../elements/:element_id/content 引用），非官方字段 id。
// summary 官方 schema 在 **config 层**且为 { content: string }（聊天栏预览文案），
// 误放 streaming_config 且为字符串 → 200621 parse card json err。修复为官方 schema。
function buildStreamingCard(content, { summary, printFrequencyMs, printStep } = {}) {
  const streamingConfig = {};
  if (printFrequencyMs !== undefined) {
    streamingConfig.print_frequency_ms = {
      default: printFrequencyMs,
      android: printFrequencyMs,
      ios: printFrequencyMs,
      pc: printFrequencyMs,
    };
    streamingConfig.print_step = {
      default: printStep ?? 1,
      android: printStep ?? 1,
      ios: printStep ?? 1,
      pc: printStep ?? 1,
    };
    // 官方 schema：流式更新策略枚举 fast/delay，默认 fast。
    streamingConfig.print_strategy = "fast";
  }
  const config = { streaming_mode: true };
  // summary 是 config 层字段（聊天栏预览），值为 { content: string }。
  if (summary !== undefined) config.summary = { content: summary };
  config.streaming_config = streamingConfig;
  return {
    schema: "2.0",
    config,
    body: {
      elements: [{ tag: "markdown", element_id: "content", content }],
    },
  };
}

export function createCardRenderer({
  adapter,
  streamWindowMs = DEFAULT_STREAM_WINDOW_MS,
  retries = DEFAULT_UPDATE_RETRIES,
  sessions = {},
} = {}) {
  if (!adapter || typeof adapter.sendCard !== "function" || typeof adapter.updateCardStream !== "function") {
    throw new Error("E-CARD-RENDERER: adapter with sendCard/updateCardStream is required");
  }

  const warnings = [];
  // 回复卡片流式状态：sessionKey → { sessionKey, chatId, cardId, text, sequence, openedAt, final }
  const streams = new Map();
  // 任务卡片状态：sessionKey → { sessionKey, chatId, cardId, executionId, text, sequence, terminal }
  const tasks = new Map();

  function chatIdOf(sessionKey) {
    return String(sessionKey).replace(/^feishu:/, "");
  }

  // E-CHANNEL-SEND 告警（REQ-AGENT-020 标准 4：重试耗尽后告警，不阻断执行）。
  function recordWarning(message) {
    warnings.push({
      code: "E-CHANNEL-SEND",
      message: message ?? "卡片更新失败",
      at: new Date().toISOString(),
    });
  }

  // H4：content 全量累计文本上限（超出截断兜底，避免平台拒绝）。
  function capContent(text) {
    return text.length > MAX_CARD_CONTENT_CHARS
      ? text.slice(0, MAX_CARD_CONTENT_CHARS)
      : text;
  }

  // 会话列表预览摘要（BUG-004）：卡片定型时把 summary 从初始占位（「[生成中...]」）
  // 换成正文摘要——单行、截断 40 字符（对齐签核「title slice(0,40) 无省略号」形态）；
  // 空正文兜底「已完成」。
  function summaryOf(text) {
    const excerpt = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    return excerpt === "" ? "已完成" : excerpt;
  }

  // 卡片定型（REQ-AGENT-019 标准 2 / BUG-004 code-defect）：流式结束/错误/任务终态 →
  // 终更后关闭 streaming_mode + summary 换正文摘要。修复前只 PUT elements/content，
  // streaming_mode 常开 → 飞书会话列表永远卡初始 summary「[生成中...]」直到 10 分钟
  // 窗口自动关闭（H4 spike：建议手动 card.settings 关 streaming_mode）。
  // fire-and-forget：失败 → E-CHANNEL-SEND 告警，不阻断流式/执行状态推进。
  // cardId 未回填（sendCard 竞态窗口）→ 记 pendingFinalize，回填时补发（dispatchSendCard）。
  function finalizeStreamCard(state) {
    if (state.finalized) return;
    if (typeof adapter.finalizeCard !== "function") return; // 通道无定型 seam → 跳过
    if (!state.cardId) {
      state.pendingFinalize = true;
      // 诊断（BUG-005）：竞态窗口定型待回填——生产可见。
      if (process.env.NODE_ENV !== "test") {
        console.log(`[cardRenderer] 定型待回填 sessionKey=${state.sessionKey}（sendCard 竞态窗口，回填后补发）`);
      }
      return;
    }
    state.finalized = true;
    state.sequence += 1;
    // 诊断（BUG-005）：定型派发可见——fire-and-forget 静默会让失败无痕（BUG-004 盲区）。
    if (process.env.NODE_ENV !== "test") {
      console.log(`[cardRenderer] 定型派发 sessionKey=${state.sessionKey} cardId=${state.cardId} summary=${summaryOf(state.text)} sequence=${state.sequence}`);
    }
    const onFailure = (err) => {
      recordWarning(err?.message ?? String(err));
      // 诊断：定型失败是「列表卡生成中」的关键信号（带飞书错误码，sendWithRetry 已聚合）。
      if (process.env.NODE_ENV !== "test") {
        console.error(`[cardRenderer] 定型失败 sessionKey=${state.sessionKey} cardId=${state.cardId}:`, err?.message ?? String(err));
      }
    };
    try {
      Promise.resolve(
        adapter.finalizeCard({ cardId: state.cardId, summary: summaryOf(state.text), sequence: state.sequence })
      ).catch(onFailure);
    } catch (err) {
      onFailure(err);
    }
  }

  // fire-and-forget 发卡：sendCard 异步完成后回填 cardId（后续更新携带真实
  // card_id）；失败 → 告警 + 释放流状态（下一次事件重新发卡）。
  function dispatchSendCard(state, chatId, cardJson, registry) {
    const onFailure = (err) => {
      recordWarning(err?.message ?? String(err));
      // 诊断：卡片发送失败是「回复未到达飞书」的关键信号。
      if (process.env.NODE_ENV !== "test") {
        console.error(`[cardRenderer] sendCard 失败 sessionKey=${state.sessionKey} chatId=${chatId}:`, err?.message ?? String(err));
      }
      registry.delete(state.sessionKey);
    };
    try {
      Promise.resolve(adapter.sendCard({ chatId, cardJson })).then(
        (r) => {
          const current = registry.get(state.sessionKey);
          // 轮次边界守卫（code-defect 1 修复配套）：条目已被新一轮替换（stream_start
          // 重置）→ 旧轮 sendCard 回填不写进新轮，防跨轮串卡（cardId 张冠李戴）。
          if (current && current === state) {
            current.cardId = r?.cardId;
            // 定型早于回填到达（text_end/completed 在 sendCard 完成前，BUG-004）→ 补发。
            if (current.pendingFinalize) finalizeStreamCard(current);
          }
        },
        onFailure
      );
    } catch (err) {
      onFailure(err);
    }
  }

  // 更新卡片（含重试；混合同步抛出与 promise 拒绝两条失败路径）：
  // 同步失败（sync adapter）→ 同步重试 + 同步告警；异步失败（async adapter，
  // 真实 HTTP 路径）→ 异步重试 + 异步告警。重试耗尽 → E-CHANNEL-SEND 告警
  // （不阻断流式/执行状态推进）。
  function updateCardWithRetry(payload) {
    let attempts = 0;
    const attempt = () => {
      attempts += 1;
      try {
        const result = adapter.updateCardStream(payload);
        if (result && typeof result.then === "function") {
          // async adapter：按 promise 拒绝重试。
          result.then(
            () => ({ ok: true }),
            (err) => {
              if (attempts <= retries) return attempt();
              recordWarning(err?.message ?? String(err));
              return { ok: false, error: err };
            }
          );
          return { ok: true, dispatched: true };
        }
        return { ok: true };
      } catch (err) {
        // sync adapter：同步重试。
        if (attempts <= retries) return attempt();
        recordWarning(err?.message ?? String(err));
        return { ok: false, error: err };
      }
    };
    return attempt();
  }

  // —— 回复卡片（REQ-AGENT-019）——

  function handleStreamEvent({ sessionKey, type, delta, content, code, userMessage } = {}) {
    if (!sessionKey) return;
    const chatId = chatIdOf(sessionKey);
    let stream = streams.get(sessionKey);

    // 诊断：流式事件到达卡片渲染器（回复回传的最后一环）。
    if (process.env.NODE_ENV !== "test") {
      console.log(`[cardRenderer] 流式事件 sessionKey=${sessionKey} type=${type} delta=${typeof delta === "string" ? delta.slice(0, 40) : ""} content=${typeof content === "string" ? content.slice(0, 40) : ""} code=${code ?? ""} userMessage=${userMessage ?? ""}`);
    }

    // 轮次边界（REQ-AGENT-019：每轮对话各发一张回复卡片）——stream_start（新一轮
    // 开始）重置上一轮流状态：上一轮已定型（text_end/error）的卡片让位，本轮重新
    // 发卡。code-defect 1 修复：修复前 text_end/error 只置 final=true 不清理 streams
    // 条目 → 下一轮首个事件被下方 if (stream?.final) 丢弃（第二轮零产出）。
    if (type === "stream_start") {
      streams.delete(sessionKey);
      stream = undefined;
    }

    // 卡片已定型（流式结束 / 已降级）：停止一切更新（REQ-AGENT-019 标准 2）。
    if (stream?.final) return;

    // 流式窗口 10 分钟自动关闭（H4）→ 降级普通文本消息 + /status 提示
    // （E-CARD-STREAM-CLOSED，签核决策 19 / REQ-AGENT-019 标准 3）；降级一次后定型。
    if (stream && Date.now() - stream.openedAt > streamWindowMs) {
      streams.delete(sessionKey);
      const text = stream.text ? `${stream.text}\n\n${streamClosedHint()}` : streamClosedHint();
      try {
        Promise.resolve(adapter.send({ chatId, text })).catch((err) => {
          recordWarning(err?.message ?? String(err));
        });
      } catch (err) {
        recordWarning(err?.message ?? String(err));
      }
      streams.set(sessionKey, { final: true });
      return;
    }

    if (!stream) {
      // 流式开始 → 发送回复卡片（卡片实体一次发送，H4；streaming_mode 开启）。
      const cardJson = buildStreamingCard(content ?? delta ?? "", {
        summary: "[生成中...]",
        printFrequencyMs: 70,
        printStep: 1,
      });
      stream = {
        sessionKey,
        chatId,
        cardId: undefined, // sendCard 异步回填（回填前更新携带 undefined，adapter 跳过）。
        text: "",
        sequence: 0,
        openedAt: Date.now(),
        final: false,
      };
      streams.set(sessionKey, stream);
      dispatchSendCard(stream, chatId, cardJson, streams);
    }

    // 增量/结束/错误 → 累计全文（H4：content 全量，sequence 严格递增）。
    if (type === "text_delta" && typeof delta === "string") {
      stream.text += delta;
    } else if (type === "text_end" && typeof content === "string") {
      stream.text = content;
      stream.final = true; // 流式结束 → 卡片定型（REQ-AGENT-019 标准 2）。
    } else if (type === "error") {
      // 流式错误 → 卡片标注失败状态（REQ-AGENT-019 标准 2）。
      const reason = userMessage || code || "流式输出失败";
      stream.text = stream.text ? `${stream.text}\n\n【失败】${reason}` : `【失败】${reason}`;
      stream.final = true;
    } else {
      return;
    }
    stream.sequence += 1;
    updateCardWithRetry({
      cardId: stream.cardId,
      content: capContent(stream.text),
      sequence: stream.sequence,
    });
    // 流式结束/错误 → 卡片定型（关闭 streaming_mode + summary 换正文摘要，BUG-004）。
    if (stream.final) finalizeStreamCard(stream);
  }

  // —— 任务卡片（REQ-AGENT-020）——

  function handleExecutionEvent({ sessionKey, type, executionId, status, log, output, flowId, artifacts } = {}) {
    if (!sessionKey) return {};
    const chatId = chatIdOf(sessionKey);
    let task = tasks.get(sessionKey);

    if (type === "started") {
      if (task && task.executionId !== executionId) {
        // 新执行开始 → 上一张任务卡片让位（无终态事件的兜底）。
        tasks.delete(sessionKey);
        task = null;
      }
      if (!task) {
        const cardJson = buildStreamingCard(taskStartLine(executionId, flowId), {
          summary: "[任务执行中...]",
        });
        task = {
          sessionKey,
          chatId,
          cardId: undefined,
          executionId,
          text: taskStartLine(executionId, flowId),
          sequence: 0,
          terminal: false,
        };
        tasks.set(sessionKey, task);
        dispatchSendCard(task, chatId, cardJson, tasks);
      }
      return { sent: true };
    }

    if (type === "progress") {
      if (!task) return { updated: false };
      task.text += log ? `\n${log}` : `\n状态：${status ?? "running"}`;
      task.sequence += 1;
      updateCardWithRetry({
        cardId: task.cardId,
        content: capContent(task.text),
        sequence: task.sequence,
      });
      return { updated: true };
    }

    if (type === "completed") {
      if (task) {
        // 终态含执行 id + 产物/输出（REQ-AGENT-020 标准 1/2；缺口 4：任务卡片
        // 终态补产物行——execution 记录 output/artifacts 字段，经 execution:completed
        // 事件承载；事件未带则保持原终态行不变）。
        task.text += taskTerminalLine(executionId ?? task.executionId, status, { output, artifacts });
        task.sequence += 1;
        task.terminal = true;
        // 终态更新（含执行 id，可 /status 复核）；失败 → 告警，不阻断执行。
        updateCardWithRetry({
          cardId: task.cardId,
          content: capContent(task.text),
          sequence: task.sequence,
        });
        // 任务终态 → 卡片定型（「[任务执行中...]」与回复卡片同根缺陷，BUG-004）。
        finalizeStreamCard(task);
        tasks.delete(sessionKey);
      }
      // 执行结果经对话回投（REQ-AGENT-020 标准 3：会话活跃时——agent 生成摘要）。
      notifyExecutionResult(sessionKey, {
        executionId: executionId ?? task?.executionId,
        status,
        output,
        artifacts,
      });
      return { terminal: true };
    }

    return {};
  }

  // 执行结果回投（REQ-AGENT-020 标准 3：会话活跃时 onExecutionResult 驱动 agent
  // 生成执行摘要）；回投失败不阻断（会话侧自行处理）。
  function notifyExecutionResult(sessionKey, result) {
    const session = sessions[sessionKey];
    if (!session || typeof session.onExecutionResult !== "function") return;
    try {
      const returned = session.onExecutionResult(result);
      if (returned && typeof returned.catch === "function") returned.catch(() => {});
    } catch {
      // 回投失败不阻断（会话侧自行处理）。
    }
  }

  return {
    warnings,
    handleStreamEvent,
    handleExecutionEvent,
  };
}
