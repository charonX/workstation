// REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-007
// REQ-VERSION: v1-hash:d06296e2ed011b1fc699777634a8b2f4eaa7c17954962e28f76383a725ccefb9
// CAPABILITY-TRACE: file-preview
// ENTITY-TRACE: file-tree
// EXPECTED-TRACE: prd.md §6.1 流B 步骤2/4, §6.3 块3 rows 1-2, §10.4 接口1
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true（2026-09-02 assertion signoff，见 signoff.md）
//
// seam：文件树 mini-store（先例：browserPanelStore.js）。契约落点
// src/renderer/components/filetree/fileTreeStore.js，导出工厂：
//   createFileTreeStore(deps) → {
//     getState(), subscribe(fn),
//     open(projectId), close(), toggleDir(relDir), collapseAll(), expandAll(), selectFile(relPath)
//   }
// deps = { request(method, urlPath) → Promise<{status, body}>, openWithPath(projectId, path) }。
// getState() 至少暴露：{ open, projectId, entriesByDir: Map|object（dir → entries）,
//   expanded: Set|array（已展开 dir 相对路径）, selected, allCollapsed }。
// 排序与噪音过滤是服务端契约（§10.4 接口1），store 原样保留响应顺序，不重排。
// React 组件层（条目渲染、入口显隐）由 E2E 闭合（file-tree/.../e2e/fileTree.test.cjs）。

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../../../../../src/renderer/components/filetree/fileTreeStore.js").catch(() => null);
assert.ok(
  mod,
  "seam 未就绪：src/renderer/components/filetree/fileTreeStore.js 尚未实现（REQ-PREVIEW-007，prd.md §10.2 文件树边栏模块）"
);
const { createFileTreeStore } = mod;

// fixture 响应（对齐 §10.4 接口1 golden：目录在前、噪音目录已被服务端过滤）
const ROOT_ENTRIES = [
  { name: "docs", type: "dir" },
  { name: "src", type: "dir" },
  { name: "README.md", type: "file", size: 9 },
];
const SRC_ENTRIES = [{ name: "auth.js", type: "file", size: 12 }];

function makeDeps() {
  const calls = { list: [], openWithPath: [] };
  return {
    calls,
    deps: {
      async request(method, urlPath) {
        if (method === "GET" && urlPath.startsWith("/api/agent/files/list")) {
          const dir = new URL(urlPath, "http://x").searchParams.get("dir") ?? "";
          calls.list.push(dir);
          return { status: 200, body: { entries: dir === "src" ? SRC_ENTRIES : dir === "" ? ROOT_ENTRIES : [] } };
        }
        return { status: 404, body: { error: "E-PREVIEW-NOT-FOUND" } };
      },
      openWithPath: (pid, p) => calls.openWithPath.push([pid, p]),
    },
  };
}

function expandedOf(store) {
  const e = store.getState().expanded;
  return e instanceof Set ? [...e] : e;
}

describe("REQ-PREVIEW-007 AC1/AC2：打开与懒加载", () => {
  it("open(projectId) → 请求根 list(dir=\"\") 一次，顶层条目进状态", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流B 步骤1（边栏展开，顶层条目 = 解析根 list 响应）
    const { calls, deps } = makeDeps();
    const store = createFileTreeStore(deps);
    await store.open("p1");
    assert.equal(store.getState().open, true);
    assert.deepEqual(calls.list, [""]);
  });

  it("懒加载：未展开的目录不发 list；点击目录就地展开并请求该 dir", async () => {
    // EXPECTED-TRACE: requirements.md REQ-PREVIEW-007 AC2（懒加载：未展开的目录不发 list 请求）
    const { calls, deps } = makeDeps();
    const store = createFileTreeStore(deps);
    await store.open("p1");
    assert.deepEqual(calls.list, [""], "open 只请求根，不预取子目录");
    await store.toggleDir("src");
    assert.deepEqual(calls.list, ["", "src"]);
    assert.ok(expandedOf(store).includes("src"));
  });

  it("再次 toggleDir → 收起该目录", async () => {
    const { deps } = makeDeps();
    const store = createFileTreeStore(deps);
    await store.open("p1");
    await store.toggleDir("src");
    await store.toggleDir("src");
    assert.ok(!expandedOf(store).includes("src"));
  });
});

describe("REQ-PREVIEW-007 AC3：全部收起 / 全部展开", () => {
  it("两目录展开时点「收起全部」→ 均收起、allCollapsed=true；再「展开全部」→ 已加载目录复展", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块3 row 2（docs/、src/ 均展开 → 收起全部 → 仅顶层可见，
    // 按钮文案变「展开全部」；再点全部展开）
    const { deps } = makeDeps();
    const store = createFileTreeStore(deps);
    await store.open("p1");
    await store.toggleDir("docs");
    await store.toggleDir("src");
    assert.deepEqual(expandedOf(store).sort(), ["docs", "src"]);
    store.collapseAll();
    assert.deepEqual(expandedOf(store), []);
    assert.equal(store.getState().allCollapsed, true, "收起全部后按钮态翻转为「展开全部」");
    await store.expandAll();
    assert.deepEqual(expandedOf(store).sort(), ["docs", "src"], "展开全部恢复已加载目录的展开态");
    assert.equal(store.getState().allCollapsed, false);
  });
});

describe("REQ-PREVIEW-007 AC4：点击文件分发", () => {
  it("selectFile(\"src/auth.js\") → openWithPath(projectId, 相对路径) + 选中态", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流B 步骤3（点击代码文件 → 预览面板打开）+ REQ-007 AC4（选中高亮）
    const { calls, deps } = makeDeps();
    const store = createFileTreeStore(deps);
    await store.open("p1");
    store.selectFile("src/auth.js");
    assert.deepEqual(calls.openWithPath, [["p1", "src/auth.js"]]);
    assert.equal(store.getState().selected, "src/auth.js");
  });

  it("close() → 边栏收起（open=false）", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流B 步骤5（再次点击文件树入口 → 边栏收起）
    const { deps } = makeDeps();
    const store = createFileTreeStore(deps);
    await store.open("p1");
    store.close();
    assert.equal(store.getState().open, false);
  });
});
