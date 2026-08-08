// src/renderer/components/assistant/MarkdownRenderer.jsx
// Markdown 渲染组件（tech-design 接口 2 / REQ-AGENT-047 B1 + REQ-AGENT-053 B7 + REQ-AGENT-048 B2
//   + REQ-AGENT-049 B3 + REQ-AGENT-050 B4）。
//
// - 渲染：react-markdown + remark-gfm（GFM 全量：标题/列表/表格/引用/链接/代码块/任务列表）
//   + remark-math/rehype-katex（B4 公式：$ 行内 / $$ 块）。
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
// - KaTeX（B4 / REQ-AGENT-050）：remarkPlugins + remark-math、rehypePlugins + rehype-katex
//   （options {throwOnError:false, strict:false}——pi-web 同款）；katex CSS 引入（katex.min.css）。
//   失败回退（E2）：rehype-katex 内置两轮——首轮 throwOnError:true，ParseError 捕获后第二轮
//   throwOnError:false + strict:'ignore' → 源码文本包 span.katex-error 显示（不崩），
//   见 node_modules/rehype-katex/lib/index.js 实证。
// - Mermaid（B3 / REQ-AGENT-049）：```mermaid 围栏 → MermaidBlock 组件（不走 hljs）：
//   · 懒加载：await import("mermaid") 动态加载（首帧不阻塞；加载中显示骨架占位）；
//   · securityLevel:'strict' 显式（I-6 硬约束——click 指令/HTML label 不注入；strict 下
//     mermaid 输出经 DOMPurify 清洗，node_modules/mermaid/dist/mermaid.core.mjs render() 实证
//     ——非 loose 均 sanitize，dangerouslySetInnerHTML 零注入面）；
//   · 暗色独立配色（D9）：浅/暗两套显式 theme 配置（MERMAID_THEMES），随 data-theme
//     变化重渲染（MutationObserver）；
//   · 流式未闭合围栏（W-1）：streaming 下 react-markdown 把未闭合围栏解析为 EOF 块，
//     findUnclosedFence 判定 → 显示字面量（闭合才渲染，避免每帧跑慢速 mermaid → 掉帧
//     + 错误回退闪烁）；
//   · 语法失败 → 回退显示围栏源码文本（E1）。
// - 兜底：错误边界（E5 / REQ-AGENT-047 标准 4）——渲染抛错回退纯文本，不白屏、不崩。
// - 样式：渲染产物包 .md 类（ux/assistant-rich.html .md 样式语义，CSS 在 assistant.css）。
// - 性能：React.memo 按 text 缓存；hljs 用 core + 常用语言注册（不整包引入）；mermaid 懒加载。
//
// props（接口 2）：
//   text        string   markdown 源文本
//   streaming?  boolean  流式态（W-1：未闭合 mermaid 围栏流式期间字面量判定）
//   projectDir? string   图片解析根（Slice 6 REQ-AGENT-051 接入；本切片不使用）
import { Component, createContext, memo, useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
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

// —— KaTeX（B4 / REQ-AGENT-050）——
// pi-web 同款 options；rehype-katex 内置错误回退（见文件头"失败回退（E2）"实证），
// throwOnError:false 语义由库首轮 throwOnError:true + 捕获后第二轮兜底实现。
const KATEX_OPTIONS = { throwOnError: false, strict: false };

// —— Mermaid（B3 / REQ-AGENT-049）——
// 浅/暗两套显式主题配置（D9：暗色独立配色，非 token 自动映射）。
// 色值对齐 ux/assistant-rich.html .mm-node/.mm-edge 浅暗两套（浅：节点 #e8f0fe/#4285f4、
// 文本 #1a2333、边 #5f6368；暗：#1e3a5f/#4c8dff、#dbe7ff、#8ab4f8）。
// 变量实证（node_modules/mermaid/dist/.../chunk-I66GZJ75.mjs + chunk-W5SLKNZC.mjs）：
// flowchart 节点 fill = themeVariables.mainBkg（非 primaryColor——暗色主题构造器无条件
// 设 mainBkg='#1f2020'、updateColors 再无条件 nodeBkg=mainBkg；themeVariables 覆盖在
// calculate 尾轮重放故 mainBkg 覆盖生效）；节点描边 = nodeBorder、节点文本 = nodeTextColor。
const MERMAID_THEMES = {
  light: {
    theme: "default",
    themeVariables: {
      mainBkg: "#e8f0fe",
      nodeBorder: "#4285f4",
      nodeTextColor: "#1a2333",
      primaryTextColor: "#1a2333",
      lineColor: "#5f6368",
      edgeLabelBackground: "#ffffff",
    },
  },
  dark: {
    theme: "dark",
    themeVariables: {
      mainBkg: "#1e3a5f",
      nodeBorder: "#4c8dff",
      nodeTextColor: "#dbe7ff",
      primaryTextColor: "#dbe7ff",
      lineColor: "#8ab4f8",
      edgeLabelBackground: "#161b22",
    },
  },
};

// 主题判定（SSR 防御：document 缺失时按浅色——SSR 下 MermaidBlock 只渲染骨架，
// 真实渲染发生在挂载后浏览器环境）。
function getDataTheme() {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// 懒加载缓存：mermaid 体积大，动态 import 首帧不阻塞（PRD §13 / tech-design 性能项）。
// 包仅导出 default（mermaid.core.mjs 实证：export { mermaid_default as default }）。
// 加载失败清缓存允许重试（E5 渲染依赖加载失败面：组件内回退骨架/源码，不白屏）。
let mermaidModulePromise = null;
function getMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid")
      .then((mod) => mod.default)
      .catch((err) => {
        mermaidModulePromise = null;
        throw err;
      });
  }
  return mermaidModulePromise;
}

// W-1 流式未闭合围栏判定：扫描源码文本的围栏开合状态（CommonMark：未闭合围栏块
// 延伸到 EOF——react-markdown 把尾部未闭合代码块解析为 EOF 块，码内无后续块）。
// 返回 { language, openerEndOffset }——文档结束于未闭合围栏内时该围栏的语言与
// 开启行结束偏移（含换行）；无未闭合围栏 → null。
// 注：闭合围栏可带 0-3 空格缩进（CommonMark），4+ 空格为缩进代码块不按围栏处理。
function findUnclosedFence(source) {
  let inFence = false;
  let language = null;
  let openerEndOffset = -1;
  let offset = 0;
  for (const line of source.split("\n")) {
    const trimmed = line.replace(/^ {0,3}/, "").trimEnd();
    if (/^`{3,}/.test(trimmed)) {
      if (inFence) {
        inFence = false; // 闭合
        language = null;
      } else {
        inFence = true;
        const m = /^`{3,}\s*([^\s`]+)?/.exec(trimmed);
        language = m && m[1] ? m[1].toLowerCase() : null;
        openerEndOffset = offset + line.length + 1; // 开启行结束偏移（跳过换行）
      }
    }
    offset += line.length + 1;
  }
  return inFence ? { language, openerEndOffset } : null;
}

// 当前 code 块是否 = 流式未闭合 mermaid 围栏的 EOF 块（W-1）：
// 判定 = code 文本（尾换行归一）=== 源码中未闭合开启行之后全部文本（尾换行归一）。
// （react-markdown 传给 components 的 node 为 hast code 元素，其 position 覆盖整个
// 围栏块（含开启/闭合行，实证 start.offset = 开启行首），不可用于内容偏移判定——
// 尾部文本比对为精确判定：闭合围栏的码内容 ≠ 开启行后全部源码（尾部含闭合行）。）
function isUnclosedMermaidBlock(codeText, unclosed, sourceText) {
  return (
    sourceText.slice(unclosed.openerEndOffset).replace(/\n$/, "") ===
    codeText.replace(/\n$/, "")
  );
}

// 流式未闭合围栏上下文（W-1）：{ unclosedMermaid, sourceText }，供 code 组件判定。
const UnclosedFenceContext = createContext(null);

let mermaidInstanceId = 0;

/**
 * Mermaid 围栏渲染（B3 / REQ-AGENT-049）：懒加载 + securityLevel:'strict' +
 * 暗色独立配色 + 失败回退源码。
 * - 挂载/主题变化 → 动态 import mermaid → initialize（strict + 按 data-theme 的
 *   两套主题配置）→ render → svg；
 * - 加载中 → 骨架占位；语法失败/异常 → 回退围栏源码文本（E1，不崩）。
 */
function MermaidBlock({ code }) {
  const [state, setState] = useState({ phase: "loading" });
  const [theme, setTheme] = useState(getDataTheme);
  const containerRef = useRef(null);

  // 主题跟随（REQ-AGENT-049 标准 3 / F6 步骤 2）：data-theme 变化 → 换主题配置重渲染
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getDataTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // 渲染（懒加载 + 显式主题配置 + 失败回退）
  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    (async () => {
      try {
        const mermaid = await getMermaid();
        if (cancelled) return;
        const themeConfig = MERMAID_THEMES[theme] ?? MERMAID_THEMES.light;
        // I-6 硬约束：securityLevel:'strict' 显式（不依赖运行库默认）；startOnLoad:false
        // 由本组件显式驱动 render（懒加载语义）。
        mermaid.initialize({
          securityLevel: "strict",
          startOnLoad: false,
          theme: themeConfig.theme,
          themeVariables: themeConfig.themeVariables,
        });
        const id = `mmd-${mermaidInstanceId++}`;
        const { svg } = await mermaid.render(id, code);
        if (cancelled) return;
        setState({ phase: "ready", svg });
      } catch {
        if (!cancelled) setState({ phase: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (state.phase === "error") {
    // E1：语法失败/异常 → 回退显示围栏源码文本（不崩）
    return (
      <pre className="mermaid-fallback">
        <code className="language-mermaid">{code}</code>
      </pre>
    );
  }
  if (state.phase === "ready") {
    // strict 下 mermaid 输出已 DOMPurify 清洗（见文件头实证）——零注入面。
    return (
      <div className="mermaid-block" ref={containerRef} dangerouslySetInnerHTML={{ __html: state.svg }} />
    );
  }
  // 懒加载中：骨架占位（首帧不阻塞）
  return (
    <div className="mermaid-block mermaid-loading" ref={containerRef}>
      <span className="mermaid-loading-hint">图表渲染中…</span>
    </div>
  );
}

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
  // ```mermaid 围栏：MdCode 输出 MermaidBlock（自包含容器）/字面量 code——
  // 不套 pre 包裹（避免 pre 内嵌 div / 嵌套 pre 的非法结构；MermaidBlock 自带容器）。
  // 判定 = pre 的直接子元素（components.code 元素）className 含 language-mermaid。
  const child = Array.isArray(children) ? children[0] : children;
  if (
    child &&
    typeof child.props?.className === "string" &&
    child.props.className.includes("language-mermaid")
  ) {
    return <>{children}</>;
  }
  return (
    <pre {...props}>
      <InPreContext.Provider value>{children}</InPreContext.Provider>
    </pre>
  );
}

function MdCode({ node: _node, className, children, ...props }) {
  const match = /language-([\w-]+)/.exec(className || "");
  const language = match ? match[1] : undefined;
  const text = (
    Array.isArray(children) ? children.join("") : String(children ?? "")
  ).replace(/\n$/, "");

  // B3 / REQ-AGENT-049：```mermaid 围栏 → MermaidBlock（不走 hljs）。
  // 顺序在 inPre 判定之前：MdPre 对 mermaid 围栏 unwrap（不提供 InPreContext），
  // 故此处不能依赖 inPre；行内 code 不可能带 language-mermaid（围栏 info 串专属）。
  if (language === "mermaid") {
    const unclosedCtx = useContext(UnclosedFenceContext);
    const unclosed =
      unclosedCtx && unclosedCtx.unclosedMermaid
        ? unclosedCtx.unclosedMermaid
        : null;
    if (
      unclosed &&
      isUnclosedMermaidBlock(text, unclosed, unclosedCtx.sourceText)
    ) {
      // W-1：流式未闭合 mermaid 围栏 → 字面量（闭合才渲染；不跑慢速 mermaid
      // → 无错误回退闪烁）
      return (
        <code
          className={`${className ?? ""} language-mermaid`.trim()}
          {...props}
        >
          {text}
        </code>
      );
    }
    return <MermaidBlock code={text} />;
  }

  const inPre = useContext(InPreContext);
  if (!inPre) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

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

// react-markdown components（模块级常量：memo 缓存下引用稳定，避免每帧重建对象）
const MD_COMPONENTS = { pre: MdPre, code: MdCode };

// remark/rehype 插件（模块级常量，同上）
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [[rehypeKatex, KATEX_OPTIONS]];

function MarkdownRenderer(props) {
  const { text = "", streaming = false } = props;
  // props.projectDir：接口 2 预留（Slice 6 图片解析根），本切片不消费。

  // W-1：流式未闭合 mermaid 围栏判定（findUnclosedFence 源码实证——react-markdown
  // 把未闭合围栏解析为 EOF 码块）。非流式直接渲染（历史/完成态文本围栏必闭合）。
  const unclosedFence = streaming ? findUnclosedFence(text) : null;
  const unclosedMermaid =
    unclosedFence && unclosedFence.language === "mermaid" ? unclosedFence : null;

  return (
    <MarkdownErrorBoundary text={text}>
      <div className="md">
        <UnclosedFenceContext.Provider value={{ unclosedMermaid, sourceText: text }}>
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={MD_COMPONENTS}
          >
            {text}
          </ReactMarkdown>
        </UnclosedFenceContext.Provider>
      </div>
    </MarkdownErrorBoundary>
  );
}

export default memo(MarkdownRenderer);
