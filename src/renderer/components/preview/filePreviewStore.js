// src/renderer/components/preview/filePreviewStore.js
// 文件预览面板 mini-store 工厂（REQ-PREVIEW-001/002/004/005/009，PRD §10.2
// 文件预览面板模块；mini-store 模式先例：browserPanelStore.js，但此处为工厂模式——
// 状态实例私有，测试/多实例互不染）。
//
// 职责（store 层，React 组件层在 Slice 3 接线）：
// - openWithPath(projectId, path)：槽位互斥（浏览器面板开 → 收起，ADR-042 决策 2）
//   → GET /api/agent/files/read → 成功（kind/content/language 入状态，markdown 默认
//   渲染视图）/ 错误（E-PREVIEW-* 码入 state.error，错误页仍在面板内）→ 成功路径
//   POST /api/agent/files/watch 注册变更监听（E2/错误态不注册，§10.4 接口 3）。
// - kind="image" → imageBlobs.create(projectId, path) 取 blob URL；close/切换 → revoke
//   （不泄漏，REQ-004 AC3）。
// - close()：收起 + DELETE watch 注销 + revoke blob（句柄不泄漏，§10.7）。
// - notifyBrowserOpened()：反向互斥（浏览器面板打开 → 本面板收起）。
// - handleSseEvent(frame)：SSE file-preview-changed 消费（REQ-009）——不匹配当前打开
//   文件 → 忽略；modified → 重读一次 + toast「文件已被外部修改，已自动刷新」（§10.3
//   流 C 原文）；deleted → E2 页（E-PREVIEW-NOT-FOUND）+ 注销监听。
//
// 状态变更经 subscribe/getState 通知（useSyncExternalStore 模式，供 React 接线）。

const REFRESH_TOAST = "文件已被外部修改，已自动刷新";

export function createFilePreviewStore(deps) {
  const { request, browserSlot, imageBlobs, toast } = deps;
  const listeners = new Set();

  let state = {
    open: false,
    projectId: null,
    path: null,
    kind: null,
    content: null,
    language: null,
    size: 0,
    mtimeMs: 0,
    imageUrl: null,
    viewMode: "render",
    showRenderToggle: false,
    error: null,
  };
  let watchId = null;
  let blobUrl = null;

  function emit() {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch {
        // 监听器异常不传染其余订阅者
      }
    }
  }

  function set(patch) {
    state = { ...state, ...patch };
    emit();
  }

  function getState() {
    return state;
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function readUrl(projectId, path) {
    return `/api/agent/files/read?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`;
  }

  async function releaseWatch() {
    const id = watchId;
    watchId = null;
    if (!id) return;
    try {
      await request("DELETE", `/api/agent/files/watch/${encodeURIComponent(id)}`);
    } catch {
      // 注销失败不阻断面板操作（服务端 DELETE 幂等吞掉）
    }
  }

  function revokeBlob() {
    if (!blobUrl) return;
    const url = blobUrl;
    blobUrl = null;
    try {
      imageBlobs.revoke(url);
    } catch {
      // revoke 失败不影响面板状态
    }
  }

  function errorCodeOf(res) {
    return res && res.body && typeof res.body.error === "string" ? res.body.error : "E-PREVIEW-READ-FAILED";
  }

  // 响应归来时面板已关闭或已切到别的文件 → 丢弃陈旧结果（竞态以最近操作为准）。
  function isCurrent(projectId, path) {
    return state.open && state.projectId === projectId && state.path === path;
  }

  // 右侧槽位互斥：预览打开 → 浏览器面板收起（ADR-042 决策 2，互收不毁实例）。
  // collapse 语义幂等（已收起时调用无副作用）；isOpen 仅作冗余调用短路——
  // 桥查询异常不阻断收起（按打开处理，collapse 幂等兜底），桥异常不阻断预览。
  function collapseBrowserSlot() {
    if (!browserSlot) return;
    let browserOpen = true;
    try {
      if (typeof browserSlot.isOpen === "function") browserOpen = Boolean(browserSlot.isOpen());
    } catch {
      browserOpen = true;
    }
    if (!browserOpen || typeof browserSlot.collapse !== "function") return;
    try {
      browserSlot.collapse();
    } catch {
      // 桥异常不阻断预览打开
    }
  }

  async function openWithPath(projectId, path) {
    collapseBrowserSlot();
    // 切换/重开：注销旧 watch、revoke 旧 blob（REQ-009 AC4）
    await releaseWatch();
    revokeBlob();
    set({
      open: true,
      projectId,
      path,
      kind: null,
      content: null,
      language: null,
      imageUrl: null,
      viewMode: "render",
      showRenderToggle: false,
      error: null,
    });
    const res = await request("GET", readUrl(projectId, path));
    if (!isCurrent(projectId, path)) return;
    if (!res || res.status >= 400) {
      // 错误态仍在面板内呈现（REQ-005）；E2/错误态不注册 watch（§10.4 接口 3）
      set({ error: errorCodeOf(res), kind: null, content: null, language: null, showRenderToggle: false });
      return;
    }
    const body = res.body || {};
    let imageUrl = null;
    if (body.kind === "image") {
      imageUrl = imageBlobs.create(projectId, path);
      blobUrl = imageUrl;
    }
    set({
      error: null,
      kind: body.kind ?? null,
      content: body.content ?? null,
      language: body.language ?? null,
      size: body.size ?? 0,
      mtimeMs: body.mtimeMs ?? 0,
      imageUrl,
      viewMode: "render",
      showRenderToggle: body.kind === "markdown",
    });
    // 打开成功 → 注册变更监听（§10.3 流 A 步骤 4）
    try {
      const w = await request("POST", "/api/agent/files/watch", { projectId, path });
      if (w && w.status < 400 && w.body && typeof w.body.watchId === "string") {
        if (isCurrent(projectId, path) && !watchId) {
          watchId = w.body.watchId;
        } else {
          // 注册返回时已切换/关闭 → 立即注销，句柄不泄漏
          await request("DELETE", `/api/agent/files/watch/${encodeURIComponent(w.body.watchId)}`);
        }
      }
    } catch {
      // watch 注册失败不影响预览本体（自动刷新缺失由重开 re-read 兜底，§10.6）
    }
  }

  async function close() {
    await releaseWatch();
    revokeBlob();
    set({ open: false });
  }

  function setViewMode(mode) {
    if (mode !== "render" && mode !== "source") return;
    if (state.viewMode === mode) return;
    set({ viewMode: mode });
  }

  // 反向互斥：浏览器面板打开 → 本面板收起（ADR-042 决策 2）
  function notifyBrowserOpened() {
    if (!state.open) return;
    void releaseWatch();
    revokeBlob();
    set({ open: false });
  }

  // 重读当前文件（SSE modified / 重连兜底共用）
  async function refresh() {
    const { projectId, path } = state;
    const res = await request("GET", readUrl(projectId, path));
    if (!isCurrent(projectId, path)) return;
    if (!res || res.status >= 400) {
      set({ error: errorCodeOf(res), kind: null, content: null, language: null, showRenderToggle: false });
      return;
    }
    const body = res.body || {};
    set({
      error: null,
      kind: body.kind ?? null,
      content: body.content ?? null,
      language: body.language ?? null,
      size: body.size ?? 0,
      mtimeMs: body.mtimeMs ?? 0,
      showRenderToggle: body.kind === "markdown",
    });
  }

  // SSE file-preview-changed 消费（REQ-009；§10.4 接口 5 消费语义）
  function handleSseEvent(frame) {
    if (!frame || frame.type !== "file-preview-changed") return;
    if (!state.open || frame.projectId !== state.projectId || frame.path !== state.path) return;
    if (frame.change === "deleted") {
      // E2 页 + 注销监听（§10.4 接口 5 删除行）
      set({ error: "E-PREVIEW-NOT-FOUND", kind: null, content: null, language: null, showRenderToggle: false });
      void releaseWatch();
      return;
    }
    if (frame.change === "modified") {
      // toast 在事件消费时同步发出（重读已发起，微任务预算浅的消费者不等重读完成）；
      // 重读结果随后对齐状态（§10.3 流 C「以最近一次读取为准」），失败走 error 态。
      void refresh();
      if (typeof toast === "function") toast(REFRESH_TOAST);
    }
  }

  return {
    getState,
    subscribe,
    openWithPath,
    close,
    setViewMode,
    notifyBrowserOpened,
    handleSseEvent,
  };
}
