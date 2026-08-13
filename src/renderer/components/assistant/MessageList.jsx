// src/renderer/components/assistant/MessageList.jsx
// 对话窗消息区（S3/S5）：用户/agent 气泡（流式 data-streaming）+ 内联高危确认卡。
// testid 契约：message-list / data-message-role='user|agent' / data-streaming='true' /
// data-confirm-card / data-state='done' / confirm-approve-button / confirm-reject-button。
//
// 确认卡渲染（REQ-AGENT-030 标准 3/4 + U-1）：数据源 = GET /api/agent/confirmations
// 全量（含 status）——挂起队列 = SQLite 真相，页面重载后已处理卡按 status 重建为
// data-state='done'（置灰、按钮不再渲染，以结果标注替代）。
// BUG-008：确认卡按 createdAt 与消息时间序归并内联（chronology.js——UX 参照
// ux/assistant.html 的消息数组内项语义），不再追加列表末尾跟随底部。

import { useEffect, useRef } from "react";
import MarkdownRenderer from "./MarkdownRenderer.jsx";
import ToolCallBlock from "./ToolCallBlock.jsx";
import { formatTokens, formatDuration } from "./format.js";
import { mergeChronological } from "./chronology.js";

// 操作描述（SSE confirmation-pending description 字段语义同构，裁决 11/8）：
// GET 全量行无 description 字段（command + args 为真相），前端推导显示文案。
function cardDescription(c) {
  if (c.description) return c.description;
  const argsText = JSON.stringify(c.args ?? {});
  return argsText === "{}" ? c.command : `${c.command}（参数：${argsText}）`;
}

// 消息元数据行（REQ-AGENT-057 / tech-design 增量 v0.3 B10）：text_end 携带的
// meta（接口 6）→ 完成态显示「耗时 + in/out token」；FAUX usage 空/0 → 显示
// 「-」不误导（标准 4）；流式期间不渲染（调用方按 !streaming 过滤）。
function MessageMeta({ meta }) {
  if (!meta) return null;
  const tokensIn = typeof meta.tokensIn === "number" && meta.tokensIn > 0 ? formatTokens(meta.tokensIn) : "-";
  const tokensOut = typeof meta.tokensOut === "number" && meta.tokensOut > 0 ? formatTokens(meta.tokensOut) : "-";
  return (
    <div className="msg-meta" data-testid="msg-meta">
      <span className="meta-item">耗时 {formatDuration(meta.durationMs)}</span>
      <span className="meta-item">
        in {tokensIn} · out {tokensOut} tokens
      </span>
    </div>
  );
}

// 附件块大小展示（与 Composer chip-size 同口径）。
function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// 消息附件块（REQ-AGENT-098 / UX msg-attach）：用户消息携带 attachments →
// 气泡内渲染附件块（testid msg-attachment，名称 + 大小）。数据源 = 发送时
// 乐观气泡携带的附件元数据；历史重放（GET messages 投影）不含附件结构——
// 以文本标记「[图片: name]」呈现（projectMessagesFromJsonl partText 契约）。
function MessageAttachments({ attachments }) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  return (
    <>
      {attachments.map((att, i) => (
        <div key={`${att?.path ?? att?.name ?? "att"}-${i}`} className="msg-attach" data-testid="msg-attachment">
          <svg className="attach-ico" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 2.5h7l3 3v8H3z" />
          </svg>
          <span className="attach-name">{att?.name ?? ""}</span>
          {typeof att?.size === "number" && <span className="chip-size">{formatSize(att.size)}</span>}
        </div>
      ))}
    </>
  );
}

export default function MessageList({ messages, confirmations, onApprove, onReject, projectDir }) {
  const listRef = useRef(null);

  // 滚动跟随（体感优化；观感入 REFLECT）。
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, confirmations]);

  // BUG-008：消息 + 确认卡按时间序归并（确认卡内联于请求时点，done 卡沉回历史
  // 位置；pending 新卡自然落底部保持可操作性）。
  const items = mergeChronological(messages, confirmations);

  return (
    <div className="messages" data-testid="message-list" ref={listRef}>
      {items.map((entry, idx) => {
        if (entry.kind === "confirm") {
          const c = entry.item;
          const done = c.status !== "pending";
          return (
            <div
              key={c.confirmId}
              className={`confirm-card${done ? " done" : ""}`}
              data-confirm-card
              data-state={done ? "done" : undefined}
            >
              <p className="confirm-title">
                <span className="warn-badge">高危操作</span>
                {c.operation ?? c.command}
              </p>
              <p className="confirm-desc">{cardDescription(c)}</p>
              {done ? (
                <div className="confirm-result">{c.status === "approved" ? "已确认并执行" : "已拒绝"}</div>
              ) : (
                <div className="confirm-actions">
                  <button type="button" className="btn btn-danger" data-testid="confirm-approve-button" onClick={() => onApprove(c)}>
                    确认执行
                  </button>
                  <button type="button" className="btn btn-secondary" data-testid="confirm-reject-button" onClick={() => onReject(c)}>
                    拒绝
                  </button>
                </div>
              )}
            </div>
          );
        }
        const m = entry.item;
        // JSONL 角色 user/assistant → 气泡角色 user/agent（契约 data-message-role）。
        const role = m.role === "user" ? "user" : "agent";
        return (
          <div key={m.id ?? `${role}-${m.messageId ?? m.createdAt}-${idx}`} className={`msg ${role}`}>
            <div
              className={`bubble${m.streaming ? " streaming" : ""}${m.kind === "tool" ? " tool-bubble" : ""}`}
              data-message-role={role}
              data-streaming={m.streaming ? "true" : undefined}
            >
              {/* 渲染分流（tech-design 模块关系图）：text → MarkdownRenderer；
                  tool → ToolCallBlock（REQ-AGENT-052：SSE 消费 tool_execution_* →
                  kind:"tool" 元素；历史不落工具 → 无 tool 元素，B8）。 */}
              {m.kind === "tool" ? (
                <ToolCallBlock tool={m} />
              ) : (
                // projectDir：接口 2 图片解析根（REQ-AGENT-051）——项目空间会话 =
                // 项目 ID（主进程按 registry 解析实际目录）；无解析根 → 图片占位/原文回退。
                <MarkdownRenderer text={m.text} streaming={m.streaming} projectDir={projectDir} />
              )}
              {/* 消息元数据（REQ-AGENT-057 标准 1/2）：agent 消息完成态（streaming=false）
                  且 text_end 携带 meta → 显示；流式期间/历史消息（无 meta）不显示。 */}
              {role !== "user" && !m.streaming && m.meta ? <MessageMeta meta={m.meta} /> : null}
              {/* 消息附件块（REQ-AGENT-098，Slice 5）：乐观气泡携带的附件元数据 */}
              {role === "user" && !m.streaming && <MessageAttachments attachments={m.attachments} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
