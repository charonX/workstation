// src/renderer/components/assistant/ModeToolbar.jsx
// 对话区底部模式工具栏（REQ-AGENT-071，B2）：composer 下方，三档模式下拉
// （strict/standard/auto）+ 模型选择器（REQ-AGENT-094，Slice 5）+ 附件按钮
// （REQ-AGENT-098，Slice 5）+「模式仅影响当前会话」提示。auto 切换无额外提示
// （人拍板——不弹 toast/banner，REQ-AGENT-071 标准 5）。
//
// locator 契约：
//   modeToolbar（2026-08-11-pi-agent-modes）：
//     [data-testid='mode-toolbar']  工具栏容器（composer 下方）
//     [data-testid='mode-select']   三档下拉容器
//     [data-testid='mode-trigger']  模式触发按钮（当前档位文案 + 色点）
//     [data-mode='strict'|'standard'|'auto']  档位选项
//   modelSelector（本 story，REQ-AGENT-094 签核）：
//     [data-testid='model-select']     模型选择器下拉容器（替代灰显槽位 toolbar-slot-model）
//     [data-testid='model-trigger']    触发按钮（provider · model；空配置 → disabled）
//     [data-testid='model-option'][data-provider][data-model]  组合选项（.active 高亮 + 默认徽标）
//     [data-testid='model-empty-hint'] 空配置引导提示（E12「未配置模型，请到设置添加」）
//   provider 回落（本 story GAP-1，PRD §6.1 F2 步骤 4）：
//     [data-testid='model-fallback-hint'] 会话 provider 已删 → 回落默认提示
//       （「原 provider 已移除，已回到默认」；与 model-empty-hint 互斥）
//   attachment（本 story，REQ-AGENT-098 签核）：
//     [data-testid='attach-button']   附件按钮（替代灰显槽位 toolbar-slot-attach；
//                                    点击经 onAttachClick 打开 Composer 文件选择器）
//
// 交互（对齐原型）：点触发展开/收起（stopPropagation）、外部点击收起、选组合
// 高亮 + 触发按钮更新。模式为受控组件（mode/onModeChange 由父级持有）；模型选择器
// 同受控（providers/sessionModel/onModelChange 由 Assistant 页持有，数据流 =
// GET/PUT /api/agent/sessions/:key/provider）。
//
// 熔断降级呈现（REQ-AGENT-075 标准 2）：父级传入 degradedReason → 行内提示替换常规
// hint（仅熔断事件触发，非切换触发——不与「auto 切换无额外提示」冲突）。

import { useEffect, useRef, useState } from "react";

// 三档元数据（文案与色点语义对齐原型：严格红 / 标准蓝 / 自动绿）。
const MODE_META = {
  strict: { label: "严格", cls: "strict", desc: "所有操作都需确认，包括读取/查询" },
  standard: { label: "标准", cls: "standard", desc: "按项目权限配置执行（默认）" },
  auto: { label: "自动", cls: "auto", desc: "常规操作由模型判断后自动执行；危险/项目外仍拦截" },
};

export const AGENT_MODE_ORDER = ["strict", "standard", "auto"];

export default function ModeToolbar({
  mode,
  onModeChange,
  degradedReason,
  providers,
  defaultModel,
  sessionModel,
  onModelChange,
  onAttachClick,
}) {
  const [open, setOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const selectRef = useRef(null);
  const modelSelectRef = useRef(null);
  const meta = MODE_META[mode] ?? MODE_META.standard;

  // 已配置组合平铺（REQ-AGENT-094 标准 2：选择器列出全部已配置条目——每条目 × 各模型）。
  const options = (Array.isArray(providers) ? providers : [])
    .flatMap((p) => (Array.isArray(p?.models) ? p.models : []).map((m) => ({ provider: p.provider, model: m })));
  const hasProviders = options.length > 0;
  // 会话回落判定（GAP-1 / PRD §6.1 F2 步骤 4）：当前会话组合的 provider 不在已配置
  // 条目列表 → 服务端已回落默认（resolveSessionModelConfig E12 返回默认组合）。纯
  // 派生：providers（agentConfig 轮询刷新）或 sessionModel（GET provider 取位）任一
  // 变化即重判——「provider 被删」在删除瞬间被 agentConfig 轮询捕获（内存值仍为旧
  // provider），「取位/刷新」路径随 GET 结果自然一致。hasProviders 前置 → 与空配置
  // 禁用态（model-empty-hint）互斥。
  const fallbackActive =
    !!sessionModel &&
    hasProviders &&
    !(Array.isArray(providers) ? providers : []).some((p) => p.provider === sessionModel.provider);
  // 回落呈现（PRD 步骤 4「显示默认 provider + 提示」）：fallbackActive 时触发按钮
  // 展示默认组合（行值未落盘前内存旧 provider 不展示）；点击已展示的默认组合幂等
  // 跳过（handleModelSelect 幂等检查），服务端本已按默认解析。
  const current =
    fallbackActive && defaultModel
      ? defaultModel
      : sessionModel ?? defaultModel ?? null;
  const isDefault = (provider, model) =>
    !!defaultModel && defaultModel.provider === provider && defaultModel.model === model;

  // 外部点击收起（原型交互：document click → close；触发按钮 click stopPropagation）。
  // 两个下拉（模式/模型）独立 ref——各闭包各自判定包含关系，互不误关。
  useEffect(() => {
    if (!open && !modelOpen) return undefined;
    const onDocClick = (e) => {
      if (open && selectRef.current && !selectRef.current.contains(e.target)) setOpen(false);
      if (modelOpen && modelSelectRef.current && !modelSelectRef.current.contains(e.target)) setModelOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open, modelOpen]);

  function handleTriggerClick(e) {
    e.stopPropagation();
    setOpen((v) => !v);
  }

  function handleSelect(m) {
    setOpen(false);
    if (m !== mode && typeof onModeChange === "function") onModeChange(m);
  }

  function handleModelTriggerClick(e) {
    e.stopPropagation();
    if (!hasProviders) return; // 空配置禁用态（E12）
    setModelOpen((v) => !v);
  }

  function handleModelSelect(provider, model) {
    setModelOpen(false);
    if (typeof onModelChange !== "function") return;
    if (current && current.provider === provider && current.model === model) return; // 幂等
    onModelChange(provider, model);
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

      {/* 模型选择器（REQ-AGENT-094，Slice 5）：替代灰显槽位 toolbar-slot-model——
          列出全部已配置组合（provider · model），当前组合高亮 + 默认徽标；空配置 →
          触发按钮禁用 + 引导提示（E12）。 */}
      <div
        className={`model-select${modelOpen ? " open" : ""}`}
        data-testid="model-select"
        ref={modelSelectRef}
      >
        <button
          type="button"
          className="model-trigger"
          data-testid="model-trigger"
          aria-expanded={modelOpen}
          aria-haspopup="listbox"
          disabled={!hasProviders}
          title={hasProviders ? "切换当前会话模型" : "未配置模型，请到设置添加"}
          onClick={handleModelTriggerClick}
        >
          {current ? (
            <span className="model-trigger-text">
              <span className="prov-name">{current.provider}</span>
              <span className="prov-sep"> · </span>
              <span className="model-name">{current.model}</span>
            </span>
          ) : (
            <span className="model-trigger-placeholder">模型</span>
          )}
          <span className="chevron">▼</span>
        </button>
        {/* 会话回落提示（GAP-1 / PRD F2 步骤 4）：当前会话 provider 已不在已配置
            条目 → 服务端已回落默认（E12）→ 提示（与空配置 model-empty-hint 互斥）。 */}
        {fallbackActive && (
          <span className="model-fallback-hint" data-testid="model-fallback-hint">
            原 provider 已移除，已回到默认
          </span>
        )}
        {!hasProviders && (
          <span className="model-empty-hint" data-testid="model-empty-hint">
            未配置模型，请到设置添加
          </span>
        )}
        {modelOpen && hasProviders && (
          <div className="model-menu" role="listbox">
            {options.map((opt) => {
              const active = !!current && current.provider === opt.provider && current.model === opt.model;
              const def = isDefault(opt.provider, opt.model);
              return (
                <div
                  key={`${opt.provider}::${opt.model}`}
                  className={`model-option${active ? " active" : ""}`}
                  data-testid="model-option"
                  data-provider={opt.provider}
                  data-model={opt.model}
                  role="option"
                  aria-selected={active}
                  onClick={() => handleModelSelect(opt.provider, opt.model)}
                >
                  <div>
                    <div className="o-name">
                      <span className="o-prov">{opt.provider}</span>
                      <span className="prov-sep"> · </span>
                      <span className="o-model">{opt.model}</span>
                      {def && <span className="badge-default">默认</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 附件按钮（REQ-AGENT-098，Slice 5）：替代灰显槽位 toolbar-slot-attach——
          点击经 onAttachClick 打开 Composer 文件选择器（选择器即显式授权）。 */}
      <button
        type="button"
        className="attach-btn"
        data-testid="attach-button"
        title="附加文件（图片）"
        onClick={(e) => {
          e.stopPropagation();
          if (typeof onAttachClick === "function") onAttachClick();
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8.5 3.5l4 4-4.6 4.6a2.8 2.8 0 0 1-4-4L7.8 3.7a1.9 1.9 0 0 1 2.7 0l4 4" />
        </svg>
        附件
      </button>

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
