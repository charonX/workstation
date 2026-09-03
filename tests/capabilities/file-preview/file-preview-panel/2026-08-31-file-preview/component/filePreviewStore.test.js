// REQ-TRACE: 2026-08-31-file-preview/REQ-PREVIEW-001, REQ-PREVIEW-002, REQ-PREVIEW-004, REQ-PREVIEW-005, REQ-PREVIEW-009
// REQ-VERSION: v1-hash:d06296e2ed011b1fc699777634a8b2f4eaa7c17954962e28f76383a725ccefb9
// CAPABILITY-TRACE: file-preview
// ENTITY-TRACE: file-preview-panel
// EXPECTED-TRACE: prd.md §6.1 流A 步骤2/4、§6.3 块1 row1、§8 错误表全行、§10.3 流A 步骤4/流C、§10.4 接口3/5, ADR-042 决策2
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true（2026-09-02 assertion signoff，见 signoff.md）
//
// seam：文件预览面板 mini-store（先例：browserPanelStore.js 的 useSyncExternalStore
// 模式）。契约落点 src/renderer/components/preview/filePreviewStore.js，导出工厂：
//   createFilePreviewStore(deps) → {
//     getState(), subscribe(fn),
//     openWithPath(projectId, path), close(), setViewMode(mode),
//     notifyBrowserOpened(), handleSseEvent(frame)
//   }
// deps 全部为注入桥（测试零真实 I/O）：
//   request(method, urlPath, body?) → Promise<{ status, body }>   // HTTP 通道（ADR-042 决策1）
//   browserSlot: { isOpen() → bool, collapse() }                  // 槽位互斥（ADR-042 决策2）
//   imageBlobs: { create(projectId, path) → url, revoke(url) }    // 图片 blob（接口4）
//   toast(message)                                                // 刷新提示
// getState() 至少暴露：{ open, projectId, path, kind, content, language, viewMode,
//   showRenderToggle, error }（error 为 E-PREVIEW-* 错误码字符串或 null）。
// React 组件层（渲染/源码视图、错误页文案）由 E2E 闭合，本套件锁 store 行为契约。

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../../../../../src/renderer/components/preview/filePreviewStore.js").catch(() => null);
assert.ok(
  mod,
  "seam 未就绪：src/renderer/components/preview/filePreviewStore.js 尚未实现（REQ-PREVIEW-001，prd.md §10.2 文件预览面板模块）"
);
const { createFilePreviewStore } = mod;

// —— 测试替身（Stub 优先，Mock 仅用于调用断言边界，对齐 checklists/testing.md）——
function makeDeps(responder) {
  const calls = { request: [], collapse: 0, create: [], revoke: [], toast: [], watchPost: [], watchDelete: [] };
  const responderFn = responder ?? (async () => ({ status: 200, body: { kind: "markdown", content: "# Title", size: 7, mtimeMs: 1000 } }));
  let blobSeq = 0;
  return {
    calls,
    deps: {
      async request(method, urlPath, body) {
        calls.request.push([method, urlPath, body]);
        // watch 注册/注销走同一 request 通道（POST/DELETE /api/agent/files/watch）
        if (method === "POST" && urlPath.startsWith("/api/agent/files/watch")) {
          calls.watchPost.push(body);
          return { status: 200, body: { watchId: "w-1" } };
        }
        if (method === "DELETE" && urlPath.startsWith("/api/agent/files/watch/")) {
          calls.watchDelete.push(urlPath);
          return { status: 204, body: null };
        }
        return responderFn(method, urlPath, body);
      },
      browserSlot: { isOpen: () => deps.browserOpen, collapse: () => { calls.collapse += 1; deps.browserOpen = false; } },
      imageBlobs: {
        create: (projectId, p) => { const url = `blob:fake-${++blobSeq}`; calls.create.push([projectId, p, url]); return url; },
        revoke: (url) => calls.revoke.push(url),
      },
      toast: (m) => calls.toast.push(m),
      browserOpen: false,
    },
  };
}

async function openMarkdown(store) {
  await store.openWithPath("p1", "docs/guide.md");
}

describe("REQ-PREVIEW-001：面板容器与槽位互斥", () => {
  it("AC1：openWithPath → 面板打开，状态携带 projectId/path/kind/content", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流A 步骤2（面板滑出，头部显示该路径，渲染视图）
    const { deps } = makeDeps();
    const store = createFilePreviewStore(deps);
    await openMarkdown(store);
    const s = store.getState();
    assert.equal(s.open, true);
    assert.equal(s.projectId, "p1");
    assert.equal(s.path, "docs/guide.md");
    assert.equal(s.kind, "markdown");
    // EXPECTED-TRACE: prd.md §10.4 接口2 样例（content "# Title" 原样进入状态）
    assert.equal(s.content, "# Title");
    assert.equal(s.error, null);
  });

  it("AC2：浏览器面板打开时 openWithPath → 浏览器面板收起（互收不毁实例）", async () => {
    // EXPECTED-TRACE: ADR-042 决策2（右侧槽位互斥：预览开 → 浏览器收起，实例保活）
    const { calls, deps } = makeDeps();
    deps.browserOpen = true;
    const store = createFilePreviewStore(deps);
    await openMarkdown(store);
    assert.equal(calls.collapse, 1, "浏览器面板应被收起一次");
  });

  it("AC2 反向：浏览器面板打开事件 → 文件预览面板收起", async () => {
    // EXPECTED-TRACE: ADR-042 决策2（反向同理：打开浏览器面板 → 预览收起）
    const { deps } = makeDeps();
    const store = createFilePreviewStore(deps);
    await openMarkdown(store);
    store.notifyBrowserOpened();
    assert.equal(store.getState().open, false);
  });

  it("AC3：close → 收起；再次 openWithPath 可重新打开", async () => {
    // EXPECTED-TRACE: prd.md §6.1 流A 步骤4（点击 ✕ → 面板收起）
    const { deps } = makeDeps();
    const store = createFilePreviewStore(deps);
    await openMarkdown(store);
    await store.close();
    assert.equal(store.getState().open, false);
    await openMarkdown(store);
    assert.equal(store.getState().open, true);
  });
});

describe("REQ-PREVIEW-002 AC1/AC2/AC4：渲染/源码视图状态", () => {
  it("Markdown 默认渲染视图，showRenderToggle=true；可切源码", async () => {
    // EXPECTED-TRACE: requirements.md REQ-PREVIEW-002 AC2（默认渲染视图；切「源码」）
    const { deps } = makeDeps();
    const store = createFilePreviewStore(deps);
    await openMarkdown(store);
    assert.equal(store.getState().viewMode, "render");
    assert.equal(store.getState().showRenderToggle, true);
    store.setViewMode("source");
    assert.equal(store.getState().viewMode, "source");
  });

  it("code/image 不显示渲染开关（showRenderToggle=false）", async () => {
    // EXPECTED-TRACE: requirements.md REQ-PREVIEW-002 AC4（非 Markdown 不显示分段开关）
    const { deps } = makeDeps(async () => ({ status: 200, body: { kind: "code", language: "javascript", content: "const x = 1;", size: 12, mtimeMs: 1 } }));
    const store = createFilePreviewStore(deps);
    await store.openWithPath("p1", "src/auth.js");
    assert.equal(store.getState().kind, "code");
    assert.equal(store.getState().showRenderToggle, false);
  });
});

describe("REQ-PREVIEW-004：图片视图 blob 生命周期", () => {
  it("kind=image → imageBlobs.create(projectId, path)；close/切换 → revoke（不泄漏）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口4（面板经既有 image 端点取 blob URL）+ REQ-004 AC3（revoke）
    const { calls, deps } = makeDeps(async () => ({ status: 200, body: { kind: "image", size: 68, mtimeMs: 1 } }));
    const store = createFilePreviewStore(deps);
    await store.openWithPath("p1", "docs/logo.png");
    assert.deepEqual(calls.create.map(([pid, p]) => [pid, p]), [["p1", "docs/logo.png"]]);
    await store.close();
    assert.deepEqual(calls.revoke, ["blob:fake-1"]);
  });
});

describe("REQ-PREVIEW-005：错误态映射（E1–E6 全行）", () => {
  // EXPECTED-TRACE: prd.md §8 错误状态表全部六行（错误码 → 面板错误态）
  const cases = [
    ["E-PREVIEW-OUTSIDE-ROOT", 400],
    ["E-PREVIEW-NOT-FOUND", 404],
    ["E-PREVIEW-TOO-LARGE", 400],
    ["E-PREVIEW-UNSUPPORTED", 400],
    ["E-PREVIEW-NO-ROOT", 400],
    ["E-PREVIEW-READ-FAILED", 500],
  ];
  for (const [code, status] of cases) {
    it(`read 返回 ${code} → state.error=${code}（面板切对应错误页）`, async () => {
      const { deps } = makeDeps(async () => ({ status, body: { error: code, message: "x" } }));
      const store = createFilePreviewStore(deps);
      await store.openWithPath("p1", "docs/guide.md");
      const s = store.getState();
      assert.equal(s.open, true, "错误页仍在面板内呈现");
      assert.equal(s.error, code);
    });
  }
});

describe("REQ-PREVIEW-009：SSE 自动刷新消费", () => {
  it("AC1：modified 事件 → 重新 read + toast「文件已被外部修改，已自动刷新」", async () => {
    // EXPECTED-TRACE: prd.md §6.3 块4（v1→v2：重新 read）+ §10.4 接口5 修改行（toast 提示）
    const { calls, deps } = makeDeps();
    const store = createFilePreviewStore(deps);
    await openMarkdown(store);
    const readsBefore = calls.request.filter(([m, u]) => m === "GET" && u.includes("/read")).length;
    store.handleSseEvent({ type: "file-preview-changed", projectId: "p1", path: "docs/guide.md", change: "modified" });
    await Promise.resolve(); // 事件消费为异步重读
    await Promise.resolve();
    const readsAfter = calls.request.filter(([m, u]) => m === "GET" && u.includes("/read")).length;
    assert.equal(readsAfter, readsBefore + 1, "modified → 重新 read 一次");
    // EXPECTED-TRACE: prd.md §10.3 流C（toast 文案锚点）
    assert.deepEqual(calls.toast, ["文件已被外部修改，已自动刷新"]);
  });

  it("AC2：deleted 事件 → E2 错误页 + 注销监听", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口5 删除行（E2「文件不存在」页；监听注销）
    const { calls, deps } = makeDeps();
    const store = createFilePreviewStore(deps);
    await openMarkdown(store);
    store.handleSseEvent({ type: "file-preview-changed", projectId: "p1", path: "docs/guide.md", change: "deleted" });
    await Promise.resolve();
    assert.equal(store.getState().error, "E-PREVIEW-NOT-FOUND");
    assert.equal(calls.watchDelete.length, 1, "deleted → DELETE watch 注销");
  });

  it("AC3：(projectId, path) 不匹配的事件 → 忽略（不重读、不 toast）", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口5 消费语义行（不匹配 → 忽略）
    const { calls, deps } = makeDeps();
    const store = createFilePreviewStore(deps);
    await openMarkdown(store);
    const readsBefore = calls.request.filter(([m, u]) => m === "GET" && u.includes("/read")).length;
    store.handleSseEvent({ type: "file-preview-changed", projectId: "p1", path: "src/other.js", change: "modified" });
    store.handleSseEvent({ type: "file-preview-changed", projectId: "p2", path: "docs/guide.md", change: "modified" });
    await Promise.resolve();
    const readsAfter = calls.request.filter(([m, u]) => m === "GET" && u.includes("/read")).length;
    assert.equal(readsAfter, readsBefore);
    assert.deepEqual(calls.toast, []);
  });

  it("AC4：打开即 POST 注册 watch；close → DELETE 注销旧 watch", async () => {
    // EXPECTED-TRACE: prd.md §10.3 流A 步骤4（面板打开 → POST watch；关闭 → DELETE 注销）
    const { calls, deps } = makeDeps();
    const store = createFilePreviewStore(deps);
    await openMarkdown(store);
    assert.deepEqual(calls.watchPost, [{ projectId: "p1", path: "docs/guide.md" }]);
    await store.close();
    assert.equal(calls.watchDelete.length, 1);
    assert.ok(calls.watchDelete[0].includes("w-1"), "DELETE 携带注册返回的 watchId");
  });
});
