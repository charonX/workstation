// src/renderer/components/browser/browserPanelStore.js
// 浏览器面板渲染进程内共享状态总线（REQ-BROWSER-004，PRD §10.2 BrowserPanel 职责）：
// BrowserPanel（状态消费/布局真相持有）与 ChatView 头部「⧉ 浏览器」按钮、
// MarkdownRenderer 链接点击（触发方）不互为父子——模块级 mini-store +
// useSyncExternalStore（最小方案，不为单面板引全局状态库）。
//
// 状态：
// - open：面板开合（真相在本模块；主进程 open 是 bounds 推送的镜像）；
// - pendingNav {url, seq}：外部触发的「打开并导航」请求（聊天链接点击路径），
//   BrowserPanel 经 seq 去重消费（同一事件不重复导航，新请求 seq 单调递增）。
import { useSyncExternalStore } from "react";

let open = false;
let pendingNav = null;
let navSeq = 0;
const listeners = new Set();

function emit() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // 监听器异常不传染其余订阅者
    }
  }
}

export function subscribeBrowserPanel(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isBrowserPanelOpen() {
  return open;
}

export function getBrowserPendingNav() {
  return pendingNav;
}

export function openBrowserPanel() {
  if (!open) {
    open = true;
    emit();
  }
}

export function closeBrowserPanel() {
  if (open) {
    open = false;
    emit();
  }
}

export function toggleBrowserPanel() {
  open = !open;
  emit();
}

// 打开面板并请求导航到 url（MarkdownRenderer http(s) 链接点击路径，REQ-BROWSER-004）。
export function openBrowserPanelWithUrl(url) {
  open = true;
  if (typeof url === "string" && url) {
    navSeq += 1;
    pendingNav = { url, seq: navSeq };
  }
  emit();
}

export function useBrowserPanelOpen() {
  return useSyncExternalStore(subscribeBrowserPanel, isBrowserPanelOpen, () => false);
}

export function useBrowserPendingNav() {
  return useSyncExternalStore(subscribeBrowserPanel, getBrowserPendingNav, () => null);
}
