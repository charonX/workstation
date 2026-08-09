// src/renderer/components/assistant/ToolCallBlock.jsx
// 工具调用折叠块（tech-design 接口 3 / REQ-AGENT-052 B6）。
//
// 三态渲染（对齐 ux/assistant-rich.html tool-block 三态语义）：
// - 收起态：工具名 + 输入摘要（输入序列化截断 ≤80 字符，接口 3 原型语义）+ chevron；
// - 展开态：输入 / 输出 / 耗时（超长输出折叠内滚动，CSS max-height + overflow）；
// - 错误态：status:"error" 默认展开 + error 色 + 「执行失败」徽标（F4 步骤 3）。
// - interrupted（text_end 防御）：running + interrupted 标记 → 收起 + 弱化 + 「已中断」提示
//   （非 running 视觉态；迟到的 end/error 仍可正确收尾该块）。
//
// locator 契约（signoff 裁决 3，E2E 必须一致）：
//   [data-tool-block] / [data-tool-header] / [data-tool-body] / [data-tool-error-badge]
//
// props（接口 3）：{ tool: ToolElement, defaultOpen?: boolean }
// 交互：点击 header 切换展开（纯组件状态）。header 为可点区域（原型 div onclick 语义），
// 补 role="button" + aria-expanded 键盘可读性（checklists/accessibility.md）。

import { memo, useEffect, useState } from "react";

// 输入序列化截断 ≤80 字符（接口 3：收起态输入摘要，原型语义）。
function summarizeInput(input) {
  if (input === undefined || input === null) return "";
  let s;
  if (typeof input === "string") {
    s = input;
  } else {
    try {
      s = JSON.stringify(input);
    } catch {
      s = String(input);
    }
  }
  if (s.length <= 80) return s;
  return `${s.slice(0, 80)}…`;
}

// 展开态正文文本化（对象 → 格式化 JSON；截断后的字符串载体原样显示）。
function displayText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// 耗时（秒，两位小数——原型 1.24s / 0.08s 语义）。
function formatDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return `${(ms / 1000).toFixed(2)}s`;
}

// 错误展示文本（BUG-006）：优先 adapter 结构化错误（errorMessage/errorCode）；
// 缺失时回退 PI end 携带的 output（ToolResult.content[].text——gate 拦截/参数
// 校验等「无 adapter error 事件」路径的失败原因只存在于 output），避免「未知错误」。
function errorDisplayText(tool) {
  if (tool.errorMessage) return tool.errorMessage;
  if (tool.errorCode) return tool.errorCode;
  const out = tool.output;
  if (typeof out === "string" && out !== "") return out;
  if (Array.isArray(out?.content)) {
    const text = out.content.map((b) => (b?.type === "text" ? b.text : "")).filter(Boolean).join("\n");
    if (text !== "") return text;
  }
  return "未知错误";
}

function ToolCallBlock({ tool, defaultOpen = false }) {
  const isError = tool.status === "error";
  const isInterrupted = tool.status === "running" && tool.interrupted === true;
  const [open, setOpen] = useState(defaultOpen || isError);
  // 错误态默认展开（F4 步骤 3 / REQ-AGENT-052 标准 3）：start 先挂载为 running（收起），
  // error 事件/error end 到达时状态迁移 → 强制展开（初始值仅覆盖"首个渲染即 error"路径）。
  useEffect(() => {
    if (isError) setOpen(true);
  }, [isError]);

  const summary = summarizeInput(tool.input);
  const duration = formatDuration(tool.durationMs);

  return (
    <div
      className={`tool-block${isError ? " error" : ""}${isInterrupted ? " interrupted" : ""}${open ? " open" : ""}`}
      data-tool-block
    >
      <div
        className="tool-header"
        data-tool-header
        role="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tool-chevron">▶</span>
        <span className="tool-name">{tool.name}</span>
        <span className="tool-summary">{summary}</span>
        {isError && (
          <span className="tool-error-badge" data-tool-error-badge>
            执行失败
          </span>
        )}
        {isInterrupted && <span className="tool-interrupted-hint">已中断</span>}
      </div>
      <div className="tool-body" data-tool-body>
        <div className="tool-section">
          <div className="tool-section-label">输入</div>
          <div className="tool-section-content">{displayText(tool.input)}</div>
        </div>
        {isError ? (
          <div className="tool-section">
            <div className="tool-section-label">错误</div>
            <div className="tool-section-content">{errorDisplayText(tool)}</div>
          </div>
        ) : (
          tool.output !== undefined && (
            <div className="tool-section">
              <div className="tool-section-label">输出</div>
              <div className="tool-section-content">{displayText(tool.output)}</div>
            </div>
          )
        )}
        {duration !== null && (
          <div className="tool-section">
            <div className="tool-section-label">耗时</div>
            <div className="tool-duration">{duration}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ToolCallBlock);
