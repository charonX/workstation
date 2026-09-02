// src/renderer/components/filetree/fileTreeStore.js
// 文件树边栏 mini-store 工厂（REQ-PREVIEW-007，PRD §10.2 文件树边栏模块；
// mini-store 模式先例：browserPanelStore.js，工厂模式——状态实例私有）。
//
// 职责（store 层，React 组件层在 Slice 3 接线）：
// - open(projectId)：边栏展开 + GET /api/agent/files/list?dir="" 一次（懒加载——
//   不预取子目录，REQ-007 AC2）。
// - toggleDir(relDir)：未展开 → 就地展开 + list 该 dir；已展开 → 收起（不重请求）。
// - collapseAll()/expandAll()：收起全部 / 复展已加载过的目录（均不重请求，
//   §6.3 块 3 row 2）；allCollapsed 驱动头部按钮文案翻转。
// - selectFile(relPath)：分发 openWithPath(projectId, relPath)（相对路径原样透传）
//   + 选中态置位。
// - 排序与噪音过滤是服务端契约（§10.4 接口 1），store 原样保留响应顺序，不重排。

export function createFileTreeStore(deps) {
  const { request, openWithPath } = deps;
  const listeners = new Set();

  let state = {
    open: false,
    projectId: null,
    entriesByDir: {},
    expanded: new Set(),
    selected: null,
    allCollapsed: false,
  };
  // 已加载过（list 响应已入状态）的目录——expandAll 的复展依据（不重请求）。
  const loadedDirs = new Set();

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

  async function fetchDir(projectId, dir) {
    const res = await request(
      "GET",
      `/api/agent/files/list?projectId=${encodeURIComponent(projectId)}&dir=${encodeURIComponent(dir)}`
    );
    if (!res || res.status >= 400) return;
    const entries = res.body && Array.isArray(res.body.entries) ? res.body.entries : [];
    loadedDirs.add(dir);
    set({ entriesByDir: { ...state.entriesByDir, [dir]: entries } });
  }

  async function open(projectId) {
    set({ open: true, projectId, selected: null, allCollapsed: false });
    await fetchDir(projectId, "");
  }

  function close() {
    set({ open: false });
  }

  async function toggleDir(relDir) {
    if (state.expanded.has(relDir)) {
      const expanded = new Set(state.expanded);
      expanded.delete(relDir);
      set({ expanded });
      return;
    }
    const expanded = new Set(state.expanded);
    expanded.add(relDir);
    set({ expanded, allCollapsed: false });
    if (!loadedDirs.has(relDir)) {
      await fetchDir(state.projectId, relDir);
    }
  }

  function collapseAll() {
    set({ expanded: new Set(), allCollapsed: true });
  }

  // 复展已加载过的目录（根 "" 除外——它恒显不在 expanded 集合语义内），不重请求。
  function expandAll() {
    const expanded = new Set([...loadedDirs].filter((dir) => dir !== ""));
    set({ expanded, allCollapsed: false });
  }

  function selectFile(relPath) {
    set({ selected: relPath });
    if (typeof openWithPath === "function") openWithPath(state.projectId, relPath);
  }

  return {
    getState,
    subscribe,
    open,
    close,
    toggleDir,
    collapseAll,
    expandAll,
    selectFile,
  };
}
