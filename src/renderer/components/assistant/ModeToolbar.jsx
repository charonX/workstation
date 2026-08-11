// src/renderer/components/assistant/ModeToolbar.jsx
// 对话区底部模式工具栏（REQ-AGENT-071，B2）：composer 下方，三档模式下拉
// （strict/standard/auto）+ 未来扩展槽位（模型/附件，灰显占位）+「模式仅影响
// 当前会话」提示。auto 切换无额外提示（人拍板——不弹 toast/banner，REQ-AGENT-071
// 标准 5）。
//
// locator 契约（E2E modeToolbar.test.cjs，UX 参照 ux/mode-toolbar.html）：
//   [data-testid='mode-toolbar']             工具栏容器（composer 下方）
//   [data-testid='mode-select']              三档下拉容器
//   [data-testid='mode-trigger']             触发按钮（当前模式文案 + 色点）
//   [data-mode='strict'|'standard'|'auto']   档位选项（含描述）
//   [data-testid='toolbar-slot-model'|'toolbar-slot-attach']  未来扩展槽位（灰显）
//
// 交互（对齐原型）：点击触发展开/收起（stopPropagation）、外部点击收起、选档
// 高亮 + 触发按钮更新。受控组件——mode/onModeChange 由父级（Assistant 页）持有，
// 数据流 = GET/PUT /api/agent/sessions/:key/mode。
//
// 熔断降级呈现（REQ-AGENT-075 标准 2，S3 mode-degraded 事件数据面）：父级传入
// degradedReason → 工具栏行内展示「auto 暂停」提示（替换常规 hint；无独立
// toast/banner，避免与 E2E「auto 切换无额外提示」选择器冲突——本提示仅熔断
// 事件触发，非切换触发）。

import { useEffect, useRef, useState } from "react";

// 三档元数据（文案与色点语义对齐原型：严格红 / 标准蓝 / 自动绿）。
const MODE_META = {
  strict: { label: "严格", cls: "strict", desc: "所有操作都需确认，包括读取/查询" },
  standard: { label: "标准", cls: "standard", desc: "按项目权限配置执行（默认）" },
  auto: { label: "自动", cls: "auto", desc: "常规操作由模型判断后自动执行；危险/项目外仍拦截" },
};

export const AGENT_MODE_ORDER = ["strict", "standard", "auto"];

export default function ModeToolbar({ mode, onModeChange, degradedReason }) {
  const [open, setOpen] = useState(false);
  const selectRef = useRef(null);
  const meta = MODE_META[mode] ?? MODE_META.standard;

  // 外部点击收起（原型交互：document click → close；触发按钮 click stopPropagation）。
  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (selectRef.current && !selectRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  function handleTriggerClick(e) {
    e.stopPropagation();
    setOpen((v) => !v);
  }

  function handleSelect(m) {
    setOpen(false);
    if (m !== mode && typeof onModeChange === "function") onModeChange(m);
  }

  return (
    <div className="mode-toolbar" data-testid="mode-toolbar">
      <span className="toolbar-label">模式</span>

      <div
        className={`mode-select${open ? " open" : ""}`}
        data-testid="mode-select"
        ref={selectRef}
      >
        <button
          type="button"
          className="mode-trigger"
          data-testid="mode-trigger"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={handleTriggerClick}
        >
          <span className={`mode-dot ${meta.cls}`} />
          <span className="mode-trigger-label">{meta.label}</span>
          <span className="chevron">▼</span>
        </button>
        {open && (
          <div className="mode-menu" role="listbox">
            {AGENT_MODE_ORDER.map((m) => {
              const mmeta = MODE_META[m];
              return (
                <div
                  key={m}
                  className={`mode-option${m === mode ? " active" : ""}`}
                  data-mode={m}
                  role="option"
                  aria-selected={m === mode}
                  onClick={() => handleSelect(m)}
                >
                  <div>
                    <div className="m-name">
                      <span className={`mode-dot ${mmeta.cls}`} />
                      {mmeta.label}
                    </div>
                    <div className="m-desc">{mmeta.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <span className="toolbar-spacer" />

      {/* 未来扩展槽位（M4 移动块，本期灰显占位：模型选择 / 附件） */}
      <span className="toolbar-slot" data-testid="toolbar-slot-model" title="后续版本开放">
        模型
      </span>
      <span className="toolbar-slot" data-testid="toolbar-slot-attach" title="后续版本开放">
        附件
      </span>

      {/* 常规提示；熔断降级时替换为「auto 暂停」提示（REQ-AGENT-075 标准 2） */}
      {degradedReason ? (
        <span className="toolbar-degraded" data-testid="mode-toolbar-degraded">
          {degradedReason}
        </span>
      ) : (
        <span className="toolbar-hint">模式仅影响当前会话</span>
      )}
    </div>
  );
}
