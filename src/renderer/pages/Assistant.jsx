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
  listConfirmations,
  approveConfirmation,
  rejectConfirmation,
  subscribeSessionEvents,
} from "../api/agentSessions.js";
import { getAgentConfig } from "../api/agent.js";
import SessionList from "../components/assistant/SessionList.jsx";
import ChatView from "../components/assistant/ChatView.jsx";
import "../components/assistant/assistant.css";

const PROJECT_PREFIX_RE = /^ui:project:([^:]+):/;
const POLL_MS = 10 * 1000;
// 流式光标 settle（见选中会话 effect 内 text_end 处理注释）。
const STREAM_SETTLE_MS = 1200;

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
  const [agentConfigured, setAgentConfigured] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

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
        if (!disposed) setAgentConfigured(cfg.configured === true);
      } catch {
        // 同上。
      }
    };
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
    let disposed = false;
    alignedRef.current = false; // 新会话：对齐未完成（发送前等待）

    const align = async () => {
      try {
        const [hist, confs] = await Promise.all([getMessages(selectedKey), listConfirmations()]);
        if (disposed) return;
        const next = (hist.messages ?? []).map((m) => ({
          id: m.messageId ?? `${m.role}-${m.createdAt}`,
          role: m.role,
          text: m.text ?? "",
          streaming: false,
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
        setMessages((prev) => [...prev, { id, role: "agent", text: "", streaming: true }]);
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
          setMessages((prev) => [...prev, { id: `agent-${Date.now()}`, role: "agent", text: delta, streaming: true }]);
        }
      } else if (ev.type === "text_end") {
        const endedId = streamBufRef.current?.id ?? null;
        const remaining = streamBufRef.current?.text ?? null;
        streamBufRef.current = null;
        flushScheduled = false; // 挂起 rAF 已无缓冲可 flush（文本在此兜底落盘）
        setStreamingBoth(false);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "agent" && last.streaming) {
            // text_end 时可能有 rAF 挂起未 flush 的累积 delta——兜底落盘，防尾字丢失。
            next[next.length - 1] = { ...last, text: remaining ?? last.text };
          }
          return next;
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
      } else if (ev.type === "session-error") {
        setStreamingBoth(false);
      }
    };

    align();
    const unsubscribe = subscribeSessionEvents(selectedKey, {
      onOpen: () => {
        // 就绪标记只由「本连接的 onOpen 对齐」置位：断线重连后先全量对齐再续流
        // （F2），发送等待它——effect 首渲染对齐（连接可能尚未建立/已断）不置位。
        if (!disposed) align().then((ok) => { if (ok) alignedRef.current = true; });
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
    async (raw) => {
      const text = String(raw ?? "").trim();
      if (text === "" || streamingRef.current) return;
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
        return handleSend(raw);
      }
      setStreamingBoth(true);
      // 发送前等 SSE 流就绪（F2：断线重连窗口内发送会丢流式事件；等待连接恢复后
      // 再发——「重连后收发恢复正常」，REQ-AGENT-028 AC5）。
      await waitForStreamReady();
      // 用户气泡即时出现（S3 操作流 1）：乐观追加，不等 POST 受理——首条消息的
      // POST 在 agent 子进程就绪后才受理（worker spawn 秒级），等到响应再追加会
      // 把用户气泡排在 agent 回复之后（顺序错乱 + 流式窗口错过）。
      // dedupe 防 align 竞态重复渲染（align 已含该消息时不再追加）。
      setMessages((prev) =>
        prev.some((m) => m.role === "user" && m.text === text)
          ? prev
          : [...prev, { id: `user-${Date.now()}`, role: "user", text, streaming: false }]
      );
      try {
        await sendMessage(key, text);
      } catch {
        // 发送失败（网络/服务）：失败气泡标注（§8），按钮恢复。
        setStreamingBoth(false);
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: "agent", text: "发送失败，请稍后重试", streaming: false },
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

  // —— 右栏派生 ——
  const space = spaceOf(selectedKey, sessions);
  const selectedSession = findSession(selectedKey, sessions);
  const chatTitle = selectedSession?.title ?? "新对话";
  const showEmpty = messages.length === 0;
  const unconfigured = agentConfigured === false;

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
          spaceName: space.name,
        }}
        onSend={handleSend}
      />
    </div>
  );
}
