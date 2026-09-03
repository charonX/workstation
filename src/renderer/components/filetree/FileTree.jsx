// src/renderer/components/filetree/FileTree.jsx
// 文件树边栏（REQ-PREVIEW-007，PRD §10.2 文件树边栏模块；UX 参照
// ux/file-preview.html .tree-col 分区：tree-head / tree-body / tree-note）。
// 会话列表与对话窗之间的左侧边栏，可收起（收起 = 不渲染，E2E 断言子条目
// DOM 不存在而非隐藏）。
//
// 行为（状态机在 fileTreeStore，本组件纯呈现 + 事件分发）：
// - 打开时顶层 list(dir="") 已入状态（懒加载：未展开目录不发 list）；
// - 点目录 → toggleDir 就地展开/收起（子条目仅展开时渲染）；
// - 头部「收起全部 / 展开全部」→ collapseAll/expandAll（allCollapsed 驱动文案翻转）；
// - 点文件 → selectFile → 分发 openWithPath 到文件预览面板；选中条目
//   aria-current='true' + data-selected='true' 高亮（REQ-007 AC4）。
// 排序与噪音过滤是服务端契约（§10.4 接口 1），UI 保持响应顺序不重排。

import { fileTreeStore, useFileTreeState } from "../preview/filePreviewBus.js";
import "./filetree.css";

function TreeEntries({ dir, depth, state }) {
  const entries = state.entriesByDir[dir] ?? [];
  return entries.map((entry) => {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    const indent = 12 + depth * 18;
    if (entry.type === "dir") {
      const expanded = state.expanded.has(rel);
      return (
        <div key={rel}>
          <div
            className={`tree-row${expanded ? " open" : ""}`}
            style={{ paddingLeft: indent }}
            data-testid={`tree-entry-${rel}`}
            role="button"
            tabIndex={0}
            onClick={() => void fileTreeStore.toggleDir(rel)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void fileTreeStore.toggleDir(rel);
              }
            }}
          >
            <span className="twisty">▶</span>
            <span className="ficon">📁</span>
            <span className="fname">{entry.name}</span>
          </div>
          {/* 子条目仅展开时渲染（collapseAll 后 DOM 不存在，REQ-007 AC3 语义） */}
          {expanded && (
            <div className="tree-children open">
              <TreeEntries dir={rel} depth={depth + 1} state={state} />
            </div>
          )}
        </div>
      );
    }
    const selected = state.selected === rel;
    return (
      <div
        key={rel}
        className={`tree-row${selected ? " selected" : ""}`}
        style={{ paddingLeft: indent }}
        data-testid={`tree-entry-${rel}`}
        data-selected={selected ? "true" : undefined}
        aria-current={selected ? "true" : undefined}
        role="button"
        tabIndex={0}
        onClick={() => fileTreeStore.selectFile(rel)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileTreeStore.selectFile(rel);
          }
        }}
      >
        <span className="twisty" />
        <span className="ficon">📄</span>
        <span className="fname">{entry.name}</span>
      </div>
    );
  });
}

export default function FileTree() {
  const state = useFileTreeState();
  if (!state.open) return null;
  return (
    <aside className="tree-col" data-testid="file-tree">
      <div className="tree-head">
        <span className="t-title">文件</span>
        <button
          type="button"
          className="tree-toggle-all"
          data-testid="tree-toggle-all"
          onClick={() => (state.allCollapsed ? fileTreeStore.expandAll() : fileTreeStore.collapseAll())}
        >
          {state.allCollapsed ? "⇅ 展开全部" : "⇅ 收起全部"}
        </button>
      </div>
      <div className="tree-body">
        <TreeEntries dir="" depth={0} state={state} />
      </div>
      <div className="tree-note">已隐藏：.git / node_modules / dist</div>
    </aside>
  );
}
