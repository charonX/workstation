// src/renderer/components/assistant/ChatView.jsx
// 对话窗（右栏）：标题 + 空间徽标 + 消息区（历史气泡/确认卡）+ 空态/未配置引导态 +
// 输入区。testid 契约：chat-title / chat-space-badge / empty-state / empty-space-name /
// unconfigured-state；空态 = 仅标题 + 当前空间提示（引导卡已砍，2026-08-06 拍板）。

import MessageList from "./MessageList.jsx";
import Composer from "./Composer.jsx";

export default function ChatView({
  chatTitle,
  spaceBadge,
  messages,
  confirmations,
  onApprove,
  onReject,
  showEmpty,
  emptySpaceName,
  unconfigured,
  onGoConfigure,
  composer,
  onSend,
}) {
  return (
    <main className="assistant-chat">
      <header className="chat-header">
        <h2 className="chat-title" data-testid="chat-title">{chatTitle}</h2>
        <span className="status-badge badge-muted" data-testid="chat-space-badge">{spaceBadge}</span>
      </header>

      {/* 消息区：有历史气泡或确认卡即渲染（确认卡 = 历史的一部分，REQ-AGENT-030
          标准 3「卡片留历史」——纯确认卡会话也走消息区）；否则空态/未配置引导态。 */}
      {messages.length > 0 || confirmations.length > 0 ? (
        <MessageList messages={messages} confirmations={confirmations} onApprove={onApprove} onReject={onReject} />
      ) : unconfigured ? (
        // agent 未配置引导态（§8 错误态；原型 guide-card 含「去配置」入口 → Settings > Agent tab）
        <div className="empty-state" data-testid="unconfigured-state">
          <div className="guide-card">
            <h2 className="empty-title">尚未配置 Agent</h2>
            <p>
              配置 LLM 供应商与 API key 后即可开始对话。
              <br />
              配置入口：设置 → Agent 配置。
            </p>
            <button type="button" className="btn btn-primary" onClick={onGoConfigure}>
              去配置
            </button>
          </div>
        </div>
      ) : showEmpty ? (
        // 空态（新对话/首次）：仅标题 + 当前空间提示（2026-08-06 拍板，无引导卡）
        <div className="empty-state" data-testid="empty-state">
          <h2 className="empty-title">有什么可以帮你？</h2>
          <p className="empty-sub">
            当前空间：<span className="space-name" data-testid="empty-space-name">{emptySpaceName}</span>
          </p>
        </div>
      ) : null}

      <Composer
        readonly={composer.readonly}
        readonlyReason={composer.readonlyReason}
        disabled={composer.disabled}
        busy={composer.busy}
        spaceName={composer.spaceName}
        onSend={onSend}
      />
    </main>
  );
}
