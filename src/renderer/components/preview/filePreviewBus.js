// src/renderer/components/preview/filePreviewBus.js
// 文件预览 / 文件树模块级总线（REQ-PREVIEW-001/006/007，ADR-042 决策 2）：
// Slice 2 的 store 工厂（filePreviewStore/fileTreeStore）在此实例化为单例并接线
// 生产桥——先例：browserPanelStore.js 的模块级 mini-store 总线（面板组件、
// ChatView 头部按钮、MarkdownRenderer 聊天路径点击、Assistant SSE 消费互不互为父子）。
//
// 接线内容：
// - request 桥：store seam 期望 {status, body} 原样响应（client.js 的 get/post 会在
//   !ok 时 throw，不适配），此处用薄 fetch 适配器（ADR-042 决策 1：HTTP 通道）。
// - browserSlot 桥：isBrowserPanelOpen/closeBrowserPanel（槽位互斥被收起方）。
// - 反向互斥：订阅 browserPanelStore——open 变 true 时 notifyBrowserOpened()。
// - toast 桥：store 的 toast(message) 与 E5 无根提示共用一个模块级 toast
//   mini-store，FilePreviewPanel 订阅呈现（data-testid="preview-toast"）。
// - openFilePreviewPath/notifyNoProjectRoot：MarkdownRenderer 行内 code 路径
//   点击分发桥（REQ-006 AC4）。

import { useSyncExternalStore } from "react";
import { createFilePreviewStore } from "./filePreviewStore.js";
import { createFileTreeStore } from "../filetree/fileTreeStore.js";
import { createPreviewImageBlobs } from "./previewImageBlobs.js";
import {
  subscribeBrowserPanel,
  isBrowserPanelOpen,
  closeBrowserPanel,
} from "../browser/browserPanelStore.js";

// store request seam：(method, urlPath, body?) → Promise<{ status, body }>；
// 错误响应体 = 服务端 sendError 封套 { error: "E-PREVIEW-*", message }（Slice 1 契约）。
async function request(method, urlPath, body) {
  const base = (typeof window !== "undefined" && window.opc?.apiBaseUrl) || "";
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null); // 204/非 JSON → null
  return { status: res.status, body: json };
}

// —— toast mini-store（preview-toast 呈现数据源；1800ms 自动消失由面板组件负责）——
let toastState = { message: null, seq: 0 };
const toastListeners = new Set();

function emitToast() {
  for (const fn of [...toastListeners]) {
    try {
      fn();
    } catch {
      // 监听器异常不传染其余订阅者
    }
  }
}

export function subscribePreviewToast(fn) {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}

export function getPreviewToast() {
  return toastState;
}

export function showPreviewToast(message) {
  toastState = { message, seq: toastState.seq + 1 };
  emitToast();
}

export function dismissPreviewToast() {
  if (toastState.message === null) return;
  toastState = { ...toastState, message: null };
  emitToast();
}

// —— store 单例 ——
export const previewImageBlobs = createPreviewImageBlobs();

export const filePreviewStore = createFilePreviewStore({
  request,
  browserSlot: { isOpen: isBrowserPanelOpen, collapse: closeBrowserPanel },
  imageBlobs: previewImageBlobs,
  toast: showPreviewToast,
});

export const fileTreeStore = createFileTreeStore({
  request,
  openWithPath: (projectId, path) => {
    void filePreviewStore.openWithPath(projectId, path);
  },
});

// 聊天路径点击桥（REQ-006 AC4）：相对路径原样透传，主进程按解析根解析。
export function openFilePreviewPath(projectId, path) {
  void filePreviewStore.openWithPath(projectId, path);
}

// E5 无解析根提示（REQ-006 AC4 / PRD §8 E5）：不发请求，仅提示。
export function notifyNoProjectRoot() {
  showPreviewToast("当前会话无项目空间");
}

// 文件树入口开合（ChatView 头部「🗂 文件」按钮；REQ-007 AC4 再点收起）。
export function toggleFileTree(projectId) {
  if (fileTreeStore.getState().open) fileTreeStore.close();
  else void fileTreeStore.open(projectId);
}

// 反向槽位互斥（ADR-042 决策 2）：浏览器面板打开 → 文件预览面板收起。
// 模块级接线一次（总线为单例，不随组件挂载重复订阅）。
subscribeBrowserPanel(() => {
  if (isBrowserPanelOpen()) filePreviewStore.notifyBrowserOpened();
});

// —— React 订阅 hooks（useSyncExternalStore 模式，先例 browserPanelStore）——
export function useFilePreviewState() {
  return useSyncExternalStore(
    filePreviewStore.subscribe,
    filePreviewStore.getState,
    filePreviewStore.getState
  );
}

export function useFileTreeState() {
  return useSyncExternalStore(
    fileTreeStore.subscribe,
    fileTreeStore.getState,
    fileTreeStore.getState
  );
}

export function useFileTreeOpen() {
  return useSyncExternalStore(
    fileTreeStore.subscribe,
    () => fileTreeStore.getState().open,
    () => false
  );
}

export function usePreviewToast() {
  return useSyncExternalStore(subscribePreviewToast, getPreviewToast, getPreviewToast);
}
