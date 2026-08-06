// src/renderer/components/assistant/Composer.jsx
// 对话窗输入区（S3/S9 + §8 错误态）：可输入态 / 只读态（飞书·请到飞书继续对话 /
// 孤儿·项目已删除）/ 未配置禁用态（输入与发送 disabled，引导「去配置」）。
// testid 契约：composer-input / send-button / composer-readonly / readonly-reason /
// unconfigured-state（引导态容器，随 EmptyState 结构见 Assistant 页）。

import { useState } from "react";

export default function Composer({ readonly, readonlyReason, disabled, busy, spaceName, onSend }) {
  const [text, setText] = useState("");

  // 只读空间（飞书/孤儿）：无输入区（composer-input/send-button 不渲染——
  // REQ-AGENT-034 标准 1「无输入区」），以 composer-readonly 标注替代。
  if (readonly) {
    return (
      <div className="composer" data-testid="composer-readonly">
        <div className="composer-disabled" data-testid="readonly-reason">{readonlyReason}</div>
      </div>
    );
  }

  // 发送按钮（§7 验证规则 + E2E 契约）：trim 后为空 / 流式中（防重复提交，按钮置灰）/
  // 未配置禁用 → 置灰；输入框仅未配置禁用（流式中可继续输入）。
  const canSend = !disabled && !busy && text.trim() !== "";

  function submit() {
    if (!canSend) return;
    onSend(text);
    // 发送后不清空输入：E2E 契约「流式完成后发送按钮恢复可用」依赖发送文本保留
    // （canSend = 文本非空且非流式）；清空会在流式结束后把按钮置灰。
    // （重复提交同一内容由内核串行队列 + 流式中按钮置灰兜底，PRD §7。）
  }

  return (
    <div className="composer">
      <div className="composer-chips">
        <span className="ctx-chip">{spaceName}</span>
      </div>
      <div className="composer-row">
        <textarea
          className="composer-input"
          data-testid="composer-input"
          rows={1}
          placeholder="随心输入…"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="btn btn-primary" data-testid="send-button" disabled={!canSend} onClick={submit}>
          发送
        </button>
      </div>
    </div>
  );
}
