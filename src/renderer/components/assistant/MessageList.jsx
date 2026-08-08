// src/renderer/components/assistant/MessageList.jsx
// 对话窗消息区（S3/S5）：用户/agent 气泡（流式 data-streaming）+ 内联高危确认卡。
// testid 契约：message-list / data-message-role='user|agent' / data-streaming='true' /
// data-confirm-card / data-state='done' / confirm-approve-button / confirm-reject-button。
//
// 确认卡渲染（REQ-AGENT-030 标准 3/4 + U-1）：数据源 = GET /api/agent/confirmations
// 全量（含 status）——挂起队列 = SQLite 真相，页面重载后已处理卡按 status 重建为
// data-state='done'（置灰、按钮不再渲染，以结果标注替代）。

import { useEffect, useRef } from "react";
import MarkdownRenderer from "./MarkdownRenderer.jsx";

// 操作描述（SSE confirmation-pending description 字段语义同构，裁决 11/8）：
// GET 全量行无 description 字段（command + args 为真相），前端推导显示文案。
function cardDescription(c) {
  if (c.description) return c.description;
  const argsText = JSON.stringify(c.args ?? {});
  return argsText === "{}" ? c.command : `${c.command}（参数：${argsText}）`;
}

export default function MessageList({ messages, confirmations, onApprove, onReject }) {
  const listRef = useRef(null);

  // 滚动跟随（体感优化；观感入 REFLECT）。
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, confirmations]);

  return (
    <div className="messages" data-testid="message-list" ref={listRef}>
      {messages.map((m, idx) => {
        // JSONL 角色 user/assistant → 气泡角色 user/agent（契约 data-message-role）。
        const role = m.role === "user" ? "user" : "agent";
        return (
          <div key={m.id ?? `${role}-${m.messageId ?? m.createdAt}-${idx}`} className={`msg ${role}`}>
            <div
              className={`bubble${m.streaming ? " streaming" : ""}`}
              data-message-role={role}
              data-streaming={m.streaming ? "true" : undefined}
            >
              {/* 渲染分流（tech-design 模块关系图）：text → MarkdownRenderer；
                  tool → ToolCallBlock（Slice 4 REQ-AGENT-052 接入；当前消息流无 tool 元素
                  产生——历史不落工具、SSE 未消费 tool 事件，故分支不触发）。 */}
              {m.kind === "tool" ? null : <MarkdownRenderer text={m.text} streaming={m.streaming} />}
            </div>
          </div>
        );
      })}
      {confirmations.map((c) => {
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
      })}
    </div>
  );
}
