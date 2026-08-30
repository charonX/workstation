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
// - 图片（B5 / REQ-AGENT-051，Slice 6）：
//   · 识别：① Markdown 图片语法 `![alt](path)` → mdast image → components.img；
//     ② 裸路径后处理（I-4）——段落 text 节点中匹配「路径形态 + 图片扩展名」的裸路径
//     → remark 插件拆分为 image 节点（data-bare-path 标记，经同一 img 管线）；
//   · 口径（I-5）：相对路径按 <projectDir>/<path> 解析；项目目录内绝对路径可渲染；
//     解析后出项目目录/不存在/非白名单扩展名 → 占位（E3）；
//   · 访问机制（I-3）：components.img → GET /api/agent/files/image（主进程白名单
//     判定）→ blob → URL.createObjectURL（组件卸载 revoke，防泄漏）；
//   · 误判控制（I-4）：裸路径仅「加载成功」才显示为图——失败/无解析根回退原文文本
//     （等价于「必须真实存在才转」，零额外探测请求）；Markdown 语法图片失败 → 占位；
//   · 无解析根（通用/飞书/孤儿空间 → projectDir 缺省）：Markdown 语法图片 → 占位、
//     裸路径 → 原文（tech-design 接口 2「无 projectDir → 占位」）；
//   · 远程 URL（带 scheme / 协议相对）→ 浏览器直连 <img>（本地白名单不适用）。
// - 样式：渲染产物包 .md 类（ux/assistant-rich.html .md 样式语义，CSS 在 assistant.css）。
// - 性能：React.memo 按 text 缓存；hljs 用 core + 常用语言注册（不整包引入）；mermaid 懒加载。
//
// props（接口 2）：
//   text        string   markdown 源文本
//   streaming?  boolean  流式态（W-1：未闭合 mermaid 围栏流式期间字面量判定）
//   projectDir? string   图片解析根（Slice 6 REQ-AGENT-051 接入）：项目空间会话 =
//                        项目 ID（主进程按 projects 表 registry 解析实际目录，renderer
//                        不持有绝对路径）；通用/飞书/孤儿空间 = undefined（无解析根）。
import { Component, createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import hljs from "highlight.js/lib/core";
import { fetchProjectImage } from "../../api/agentSessions.js";
import { openBrowserPanelWithUrl } from "../browser/browserPanelStore.js";

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

// —— 图片（B5 / REQ-AGENT-051，Slice 6）——
// 解析根上下文：值 = 项目空间会话的项目 ID（主进程按 registry 解析实际目录）；
// undefined（通用/飞书/孤儿空间）→ 无解析根（图片不可渲染）。
const ProjectDirContext = createContext(null);

// 远程/协议 URL（带 scheme 如 http:/https:/data:，或协议相对 //）→ 浏览器直连
// （本地文件白名单仅约束本地路径面；主进程 API 不经手网络 URL）。
const REMOTE_SRC_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

// 本地图片扩展名白名单（与主进程 /api/agent/files/image 同判——非白名单不发请求）。
const LOCAL_IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

// I-4 裸路径识别（REQ-AGENT-051 标准 2）：段落 text 节点中匹配「路径形态 + 图片
// 扩展名」的裸路径 → 拆分为 image 节点（经 components.img 统一管线）。
// 误判控制（I-4「路径必须真实存在才转」）：
// - 形态保守：必须含路径分隔符（./ ../ ~/ / 或 a/b/ 相对路径）——裸文件名
//   （如 "chart.png" 单独出现）不转；前后不得粘连路径字符（lookbehind/lookahead）；
// - 父节点限定 paragraph / listItem（紧凑列表的直接文本）：链接/图片/行内代码内
//   的文本不转（链接内的路径是链接文本）；
// - 存在性 = 加载成功才显示为图：失败回退原文文本（不占位、零探测请求）。
// - 结尾容忍英文句号（"见 ./chart.png。" 句子结束标点剥离）。
const BARE_PATH_RE =
  /(?<![\w.@~\-/:])((?:\.{1,2}\/|~\/|\/)?(?:[\w.@~-]+\/)*[\w.@~-]+\.(?:png|jpe?g|gif|webp|svg))(?![A-Za-z0-9_/~@-])/gi;

// 文本 → 分段（[{type:"text"|"image", ...}]）；无匹配 → null（保持原文本）。
function splitBareImagePaths(text) {
  const parts = [];
  let last = 0;
  let matched = false;
  for (const m of text.matchAll(BARE_PATH_RE)) {
    if (!m[0].includes("/")) continue; // 裸文件名（无路径分隔符）不转
    const lead = text.slice(last, m.index);
    if (lead) parts.push({ type: "text", text: lead });
    parts.push({ type: "image", path: m[0] });
    last = m.index + m[0].length;
    matched = true;
  }
  if (!matched) return null;
  const tail = text.slice(last);
  if (tail) parts.push({ type: "text", text: tail });
  return parts;
}

// remark 插件：mdast 文本节点后处理（I-4）。手写遍历（不引 mdast-util-visit 依赖）：
// 自底向上 + 子节点逆序遍历——splice 替换不使未处理索引失效；注入的 image/text 节点
// 无需再遍历（split 已产出最大分段）。
function remarkBareImagePaths() {
  return (tree) => {
    (function walk(node) {
      if (!node || typeof node !== "object") return;
      const children = node.children;
      if (!Array.isArray(children)) return;
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (!child || typeof child !== "object") continue;
        walk(child);
        if (child.type !== "text" || (node.type !== "paragraph" && node.type !== "listItem")) continue;
        const parts = splitBareImagePaths(String(child.value ?? ""));
        if (!parts) continue;
        node.children.splice(
          i,
          1,
          ...parts.map((p) =>
            p.type === "image"
              ? {
                  type: "image",
                  url: p.path,
                  alt: "",
                  data: { hProperties: { "data-bare-path": "true" } },
                }
              : { type: "text", value: p.text }
          )
        );
      }
    })(tree);
  };
}

/**
 * 图片渲染（REQ-AGENT-051 / I-3 机制）：本地路径 → 主进程 HTTP API 读文件 →
 * blob URL（卸载 revoke）；越权/不存在/非白名单 → 占位（Markdown 语法）或回退原文
 * （裸路径，I-4 误判控制）；远程 URL → 浏览器直连；无解析根 → 占位/原文。
 * 卸载 revoke：effect cleanup 对 objectUrlRef 中旧 URL revoke（防 blob URL 泄漏）。
 */
function MdImage({ src, alt, "data-bare-path": bare, ..._rest }) {
  const projectId = useContext(ProjectDirContext);
  const [state, setState] = useState({ phase: "loading" });
  const objectUrlRef = useRef(null);
  const barePath = bare === "true" || bare === true;

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      // 无解析根（通用/飞书/孤儿空间）：不请求（tech-design 接口 2）。
      setState({ phase: "no-root" });
      return undefined;
    }
    if (typeof src !== "string" || src === "" || REMOTE_SRC_RE.test(src)) {
      setState({ phase: "remote" });
      return undefined;
    }
    if (!LOCAL_IMAGE_EXT_RE.test(src)) {
      // 非白名单扩展名：主进程同判 404，不发请求（E3）。
      setState({ phase: "invalid" });
      return undefined;
    }
    setState({ phase: "loading" });
    fetchProjectImage(projectId, src)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        setState({ phase: "ok", url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "fail" });
      });
    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [src, projectId]);

  // E3 占位（Markdown 语法图片失败态）。
  const placeholder = <span className="img-fallback">图片不可用</span>;
  // 裸路径回退原文（I-4：加载成功才显示为图，失败保持原文）。
  const bareText = <span className="md-bare-path">{src}</span>;

  if (state.phase === "remote") {
    return <img src={src} alt={alt ?? ""} />;
  }
  if (state.phase === "ok") {
    return <img src={state.url} alt={alt ?? ""} />;
  }
  if (state.phase === "fail" || state.phase === "invalid" || state.phase === "no-root") {
    return barePath ? bareText : placeholder;
  }
  return null; // loading：不占位不闪烁（最终态快速到达；流式路径闭合即渲染）
}

// —— 链接（REQ-BROWSER-004，story 2026-08-24-embedded-browser）——
// http(s) 链接：左键点击 → 内置浏览器面板打开并加载（openBrowserPanelWithUrl →
// 模块级总线 → BrowserPanel 经 opc.browser.navigate 加载，不在系统浏览器打开、
// 不跳转主窗口）；右键 → 关联菜单（「在面板中打开」/「在系统浏览器打开」，
// 后者经 opc.openExternal，主进程 http/https 白名单兜底）。
// 非 http(s)（mailto: 等）保持现有行为（默认锚点，不拦截）。
// 分发判定提取自纯模块 ./mdLinkDispatch.js（AC2/AC3 组件测试 seam：mock 桥断言调用）。
import { dispatchLink, resolveLinkAction } from "./mdLinkDispatch.js";

function MdLink({ node: _node, href, children, ...props }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(null); // { x, y } | null（关联菜单锚点）

  // 菜单关闭：任意点击 / Escape（菜单打开期间全局监听，卸载清理）
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (resolveLinkAction(href) === "passthrough") {
    // 非 http(s) 协议（mailto: 等）保持现有行为
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  const openInPanel = (e) => {
    e.preventDefault();
    setMenu(null);
    dispatchLink(href, { openPanel: openBrowserPanelWithUrl });
  };
  const openInSystemBrowser = () => {
    setMenu(null);
    dispatchLink(href, { action: "external", openExternal: (u) => window.opc?.openExternal?.(u) });
  };

  return (
    <span className="md-link-wrap">
      <a
        href={href}
        {...props}
        onClick={openInPanel}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {children}
      </a>
      {menu && (
        <span className="md-link-menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" onClick={openInPanel}>
            {t("browser.openInPanel")}
          </button>
          <button type="button" onClick={openInSystemBrowser}>
            {t("browser.openExternal")}
          </button>
        </span>
      )}
    </span>
  );
}

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
const MD_COMPONENTS = { pre: MdPre, code: MdCode, img: MdImage, a: MdLink };

// remark/rehype 插件（模块级常量，同上；remarkBareImagePaths = I-4 裸路径识别）
const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkBareImagePaths];
const REHYPE_PLUGINS = [[rehypeKatex, KATEX_OPTIONS]];

function MarkdownRenderer(props) {
  const { text = "", streaming = false, projectDir } = props;
  // props.projectDir：接口 2 图片解析根（Slice 6 REQ-AGENT-051）——项目空间会话 =
  // 项目 ID（主进程按 registry 解析实际目录）；无解析根 → 图片占位/原文回退。

  // W-1：流式未闭合 mermaid 围栏判定（findUnclosedFence 源码实证——react-markdown
  // 把未闭合围栏解析为 EOF 码块）。非流式直接渲染（历史/完成态文本围栏必闭合）。
  const unclosedFence = streaming ? findUnclosedFence(text) : null;
  const unclosedMermaid =
    unclosedFence && unclosedFence.language === "mermaid" ? unclosedFence : null;

  return (
    <MarkdownErrorBoundary text={text}>
      <div className="md">
        <UnclosedFenceContext.Provider value={{ unclosedMermaid, sourceText: text }}>
          <ProjectDirContext.Provider value={projectDir}>
            <ReactMarkdown
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={MD_COMPONENTS}
            >
              {text}
            </ReactMarkdown>
          </ProjectDirContext.Provider>
        </UnclosedFenceContext.Provider>
      </div>
    </MarkdownErrorBoundary>
  );
}

export default memo(MarkdownRenderer);
