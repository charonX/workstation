// src/renderer/components/assistant/MarkdownRenderer.jsx
// Markdown 渲染组件（tech-design 接口 2 / REQ-AGENT-047 B1 + REQ-AGENT-053 B7 渲染接入）。
//
// - 渲染：react-markdown + remark-gfm（GFM 全量：标题/列表/表格/引用/链接/代码块/任务列表）。
// - 安全：HTML 全转义——不引 rehype-raw，react-markdown 默认把原始 HTML（<script> 等）
//   转为转义源码文本节点，零 XSS 面（PRD D3 / §12.1 范围外 1）。
// - 兜底：错误边界（E5 / REQ-AGENT-047 标准 4）——渲染抛错回退纯文本，不白屏、不崩。
// - 样式：渲染产物包 .md 类（ux/assistant-rich.html .md 样式语义，CSS 在 assistant.css）。
// - 性能：React.memo 按 text 缓存——流式每帧喂完整累积文本，文本不变跳过重渲染；
//   未闭合语法由 react-markdown 天然显示字面量，闭合即渲染（D5 零额外机制，E6）。
//
// props（接口 2）：
//   text        string   markdown 源文本
//   streaming?  boolean  流式态（Slice 5 W-1：未闭合 mermaid 围栏流式期间字面量判定用）
//   projectDir? string   图片解析根（Slice 6 REQ-AGENT-051 接入；本切片不使用）
import { Component, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  // 由后续切片（5/6）消费；本切片只做纯 GFM + HTML 转义 + 流式文本渲染接入。

  return (
    <MarkdownErrorBoundary text={text}>
      <div className="md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
}

export default memo(MarkdownRenderer);
