// src/renderer/components/assistant/ChatView.jsx
// 对话窗（右栏）：标题 + 空间徽标 + 消息区（历史气泡/确认卡）+ 空态/未配置引导态 +
// 输入区。testid 契约：chat-title / chat-space-badge / empty-state / empty-space-name /
// unconfigured-state；空态 = 仅标题 + 当前空间提示（引导卡已砍，2026-08-06 拍板）。

import { useRef } from "react";
import MessageList from "./MessageList.jsx";
import Composer from "./Composer.jsx";
import StatusBar from "./StatusBar.jsx";
import ModeToolbar from "./ModeToolbar.jsx";

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
  projectDir,
  execState,
  gitState,
  contextUsage,
  mode,
  onModeChange,
  modeNotice,
  providers,
  defaultModel,
  sessionModel,
  onModelChange,
  visionCapable,
}) {
  // Composer 文件选择器句柄（React 19 ref-as-prop）：ModeToolbar 附件按钮 →
  // onAttachClick → openFilePicker（文件选择器在 Composer 内，chips 行同处）。
  const composerRef = useRef(null);
  return (
    <main className="assistant-chat">
      <header className="chat-header">
        <h2 className="chat-title" data-testid="chat-title">{chatTitle}</h2>
        <span className="status-badge badge-muted" data-testid="chat-space-badge">{spaceBadge}</span>
      </header>

      {/* 消息区：有历史气泡或确认卡即渲染（确认卡 = 历史的一部分，REQ-AGENT-030
          标准 3「卡片留历史」——纯确认卡会话也走消息区）；否则空态/未配置引导态。 */}
      {messages.length > 0 || confirmations.length > 0 ? (
        <MessageList messages={messages} confirmations={confirmations} onApprove={onApprove} onReject={onReject} projectDir={projectDir} />
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

      {/* 状态栏（REQ-AGENT-056）：composer 上方——执行状态/git 分支/上下文用量。
          渲染顺序契约：MessageList → StatusBar → Composer（E2E 断言 DOM 纵向顺序）。 */}
      <StatusBar exec={execState} git={gitState} context={contextUsage} />

      {/* 底部输入区容器（BUG-002，Codex 式一体输入区）：Composer + ModeToolbar 包进
          .composer-area——容器统一 surface 背景 + border-top（原 .composer 的背景/
          边框移到这里），composer/toolbar 均无独立背景，视觉一块。顺序契约保持：
          MessageList → StatusBar → Composer → ModeToolbar（E2E 断言纵向顺序）。 */}
      <div className="composer-area">
        <Composer
          ref={composerRef}
          readonly={composer.readonly}
          readonlyReason={composer.readonlyReason}
          disabled={composer.disabled}
          busy={composer.busy}
          visionCapable={visionCapable}
          onSend={onSend}
        />

        {/* 模式工具栏（REQ-AGENT-071）：composer 下方——既有渲染顺序契约
            MessageList → StatusBar → Composer → ModeToolbar（E2E 断言纵向顺序）。
            模型选择器（REQ-AGENT-094）与附件按钮（REQ-AGENT-098）同栏
            （Slice 5，替代灰显槽位）。 */}
        <ModeToolbar
          mode={mode}
          onModeChange={onModeChange}
          degradedReason={modeNotice}
          providers={providers}
          defaultModel={defaultModel}
          sessionModel={sessionModel}
          onModelChange={onModelChange}
          onAttachClick={() => composerRef.current?.openFilePicker?.()}
        />
      </div>
    </main>
  );
}
