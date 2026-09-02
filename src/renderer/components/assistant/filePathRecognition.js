// src/renderer/components/assistant/filePathRecognition.js
// 聊天路径识别与点击分发纯逻辑（REQ-PREVIEW-006，PRD §10.2 聊天路径分发模块；
// 先例：mdLinkDispatch.js——自 JSX 内联提取的纯函数 seam）。
//
// - isPreviewableFilePath(text)：行内 code 路径形态判定（REQ-006 AC2）——
//   含路径分隔符（/ 或 \）且尾段含扩展名，且无空格、无 URL scheme。
//   误报近零优先（ADR-042 决策 4）：识别范围仅行内 code（围栏不识别是渲染层
//   接线，本模块不感知上下文）；渲染期不做存在性预校验（REQ-006 AC5）。
// - dispatchFilePathClick(text, bridges)：点击分发（REQ-006 AC4）——
//   命中且有 projectId → openWithPath(projectId, text) 原样透传（主进程按解析根解析）；
//   无 projectId（非项目空间会话）→ notifyNoRoot() 提示 E5，不发请求；
//   非路径 → 零桥调用。

// URL scheme（https://、http:// 等）——有 scheme 的归 MdLink http 路径，不在此识别。
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const SEPARATOR_RE = /[\\/]/;
const WHITESPACE_RE = /\s/;
// 尾段含扩展名：最后一个分隔符后的段以 `.xxx` 收尾（点后有 ≥1 个非分隔符字符）。
const EXTENSION_RE = /\.[^./\\]+$/;

export function isPreviewableFilePath(text) {
  if (typeof text !== "string" || text === "") return false;
  if (WHITESPACE_RE.test(text)) return false;
  if (URL_SCHEME_RE.test(text)) return false;
  if (!SEPARATOR_RE.test(text)) return false;
  const lastSegment = text.split(SEPARATOR_RE).pop();
  if (!lastSegment) return false;
  return EXTENSION_RE.test(lastSegment);
}

// 返回分发结果："preview"（已打开预览）| "no-root"（E5 无解析根）| "not-a-path"（非路径）。
export function dispatchFilePathClick(text, { projectId, openWithPath, notifyNoRoot } = {}) {
  if (!isPreviewableFilePath(text)) return "not-a-path";
  if (!projectId) {
    if (typeof notifyNoRoot === "function") notifyNoRoot();
    return "no-root";
  }
  if (typeof openWithPath === "function") openWithPath(projectId, text);
  return "preview";
}
