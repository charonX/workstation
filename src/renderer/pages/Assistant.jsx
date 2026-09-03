// src/renderer/pages/Assistant.jsx
// 会话区页面（ADR-018 双区模型 / REQ-AGENT-026 AC1）：双栏布局（会话列表 + 对话窗），
// 默认落地（启动 URL #/assistant）。承担会话区全部状态编排：
// - 会话列表（GET /api/agent/sessions，前台低频轮询刷新 lastActiveAt/标题，F2）；
// - 选中会话 → 历史（GET messages）+ 确认全量（GET confirmations，U-1）+ SSE 订阅
//   （F2：断线重连后先全量对齐再续流——EventSource 原生自动重连，onOpen 对齐）；
// - 发送（F1：202 受理 + 用户气泡即时出现 + SSE 流式渲染 text_start/delta/end）；
// - UI 空间 /reset（或 /clear）= 同分组新建会话并切换（F4，裁决 7：composer 触发）；
// - 内联确认卡（REQ-AGENT-030：渲染/确认/拒绝/稍后处理/已处理态，U-1 全量重建）；
// - 只读（飞书/孤儿）与未配置引导态（§8 错误态）。
//
// 文案契约：五套 E2E 断言中文文案（assistantSessions/Feishu 的「通用」「新对话」
// 「飞书会话 · 请到飞书继续对话」「项目已删除」等），故会话区文案按中文原型直写；
// en-US 直译观感入 REFLECT（照 builtin-agent 签核裁决 2 惯例，偏差见 build-progress）。

import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  listSessions,
  createSession,
  resetSession,
  getMessages,
  sendMessage,
  stopSession,
  listConfirmations,
  approveConfirmation,
  rejectConfirmation,
  subscribeSessionEvents,
  getSessionMode,
  setSessionMode,
  setLastMode,
  getSessionProvider,
  setSessionProvider,
} from "../api/agentSessions.js";
import { getAgentConfig } from "../api/agent.js";
import { ensureCatalog } from "../modelCatalog.js";
import SessionList from "../components/assistant/SessionList.jsx";
import ChatView from "../components/assistant/ChatView.jsx";
import BrowserPanel from "../components/browser/BrowserPanel.jsx";
import FilePreviewPanel from "../components/preview/FilePreviewPanel.jsx";
import FileTree from "../components/filetree/FileTree.jsx";
import { filePreviewStore } from "../components/preview/filePreviewBus.js";
import "../components/assistant/assistant.css";

const PROJECT_PREFIX_RE = /^ui:project:([^:]+):/;
const POLL_MS = 10 * 1000;
// 流式光标 settle（见选中会话 effect 内 text_end 处理注释）。
const STREAM_SETTLE_MS = 1200;

// —— 工具事件归约（REQ-AGENT-052 / tech-design 接口 1：tool 元素生命周期）——
// 纯函数（无 React 依赖）：handleEvent 调用 + SSR 自验 harness 直接断言消息模型演化。
// 生命周期：start 创建（id=toolCallId，input=PI args）→ end|error 按 id 更新 →
// error 为终态（其后 end 不降级）→ error 无 toolCallId 匹配最近 running 块 →
// turn 结束时仍 running 的块由 markInterruptedTools 标记（text_end 防御）。
export function reduceToolEvent(prev, ev, now = Date.now()) {
  if (!ev || typeof ev.type !== "string") return prev;
  if (ev.type === "tool_execution_start") {
    // 标准 1：start 创建 tool 元素（默认收起态；输入摘要截断在 ToolCallBlock 展示层）。
    // 防御兜底：PI 原生 start 恒含 toolCallId（Slice 3 实证）；缺失时按时间戳生成。
    const id = typeof ev.toolCallId === "string" && ev.toolCallId ? ev.toolCallId : `tool-${now}`;
    return [
      ...prev,
      {
        kind: "tool",
        id,
        name: String(ev.name ?? "tool"),
        status: "running",
        input: ev.input,
        startedAt: now, // 内部字段：end/error 到达时计算 durationMs
      },
    ];
  }
  if (ev.type === "tool_execution_end") {
    // 标准 2/3/4：按 toolCallId 更新。isError:true 的 end → error 态（I-2）；
    // error 终态双保险：块已 error 时，其后到达的 completed end 不降级（I-2）。
    return prev.map((m) => {
      if (m.kind !== "tool" || m.id !== ev.toolCallId) return m;
      if (m.status === "error") return m; // error 终态：保留 errorCode/errorMessage 与 error 展示
      return {
        ...m,
        output: ev.output,
        status: ev.isError === true ? "error" : "completed",
        interrupted: false,
        durationMs: now - (m.startedAt ?? now),
      };
    });
  }
  if (ev.type === "tool_execution_error") {
    // 标准 3/5：error 事件无 toolCallId（toolAdapter.js:359 实证）→ 匹配该 turn
    // 最近一个 status:"running" 的 tool 块；SSE 层若未来补 toolCallId 则优先精确匹配
    // （tech-design 数据流 4）。error 为终态（其后 completed end 不再降级）。
    const hasId = typeof ev.toolCallId === "string" && ev.toolCallId;
    if (!hasId) {
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i];
        if (m.kind === "tool" && m.status === "running") {
          const next = [...prev];
          next[i] = {
            ...m,
            errorCode: ev.errorCode,
            errorMessage: ev.errorMessage,
            status: "error",
            interrupted: false,
            durationMs: now - (m.startedAt ?? now),
          };
          return next;
        }
      }
      return prev; // 无 running 块（防御）：忽略
    }
    return prev.map((m) => {
      if (m.kind !== "tool" || m.id !== ev.toolCallId || m.status !== "running") return m;
      return {
        ...m,
        errorCode: ev.errorCode,
        errorMessage: ev.errorMessage,
        status: "error",
        interrupted: false,
        durationMs: now - (m.startedAt ?? now),
      };
    });
  }
  return prev;
}

// text_end 防御（接口 1 / REQ-AGENT-052 标准 6）：turn 结束时仍 running 的 tool 块
// 标记 interrupted（防御：turn 结束未收到 end）。状态枚举保持签核契约
// running|completed|error 不变——以 running + interrupted 标记表达（视觉态由
// ToolCallBlock 渲染为"已中断"；迟到的 end/error 仍可正确收尾该块）。
export function markInterruptedTools(messages) {
  let changed = false;
  const next = messages.map((m) => {
    if (m.kind === "tool" && m.status === "running" && !m.interrupted) {
      changed = true;
      return { ...m, interrupted: true };
    }
    return m;
  });
  return changed ? next : messages;
}

// —— 执行状态归约（REQ-AGENT-056 标准 2 / tech-design 增量 v0.3 数据流 4）——
// 纯 renderer 推导（零新数据）：running 工具计数——tool_execution_start +1 /
// end|error −1（floor 0）/ text_end 归零（turn 完成——仍 running 的工具已由
// markInterruptedTools 标记中断，不再计入执行中）。导出供 SSR 自验 harness
// 直接断言事件序列驱动。
export function reduceExecState(prev, ev) {
  if (!ev || typeof ev.type !== "string") return prev;
  if (ev.type === "tool_execution_start") return prev + 1;
  if (ev.type === "tool_execution_end" || ev.type === "tool_execution_error") return Math.max(0, prev - 1);
  if (ev.type === "text_end") return 0;
  return prev;
}

// 执行状态三态派生（StatusBar 输入）：工具执行中优先于回复中（工具常在流式内
// 执行）；text_end 归零 + streaming=false → 空闲。
export function execStateOf({ streaming, toolActive }) {
  return toolActive > 0 ? "tool" : streaming ? "replying" : "idle";
}

// —— 空间语义（ADR-016 spaceKey 语法 + CONTEXT.md 会话区/通用空间/项目空间/孤儿会话）——
// 返回 { kind, name（空态空间名）, badge（徽标）, readonly, reason? }。
function spaceOf(key, sessions) {
  if (!key) return { kind: "general", name: "通用", badge: "通用", readonly: false };
  if (key.startsWith("ui:copilot:")) {
    return { kind: "general", name: "通用", badge: "通用", readonly: false };
  }
  const m = PROJECT_PREFIX_RE.exec(key);
  if (m) {
    const group = (sessions?.projects ?? []).find((p) => p.projectId === m[1]);
    if (group && !group.orphan) {
      return {
        kind: "project",
        name: `项目 · ${group.projectName}`,
        badge: `项目 · ${group.projectName}`,
        readonly: false,
      };
    }
    // 孤儿会话（U-1 前端映射）：projectName=null →「项目已删除」占位 + 划线 + 输入禁用
    return { kind: "orphan", name: "项目已删除", badge: "项目已删除", readonly: true, reason: "项目已删除，仅可回看" };
  }
  if (key.startsWith("feishu:")) {
    const s = (sessions?.feishu ?? []).find((x) => x.spaceKey === key);
    return {
      kind: "feishu",
      name: s?.displayName ?? s?.title ?? key,
      badge: "飞书 · 只读",
      readonly: true,
      reason: "飞书会话 · 请到飞书继续对话",
    };
  }
  return { kind: "general", name: "通用", badge: "通用", readonly: false };
}

function findSession(key, sessions) {
  if (!key || !sessions) return null;
  return (
    sessions.general.find((s) => s.spaceKey === key) ??
    sessions.projects.flatMap((p) => p.sessions).find((s) => s.spaceKey === key) ??
    sessions.feishu.find((s) => s.spaceKey === key) ??
    null
  );
}

// 最近活跃会话（PRD §6.2 S1 分支：有会话 → 恢复 lastActiveAt 最大者）。
function mostRecentSession(sessions) {
  if (!sessions) return null;
  const all = [
    ...(sessions.general ?? []),
    ...(sessions.projects ?? []).flatMap((p) => p.sessions),
    ...(sessions.feishu ?? []),
  ];
  if (all.length === 0) return null;
  return all.reduce((a, b) => (String(b.lastActiveAt) > String(a.lastActiveAt) ? b : a));
}

export default function Assistant() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [messages, setMessages] = useState([]);
  const [confirmations, setConfirmations] = useState([]);
  // —— agent 配置（Slice 5 升级）：全量 { identity, providers, defaultModel }——
  // 会话模型选择器（REQ-AGENT-094）与视觉判定（REQ-AGENT-098）的数据源；
  // 前台轮询刷新（Settings 变更即时反映，§7.1「settings 变更后选择器即时反映」）。
  const [agentConfig, setAgentConfig] = useState(null); // null = 未加载（不判定未配置）
  // 会话级 provider/model（REQ-AGENT-093/094）：GET provider 取位（NULL → 默认组合）；
  // 工具栏切换乐观更新 + PUT 持久化 + 失败回退。
  const [sessionModel, setSessionModel] = useState(null); // { provider, model } | null
  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

  // —— 状态栏数据（REQ-AGENT-056）：git 分支 + 上下文用量 + 执行状态（tool 计数）——
  // git = SSE session-git（路由 attach 补推 + createSession 推送，同源幂等）；
  // context = SSE session-stats（worker 周期推送转发）；toolActive = 工具事件驱动
  // 计数（reduceExecState）。切会话清理（标准 6：分支/上下文跟随新会话重新就绪）。
  const [gitState, setGitState] = useState(null);
  const [contextUsage, setContextUsage] = useState(null);
  const [toolActive, setToolActive] = useState(0);

  // —— 会话模式（REQ-AGENT-071/072，Slice 4）：工具栏数据面——当前会话模式 +
  // 熔断降级提示。初始取位 = GET mode（未显式切过 = lastMode，首次 auto——
  // renderer 默认值与服务端首次默认一致，取位完成后覆盖）；切换 = PUT mode
  // （乐观更新 + 失败回退）。modeNotice = S3 mode-degraded 事件文案（「auto
  // 暂停」提示，REQ-AGENT-075 标准 2 呈现面）。
  const [sessionMode, setSessionModeState] = useState("auto");
  const [modeNotice, setModeNotice] = useState(null);
  const sessionModeRef = useRef("auto");
  // 轨迹 live 事件（REQ-AGENT-134）：SSE trajectory-record 事件转发到 TrajectoryView。
  const [liveTrajectoryRecord, setLiveTrajectoryRecord] = useState(null);
  useEffect(() => {
    sessionModeRef.current = sessionMode;
  }, [sessionMode]);

  // 忙碌/流式镜像（双击防护与 SSE 回调读当前值，避免闭包陈旧）。
  const streamingRef = useRef(false);
  const setStreamingBoth = useCallback((v) => {
    streamingRef.current = v;
    setStreaming(v);
  }, []);
  const selectedKeyRef = useRef(null);
  useEffect(() => {
    selectedKeyRef.current = selectedKey;
  }, [selectedKey]);

  // SSE 流就绪镜像（F2 语义）：发送前等待「连接建立 + 全量对齐完成」——SSE 只推
  // 增量、不做事件回溯，断线重连窗口内发送会丢流式事件（仅能靠重连后的全量对齐
  // 恢复历史，恢复不了流式动画）。EventSource 断线重连有秒级退避（约 3s），发送
  // 等待对齐完成保证「重连后收发恢复正常」（REQ-AGENT-028 AC5 E2E），且对齐先于
  // 用户气泡追加（不丢乐观气泡）。
  const alignedRef = useRef(false);
  // 流式 delta 累积缓冲（rAF 节流 flush；见选中会话 effect 内注释）。
  const streamBufRef = useRef(null);
  const waitForStreamReady = useCallback(() => {
    if (alignedRef.current) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (alignedRef.current) {
          clearInterval(timer);
          clearTimeout(fallback);
          resolve();
        }
      }, 50);
      const fallback = setTimeout(() => {
        // 兜底：连接迟迟未建立（服务不可达等）不阻塞发送——事件丢失由重连对齐兜底。
        clearInterval(timer);
        resolve();
      }, 8000);
    });
  }, []);

  // 自动恢复最近活跃会话仅发生在首次列表加载（后续轮询/刷新不覆盖用户选择）。
  const autoSelectedRef = useRef(false);

  // —— 会话列表 + agent 配置（前台低频轮询；tech-design F2 列表刷新）——
  const refreshSessions = useCallback(async () => {
    try {
      const data = await listSessions();
      setSessions(data);
      if (!autoSelectedRef.current) {
        autoSelectedRef.current = true;
        const recent = mostRecentSession(data);
        if (recent) setSelectedKey(recent.spaceKey);
      }
    } catch {
      // 服务未就绪：忽略，下轮重试。
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const loadConfig = async () => {
      try {
        const cfg = await getAgentConfig();
        if (!disposed) setAgentConfig(cfg);
      } catch {
        // 同上。
      }
    };
    // 会话区加载时 GET catalog（REQ-AGENT-102，v0.6）：视觉判定数据源 = catalog
    // 端点（模块级内存缓存 + in-flight 去重——Settings/Composer 共享同一次 GET）；
    // 加载失败 → 模块缓存保持 null → Composer 附加/发送复核按「保守拒绝」处理
    //（imageAttachmentUi 标准 9：不静默放行）。失败不阻塞会话区（静默，Composer
    // 判定时兜底重试）。
    ensureCatalog().catch(() => {});
    refreshSessions();
    loadConfig();
    const timer = setInterval(() => {
      refreshSessions();
      loadConfig();
    }, POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [refreshSessions]);

  // —— 选中会话：历史 + 确认全量 + SSE（F2 断线重连：onOpen 先 GET messages 全量
  // 对齐再续流——SSE 只推增量，不做事件回溯；切会话关旧连接开新连接）——
  useEffect(() => {
    if (!selectedKey) {
      setMessages([]);
      setConfirmations([]);
      return;
    }
    // 切会话清理（REQ-AGENT-056 标准 6）：git 分支/上下文用量/执行状态跟随新会话
    // 重新就绪——新连接 SSE attach 即补推 session-git；session-stats 随 worker 周期
    // 推送到达（未到前显示占位，E7 不阻塞）。
    setGitState(null);
    setContextUsage(null);
    setToolActive(0);
    // 切会话清理（Slice 4）：模式为会话级状态——复位默认 + 清降级提示，随后
    // 经 GET mode 取该会话当前模式（未显式切过 = lastMode，REQ-AGENT-072 标准 2）。
    setSessionModeState("auto");
    setModeNotice(null);
    // 切会话清理（Slice 5）：会话 provider 为会话级状态——复位，随后经 GET
    // provider 取该会话当前组合（行 NULL → 默认组合，REQ-AGENT-093/095）。
    setSessionModel(null);
    // BUG-004（2026-08-09）：切会话必须归零 streaming/execState——否则上个会话的
    // 流式/执行状态跨会话残留（composer 永远「回复中…」禁用、状态栏不跟随切换）。
    // execStateOf({streaming:false, toolActive:0}) → idle，新会话输入框立即可用。
    setStreamingBoth(false);
    let disposed = false;
    alignedRef.current = false; // 新会话：对齐未完成（发送前等待）

    const align = async () => {
      try {
        const [hist, confs] = await Promise.all([getMessages(selectedKey), listConfirmations()]);
        if (disposed) return;
        const next = (hist.messages ?? []).map((m) => ({
          kind: "text", // 接口 1 消息模型：text 元素类型化（工具不落历史 → 无 tool 元素，B8）
          id: m.messageId ?? `${m.role}-${m.createdAt}`,
          role: m.role,
          text: m.text ?? "",
          streaming: false,
          // BUG-008：createdAt 随历史入渲染态——确认卡时间序内联的消息侧时间源
          //（chronology.js 归并；此前仅用于 id 推导未入状态，卡无法按序插位）。
          createdAt: m.createdAt,
        }));
        setMessages(next);
        setConfirmations((confs.confirmations ?? []).filter((c) => c.sessionKey === selectedKey));
        return true;
      } catch {
        // 对齐失败（会话被重置/服务重启）：保持现状，SSE 重连兜底。
        return false;
      }
    };

    // 流式 delta 累积缓冲（rAF 节流 flush）：FAUX 高速流（默认 1000 事件/秒）下
    // 逐事件 setState 会以每秒千次触发 React 重渲染，主线程饱和——流式体感卡顿
    // 且外部观测（E2E 断言 streaming 属性 / 体感）不可靠。累积到缓冲（组件级
    // streamBufRef）、每帧（requestAnimationFrame）flush 一次：渲染 ~60fps，
    // 主线程保持响应。
    let flushScheduled = false;

    const flushDelta = () => {
      flushScheduled = false;
      const buf = streamBufRef.current;
      if (!buf) return;
      const text = buf.text;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "agent" && last.streaming) {
          next[next.length - 1] = { ...last, text };
        }
        return next;
      });
    };

    const handleEvent = (ev) => {
      if (!ev || typeof ev.type !== "string") return;
      if (ev.type === "text_start") {
        // 轮次边界（SSE 层宣告）：新 agent 气泡进入流式态（data-streaming='true'）。
        const id = `agent-${Date.now()}`;
        streamBufRef.current = { text: "", id };
        setStreamingBoth(true);
        setMessages((prev) => [...prev, { kind: "text", id, role: "agent", text: "", streaming: true, createdAt: new Date().toISOString() }]);
      } else if (ev.type === "text_delta") {
        const delta = typeof ev.delta === "string" ? ev.delta : "";
        const buf = streamBufRef.current;
        if (buf) {
          buf.text += delta;
          if (!flushScheduled) {
            flushScheduled = true;
            requestAnimationFrame(flushDelta);
          }
        } else {
          // 防御兜底（对齐竞态后首个 delta 无流式气泡）：开新气泡续流。
          setMessages((prev) => [...prev, { kind: "text", id: `agent-${Date.now()}`, role: "agent", text: delta, streaming: true, createdAt: new Date().toISOString() }]);
        }
      } else if (ev.type === "text_end") {
        const endedId = streamBufRef.current?.id ?? null;
        const remaining = streamBufRef.current?.text ?? null;
        streamBufRef.current = null;
        flushScheduled = false; // 挂起 rAF 已无缓冲可 flush（文本在此兜底落盘）
        setStreamingBoth(false);
        // 执行状态归零（REQ-AGENT-056 标准 2）：turn 完成——仍 running 的工具
        // 已由 markInterruptedTools 标记中断，不再计入执行中（迟到的 end 幂等）。
        setToolActive(0);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "agent" && last.streaming) {
            // text_end 时可能有 rAF 挂起未 flush 的累积 delta——兜底落盘，防尾字丢失。
            // meta（REQ-AGENT-057 接口 6）：text_end 携带 → 完成态消息展示（流式
            // settle 结束后 MessageList 渲染 msg-meta；FAUX usage 空 → 显示「-」）。
            next[next.length - 1] = { ...last, text: remaining ?? last.text, meta: ev.meta ?? null };
          }
          // text_end 防御（接口 1 / REQ-AGENT-052 标准 6）：turn 结束时仍 running 的
          // tool 块标记 interrupted（防御：turn 结束未收到 end——块不悬挂）。
          return markInterruptedTools(next);
        });
        // 流式光标 settle（STREAM_SETTLE_MS）：text_end 后保持 data-streaming 一小段
        // ——cursor 收尾观感 + 短流可感知（FAUX 默认 TPS 下完整轮次仅 ~100ms，逐字
        // 渲染对人与外部观测均不可见；settle 把流式窗口延长到可感知/可断言范围）。
        // 按轮次 id 定位收尾（新轮次 text_start 已追加新气泡时不误伤）。
        setTimeout(() => {
          if (disposed || !endedId) return;
          setMessages((prev) => prev.map((m) => (m.id === endedId ? { ...m, streaming: false } : m)));
        }, STREAM_SETTLE_MS);
      } else if (ev.type === "confirmation-pending") {
        // 新挂起行（SSE 增量）：全量对齐确认列表（U-1 同源；SSE 只推增量）。
        listConfirmations()
          .then((confs) => {
            if (disposed) return;
            setConfirmations((confs.confirmations ?? []).filter((c) => c.sessionKey === selectedKey));
          })
          .catch(() => {});
      } else if (ev.type === "tool_execution_start" || ev.type === "tool_execution_end" || ev.type === "tool_execution_error") {
        // 工具调用折叠块（REQ-AGENT-052 / tech-design 数据流 3/4）：现零消费 →
        // start 创建 tool 消息元素 / end|error 按 toolCallId 更新 / error 无 id 匹配
        // 最近 running / error 终态（其后 end 不降级）。纯归约函数（模块级导出，
        // SSR 自验 seam）。工具事件为离散增量，不经 rAF 缓冲（text 路径不变）。
        // 执行状态（REQ-AGENT-056 标准 2）：start +1 / end|error −1（floor 0）。
        setToolActive((n) => reduceExecState(n, ev));
        setMessages((prev) => reduceToolEvent(prev, ev));
      } else if (ev.type === "session-git") {
        // 状态栏 git 分支（REQ-AGENT-056 标准 3/6）：SSE 路由 attach 补推 + 主进程
        // createSession 推送，同源同形幂等——打开/切换/重连即达。
        setGitState({
          state: ev.state === "branch" || ev.state === "detached" ? ev.state : "none",
          branch: typeof ev.branch === "string" ? ev.branch : undefined,
        });
      } else if (ev.type === "session-stats") {
        // 状态栏上下文用量（REQ-AGENT-056 标准 4/5）：worker 周期推送的
        // contextUsage（tokens/contextWindow/percent；压缩后 tokens null → 占位）。
        // 空态帧（sessionKey null）不转发 renderer → 保持上一值。
        setContextUsage(ev.contextUsage ?? null);
      } else if (ev.type === "mode-degraded") {
        // Slice 3 熔断降级数据面 → S4 呈现（REQ-AGENT-075 标准 2）：模式回
        // standard（会话状态与 lastMode 已由主进程双写）+ 「auto 暂停」提示
        //（呈现形态 = 工具栏行内提示，非 toast/banner）。
        if (typeof ev.mode === "string" && ev.mode) setSessionModeState(ev.mode);
        if (typeof ev.reason === "string" && ev.reason) setModeNotice(ev.reason);
      } else if (ev.type === "session-error") {
        setStreamingBoth(false);
      } else if (ev.type === "trajectory-record") {
        // 轨迹 live 事件（REQ-AGENT-134 / ADR-038）：trajectory-record SSE 转发给 TrajectoryView。
        const rec = ev.record ?? ev.event;
        if (rec) {
          setLiveTrajectoryRecord({
            ...rec,
            sessionKey: ev.sessionKey || rec.sessionKey || selectedKey,
          });
        }
      } else if (ev.type === "file-preview-changed") {
        // 文件预览变更推送（REQ-PREVIEW-009 / ADR-042 决策 1：复用既有会话 SSE
        // 连接）——帧原样转发预览面板 store 消费（不匹配当前打开文件 → store 忽略）。
        filePreviewStore.handleSseEvent(ev);
      }
    };

    // 模式取位（Slice 4，REQ-AGENT-071/072）：进入/切换会话取当前模式（服务端
    // 未显式切过 = lastMode；新会话首次 = auto）。SSE 只推增量不做事件回溯，
    // 初始模式经 GET 对齐（不依赖事件流）。
    getSessionMode(selectedKey)
      .then((r) => {
        if (!disposed && typeof r?.mode === "string" && r.mode) setSessionModeState(r.mode);
      })
      .catch(() => {
        // 取位失败（服务未就绪等）：保持默认值，SSE 重连/下次切换兜底。
      });

    // 会话 provider 取位（Slice 5，REQ-AGENT-093/094）：进入/切换会话取当前组合
    //（行值优先；NULL → 默认组合）。空配置（providers 空）→ 服务端回落空串 →
    // 归一为 null（选择器触发按钮禁用 + E12 引导提示）。
    getSessionProvider(selectedKey)
      .then((r) => {
        if (disposed) return;
        const sm =
          r && typeof r.provider === "string" && r.provider !== "" && typeof r.model === "string" && r.model !== ""
            ? { provider: r.provider, model: r.model }
            : null;
        setSessionModel(sm);
      })
      .catch(() => {
        // 取位失败：保持 null（选择器显示占位，切换/下次取位兜底）。
      });

    align();
    const unsubscribe = subscribeSessionEvents(selectedKey, {
      onOpen: () => {
        // 就绪标记只由「本连接的 onOpen 对齐」置位：断线重连后先全量对齐再续流
        // （F2），发送等待它——effect 首渲染对齐（连接可能尚未建立/已断）不置位。
        if (!disposed) align().then((ok) => { if (ok) alignedRef.current = true; });
        // 文件预览断线重连兜底（REQ-PREVIEW-009 AC5：SSE 只推增量不做回溯，
        // 重连后主动 re-read 当前文件一次；面板未打开时 store 内为安全 no-op）。
        void filePreviewStore.refresh();
      },
      onEvent: (ev) => {
        if (!disposed) handleEvent(ev);
      },
      onError: () => {
        alignedRef.current = false; // 断线：EventSource 自动重连，发送将等待重连后对齐
      },
    });
    return () => {
      disposed = true;
      unsubscribe();
      // 会话切换/页面卸载 → 文件预览面板收起并注销 watch（§10.3 流A 步骤4
      // 「切换会话 → DELETE 注销」，句柄不泄漏；面板未打开时为安全 no-op）。
      void filePreviewStore.close();
    };
  }, [selectedKey, setStreamingBoth]);

  // —— 列表交互 ——
  const handleSelectSession = useCallback((session) => {
    setSelectedKey(session.spaceKey);
  }, []);

  const handleToggleProject = useCallback((projectId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  // 顶部「新对话」= 通用空间新对话（业务规则 7.1 / F4）→ 建行 + 切换选中（空态）。
  const handleNewChat = useCallback(async () => {
    try {
      const res = await createSession({ spaceKind: "general" });
      await refreshSessions();
      setSelectedKey(res.spaceKey);
    } catch {
      // 建会话失败（服务未就绪）：保持现状。
    }
  }, [refreshSessions]);

  // 项目行内「＋」= 该项目空间新对话（悬停显现；已删除项目行无）→ 建行 + 展开分组 + 切换选中。
  const handleAddProject = useCallback(
    async (project) => {
      try {
        const res = await createSession({ spaceKind: "project", projectId: project.projectId });
        await refreshSessions();
        setExpanded((prev) => new Set(prev).add(project.projectId));
        setSelectedKey(res.spaceKey);
      } catch {
        // 同上。
      }
    },
    [refreshSessions]
  );

  // ⚙ 设置 → 管理区（ADR-018：旧壳原样 + 顶部返回对话；落 Settings 页与原型一致）。
  const handleOpenAdmin = useCallback(() => {
    navigate("/settings");
  }, [navigate]);

  // —— 对话收发 ——
  // UI 空间 /reset（或 /clear）= 同分组新建会话并切换（F4，裁决 7：composer 发斜杠
  // 命令触发，无专门按钮）：旧行保留可回看可继续（REQ-AGENT-027 标准 4）。
  const handleReset = useCallback(
    async (key) => {
      try {
        const res = await resetSession(key);
        await refreshSessions();
        setSelectedKey(res.spaceKey);
      } catch {
        // 重置失败（feishu 403 / 会话不存在）：保持现状。
      }
    },
    [refreshSessions]
  );

  const handleSend = useCallback(
    async (raw, attachments) => {
      const text = String(raw ?? "").trim();
      const atts = Array.isArray(attachments) && attachments.length > 0 ? attachments : undefined;
      // 空文本 + 附件 = 纯图片消息（REQ-AGENT-098：POST 允许空文本 + 附件）。
      if ((text === "" && !atts) || streamingRef.current) return;
      const key = selectedKeyRef.current;
      if (text === "/reset" || text === "/clear") {
        if (key) await handleReset(key);
        return;
      }
      if (!key) {
        // 全新应用（无任何会话）首条消息：归属通用空间（业务规则 7.1）。
        try {
          const res = await createSession({ spaceKind: "general" });
          await refreshSessions();
          setSelectedKey(res.spaceKey);
          selectedKeyRef.current = res.spaceKey;
        } catch {
          return;
        }
        return handleSend(raw, attachments);
      }
      setStreamingBoth(true);
      // 发送前等 SSE 流就绪（F2：断线重连窗口内发送会丢流式事件；等待连接恢复后
      // 再发——「重连后收发恢复正常」，REQ-AGENT-028 AC5）。
      await waitForStreamReady();
      // 用户气泡即时出现（S3 操作流 1）：乐观追加，不等 POST 受理——首条消息的
      // POST 在 agent 子进程就绪后才受理（worker spawn 秒级），等到响应再追加会
      // 把用户气泡排在 agent 回复之后（顺序错乱 + 流式窗口错过）。
      // dedupe 防 align 竞态重复渲染（align 已含该消息时不再追加）；附件消息按
      // 文本 + 附件数量匹配（纯图片消息 text 为空，数量防误去重）。
      setMessages((prev) =>
        prev.some(
          (m) =>
            m.role === "user" &&
            m.text === text &&
            (m.attachments?.length ?? 0) === (atts?.length ?? 0)
        )
          ? prev
          : [
              ...prev,
              {
                kind: "text",
                id: `user-${Date.now()}`,
                role: "user",
                text,
                attachments: atts,
                streaming: false,
                createdAt: new Date().toISOString(),
              },
            ]
      );
      try {
        await sendMessage(key, text, atts);
      } catch {
        // 发送失败（网络/服务）：失败气泡标注（§8），按钮恢复。
        setStreamingBoth(false);
        setMessages((prev) => [
          ...prev,
          { kind: "text", id: `err-${Date.now()}`, role: "agent", text: "发送失败，请稍后重试", streaming: false, createdAt: new Date().toISOString() },
        ]);
      }
    },
    [handleReset, refreshSessions, setStreamingBoth, waitForStreamReady]
  );

  // —— 内联确认卡（REQ-AGENT-030）：确认/拒绝 → 既有端点 → 结果经 SSE 流式回投；
  // 卡片按响应置已处理态（data-state='done'，按钮移除）。——
  const handleApprove = useCallback(async (c) => {
    try {
      await approveConfirmation(c.confirmId);
      setConfirmations((prev) =>
        prev.map((x) => (x.confirmId === c.confirmId ? { ...x, status: "approved" } : x))
      );
    } catch {
      // 回调失败：保持 pending 可重试（幂等语义由确认服务保证）。
    }
  }, []);

  const handleReject = useCallback(async (c) => {
    try {
      await rejectConfirmation(c.confirmId);
      setConfirmations((prev) =>
        prev.map((x) => (x.confirmId === c.confirmId ? { ...x, status: "rejected" } : x))
      );
    } catch {
      // 同上。
    }
  }, []);

  // —— 模式切换（REQ-AGENT-071，Slice 4）：乐观更新（切换即生效，标准 5——
  // auto 无额外提示）+ PUT 持久化；失败回退上一档。手动切换清除熔断降级提示
  // （REQ-AGENT-075 标准 4：用户手动切回恢复）。
  // BUG-001（裁决 A）：无会话（selectedKey 为 null，还没选/建会话）时切换不再
  // 静默丢弃——「模式」即全局默认，切换 = 改全局 lastMode（PUT /api/agent/mode/last
  // 落盘）；后续新建会话经 GET 取位 = 新 lastMode（修复前：!key 直接 return →
  // 服务端从未收到 PUT，发送首条消息建会话后取位 = 旧 lastMode → UI 回 auto）。
  const handleModeChange = useCallback(async (mode) => {
    const key = selectedKeyRef.current;
    const prev = sessionModeRef.current;
    setSessionModeState(mode);
    setModeNotice(null);
    try {
      const res = key
        ? await setSessionMode(key, mode)
        : await setLastMode(mode);
      if (res && typeof res.mode === "string" && res.mode) {
        // 有会话路径：响应落地前用户可能已切会话（模式为会话级状态）——仅当
        // 仍是原会话时应用；无会话路径：无会话可切走，直接应用生效值。
        if (!key || selectedKeyRef.current === key) setSessionModeState(res.mode);
      }
    } catch {
      // 切换失败（服务未就绪等）：回退显示原档（服务端状态未变）。
      if (selectedKeyRef.current === key) setSessionModeState(prev);
    }
  }, []);

  // —— 会话 provider 切换（REQ-AGENT-093/094，Slice 5）：工具栏模型选择器选择 →
  // 乐观更新（trigger/高亮立即移动）+ PUT provider 持久化（下一条消息生效，历史
  // 保留）；失败回退原组合（E4：切换失败保持原 provider）。无会话（selectedKey
  // 为 null）→ 切换落默认组合（GET provider 回读 = 默认，选择器仅展示）。
  const handleModelChange = useCallback(async (provider, model) => {
    const key = selectedKeyRef.current;
    const prev = sessionModel;
    setSessionModel({ provider, model });
    try {
      const res = await (key
        ? setSessionProvider(key, provider, model)
        : Promise.resolve({ provider, model }));
      if (res && typeof res.provider === "string" && typeof res.model === "string") {
        // 响应落地前用户可能已切会话（组合为会话级状态）——仅当仍是原会话时应用。
        if (!key || selectedKeyRef.current === key) {
          setSessionModel({ provider: res.provider, model: res.model });
        }
      }
    } catch {
      // 切换失败（组合不在条目 E-MODEL-CONFIG-MISSING / key 失效 E-MODEL-KEY-FAIL /
      // 服务未就绪）：回退原组合（服务端状态未变）。
      if (selectedKeyRef.current === key) setSessionModel(prev);
    }
  }, [sessionModel]);

  // —— 右栏派生 ——
  const space = spaceOf(selectedKey, sessions);
  const selectedSession = findSession(selectedKey, sessions);
  const chatTitle = selectedSession?.title ?? "新对话";
  const showEmpty = messages.length === 0;
  // Slice 5 派生：provider 条目/默认组合归一（agentConfig 未加载 → 空列表/null）。
  const providers = agentConfig?.providers ?? [];
  const defaultModel = agentConfig?.defaultModel ?? null;
  // 未配置判定（Slice 5 升级）：配置未加载（null）→ 不算未配置（保持既有行为）；
  // 已加载 → 任一条目持有 key（configured:true）即已配置。
  const unconfigured = agentConfig !== null && !providers.some((p) => p.configured === true);
  // 会话当前组合（REQ-AGENT-098 E11 判定输入）：会话模型优先（行值/切换），
  // 未取位回落默认组合；视觉能力判定在 Composer 侧完成——数据源 = catalog 端点
  //（REQ-AGENT-102，v0.6：附加时判定 + 发送复核经 ensureCatalog/isVisionModel，
  // modelCapabilities.js 手写镜像表已移除）。
  // 图片解析根（REQ-AGENT-051 / I-5 口径）：项目空间会话（ui:project:<pid>:<sid>）→
  // projectId——主进程按 projects 表 registry 解析实际项目目录（renderer 不持有
  // 绝对路径，白名单判定在主进程）；通用/飞书/孤儿空间 → undefined（无解析根 →
  // Markdown 语法图片占位、裸路径回退原文）。
  const selectedProjectDir = (() => {
    const m = PROJECT_PREFIX_RE.exec(selectedKey ?? "");
    return m ? m[1] : undefined;
  })();

  // 执行状态（REQ-AGENT-056 标准 2）：工具执行中 > 回复中 > 空闲（纯推导）。
  const execState = execStateOf({ streaming, toolActive });

  return (
    <div className="assistant-zone" data-testid="screen-assistant">
      <SessionList
        sessions={sessions}
        selectedKey={selectedKey}
        expanded={expanded}
        onToggleProject={handleToggleProject}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onAddProject={handleAddProject}
        onOpenAdmin={handleOpenAdmin}
      />
      {/* 文件树边栏（REQ-PREVIEW-007）：会话列表与对话窗之间的左侧栏，
          开合状态经 filePreviewBus 模块级总线共享（ChatView 头部「🗂 文件」
          按钮驱动）；收起 = 不渲染 */}
      <FileTree />
      <ChatView
        chatTitle={chatTitle}
        spaceBadge={space.badge}
        messages={messages}
        confirmations={confirmations}
        onApprove={handleApprove}
        onReject={handleReject}
        showEmpty={showEmpty}
        emptySpaceName={space.name}
        unconfigured={unconfigured}
        onGoConfigure={() => navigate("/settings", { state: { agentTab: true } })}
        composer={{
          readonly: space.readonly,
          readonlyReason: space.reason ?? "飞书会话 · 请到飞书继续对话",
          disabled: unconfigured,
          busy: streaming,
        }}
        onSend={handleSend}
        // REQ-AGENT-091（BUG-010）：流式中停止键 → POST stop（202 受理）；
        // streaming 复位走既有 SSE text_end 链，本地不抢跑。失败静默（停止是
        // 幂等安全操作，目标状态 =「不在生成」，网络失败时用户可再点）。
        onStop={() => {
          if (selectedKey) stopSession(selectedKey).catch(() => {});
        }}
        projectDir={selectedProjectDir}
        execState={execState}
        gitState={gitState}
        contextUsage={contextUsage}
        mode={sessionMode}
        onModeChange={handleModeChange}
        modeNotice={modeNotice}
        providers={providers}
        defaultModel={defaultModel}
        sessionModel={sessionModel}
        onModelChange={handleModelChange}
        spaceKey={selectedKey}
        liveTrajectoryRecord={liveTrajectoryRecord}
      />
      {/* 内置浏览器面板（REQ-BROWSER-001/003/004）：会话区右栏第三列，
          默认收起；开合状态经 browserPanelStore 模块级总线共享（ChatView 头部
          按钮 / MarkdownRenderer 链接 / agent panel-request-open 事件驱动） */}
      <BrowserPanel />
      {/* 文件预览面板（REQ-PREVIEW-001）：会话区右栏槽位，与浏览器面板互斥
          （ADR-042 决策 2，互斥接线在 filePreviewBus 模块级）；收起 = 不渲染 */}
      <FilePreviewPanel />
    </div>
  );
}
