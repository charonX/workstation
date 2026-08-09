// src/renderer/components/assistant/StatusBar.jsx
// composer 上方状态栏（REQ-AGENT-056 / tech-design 增量 v0.3 B9）：
// 三区——执行状态（空闲/回复中/工具执行中：streaming + tool 事件驱动，纯 renderer
// 推导）+ git 分支（SSE session-git：branch/detached/none 三态，主进程读取）+
// 上下文用量（SSE session-stats：tokens/contextWindow/percent 仪表）。
// testid 契约（E2E 断言一致）：status-bar / status-exec / status-branch / status-context。
// 数据缺失（stats 未就绪 E7 / git 不可用 E8）→ 占位「—」，对话不受阻。
// UX 参照：ux/assistant-rich.html（status-bar 三区 + 状态点三态 + ctx-meter 仪表）。

import { formatTokens } from "./format.js";

// 执行状态三态（原型语义，assistant-rich.html states 数组）：空闲 = 灰点；
// 回复中 = accent 闪烁；工具执行中 = warning 闪烁。
const EXEC_STATES = {
  idle: { dot: "", label: "空闲" },
  replying: { dot: "running", label: "回复中…" },
  tool: { dot: "tool", label: "工具执行中…" },
};

const PLACEHOLDER = "—";

// git 三态文案（E2E 契约：branch 名原样 / detached → 匹配 /detached|分离/i /
// none → 匹配 /无 git|无仓库/i）；git 未就绪（SSE 帧未达）→ 占位。
export function gitText(git) {
  if (!git || typeof git.state !== "string") return PLACEHOLDER;
  if (git.state === "branch") {
    return typeof git.branch === "string" && git.branch !== "" ? git.branch : PLACEHOLDER;
  }
  if (git.state === "detached") return "分离 HEAD";
  return "无 git";
}

// 上下文用量文本：`tokens / contextWindow · percent%`；tokens null（压缩后）→
// percent 或占位；全缺 → 占位。
export function contextText(ctx) {
  if (!ctx) return PLACEHOLDER;
  const { tokens, contextWindow, percent } = ctx;
  const parts = [];
  if (typeof tokens === "number" && typeof contextWindow === "number") {
    parts.push(`${formatTokens(tokens)} / ${formatTokens(contextWindow)} tokens`);
  }
  if (typeof percent === "number" && !Number.isNaN(percent)) parts.push(`${percent}%`);
  return parts.length > 0 ? parts.join(" · ") : PLACEHOLDER;
}

// 仪表宽度（percent → 0-100 clamp）；percent 缺失 → 0。
export function meterWidth(ctx) {
  const p = ctx && typeof ctx.percent === "number" && !Number.isNaN(ctx.percent) ? ctx.percent : 0;
  return `${Math.max(0, Math.min(100, p))}%`;
}

export default function StatusBar({ exec = "idle", git = null, context = null }) {
  const state = EXEC_STATES[exec] ?? EXEC_STATES.idle;
  return (
    <div className="status-bar" data-testid="status-bar">
      <span className="status-item" data-testid="status-exec">
        <i className={`status-dot${state.dot ? ` ${state.dot}` : ""}`} />
        <span className="status-label">{state.label}</span>
      </span>
      <span className="status-item status-branch" data-testid="status-branch">
        {gitText(git)}
      </span>
      <span className="status-item status-context" data-testid="status-context">
        <span className="ctx-meter">
          <i style={{ width: meterWidth(context) }} />
        </span>
        {contextText(context)}
      </span>
    </div>
  );
}
