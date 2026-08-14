// src/renderer/components/assistant/Composer.jsx
// 对话窗输入区（S3/S9 + §8 错误态）：可输入态 / 只读态（飞书·请到飞书继续对话 /
// 孤儿·项目已删除）/ 未配置禁用态（输入与发送 disabled，引导「去配置」）。
// 附件 UI（REQ-AGENT-098，Slice 5）：输入区上方 chips 行 + 文件选择器 + 非视觉
// 阻止提示 + 发送时复核——「不静默丢图」renderer 主防线（PRD §10.7，v0.5 人拍板）。
// testid 契约：composer-input / send-button / composer-readonly / readonly-reason /
// attachment-chip / chip-remove / attach-blocked / msg-attachment（消息侧见 MessageList）/
// input[type='file']（E2E setInputFiles 目标）。
//
// 附加校验顺序（PRD §7 / REQ-098 验收标准）：
//   数量 ≤10（E5「每条消息最多附加 10 个文件」）→ 类型白名单（E6「仅支持图片
//   （jpeg/png/gif/webp/bmp/heic/heif）」）→ 大小 ≤10MB（E10「图片过大（单图 ≤10MB）」）
//   → 视觉能力（E11「当前模型不支持图片，请切换到 kimi 或移除图片」）。
// 发送时复核（E11）：chips 已存在时切换到非视觉模型 → 发送被拦 + 提示（不静默发送）。
// 视觉能力判定数据源 = catalog 端点（REQ-AGENT-102，v0.6）：ensureCatalog 内存
// 缓存 + 判定时 await（避免与加载竞态）；catalog 加载失败 → 保守拒绝（宁阻不
// 静默丢图，imageAttachmentUi 标准 9）。
// 项目外文件直接附加（选择器即显式授权，A7 反转——不弹确认、无特殊标记）。
// 文件路径：Electron File.path（E2E setInputFiles 注入的 File 同带 path 语义）。

import { useState, useRef, useImperativeHandle } from "react";
import { ensureCatalog, isVisionModel } from "../../modelCatalog.js";

// 图片白名单（PRD §7 / 服务端 IMAGE_MIME_TYPES 同源，SVG 拒收）+ 扩展名回退映射
//（部分平台 File.type 为空——heic/heif 等）。
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/heic",
  "image/heif",
]);
const EXT_TO_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function mimeOf(file) {
  if (typeof file.type === "string" && file.type !== "") return file.type;
  const ext = typeof file.name === "string" ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
  return EXT_TO_MIME[ext] ?? "";
}

// 大小展示（UX 原型 chip-size 语义：KB/MB 人类可读）。
function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// React 19：ref 为普通 prop（forwardRef 已并入），useImperativeHandle 暴露
// openFilePicker 供 ModeToolbar 附件按钮触发（ChatView 持有 ref 接线）。
export default function Composer({ readonly, readonlyReason, disabled, busy, onSend, provider = "", model = "", ref }) {
  const [text, setText] = useState("");
  // 附件 chips（{name, size, mimeType, kind:"image", path}）——发送载荷与消息
  // 附件块同形（REQ-098 接口契约）。attachmentsRef = 同步真相（快速连续附加
  // 事件间避免闭包陈旧：E2E setInputFiles 循环 10 次 + 第 11 次拒绝，数量判定
  // 必须看到已提交的最新值）；state 仅渲染镜像。
  const [attachments, setAttachments] = useState([]);
  const attachmentsRef = useRef([]);
  // 行内阻止/拒绝提示（E5/E6/E10/E11 共用；瞬态——下轮附加/发送尝试覆盖）。
  const [blockedMsg, setBlockedMsg] = useState(null);
  const fileInputRef = useRef(null);
  const blockedTimerRef = useRef(null);
  // 发送中判定为异步（发送复核 await catalog）——submittingRef 防双击双发。
  const submittingRef = useRef(false);

  // 暴露给 ModeToolbar 附件按钮：打开文件选择器（选择器即显式授权，无确认弹窗）。
  useImperativeHandle(ref, () => ({
    openFilePicker: () => fileInputRef.current?.click?.(),
  }));

  // 只读空间（飞书/孤儿）：无输入区（composer-input/send-button 不渲染——
  // REQ-AGENT-034 标准 1「无输入区」），以 composer-readonly 标注替代。
  if (readonly) {
    return (
      <div className="composer" data-testid="composer-readonly">
        <div className="composer-disabled" data-testid="readonly-reason">{readonlyReason}</div>
      </div>
    );
  }

  function showBlocked(msg) {
    setBlockedMsg(msg);
    clearTimeout(blockedTimerRef.current);
    blockedTimerRef.current = setTimeout(() => setBlockedMsg(null), 5000);
  }

  // 视觉能力判定（REQ-AGENT-098 E11 / REQ-AGENT-102 v0.6，附加时 + 发送复核共用）：
  // 数据源 = catalog（ensureCatalog 内存缓存；判定时 await——首次附加与 catalog
  // 加载并发时等待其落定，避免与加载竞态）。catalog 加载失败 → 保守拒绝
  //（false——附加被拒，不静默放行，imageAttachmentUi 标准 9）。
  async function visionAllowed() {
    try {
      await ensureCatalog();
    } catch {
      return false;
    }
    return isVisionModel(provider, model);
  }

  // 附加判定（E5/E6/E10/E11 顺序校验，任一失败拒绝本次附加 + 提示）。
  // 数量判定用 attachmentsRef（同步真相）——快速连续附加（E2E 循环 setInputFiles）
  // 事件间不依赖已提交的渲染状态。
  async function tryAddFiles(files) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    const current = attachmentsRef.current;
    const next = [];
    // E11 前置取一次视觉判定（本次附加批次共用；await catalog 加载落定）。
    const vision = await visionAllowed();
    for (const file of list) {
      // E5：数量上限（第 11 个被拒）。
      if (current.length + next.length >= MAX_ATTACHMENTS) {
        showBlocked(`每条消息最多附加 ${MAX_ATTACHMENTS} 个文件`);
        break;
      }
      // E6：类型白名单（SVG/其他拒收）。
      const mimeType = mimeOf(file);
      if (!IMAGE_MIME_TYPES.has(mimeType)) {
        showBlocked("仅支持图片（jpeg/png/gif/webp/bmp/heic/heif）");
        continue;
      }
      // E10：单图 ≤10MB（API 硬边界，产品层同口径预检）。
      if (typeof file.size === "number" && file.size > MAX_ATTACHMENT_BYTES) {
        showBlocked("图片过大（单图 ≤10MB）");
        continue;
      }
      // E11：视觉能力——附加时判定（非视觉模型阻止附加 + 引导；catalog 未加载/
      // 加载失败 → 保守拒绝）。
      if (!vision) {
        showBlocked("当前模型不支持图片，请切换到 kimi 或移除图片");
        continue;
      }
      // 文件路径：优先 Electron File.path（原生对话框 File 带该属性）；其次经
      // preload 暴露的 webUtils.getPathForFile（Playwright/CDP 注入的 File 无
      // .path 属性，但 FileData 内带磁盘路径——webUtils 可解析）。两者皆空
      //（非本应用 File / 桥接异常）→ 拒绝并提示（E8 口径）。
      let path = typeof file.path === "string" && file.path !== "" ? file.path : "";
      if (path === "") {
        path = typeof window?.opc?.getPathForFile === "function" ? window.opc.getPathForFile(file) : "";
      }
      if (typeof path !== "string" || path === "") {
        showBlocked("文件读取失败");
        continue;
      }
      next.push({ name: file.name, size: file.size, mimeType, kind: "image", path });
    }
    if (next.length > 0) {
      const nextAll = [...current, ...next];
      // ref 与 state 同源同步（ref = 同步真相，state = 渲染镜像）——state 接收
      // 局部新建数组，不直接引用 ref 数组（避免两者意外共享同一实例）。
      attachmentsRef.current = nextAll;
      setAttachments(nextAll);
      setBlockedMsg(null); // 成功附加清除瞬态错误
    }
    // 清空 input.value：允许重复选择同一文件重新触发 change。
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // 发送按钮（§7 验证规则 + E2E 契约）：trim 后为空且无附件 / 流式中 / 未配置禁用
  // → 置灰；输入框仅未配置禁用（流式中可继续输入）。纯图片消息（空文本 + 附件）
  // 可发送（REQ-098：POST 允许空文本 + 附件）。
  const canSend = !disabled && !busy && (text.trim() !== "" || attachments.length > 0);

  function submit() {
    if (!canSend || submittingRef.current) return;
    // 发送时复核（E11）：chips 已存在时切到非视觉模型 → 拦截 + 提示（不静默发送）。
    // 视觉判定 await catalog（数据源 = catalog，REQ-102）；加载失败 → 保守拦截。
    if (attachmentsRef.current.length > 0) {
      submittingRef.current = true;
      visionAllowed().then((vision) => {
        submittingRef.current = false;
        if (!vision) {
          showBlocked("当前模型不支持图片，请切换到 kimi 或移除图片");
          return;
        }
        doSend();
      });
      return;
    }
    doSend();
  }

  function doSend() {
    onSend(text, attachmentsRef.current);
    attachmentsRef.current = [];
    setAttachments([]);
    setText("");
    setBlockedMsg(null);
  }

  function removeAttachment(index) {
    const next = attachmentsRef.current.filter((_, i) => i !== index);
    attachmentsRef.current = next;
    setAttachments(next);
  }

  return (
    <div className="composer">
      {/* 附件 chips 行（UX Q3-a：输入区上方独立行；空行不占位） */}
      {attachments.length > 0 && (
        <div className="attach-row">
          {attachments.map((att, i) => (
            <span key={`${att.path}-${i}`} className="attach-chip" data-testid="attachment-chip">
              <svg className="chip-ico" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 2.5h7l3 3v8H3z" />
              </svg>
              <span className="chip-name">{att.name}</span>
              {typeof att.size === "number" && <span className="chip-size">{formatSize(att.size)}</span>}
              <button
                type="button"
                className="chip-remove"
                aria-label="移除附件"
                onClick={() => removeAttachment(i)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {/* 行内阻止/拒绝提示（E5/E6/E10/E11，瞬态） */}
      {blockedMsg && (
        <div className="toolbar-alert show" data-testid="attach-blocked">
          {blockedMsg}
        </div>
      )}
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
          {busy ? "回复中…" : "发送"}
        </button>
      </div>
      {/* 文件选择器（附件按钮触发；accept = 图片白名单） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/bmp,image/heic,image/heif"
        multiple
        style={{ display: "none" }}
        onChange={(e) => tryAddFiles(e.target.files)}
      />
    </div>
  );
}
