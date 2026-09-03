// src/renderer/components/preview/FilePreviewPanel.jsx
// 文件预览面板（REQ-PREVIEW-001~005/009，PRD §10.2 文件预览面板模块；
// UX 参照 ux/file-preview.html .preview-panel 分区：pv-chrome / pv-viewport /
// pv-statusbar + pv-toast）。会话区右栏，宽度 token --ch-right-panel-width，
// 与浏览器面板槽位互斥（接线在 filePreviewBus.js）。
//
// 视图分派（store state → 面板内容）：
// - kind=markdown：渲染视图（复用 MarkdownRenderer 管线，projectDir 传项目 ID，
//   REQ-002 AC3）/ 源码视图（等宽 + 行号，分段开关切换）；
// - kind=code：hljs 高亮视图（复用 MarkdownRenderer 导出的 highlightCode，
//   同语言集，REQ-003 AC2）+ 行号；
// - kind=image：经 previewImageBlobs 订阅拿 blob URL 直渲（REQ-004 AC1）；
// - error（E-PREVIEW-*）：错误态页（REQ-005 全行：E1–E6 文案 + 错误码标签；
//   E3/E4 带「在系统默认应用打开」逃生按钮，E6 带重试）。
//
// 文案按 PRD §8 锚点中文硬编码（先例 Plugins.jsx；E2E 在 en-US locale 下断言
// 中文锚点，走 i18n 会失败）。
//
// 系统打开逃生（E3/E4/头部 ↗）：getProjectDetail(projectId) 取 localPath →
// window.opc.openArtifactPath(localPath, relPath)（preload 既有桥，主进程白名单
// 校验；renderer 不持有绝对路径是刻意姿态，先例 ExecutionDetail.jsx）。

import { useEffect, useMemo, useState } from "react";
import MarkdownRenderer, { highlightCode } from "../assistant/MarkdownRenderer.jsx";
import { getProjectDetail } from "../../api/projects.js";
import { kindLabelOf, formatSize } from "./format.js";
import {
  filePreviewStore,
  previewImageBlobs,
  useFilePreviewState,
  usePreviewToast,
  dismissPreviewToast,
} from "./filePreviewBus.js";
import "./preview.css";

// PRD §8 错误表全行（错误码 → 标题/描述/动作）；external = 系统打开逃生按钮，
// retry = 重试按钮（重新发起 read，REQ-005 AC4）。
const ERROR_META = {
  "E-PREVIEW-OUTSIDE-ROOT": {
    title: "仅支持预览项目内文件",
    desc: "路径解析后位于项目空间根之外，已拒绝访问。",
  },
  "E-PREVIEW-NOT-FOUND": { title: "文件不存在", desc: "该文件已被移动或删除。" },
  "E-PREVIEW-TOO-LARGE": {
    title: "文件过大",
    desc: "超过 1MB 的文件不在面板内渲染。",
    external: true,
  },
  "E-PREVIEW-UNSUPPORTED": {
    title: "不支持预览该类型",
    desc: "该文件不是可预览的文本 / 图片类型。",
    external: true,
  },
  "E-PREVIEW-NO-ROOT": {
    title: "当前会话无项目空间",
    desc: "文件预览仅在项目空间会话中可用。",
  },
  "E-PREVIEW-READ-FAILED": { title: "读取失败", desc: "读取文件时出现错误。", retry: true },
};

// 行号列（源码/代码视图共用，ux .pv-source .ln 语义）
function LineNumbers({ content }) {
  const count = String(content ?? "").split("\n").length;
  return (
    <div className="ln" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i}>{i + 1}</span>
      ))}
    </div>
  );
}

// Markdown 源码视图：字面量原样可见（REQ-002 AC2）
function SourceView({ content }) {
  return (
    <div className="pv-source">
      <LineNumbers content={content} />
      <pre>{content}</pre>
    </div>
  );
}

// 代码高亮视图（REQ-003）：highlightCode 与聊天围栏块同函数同语言集；
// hljs value = 库生成 span + 已转义文本（MarkdownRenderer 文件头安全路线实证），
// dangerouslySetInnerHTML 零注入面；plaintext 兜底不报错。
function CodeView({ content, language }) {
  const text = String(content ?? "");
  const result = useMemo(() => highlightCode(text, language), [text, language]);
  return (
    <div className="pv-source pv-code">
      <LineNumbers content={text} />
      <pre>
        {result.plain ? (
          text
        ) : (
          <code className="hljs" dangerouslySetInnerHTML={{ __html: result.html }} />
        )}
      </pre>
    </div>
  );
}

// 图片视图（REQ-004 AC1）：订阅 previewImageBlobs 拿就绪 blob URL 直渲
// （store.imageUrl 首次为 null 属预期——fetch 异步，就绪后经订阅通知）。
function ImageView({ projectId, path }) {
  const [url, setUrl] = useState(() => previewImageBlobs.peek(projectId, path));
  useEffect(() => {
    setUrl(previewImageBlobs.peek(projectId, path));
    return previewImageBlobs.subscribe(projectId, path, setUrl);
  }, [projectId, path]);
  return (
    <div className="pv-img">{url ? <img src={url} alt={path} /> : <div className="img-box">图片加载中…</div>}</div>
  );
}

function ErrorView({ code, onOpenExternal }) {
  const meta = ERROR_META[code] ?? { title: code, desc: "" };
  return (
    <div className="pv-error" data-testid="preview-error">
      <span className="e-code" data-testid="preview-error-code">{code}</span>
      <span className="e-title">{meta.title}</span>
      <span className="e-desc">{meta.desc}</span>
      {meta.external && (
        <button type="button" className="e-action" data-testid="preview-open-external" onClick={onOpenExternal}>
          在系统默认应用打开
        </button>
      )}
      {meta.retry && (
        // 重试 = 重新发起 read（store.refresh：以当前 projectId/path 重读一次）
        <button
          type="button"
          className="e-action"
          data-testid="preview-retry"
          onClick={() => void filePreviewStore.refresh()}
        >
          重试
        </button>
      )}
    </div>
  );
}

export default function FilePreviewPanel() {
  const state = useFilePreviewState();
  const toast = usePreviewToast();

  // toast 1800ms 自动消失（ux 原型 .pv-toast 语义；E2E 只断言内容包含）
  useEffect(() => {
    if (!toast.message) return undefined;
    const timer = setTimeout(dismissPreviewToast, 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  // 系统默认应用打开（E3/E4 逃生 + 头部 ↗）：projectId → localPath →
  // opc.openArtifactPath（主进程白名单校验）；失败静默（用户可再点）。
  async function handleOpenExternal() {
    if (!state.projectId || !state.path) return;
    try {
      const detail = await getProjectDetail(state.projectId);
      const localPath = detail?.localPath;
      if (localPath) await window.opc?.openArtifactPath?.(localPath, state.path);
    } catch {
      // 打开失败（项目已删除/桥缺失）：保持面板现状
    }
  }

  async function handleCopy() {
    if (typeof state.content !== "string") return;
    try {
      await navigator.clipboard.writeText(state.content);
    } catch {
      // 剪贴板不可用：静默
    }
  }

  let body = null;
  if (state.error) {
    body = <ErrorView code={state.error} onOpenExternal={handleOpenExternal} />;
  } else if (state.kind === "markdown") {
    body =
      state.viewMode === "source" ? (
        <SourceView content={state.content} />
      ) : (
        <div className="pv-md">
          <MarkdownRenderer text={state.content ?? ""} projectDir={state.projectId} />
        </div>
      );
  } else if (state.kind === "code") {
    body = <CodeView content={state.content} language={state.language} />;
  } else if (state.kind === "image") {
    body = <ImageView projectId={state.projectId} path={state.path} />;
  } else {
    body = <div className="pv-loading">加载中…</div>;
  }

  const kindLabel = kindLabelOf(state);

  return (
    <>
      {state.open && (
        <section className="preview-panel" data-testid="file-preview-panel">
          {/* chrome 条：路径 + 类型标签 + 渲染/源码分段（仅 Markdown）+ 操作区
              （复制内容 / 在系统默认应用打开 / 收起，REQ-001 AC4） */}
          <div className="pv-chrome">
            <div className="pv-path" data-testid="preview-path">
              <span className="pv-path-text">{state.path}</span>
              {kindLabel && (
                <span className="pv-kind" data-testid="preview-kind">
                  {kindLabel}
                </span>
              )}
            </div>
            {state.showRenderToggle && (
              <div className="pv-seg">
                <button
                  type="button"
                  data-testid="preview-view-render"
                  className={state.viewMode === "render" ? "active" : ""}
                  onClick={() => filePreviewStore.setViewMode("render")}
                >
                  渲染
                </button>
                <button
                  type="button"
                  data-testid="preview-view-source"
                  className={state.viewMode === "source" ? "active" : ""}
                  onClick={() => filePreviewStore.setViewMode("source")}
                >
                  源码
                </button>
              </div>
            )}
            <button
              type="button"
              className="pv-btn"
              title="复制内容"
              disabled={typeof state.content !== "string"}
              onClick={() => void handleCopy()}
            >
              ⧉
            </button>
            <button
              type="button"
              className="pv-btn"
              title="在系统默认应用打开"
              onClick={() => void handleOpenExternal()}
            >
              ↗
            </button>
            <button
              type="button"
              className="pv-btn"
              data-testid="preview-close"
              title="收起"
              onClick={() => void filePreviewStore.close()}
            >
              ✕
            </button>
          </div>

          <div className="pv-viewport">{body}</div>

          <div className="pv-statusbar">
            <span className="st-path">{state.path}</span>
            {!state.error && state.kind && <span>{formatSize(state.size)}</span>}
          </div>
        </section>
      )}
      {/* toast 宿主（preview-toast 契约）：面板收起时也要能呈现 E5 提示，
          故独立于面板 section（ux 原型为视口内绝对定位——偏差见 build-progress） */}
      {toast.message && (
        <div className="pv-toast show" data-testid="preview-toast">
          {toast.message}
        </div>
      )}
    </>
  );
}
