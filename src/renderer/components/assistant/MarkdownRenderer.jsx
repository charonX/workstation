// src/renderer/components/assistant/MarkdownRenderer.jsx
// Markdown 渲染组件（tech-design 接口 2 / REQ-AGENT-047 B1 + REQ-AGENT-053 B7 + REQ-AGENT-048 B2）。
//
// - 渲染：react-markdown + remark-gfm（GFM 全量：标题/列表/表格/引用/链接/代码块/任务列表）。
// - 安全：HTML 全转义——不引 rehype-raw，react-markdown 默认把原始 HTML（<script> 等）
//   转为转义源码文本节点，零 XSS 面（PRD D3 / §12.1 范围外 1）。
// - 代码高亮（B2 / REQ-AGENT-048）：components.code 注入——围栏语言标记为主
//   （language-xxx → hljs.highlight），无标记代码块 → highlightAuto 自动检测
//   （AUTO_DETECT_SUBSET 限定检测范围），检测无匹配（rel=0）/语言未注册 → plaintext 兜底不报错（E4）。
//   安全路线：hljs v11 HTMLRenderer 对文本先 escapeHTML（node_modules/highlight.js/lib/core.js
//   :61 escapeHTML / :157 addText），value 输出 = 库生成 span + 转义文本，无原始 HTML →
//   dangerouslySetInnerHTML 零注入面（实测 `<script>` 内容 → &lt;script&gt;）。不手工预转义
//   （hljs 自身已转义，再转义会导致 & 双重转义）。
//   双主题：.hljs-* 类 → var(--ch-code-*) token 映射（assistant.css），随 data-theme 三块自动切换。
// - 兜底：错误边界（E5 / REQ-AGENT-047 标准 4）——渲染抛错回退纯文本，不白屏、不崩。
// - 样式：渲染产物包 .md 类（ux/assistant-rich.html .md 样式语义，CSS 在 assistant.css）。
// - 性能：React.memo 按 text 缓存；hljs 用 core + 常用语言注册（不整包引入，tech-design 性能项）。
//
// props（接口 2）：
//   text        string   markdown 源文本
//   streaming?  boolean  流式态（Slice 5 W-1：未闭合 mermaid 围栏流式期间字面量判定用）
//   projectDir? string   图片解析根（Slice 6 REQ-AGENT-051 接入；本切片不使用）
import { Component, createContext, memo, useContext } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";

// —— highlight.js：core + 常用语言注册（tech-design 性能：按语言加载，不整包引入）——
// 别名（库自带）：js/jsx/mjs/cjs（javascript）、ts/tsx/mts/cts（typescript）、py（python）、
// sh/zsh（bash）、console/shellsession（shell）、yml（yaml）、md（markdown）、text/txt（plaintext）。
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import shell from "highlight.js/lib/languages/shell";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import java from "highlight.js/lib/languages/java";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import kotlin from "highlight.js/lib/languages/kotlin";
import swift from "highlight.js/lib/languages/swift";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import plaintext from "highlight.js/lib/languages/plaintext";

const HIGHLIGHT_LANGUAGES = {
  javascript,
  typescript,
  python,
  bash,
  shell,
  json,
  yaml,
  xml,
  css,
  scss,
  markdown,
  sql,
  java,
  go,
  rust,
  c,
  cpp,
  csharp,
  ruby,
  php,
  kotlin,
  swift,
  diff,
  dockerfile,
  ini,
  plaintext,
};
for (const [name, definition] of Object.entries(HIGHLIGHT_LANGUAGES)) {
  hljs.registerLanguage(name, definition);
}

// auto 检测子集（M2 验证点，实测依据见 build-progress Slice 2）：
// - 排除 kotlin：松散文法实测偷 python 的检测（`def parse(data): ...` rel 5 → kotlin）；
//   kotlin 仍注册，```kotlin 围栏显式命中不受影响（只影响无标记块）。
// - 排除 markdown/plaintext：普通文本/日志会被偷判为 md，导致无意义着色。
// - 裸命令/日志低相关命中（rel 1-3）保留（B2 "裸命令/日志也有基础着色"）；
//   完全无匹配（rel 0，如纯命令串）→ plaintext 兜底（E4）。
const AUTO_DETECT_SUBSET = Object.keys(HIGHLIGHT_LANGUAGES).filter(
  (name) => name !== "kotlin" && name !== "markdown" && name !== "plaintext"
);

/**
 * 代码高亮（B2）：返回 { html }（安全 HTML）或 { plain: true }（兜底原文）。
 * - 围栏语言标记：getLanguage 命中（含别名）→ hljs.highlight；
 * - 无标记/语言未注册 → highlightAuto（子集限定）；
 * - 无匹配 / 未知语言 / 任何异常 → plaintext，不抛错（E4 / REQ-AGENT-048 标准 3）。
 * ignoreIllegals：LLM 输出常见非法语法（代码与文混排/残缺片段），不因 illegal token 抛错。
 */
function highlightCode(code, language) {
  try {
    if (language && hljs.getLanguage(language)) {
      return {
        html: hljs.highlight(code, { language, ignoreIllegals: true }).value,
      };
    }
    const result = hljs.highlightAuto(code, AUTO_DETECT_SUBSET);
    if (result.language && result.relevance > 0) {
      return { html: result.value, detected: result.language };
    }
    return { plain: true };
  } catch {
    return { plain: true };
  }
}

// 围栏块（pre>code）与行内代码区分：mdast 把围栏块渲染为 pre>code、行内 code 无 pre 父。
// InPreContext 标记"在 pre 内"——行内代码不高亮（保持轻量、避免误染）。
const InPreContext = createContext(false);

function MdPre({ node: _node, children, ...props }) {
  return (
    <pre {...props}>
      <InPreContext.Provider value>{children}</InPreContext.Provider>
    </pre>
  );
}

function MdCode({ node: _node, className, children, ...props }) {
  const inPre = useContext(InPreContext);
  if (!inPre) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  const match = /language-([\w-]+)/.exec(className || "");
  const language = match ? match[1] : undefined;
  const text = (
    Array.isArray(children) ? children.join("") : String(children ?? "")
  ).replace(/\n$/, "");
  const result = highlightCode(text, language);
  if (result.plain) {
    // plaintext 兜底（E4 / REQ-AGENT-048 标准 3：plaintext 类、不报错）
    return (
      <code className={`${className ?? ""} language-plaintext`.trim()} {...props}>
        {text}
      </code>
    );
  }
  // hljs value = 库生成 span + 已转义文本（见文件头安全路线），零注入面。
  return (
    <code
      className={`${className ?? ""} hljs`.trim()}
      data-hljs-lang={result.detected}
      dangerouslySetInnerHTML={{ __html: result.html }}
      {...props}
    />
  );
}

// 组件内兜底（PRD E5 / REQ-AGENT-047 标准 4）：markdown 解析/渲染抛错时
// 回退纯文本（气泡基线 pre-wrap 语义），不白屏、不崩。
class MarkdownErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <div>{this.props.text ?? ""}</div>;
    }
    return this.props.children;
  }
}

function MarkdownRenderer(props) {
  const { text = "" } = props;
  // props.streaming / props.projectDir：接口 2 预留（W-1 mermaid 流式字面量 / 图片解析根），
  // 由后续切片（5/6）消费；本切片只做纯 GFM + HTML 转义 + 代码高亮 + 流式文本渲染接入。

  return (
    <MarkdownErrorBoundary text={text}>
      <div className="md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{ pre: MdPre, code: MdCode }}
        >
          {text}
        </ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
}

export default memo(MarkdownRenderer);
